// ตรวจตัวกลาง api/ (ขั้น 2) กับฐานข้อมูลจำลอง PGlite — ไม่ต้องใช้ Vercel / Supabase / LINE จริง
// ติดตั้งครั้งแรก: cd tools/test && npm install   (และ npm install ที่โฟลเดอร์หลัก สำหรับ pg)
// รัน: node tools/test/api-test.js
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { createTestDb, DB_DIR } = require('./pglite-db');

const ROOT = path.join(__dirname, '..', '..');
const { createApp } = require(path.join(ROOT, 'api', '_lib', 'router.js'));
const { createVerifier, ISSUER } = require(path.join(ROOT, 'api', '_lib', 'line.js'));
const { connectionConfig } = require(path.join(ROOT, 'api', '_lib', 'db.js'));
const indexHandler = require(path.join(ROOT, 'api', 'index.js'));
const U = require(path.join(ROOT, 'api', '_lib', 'util.js'));

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); } };
const count = async (db, sql) => (await db.query(sql)).rows[0].n;

// ---------- รหัส LINE ปลอมที่ลงลายเซ็นจริง (แบบเดียวกับ LIFF: ES256) ----------
const CHANNEL = '1234567890';
const KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const OTHER_KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...KEY.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = Date.now();
function makeToken(claims = {}, { key = KEY.privateKey, header = {} } = {}) {
  const h = b64({ typ: 'JWT', alg: 'ES256', kid: 'k1', ...header });
  const p = b64({ iss: ISSUER, sub: 'U' + 'a'.repeat(32), aud: CHANNEL, exp: Math.floor(NOW / 1000) + 3600, iat: Math.floor(NOW / 1000), name: 'สมชาย <b>ใจดี</b>', picture: 'https://profile.line-scdn.net/x', ...claims });
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + p), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return h + '.' + p + '.' + sig;
}

