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
const { connectionConfig, getDb } = require(path.join(ROOT, 'api', '_lib', 'db.js'));
// ตัวต่อฐานข้อมูลจริงตอนยังไม่ตั้ง DATABASE_URL (ชุดทดสอบไม่มีค่านี้ → ตอบ NO_DB)
const getDbNoEnv = () => { const keep = process.env.DATABASE_URL; delete process.env.DATABASE_URL; try { return getDb(); } finally { if (keep !== undefined) process.env.DATABASE_URL = keep; } };
const indexHandler = require(path.join(ROOT, 'api', 'index.js'));
const U = require(path.join(ROOT, 'api', '_lib', 'util.js'));

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); } };
const count = async (db, sql) => (await db.query(sql)).rows[0].n;
const KEYS_OFF = (f) => !!f && !f.tiers && !f.branches && !f.export && !f.broadcast; // แพ็กเกจปิดหมด

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
  {
    // ตรวจใบรับรองของ Supabase เต็มรูปแบบ (ปลอมตัวเป็น Supabase ไม่ได้) + ใบรับรองที่ฝังไว้คือ Supabase Root 2021 CA ตัวจริง และยังไม่หมดอายุ
    const x = new crypto.X509Certificate(cfg.ssl.ca);
    ok(cfg.ssl.rejectUnauthorized === true && /CN=Supabase Root 2021 CA/.test(x.subject) &&
      x.fingerprint256 === '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA' && new Date(x.validTo) > new Date(),
      'เชื่อมฐานข้อมูล: ตรวจใบรับรองด้วย Supabase Root 2021 CA (หมดอายุ ' + x.validTo + ')');
    const days = Math.floor((new Date(x.validTo) - new Date()) / 86400000);
    if (days < 180) console.log('  ⚠️ ใบรับรอง Supabase จะหมดอายุในอีก ' + days + ' วัน — โหลดใบใหม่มาแทน api/_lib/supabase-ca.js');
  }

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

  console.log('\n[5.8] ส่งข้อความตามกลุ่ม รอบ 2: ส่งผ่าน LINE OA ของร้าน (OA จำลอง ไม่ส่งจริง)');
  {
    const { createFakeOa } = require('./fake-oa');
    const { OaError } = require(path.join(ROOT, 'api', '_lib', 'lineoa.js'));
    const fake = createFakeOa({ limit: 1000 });
    let oaOn = false;
    const uploaded = [];
    const da = createApp({
      db: () => db, verifier: createVerifier({ fetch: fakeLine().fetch }), allowTestTokens: true, region: 'test',
      storage: () => ({ upload: async (p, bytes, mime) => { uploaded.push({ p, n: bytes.length, mime }); return 'https://storage.test/storage/v1/object/public/images/' + p; } }),
      oa: (shop) => (oaOn && shop === 'demo' ? fake.oa : null)
    });
    const OW = 'TEST:U_DEMO_OWNER:เจ้าของ';
    const call = (action, body, tok) => da.handle(Object.assign({ action, shop: 'demo', idToken: tok || OW, requestId: crypto.randomUUID() }, body));
    const draft = { text: 'โปรวันนี้ ลด 20%\nเฉพาะสมาชิก' };
    // ลิงก์ฐานริชเมสเสจ (รูปแบบเดียวกับที่ adminUploadRichImage คืนให้) — ตรวจรูปแบบเท่านั้น ไม่ต้องมีไฟล์จริง
    const RICH = 'https://storage.test/storage/v1/object/public/images/demo/rich-2026-11-12-ABCDEF';
    const demoShop = (await db.query(`select name, liff_id from shops where id = 'demo'`)).rows[0];
    const sendableIds = async () => (await db.query(`select line_user_id from members where shop_id = 'demo' and status = 'ACTIVE' and marketing_consent and line_user_id is not null`)).rows.map((x) => x.line_user_id).sort();
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const log = console.log; console.log = (...a) => { if (/^  [✓✗]/.test(String(a[0]))) log(...a); };
    const err = console.error; console.error = () => {};
    try {
      // ---- ยังไม่เชื่อม OA ----
      r = await call('adminBroadcastInfo', {});
      ok(r.ok && r.connected === false && Array.isArray(r.history) && r.history.length === 0, 'ร้านยังไม่ได้เชื่อม OA → เปิดหน้าได้ บอกว่ายังไม่เชื่อม', r);
      r = await call('adminBroadcastSend', { filter: {}, draft, expect: 1 });
      ok(!r.ok && r.code === 'OA_NOT_CONNECTED', 'ยังไม่เชื่อม → ส่งไม่ได้ แม้เรียกคำสั่งตรง', r);
      r = await call('adminBroadcastTest', { draft });
      ok(!r.ok && r.code === 'OA_NOT_CONNECTED', 'ยังไม่เชื่อม → ส่งทดสอบไม่ได้');
      r = await call('adminUploadRichImage', { images: {} });
      ok(!r.ok && r.code === 'OA_NOT_CONNECTED', 'ยังไม่เชื่อม → อัปรูปริชเมสเสจไม่ได้ (ร้านที่ไม่มีแพ็กเกจ)');
      oaOn = true;

      r = await call('adminBroadcastInfo', {});
      ok(r.ok && r.connected && r.oa.name === 'OA ทดลอง' && r.oa.basicId === '@demo-oa' && r.quota.limited && r.quota.limit === 1000 && r.quota.remaining === 1000 && r.ownerIsFriend === true,
        'เชื่อมแล้ว → ชื่อ OA + โควตาเดือนนี้ + เจ้าของร้านเป็นเพื่อน OA', r);

      // ---- ตรวจข้อความ ----
      const badDrafts = [
        ['ไม่มีทั้งข้อความและรูป', {}, 'BAD_MESSAGE'],
        ['มีแต่ช่องว่าง', { text: '   \n  ' }, 'BAD_MESSAGE'],
        ['ข้อความยาวเกิน 2,000 ตัว', { text: 'ก'.repeat(2001) }, 'BAD_MESSAGE'],
        ['รูปลิงก์ http', { image: RICH.replace('https:', 'http:'), imageHeight: 1040 }, 'BAD_IMAGE'],
        ['รูปธรรมดา .jpg (ไม่ใช่ริชเมสเสจ 5 ขนาด)', { image: 'https://storage.test/storage/v1/object/public/images/demo/broadcast-x.jpg', imageHeight: 1040 }, 'BAD_IMAGE'],
        ['รูปของร้านอื่น', { image: RICH.replace('/demo/', '/other/'), imageHeight: 1040 }, 'BAD_IMAGE'],
        ['ลิงก์รูปมี ?', { image: RICH + '?w=1', imageHeight: 1040 }, 'BAD_IMAGE'],
        ['ไม่บอกความสูงรูป', { text: 'x', image: RICH }, 'BAD_IMAGE'],
        ['รูปสูงเกิน 2:3', { image: RICH, imageHeight: 1561 }, 'BAD_IMAGE'],
        ['รูปกว้างเกิน 2:1', { image: RICH, imageHeight: 519 }, 'BAD_IMAGE'],
        ['ลิงก์แตะรูปเป็น http', { image: RICH, imageHeight: 1040, link: 'http://example.com' }, 'BAD_LINK'],
        ['ลิงก์แตะรูปเป็น javascript:', { image: RICH, imageHeight: 1040, link: 'javascript:alert(1)' }, 'BAD_LINK']
      ];
      for (const [label, d, code] of badDrafts) {
        r = await call('adminBroadcastTest', { draft: d });
        ok(!r.ok && r.code === code, `${label} → ${code}`, r);
      }
      ok(fake.state.pushes.length === 0, 'ข้อความที่ผิด → ไม่มีอะไรถูกส่ง');

      // ---- ส่งทดสอบหาตัวเอง ----
      r = await call('adminBroadcastTest', { draft: { text: '\nทดสอบ\nบรรทัดสอง', image: RICH, imageHeight: 780 } });
      const p0 = fake.state.pushes[0];
      const im = (p0 && p0.messages[0]) || {};
      ok(r.ok && fake.state.pushes.length === 1 && p0.to === 'U_DEMO_OWNER' && p0.messages.length === 2 && im.type === 'imagemap' &&
        p0.messages[1].type === 'text' && p0.messages[1].text === 'ทดสอบ\nบรรทัดสอง' && UUID.test(p0.key),
        'ส่งทดสอบ → ถึงเจ้าของร้านคนเดียว (ริชเมสเสจก่อน แล้วข้อความ)', fake.state.pushes);
      ok(im.baseUrl === RICH && im.baseSize && im.baseSize.width === 1040 && im.baseSize.height === 780 && im.altText === 'ทดสอบ',
        'ริชเมสเสจ: ลิงก์ฐาน (ไม่มีนามสกุล) + กว้าง 1040 สูงตามรูป + แจ้งเตือนด้วยบรรทัดแรกของข้อความ', im);
      const act = (im.actions || [])[0] || {};
      ok(im.actions.length === 1 && act.type === 'uri' && act.linkUri === 'https://liff.line.me/' + demoShop.liff_id &&
        act.area.x === 0 && act.area.y === 0 && act.area.width === 1040 && act.area.height === 780,
        'แตะได้ทั้งรูป ไม่ใส่ลิงก์ → เปิดบัตรสมาชิกของร้าน', im.actions);
      await call('adminBroadcastTest', { draft: { image: RICH, imageHeight: 1040, link: ' https://example.com/โปร?ส่วนลด=20 ' } });
      const im2 = fake.state.pushes[1].messages;
      ok(im2.length === 1 && im2[0].altText === 'ข้อความจาก ' + demoShop.name && im2[0].actions[0].linkUri === 'https://example.com/%E0%B9%82%E0%B8%9B%E0%B8%A3?%E0%B8%AA%E0%B9%88%E0%B8%A7%E0%B8%99%E0%B8%A5%E0%B8%94=20',
        'รูปอย่างเดียว → แจ้งเตือน "ข้อความจาก <ร้าน>" / ลิงก์ที่ร้านใส่ (อักษรไทยแปลงเป็นรูปที่ LINE รับ)', im2);
      await call('adminBroadcastTest', { draft: { text: 'ก'.repeat(150), image: RICH, imageHeight: 1040 } });
      ok([...fake.state.pushes[2].messages[0].altText].length === 101 && /…$/.test(fake.state.pushes[2].messages[0].altText), 'บรรทัดแรกยาว → แจ้งเตือนตัดที่ 100 ตัว');
      fake.state.pushes.length = 1;
      const rid0 = crypto.randomUUID();
      await call('adminBroadcastTest', { draft, requestId: rid0 });
      r = await call('adminBroadcastTest', { draft, requestId: rid0 });
      ok(r.ok && fake.state.pushes.length === 2, 'กดส่งทดสอบซ้ำ (รหัสคำขอเดิม) → LINE ไม่ส่งซ้ำ');
      fake.state.friends = new Set(['U_DEMO_1']);
      r = await call('adminBroadcastTest', { draft });
      ok(!r.ok && r.code === 'NOT_FRIEND', 'เจ้าของร้านยังไม่เป็นเพื่อน OA → บอกให้เพิ่มเพื่อนก่อน', r);
      r = await call('adminBroadcastInfo', {});
      ok(r.ok && r.connected && r.ownerIsFriend === false, 'หน้าส่งข้อความรู้ว่าเจ้าของร้านยังไม่เป็นเพื่อน');
      fake.state.friends = null;

      // ---- ส่งจริง: ด่านก่อนส่ง ----
      const N = (await call('adminAudience', { filter: {} })).sendable;
      const all = await sendableIds();
      ok(N === all.length && N > 1000, `กลุ่ม "ทุกคนที่ส่งได้" = ${N} คน (มากกว่า 1 ชุด 500 คน)`);
      const before = fake.state.multicasts.length;
      r = await call('adminBroadcastSend', { filter: {}, draft, expect: N });
      ok(!r.ok && r.code === 'QUOTA_NOT_ENOUGH' && /เหลือ/.test(r.error), 'โควตาเดือนนี้ไม่พอ → ไม่ส่งเลย บอกว่าเหลือเท่าไร', r);
      fake.state.limit = null; // แพ็กเกจไม่จำกัด
      r = await call('adminBroadcastSend', { filter: {}, draft, expect: N - 1 });
      ok(!r.ok && r.code === 'AUDIENCE_CHANGED' && r.error.includes(U.fmtNum(N)), 'จำนวนคนไม่ตรงกับที่เห็นตอนยืนยัน → ไม่ส่ง ให้ตรวจใหม่', r);
      r = await call('adminBroadcastSend', { filter: { pointsMin: 999999999 }, draft, expect: 0 });
      ok(!r.ok && r.code === 'NO_RECIPIENTS', 'กลุ่มว่าง → ไม่ส่ง');
      ok(fake.state.multicasts.length === before && await count(db, `select count(*)::int n from broadcasts`) === 0, 'ด่านก่อนส่งไม่ผ่าน → ไม่มีอะไรถูกส่ง ไม่มีประวัติ');

      // ---- ส่งครบ ----
      const rid = crypto.randomUUID();
      r = await call('adminBroadcastSend', { filter: {}, draft, expect: N, requestId: rid });
      const bc = r.broadcast || {};
      const mine = fake.state.multicasts.slice(before);
      const got = mine.flatMap((m) => m.to);
      ok(r.ok && bc.status === 'DONE' && bc.sent === N && bc.total === N && /^BC-/.test(bc.id), `ส่งครบ ${N} คน`, r);
      ok(mine.length === Math.ceil(N / 500) && mine.every((m) => m.to.length <= 500), `แบ่งส่ง ${mine.length} ชุด ชุดละไม่เกิน 500 คน`);
      ok(JSON.stringify([...got].sort()) === JSON.stringify(all) && new Set(got).size === got.length, 'ถึงทุกคนที่ส่งได้ ไม่ซ้ำ ไม่มีคนที่ไม่ยินยอม / ถูกระงับ / ไม่มี LINE');
      ok(mine.every((m) => UUID.test(m.key)) && new Set(mine.map((m) => m.key)).size === mine.length, 'แต่ละชุดมีรหัสกันส่งซ้ำของตัวเอง');
      ok(mine.every((m) => m.messages.length === 1 && m.messages[0].type === 'text' && m.messages[0].text === draft.text), 'ข้อความที่ส่งตรงกับที่พิมพ์ (ขึ้นบรรทัดใหม่ได้)');
      const row = (await db.query(`select * from broadcasts where id = $1`, [bc.id])).rows[0];
      ok(row && row.recipients.length === N && row.created_by === 'U_DEMO_OWNER' && row.batches_done.length === mine.length && row.finished_at && !/U_DEMO_\d/.test(JSON.stringify(row.recipients)),
        'จดประวัติ: ผู้ส่ง / รหัสสมาชิกผู้รับ (ไม่เก็บ LINE ID) / ชุดที่ส่งแล้ว', row && { n: row.recipients.length, done: row.batches_done });
      r = await call('adminBroadcastSend', { filter: {}, draft, expect: N, requestId: rid });
      ok(r.ok && r.broadcast.id === bc.id && fake.state.multicasts.length === before + mine.length, 'กดส่งซ้ำ / เน็ตหลุดแล้วส่งใหม่ (รหัสคำขอเดิม) → ไม่ส่งซ้ำ ได้ผลเดิม');

      // ---- ส่งไม่ครบ (LINE ปฏิเสธชุดที่ 2) แล้วกด "ส่งต่อ" ----
      const orig = fake.oa.multicast;
      let k = 0;
      fake.oa.multicast = async (...a) => { if (++k === 2) throw new OaError(429, 'You have reached your monthly limit.'); return orig(...a); };
      const b1 = fake.state.multicasts.length;
      r = await call('adminBroadcastSend', { filter: {}, draft: { text: 'รอบสอง' }, expect: N });
      const part = r.broadcast || {};
      ok(r.ok && part.status === 'PARTIAL' && part.sent === 500 && part.error === 'OA_LIMIT' && part.canResume === true, 'ชุดที่ 2 ไม่ผ่าน → หยุด สถานะ "ส่งไม่ครบ" ส่งไปแล้ว 500 คน', part);
      fake.oa.multicast = orig;
      // ระหว่างรอ มีลูกค้าในชุดที่ยังไม่ได้ส่ง ขอเลิกรับข่าวสาร → ตอนส่งต่อต้องไม่ส่งให้คนนั้น
      const firstBatch = new Set(fake.state.multicasts[b1].to);
      const quitter = all.find((u) => !firstBatch.has(u));
      await db.query(`update members set marketing_consent = false where shop_id = 'demo' and line_user_id = $1`, [quitter]);
      r = await call('adminBroadcastResume', { id: part.id });
      const resumed = fake.state.multicasts.slice(b1);
      const got2 = resumed.flatMap((m) => m.to);
      ok(r.ok && r.broadcast.status === 'DONE' && r.broadcast.sent === N - 1, 'กด "ส่งต่อ" → ส่งครบ (ไม่นับคนที่เพิ่งเลิกรับข่าวสาร)', r.broadcast);
      ok(new Set(got2).size === got2.length && got2.length === N - 1 && !got2.includes(quitter), 'ส่งต่อเฉพาะชุดที่ค้าง ไม่มีใครได้ซ้ำ');
      r = await call('adminBroadcastResume', { id: part.id });
      ok(r.ok && r.broadcast.status === 'DONE' && fake.state.multicasts.length === b1 + resumed.length, 'กด "ส่งต่อ" อันที่ครบแล้ว → ไม่ส่งอะไรเพิ่ม');
      await db.query(`update members set marketing_consent = true where shop_id = 'demo' and line_user_id = $1`, [quitter]);

      // ---- LINE รับชุดแรกแล้ว แต่คำตอบหายระหว่างทาง → ลองใหม่ด้วยรหัสเดิม LINE ตอบ 409 = ถือว่าส่งแล้ว ----
      k = 0;
      fake.oa.multicast = async (...a) => { const out = await orig(...a); if (++k === 1) throw new OaError(502, 'Bad gateway'); return out; };
      const b2 = fake.state.multicasts.length;
      r = await call('adminBroadcastSend', { filter: { branches: ['B02'] }, draft: { text: 'รอบสาม' }, expect: (await call('adminAudience', { filter: { branches: ['B02'] } })).sendable });
      fake.oa.multicast = orig;
      ok(r.ok && r.broadcast.status === 'DONE' && fake.state.multicasts.length === b2 + 1, 'ส่งถึง LINE แล้วแต่คำตอบหาย → ลองใหม่ได้ 409 → ไม่ส่งซ้ำ สถานะครบ', r.broadcast);

      // ---- รหัส OA หมดอายุ ----
      fake.oa.multicast = async () => { throw new OaError(401, 'Authentication failed'); };
      const nB3 = (await call('adminAudience', { filter: { branches: ['B03'] } })).sendable;
      r = await call('adminBroadcastSend', { filter: { branches: ['B03'] }, draft, expect: nB3 });
      fake.oa.multicast = orig;
      ok(r.ok && r.broadcast.status === 'FAILED' && r.broadcast.sent === 0 && r.broadcast.error === 'OA_TOKEN' && r.broadcast.canResume, 'รหัส OA ใช้ไม่ได้ → "ไม่สำเร็จ" ส่งต่อได้หลังแก้รหัส', r.broadcast);
      const failedId = r.broadcast.id;
      fake.state.failAll = 401;
      r = await call('adminBroadcastInfo', {});
      ok(r.ok && r.connected === false && r.problem === 'OA_TOKEN' && /ผู้ดูแลระบบ/.test(r.problemText), 'หน้าส่งข้อความบอกว่าการเชื่อม OA มีปัญหา', r);
      fake.state.failAll = null;
      r = await call('adminBroadcastResume', { id: failedId });
      ok(r.ok && r.broadcast.status === 'DONE' && r.broadcast.sent === nB3, 'แก้รหัสแล้วกด "ส่งต่อ" → ส่งครบ');

      // ---- เครื่องหยุดกลางทาง (สถานะ "กำลังส่ง" ค้าง) ----
      await db.query(`insert into broadcasts (shop_id, id, request_id, created_by, message_text, recipients, total, status, updated_at)
        values ('demo', 'BC-STUCK001', 'stuck-request-1', 'U_DEMO_OWNER', 'ค้าง', array['DM-000001', 'DM-000002'], 2, 'SENDING', now() - interval '5 minutes'),
               ('demo', 'BC-BUSY0001', 'busy-request-1', 'U_DEMO_OWNER', 'กำลังส่ง', array['DM-000003'], 1, 'SENDING', now())`);
      r = await call('adminBroadcastInfo', {});
      const stuck = r.history.find((x) => x.id === 'BC-STUCK001');
      const busy = r.history.find((x) => x.id === 'BC-BUSY0001');
      ok(stuck && stuck.status === 'STALLED' && stuck.canResume && busy && busy.status === 'SENDING' && !busy.canResume, 'ค้างเกิน 90 วินาที = "หยุดกลางทาง" ส่งต่อได้ / เพิ่งเริ่ม = กำลังส่ง', { stuck, busy });
      r = await call('adminBroadcastResume', { id: 'BC-BUSY0001' });
      ok(!r.ok && r.code === 'BUSY', 'กด "ส่งต่อ" อันที่กำลังส่งอยู่ → รอก่อน (กันส่งพร้อมกันสองที่)', r);
      r = await call('adminBroadcastResume', { id: 'BC-STUCK001' });
      ok(r.ok && r.broadcast.status === 'DONE', 'ส่งต่ออันที่หยุดกลางทางได้');
      r = await call('adminBroadcastResume', { id: 'BC-NOPE0001' });
      ok(!r.ok && r.code === 'NOT_FOUND', 'ส่งต่อรหัสที่ไม่มี → NOT_FOUND');
      r = await call('adminBroadcastResume', { id: "x'; drop table broadcasts;--" });
      ok(!r.ok && r.code === 'NOT_FOUND', 'รหัสแปลกๆ → NOT_FOUND');

      // ---- ประวัติ ----
      r = await call('adminBroadcastInfo', {});
      ok(r.ok && r.history.length === 6 && r.history.every((x, i, a) => i === 0 || a[i - 1].createdAt >= x.createdAt) && r.history.some((x) => x.text === 'รอบสาม'),
        'ประวัติการส่ง ล่าสุดก่อน', r.history.map((x) => x.id + ':' + x.status));
      ok(!/U_DEMO_\d|recipients/.test(JSON.stringify(r)), 'ประวัติไม่มีรายชื่อผู้รับ / LINE ID');

      // ---- รูปริชเมสเสจ: หน้าเว็บย่อเป็น 5 ขนาดมาให้ ตัวกลางตรวจขนาดจากหัวไฟล์จริง ----
      const { RICH_WIDTHS, imageSize } = require(path.join(ROOT, 'api', '_lib', 'broadcast.js'));
      // หัวไฟล์ JPG / PNG ที่บอกขนาด (ตัวกลางอ่านแค่ส่วนหัว ไม่ต้องเป็นรูปเต็ม)
      const jpg = (w, h) => Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xDB, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xFF, 0xD9]);
      const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
      const sizes = (H, mk = jpg) => Object.fromEntries(RICH_WIDTHS.map((w) => [w, mk(w, Math.round(w * H / 1040)).toString('base64')]));
      ok(JSON.stringify(imageSize(jpg(700, 525))) === JSON.stringify({ mime: 'image/jpeg', h: 525, w: 700 }) && imageSize(png(240, 180)).w === 240 &&
        imageSize(Buffer.from('hello world, not an image')) === null, 'อ่านขนาดรูปจากหัวไฟล์ JPG / PNG ได้ / ไฟล์อื่น = ไม่ใช่รูป');
      uploaded.length = 0;
      r = await call('adminUploadRichImage', { images: sizes(1040) });
      ok(r.ok && /^https:\/\/storage\.test\/.+\/images\/demo\/rich-\d{4}-\d{2}-\d{2}-[A-Z0-9]{6}$/.test(r.image) && r.height === 1040, 'อัปรูปริชเมสเสจ → ได้ลิงก์ฐาน (ไม่มีนามสกุล) + ความสูง', r);
      ok(uploaded.length === 5 && uploaded.every((u, i) => u.p === r.image.split('/images/')[1] + '/' + RICH_WIDTHS[i] && u.mime === 'image/jpeg'),
        'เก็บครบ 5 ขนาด ที่ <ลิงก์ฐาน>/1040 … /240 (รูปแบบที่ LINE เรียก)', uploaded.map((u) => u.p));
      const richImg = r.image;
      r = await call('adminUploadRichImage', { images: sizes(780, png) });
      ok(r.ok && r.height === 780 && uploaded.slice(5).every((u) => u.mime === 'image/png'), 'รูป PNG แนวนอน 4:3 ได้ (เก็บเป็น PNG)', r);
      const badUploads = [
        ['ขาดไป 1 ขนาด', (() => { const x = sizes(1040); delete x[300]; return x; })(), ''],
        ['ขนาดสลับช่อง (ช่อง 700 เป็นรูปกว้าง 1040)', Object.assign(sizes(1040), { 700: jpg(1040, 1040).toString('base64') }), ''],
        ['กว้างเกิน 2:1', sizes(500), '2:1'],
        ['สูงเกิน 2:3', sizes(1600), '2:3'],
        ['แต่ละขนาดสัดส่วนไม่ตรงกัน', Object.assign(sizes(780), { 460: jpg(460, 460).toString('base64') }), ''],
        ['ไม่ใช่รูป', Object.assign(sizes(1040), { 240: Buffer.from('hello world').toString('base64') }), ''],
        ['WebP (LINE ไม่รับ)', Object.assign(sizes(1040), { 1040: Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary').toString('base64') }), ''],
        ['ไฟล์ใหญ่เกิน 1MB', Object.assign(sizes(1040), { 1040: Buffer.concat([jpg(1040, 1040), Buffer.alloc(1024 * 1024)]).toString('base64') }), 'ใหญ่']
      ];
      const nUp = uploaded.length;
      for (const [label, images, word] of badUploads) {
        r = await call('adminUploadRichImage', { images });
        ok(!r.ok && r.code === 'BAD_IMAGE' && (!word || r.error.includes(word)), `อัปรูป: ${label} → ไม่รับ`, r);
      }
      ok(uploaded.length === nUp, 'รูปที่ไม่ผ่าน → ไม่มีไฟล์ถูกเก็บ');

      // ส่งจริงพร้อมรูป: จดข้อความทั้งก้อนไว้ → "ส่งต่อ" ได้ก้อนเดิมทุกตัวอักษร แม้ร้านเปลี่ยนชื่อระหว่างนั้น
      const nB4 = (await call('adminAudience', { filter: { branches: ['B04'] } })).sendable;
      const b4 = fake.state.multicasts.length;
      fake.oa.multicast = async () => { throw new OaError(400, 'Bad request'); };
      r = await call('adminBroadcastSend', { filter: { branches: ['B04'] }, draft: { image: richImg, imageHeight: 1040 }, expect: nB4 });
      fake.oa.multicast = orig;
      ok(r.ok && r.broadcast.status === 'FAILED' && r.broadcast.error === 'OA_REJECTED' && r.broadcast.image === richImg, 'LINE ไม่รับ → "ไม่สำเร็จ" ประวัติรู้ว่ามีรูป', r.broadcast);
      const richRow = (await db.query(`select messages from broadcasts where id = $1`, [r.broadcast.id])).rows[0];
      ok(richRow && Array.isArray(richRow.messages) && richRow.messages.length === 1 && richRow.messages[0].type === 'imagemap' &&
        richRow.messages[0].altText === 'ข้อความจาก ' + demoShop.name, 'จดข้อความที่ส่งจริงทั้งก้อน (ริชเมสเสจ)', richRow);
      await db.query(`update shops set name = 'ชื่อใหม่' where id = 'demo'`);
      r = await call('adminBroadcastResume', { id: r.broadcast.id });
      await db.query(`update shops set name = $1 where id = 'demo'`, [demoShop.name]);
      const sentRich = fake.state.multicasts.slice(b4);
      ok(r.ok && r.broadcast.status === 'DONE' && r.broadcast.sent === nB4 && sentRich.length === 1 &&
        JSON.stringify(sentRich[0].messages) === JSON.stringify(richRow.messages), 'กด "ส่งต่อ" → ส่งก้อนเดิมทุกตัวอักษร (ไม่สร้างใหม่จากชื่อร้านล่าสุด)', sentRich.map((m) => m.messages));

      // ประวัติก่อนมีริชเมสเสจ (ไม่มีช่อง messages) → ส่งต่อด้วยรูปธรรมดา + ข้อความแบบเดิม
      await db.query(`insert into broadcasts (shop_id, id, request_id, created_by, message_text, message_image, recipients, total, status)
        values ('demo', 'BC-LEGACY01', 'legacy-request-1', 'U_DEMO_OWNER', 'เก่า', 'https://storage.test/old.jpg', array['DM-000004'], 1, 'FAILED')`);
      const bL = fake.state.multicasts.length;
      r = await call('adminBroadcastResume', { id: 'BC-LEGACY01' });
      const legacy = fake.state.multicasts.slice(bL).map((m) => m.messages);
      ok(r.ok && r.broadcast.status === 'DONE' && legacy.every((ms) => ms.length === 2 && ms[0].type === 'image' && ms[0].originalContentUrl === 'https://storage.test/old.jpg' &&
        ms[1].text === 'เก่า'), 'ประวัติเก่า (รูปธรรมดา) ส่งต่อได้แบบเดิม', legacy);

      // ---- ใครใช้ได้ ----
      for (const a of ['adminBroadcastInfo', 'adminBroadcastTest', 'adminBroadcastSend', 'adminBroadcastResume', 'adminUploadRichImage']) {
        r = await call(a, { draft, filter: {}, expect: 1, id: 'BC-STUCK001', images: {} }, 'TEST:U_DEMO_ADMIN:ผู้จัดการ');
        ok(!r.ok && r.code === 'NO_ROLE', `${a}: ผู้จัดการใช้ไม่ได้`, r);
      }
    } finally {
      console.log = log;
      console.error = err;
    }
  }

  console.log('\n[5.9] ส่งข้อความ รอบ 3: เพิ่มเพื่อน LINE OA ก่อนสมัคร + ช่องยินยอมติ๊กไว้ให้ + แต้มรับข่าวสาร + จำนวนที่ได้รับจริง');
  {
    const { createFakeOa } = require('./fake-oa');
    const F = require(path.join(ROOT, 'api', '_lib', 'oafriend.js'));
    const fake = createFakeOa({ limit: null, friends: new Set() }); // ยังไม่มีใครเป็นเพื่อน
    let oaOn = true;
    const ra = createApp({ db: () => db, verifier: createVerifier({ fetch: fakeLine().fetch }), allowTestTokens: true, region: 'test',
      oa: (shop) => (oaOn && shop === 'demo' ? fake.oa : null) });
    const call = (action, body, user) => ra.handle(Object.assign({ action, shop: 'demo', idToken: `TEST:${user}:ลูกค้า ${user}`, requestId: crypto.randomUUID() }, body));
    const reg = (user, phone, extra) => call('register', Object.assign({ consentPrivacy: true, firstName: 'มานี', lastName: 'มีนา', birthDate: '1991-02-03', phone }, extra), user);
    const mem = async (user) => (await db.query(`select id, points, marketing_consent, consent_preticked, consent_bonus_at, oa_friend, oa_friend_at from members where shop_id = 'demo' and line_user_id = $1`, [user])).rows[0];
    const shop0 = (await db.query(`select require_oa_friend, consent_preticked, consent_bonus_points, welcome_points from shops where id = 'demo'`)).rows[0];
    ok(shop0.require_oa_friend === true && shop0.consent_preticked === true && shop0.consent_bonus_points === 0,
      'ค่าเริ่มต้นร้าน (ผู้ใช้เลือก): บังคับเพิ่มเพื่อนก่อนสมัคร เปิด / ติ๊กยินยอมไว้ให้ เปิด / แต้มรับข่าวสาร 0', shop0);
    const err = console.error; console.error = () => {};
    const log = console.log; console.log = (...a) => { if (/^  [✓✗]/.test(String(a[0]))) log(...a); };
    try {
      // ---- ยังไม่เป็นเพื่อน → หน้าสมัครบอกให้เพิ่มเพื่อนก่อน ----
      F._infoCache.clear();
      r = await call('bootstrap', {}, 'U_R3_A');
      ok(r.ok && !r.member && r.oa && r.oa.friend === false && r.oa.required === true && r.oa.addUrl === 'https://line.me/R/ti/p/%40demo-oa',
        'ยังไม่เป็นเพื่อน → ต้องเพิ่มเพื่อนก่อน + ลิงก์เพิ่มเพื่อน @ไอดีของ OA', r.oa);
      ok(r.signup && r.signup.preticked === true && r.signup.bonusPoints === 0 && r.signup.bonusAvailable === true, 'หน้าสมัครรู้ว่าติ๊กยินยอมไว้ให้ + แต้มรับข่าวสาร', r.signup);
      r = await reg('U_R3_A', '0861230001', { consentMarketing: true });
      ok(!r.ok && r.code === 'NOT_FRIEND' && !(await mem('U_R3_A')), 'ข้ามหน้าเพิ่มเพื่อนแล้วสมัครตรง → ตัวกลางไม่ให้สมัคร', r);
      // ร้านปิดสวิตช์ → สมัครได้แม้ไม่เป็นเพื่อน
      await db.query(`update shops set require_oa_friend = false where id = 'demo'`);
      r = await call('bootstrap', {}, 'U_R3_B');
      ok(r.ok && r.oa.friend === false && r.oa.required === false, 'ร้านปิด "บังคับเพิ่มเพื่อน" → ไม่ต้องเพิ่มเพื่อนก่อน');
      r = await reg('U_R3_B', '0861230002', { consentMarketing: false });
      let m = await mem('U_R3_B');
      ok(r.ok && m.oa_friend === false && m.oa_friend_at && m.marketing_consent === false && m.consent_preticked === true,
        'สมัครได้ + จดว่ายังไม่เป็นเพื่อน + จดว่าสมัครตอนช่องยินยอมถูกติ๊กไว้ให้ (ลูกค้าเอาติ๊กออก)', m);
      await db.query(`update shops set require_oa_friend = true where id = 'demo'`);

      // ---- เพิ่มเพื่อนแล้ว → สมัครได้ + แต้มรับข่าวสาร ----
      await db.query(`update shops set consent_bonus_points = 20 where id = 'demo'`);
      fake.state.friends.add('U_R3_A');
      r = await call('bootstrap', {}, 'U_R3_A');
      ok(r.ok && r.oa.friend === true && r.oa.addUrl === '' && r.signup.bonusPoints === 20, 'เพิ่มเพื่อนแล้ว → ไปหน้าสมัครได้ (เห็นแต้มรับข่าวสาร 20)', r.oa);
      r = await reg('U_R3_A', '0861230001', { consentMarketing: true });
      m = await mem('U_R3_A');
      const w = shop0.welcome_points;
      ok(r.ok && r.consentBonus === 20 && r.welcomePoints === w && r.member.points === w + 20 && m.points === w + 20 && m.consent_bonus_at && m.oa_friend === true,
        `สมัคร + ยินยอม → แต้มต้อนรับ ${w} + แต้มรับข่าวสาร 20 / จดว่าเป็นเพื่อน`, { r, m });
      const txs = (await db.query(`select type, points, balance_after from transactions where shop_id = 'demo' and member_id = $1 order by created_at`, [m.id])).rows;
      ok(txs.length === (w > 0 ? 2 : 1) && txs[txs.length - 1].type === 'CONSENT' && txs[txs.length - 1].points === 20 && txs[txs.length - 1].balance_after === w + 20,
        'ประวัติแต้ม: รายการ "รับข่าวสาร" ต่อจากแต้มต้อนรับ ยอดคงเหลือต่อกัน', txs);
      r = await call('bootstrap', {}, 'U_R3_A');
      ok(r.ok && r.history[0].type === 'CONSENT' && r.signup.bonusAvailable === false && r.oa.friend === true && !r.oa.required, 'เปิดบัตร: เห็นรายการรับข่าวสาร / ได้แต้มแล้ว (ไม่ชวนซ้ำ)', r.history[0]);

      // ---- ปิดแล้วเปิดรับข่าวสารใหม่ → ไม่ได้แต้มซ้ำ / คนที่เพิ่งเปิดครั้งแรก → ได้ ----
      const profile = { firstName: 'มานี', lastName: 'มีนา', birthDate: '1991-02-03' };
      await call('updateProfile', Object.assign({ phone: '0861230001', consentMarketing: false }, profile), 'U_R3_A');
      r = await call('updateProfile', Object.assign({ phone: '0861230001', consentMarketing: true }, profile), 'U_R3_A');
      ok(r.ok && !r.consentBonus && (await mem('U_R3_A')).points === w + 20, 'ยกเลิกแล้วเปิดใหม่ → ไม่ได้แต้มซ้ำ', r);
      r = await call('updateProfile', Object.assign({ phone: '0861230002', consentMarketing: true }, profile), 'U_R3_B');
      m = await mem('U_R3_B');
      ok(r.ok && r.consentBonus === 20 && r.member.points === w + 20 && m.consent_bonus_at, 'สมัครโดยไม่ยินยอม แล้วมาเปิดทีหลัง → ได้แต้มรับข่าวสาร 1 ครั้ง', r);
      r = await call('updateProfile', Object.assign({ phone: '0861230002', consentMarketing: true }, profile), 'U_R3_B');
      ok(r.ok && !r.consentBonus && r.changed === 0, 'บันทึกซ้ำ (เปิดอยู่แล้ว) → ไม่ได้เพิ่ม');
      const chk = (await db.query(`select count(*)::int n from members m where shop_id = 'demo' and points <> coalesce((select sum(points) from transactions t where t.shop_id = 'demo' and t.member_id = m.id), 0)`)).rows[0].n;
      ok(chk === 0, 'แต้มในบัตรตรงกับผลรวมประวัติทุกคน (ไฟล์ตรวจแต้มไม่ฟ้อง)');

      // ---- สถานะเพื่อนอัปเดตตอนเปิดบัตร (บล็อก → ปุ่มเพิ่มเพื่อน / เป็นเพื่อนแล้วไม่ถาม LINE ซ้ำภายใน 1 วัน) ----
      const calls0 = fake.state.calls;
      await call('bootstrap', {}, 'U_R3_A');
      ok(fake.state.calls === calls0, 'เป็นเพื่อนอยู่ + เช็กไม่เกิน 1 วัน → ไม่ถาม LINE ซ้ำ (เปิดบัตรเร็วเท่าเดิม)');
      fake.state.friends.delete('U_R3_A');
      await db.query(`update members set oa_friend_at = now() - interval '2 days' where shop_id = 'demo' and line_user_id = 'U_R3_A'`);
      r = await call('bootstrap', {}, 'U_R3_A');
      ok(r.ok && r.oa.friend === false && r.oa.addUrl && !r.oa.required && (await mem('U_R3_A')).oa_friend === false, 'บล็อก OA (เช็กครบรอบ) → บัตรมีปุ่มเพิ่มเพื่อน + จดว่าไม่เป็นเพื่อน', r.oa);
      fake.state.failAll = 500;
      r = await call('bootstrap', {}, 'U_R3_C');
      ok(r.ok && r.oa.friend === null && !r.member, 'LINE ตอบไม่ได้ → ไม่รู้สถานะ (หน้าเว็บไม่ปิดกั้นการสมัคร)', r.oa);
      r = await reg('U_R3_C', '0861230003', { consentMarketing: true });
      fake.state.failAll = null;
      ok(r.ok && (await mem('U_R3_C')).oa_friend === null, 'LINE ตอบไม่ได้ตอนสมัคร → สมัครได้ (สถานะว่างไว้)', r);
      oaOn = false;
      r = await call('bootstrap', {}, 'U_R3_D');
      ok(r.ok && !('oa' in r) && r.signup, 'ร้านที่ไม่ได้เชื่อม OA → ไม่มีเรื่องเพิ่มเพื่อน (สมัครได้ตามปกติ)', r.oa);
      oaOn = true;

      // ---- หน้าส่งข้อความ: ได้รับจริง / ไม่เป็นเพื่อน / ยังไม่รู้ ----
      const OW = 'TEST:U_DEMO_OWNER:เจ้าของ';
      const owner = (action, body) => ra.handle(Object.assign({ action, shop: 'demo', idToken: OW, requestId: crypto.randomUUID() }, body));
      const f = { joinedDays: 1 }; // เฉพาะคนที่เพิ่งสมัครในชุดนี้
      r = await owner('adminAudience', { filter: f });
      const exp = (await db.query(`select count(*) filter (where oa_friend)::int y, count(*) filter (where oa_friend = false)::int n, count(*)::int t
        from members where shop_id = 'demo' and joined_at > now() - interval '1 day' and status = 'ACTIVE' and marketing_consent and line_user_id is not null`)).rows[0];
      ok(r.ok && r.reach && r.reach.friend === exp.y && r.reach.notFriend === exp.n && r.reach.unknown === exp.t - exp.y - exp.n && r.sendable === exp.t && exp.n > 0,
        `คัดกลุ่ม: ส่งได้ ${exp.t} = ได้รับจริง ${exp.y} + ไม่เป็นเพื่อน ${exp.n} + ยังไม่รู้ ${exp.t - exp.y - exp.n}`, r.reach);
      // โควตาเหลือพอสำหรับคนที่อาจได้รับ (ไม่นับคนที่รู้แน่ว่าไม่เป็นเพื่อน) → ส่งได้
      fake.state.limit = fake.state.used + (exp.t - exp.n);
      r = await owner('adminBroadcastSend', { filter: f, draft: { text: 'โปรเฉพาะสมาชิกใหม่' }, expect: exp.t });
      ok(r.ok && r.broadcast.status === 'DONE' && r.broadcast.sent === exp.t, 'โควตาพอสำหรับคนที่อาจได้รับ → ส่งได้ (ยังส่งให้ทุกคนที่ส่งได้ LINE ตัดสินเอง)', r);
      fake.state.limit = fake.state.used + (exp.t - exp.n) - 1;
      r = await owner('adminBroadcastSend', { filter: f, draft: { text: 'อีกรอบ' }, expect: exp.t });
      ok(!r.ok && r.code === 'QUOTA_NOT_ENOUGH' && r.error.includes(U.fmtNum(exp.t - exp.n)), 'โควตาขาด 1 → ไม่ส่ง (บอกจำนวนที่ต้องใช้จริง)', r);
      fake.state.limit = null;

      // ---- ตั้งค่าร้าน 3 ข้อใหม่ (เจ้าของร้านเท่านั้น) ----
      r = await owner('adminSettings', {});
      const val = (k) => (r.items.find((x) => x.key === k) || {}).value;
      ok(r.ok && val('REQUIRE_OA_FRIEND') === 'ON' && val('CONSENT_PRETICKED') === 'ON' && val('CONSENT_BONUS_POINTS') === '20', 'หน้าตั้งค่าร้านเห็น 3 ข้อใหม่', r.items && r.items.slice(-3));
      r = await owner('adminSettingsSave', { values: { REQUIRE_OA_FRIEND: 'OFF', CONSENT_PRETICKED: 'OFF', CONSENT_BONUS_POINTS: '0' } });
      const s1 = (await db.query(`select require_oa_friend, consent_preticked, consent_bonus_points from shops where id = 'demo'`)).rows[0];
      ok(r.ok && r.changed === 3 && s1.require_oa_friend === false && s1.consent_preticked === false && s1.consent_bonus_points === 0, 'เจ้าของร้านปิดทั้งหมดได้', s1);
      r = await call('bootstrap', {}, 'U_R3_D');
      ok(r.ok && r.signup.preticked === false && r.signup.bonusPoints === 0 && r.oa.required === false, 'ปิดแล้ว → หน้าสมัครไม่ติ๊กไว้ให้ ไม่บังคับเพิ่มเพื่อน');
      r = await owner('adminSettingsSave', { values: { REQUIRE_OA_FRIEND: 'maybe' } });
      ok(!r.ok && r.code === 'BAD_INPUT', 'ค่าที่ไม่ใช่ เปิด/ปิด → ไม่รับ', r);
      r = await ra.handle({ action: 'adminSettingsSave', shop: 'demo', idToken: 'TEST:U_DEMO_ADMIN:ผู้จัดการ', values: { CONSENT_PRETICKED: 'ON' } });
      ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการแก้ไม่ได้', r);
      await db.query(`update shops set require_oa_friend = true, consent_preticked = true, consent_bonus_points = 0 where id = 'demo'`);
    } finally {
      console.log = log;
      console.error = err;
    }
  }

  console.log('\n[5.10] ตัวกลางตรวจแพ็กเกจของร้าน (features ใน shops/<ร้าน>/config.js — ไม่เชื่อแค่การซ่อนปุ่มในหน้าเว็บ)');
  {
    const Fx = require(path.join(ROOT, 'api', '_lib', 'features.js'));
    const { ACTIONS } = require(path.join(ROOT, 'api', '_lib', 'router.js'));
    const { createFakeOa } = require('./fake-oa');
    const err = console.error, warn = console.warn;
    let errs = [];
    console.error = (...a) => errs.push(a.join(' '));
    console.warn = () => {};
    try {
      // อ่านไฟล์ร้านจริง (ไฟล์เดียวกับที่หน้าเว็บใช้)
      const demoF = await Fx.loadFeatures('demo');
      ok(demoF.tiers && demoF.branches && demoF.export && demoF.broadcast && demoF.maxBranches === null, 'อ่านไฟล์ร้าน demo จริง: เปิดครบ 4 แพ็กเกจ ไม่จำกัดสาขา', demoF);
      const shopIds = [...fs.readFileSync(path.join(ROOT, 'shops', 'shops.js'), 'utf8').matchAll(/id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
      errs = [];
      for (const id of shopIds) await Fx.loadFeatures(id);
      ok(shopIds.length >= 2 && errs.length === 0, 'ทุกร้านใน shops.js (' + shopIds.join(', ') + ') อ่านแพ็กเกจได้ ไม่มี error', errs);
      errs = [];
      const missing = await Fx.loadFeatures('nosuch-shop');
      ok(KEYS_OFF(missing) && errs.length === 1 && /ไม่พบ/.test(errs[0]), 'ไม่มีไฟล์ร้าน → ปิดทุกแพ็กเกจ + เขียนสาเหตุลง log', errs);
      ok(KEYS_OFF(await Fx.loadFeatures('../demo')) && KEYS_OFF(await Fx.loadFeatures('')), 'รหัสร้านแปลก (../demo, ว่าง) → ปิดทุกแพ็กเกจ ไม่อ่านไฟล์นอกโฟลเดอร์ร้าน');
      const n1 = Fx.normalize({ tiers: 'true', branches: 1, export: true, broadcast: null, maxBranches: 3 });
      ok(!n1.tiers && !n1.branches && n1.export && !n1.broadcast && n1.maxBranches === null, 'ต้องเป็น true เท่านั้นถึงเปิด (เหมือนหน้าเว็บ) / ปิดสาขาแล้วไม่สนเพดาน', n1);
      ok(Fx.normalize({ branches: true, maxBranches: 2 }).maxBranches === 2 && Fx.normalize({ branches: true, maxBranches: 2.5 }).maxBranches === null &&
        Fx.normalize({ branches: true, maxBranches: 0 }).maxBranches === null && Fx.normalize(null).tiers === false, 'เพดานสาขา: จำนวนเต็ม > 0 เท่านั้น (นอกนั้น = ไม่จำกัด)');
      // ตัวกลางอ่านไฟล์เป็นข้อความ (ไม่รันโค้ด) → ต้องได้ค่าเท่ากับที่หน้าเว็บได้จากการเปิดไฟล์จริง ทุกร้าน
      const parity = [];
      for (const id of shopIds) {
        const text = fs.readFileSync(path.join(ROOT, 'shops', id, 'config.js'), 'utf8');
        const real = (await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(text))).default.features;
        parity.push([id, JSON.stringify(Fx.normalize(real)) === JSON.stringify(Fx.normalize(Fx.parseFeatures(text)))]);
      }
      ok(parity.every((x) => x[1]), 'อ่านแบบข้อความได้แพ็กเกจตรงกับหน้าเว็บทุกร้าน', parity);
      const sample = "export default {\n  name: 'ร้าน // ไม่ใช่คอมเมนต์',\n  privacyUrl: 'https://x.test/a',\n  // features: { tiers: true },\n" +
        "  features: {\n    tiers: false,      // คอมเมนต์ท้ายบรรทัด\n    /* broadcast: true, */\n    branches: true, maxBranches: 4,\n    export: true,\n    broadcast: someVar\n  },\n  legal: { x: 1 }\n};\n";
      const ps = Fx.normalize(Fx.parseFeatures(sample));
      ok(!ps.tiers && ps.branches && ps.maxBranches === 4 && ps.export && !ps.broadcast, 'ตัวแยกข้อความ: ข้ามคอมเมนต์ / ลิงก์ https:// ไม่โดนตัด / ค่าที่ไม่ใช่ตัวตรง (ตัวแปร) = ปิด', ps);
      ok(KEYS_OFF(Fx.normalize(Fx.parseFeatures("export default { name: 'x' };"))), 'ไม่มีส่วน features = ปิดหมด (เหมือนหน้าเว็บ)');
      ok(Fx.shopFileCount() === shopIds.length, 'ping นับไฟล์ร้านที่ตัวกลางเห็นได้ (' + Fx.shopFileCount() + ')');
      const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
      ok(vj.functions && vj.functions['api/index.js'] && vj.functions['api/index.js'].includeFiles === 'shops/**', 'vercel.json แนบโฟลเดอร์ shops/ ไปกับตัวกลาง (ไม่แนบ = ทุกร้านถูกปิดทุกแพ็กเกจบน Vercel)');

      // ตัวกลางที่เปลี่ยนแพ็กเกจได้ระหว่างทดสอบ
      let pkg = Fx.normalize({});
      const fake = createFakeOa({ limit: null });
      const pa = createApp({ db: () => db, verifier: createVerifier({ fetch: fakeLine().fetch }), allowTestTokens: true, region: 'test',
        oa: (shop) => (shop === 'demo' ? fake.oa : null), features: async () => pkg });
      const OW = 'TEST:U_DEMO_OWNER:เจ้าของ';
      const call = (action, body, tok) => pa.handle(Object.assign({ action, shop: 'demo', idToken: tok || OW, requestId: crypto.randomUUID() }, body));
      const DASH = { from: U.thaiDay(new Date(Date.now() - 29 * U.DAY_MS)), to: U.thaiDay(new Date()) }; // ภาพรวม 30 วันล่าสุด
      const gated = Object.keys(ACTIONS).filter((a) => ACTIONS[a].feature);
      const byFeature = {};
      gated.forEach((a) => { (byFeature[ACTIONS[a].feature] = byFeature[ACTIONS[a].feature] || []).push(a); });
      ok(gated.length === 11 && Object.keys(byFeature).sort().join() === 'branches,broadcast,export,tiers', 'ตารางคำสั่ง: 11 คำสั่งผูกกับ 4 แพ็กเกจ', byFeature);
      ok(gated.every((a) => ACTIONS[a].roles && ACTIONS[a].roles.indexOf('CASHIER') < 0), 'คำสั่งของแพ็กเกจเป็นของเจ้าของร้าน/ผู้จัดการเท่านั้น');

      // ปิดทุกแพ็กเกจ → ทุกคำสั่งของแพ็กเกจไม่ยอม (เจ้าของร้านก็ไม่ได้)
      const offRes = [];
      for (const a of gated) offRes.push([a, (await call(a, {})).code]);
      ok(offRes.every((x) => x[1] === 'NOT_IN_PACKAGE'), 'ปิดทุกแพ็กเกจ → เจ้าของร้านเรียกทั้ง 11 คำสั่งตรงๆ ได้ NOT_IN_PACKAGE', offRes.filter((x) => x[1] !== 'NOT_IN_PACKAGE'));
      r = await call('adminExport', {});
      ok(!r.ok && /ยังไม่ได้เปิดใช้ฟีเจอร์นี้/.test(r.error), 'ข้อความที่เห็น: "ร้านนี้ยังไม่ได้เปิดใช้ฟีเจอร์นี้ กรุณาติดต่อผู้ดูแลระบบ"', r);
      r = await call('adminExport', {}, 'TEST:U_NOT_STAFF:คนนอก');
      ok(!r.ok && r.code !== 'NOT_IN_PACKAGE', 'คนที่ไม่ใช่พนักงาน → ถูกปฏิเสธที่บทบาทก่อน (ไม่รู้ว่าร้านซื้อแพ็กเกจอะไร)', r);
      r = await call('adminMembers', {});
      const r2 = await call('adminBranches', {});
      ok(r.ok && r2.ok, 'คำสั่งที่ไม่ใช่ของแพ็กเกจ (รายชื่อสมาชิก / อ่านรายชื่อสาขา) ใช้ได้ตามปกติ');
      r = await call('adminDashboard', DASH);
      ok(r.ok && Array.isArray(r.byBranch) && r.byBranch.length === 0, 'ปิดแพ็กเกจหลายสาขา → ภาพรวมไม่มีตารางเทียบสาขา', r.byBranch);

      // เปิดทีละแพ็กเกจ → เปิดเฉพาะคำสั่งของแพ็กเกจนั้น
      for (const key of Object.keys(byFeature)) {
        pkg = Fx.normalize({ [key]: true });
        const res = [];
        for (const a of gated) res.push([a, ACTIONS[a].feature === key, (await call(a, {})).code]);
        ok(res.every(([, mine, code]) => (code === 'NOT_IN_PACKAGE') === !mine), 'เปิดเฉพาะ ' + key + ' → คำสั่งของ ' + key + ' ผ่านด่านแพ็กเกจ ที่เหลือยังไม่ยอม',
          res.filter(([, mine, code]) => (code === 'NOT_IN_PACKAGE') === mine));
      }
      pkg = Fx.normalize({ export: true });
      r = await call('adminExport', { kind: 'members' });
      ok(r.ok, 'เปิดส่งออก Excel → ส่งออกได้จริง', r.code);
      pkg = Fx.normalize({ tiers: true });
      r = await call('adminTiers', {});
      ok(r.ok, 'เปิดระดับสมาชิก → อ่านหน้าระดับได้จริง', r.code);
      pkg = Fx.normalize({ branches: true });
      r = await call('adminDashboard', DASH);
      ok(r.ok && r.byBranch.length > 0, 'เปิดหลายสาขา → ภาพรวมมีตารางเทียบสาขา', r.byBranch && r.byBranch.length);

      // หน้าเพิ่มเพื่อน OA (คำสั่งลูกค้า) ไปกับแพ็กเกจส่งข้อความ — มีรหัส OA อยู่ก็ตาม
      pkg = Fx.normalize({ broadcast: false });
      r = await call('bootstrap', {}, 'TEST:U_PKG_NEW:ลูกค้าใหม่');
      ok(r.ok && r.oa === undefined, 'ปิดแพ็กเกจส่งข้อความ (รหัส OA ยังอยู่) → หน้าลูกค้าไม่มีหน้าเพิ่มเพื่อน OA / การ์ดเพิ่มเพื่อน', r.oa);
      r = await call('adminBroadcastInfo', {});
      ok(!r.ok && r.code === 'NOT_IN_PACKAGE', 'ปิดแพ็กเกจส่งข้อความ → หน้าส่งข้อความไม่ยอม (แม้มีรหัส OA)', r);
      pkg = Fx.normalize({ broadcast: true });
      r = await call('bootstrap', {}, 'TEST:U_PKG_NEW:ลูกค้าใหม่');
      ok(r.ok && r.oa && typeof r.oa.friend === 'boolean', 'เปิดแพ็กเกจส่งข้อความ → หน้าลูกค้าเช็กเพื่อน OA ตามเดิม', r.oa);
      r = await call('adminBroadcastInfo', {});
      ok(r.ok, 'เปิดแพ็กเกจส่งข้อความ → หน้าส่งข้อความใช้ได้', r.code);

      // เพดานสาขาตามแพ็กเกจ (นับเฉพาะสาขาที่เปิดอยู่ — เหมือนหน้าเว็บ)
      const branches = async () => (await db.query(`select id, name, status from branches where shop_id = 'demo' order by id`)).rows;
      const before = await branches();
      const open = before.filter((b) => b.status === 'ACTIVE');
      pkg = Fx.normalize({ branches: true, maxBranches: open.length });
      const save = (branch) => call('adminBranchSave', { branch });
      r = await save({ name: 'สาขาเกินแพ็กเกจ', status: 'ACTIVE' });
      ok(!r.ok && r.code === 'TOO_MANY' && r.error.indexOf('แพ็กเกจของร้านเปิดได้ ' + open.length + ' สาขา') === 0, 'สาขาครบเพดาน → เพิ่มสาขาที่เปิดอยู่ไม่ได้ (ข้อความเดียวกับหน้าเว็บ)', r);
      ok((await branches()).length === before.length, 'ไม่ยอม = ไม่มีสาขาใหม่ในฐานข้อมูล');
      r = await save({ name: 'สาขาเตรียมเปิด', status: 'INACTIVE' });
      const spare = r.branch && r.branch.id;
      ok(r.ok && spare, 'เพิ่มสาขาแบบปิดไว้ก่อนได้ (ไม่นับเพดาน)', r);
      r = await save({ id: spare, name: 'สาขาเตรียมเปิด', status: 'ACTIVE' });
      ok(!r.ok && r.code === 'TOO_MANY', 'เปิดสาขาที่ปิดไว้กลับมา = นับเป็นสาขาที่เปิดเพิ่ม → ไม่ยอม', r);
      r = await save({ id: open[0].id, name: open[0].name + ' (แก้ชื่อ)', status: 'ACTIVE' });
      ok(r.ok, 'แก้ชื่อสาขาที่เปิดอยู่แล้ว → ได้ (ไม่ได้เปิดเพิ่ม)', r);
      r = await save({ id: open[0].id, name: open[0].name, status: 'INACTIVE' });
      const r3 = await save({ id: spare, name: 'สาขาเตรียมเปิด', status: 'ACTIVE' });
      ok(r.ok && r3.ok, 'ปิดสาขาเก่า แล้วเปิดสาขาใหม่แทนได้', [r.code, r3.code]);
      const after = await branches();
      ok(after.filter((b) => b.status === 'ACTIVE').length === open.length, 'สาขาที่เปิดอยู่ไม่เกินเพดานตลอด (' + open.length + ')');
      pkg = Fx.normalize({ branches: true });
      r = await save({ name: 'สาขาไม่จำกัด', status: 'ACTIVE' });
      ok(r.ok, 'ไม่มีเพดาน (maxBranches ไม่ใส่) → เพิ่มสาขาได้', r.code);
      // คืนสาขาให้เหมือนเดิม (ชุดอื่นต่อจากนี้ไม่พึ่งสาขา แต่เก็บข้อมูลให้สะอาด)
      await db.query(`update branches set status = 'ACTIVE', name = $2 where shop_id = 'demo' and id = $1`, [open[0].id, open[0].name]);
      await db.query(`delete from branches where shop_id = 'demo' and not (id = any($1::text[]))`, [before.map((b) => b.id)]);
    } finally {
      console.error = err;
      console.warn = warn;
    }
  }

  console.log('\n[5.11] PDPA ขั้นที่ 2: ลบบัญชีสมาชิก (ลูกค้าลบเอง / เจ้าของร้านลบให้) + ยอมรับนโยบายฉบับใหม่');
  {
    const Mx = require(path.join(ROOT, 'api', '_lib', 'members.js'));
    const pa = createApp({ db: () => db, verifier: createVerifier({ fetch: fakeLine().fetch }), allowTestTokens: true, region: 'test' });
    const OW = 'TEST:U_DEMO_OWNER:เจ้าของ';
    const call = (action, body, tok) => pa.handle(Object.assign({ action, shop: 'demo', idToken: tok || OW, requestId: crypto.randomUUID() }, body));
    const cust = (user) => 'TEST:' + user + ':ลูกค้า ' + user;
    const row = async (id) => (await db.query(`select * from members where shop_id = 'demo' and id = $1`, [id])).rows[0];
    const pointsOk = async (id) => {
      const s = (await db.query(`select coalesce(sum(points), 0)::int as total from transactions where shop_id = 'demo' and member_id = $1`, [id])).rows[0].total;
      const last = (await db.query(`select balance_after from transactions where shop_id = 'demo' and member_id = $1 order by created_at desc, id desc limit 1`, [id])).rows[0];
      const m = await row(id);
      return m.points === s && (!last || last.balance_after === m.points);
    };
    const log = console.log; console.log = (...a) => { if (/^  [✓✗]/.test(String(a[0]))) log(...a); };
    const errLog = console.error; console.error = () => {};
    try {
      await db.query(`update shops set consent_bonus_points = 15 where id = 'demo'`);
      const reg = (user, phone) => call('register', { consentPrivacy: true, consentMarketing: true, firstName: 'ลบได้', lastName: 'ทดสอบสิทธิ์', birthDate: '1990-05-06', phone }, cust(user));
      r = await reg('U_PD_1', '0861234501');
      ok(r.ok && r.consentBonus === 15, 'สมัครพร้อมรับข่าวสาร → ได้แต้มรับข่าวสาร 15', r);
      const oldId = r.member.memberId;
      r = await call('addPurchase', { memberId: oldId, amount: 1000, branchId: 'B01' });
      ok(r.ok, 'มียอดซื้อ 1,000 บาท (ไว้ดูว่ายอดขายร้านไม่หายหลังลบ)', r.code);
      await db.query(`insert into coupons (shop_id, code, member_id, reward_id, name, points_used, issued_at, expires_at, status)
        select 'demo', 'CP-PDPA0001', $1, id, name, 0, now(), now() + interval '30 days', 'ACTIVE' from rewards where shop_id = 'demo' order by id limit 1`, [oldId]);
      const before = await row(oldId);
      ok(before.points > 0, 'ก่อนลบ: มีแต้ม ' + before.points + ' + คูปองที่ยังไม่ใช้ 1 ใบ');
      r = await call('bootstrap', {}, cust('U_PD_1'));
      ok(r.ok && r.privacy && r.privacy.canDelete === true && r.privacy.needAccept === false, 'หน้าลูกค้าได้ privacy: ลบบัญชีได้ / ไม่ต้องยอมรับนโยบายใหม่', r.privacy);

      // ---------- ลูกค้าลบเอง ----------
      r = await call('deleteAccount', {}, cust('U_PD_1'));
      ok(!r.ok && r.code === 'BAD_CONFIRM', 'ไม่พิมพ์ "ลบ" → ไม่ลบ', r);
      r = await call('deleteAccount', { confirm: 'ลบ' }, cust('U_PD_1'));
      ok(r.ok && r.deleted === true, 'พิมพ์ "ลบ" → ลบบัญชีสำเร็จ', r);
      const gone = await row(oldId);
      ok(gone.status === 'DELETED' && gone.line_user_id === null && gone.phone === null && gone.name === '' && gone.first_name === '' &&
        gone.last_name === '' && gone.birth_date === null && gone.picture === '' && gone.points === 0 && gone.marketing_consent === false && gone.deleted_at,
        'ข้อมูลส่วนตัวถูกลบจริงทุกช่อง (ชื่อ เบอร์ วันเกิด รูป LINE ID) + แต้ม 0', gone);
      ok(gone.line_hash === Mx.lineHash('demo', 'U_PD_1') && /^[0-9a-f]{64}$/.test(gone.line_hash) && gone.line_hash.indexOf('U_PD_1') < 0,
        'เก็บแค่รหัสแปลงของ LINE ID (ย้อนกลับไม่ได้)');
      ok(Number(gone.total_spend) === 1000 && gone.visit_count === 1, 'ยอดซื้อสะสมยังอยู่ (ภาพรวมของร้านไม่เพี้ยน)');
      const dtx = (await db.query(`select points, balance_after, detail from transactions where shop_id = 'demo' and member_id = $1 and type = 'DELETE'`, [oldId])).rows;
      ok(dtx.length === 1 && dtx[0].points === -before.points && dtx[0].balance_after === 0, 'แต้มเป็น 0 ด้วยรายการ "ลบบัญชี" 1 รายการ', dtx);
      ok(await pointsOk(oldId), 'ตรวจแต้ม (แบบ db/check_points.sql): ยอดในประวัติ = แต้มในบัตร = 0');
      const cp = (await db.query(`select status from coupons where shop_id = 'demo' and code = 'CP-PDPA0001'`)).rows[0];
      ok(cp.status === 'CANCELLED', 'คูปองที่ยังไม่ใช้ถูกยกเลิก');
      const plog = (await db.query(`select changed, by_name from profile_log where shop_id = 'demo' and member_id = $1 order by created_at desc limit 1`, [oldId])).rows[0];
      ok(plog && plog.changed === 'ลบบัญชี (ลูกค้าลบเอง)' && plog.by_name === 'ลูกค้า', 'ประวัติแก้ข้อมูลจด "ลบบัญชี (ลูกค้าลบเอง)" ไม่มีข้อมูลส่วนตัว', plog);
      const rl = (await db.query(`select count(*)::int as n from request_log where shop_id = 'demo' and (user_id = 'U_PD_1' or position($1 in result::text) > 0 or position('0861234501' in result::text) > 0)`,
        [JSON.stringify(oldId)])).rows[0].n;
      ok(rl === 0, 'คำตอบที่จำไว้กันกดซ้ำ (request_log) ที่มีข้อมูลคนนี้ถูกลบหมด (รวมของพนักงานที่บันทึกยอดให้)', rl);
      r = await call('deleteAccount', { confirm: 'ลบ' }, cust('U_PD_1'));
      ok(!r.ok && r.code === 'NOT_MEMBER', 'กดลบซ้ำ → NOT_MEMBER (หน้าเว็บถือว่าลบแล้ว)', r);

      // ---------- หลังลบ: ไม่เหลือที่ไหน ----------
      r = await call('staffLookup', { query: oldId });
      ok(!r.ok && r.code === 'NOT_FOUND', 'พนักงานค้นรหัสเดิม → ไม่พบ', r.code);
      r = await call('staffLookup', { query: '0861234501' });
      ok(!r.ok && r.code === 'NOT_FOUND', 'พนักงานค้นเบอร์เดิม → ไม่พบ', r.code);
      for (const [a, b] of [['addPurchase', { memberId: oldId, amount: 100, branchId: 'B01' }], ['adjustPoints', { memberId: oldId, points: 5, reason: 'ทดสอบ' }],
        ['adminMemberUpdate', { memberId: oldId, firstName: 'กลับ', lastName: 'มาใหม่', birthDate: '1990-01-01', phone: '0861234599' }],
        ['adminMemberStatus', { memberId: oldId, status: 'BLOCKED', reason: 'ทดสอบ' }]]) {
        r = await call(a, b);
        ok(!r.ok && r.code === 'NOT_FOUND', a + ' ให้สมาชิกที่ลบแล้ว → ไม่พบ', r.code);
      }
      r = await call('adminMembers', { q: oldId.toLowerCase() });
      ok(r.ok && r.items.every((x) => x.memberId !== oldId), 'รายชื่อสมาชิกในหลังบ้าน → ไม่มีคนที่ลบแล้ว');
      r = await call('adminMember', { memberId: oldId });
      ok(r.ok && r.member.deleted === true && r.member.name === 'สมาชิกที่ลบแล้ว' && !r.member.phone && !r.member.birthDate, 'เปิดหน้าสมาชิกที่ลบแล้ว (จากประวัติยอดซื้อ) → "สมาชิกที่ลบแล้ว" ไม่มีข้อมูลส่วนตัว', r.member);
      const today = U.thaiDay(new Date());
      r = await call('adminTransactions', { from: today, to: today, q: oldId.toLowerCase() });
      ok(r.ok && r.items.length >= 3 && r.items.every((x) => x.memberName === 'สมาชิกที่ลบแล้ว'), 'รายการแต้มเดิมยังอยู่ ชื่อเป็น "สมาชิกที่ลบแล้ว"', r.items && r.items.map((x) => x.memberName));
      r = await call('adminExport', { kind: 'members' });
      ok(r.ok && r.rows.every((x) => x[0] !== oldId) && JSON.stringify(r.rows).indexOf('0861234501') < 0, 'ไฟล์ Excel สมาชิก → ไม่มีคนที่ลบแล้ว');
      r = await call('adminAudience', { filter: {} });
      const aud = r.ok && r.preview ? r.preview.map((x) => x.memberId) : [];
      ok(r.ok && aud.indexOf(oldId) < 0, 'ส่งข้อความตามกลุ่ม → ไม่มีคนที่ลบแล้ว');

      // ---------- สมัครใหม่ด้วย LINE + เบอร์เดิม ----------
      r = await call('bootstrap', {}, cust('U_PD_1'));
      ok(r.ok && r.member === null && r.signup.bonusPoints === 15 && r.signup.bonusAvailable === false, 'กลับมาเปิดหน้าสมัคร → ไม่โชว์ว่าได้แต้มรับข่าวสาร (เคยได้แล้ว)', r.signup);
      r = await reg('U_PD_1', '0861234501');
      const newId = r.member && r.member.memberId;
      ok(r.ok && newId && newId !== oldId && !r.consentBonus && r.member.points === r.welcomePoints, 'สมัครใหม่ด้วย LINE + เบอร์เดิมได้ รหัสใหม่ / ได้แต้มต้อนรับ / ไม่ได้แต้มรับข่าวสารซ้ำ', r);
      r = await reg('U_PD_2', '0861234502');
      ok(r.ok && r.consentBonus === 15, 'คนอื่นที่ไม่เคยลบ ยังได้แต้มรับข่าวสารตามปกติ', r.consentBonus);
      const id2 = r.member.memberId;

      // ---------- เจ้าของร้านลบให้ ----------
      r = await call('adminMemberDelete', { memberId: id2, reason: 'ลูกค้าโทรมาขอ', confirm: 'ลบ' }, 'TEST:U_NOT_STAFF:คนนอก');
      ok(!r.ok && r.code !== 'NOT_FOUND', 'ไม่ใช่เจ้าของร้าน → ไม่ได้', r.code);
      r = await call('adminMemberDelete', { memberId: id2, reason: '', confirm: 'ลบ' });
      ok(!r.ok && r.code === 'NO_REASON', 'ไม่ใส่เหตุผล → ไม่ลบ', r.code);
      r = await call('adminMemberDelete', { memberId: id2, reason: 'ลูกค้าโทรมาขอ', confirm: 'ไม่' });
      ok(!r.ok && r.code === 'BAD_CONFIRM', 'ไม่พิมพ์ "ลบ" → ไม่ลบ', r.code);
      const rid = crypto.randomUUID();
      r = await pa.handle({ action: 'adminMemberDelete', shop: 'demo', idToken: OW, requestId: rid, memberId: id2, reason: 'ลูกค้าโทรมาขอ', confirm: 'ลบ' });
      const r2 = await pa.handle({ action: 'adminMemberDelete', shop: 'demo', idToken: OW, requestId: rid, memberId: id2, reason: 'ลูกค้าโทรมาขอ', confirm: 'ลบ' });
      ok(r.ok && r.deleted && r2.ok && JSON.stringify(r2) === JSON.stringify(r), 'เจ้าของร้านลบให้ได้ + กดซ้ำได้ผลเดิม', [r, r2]);
      r = await call('adminMemberDelete', { memberId: id2, reason: 'ลูกค้าโทรมาขอ', confirm: 'ลบ' });
      ok(r.ok && r.already === true, 'ลบคนที่ลบไปแล้ว → ตอบว่าลบแล้ว', r);
      const g2 = await row(id2);
      const p2 = (await db.query(`select changed, by_name from profile_log where shop_id = 'demo' and member_id = $1 order by created_at desc limit 1`, [id2])).rows[0];
      ok(g2.status === 'DELETED' && g2.phone === null && await pointsOk(id2) && p2.changed === 'ลบบัญชีโดยเจ้าของร้าน: ลูกค้าโทรมาขอ' && p2.by_name === 'เจ้าของร้านทดลอง',
        'ลบครบ + จดเหตุผลและชื่อผู้ลบในประวัติ', p2);
      r = await call('bootstrap', {}, cust('U_PD_2'));
      ok(r.ok && r.member === null, 'ลูกค้าเปิดบัตรหลังร้านลบให้ → กลับไปหน้าสมัคร');

      // ---------- ยอมรับนโยบายฉบับใหม่ ----------
      const v0 = (await db.query(`select consent_version from shops where id = 'demo'`)).rows[0].consent_version;
      await db.query(`update shops set consent_version = $1 where id = 'demo'`, [v0 + 1]);
      const V1 = String(v0 + 1);
      r = await call('bootstrap', {}, cust('U_PD_1'));
      ok(r.ok && r.privacy.needAccept === true && r.privacy.version === V1, 'ร้านแก้นโยบาย → ลูกค้าเดิมต้องยอมรับฉบับใหม่', r.privacy);
      const rw = (await db.query(`select id from rewards where shop_id = 'demo' and status = 'ACTIVE' and deleted_at is null and type <> 'BIRTHDAY' order by points limit 1`)).rows[0];
      r = await call('redeem', { rewardId: rw.id }, cust('U_PD_1'));
      ok(!r.ok && r.code === 'POLICY_NEEDED', 'ยังไม่ยอมรับ → แลกของรางวัลไม่ได้ (ตัวกลางกันซ้ำ)', r.code);
      r = await call('claimBirthday', {}, cust('U_PD_1'));
      ok(!r.ok && r.code === 'POLICY_NEEDED', 'ยังไม่ยอมรับ → รับของขวัญวันเกิดไม่ได้', r.code);
      r = await call('updateProfile', { firstName: 'ลบได้', lastName: 'ทดสอบสิทธิ์', birthDate: '1990-05-06', phone: '0861234501', consentMarketing: false }, cust('U_PD_1'));
      ok(r.ok && r.member.marketingConsent === false, 'ยังไม่ยอมรับ → ปิดรับข่าวสารได้ (ถอนความยินยอมได้เสมอ)', r.code);
      r = await call('addPurchase', { memberId: newId, amount: 200, branchId: 'B01' });
      ok(r.ok, 'ยังไม่ยอมรับ → พนักงานบันทึกยอดให้ที่เคาน์เตอร์ได้', r.code);
      r = await call('acceptPolicy', { version: String(v0) }, cust('U_PD_1'));
      ok(!r.ok && r.code === 'POLICY_CHANGED', 'ยอมรับฉบับเก่า (ร้านแก้อีกระหว่างอ่าน) → ให้อ่านฉบับล่าสุดก่อน', r.code);
      r = await call('acceptPolicy', { version: V1 }, cust('U_PD_1'));
      const acc = await row(newId);
      ok(r.ok && r.accepted && acc.consent_version === v0 + 1 && acc.consent_at, 'กดยอมรับ → จดฉบับที่ + เวลา', r);
      r = await call('acceptPolicy', { version: V1 }, cust('U_PD_1'));
      ok(r.ok && r.already === true, 'กดยอมรับซ้ำ → ไม่จดซ้ำ', r);
      const pl = (await db.query(`select count(*)::int as n from profile_log where shop_id = 'demo' and member_id = $1 and changed = $2`, [newId, 'ยอมรับนโยบายความเป็นส่วนตัว ฉบับที่ ' + V1])).rows[0].n;
      ok(pl === 1, 'ประวัติแก้ข้อมูลจด "ยอมรับนโยบาย ฉบับที่ ' + V1 + '" ครั้งเดียว', pl);
      r = await call('bootstrap', {}, cust('U_PD_1'));
      ok(r.ok && r.privacy.needAccept === false, 'ยอมรับแล้ว → ไม่ถามอีก');
      r = await call('acceptPolicy', { version: V1 }, cust('U_NOBODY'));
      ok(!r.ok && r.code === 'NOT_MEMBER', 'ยังไม่เป็นสมาชิก → ยอมรับไม่ได้', r.code);
      r = await call('adminBrand', {});
      const live = (await db.query(`select count(*)::int as n from members where shop_id = 'demo' and status <> 'DELETED'`)).rows[0].n;
      ok(r.ok && r.policyAccepted && r.policyAccepted.accepted === 1 && r.policyAccepted.total === live, 'หน้าตาร้าน: "ยอมรับฉบับล่าสุดแล้ว 1 จาก ' + live + ' คน" (ไม่นับคนที่ลบแล้ว)', r.policyAccepted);
      await db.query(`update shops set consent_version = $1, consent_bonus_points = 0 where id = 'demo'`, [v0]);
    } finally {
      console.log = log;
      console.error = errLog;
    }
  }

  console.log('\n[5.12] แจ้งเตือนผู้ดูแลทาง LINE (ทันที + ตรวจทุกเช้า) — LINE จำลอง ไม่ส่งจริง');
  {
    const A = require(path.join(ROOT, 'api', '_lib', 'alerts.js'));
    const { createCronHandler } = require(path.join(ROOT, 'api', 'cron.js'));
    const sent = [];
    let failFetch = null;
    const fakeFetch = async (url, opt) => {
      if (failFetch) return { ok: false, status: failFetch, text: async () => '{"message":"x"}' };
      sent.push({ url, body: opt.body ? JSON.parse(opt.body) : null, key: (opt.headers || {})['X-Line-Retry-Key'] });
      return { ok: true, status: 200, text: async () => '{}' };
    };
    let clock = Date.parse('2026-11-16T01:00:00Z'); // วันจันทร์ 08:00 เวลาไทย
    const TO = ['U' + 'a'.repeat(32), 'U' + 'b'.repeat(32)];
    const ENV = { ALERT_LINE_TOKEN: 'tok-test', ALERT_LINE_TO: TO.join(',') + ', ไม่ใช่LINEID', VERCEL_ENV: 'production' };
    const texts = () => sent.map((x) => x.body.messages[0].text);
    const dbDown = () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:6543'), { code: 'ECONNREFUSED' });
    const errLog = console.error; console.error = () => {};
    try {
      // ไม่ได้ตั้งค่า = ไม่ส่งอะไรเลย
      A.configure({ env: {}, fetch: fakeFetch, now: () => clock });
      for (let i = 0; i < 10; i++) await A.noteError('bootstrap', dbDown());
      await A.noteConfig('NO_DB', 'demo', 'bootstrap');
      ok(sent.length === 0 && !A.enabled(), 'ยังไม่ตั้ง ALERT_LINE_TOKEN / ALERT_LINE_TO → ไม่ส่งอะไรเลย ระบบทำงานปกติ');

      // ทันที: error ระบบถึงเกณฑ์
      A.configure({ env: ENV, fetch: fakeFetch, now: () => clock });
      for (let i = 0; i < 4; i++) { clock += 1000; await A.noteError('bootstrap', dbDown()); }
      ok(sent.length === 0, 'error 4 ครั้งใน 10 นาที → ยังไม่แจ้ง (ครั้งเดียวอาจแค่เน็ตสะดุด)');
      clock += 1000; await A.noteError('bootstrap', dbDown());
      ok(sent.length === 1 && /multicast$/.test(sent[0].url) && JSON.stringify(sent[0].body.to) === JSON.stringify(TO), 'ครั้งที่ 5 → แจ้งทันที 1 ข้อความ ถึงผู้รับ 2 คน (LINE ID รูปแบบผิดถูกตัดทิ้ง)', sent[0] && sent[0].body.to);
      ok(/ระบบขัดข้อง 5 ครั้งใน 10 นาที/.test(texts()[0]) && /ต่อฐานข้อมูลไม่ได้/.test(texts()[0]) && /bootstrap/.test(texts()[0]) && !/10\.0\.0\.1|6543/.test(texts()[0]),
        'ข้อความบอกจำนวน + สาเหตุแบบอ่านเข้าใจ (ไม่มีที่อยู่เครื่อง/รายละเอียดภายใน)', texts()[0]);
      for (let i = 0; i < 20; i++) { clock += 1000; await A.noteError('bootstrap', dbDown()); }
      ok(sent.length === 1, 'error ต่อเนื่องอีก 20 ครั้ง → ไม่แจ้งซ้ำภายใน 30 นาที');
      clock += 31 * 60 * 1000;
      for (let i = 0; i < 5; i++) { clock += 1000; await A.noteError('redeem', new TypeError("Cannot read properties of undefined (reading 'x') 0812345678 a@b.co")); }
      ok(sent.length === 2 && /โค้ดผิดพลาด/.test(texts()[1]) && !/0812345678|a@b\.co/.test(texts()[1]), 'ผ่าน 30 นาทีแล้วยังพัง → แจ้งอีก / ตัวเลขยาว อีเมล ถูกตัดออกจากข้อความ', texts()[1]);

      // ทันที: ปัญหาตั้งค่า
      ok(await A.noteConfig('NO_DB', '', 'bootstrap') && /DATABASE_URL/.test(texts()[2]), 'ยังไม่ตั้งรหัสฐานข้อมูล → แจ้งตั้งแต่ครั้งแรก');
      ok(!(await A.noteConfig('NO_DB', '', 'bootstrap')), 'เรื่องเดิมซ้ำภายใน 6 ชม. → ไม่แจ้งซ้ำ');
      ok(await A.noteConfig('OA_TOKEN', 'demo', 'adminBroadcastSend') && /ร้าน demo/.test(texts()[3]), 'รหัส LINE OA ของร้านใช้ไม่ได้ → แจ้งพร้อมชื่อร้าน');
      ok(!(await A.noteConfig('NOT_FRIEND', 'demo', 'register')), 'error ที่ลูกค้าแก้เองได้ (เช่น ยังไม่เพิ่มเพื่อน) → ไม่แจ้ง');
      clock += 6 * 3600 * 1000 + 1000;
      ok(await A.noteConfig('NO_DB', '', 'bootstrap'), 'ผ่าน 6 ชม. ยังไม่แก้ → แจ้งอีกครั้ง');

      // ผ่านตัวกลางจริง: ฐานข้อมูลล่ม / ยังไม่ตั้งรหัส
      sent.length = 0;
      A.configure({ env: ENV, fetch: fakeFetch, now: () => clock });
      const downApp = createApp({ db: () => ({ query: async () => { throw dbDown(); } }), verifier: createVerifier({ fetch: fakeLine().fetch }), region: 'test' });
      for (let i = 0; i < 5; i++) r = await downApp.handle({ action: 'bootstrap', shop: 'demo', idToken: 'x' });
      ok(!r.ok && r.code === 'ERROR' && sent.length === 1 && /ระบบขัดข้อง 5 ครั้ง/.test(texts()[0]), 'ตัวกลาง: ฐานข้อมูลล่ม 5 คำขอ → ลูกค้าเห็น "ระบบขัดข้อง" + ผู้ดูแลได้แจ้งเตือน 1 ข้อความ', r);
      const noDb = createApp({ db: getDbNoEnv, verifier: createVerifier({ fetch: fakeLine().fetch }), region: 'test' });
      r = await noDb.handle({ action: 'bootstrap', shop: 'demo' });
      ok(!r.ok && r.code === 'NO_DB' && sent.length === 2 && /DATABASE_URL/.test(texts()[1]), 'ตัวกลาง: ยังไม่ตั้งรหัสฐานข้อมูล → ผู้ดูแลได้แจ้งเตือนทันที', r.code);

      // ตรวจทุกเช้า (ฐานข้อมูลใหม่ของส่วนนี้ — ร้าน demo ข้อมูลทดลอง)
      const ddb = await createTestDb();
      const featOn = async () => ({ broadcast: true });
      const quotaOa = (used, limit) => ({ quota: async () => ({ type: 'limited', value: limit }), consumption: async () => ({ totalUsage: used }) });
      const daily = (extra) => A.runDaily(Object.assign({ db: ddb, features: featOn, oa: () => quotaOa(120, 300), now: new Date(clock) }, extra || {}));
      const mon = Date.parse('2026-11-16T01:00:00Z'), tue = Date.parse('2026-11-17T01:00:00Z');
      sent.length = 0;
      clock = mon; A.configure({ env: ENV, fetch: fakeFetch, now: () => clock });
      let d = await daily();
      ok(d.problems.length === 0 && d.summary && d.sent && sent.length === 1, 'วันจันทร์ ไม่มีปัญหา → ส่งสรุปประจำสัปดาห์ (ยืนยันว่าระบบแจ้งเตือนยังทำงาน)', d.problems);
      const t0 = texts()[0];
      ok(/✅ ระบบปกติ/.test(t0) && /สรุปประจำสัปดาห์/.test(t0) && /ร้านที่เปิดใช้ \d+ ร้าน · สมาชิก [\d,]+ คน/.test(t0) && /ฐานข้อมูล [\d.]+ MB จาก 500 MB/.test(t0) &&
        /ร้าน demo: LINE OA ใช้ไป 120\/300/.test(t0) && /ใบรับรอง SSL เหลือ [\d,]+ วัน/.test(t0), 'สรุป: ร้าน สมาชิก ฐานข้อมูล โควตา OA ใบรับรอง', t0);
      clock = tue; A.configure({ env: ENV, fetch: fakeFetch, now: () => clock }); sent.length = 0;
      d = await daily({ now: new Date(tue) });
      ok(!d.sent && sent.length === 0, 'วันอังคาร ไม่มีปัญหา → เงียบ (ไม่เปลืองโควตา)');
      // แต้มเพี้ยน + ส่งข้อความไม่สำเร็จ + โควตาใกล้หมด + รหัส OA เสีย
      const [bad] = (await ddb.query(`select id from members where shop_id = 'demo' order by id limit 1`)).rows;
      await ddb.query(`update members set points = points + 7 where shop_id = 'demo' and id = $1`, [bad.id]);
      await ddb.query(`insert into broadcasts (shop_id, id, request_id, created_by, recipients, total, sent, status, created_at, updated_at)
        values ('demo', 'BC-ALERT01', 'req-alert-01', 'U_OWNER', array['DM-000001'], 1200, 500, 'PARTIAL', $1, $1)`, [new Date(tue - 3600 * 1000)]);
      d = await daily({ now: new Date(tue), oa: () => quotaOa(290, 300) });
      const t1 = texts()[0] || '';
      ok(d.sent && d.problems.length === 2 && /พบ 2 เรื่อง/.test(t1) && new RegExp('แต้มไม่ตรง 1 คน[\\s\\S]*' + bad.id).test(t1) && /ส่งได้ไม่ครบ \(500\/1,200 คน BC-ALERT01\)/.test(t1),
        'วันอังคาร เจอปัญหา → แจ้ง: แต้มไม่ตรง (รหัสสมาชิก) + ส่งข้อความไม่ครบ', t1);
      ok(!/สรุปประจำสัปดาห์/.test(t1) && !/0[689]\d{8}/.test(t1), 'วันที่ไม่ใช่วันสรุป → แจ้งเฉพาะปัญหา / ไม่มีเบอร์ลูกค้าในข้อความ');
      sent.length = 0;
      d = await daily({ now: new Date(tue), oa: () => ({ quota: async () => { const e = new Error('401'); e.status = 401; throw e; }, consumption: async () => ({}) }) });
      ok(d.problems.some((p) => /ร้าน demo: รหัส LINE OA ของร้านใช้ไม่ได้/.test(p)), 'รหัส LINE OA ของร้านใช้ไม่ได้ → อยู่ในรายการปัญหา', d.problems);
      // ส่งซ้ำวันเดียวกัน = key เดิม (LINE ไม่ส่งซ้ำ)
      sent.length = 0;
      await daily({ now: new Date(tue) }); await daily({ now: new Date(tue) });
      ok(sent.length === 2 && sent[0].key === sent[1].key && /^[0-9a-f-]{36}$/.test(sent[0].key), 'งานตรวจถูกเรียกซ้ำในวันเดียวกัน → รหัสกันส่งซ้ำเดิม (LINE ไม่ส่งซ้ำ)');
      // แก้แล้ว + สรุปรายวัน + เพดานพื้นที่
      await ddb.query(`update members set points = points - 7 where shop_id = 'demo' and id = $1`, [bad.id]);
      await ddb.query(`update broadcasts set status = 'DONE', sent = total where id = 'BC-ALERT01'`);
      A.configure({ env: Object.assign({}, ENV, { ALERT_SUMMARY: 'daily' }), fetch: fakeFetch, now: () => clock }); sent.length = 0;
      d = await daily({ now: new Date(tue) });
      ok(d.sent && /✅ ระบบปกติ/.test(texts()[0]) && /สรุปประจำวัน/.test(texts()[0]), 'ALERT_SUMMARY=daily → สรุปทุกเช้า แม้ไม่มีปัญหา');
      A.configure({ env: Object.assign({}, ENV, { ALERT_DB_LIMIT_MB: '1' }), fetch: fakeFetch, now: () => clock }); sent.length = 0;
      d = await daily({ now: new Date(tue) });
      ok(d.problems.some((p) => /ฐานข้อมูลใช้ไป .* จาก 1 MB/.test(p)), 'ฐานข้อมูลใช้เกิน 80% ของเพดาน → แจ้งทุกเช้า', d.problems);

      // ทางเข้างานตรวจ (api/cron.js)
      A.configure({ env: ENV, fetch: fakeFetch, now: () => clock }); sent.length = 0;
      const mkRes = () => ({ statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { this.body = JSON.parse(s); } });
      const runCron = async (secret, auth, db) => {
        const h = createCronHandler({ db: () => db || ddb, secret: () => secret, features: featOn, oa: () => quotaOa(1, 300), now: () => new Date(tue) });
        const res = mkRes();
        await h({ headers: auth ? { authorization: auth } : {} }, res);
        return res;
      };
      let res = await runCron('', 'Bearer ');
      ok(res.statusCode === 401 && res.body.ready && res.body.ready.checkPoints === true && res.body.ready.shopFiles >= 2 && res.body.ready.secretSet === false,
        'ยังไม่ตั้ง CRON_SECRET → ไม่รับ (บอกแค่ว่าไฟล์ที่ต้องใช้ครบ)', res.body);
      res = await runCron('ลับมาก', 'Bearer ผิด');
      ok(res.statusCode === 401 && sent.length === 0, 'รหัสผิด → ไม่รับ ไม่ตรวจ ไม่ส่ง');
      res = await runCron('ลับมาก', 'Bearer ลับมาก');
      ok(res.statusCode === 200 && res.body.ok && res.body.problems === 0 && !('rows' in res.body), 'รหัสถูก → ตรวจ (คำตอบมีแค่จำนวน ไม่มีข้อมูลร้าน)', res.body);
      res = await runCron('ลับมาก', 'Bearer ลับมาก', { query: async () => { throw dbDown(); } });
      ok(res.statusCode === 500 && /งานตรวจประจำวันทำไม่สำเร็จ/.test(texts().pop() || '') && /ต่อฐานข้อมูลไม่ได้/.test(texts().pop() || ''), 'งานตรวจเองล้ม → แจ้ง "งานตรวจประจำวันทำไม่สำเร็จ" (ไม่เงียบ)');
      const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
      ok((vj.crons || []).some((c) => c.path === '/api/cron' && c.schedule === '0 1 * * *') && vj.functions['api/cron.js'].includeFiles === 'shops/**',
        'vercel.json: งานตรวจทุกวัน 08:00 เวลาไทย (01:00 UTC) + แนบไฟล์ร้าน');
      // โฟลเดอร์ db/ ไม่ขึ้น Vercel (.vercelignore) → คำสั่งตรวจแต้มอยู่ในโมดูล JS ต้องเหมือนไฟล์ที่ผู้ดูแลวางเองทุกตัวอักษร
      ok(A.CHECK_POINTS_SQL === fs.readFileSync(path.join(ROOT, 'db', 'check_points.sql'), 'utf8'),
        'api/_lib/check-points.js ตรงกับ db/check_points.sql ทุกตัวอักษร (แก้ไฟล์ .sql แล้วต้องคัดลอกไปด้วย)');
      // ลิงก์ทดสอบ: ขึ้นต้นข้อความให้รู้
      A.configure({ env: Object.assign({}, ENV, { VERCEL_ENV: 'preview' }), fetch: fakeFetch, now: () => clock }); sent.length = 0;
      await A.noteConfig('NO_LIFF', 'demo');
      ok(/^\[ลิงก์ทดสอบ\]/.test(texts()[0]), 'แจ้งจากลิงก์ทดสอบ → ขึ้นต้น [ลิงก์ทดสอบ] (ไม่สับสนกับเว็บจริง)');
      // LINE ส่งไม่ได้ → ไม่โยน error ต่อ
      failFetch = 500;
      ok((await A.sendText('ทดสอบ')) === false, 'LINE ส่งแจ้งเตือนไม่ได้ → แค่จด log ไม่กระทบคำตอบของลูกค้า');
      failFetch = null;
    } finally {
      console.error = errLog;
      A.configure({ env: {}, fetch: globalThis.fetch, now: () => Date.now() });
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
