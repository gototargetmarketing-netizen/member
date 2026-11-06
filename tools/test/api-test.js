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
  r = await brokenApp.handle({ action: 'speedCard', shop: 'demo' });
  console.error = errLog;
  ok(!r.ok && r.code === 'ERROR' && r.error === 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' && !/10\.0|6543|ECONN/.test(JSON.stringify(r)), 'ฐานข้อมูลล่ม → ข้อความกลางๆ ไม่บอกที่อยู่/รหัสภายใน', r);

  const prevUrl = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  const { getDb } = require(path.join(ROOT, 'api', '_lib', 'db.js'));
  const noDbApp = createApp({ db: getDb, verifier: createVerifier({ fetch: line.fetch }), region: 'test' });
  console.error = () => {};
  r = await noDbApp.handle({ action: 'speedCard', shop: 'demo' });
  console.error = errLog;
  if (prevUrl) process.env.DATABASE_URL = prevUrl;
  ok(!r.ok && r.code === 'NO_DB' && /ติดต่อผู้ดูแลระบบ/.test(r.error), 'ยังไม่ได้ตั้งรหัสฐานข้อมูลใน Vercel → NO_DB + "ติดต่อผู้ดูแลระบบ"', r);
  ok((await noDbApp.handle({ action: 'ping' })).ok, 'ยังไม่ได้ตั้งรหัสฐานข้อมูล → ping ยังใช้ได้ (ไม่แตะฐานข้อมูล)');

  const cfg = connectionConfig('postgresql://postgres.abc:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require');
  ok(!/sslmode/.test(cfg.connectionString) && cfg.ssl && cfg.max <= 5, 'ลิงก์ฐานข้อมูล: เอา sslmode ออก (ไม่ให้ทับค่าเข้ารหัส) + เปิดสายไม่เกิน 5', cfg.connectionString);

  console.log('\n[3] วัดความเร็ว (speedCard)');
  r = await app.handle({ action: 'speedCard', shop: 'demo', n: 1 });
  ok(r.ok && r.data.member && r.data.member.id === 'DM-000001', 'ลูกค้าคนที่ 1 → ได้ข้อมูลสมาชิก', r.error);
  ok(r.counts && r.counts.tx === 50, 'ประวัติตัดที่ 50 รายการ (history_limit ของร้าน)', r.counts);
  const dates = r.data.tx.map(t => new Date(t.created_at).getTime());
  ok(dates.every((d, i) => i === 0 || dates[i - 1] >= d), 'ประวัติเรียงใหม่ → เก่า');
  ok(r.counts.rewards === 8 && r.counts.branches === 6 && r.counts.rules === 2, 'ของรางวัล 8 / สาขา 6 / แต้มพิเศษ 2', r.counts);
  ok(r.counts.promos === 3 && !r.data.promos.some(p => p.id === 'P004'), 'โปรโมชันที่หมดเวลาแล้วไม่แสดง (เหลือ 3)', r.data.promos.map(p => p.id));
  ok(typeof r.dbMs === 'number' && typeof r.ms === 'number' && r.ms >= r.dbMs, 'บอกเวลาฐานข้อมูล + เวลารวมในตัวกลาง (' + r.dbMs + ' / ' + r.ms + ' ms)');
  r = await app.handle({ action: 'speedCard', shop: 'demo', n: 2000 });
  ok(r.ok && r.data.member.id === 'DM-002000', 'ลูกค้าคนที่ 2,000 → ได้ข้อมูล');
  r = await app.handle({ action: 'speedCard', shop: 'demo', n: 99999 });
  ok(r.ok && r.data.member, 'เลขลูกค้าเกินช่วง → สุ่มให้แทน');
  r = await app.handle({ action: 'speedCard', shop: 'demo', n: '1; drop table members' });
  ok(r.ok, 'เลขลูกค้าแปลกๆ → ไม่พัง (สุ่มให้แทน)');
  ok((await count(db, `select count(*)::int n from members`)) === 2000, 'ตารางสมาชิกยังอยู่ครบ');
  r = await app.handle({ action: 'speedCard', shop: 'khamwan' });
  ok(!r.ok && r.code === 'DEMO_ONLY', 'ร้านอื่นที่ไม่ใช่ demo → DEMO_ONLY (ไม่ส่งข้อมูลร้านจริงออกไป)', r);
  for (const s of ['', 'Admin', '../x', 'a', 'x'.repeat(40), null, 123]) {
    r = await app.handle({ action: 'speedCard', shop: s });
    ok(!r.ok && r.code === 'NO_SHOP', 'รหัสร้าน ' + JSON.stringify(s) + ' → NO_SHOP', r);
  }
  r = await app.handle({ action: 'speedCard', shop: 'nosuch' });
  ok(!r.ok && r.code === 'NO_SHOP', 'ร้านที่ไม่มีอยู่ → NO_SHOP');
  const times = [];
  for (let i = 0; i < 20; i++) { const s = performance.now(); await app.handle({ action: 'speedCard', shop: 'demo' }); times.push(performance.now() - s); }
  times.sort((a, b) => a - b);
  ok(times[10] < 200, 'เปิดบัตร 20 ครั้งบนฐานข้อมูลจำลอง: ค่ากลาง ' + times[10].toFixed(1) + ' ms (ข้อมูลอ้างอิง ไม่ใช่ความเร็วจริง)');

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
    j = await (await fetch(base, { method: 'POST', body: JSON.stringify({ action: 'speedCard', shop: 'demo', n: 5 }) })).json();
    ok(j.ok && j.data.member.id === 'DM-000005', 'speedCard ผ่าน HTTP → ได้ข้อมูล');
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

  console.log('\n[6] ข้อความถึงผู้ใช้');
  // ทุกไฟล์ใน api/ (ไฟล์ใหม่ถูกตรวจเองโดยไม่ต้องเพิ่มชื่อ)
  const apiFiles = ['index.js'].concat(fs.readdirSync(path.join(ROOT, 'api', '_lib')).filter(f => f.endsWith('.js')).map(f => '_lib/' + f));
  const sources = apiFiles.map(f => fs.readFileSync(path.join(ROOT, 'api', f), 'utf8')).join('\n');
  const msgs = [...sources.matchAll(/userError\('([^']*)'/g)].map(m => m[1]);
  const leaks = msgs.filter(m => /google|drive|ชีต|apps ?script|supabase|vercel|postgres|ฐานข้อมูล/i.test(m));
  ok(msgs.length >= 8 && leaks.length === 0, 'ข้อความ ' + msgs.length + ' ข้อความที่ผู้ใช้เห็น ไม่พูดถึงที่เก็บข้อมูล', leaks);
  const page = fs.readFileSync(path.join(ROOT, 'speed.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '');
  ok(!/google|apps ?script|supabase|ชีต/i.test(page), 'หน้าวัดความเร็วไม่พูดถึงที่เก็บข้อมูล (ใครมีลิงก์ก็เปิดได้)');
  ok(/<meta name="robots" content="noindex">/.test(fs.readFileSync(path.join(ROOT, 'speed.html'), 'utf8')), 'หน้าวัดความเร็วไม่ให้ค้นเจอใน Google (noindex)');

  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