// LINE ปลอม: นับจำนวนครั้งที่ถูกเรียก และกำหนดคำตอบของหน้าตรวจรหัสได้
function fakeLine() {
  const f = { certs: 0, verify: 0, certsStatus: 200, verifyReply: { status: 400, body: { error: 'invalid_request' } } };
  f.fetch = async (url, opts = {}) => {
    if (String(url).endsWith('/certs')) {
      f.certs++;
      return { ok: f.certsStatus === 200, status: f.certsStatus, json: async () => ({ keys: [jwk] }), text: async () => '' };
    }
    if (String(url).endsWith('/verify')) {
      f.verify++;
      f.lastVerifyBody = String(opts.body || '');
      const r = f.verifyReply;
      return { ok: r.status === 200, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
    }
    throw new Error('เรียกที่อยู่ที่ไม่คาด: ' + url);
  };
  return f;
}

(async () => {
  console.log('\n[1] ข้อมูลร้านทดลอง (db/002_demo_seed.sql)');
  const t0 = Date.now();
  const db = await createTestDb();
  ok(true, 'วาง 001 + 002 ลงฐานข้อมูลเปล่าได้ (' + (Date.now() - t0) + ' ms)');
  const members = await count(db, `select count(*)::int n from members where shop_id='demo'`);
  const tx = await count(db, `select count(*)::int n from transactions where shop_id='demo'`);
  const coupons = await count(db, `select count(*)::int n from coupons where shop_id='demo'`);
  ok(members === 2000, 'สมาชิก 2,000 คน', members);
  ok(tx > 31000 && tx < 33000, 'รายการราว 32,000 (ต้อนรับ 2,000 + ซื้อ 28,000 + แลก): ' + tx, tx);
  const redeems = await count(db, `select count(*)::int n from transactions where shop_id='demo' and type='REDEEM'`);
  ok(coupons === redeems && coupons > 1000, 'คูปอง = จำนวนการแลก (' + coupons + ')');
  const bad = await count(db, `select count(*)::int n from members m where shop_id='demo' and points <> (
      select balance_after from transactions t where t.shop_id='demo' and t.member_id=m.id order by created_at desc, id desc limit 1)`);
  ok(bad === 0, 'แต้มคงเหลือของสมาชิกทุกคน = รายการล่าสุดของคนนั้น', bad);
  const heavy = await count(db, `select count(*)::int n from transactions where shop_id='demo' and member_id='DM-000001'`);
  ok(heavy > 400, 'สมาชิกคนที่ 1 เป็นลูกค้าประจำ (' + heavy + ' รายการ)');
  const spend = await count(db, `select count(*)::int n from members where shop_id='demo' and total_spend <> coalesce((select sum(amount) from transactions t where t.shop_id='demo' and t.member_id=members.id and type='EARN'),0)`);
  ok(spend === 0, 'ยอดซื้อรวมของสมาชิกตรงกับรายการ', spend);

  const seed = fs.readFileSync(path.join(DB_DIR, '002_demo_seed.sql'), 'utf8');
  ok(!/create\s+(temp|temporary)\s/i.test(seed.replace(/--.*$/gm, '')), 'ไม่ใช้ตารางชั่วคราว (SQL Editor ของ Supabase ล้างทิ้งระหว่างคำสั่ง)');
  await db.pg.exec(seed);
  const tx2 = await count(db, `select count(*)::int n from transactions where shop_id='demo'`);
  ok(tx2 === tx, 'รันซ้ำได้ + ได้ข้อมูลชุดเดิม (' + tx2 + ' รายการ)');

  await db.query(`insert into shops (id, name) values ('khamwan', 'ร้านจริง')`);
  try { await db.pg.exec(seed); ok(false, 'ฐานข้อมูลที่มีร้านจริง → ต้องหยุด'); }
  catch (e) {
    try { await db.pg.exec('rollback'); } catch (e2) { /* ไม่มีอะไรค้าง */ }
    const still = await count(db, `select count(*)::int n from transactions where shop_id='demo'`);
    ok(/ร้านจริง/.test(e.message) && still === tx, 'ฐานข้อมูลที่มีร้านอื่น (= ใช้จริง) → หยุดทันที ไม่เปลี่ยนอะไร [' + e.message.split('\n')[0].slice(0, 60) + ']');
  }

  const plan = (await db.query(`explain select id from transactions where shop_id='demo' and member_id='DM-000001' order by created_at desc limit 50`)).rows.map(r => r['QUERY PLAN']).join(' ');
  ok(/transactions_member_idx/.test(plan), 'ประวัติของลูกค้าใช้ดัชนี (ไม่ไล่อ่านทั้งตาราง)', plan.slice(0, 120));

  console.log('\n[2] ขั้นตอนพื้นฐานของตัวกลาง');
  const line = fakeLine();
  const app = createApp({ db: () => db, verifier: createVerifier({ fetch: line.fetch }), allowTestTokens: false, region: 'test' });
  let r = await app.handle(JSON.stringify({ action: 'ping' }));
  ok(r.ok && r.version && r.region === 'test' && typeof r.ms === 'number', 'ping ตอบ ok + รุ่น + ที่ตั้ง + เวลา', r);
  ok(r.cold === true && (await app.handle('{"action":"ping"}')).cold === false, 'บอกได้ว่าเป็นคำขอแรกของเครื่อง (cold) หรือไม่');
  r = await app.handle('{ไม่ใช่ json');
  ok(!r.ok && r.code === 'BAD_REQUEST', 'ข้อความเสีย → BAD_REQUEST', r);
  ok((await app.handle('[1,2]')).code === 'BAD_REQUEST' && (await app.handle('null')).code === 'BAD_REQUEST', 'array / null → BAD_REQUEST');
  ok((await app.handle('')).code === 'UNKNOWN_ACTION', 'ไม่ส่งอะไรมา → ไม่รู้จักคำสั่ง');
  for (const a of ['nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    r = await app.handle(JSON.stringify({ action: a }));
    ok(!r.ok && r.code === 'UNKNOWN_ACTION', 'คำสั่ง "' + a + '" → UNKNOWN_ACTION', r);
  }
  r = await app.handle({ action: 'ping' });
  ok(r.ok, 'รับคำขอที่แปลงเป็น object แล้วได้ (Vercel แปลง JSON ให้เมื่อส่งแบบ application/json)');

  // ระบบเสียกลางทาง → ไม่หลุดรายละเอียดภายในออกไป
  const brokenApp = createApp({ db: () => ({ query: async () => { throw Object.assign(new Error('connection refused 10.0.0.1:6543'), { code: 'ECONNREFUSED' }); } }), verifier: createVerifier({ fetch: line.fetch }), region: 'test' });
  const errLog = console.error; console.error = () => {};
  r = await brokenApp.handle({ action: 'bootstrap', shop: 'demo' }); // หาร้านก่อนตรวจ LINE → ชนฐานข้อมูลล่มทันที
  console.error = errLog;
  ok(!r.ok && r.code === 'ERROR' && r.error === 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' && !/10\.0|6543|ECONN/.test(JSON.stringify(r)), 'ฐานข้อมูลล่ม → ข้อความกลางๆ ไม่บอกที่อยู่/รหัสภายใน', r);

  const prevUrl = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  const { getDb } = require(path.join(ROOT, 'api', '_lib', 'db.js'));
  const noDbApp = createApp({ db: getDb, verifier: createVerifier({ fetch: line.fetch }), region: 'test' });
  console.error = () => {};
  r = await noDbApp.handle({ action: 'bootstrap', shop: 'demo' });
  console.error = errLog;
  if (prevUrl) process.env.DATABASE_URL = prevUrl;
  ok(!r.ok && r.code === 'NO_DB' && /ติดต่อผู้ดูแลระบบ/.test(r.error), 'ยังไม่ได้ตั้งรหัสฐานข้อมูลใน Vercel → NO_DB + "ติดต่อผู้ดูแลระบบ"', r);
  ok((await noDbApp.handle({ action: 'ping' })).ok, 'ยังไม่ได้ตั้งรหัสฐานข้อมูล → ping ยังใช้ได้ (ไม่แตะฐานข้อมูล)');

  const cfg = connectionConfig('postgresql://postgres.abc:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require');
  ok(!/sslmode/.test(cfg.connectionString) && cfg.ssl && cfg.max <= 5, 'ลิงก์ฐานข้อมูล: เอา sslmode ออก (ไม่ให้ทับค่าเข้ารหัส) + เปิดสายไม่เกิน 5', cfg.connectionString);

  // หาร้านเกิดก่อนตรวจ LINE → รหัสร้านเสีย/ไม่มีอยู่ตอบ NO_SHOP โดยไม่ต้องมีรหัส LINE
  // (เดิมตรวจผ่านคำสั่งวัดความเร็ว speedCard ซึ่งลบแล้ว 7 พ.ย. 2569 — ส่วนวัดความเร็วไม่ต้องใช้แล้ว ผ่านเกณฑ์ไปตั้งแต่ขั้น 2)
  console.log('\n[3] หาร้านจากคำขอ');
  for (const s of ['', 'Admin', '../x', 'a', 'x'.repeat(40), null, 123]) {
    r = await app.handle({ action: 'bootstrap', shop: s });
    ok(!r.ok && r.code === 'NO_SHOP', 'รหัสร้าน ' + JSON.stringify(s) + ' → NO_SHOP', r);
  }
  r = await app.handle({ action: 'bootstrap', shop: 'nosuch' });
  ok(!r.ok && r.code === 'NO_SHOP', 'ร้านที่ไม่มีอยู่ → NO_SHOP');
  r = await app.handle({ action: 'speedCard', shop: 'demo' });
  ok(!r.ok && r.code === 'UNKNOWN_ACTION', 'คำสั่งวัดความเร็วชั่วคราว (speedCard) ลบแล้ว → UNKNOWN_ACTION', r);

  console.log('\n[4] ตรวจรหัส LINE');
  await db.query(`update shops set liff_id = $1 where id = 'demo'`, [CHANNEL + '-AbCdEfGh']);
  const fresh = (deps = {}) => { const l = fakeLine(); const a = createApp({ db: () => db, verifier: createVerifier({ fetch: l.fetch, ...deps }), allowTestTokens: false, region: 'test' }); return { l, a }; };
  const who = (a, token, shop = 'demo') => a.handle({ action: 'whoami', shop, idToken: token });
  const warn = console.warn; console.warn = () => {};
  try {
    let { l, a } = fresh();
    const tok = makeToken(); // ลายเซ็น ES256 สุ่มใหม่ทุกครั้งที่สร้าง → "รหัสเดิม" ต้องใช้ข้อความเดิม
    r = await who(a, tok);
    ok(r.ok && r.userId === 'U' + 'a'.repeat(32) && r.via === 'local', 'รหัสถูกต้อง → ผ่าน ตรวจในเครื่อง (ไม่ถาม LINE)', r);
    ok(r.name === 'สมชาย bใจดี/b', 'ชื่อจาก LINE ตัด < > ทิ้ง (เหมือน code.gs)', r.name);
    ok(l.certs === 1 && l.verify === 0, 'ดึงกุญแจ LINE 1 ครั้ง ไม่เรียกหน้าตรวจของ LINE', { certs: l.certs, verify: l.verify });
    r = await who(a, tok);
    ok(r.ok && r.via === 'cache' && l.certs === 1, 'รหัสเดิมส่งซ้ำ → ใช้ผลที่จำไว้', r);
    await db.query(`update shops set liff_id = '9999999999-Other' where id = 'khamwan'`);
    r = await who(a, tok, 'khamwan');
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'รหัสเดียวกันส่งไปร้านอื่น → ไม่ใช้ผลที่จำไว้ของร้านแรก + ปฏิเสธ (ออกให้คนละร้าน)', r);
    r = await who(a, makeToken({ sub: 'U' + 'b'.repeat(32) }));
    ok(r.ok && r.via === 'local' && l.certs === 1, 'รหัสใหม่ → ตรวจในเครื่องด้วยกุญแจที่จำไว้ (ไม่ดึงซ้ำ)');

    ({ l, a } = fresh());
    r = await who(a, makeToken({ exp: Math.floor(NOW / 1000) - 10 }));
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'หมดอายุ → TOKEN_INVALID (หน้าเว็บจะพาเข้าสู่ระบบใหม่)', r);
    r = await who(a, makeToken({ aud: '9999999999' }));
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'รหัสของร้านอื่น (aud ไม่ตรง) → ปฏิเสธ', r);
    r = await who(a, makeToken({ iss: 'https://evil.example' }));
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'ไม่ได้ออกโดย LINE (iss) → ปฏิเสธ');
    r = await who(a, makeToken({ sub: '' }));
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'ไม่มีรหัสผู้ใช้ → ปฏิเสธ');
    r = await who(a, makeToken({ sub: 'U1"; drop' }));
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'รหัสผู้ใช้มีอักขระแปลก → ปฏิเสธ');
    r = await who(a, makeToken({ exp: undefined }));
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'ไม่มีวันหมดอายุ → ปฏิเสธ');
    r = await who(a, makeToken({}, { key: OTHER_KEY.privateKey }));
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'ลงลายเซ็นด้วยกุญแจอื่น (ปลอม) → ปฏิเสธ');
    const good = makeToken().split('.');
    const forged = good[0] + '.' + b64({ iss: ISSUER, sub: 'U' + 'c'.repeat(32), aud: CHANNEL, exp: Math.floor(NOW / 1000) + 3600 }) + '.' + good[2];
    const v0 = l.verify;
    r = await who(a, forged);
    ok(!r.ok && r.code === 'TOKEN_INVALID' && l.verify === v0, 'แก้ไส้ในรหัส (เปลี่ยนเป็นคนอื่น) → ปฏิเสธทันที ไม่ส่งต่อให้ LINE');
    r = await who(a, good[0] + '.' + good[1] + '.' + 'AAAA');
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'ลายเซ็นผิดขนาด → ปฏิเสธ (ไม่พัง)');
    r = await who(a, 'abc');
    ok(!r.ok && r.code === 'TOKEN_INVALID' && l.verify === v0, 'รหัสมั่ว → ปฏิเสธ ไม่เรียก LINE');
    r = await who(a, 'a.b.c');
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'รหัสอ่านไม่ออก → ปฏิเสธ');

    // รหัสที่ไม่ได้บอกว่า "ไม่ต้องตรวจลายเซ็น" ต้องไม่ผ่านทางลัด
    const noneTok = b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: ISSUER, sub: 'U' + 'd'.repeat(32), aud: CHANNEL, exp: Math.floor(NOW / 1000) + 3600 }) + '.';
    ({ l, a } = fresh());
    r = await who(a, noneTok);
    ok(!r.ok && r.code === 'TOKEN_INVALID' && l.verify === 1, 'รหัสแบบไม่มีลายเซ็น (alg none) → ส่งให้ LINE ตรวจ → LINE ปฏิเสธ', { r, verify: l.verify });
    ok(/client_id=1234567890/.test(l.lastVerifyBody), 'ส่งรหัส channel ของร้านให้ LINE ตรวจด้วย', l.lastVerifyBody);

    // วิธีสำรอง: ถาม LINE แบบเดิม
    let kclock = NOW;
    ({ l, a } = fresh({ now: () => kclock }));
    l.verifyReply = { status: 200, body: { sub: 'U' + 'e'.repeat(32), name: 'คุณเอ', exp: Math.floor(NOW / 1000) + 3600, aud: CHANNEL } };
    r = await who(a, makeToken({}, { header: { kid: 'unknown' } }));
    ok(r.ok && r.via === 'line' && r.userId === 'U' + 'e'.repeat(32), 'กุญแจที่ไม่รู้จัก → ถาม LINE แทน (ยังเข้าใช้ได้)', { r, certs: l.certs });
    ok(l.certs === 1, 'เพิ่งดึงกุญแจมา → ไม่ดึงซ้ำทันที', l.certs);
    kclock = NOW + 6 * 60 * 1000;
    await who(a, makeToken({ sub: 'U' + 'f'.repeat(32) }, { header: { kid: 'unknown2' } }));
    ok(l.certs === 2, 'ผ่านไป 6 นาที เจอกุญแจไม่รู้จัก → ดึงกุญแจใหม่ 1 ครั้ง (LINE อาจเพิ่งเปลี่ยนกุญแจ)', l.certs);
    kclock = NOW + 8 * 60 * 1000;
    await who(a, makeToken({ sub: 'U' + '1'.repeat(32) }, { header: { kid: 'unknown3' } }));
    ok(l.certs === 2, 'เจอกุญแจไม่รู้จักอีกภายใน 5 นาที → ไม่ดึงซ้ำ (กันคนส่งรหัสมั่วให้เราดึงรัว)', l.certs);
    kclock = NOW + 25 * 60 * 60 * 1000;
    l.verifyReply = { status: 200, body: { sub: 'U' + '2'.repeat(32), exp: Math.floor(kclock / 1000) + 3600 } };
    await who(a, makeToken({ sub: 'U' + '2'.repeat(32), exp: Math.floor(kclock / 1000) + 3600 }));
    ok(l.certs === 3, 'กุญแจที่จำไว้เกิน 24 ชั่วโมง → ดึงใหม่', l.certs);
    r = await who(a, makeToken({ exp: Math.floor(kclock / 1000) + 3600 }, { header: { alg: 'HS256' } }));
    ok(r.ok && r.via === 'line', 'รหัสแบบ HS256 (LINE Login บนเว็บ) → ถาม LINE');

    ({ l, a } = fresh());
    l.certsStatus = 500;
    l.verifyReply = { status: 200, body: { sub: 'U' + 'a'.repeat(32), name: 'x', exp: Math.floor(NOW / 1000) + 3600 } };
    r = await who(a, makeToken());
    ok(r.ok && r.via === 'line', 'ดึงกุญแจ LINE ไม่ได้ → ถาม LINE แทน (ยังใช้งานได้)', r);
    l.verifyReply = { status: 500, body: {} };
    const ce = console.error; console.error = () => {};
    r = await who(a, makeToken({ sub: 'U' + '9'.repeat(32) }));
    console.error = ce;
    ok(!r.ok && r.code === 'ERROR', 'LINE ล่มทั้งสองทาง → "ระบบขัดข้อง" (ไม่ใช่ TOKEN_INVALID → หน้าเว็บไม่พาเข้าสู่ระบบวน)', r);

    // จำผลไม่นานกว่าอายุรหัส
    let clock = NOW;
    ({ l, a } = fresh({ now: () => clock }));
    const shortTok = makeToken({ exp: Math.floor(NOW / 1000) + 120 });
    ok((await who(a, shortTok)).ok, 'รหัสเหลืออายุ 2 นาที → ผ่าน');
    clock = NOW + 90 * 1000;
    r = await who(a, shortTok);
    ok(r.ok && r.via === 'local', 'ผ่านไป 90 วินาที (เหลือไม่ถึง 1 นาที) → ไม่ใช้ผลที่จำไว้ ตรวจลายเซ็น/อายุใหม่ (ยังเหลือ 30 วิ จึงผ่าน)', r);
    clock = NOW + 130 * 1000;
    r = await who(a, shortTok);
    ok(!r.ok && r.code === 'TOKEN_INVALID', 'ผ่านไป 130 วินาที → หมดอายุ → TOKEN_INVALID', r);

    // ร้านกับรหัส
    ({ l, a } = fresh());
    r = await who(a, '');
    ok(!r.ok && r.code === 'NO_TOKEN', 'ไม่มีรหัส → NO_TOKEN');
    r = await who(a, 'TEST:U_X:ทดสอบ');
    ok(!r.ok && r.code === 'TEST_DISABLED', 'รหัสทดสอบ ตอนไม่ได้เปิดโหมดทดสอบ → ปฏิเสธ');
    const testApp = createApp({ db: () => db, verifier: createVerifier({ fetch: l.fetch }), allowTestTokens: true, region: 'test' });
    r = await testApp.handle({ action: 'whoami', shop: 'demo', idToken: 'TEST:U_X:ทดสอบ<x>' });
    ok(r.ok && r.userId === 'U_X' && r.name === 'ทดสอบx' && r.via === 'test', 'เปิดโหมดทดสอบ → รหัสทดสอบใช้ได้', r);
    r = await testApp.handle({ action: 'whoami', shop: 'demo', idToken: 'TEST:../x:a' });
    ok(!r.ok && r.code === 'TEST_DISABLED', 'รหัสทดสอบที่ชื่อผู้ใช้แปลก → ปฏิเสธ');
    await db.query(`update shops set liff_id = '' where id = 'khamwan'`);
    const ce2 = console.error; console.error = () => {};
    r = await who(a, makeToken(), 'khamwan');
    console.error = ce2;
    ok(!r.ok && r.code === 'NO_LIFF' && /ติดต่อผู้ดูแลระบบ/.test(r.error), 'ร้านที่ยังไม่ใส่ liff_id → NO_LIFF', r);
    await db.query(`update shops set status = 'INACTIVE' where id = 'khamwan'`);
    ({ l, a } = fresh());
    r = await who(a, makeToken(), 'khamwan');
    ok(!r.ok && r.code === 'SHOP_INACTIVE', 'ร้านที่ปิดใช้งาน → SHOP_INACTIVE', r);
  } finally {
    console.warn = warn;
  }

  console.log('\n[5] รับ-ส่งผ่าน HTTP (api/index.js แบบที่ Vercel เรียก)');
  const handler = indexHandler.createHandler(createApp({ db: () => db, verifier: createVerifier({ fetch: fakeLine().fetch }), region: 'test' }));
  const server = http.createServer(handler);
  await new Promise(res => server.listen(0, res));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    let res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'ping' }) });
    let j = await res.json();
    ok(res.status === 200 && j.ok, 'POST แบบ text/plain (แบบที่หน้าเว็บส่ง) → ok');
    ok(res.headers.get('cache-control') === 'no-store' && /application\/json/.test(res.headers.get('content-type')), 'ตอบเป็น JSON + ห้ามจำคำตอบ (no-store)');
    res = await fetch(base, { method: 'POST', body: JSON.stringify({ action: 'nope' }) });
    j = await res.json();
    ok(res.status === 200 && !j.ok && j.code === 'UNKNOWN_ACTION', 'ผิดระดับคำสั่ง → 200 + ok:false (เหมือน Apps Script)');
    res = await fetch(base);
    j = await res.json();
    ok(j.ok && j.service === 'LINE CRM', 'GET → บอกว่าระบบทำงาน (เหมือน doGet)');
    res = await fetch(base, { method: 'PUT', body: '{}' });
    ok(res.status === 405, 'PUT → 405');
    res = await fetch(base, { method: 'POST', body: 'x'.repeat(5 * 1024 * 1024) }).catch(e => ({ status: 'reset' }));
    ok(res.status === 413 || res.status === 'reset', 'ข้อมูลใหญ่เกิน 4 MB → ปฏิเสธ (' + res.status + ')');
    j = await (await fetch(base, { method: 'POST', body: JSON.stringify({ action: 'bootstrap', shop: 'nosuch', idToken: 'x' }) })).json();
    ok(!j.ok && j.code === 'NO_SHOP', 'คำสั่งที่ต้องหาร้านผ่าน HTTP → ถึงฐานข้อมูลจริง (ร้านที่ไม่มี → NO_SHOP)', j);
  } finally {
    server.close();
  }

  console.log('\n[5.5] ที่เก็บรูป (Supabase Storage) + อัปโหลดรูปจากหลังบ้าน');
  const { createStorage, StorageNotConfigured } = require(path.join(ROOT, 'api', '_lib', 'storage.js'));
  const calls = [];
  const fakeFetch = (replies) => async (url, opts) => { calls.push({ url, opts }); const r = replies.shift(); return { ok: r.status < 300, status: r.status, text: async () => r.body || '' }; };
  try { await createStorage({ url: '', key: '' }).upload('a.png', Buffer.from('x'), 'image/png'); ok(false, 'ยังไม่ตั้งค่า → ต้อง error'); }
  catch (e) { ok(e instanceof StorageNotConfigured, 'ยังไม่ได้ตั้ง SUPABASE_URL / กุญแจ → แจ้งชัดเจน (ไม่ส่งไปที่ไหน)'); }
  calls.length = 0;
  let st = createStorage({ url: 'https://abc.supabase.co/', key: 'sb_secret_TEST', fetch: fakeFetch([{ status: 200 }]) });
  let url = await st.upload('demo/reward-x.png', Buffer.from('img'), 'image/png');
  ok(url === 'https://abc.supabase.co/storage/v1/object/public/images/demo/reward-x.png', 'อัปโหลดสำเร็จ → ได้ลิงก์สาธารณะของรูป', url);
  ok(calls[0].url === 'https://abc.supabase.co/storage/v1/object/images/demo/reward-x.png' && calls[0].opts.method === 'POST' &&
    calls[0].opts.headers.apikey === 'sb_secret_TEST' && calls[0].opts.headers.Authorization === 'Bearer sb_secret_TEST' &&
    calls[0].opts.headers['Content-Type'] === 'image/png' && calls[0].opts.headers['x-upsert'] === 'false', 'ส่งไปถังรูป images พร้อมกุญแจ + ชนิดไฟล์ + ไม่ทับไฟล์เดิม');
  calls.length = 0;
  st = createStorage({ url: 'https://abc.supabase.co', key: 'k', fetch: fakeFetch([{ status: 400, body: '{"statusCode":"404","error":"Bucket not found"}' }, { status: 200 }, { status: 200 }]) });
  url = await st.upload('demo/a.png', Buffer.from('img'), 'image/png');
  const bucketBody = JSON.parse(calls[1].opts.body);
  ok(calls.length === 3 && /\/storage\/v1\/bucket$/.test(calls[1].url) && bucketBody.public === true && bucketBody.file_size_limit === 2 * 1024 * 1024 && /images\/demo\/a\.png$/.test(calls[2].url),
    'ยังไม่มีถังรูป → สร้างให้ (เปิดดูได้ จำกัดเฉพาะรูป 2MB) แล้วอัปโหลดซ้ำ', calls.map((c) => c.url));
  st = createStorage({ url: 'https://abc.supabase.co', key: 'k', fetch: fakeFetch([{ status: 500, body: 'boom' }]) });
  try { await st.upload('demo/a.png', Buffer.from('x'), 'image/png'); ok(false, 'ล่ม → ต้อง error'); } catch (e) { ok(/500/.test(e.message), 'ที่เก็บรูปล่ม → แจ้ง error (ไม่เงียบ)'); }

  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 1)]).toString('base64');
  const stored = [];
  const upApp = createApp({ db: () => db, verifier: createVerifier({ fetch: fakeLine().fetch }), allowTestTokens: true, region: 'test',
    storage: () => ({ upload: async (p2, bytes, mime) => { stored.push({ p: p2, n: bytes.length, mime }); return 'https://x.supabase.co/storage/v1/object/public/images/' + p2; } }) });
  r = await upApp.handle({ action: 'adminUploadImage', shop: 'demo', idToken: 'TEST:U_DEMO_OWNER:เจ้าของ', mime: 'image/png', data: PNG, kind: 'promo' });
  ok(r.ok && /\/images\/demo\/promo-\d{4}-\d{2}-\d{2}-[A-Z2-9]{6}\.png$/.test(r.url) && stored[0].n === 72, 'อัปโหลดจากหลังบ้าน → แยกโฟลเดอร์ร้าน + ชื่อไฟล์สุ่ม + ได้ลิงก์กลับ', r);
  r = await upApp.handle({ action: 'adminUploadImage', shop: 'demo', idToken: 'TEST:U_DEMO_CASHIER:แคชเชียร์', mime: 'image/png', data: PNG });
  ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์อัปโหลดรูปไม่ได้', r);
  const badApp = createApp({ db: () => db, verifier: createVerifier({ fetch: fakeLine().fetch }), allowTestTokens: true, region: 'test',
    storage: () => ({ upload: async () => { throw new Error('connect ECONNREFUSED abc.supabase.co'); } }) });
  const ce3 = console.error; console.error = () => {};
  r = await badApp.handle({ action: 'adminUploadImage', shop: 'demo', idToken: 'TEST:U_DEMO_OWNER:เจ้าของ', mime: 'image/png', data: PNG });
  console.error = ce3;
  ok(!r.ok && r.code === 'STORAGE_ERROR' && /ติดต่อผู้ดูแลระบบ/.test(r.error) && !/supabase|ECONN/i.test(JSON.stringify(r)), 'ที่เก็บรูปล่ม → ข้อความกลางๆ ไม่บอกว่ารูปเก็บที่ไหน', r);

  console.log('\n[5.6] ลบ ของรางวัล / โปรโมชัน / แต้มพิเศษ (ซ่อน แต่ประวัติยังอยู่)');
  {
    const da = createApp({ db: () => db, verifier: createVerifier({ fetch: fakeLine().fetch }), allowTestTokens: true, region: 'test' });
    const OW = 'TEST:U_DEMO_OWNER:เจ้าของ';
    const CA = 'TEST:U_DEMO_CASHIER:แคชเชียร์';
    await db.query(`insert into staff (shop_id, line_user_id, name, role, status) values ('demo', 'U_DEMO_ADMIN', 'ผู้จัดการ', 'ADMIN', 'ACTIVE') on conflict do nothing`);
    const AD = 'TEST:U_DEMO_ADMIN:ผู้จัดการ';
    const call = (body, tok) => da.handle(Object.assign({ shop: 'demo', idToken: tok || OW, requestId: crypto.randomUUID() }, body));
    // ปิดบันทึกของระบบ (เช่น "ลบของรางวัล ...") แต่ยังแสดงผลทดสอบ ✓ ✗
    const log = console.log; console.log = (...a) => { if (/^  [✓✗]/.test(String(a[0]))) log(...a); };
    try {
      r = await call({ action: 'adminRewards' });
      ok(r.ok && r.canDelete === true && r.items.some((x) => x.id === 'R002'), 'รายการของรางวัลบอกหน้าเว็บว่าลบได้ (ระบบเดิมไม่มี → ไม่มีปุ่ม)');
      // ลูกค้าแลก R002 ไว้ก่อน แล้วค่อยลบ → คูปองต้องใช้ได้ต่อ
      const red = await call({ action: 'redeem', rewardId: 'R002' }, 'TEST:U_DEMO_3:ลูกค้า');
      ok(red.ok && red.coupon && red.coupon.code, 'ลูกค้าแลก R002 ได้คูปองก่อนลบ', red);
      r = await call({ action: 'adminRewardDelete', id: 'R002' }, CA);
      ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์ลบไม่ได้', r);
      r = await call({ action: 'adminRewardDelete', id: 'R002' }, AD);
      ok(r.ok && r.deleted === 'R002' && r.name === 'ของหวาน 1 ที่', 'ผู้จัดการลบของรางวัลได้ (เหมือนสิทธิ์แก้)', r);
      r = await call({ action: 'adminRewardDelete', id: 'R002' }, AD);
      ok(r.ok, 'ลบซ้ำ (กดสองครั้ง) → สำเร็จเหมือนเดิม ไม่ error');
      r = await call({ action: 'adminRewardDelete', id: 'R404' });
      ok(!r.ok && r.code === 'NOT_FOUND', 'ลบสิ่งที่ไม่มี → NOT_FOUND');
      r = await call({ action: 'adminRewardDelete', id: '../x' });
      ok(!r.ok && r.code === 'BAD_KEY', 'รหัสผิดรูปแบบ → BAD_KEY');
      r = await call({ action: 'adminRewards' });
      ok(r.ok && !r.items.some((x) => x.id === 'R002'), 'หลังบ้านไม่เห็นของรางวัลที่ลบ');
      r = await call({ action: 'bootstrap' }, 'TEST:U_DEMO_3:ลูกค้า');
      ok(r.ok && !r.rewards.some((x) => x.id === 'R002') && r.coupons.some((c) => c.code === red.coupon.code && c.status === 'ACTIVE'),
        'ลูกค้าไม่เห็นของรางวัลที่ลบ แต่คูปองที่แลกไว้ยังอยู่และใช้ได้');
      r = await call({ action: 'redeem', rewardId: 'R002' }, 'TEST:U_DEMO_3:ลูกค้า');
      ok(!r.ok && r.code === 'REWARD_UNAVAILABLE', 'แลกของรางวัลที่ลบไม่ได้ (ส่งรหัสมาเองก็ไม่ได้)', r);
      r = await call({ action: 'useCoupon', code: red.coupon.code, branchId: 'B01' });
      ok(r.ok && r.coupon.status === 'USED', 'พนักงานสแกนใช้คูปองของรางวัลที่ลบไปแล้วได้ตามปกติ', r);
      r = await call({ action: 'adminRewardSave', reward: { id: 'R002', name: 'แก้', points: 1, status: 'ACTIVE' } });
      ok(!r.ok && r.code === 'NOT_FOUND', 'แก้ของรางวัลที่ลบแล้วไม่ได้', r);
      r = await call({ action: 'adminRewardSave', reward: { name: 'ของใหม่', points: 50, status: 'ACTIVE' } });
      ok(r.ok && r.reward.id === 'R009', 'เพิ่มของรางวัลใหม่ได้รหัส R009 (ไม่เอารหัสที่ลบไปใช้ซ้ำ)', r.reward && r.reward.id);

      r = await call({ action: 'adminPromoDelete', id: 'P002' }, CA);
      ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์ลบโปรโมชันไม่ได้');
      r = await call({ action: 'adminPromoDelete', id: 'P002' });
      ok(r.ok && r.name === 'วันพุธแต้ม 2 เท่า', 'ลบโปรโมชัน', r);
      r = await call({ action: 'adminPromos' });
      ok(r.ok && r.canDelete === true && !r.items.some((x) => x.id === 'P002'), 'หลังบ้านไม่เห็นโปรโมชันที่ลบ');
      r = await call({ action: 'bootstrap' }, 'TEST:U_DEMO_3:ลูกค้า');
      ok(!r.promos.some((x) => x.id === 'P002'), 'ลูกค้าไม่เห็นโปรโมชันที่ลบ');

      // กติกาแต้มพิเศษ: ทำให้มีผลทุกวัน แล้วลบ → บิลถัดไปไม่ได้ ×2
      await db.query(`update point_rules set days = $1, branch = '' where shop_id = 'demo' and id = 'PR001'`, [U.DAY_CODES]);
      const buy = async () => (await call({ action: 'addPurchase', memberId: 'DM-000005', amount: 200, branchId: 'B02' })).pointsAdded;
      ok((await buy()) === 20, 'ก่อนลบ: ยอด 200 ได้ 20 แต้ม (×2)');
      r = await call({ action: 'adminRuleDelete', id: 'PR001' }, AD);
      ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการลบแต้มพิเศษไม่ได้ (แก้ก็ไม่ได้)', r);
      r = await call({ action: 'adminRuleDelete', id: 'PR001' });
      ok(r.ok, 'เจ้าของร้านลบแต้มพิเศษ');
      ok((await buy()) === 10, 'หลังลบ: ยอด 200 ได้ 10 แต้มปกติ');
      r = await call({ action: 'adminRules' });
      ok(r.ok && r.canDelete === true && !r.items.some((x) => x.id === 'PR001'), 'หลังบ้านไม่เห็นกติกาที่ลบ');
      r = await call({ action: 'staffMe' });
      ok(r.ok && !r.rules.some((x) => x.id === 'PR001'), 'หน้าพนักงานไม่เห็นกติกาที่ลบ');
      const kept = (await db.query(`select count(*)::int n from transactions where shop_id = 'demo' and ref = 'PR001'`)).rows[0].n;
      ok(kept >= 1, 'ประวัติแต้มที่ได้จากกติกานี้ยังอยู่ครบ (' + kept + ' รายการ)');
    } finally {
      console.log = log;
    }
  }

  console.log('\n[5.7] ส่งข้อความตามกลุ่ม รอบ 1: คัดกลุ่มลูกค้า (adminAudience)');
  {
    const da = createApp({ db: () => db, verifier: createVerifier({ fetch: fakeLine().fetch }), allowTestTokens: true, region: 'test' });
    const OW = 'TEST:U_DEMO_OWNER:เจ้าของ';
    const call = (action, body, tok) => da.handle(Object.assign({ action, shop: 'demo', idToken: tok || OW, requestId: crypto.randomUUID() }, body));
    const aud = (filter, tok) => call('adminAudience', { filter }, tok);
    const log = console.log; console.log = (...a) => { if (/^  [✓✗]/.test(String(a[0]))) log(...a); };
    try {
      // ทำข้อมูลให้มีทุกกรณีที่ต้องตัดออก (ยินยอมรับข่าวสารทุกคน → ต้องถูกตัดเพราะเหตุอื่น)
      await db.query(`update members set marketing_consent = true, status = 'BLOCKED' where shop_id = 'demo' and id in ('DM-000011', 'DM-000012', 'DM-000013')`);
      await db.query(`update members set marketing_consent = true, line_user_id = null where shop_id = 'demo' and id in ('DM-000014', 'DM-000015')`);
      r = await call('adminTiersSave', { tiers: [{ name: 'Member', minPoints: 0, multiplier: 1 }, { name: 'Silver', minPoints: 150, multiplier: 1.5 }, { name: 'Gold', minPoints: 600, multiplier: 2 }] });
      ok(r.ok, 'ตั้งระดับ 3 ระดับไว้ลองกรองระดับ', r);
      const first = await aud({});
      const tiers = first.tiers || [];
      ok(first.ok && tiers.length === 3, 'เจ้าของร้านเปิดได้ + ได้รายชื่อระดับไว้ทำตัวเลือก', first);

      // คิดผลที่ควรได้แยกเอง (ด้วย JavaScript ไม่ใช้ SQL ชุดเดียวกับตัวกลาง) แล้วเทียบ
      const all = (await db.query(`select id, line_user_id, tier_id, joined_branch, extract(month from birth_date)::int as bm, points, total_spend::float8 as spend,
          visit_count, extract(epoch from last_visit_at)::float8 * 1000 as lv, extract(epoch from joined_at)::float8 * 1000 as jt, status, marketing_consent as mc
          from members where shop_id = 'demo'`)).rows;
      const now = Date.now();
      const ago = (d) => now - d * U.DAY_MS;
      const has = (v) => v !== undefined && v !== null && String(v).replace(/,/g, '') !== '';
      const n = (v) => Number(String(v).replace(/,/g, ''));
      const match = (f) => (m) =>
        (!f.tiers || !f.tiers.length || f.tiers.includes(m.tier_id)) &&
        (!f.branches || !f.branches.length || f.branches.map((x) => x.toUpperCase()).includes(m.joined_branch)) &&
        (!f.birthMonth || m.bm === Number(f.birthMonth)) &&
        (!has(f.pointsMin) || m.points >= n(f.pointsMin)) && (!has(f.pointsMax) || m.points <= n(f.pointsMax)) &&
        (!has(f.spendMin) || m.spend >= n(f.spendMin)) && (!has(f.spendMax) || m.spend <= n(f.spendMax)) &&
        (!has(f.visitsMin) || m.visit_count >= n(f.visitsMin)) && (!has(f.visitsMax) || m.visit_count <= n(f.visitsMax)) &&
        (f.lastVisit !== 'within' || (m.lv != null && m.lv >= ago(f.lastVisitDays))) &&
        (f.lastVisit !== 'over' || (m.lv != null ? m.lv : m.jt) < ago(f.lastVisitDays)) &&
        (!has(f.joinedDays) || m.jt >= ago(f.joinedDays));
      const sendable = (m) => m.status === 'ACTIVE' && m.mc === true && !!m.line_user_id;
      const expect = (f) => {
        const hit = all.filter(match(f));
        return {
          matched: hit.length, sendable: hit.filter(sendable).length,
          excluded: { noConsent: hit.filter((m) => !m.mc).length, blocked: hit.filter((m) => m.mc && m.status !== 'ACTIVE').length,
            noLine: hit.filter((m) => m.mc && m.status === 'ACTIVE' && !m.line_user_id).length },
          ids: new Set(hit.filter(sendable).map((m) => m.id))
        };
      };
      const silver = tiers[1].id, gold = tiers[2].id;
      const thisMonth = Number(U.thaiDay(new Date()).slice(5, 7));
      const cases = [
        ['ไม่ใส่เงื่อนไข = ทุกคนที่ส่งได้', {}],
        ['แต้มคงเหลือ 100–500', { pointsMin: 100, pointsMax: 500 }],
        ['ยอดซื้อรวมตั้งแต่ 1,000 (มีจุลภาค)', { spendMin: '1,000' }],
        ['มา 3 ครั้งพอดี', { visitsMin: 3, visitsMax: '3' }],
        ['เกิดเดือนนี้', { birthMonth: thisMonth }],
        ['สมัครที่ B02 หรือ B03 (พิมพ์ตัวเล็กก็ได้)', { branches: ['B02', 'b03'] }],
        ['มาซื้อภายใน 30 วัน', { lastVisit: 'within', lastVisitDays: 30 }],
        ['ไม่ได้มาเกิน 180 วัน (ยังไม่เคยซื้อ นับจากวันสมัคร)', { lastVisit: 'over', lastVisitDays: '180' }],
        ['สมัครภายใน 775 วัน', { joinedDays: 775 }],
        ['ระดับ Gold', { tiers: [gold] }],
        ['หลายข้อพร้อมกัน: Silver/Gold + สาขา B01 + ไม่ได้มาเกิน 60 วัน + แต้ม ≥ 50', { tiers: [silver, gold], branches: ['B01'], lastVisit: 'over', lastVisitDays: 60, pointsMin: 50 }]
      ];
      for (const [label, f] of cases) {
        const got = await aud(f);
        const exp = expect(f);
        ok(got.ok && got.matched === exp.matched && got.sendable === exp.sendable && JSON.stringify(got.excluded) === JSON.stringify(exp.excluded) &&
          got.items.length === Math.min(20, exp.sendable) && got.items.every((x) => exp.ids.has(x.memberId)),
          `${label} → ตรง ${exp.matched} คน ส่งได้ ${exp.sendable} คน`, got.ok ? { got: [got.matched, got.sendable, got.excluded], exp: [exp.matched, exp.sendable, exp.excluded] } : got);
      }
      const e0 = expect({});
      ok(first.matched === 2000 && first.excluded.blocked === 3 && first.excluded.noLine === 2 && e0.excluded.noConsent > 0,
        'ตัดคนที่ไม่ยินยอมรับข่าวสาร / ถูกระงับ 3 คน / ไม่ได้สมัครผ่าน LINE 2 คน ออกเอง', first.excluded);
      ok(first.items.every((x, i, a) => i === 0 || a[i - 1].joinedAt >= x.joinedAt) && first.previewLimit === 20, 'ตัวอย่าง 20 คน เรียงสมัครล่าสุดก่อน');
      const text = JSON.stringify(first);
      ok(!/U_DEMO_|"phone"|"birth|line_user/i.test(text), 'ตัวอย่างรายชื่อไม่มี LINE ID / เบอร์ / วันเกิด (LINE ID ไม่ออกจากตัวกลาง)');
      ok(first.items[0].tier && first.items[0].tierId, 'ตัวอย่างบอกระดับของแต่ละคน');

      // ใครใช้ได้
      r = await aud({}, 'TEST:U_DEMO_ADMIN:ผู้จัดการ');
      ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการใช้ไม่ได้ (เจ้าของร้านเท่านั้น)', r);
      r = await aud({}, 'TEST:U_DEMO_CASHIER:แคชเชียร์');
      ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์ใช้ไม่ได้', r);
      r = await aud({}, 'TEST:U_DEMO_3:ลูกค้า');
      ok(!r.ok && r.code === 'NOT_STAFF', 'ลูกค้าใช้ไม่ได้', r);

      // ค่าที่ผิด → แจ้ง ไม่เดาแทน
      const bad = [
        ['แต้มเริ่มมากกว่าแต้มสิ้นสุด', { pointsMin: 500, pointsMax: 100 }, 'BAD_INPUT'],
        ['แต้มติดลบ', { pointsMin: '-5' }, 'BAD_INPUT'],
        ['แต้มมีทศนิยม', { pointsMin: '1.5' }, 'BAD_INPUT'],
        ['เดือนเกิด 13', { birthMonth: 13 }, 'BAD_INPUT'],
        ['เดือนเกิด 0', { birthMonth: 0 }, 'BAD_INPUT'],
        ['มาซื้อล่าสุดไม่ใส่จำนวนวัน', { lastVisit: 'within' }, 'BAD_INPUT'],
        ['มาซื้อล่าสุดแบบที่ไม่มี', { lastVisit: 'sometimes', lastVisitDays: 5 }, 'BAD_INPUT'],
        ['สมัครภายใน 0 วัน', { joinedDays: 0 }, 'BAD_INPUT'],
        ['สาขาไม่ได้ส่งเป็นรายการ', { branches: 'B01' }, 'BAD_INPUT'],
        ['สาขาแอบใส่คำสั่ง SQL', { branches: ["B01'; drop table members;--"] }, 'BAD_INPUT'],
        ['ระดับที่ไม่มีในร้าน', { tiers: ['T99'] }, 'BAD_TIER']
      ];
      for (const [label, f, code] of bad) {
        r = await aud(f);
        ok(!r.ok && r.code === code, `${label} → ${code}`, r);
      }
      ok(await count(db, `select count(*)::int n from members where shop_id = 'demo'`) === 2000, 'ตารางสมาชิกยังอยู่ครบ');
      r = await aud('ไม่ใช่เงื่อนไข');
      ok(r.ok && r.matched === 2000, 'เงื่อนไขที่ไม่ใช่รูปแบบที่รู้จัก = ไม่กรอง (ไม่ล่ม)', r);

      // ร้านปิดใช้ระดับ → ไม่สนตัวกรองระดับ + ไม่ส่งรายชื่อระดับ
      r = await call('adminTiersSave', { tiers: [] });
      ok(r.ok, 'ปิดใช้ระดับสมาชิก', r);
      r = await aud({ tiers: [gold] });
      ok(r.ok && r.matched === 2000 && !r.tiers && r.items.every((x) => x.tier === '' && x.tierId === ''), 'ร้านไม่มีระดับ: ตัวกรองระดับไม่มีผล ไม่มีข้อมูลระดับในคำตอบ', r.ok ? r.matched : r);
    } finally {
      console.log = log;
    }
  }

  console.log('\n[6] ข้อความถึงผู้ใช้');
  // ทุกไฟล์ใน api/ (ไฟล์ใหม่ถูกตรวจเองโดยไม่ต้องเพิ่มชื่อ)
  const apiFiles = ['index.js'].concat(fs.readdirSync(path.join(ROOT, 'api', '_lib')).filter(f => f.endsWith('.js')).map(f => '_lib/' + f));
  const sources = apiFiles.map(f => fs.readFileSync(path.join(ROOT, 'api', f), 'utf8')).join('\n');
  const msgs = [...sources.matchAll(/userError\('([^']*)'/g)].map(m => m[1]);
  const leaks = msgs.filter(m => /google|drive|ชีต|apps ?script|supabase|vercel|postgres|ฐานข้อมูล/i.test(m));
  ok(msgs.length >= 8 && leaks.length === 0, 'ข้อความ ' + msgs.length + ' ข้อความที่ผู้ใช้เห็น ไม่พูดถึงที่เก็บข้อมูล', leaks);
  ok(!fs.existsSync(path.join(ROOT, 'speed.html')) && !fs.existsSync(path.join(ROOT, 'api', '_lib', 'speed.js')), 'หน้าวัดความเร็วชั่วคราวลบแล้ว (ห้ามขึ้นเว็บจริง)');

  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
