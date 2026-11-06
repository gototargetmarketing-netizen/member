// ทดสอบเทียบคู่: ส่งคำสั่งชุดเดียวกันให้ "ระบบเดิม" (code.gs บนชีตจำลอง) และ "ระบบใหม่" (api/ บน PostgreSQL จำลอง)
// แล้วเทียบคำตอบทุกช่อง — ต่างกันแม้แต่ข้อความเตือนหรือชื่อช่องก็จับได้ → มั่นใจว่าหน้าเว็บใช้ระบบใหม่ได้โดยไม่ต้องแก้
//
// สิ่งที่ไม่เทียบตรงตัว: รหัสสุ่ม (สมาชิก/คูปอง/รายการ) เทียบลำดับที่ปรากฏแทน / เวลา ยอมให้ต่างกันไม่เกิน 5 วินาที
// รัน: node tools/test/api-diff-test.js
const path = require('path');
const crypto = require('crypto');
const { createWorld, call, run } = require('./gas-stub');
const { createTestDb } = require('./pglite-db');
const { importShop } = require('./sheet-import');
const ROOT = path.join(__dirname, '..', '..');
const { createApp } = require(path.join(ROOT, 'api', '_lib', 'router.js'));
const U = require(path.join(ROOT, 'api', '_lib', 'util.js'));

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')); } };
const rid = () => crypto.randomUUID();
const tok = (id, name = 'ทดสอบ') => `TEST:${id}:${name}`;
const SHOP = 'khamwan';
const SHEETS = ['Settings', 'Members', 'Transactions', 'Rewards', 'Coupons', 'Staff', 'Promotions', 'Branches', 'Profile_Log', 'Point_Rules'];

// ---------- เทียบคำตอบ ----------
// รหัสสุ่มแทนด้วยลำดับที่เจอ (แยกแต่ละระบบ) เช่น KW-H7K2PQ → MEMBER#1
const idMaps = { A: new Map(), B: new Map() };
const ID_PATTERNS = [[/^[A-Z]{1,4}-[A-Z0-9]{6}$/, 'MEMBER'], [/^CP-[A-Z0-9]{8}$/, 'COUPON'], [/^TX-[A-Z0-9]{10}$/, 'TX']];
function norm(v, side) {
  if (Array.isArray(v)) return v.map((x) => norm(x, side));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k], side)]));
  if (typeof v === 'string') {
    for (const [re, label] of ID_PATTERNS) {
      if (re.test(v)) {
        const map = idMaps[side];
        if (!map.has(v)) map.set(v, label + '#' + (map.size + 1));
        return map.get(v);
      }
    }
  }
  return v;
}
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function diff(a, b, p, out) {
  if (typeof a === 'string' && typeof b === 'string' && ISO.test(a) && ISO.test(b)) {
    if (Math.abs(Date.parse(a) - Date.parse(b)) > 5000) out.push(p + ': ' + a + ' ≠ ' + b);
    return out;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { out.push(p + ': รายการ ' + JSON.stringify(a).slice(0, 120) + ' ≠ ' + JSON.stringify(b).slice(0, 120)); return out; }
    a.forEach((x, i) => diff(x, b[i], p + '[' + i + ']', out));
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    new Set(Object.keys(a).concat(Object.keys(b))).forEach((k) => {
      if (!(k in a)) out.push(p + '.' + k + ': ระบบเดิมไม่มี (ใหม่ = ' + JSON.stringify(b[k]).slice(0, 80) + ')');
      else if (!(k in b)) out.push(p + '.' + k + ': ระบบใหม่ไม่มี (เดิม = ' + JSON.stringify(a[k]).slice(0, 80) + ')');
      else diff(a[k], b[k], p + '.' + k, out);
    });
    return out;
  }
  if (a !== b) out.push(p + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));
  return out;
}

(async () => {
  // ---------- ตั้งต้นสองระบบด้วยข้อมูลชุดเดียวกัน ----------
  const W = createWorld();
  run(W, 'testSetup');
  run(W, 'enableTestMode');
  const sheet = (n) => W.ss.getSheetByName(n);
  const touch = (n) => W.cache.delete('rows:' + n); // แก้ชีตตรงๆ → ล้างค่าที่ระบบเดิมจำไว้
  function setCell(name, matchCol, matchVal, col, val) {
    const s = sheet(name); const h = s.data[0];
    const row = s.data.find((r, i) => i > 0 && String(r[h.indexOf(matchCol)]) === String(matchVal));
    if (!row) throw new Error('setCell ไม่พบ ' + name + ' ' + matchVal);
    row[h.indexOf(col)] = val;
    touch(name);
  }
  function addRow(name, obj) {
    const s = sheet(name); const h = s.data[0];
    s.data.push(h.map((k) => (k in obj ? obj[k] : '')));
    touch(name);
  }
  setCell('Settings', 'Key', 'MEMBER_PREFIX', 'Value', 'KW');
  setCell('Settings', 'Key', 'WELCOME_POINTS', 'Value', '20');

  const db = await createTestDb({ withDemo: false });
  const sheets = {};
  SHEETS.forEach((n) => { if (sheet(n)) sheets[n] = sheet(n).data; });
  await importShop(db, SHOP, sheets);
  const app = createApp({ db: () => db, verifier: { verify: async () => { throw new Error('ไม่ควรถูกเรียก'); } }, allowTestTokens: true, region: 'test', shopTtlMs: 0 });

  // ส่งคำสั่งเดียวกันให้ทั้งสองระบบ แล้วเทียบ
  // body เป็นฟังก์ชัน (side) => {...} ได้ — ใช้เมื่อต้องอ้างรหัสสมาชิก/คูปองซึ่งแต่ละระบบสุ่มคนละค่า
  // tweak(คำตอบ, side) = ปรับก่อนเทียบ (เช่น ตัดช่องที่ระบบใหม่ตั้งใจไม่มี / เรียงแถวที่ลำดับไม่มีความหมาย)
  async function both(label, body, expect, tweak) {
    const mk = (side) => Object.assign({ shop: SHOP }, typeof body === 'function' ? body(side) : body);
    const a = call(W, mk('A'));
    const b = await app.handle(JSON.parse(JSON.stringify(mk('B'))));
    // canDelete = ระบบใหม่บอกหน้าเว็บว่าลบได้ (ระบบเดิมไม่มีปุ่มลบโดยตั้งใจ) → ไม่นับเป็นความต่าง
    const fix = (o, side) => {
      if (!o || !o.ok) return o;
      o = JSON.parse(JSON.stringify(o));
      delete o.canDelete;
      return tweak ? tweak(o, side) : o;
    };
    const d = diff(norm(fix(a, 'A'), 'A'), norm(fix(b, 'B'), 'B'), '', []);
    const codeOk = !expect || (expect === 'ok' ? a.ok : a.code === expect);
    ok(d.length === 0 && codeOk, label + (expect && expect !== 'ok' ? ' → ' + expect : ''),
      d.length ? { ต่างกัน: d.slice(0, 6), เดิม: a.code || a.ok, ใหม่: b.code || b.ok, debug: b.debug } : { เดิม: a.code, ใหม่: b.code });
    return { a, b };
  }
  // จำรหัสสมาชิกของแต่ละระบบ (สุ่มคนละค่า) ไว้ใช้ตอนแก้ข้อมูลตรงๆ
  const ids = {};
  const remember = (user, r) => { if (r.a.member && r.b.member) ids[user] = { A: r.a.member.memberId, B: r.b.member.memberId }; };
  async function setMember(user, sheetCol, dbCol, val, dbVal) {
    setCell('Members', 'Member_ID', ids[user].A, sheetCol, val);
    await db.query(`update members set ${dbCol} = $3 where shop_id = $1 and id = $2`, [SHOP, ids[user].B, dbVal === undefined ? val : dbVal]);
  }
  async function setReward(id, sheetCol, dbCol, val, dbVal) {
    setCell('Rewards', 'Reward_ID', id, sheetCol, val);
    await db.query(`update rewards set ${dbCol} = $3 where shop_id = $1 and id = $2`, [SHOP, id, dbVal === undefined ? val : dbVal]);
  }
  const now = new Date();
  const today = U.thaiDay(now);
  const month = today.slice(5, 7);
  const otherMonth = String((Number(month) % 12) + 1).padStart(2, '0');
  const dayOffset = (n) => U.thaiDay(new Date(now.getTime() + n * U.DAY_MS));
  const reg = (user, extra) => Object.assign({ action: 'register', idToken: tok(user, 'ลูกค้า ' + user), consentPrivacy: true,
    firstName: 'สมชาย', lastName: 'ใจดี', birthDate: '1990-' + otherMonth + '-15', phone: '0812345678' }, extra);

  console.log('\n[1] เปิดหน้าลูกค้าก่อนสมัคร');
  await both('ยังไม่เป็นสมาชิก: ค่าร้าน + ของรางวัล + โปรโมชัน', { action: 'bootstrap', idToken: tok('U1', 'สมชาย') }, 'ok');
  await both('ขอหน้าตาร้านมาด้วย (withBrand)', { action: 'bootstrap', idToken: tok('U1'), withBrand: true }, 'ok');
  await both('รหัสทดสอบผิดรูปแบบ', { action: 'bootstrap', idToken: 'TEST:../x:y' }, 'TEST_DISABLED');
  await both('ไม่มีรหัส LINE', { action: 'bootstrap' }, 'NO_TOKEN');

  console.log('\n[2] สมัครสมาชิก: ตรวจข้อมูล');
  await both('ไม่ยอมรับนโยบาย', reg('U1', { consentPrivacy: false }), 'NO_CONSENT');
  await both('ไม่กรอกชื่อ', reg('U1', { firstName: '  ' }), 'BAD_NAME');
  await both('ชื่อมีตัวเลข', reg('U1', { firstName: 'สมชาย2' }), 'BAD_NAME');
  await both('ไม่กรอกนามสกุล', reg('U1', { lastName: '' }), 'BAD_NAME');
  await both('ชื่อยาวเกิน 40 ตัว', reg('U1', { firstName: 'ก'.repeat(41) }), 'BAD_NAME');
  await both('ไม่เลือกวันเกิด', reg('U1', { birthDate: '' }), 'BAD_BIRTHDATE');
  await both('วันเกิดไม่มีจริง (30 ก.พ.)', reg('U1', { birthDate: '1990-02-30' }), 'BAD_BIRTHDATE');
  await both('วันเกิดผิดรูปแบบ', reg('U1', { birthDate: '15/02/1990' }), 'BAD_BIRTHDATE');
  await both('อายุไม่ถึง 1 ปี', reg('U1', { birthDate: dayOffset(-100) }), 'BAD_BIRTHDATE');
  await both('อายุเกิน 120 ปี', reg('U1', { birthDate: '1890-01-01' }), 'BAD_BIRTHDATE');
  await both('เบอร์สั้นเกิน', reg('U1', { phone: '08123' }), 'BAD_PHONE');
  await both('เบอร์บ้าน (ไม่ใช่มือถือ)', reg('U1', { phone: '021234567' }), 'BAD_PHONE');

  console.log('\n[3] สมัครสมาชิก');
  let r = await both('สมัครสำเร็จ (+66 → 0, ชื่อมี <b> ถูกตัด, รับข่าวสาร)',
    reg('U1', { phone: '+66 81 234 5678', firstName: 'สม<b>ชาย', consentMarketing: true, branch: 'B01' }), 'ok');
  remember('U1', r);
  ok(r.b.member && r.b.member.phone === '0812345678' && r.b.welcomePoints === 20, 'ระบบใหม่: เบอร์ 0812345678 + แต้มต้อนรับ 20', r.b.member);
  await both('สมัครซ้ำ (บัญชี LINE เดิม) → บอกว่าเป็นสมาชิกแล้ว', reg('U1'), 'ok');
  await both('คนอื่นใช้เบอร์ซ้ำ', reg('U2'), 'PHONE_TAKEN');
  remember('U2', await both('คนที่ 2 สมัคร (ไม่รับข่าวสาร)', reg('U2', { phone: '0898765432', firstName: 'สมหญิง' }), 'ok'));
  await both('เปิดหน้าลูกค้าหลังสมัคร: บัตร + ประวัติแต้มต้อนรับ', { action: 'bootstrap', idToken: tok('U1', 'สมชาย') }, 'ok');
  await both('เปิดหน้าลูกค้า + รูปโปรไฟล์ใหม่จาก LINE', { action: 'bootstrap', idToken: tok('U1', 'สมชาย') }, 'ok');

  console.log('\n[4] แลกของรางวัล');
  await both('ไม่มีรหัสคำขอ', { action: 'redeem', idToken: tok('U1'), rewardId: 'R001' }, 'BAD_REQUEST_ID');
  await both('รหัสรางวัลผิดรูปแบบ', { action: 'redeem', idToken: tok('U1'), rewardId: 'R 1', requestId: rid() }, 'BAD_KEY');
  await both('ไม่มีรางวัลนี้', { action: 'redeem', idToken: tok('U1'), rewardId: 'R999', requestId: rid() }, 'REWARD_UNAVAILABLE');
  await both('ยังไม่เป็นสมาชิก', { action: 'redeem', idToken: tok('U9'), rewardId: 'R001', requestId: rid() }, 'NOT_MEMBER');
  await both('แต้มไม่พอ (มี 20 ต้องใช้ 80)', { action: 'redeem', idToken: tok('U1'), rewardId: 'R001', requestId: rid() }, 'NOT_ENOUGH');
  await setMember('U1', 'Points', 'points', 1500);
  await setMember('U2', 'Points', 'points', 1500);
  const rq = rid();
  const first = await both('แลกสำเร็จ: ได้คูปอง + หักแต้ม', { action: 'redeem', idToken: tok('U1'), rewardId: 'R001', requestId: rq }, 'ok');
  const again = await both('ส่งรหัสคำขอเดิมซ้ำ → ได้ผลเดิม ไม่แลกซ้ำ', { action: 'redeem', idToken: tok('U1'), rewardId: 'R001', requestId: rq }, 'ok');
  // เทียบค่า ไม่เทียบลำดับช่อง (ผลที่จำไว้ในฐานข้อมูลเรียงชื่อช่องใหม่ — หน้าเว็บอ่านตามชื่อ ไม่กระทบ)
  const same = diff(first.b, again.b, '', []);
  ok(same.length === 0, 'ระบบใหม่: ผลซ้ำตรงกับครั้งแรกทุกค่า', same);
  ok((await db.query(`select count(*)::int n from coupons where shop_id=$1`, [SHOP])).rows[0].n === 1, 'ระบบใหม่: มีคูปองใบเดียว');
  await both('เปิดหน้าลูกค้า: เห็นคูปอง + ประวัติแลก', { action: 'bootstrap', idToken: tok('U1') }, 'ok');

  console.log('\n[5] โควตา / จำกัดต่อคน / ปิดใช้ / ช่วงเวลา / ระงับสมาชิก');
  await setReward('R002', 'Quota', 'quota', 1);
  await both('รางวัลเหลือ 1 ชิ้น: คนแรกแลกได้', { action: 'redeem', idToken: tok('U1'), rewardId: 'R002', requestId: rid() }, 'ok');
  await both('คนที่สองแลกไม่ได้ (หมดแล้ว)', { action: 'redeem', idToken: tok('U2'), rewardId: 'R002', requestId: rid() }, 'SOLD_OUT');
  await setReward('R003', 'Limit_Per_Member', 'limit_per_member', 1);
  await both('จำกัดคนละ 1 ครั้ง: ครั้งแรกได้', { action: 'redeem', idToken: tok('U1'), rewardId: 'R003', requestId: rid() }, 'ok');
  await both('ครั้งที่สองไม่ได้', { action: 'redeem', idToken: tok('U1'), rewardId: 'R003', requestId: rid() }, 'LIMIT_REACHED');
  await both('เปิดหน้าลูกค้า: จำนวนคงเหลือ + จำกัดต่อคน', { action: 'bootstrap', idToken: tok('U2') }, 'ok');
  await setReward('R001', 'Status', 'status', 'INACTIVE');
  await both('รางวัลที่ปิดแล้ว', { action: 'redeem', idToken: tok('U2'), rewardId: 'R001', requestId: rid() }, 'REWARD_UNAVAILABLE');
  await setReward('R001', 'Status', 'status', 'ACTIVE');
  await setReward('R001', 'End_Date', 'end_date', dayOffset(-1));
  await both('รางวัลหมดเขตเมื่อวาน', { action: 'redeem', idToken: tok('U2'), rewardId: 'R001', requestId: rid() }, 'REWARD_UNAVAILABLE');
  await setReward('R001', 'End_Date', 'end_date', today);
  await both('รางวัลหมดเขตวันนี้ (ยังแลกได้ถึงสิ้นวัน)', { action: 'redeem', idToken: tok('U2'), rewardId: 'R001', requestId: rid() }, 'ok');
  await setReward('R001', 'End_Date', 'end_date', '', null);
  await setReward('R001', 'Start_Date', 'start_date', dayOffset(1));
  await both('รางวัลที่เริ่มพรุ่งนี้', { action: 'redeem', idToken: tok('U2'), rewardId: 'R001', requestId: rid() }, 'REWARD_UNAVAILABLE');
  await both('เปิดหน้าลูกค้า: รางวัลที่ยังไม่เริ่มไม่แสดง', { action: 'bootstrap', idToken: tok('U2') }, 'ok');
  await setReward('R001', 'Start_Date', 'start_date', '', null);
  await setReward('R002', 'Valid_Days', 'valid_days', 7);
  await setReward('R002', 'Quota', 'quota', 5);
  await both('คูปองอายุ 7 วัน (ตั้งที่ของรางวัล)', { action: 'redeem', idToken: tok('U2'), rewardId: 'R002', requestId: rid() }, 'ok');
  await setMember('U2', 'Status', 'status', 'BLOCKED');
  await both('สมาชิกถูกระงับ → แลกไม่ได้', { action: 'redeem', idToken: tok('U2'), rewardId: 'R003', requestId: rid() }, 'MEMBER_BLOCKED');
  await both('สมาชิกถูกระงับ → เปิดหน้าลูกค้าได้ (เห็นสถานะ)', { action: 'bootstrap', idToken: tok('U2') }, 'ok');
  await both('สมาชิกถูกระงับ → แก้ข้อมูลไม่ได้', { action: 'updateProfile', idToken: tok('U2'), firstName: 'ก', lastName: 'ข', birthDate: '1990-01-01', phone: '0898765432' }, 'MEMBER_BLOCKED');
  await setMember('U2', 'Status', 'status', 'ACTIVE');

  console.log('\n[6] แก้ข้อมูลตัวเอง');
  const prof = (extra) => Object.assign({ action: 'updateProfile', idToken: tok('U1'), firstName: 'สมชาย', lastName: 'ใจดี', birthDate: '1990-' + otherMonth + '-15', phone: '0812345678' }, extra);
  await both('ยังไม่เป็นสมาชิก', Object.assign(prof(), { idToken: tok('U9') }), 'NOT_MEMBER');
  await both('แก้ชื่อ + เลิกรับข่าวสาร', prof({ firstName: 'สมชาติ', consentMarketing: false }), 'ok');
  await both('ส่งค่าเดิม → ไม่มีอะไรเปลี่ยน', prof({ firstName: 'สมชาติ', consentMarketing: false }), 'ok');
  await both('เบอร์ซ้ำกับคนอื่น', prof({ firstName: 'สมชาติ', phone: '0898765432' }), 'PHONE_TAKEN');
  await both('เบอร์ผิดรูปแบบ', prof({ firstName: 'สมชาติ', phone: '12345' }), 'BAD_PHONE');
  await both('ไม่กรอกวันเกิด', prof({ firstName: 'สมชาติ', birthDate: '' }), 'BAD_BIRTHDATE');
  await both('เปลี่ยนเบอร์ใหม่', prof({ firstName: 'สมชาติ', phone: '0611111111' }), 'ok');
  await both('แก้วันเกิดครั้งแรก (เป็นเดือนนี้)', prof({ firstName: 'สมชาติ', phone: '0611111111', birthDate: '1991-' + month + '-01' }), 'ok');
  await both('แก้วันเกิดครั้งที่สอง → ล็อก', prof({ firstName: 'สมชาติ', phone: '0611111111', birthDate: '1992-' + month + '-01' }), 'BIRTH_LOCKED');
  await both('เปิดหน้าลูกค้า: ข้อมูลใหม่ + วันเกิดล็อก', { action: 'bootstrap', idToken: tok('U1') }, 'ok');

  console.log('\n[7] ของขวัญวันเกิด');
  await both('ร้านยังไม่มีของขวัญวันเกิด / ไม่ใช่เดือนเกิด', { action: 'claimBirthday', idToken: tok('U2'), requestId: rid() }, 'NOT_BIRTH_MONTH');
  remember('U3', await both('คนที่ 3 สมัคร (เกิดเดือนนี้)', reg('U3', { phone: '0822222222', birthDate: '1985-' + month + '-20' }), 'ok'));
  await both('สมัครยังไม่ครบ 30 วัน', { action: 'claimBirthday', idToken: tok('U3'), requestId: rid() }, 'TOO_NEW');
  await setMember('U3', 'Joined_At', 'joined_at', new Date(Date.now() - 40 * U.DAY_MS));
  await both('ครบ 30 วันแล้ว แต่ร้านยังไม่ตั้งของขวัญ', { action: 'claimBirthday', idToken: tok('U3'), requestId: rid() }, 'REWARD_UNAVAILABLE');
  await both('เปิดหน้าลูกค้า: ไม่มีการ์ดวันเกิด (ไม่มีของขวัญ)', { action: 'bootstrap', idToken: tok('U3') }, 'ok');
  addRow('Rewards', { Reward_ID: 'R009', Name: 'เค้กวันเกิด', Description: 'รับได้ในเดือนเกิด', Points: 0, Valid_Days: '', Quota: '', Issued: 0, Sort: 9, Status: 'ACTIVE', Type: 'BIRTHDAY' });
  await db.query(`insert into rewards (shop_id, id, name, description, type, points, sort) values ($1, 'R009', 'เค้กวันเกิด', 'รับได้ในเดือนเกิด', 'BIRTHDAY', 0, 9)`, [SHOP]);
  await both('เปิดหน้าลูกค้า: การ์ดวันเกิด "ยังไม่รับ" + ของขวัญไม่อยู่ในรายการแลกปกติ', { action: 'bootstrap', idToken: tok('U3') }, 'ok');
  await both('ปุ่มแลกปกติแลกของขวัญวันเกิดไม่ได้', { action: 'redeem', idToken: tok('U3'), rewardId: 'R009', requestId: rid() }, 'REWARD_UNAVAILABLE');
  const brq = rid();
  await both('รับของขวัญวันเกิด', { action: 'claimBirthday', idToken: tok('U3'), requestId: brq }, 'ok');
  await both('ส่งรหัสคำขอเดิมซ้ำ → ผลเดิม', { action: 'claimBirthday', idToken: tok('U3'), requestId: brq }, 'ok');
  await both('กดรับอีกครั้ง (รหัสใหม่) → บอกว่ารับไปแล้ว', { action: 'claimBirthday', idToken: tok('U3'), requestId: rid() }, 'ok');
  await both('เปิดหน้าลูกค้า: การ์ดวันเกิด "รับแล้ว"', { action: 'bootstrap', idToken: tok('U3') }, 'ok');
  await setMember('U1', 'Joined_At', 'joined_at', new Date(Date.now() - 40 * U.DAY_MS));
  await both('เพิ่งแก้วันเกิดใน 30 วัน → ยังไม่ได้สิทธิ์', { action: 'claimBirthday', idToken: tok('U1'), requestId: rid() }, 'TOO_NEW');
  await both('เปิดหน้าลูกค้า: ไม่มีการ์ดวันเกิด (เพิ่งแก้วันเกิด)', { action: 'bootstrap', idToken: tok('U1') }, 'ok');
  remember('U4', await both('คนที่ 4 สมัคร (เกิดเดือนนี้)', reg('U4', { phone: '0833333333', birthDate: '1995-' + month + '-02' }), 'ok'));
  await setMember('U4', 'Joined_At', 'joined_at', new Date(Date.now() - 40 * U.DAY_MS));
  await setReward('R009', 'Points', 'points', 50);
  await both('ของขวัญใช้ 50 แต้ม แต่มี 20', { action: 'claimBirthday', idToken: tok('U4'), requestId: rid() }, 'NOT_ENOUGH');
  await setMember('U4', 'Points', 'points', 100);
  await setReward('R009', 'Valid_Days', 'valid_days', 3);
  await both('รับของขวัญที่ใช้แต้ม (หักแต้ม + อายุคูปอง 3 วัน)', { action: 'claimBirthday', idToken: tok('U4'), requestId: rid() }, 'ok');
  await both('เปิดหน้าลูกค้า: ประวัติแลกของขวัญ', { action: 'bootstrap', idToken: tok('U4') }, 'ok');
  await setReward('R009', 'Quota', 'quota', 2);
  remember('U5', await both('คนที่ 5 สมัคร', reg('U5', { phone: '0844444444', birthDate: '1996-' + month + '-03' }), 'ok'));
  await setMember('U5', 'Joined_At', 'joined_at', new Date(Date.now() - 40 * U.DAY_MS));
  await both('ของขวัญหมดโควตา → การ์ดไม่แสดง', { action: 'bootstrap', idToken: tok('U5') }, 'ok');
  await both('ของขวัญหมดโควตา → รับไม่ได้', { action: 'claimBirthday', idToken: tok('U5'), requestId: rid() }, 'REWARD_UNAVAILABLE');

  console.log('\n[8] แต้มพิเศษ / โปรโมชัน / หน้าตาร้าน');
  const day = U.dayCode(now);
  addRow('Point_Rules', { Rule_ID: 'PR001', Name: 'วันนี้แต้ม 2 เท่า', Multiplier: '2', Days: day, Show_Badge: 'YES', Status: 'ACTIVE', Created_At: now });
  addRow('Point_Rules', { Rule_ID: 'PR002', Name: 'ไม่แสดงป้าย', Multiplier: '3', Days: day, Show_Badge: 'NO', Status: 'ACTIVE', Created_At: now });
  addRow('Point_Rules', { Rule_ID: 'PR003', Name: 'หมดเขตแล้ว', Multiplier: '3', Days: day, Show_Badge: 'YES', End_Date: dayOffset(-1), Status: 'ACTIVE', Created_At: now });
  // เวลาสร้างต้องเรียงเหมือนลำดับแถวในชีต (หลังบ้านแสดงกติกาตามลำดับที่สร้าง)
  await db.query(`insert into point_rules (shop_id, id, name, multiplier, days, show_badge, end_date, created_at) values
    ($1, 'PR001', 'วันนี้แต้ม 2 เท่า', 2, array[$2], true, null, $4), ($1, 'PR002', 'ไม่แสดงป้าย', 3, array[$2], false, null, $4),
    ($1, 'PR003', 'หมดเขตแล้ว', 3, array[$2], true, $3::date, $4)`, [SHOP, day, dayOffset(-1), now]);
  addRow('Promotions', { Promo_ID: 'P002', Title: 'หมดแล้ว', End_Date: dayOffset(-1), Sort: 2, Status: 'ACTIVE' });
  addRow('Promotions', { Promo_ID: 'P003', Title: 'เริ่มพรุ่งนี้', Start_Date: dayOffset(1), Sort: 3, Status: 'ACTIVE' });
  addRow('Promotions', { Promo_ID: 'P004', Title: 'ลิงก์อันตราย', Link: 'javascript:alert(1)', Sort: 0, Status: 'ACTIVE' });
  await db.query(`insert into promotions (shop_id, id, title, end_date, sort) values ($1, 'P002', 'หมดแล้ว', $2::date, 2)`, [SHOP, dayOffset(-1)]);
  await db.query(`insert into promotions (shop_id, id, title, start_date, sort) values ($1, 'P003', 'เริ่มพรุ่งนี้', $2::date, 3)`, [SHOP, dayOffset(1)]);
  await db.query(`insert into promotions (shop_id, id, title, link, sort) values ($1, 'P004', 'ลิงก์อันตราย', '', 0)`, [SHOP]);
  await both('ป้ายแต้มพิเศษวันนี้ + โปรโมชันตามช่วงเวลา + ตัดลิงก์อันตราย', { action: 'bootstrap', idToken: tok('U1') }, 'ok');
  [['SHOP_NAME', 'name', 'ร้านทดลอง'], ['COLOR_PRIMARY', 'colors.primary', '#aa0000'], ['TEXT_POINT_UNIT', 'texts.pointUnit', 'ดาว'], ['THEME', 'theme', 'luxury']]
    .forEach(([k, , v]) => setCell('Settings', 'Key', k, 'Value', v));
  await db.query(`update shops set name = 'ร้านทดลอง', brand = jsonb_set(jsonb_set(jsonb_set(brand, '{colors,primary}', '"#aa0000"'), '{texts,pointUnit}', '"ดาว"'), '{theme}', '"luxury"') where id = $1`, [SHOP]);
  await both('หน้าตาร้าน (ชื่อ สี คำเรียกแต้ม สไตล์)', { action: 'bootstrap', idToken: tok('U1'), withBrand: true }, 'ok');

  // ===================== รอบ 2: พนักงาน =====================
  async function setStaff(id, status, role, branches) {
    setCell('Staff', 'LINE_User_ID', id, 'Status', status);
    setCell('Staff', 'LINE_User_ID', id, 'Role', role);
    setCell('Staff', 'LINE_User_ID', id, 'Branches', (branches || []).join(','));
    await db.query('update staff set status = $3, role = $4, branches = $5 where shop_id = $1 and line_user_id = $2',
      [SHOP, id, status, role, branches && branches.length ? branches : null]);
  }
  async function setCoupon(codes, sheetCol, dbCol, val, dbVal) {
    setCell('Coupons', 'Coupon_Code', codes.A, sheetCol, val);
    await db.query(`update coupons set ${dbCol} = $3 where shop_id = $1 and code = $2`, [SHOP, codes.B, dbVal === undefined ? val : dbVal]);
  }
  async function setRule(id, sheetCol, dbCol, val, dbVal) {
    setCell('Point_Rules', 'Rule_ID', id, sheetCol, val);
    await db.query(`update point_rules set ${dbCol} = $3 where shop_id = $1 and id = $2`, [SHOP, id, dbVal === undefined ? val : dbVal]);
  }
  const mid = (user) => (side) => ids[user][side];
  const S1 = tok('S1', 'แคชเชียร์ หนึ่ง');
  const S2 = tok('S2', 'เจ้าของร้าน');
  const buy = (user, amount, extra) => (side) => Object.assign({ action: 'addPurchase', idToken: S1, memberId: ids[user][side], amount, requestId: rid() }, extra);

  console.log('\n[9] พนักงาน: ขอสิทธิ์ / อนุมัติ / บทบาท');
  await both('เปิดหน้าพนักงานครั้งแรก → ส่งคำขอสิทธิ์ (รออนุมัติ)', { action: 'staffMe', idToken: S1 }, 'ok');
  await both('เปิดซ้ำ → ยังรออนุมัติ (ไม่เพิ่มชื่อซ้ำ)', { action: 'staffMe', idToken: S1 }, 'ok');
  await both('ยังไม่อนุมัติ → ค้นลูกค้าไม่ได้', { action: 'staffLookup', idToken: S1, query: '0898765432' }, 'NOT_STAFF');
  await setStaff('S1', 'ACTIVE', 'CASHIER');
  await both('อนุมัติแล้ว: ค่าร้าน + แต้มพิเศษวันนี้ (ยังไม่มีสาขา)', { action: 'staffMe', idToken: S1 }, 'ok');
  await both('แคชเชียร์ปรับแต้มไม่ได้', (s) => ({ action: 'adjustPoints', idToken: S1, memberId: ids.U1[s], points: 5, reason: 'ทดสอบ', requestId: rid() }), 'NO_ROLE');
  await both('คนที่ไม่ใช่พนักงาน', { action: 'staffRecent', idToken: tok('U1') }, 'NOT_STAFF');
  // บทบาทสะกดผิด (เช่น BOSS) เกิดได้แค่ในชีต — ฐานข้อมูลใหม่ไม่ยอมบันทึกตั้งแต่ต้น จึงไม่ต้องเทียบ
  await both('คนที่ 2 ขอสิทธิ์', { action: 'staffMe', idToken: tok('S9', 'x') }, 'ok');
  await setStaff('S9', 'DISABLED', 'CASHIER');
  await both('พนักงานที่ถูกปิด → ใช้ไม่ได้', { action: 'staffRecent', idToken: tok('S9') }, 'NOT_STAFF');
  await both('พนักงานที่ถูกปิด → หน้าพนักงานบอกสถานะ', { action: 'staffMe', idToken: tok('S9') }, 'ok');

  console.log('\n[10] ค้นลูกค้า / คูปอง');
  await both('ค้นว่าง', { action: 'staffLookup', idToken: S1, query: '  ' }, 'BAD_QUERY');
  await both('ค้นยาวเกิน', { action: 'staffLookup', idToken: S1, query: 'x'.repeat(41) }, 'BAD_QUERY');
  await both('ค้นด้วยเบอร์ (เห็น 4 ตัวท้าย + คูปองที่ใช้ได้)', { action: 'staffLookup', idToken: S1, query: '089-876-5432' }, 'ok');
  await both('ค้นด้วยเบอร์ +66', { action: 'staffLookup', idToken: S1, query: '+66898765432' }, 'ok');
  await both('ค้นด้วยรหัสสมาชิก (ตัวเล็ก)', (s) => ({ action: 'staffLookup', idToken: S1, query: ids.U1[s].toLowerCase() }), 'ok');
  await both('ไม่พบสมาชิก', { action: 'staffLookup', idToken: S1, query: '0800000000' }, 'NOT_FOUND');
  const c1 = await both('U1 แลกของรางวัล (ไว้ทดสอบคูปอง)', { action: 'redeem', idToken: tok('U1'), rewardId: 'R001', requestId: rid() }, 'ok');
  const code1 = { A: c1.a.coupon.code, B: c1.b.coupon.code };
  await both('ค้นด้วยรหัสคูปอง', (s) => ({ action: 'staffLookup', idToken: S1, query: code1[s] }), 'ok');
  await both('ไม่พบคูปอง', { action: 'staffLookup', idToken: S1, query: 'CP-ZZZZZZZZ' }, 'NOT_FOUND');

  console.log('\n[11] บันทึกยอดซื้อ');
  await both('รหัสสมาชิกผิดรูปแบบ', { action: 'addPurchase', idToken: S1, memberId: 'x', amount: 100, requestId: rid() }, 'BAD_MEMBER_ID');
  await both('ยอด 0 บาท', buy('U1', 0), 'BAD_AMOUNT');
  await both('ยอดเป็นข้อความ', buy('U1', 'abc'), 'BAD_AMOUNT');
  await both('ยอดเกินต่อบิล', buy('U1', 20001), 'OVER_MAX');
  await both('ไม่มีรหัสคำขอ', buy('U1', 100, { requestId: '' }), 'BAD_REQUEST_ID');
  await both('ไม่พบสมาชิก', { action: 'addPurchase', idToken: S1, memberId: 'KW-ZZZZZZ', amount: 100, requestId: rid() }, 'NOT_FOUND');
  await both('ยอด 1,250 + แต้มพิเศษ ×3 (กติกาที่ให้มากสุด)', buy('U1', 1250), 'ok');
  await both('ยอด 10 บาท (ไม่ถึงเกณฑ์รับแต้ม)', buy('U1', 10), 'ok');
  await both('ยอดทศนิยม 99.999 → ปัด 100', buy('U1', 99.999), 'ok');
  await both('มีหมายเหตุ → ใช้หมายเหตุเป็นรายละเอียด', buy('U1', 300, { note: 'โต๊ะ 5 <b>' }), 'ok');
  await setRule('PR001', 'Status', 'status', 'INACTIVE');
  await setRule('PR002', 'Status', 'status', 'INACTIVE');
  await both('ปิดแต้มพิเศษ → ยอด 1,250 ได้ 62 แต้มปกติ', buy('U1', 1250), 'ok');
  const later = new Date(); // เวลาจริงตอนนี้ (หลัง PR001–003 และก่อนกติกาที่หลังบ้านจะเพิ่มทีหลัง)
  addRow('Point_Rules', { Rule_ID: 'PR004', Name: 'ซื้อครบพันได้ 2 เท่า', Multiplier: '2', Days: '', Min_Amount: 1000, Show_Badge: 'NO', Status: 'ACTIVE', Created_At: later });
  await db.query(`insert into point_rules (shop_id, id, name, multiplier, days, min_amount, created_at) values ($1, 'PR004', 'ซื้อครบพันได้ 2 เท่า', 2, $2, 1000, $3)`, [SHOP, U.DAY_CODES, later]);
  await both('ยอด 999 (ไม่ถึงขั้นต่ำของแต้มพิเศษ)', buy('U1', 999), 'ok');
  await both('ยอด 1,000 (ถึงขั้นต่ำ ×2)', buy('U1', 1000), 'ok');
  const prq = rid();
  await both('บันทึกยอด (เก็บรหัสคำขอไว้)', buy('U2', 500, { requestId: prq }), 'ok');
  await both('ส่งรหัสคำขอเดิมซ้ำ → ผลเดิม ไม่บวกซ้ำ', buy('U2', 500, { requestId: prq }), 'ok');
  await setMember('U2', 'Status', 'status', 'BLOCKED');
  await both('สมาชิกถูกระงับ → บันทึกยอดไม่ได้', buy('U2', 100), 'MEMBER_BLOCKED');
  await setMember('U2', 'Status', 'status', 'ACTIVE');
  await both('เปิดหน้าลูกค้า: ประวัติซื้อ + ยอดสะสม + จำนวนครั้ง', { action: 'bootstrap', idToken: tok('U1') }, 'ok');

  console.log('\n[12] ใช้คูปอง');
  await both('รหัสคูปองผิดรูปแบบ', { action: 'useCoupon', idToken: S1, code: 'abc', requestId: rid() }, 'BAD_CODE');
  await both('ไม่พบคูปอง', { action: 'useCoupon', idToken: S1, code: 'CP-ZZZZZZZZ', requestId: rid() }, 'NOT_FOUND');
  const urq = rid();
  await both('ใช้คูปอง (ตัวเล็กก็ได้)', (s) => ({ action: 'useCoupon', idToken: S1, code: code1[s].toLowerCase(), requestId: urq }), 'ok');
  await both('ส่งรหัสคำขอเดิมซ้ำ → ผลเดิม', (s) => ({ action: 'useCoupon', idToken: S1, code: code1[s], requestId: urq }), 'ok');
  await both('ใช้ซ้ำ → บอกเวลาที่ใช้ไปแล้ว', (s) => ({ action: 'useCoupon', idToken: S1, code: code1[s], requestId: rid() }), 'USED');
  const c2 = await both('U1 แลกอีกใบ', { action: 'redeem', idToken: tok('U1'), rewardId: 'R001', requestId: rid() }, 'ok');
  const code2 = { A: c2.a.coupon.code, B: c2.b.coupon.code };
  await setCoupon(code2, 'Expires_At', 'expires_at', new Date(Date.now() - 60000));
  await both('คูปองหมดอายุ', (s) => ({ action: 'useCoupon', idToken: S1, code: code2[s], requestId: rid() }), 'EXPIRED');
  await both('ค้นคูปองหมดอายุ → สถานะ EXPIRED', (s) => ({ action: 'staffLookup', idToken: S1, query: code2[s] }), 'ok');
  await setCoupon(code2, 'Status', 'status', 'CANCELLED');
  await both('คูปองที่ยกเลิก', (s) => ({ action: 'useCoupon', idToken: S1, code: code2[s], requestId: rid() }), 'INVALID_COUPON');
  const c3 = await both('U1 แลกอีกใบ', { action: 'redeem', idToken: tok('U1'), rewardId: 'R001', requestId: rid() }, 'ok');
  const code3 = { A: c3.a.coupon.code, B: c3.b.coupon.code };
  await setMember('U1', 'Status', 'status', 'BLOCKED');
  await both('เจ้าของคูปองถูกระงับ → ใช้ไม่ได้', (s) => ({ action: 'useCoupon', idToken: S1, code: code3[s], requestId: rid() }), 'MEMBER_BLOCKED');
  await setMember('U1', 'Status', 'status', 'ACTIVE');

  console.log('\n[13] ปรับแต้ม (เจ้าของร้าน/ผู้จัดการ)');
  await both('เจ้าของร้านเปิดหน้าพนักงาน', { action: 'staffMe', idToken: S2 }, 'ok');
  await setStaff('S2', 'ACTIVE', 'OWNER');
  const adj = (user, points, reason, extra) => (s) => Object.assign({ action: 'adjustPoints', idToken: S2, memberId: ids[user][s], points, reason, requestId: rid() }, extra);
  await both('แต้ม 0', adj('U1', 0, 'ทดสอบ'), 'BAD_POINTS');
  await both('แต้มทศนิยม', adj('U1', 1.5, 'ทดสอบ'), 'BAD_POINTS');
  await both('แต้มเกินล้าน', adj('U1', 1000001, 'ทดสอบ'), 'BAD_POINTS');
  await both('ไม่มีเหตุผล', adj('U1', 5, ' ab '), 'NO_REASON');
  await both('ไม่พบสมาชิก', { action: 'adjustPoints', idToken: S2, memberId: 'KW-ZZZZZZ', points: 5, reason: 'ทดสอบ', requestId: rid() }, 'NOT_FOUND');
  await both('ลดจนติดลบ', adj('U2', -999999, 'ทดสอบลด'), 'NEGATIVE');
  await both('เพิ่ม 50 แต้ม', adj('U1', 50, 'ชดเชยบิลผิด'), 'ok');
  await both('ลด 10 แต้ม', adj('U1', -10, 'แก้รายการซ้ำ'), 'ok');
  await setMember('U2', 'Status', 'status', 'BLOCKED');
  await both('สมาชิกถูกระงับ → ปรับแต้มได้ (เหมือนเดิม)', adj('U2', 1, 'ทดสอบระงับ'), 'ok');
  await setMember('U2', 'Status', 'status', 'ACTIVE');
  await both('รายการล่าสุด 15 รายการ (ชื่อลูกค้า + ชื่อพนักงาน)', { action: 'staffRecent', idToken: S1 }, 'ok');
  await both('ค้นลูกค้าหลังมีรายการ (ยอดสะสม + มาครั้งล่าสุด)', (s) => ({ action: 'staffLookup', idToken: S1, query: ids.U1[s] }), 'ok');

  console.log('\n[14] หลายสาขา');
  for (const [id, name, st, sort] of [['B001', 'สาขาสยาม', 'ACTIVE', 1], ['B002', 'สาขาอารีย์', 'ACTIVE', 2], ['B003', 'สาขาปิด', 'INACTIVE', 3]]) {
    addRow('Branches', { Branch_ID: id, Name: name, Status: st, Sort: sort, Created_At: now });
    await db.query('insert into branches (shop_id, id, name, status, sort) values ($1, $2, $3, $4, $5)', [SHOP, id, name, st, sort]);
  }
  await setStaff('S1', 'ACTIVE', 'CASHIER', ['B001']);
  await both('แคชเชียร์สาขาเดียว → เห็นแค่สาขาของตัวเอง', { action: 'staffMe', idToken: S1 }, 'ok');
  await both('เจ้าของร้าน → เห็นทุกสาขาที่เปิด', { action: 'staffMe', idToken: S2 }, 'ok');
  await both('ไม่เลือกสาขา', buy('U1', 100), 'NO_BRANCH');
  await both('สาขาที่ไม่ได้อยู่', buy('U1', 100, { branchId: 'B002' }), 'BAD_BRANCH');
  await both('สาขาที่ปิดแล้ว', buy('U1', 100, { branchId: 'B003' }), 'BAD_BRANCH');
  await both('สาขาที่ไม่มีจริง', buy('U1', 100, { branchId: 'B999' }), 'BAD_BRANCH');
  await both('บันทึกที่สาขาตัวเอง (ตัวเล็กก็ได้)', buy('U1', 200, { branchId: 'b001' }), 'ok');
  await both('เจ้าของร้านบันทึกสาขาไหนก็ได้', (s) => ({ action: 'addPurchase', idToken: S2, memberId: ids.U2[s], amount: 300, branchId: 'B002', requestId: rid() }), 'ok');
  await both('รายการล่าสุดเฉพาะสาขาที่เลือก', { action: 'staffRecent', idToken: S1, branchId: 'B001' }, 'ok');
  await both('รายการล่าสุด สาขาที่ไม่ได้อยู่', { action: 'staffRecent', idToken: S1, branchId: 'B002' }, 'BAD_BRANCH');
  await both('ปรับแต้มจากหน้าพนักงานไม่เลือกสาขา → บันทึกเป็น "หลังบ้าน"', adj('U1', 3, 'ทดสอบสาขา'), 'ok');
  await both('ปรับแต้มเลือกสาขา', adj('U1', 2, 'ทดสอบสาขา', { branchId: 'B002' }), 'ok');
  const c4 = await both('U1 แลกอีกใบ', { action: 'redeem', idToken: tok('U1'), rewardId: 'R001', requestId: rid() }, 'ok');
  await both('ใช้คูปองที่สาขา', (s) => ({ action: 'useCoupon', idToken: S1, code: (s === 'A' ? c4.a : c4.b).coupon.code, branchId: 'B001', requestId: rid() }), 'ok');
  await both('ใช้คูปองไม่เลือกสาขา', (s) => ({ action: 'useCoupon', idToken: S1, code: code3[s], requestId: rid() }), 'NO_BRANCH');
  remember('U6', await both('ลูกค้าสมัครจาก QR สาขา B002', reg('U6', { phone: '0855555555', branch: 'b002' }), 'ok'));
  remember('U7', await both('ลูกค้าสมัครจาก QR สาขาที่ปิด → ออนไลน์', reg('U7', { phone: '0866666666', branch: 'B003' }), 'ok'));
  const joinedA = (u) => { const s = sheet('Members'); const h = s.data[0]; return s.data.find((r) => r[0] === ids[u].A)[h.indexOf('Joined_Branch')]; };
  const joinedB = async (u) => (await db.query('select joined_branch from members where shop_id = $1 and id = $2', [SHOP, ids[u].B])).rows[0].joined_branch;
  ok(joinedA('U6') === 'B002' && (await joinedB('U6')) === 'B002' && joinedA('U7') === 'ONLINE' && (await joinedB('U7')) === 'ONLINE',
    'สาขาที่สมัคร: สองระบบบันทึกเหมือนกัน (B002 / ONLINE)');
  await setRule('PR004', 'Branch', 'branch', 'B002');
  await setRule('PR004', 'Show_Badge', 'show_badge', 'YES', true);
  await both('ป้ายแต้มพิเศษเฉพาะสาขา (มีชื่อสาขา)', { action: 'bootstrap', idToken: tok('U1') }, 'ok');
  await both('แต้มพิเศษเฉพาะสาขา: บันทึกที่สาขาอื่นไม่ได้ ×2', buy('U1', 1000, { branchId: 'B001' }), 'ok');

  // ===================== รอบ 3: หลังบ้าน =====================
  const O = tok('S2', 'เจ้าของร้าน');
  const A3 = tok('S3', 'ผู้จัดการ');
  await both('ผู้จัดการขอสิทธิ์', { action: 'staffMe', idToken: A3 }, 'ok');
  await setStaff('S3', 'ACTIVE', 'ADMIN');
  const ago = (n) => dayOffset(-n);
  const range = { from: ago(60), to: today };
  // ระบบใหม่ไม่มีช่องโฟลเดอร์ Google Drive แล้ว (รูปย้ายไปที่เก็บรูปของ Supabase) → ตัดออกจากคำตอบระบบเดิมก่อนเทียบ
  const noDrive = (o) => { if (o.items) o.items = o.items.filter((x) => x.key !== 'IMAGE_FOLDER_ID'); return o; };
  // ลิงก์อันตรายของ P004 อยู่ได้แค่ในชีต (ฐานข้อมูลไม่ยอมบันทึกลิงก์ที่ไม่ใช่ https ตั้งแต่ต้น) → ให้สองฝั่งตั้งต้นเหมือนกัน
  setCell('Promotions', 'Promo_ID', 'P004', 'Link', '');

  console.log('\n[16] หลังบ้าน: เข้าใช้ / สิทธิ์');
  await both('แคชเชียร์เข้าหลังบ้านไม่ได้', { action: 'adminMe', idToken: S1 }, 'NO_ROLE');
  await both('เจ้าของร้านเปิดหลังบ้าน', { action: 'adminMe', idToken: O }, 'ok');
  await both('เปิดครั้งแรกพร้อมข้อมูลผู้ใช้ + สาขา + หน้าตาร้าน (withMe/withBrand)', { action: 'adminDashboard', idToken: A3, ...range, withMe: true, withBrand: true }, 'ok');
  await both('ผู้จัดการส่งออกไฟล์ไม่ได้', { action: 'adminExport', idToken: A3, kind: 'members' }, 'NO_ROLE');
  await both('ผู้จัดการแก้ตั้งค่าร้านไม่ได้', { action: 'adminSettingsSave', idToken: A3, values: { WELCOME_POINTS: 5 } }, 'NO_ROLE');

  console.log('\n[17] ภาพรวม');
  await both('ภาพรวม 60 วัน (ทุกสาขา + ตารางเทียบสาขา)', { action: 'adminDashboard', idToken: O, ...range }, 'ok');
  await both('ภาพรวม สาขา B001', { action: 'adminDashboard', idToken: O, ...range, branch: 'b001' }, 'ok');
  await both('ภาพรวม 7 วัน (กราฟรายวัน)', { action: 'adminDashboard', idToken: O, from: ago(6), to: today }, 'ok');
  await both('ภาพรวม 1 ปี (กราฟรายเดือน)', { action: 'adminDashboard', idToken: O, from: ago(364), to: today }, 'ok');
  await both('ช่วงวันผิด', { action: 'adminDashboard', idToken: O, from: today, to: ago(1) }, 'BAD_DATE');
  await both('ช่วงเกิน 366 วัน', { action: 'adminDashboard', idToken: O, from: ago(400), to: today }, 'BAD_DATE');
  await both('วันที่ไม่มีจริง', { action: 'adminDashboard', idToken: O, from: '2026-02-30', to: today }, 'BAD_DATE');
  await both('สาขาผิดรูปแบบ', { action: 'adminDashboard', idToken: O, ...range, branch: 'b-1!' }, 'BAD_BRANCH');

  console.log('\n[18] สมาชิก');
  for (const sort of ['joined', 'points', 'spend', 'lastVisit', 'name']) {
    await both('รายชื่อเรียงตาม ' + sort + ' (เจ้าของร้านเห็นเบอร์เต็ม)', { action: 'adminMembers', idToken: O, sort }, 'ok');
  }
  await both('ผู้จัดการเห็นเบอร์ 4 ตัวท้าย', { action: 'adminMembers', idToken: A3 }, 'ok');
  await both('ค้นชื่อ', { action: 'adminMembers', idToken: O, q: 'สมชาติ' }, 'ok');
  await both('ค้นรหัสสมาชิกบางส่วน', (s) => ({ action: 'adminMembers', idToken: O, q: ids.U2[s].slice(0, 5).toLowerCase() }), 'ok');
  await both('เจ้าของร้านค้นเบอร์บางส่วน', { action: 'adminMembers', idToken: O, q: '0898' }, 'ok');
  await both('ผู้จัดการค้นเบอร์บางส่วน → ไม่เจอ', { action: 'adminMembers', idToken: A3, q: '0898' }, 'ok');
  await both('ผู้จัดการค้นเบอร์เต็ม → เจอ', { action: 'adminMembers', idToken: A3, q: '089-876-5432' }, 'ok');
  await both('กรองสาขาที่สมัคร', { action: 'adminMembers', idToken: O, branch: 'B002' }, 'ok');
  await both('กรองเกิดเดือนนี้ (เจ้าของร้าน)', { action: 'adminMembers', idToken: O, birthMonth: true }, 'ok');
  await both('กรองเกิดเดือนนี้ (ผู้จัดการ → ไม่มีผล)', { action: 'adminMembers', idToken: A3, birthMonth: true }, 'ok');
  await setMember('U5', 'Status', 'status', 'BLOCKED');
  await both('กรองสมาชิกที่ถูกระงับ', { action: 'adminMembers', idToken: O, status: 'blocked' }, 'ok');
  await setMember('U5', 'Status', 'status', 'ACTIVE');
  await both('หน้าที่เกิน → หน้าสุดท้าย', { action: 'adminMembers', idToken: O, page: 99 }, 'ok');
  await both('สมาชิกรายคน (เจ้าของร้าน: วันเกิด ประวัติ คูปอง สาขาประจำ)', (s) => ({ action: 'adminMember', idToken: O, memberId: ids.U1[s] }), 'ok');
  await both('สมาชิกรายคน (ผู้จัดการ: ไม่เห็นวันเกิด/เบอร์เต็ม)', (s) => ({ action: 'adminMember', idToken: A3, memberId: ids.U2[s] }), 'ok');
  await both('ไม่พบสมาชิก', { action: 'adminMember', idToken: O, memberId: 'KW-ZZZZZZ' }, 'NOT_FOUND');

  console.log('\n[19] รายการแต้ม / คูปอง');
  await both('รายการแต้ม 60 วัน + สรุป + ชื่อพนักงาน', { action: 'adminTransactions', idToken: O, ...range }, 'ok');
  for (const type of ['EARN', 'REDEEM', 'ADJUST', 'WELCOME']) await both('กรองประเภท ' + type, { action: 'adminTransactions', idToken: O, ...range, type }, 'ok');
  await both('กรองพนักงาน', { action: 'adminTransactions', idToken: O, ...range, staff: 'แคชเชียร์ หนึ่ง' }, 'ok');
  await both('ค้นชื่อลูกค้า', { action: 'adminTransactions', idToken: O, ...range, q: 'สมหญิง' }, 'ok');
  await both('กรองสาขา', { action: 'adminTransactions', idToken: O, ...range, branch: 'B002' }, 'ok');
  await both('หน้าที่ 2', { action: 'adminTransactions', idToken: O, ...range, page: 2 }, 'ok');
  await both('คูปอง 60 วัน + นับตามสถานะ', { action: 'adminCoupons', idToken: O, ...range }, 'ok');
  for (const status of ['ACTIVE', 'USED', 'EXPIRED', 'CANCELLED']) await both('คูปองสถานะ ' + status, { action: 'adminCoupons', idToken: O, ...range, status }, 'ok');
  await both('คูปองที่ใช้ที่สาขา B001', { action: 'adminCoupons', idToken: O, ...range, branch: 'B001' }, 'ok');

  console.log('\n[20] พนักงาน');
  await both('รายชื่อพนักงาน (รออนุมัติขึ้นก่อน)', { action: 'adminStaff', idToken: O }, 'ok');
  await both('แก้สิทธิ์ตัวเอง', { action: 'adminStaffUpdate', idToken: O, userId: 'S2', role: 'CASHIER', status: 'ACTIVE' }, 'SELF_EDIT');
  await both('รหัสพนักงานผิด', { action: 'adminStaffUpdate', idToken: O, userId: '../x', role: 'CASHIER', status: 'ACTIVE' }, 'BAD_STAFF');
  await both('บทบาทผิด', { action: 'adminStaffUpdate', idToken: O, userId: 'S9', role: 'BOSS', status: 'ACTIVE' }, 'BAD_ROLE');
  await both('สถานะผิด', { action: 'adminStaffUpdate', idToken: O, userId: 'S9', role: 'CASHIER', status: 'X' }, 'BAD_STATUS');
  await both('ไม่พบพนักงาน', { action: 'adminStaffUpdate', idToken: O, userId: 'S404', role: 'CASHIER', status: 'ACTIVE' }, 'NOT_FOUND');
  await both('เจ้าของร้านอนุมัติ + ตั้งชื่อ + สาขา', { action: 'adminStaffUpdate', idToken: O, userId: 'S9', role: 'CASHIER', status: 'ACTIVE', name: 'น้องเก้า <x>', branches: ['b002', 'B002'] }, 'ok');
  await both('สาขาที่ไม่มี', { action: 'adminStaffUpdate', idToken: O, userId: 'S9', role: 'CASHIER', status: 'ACTIVE', branches: ['B999'] }, 'BAD_BRANCH');
  await both('ไม่เลือกสาขาเลย', { action: 'adminStaffUpdate', idToken: O, userId: 'S9', role: 'CASHIER', status: 'ACTIVE', branches: [] }, 'BAD_BRANCH');
  await both('ทุกสาขา (ALL)', { action: 'adminStaffUpdate', idToken: O, userId: 'S9', role: 'CASHIER', status: 'ACTIVE', branches: ['ALL'] }, 'ok');
  await both('ผู้จัดการตั้งคนเป็นผู้จัดการไม่ได้', { action: 'adminStaffUpdate', idToken: A3, userId: 'S9', role: 'ADMIN', status: 'ACTIVE' }, 'NO_ROLE');
  await both('ผู้จัดการแก้เจ้าของร้านไม่ได้', { action: 'adminStaffUpdate', idToken: A3, userId: 'S2', role: 'CASHIER', status: 'ACTIVE' }, 'NO_ROLE');
  await both('ผู้จัดการปิดสิทธิ์แคชเชียร์ได้', { action: 'adminStaffUpdate', idToken: A3, userId: 'S9', role: 'CASHIER', status: 'DISABLED' }, 'ok');
  await both('รายชื่อพนักงานหลังแก้', { action: 'adminStaff', idToken: A3 }, 'ok');

  console.log('\n[21] ของรางวัล / โปรโมชัน');
  const rw = (extra) => ({ action: 'adminRewardSave', idToken: O, requestId: rid(), reward: Object.assign({ name: 'ของรางวัลใหม่', points: 150, status: 'ACTIVE' }, extra) });
  await both('รายการของรางวัล (สถานะที่ลูกค้าเห็น)', { action: 'adminRewards', idToken: A3 }, 'ok');
  await both('ไม่ใส่ชื่อ', rw({ name: ' ' }), 'BAD_INPUT');
  await both('แต้ม 0 (ไม่ใช่ของขวัญวันเกิด)', rw({ points: 0 }), 'BAD_INPUT');
  await both('แต้มทศนิยม', rw({ points: '1.5' }), 'BAD_INPUT');
  await both('ลิงก์รูปไม่ใช่ https', rw({ image: 'http://x.com/a.png' }), 'BAD_IMAGE');
  await both('สถานะผิด', rw({ status: 'ON' }), 'BAD_STATUS');
  await both('วันสิ้นสุดก่อนวันเริ่ม', rw({ startDate: today, endDate: ago(1) }), 'BAD_DATE');
  await both('จำกัดต่อคนเกิน 1000', rw({ limitPerMember: 1001 }), 'BAD_INPUT');
  await both('เพิ่มของรางวัล (รหัสถัดไป + ลิงก์ Drive แปลงเป็นรูป)', rw({ image: 'https://drive.google.com/file/d/AAAAAAAAAAAAAAAAAAAAAAAAA/view', quota: '1,000', validDays: 7, startDate: today, sort: 5 }), 'ok');
  await both('เพิ่มของขวัญวันเกิด (แต้มว่าง = ฟรี)', rw({ name: 'เค้กปีหน้า', type: 'birthday', points: '', startDate: dayOffset(30) }), 'ok');
  await both('แก้ของรางวัล R001', { action: 'adminRewardSave', idToken: A3, requestId: rid(), reward: { id: 'R001', name: 'เครื่องดื่มเย็น', points: 90, status: 'ACTIVE', description: 'แก้แล้ว' } }, 'ok');
  await both('ลดจำนวนทั้งหมดต่ำกว่าที่แลกไปแล้ว', { action: 'adminRewardSave', idToken: O, requestId: rid(), reward: { id: 'R002', name: 'ขนม', points: 120, status: 'ACTIVE', quota: 1 } }, 'BAD_QUOTA');
  await both('แก้รางวัลที่ไม่มี', { action: 'adminRewardSave', idToken: O, requestId: rid(), reward: { id: 'R404', name: 'x', points: 1, status: 'ACTIVE' } }, 'NOT_FOUND');
  await both('รายการของรางวัลหลังแก้', { action: 'adminRewards', idToken: O }, 'ok');
  await both('เปิดหน้าลูกค้า: เห็นของรางวัลที่แก้ (ไม่เห็นที่ยังไม่ถึงวัน)', { action: 'bootstrap', idToken: tok('U2') }, 'ok');
  const pr = (extra) => ({ action: 'adminPromoSave', idToken: O, requestId: rid(), promo: Object.assign({ title: 'โปรใหม่', status: 'ACTIVE' }, extra) });
  await both('โปรโมชัน: ลิงก์อันตราย', pr({ link: 'javascript:alert(1)' }), 'BAD_LINK');
  await both('โปรโมชัน: ป้ายยาวเกิน', pr({ tag: 'x'.repeat(31) }), 'BAD_INPUT');
  await both('เพิ่มโปรโมชัน', pr({ subtitle: 'ทุกวันศุกร์', tag: 'ใหม่', link: 'https://example.com/promo', endDate: dayOffset(10) }), 'ok');
  await both('แก้โปรโมชัน P002 (เปิดอีกครั้ง)', pr({ id: 'P002', title: 'กลับมาแล้ว', endDate: '' }), 'ok');
  await both('รายการโปรโมชัน', { action: 'adminPromos', idToken: A3 }, 'ok');

  console.log('\n[22] ระงับ / แก้ข้อมูลสมาชิก');
  await both('ระงับโดยไม่มีเหตุผล', (s) => ({ action: 'adminMemberStatus', idToken: A3, memberId: ids.U6[s], status: 'BLOCKED' }), 'NO_REASON');
  await both('สถานะผิด', (s) => ({ action: 'adminMemberStatus', idToken: A3, memberId: ids.U6[s], status: 'X' }), 'BAD_STATUS');
  await both('ระงับสมาชิก (จดว่าใคร เมื่อไร เพราะอะไร)', (s) => ({ action: 'adminMemberStatus', idToken: A3, memberId: ids.U6[s], status: 'BLOCKED', reason: 'ทุจริตแต้ม' }), 'ok');
  await both('เปิดใช้อีกครั้ง', (s) => ({ action: 'adminMemberStatus', idToken: O, memberId: ids.U6[s], status: 'ACTIVE' }), 'ok');
  const mu = (user, extra) => (s) => Object.assign({ action: 'adminMemberUpdate', idToken: O, memberId: ids[user][s], firstName: 'มานี', lastName: 'มีนา', birthDate: '1990-05-05', phone: '0855555555' }, extra);
  await both('ผู้จัดการแก้ข้อมูลลูกค้าไม่ได้', (s) => Object.assign(mu('U6')(s), { idToken: A3 }), 'NO_ROLE');
  await both('เจ้าของร้านแก้ชื่อ + วันเกิด (ไม่จำกัดครั้ง)', mu('U6'), 'ok');
  await both('แก้วันเกิดอีกครั้ง', mu('U6', { birthDate: '1991-06-06' }), 'ok');
  await both('เบอร์ซ้ำกับคนอื่น', mu('U6', { phone: '0866666666' }), 'PHONE_TAKEN');
  await both('ส่งรับข่าวสารมา → ไม่มีผล (ลูกค้าเลือกเองเท่านั้น)', mu('U6', { birthDate: '1991-06-06', consentMarketing: true }), 'ok');
  await both('สมาชิกรายคนหลังแก้ (ประวัติการแก้ + หมายเหตุ)', (s) => ({ action: 'adminMember', idToken: O, memberId: ids.U6[s] }), 'ok');

  console.log('\n[23] ตั้งค่าร้าน / หน้าตาร้าน');
  await both('ค่าร้านทั้งหมด', { action: 'adminSettings', idToken: A3 }, 'ok', noDrive);
  await both('ไม่มีค่าที่แก้ได้', { action: 'adminSettingsSave', idToken: O, values: { LIFF_ID: '1-x' } }, 'BAD_INPUT');
  await both('อัตราแต้มเป็น 0', { action: 'adminSettingsSave', idToken: O, values: { POINT_RATE_BAHT: 0 } }, 'BAD_INPUT');
  await both('แต้มต้อนรับทศนิยม', { action: 'adminSettingsSave', idToken: O, values: { WELCOME_POINTS: '1.5' } }, 'BAD_INPUT');
  await both('แก้อัตราแต้ม + แต้มต้อนรับ (ค่าเดิมไม่นับ)', { action: 'adminSettingsSave', idToken: O, values: { POINT_RATE_BAHT: '25.50', WELCOME_POINTS: '30', COUPON_DAYS: 30 } }, 'ok', noDrive);
  await both('บิลถัดไปใช้อัตราใหม่ทันที (25.5 บาท/แต้ม)', buy('U2', 1000, { branchId: 'B001' }), 'ok');
  await both('ตั้งค่ากลับ', { action: 'adminSettingsSave', idToken: O, values: { POINT_RATE_BAHT: '20', WELCOME_POINTS: '20' } }, 'ok', noDrive);
  await both('หน้าตาร้าน', { action: 'adminBrand', idToken: A3 }, 'ok');
  await both('ผู้จัดการแก้หน้าตาร้านไม่ได้', { action: 'adminBrandSave', idToken: A3, values: { SHOP_NAME: 'x' } }, 'NO_ROLE');
  await both('สีผิดรูปแบบ', { action: 'adminBrandSave', idToken: O, values: { COLOR_BUTTON: 'red' } }, 'BAD_INPUT');
  await both('สไตล์ที่ไม่มี', { action: 'adminBrandSave', idToken: O, values: { THEME: 'neon' } }, 'BAD_INPUT');
  await both('ชื่อร้านยาวเกิน', { action: 'adminBrandSave', idToken: O, values: { SHOP_NAME: 'ก'.repeat(61) } }, 'BAD_INPUT');
  await both('แก้ชื่อ สี โลโก้ (ไม่แก้นโยบาย → ฉบับเดิม)', { action: 'adminBrandSave', idToken: O, values: { SHOP_NAME: 'ร้านใหม่', COLOR_BUTTON: '#00aa00', LOGO_URL: 'https://example.com/logo.png', TEXT_GREETING: 'ยินดีต้อนรับ' } }, 'ok');
  await both('แก้นโยบาย → ฉบับที่ 2', { action: 'adminBrandSave', idToken: O, values: { PRIVACY_TEXT: 'บรรทัดแรก\r\n\r\n\r\nบรรทัด <สอง>' } }, 'ok');
  await both('บันทึกค่าเดิมซ้ำ → ฉบับไม่เพิ่ม', { action: 'adminBrandSave', idToken: O, values: { PRIVACY_TEXT: 'บรรทัดแรก\n\nบรรทัด  สอง ' } }, 'ok');
  await both('ลูกค้าเห็นหน้าตาร้านใหม่ + ฉบับนโยบาย', { action: 'bootstrap', idToken: tok('U1'), withBrand: true }, 'ok');
  remember('U8', await both('ลูกค้าใหม่สมัคร → ยอมรับนโยบายฉบับที่ 2', reg('U8', { phone: '0877777777' }), 'ok'));

  console.log('\n[24] สาขา / แต้มพิเศษ (หลังบ้าน)');
  await both('รายชื่อสาขา + จำนวนพนักงาน/สมาชิก', { action: 'adminBranches', idToken: A3 }, 'ok');
  await both('ชื่อสาขาซ้ำ (ไม่สนตัวพิมพ์)', { action: 'adminBranchSave', idToken: O, requestId: rid(), branch: { name: 'สาขาสยาม' } }, 'DUP_BRANCH');
  await both('เพิ่มสาขา (รหัสถัดไป B004)', { action: 'adminBranchSave', idToken: O, requestId: rid(), branch: { name: 'สาขาใหม่' } }, 'ok');
  await both('แก้ชื่อ + ปิดสาขา', { action: 'adminBranchSave', idToken: O, requestId: rid(), branch: { id: 'b002', name: 'สาขาอารีย์ (ปิดปรับปรุง)', status: 'INACTIVE', sort: 9 } }, 'ok');
  await both('แก้สาขาที่ไม่มี', { action: 'adminBranchSave', idToken: O, requestId: rid(), branch: { id: 'B404', name: 'x' } }, 'NOT_FOUND');
  await both('ผู้จัดการเพิ่มสาขาไม่ได้', { action: 'adminBranchSave', idToken: A3, requestId: rid(), branch: { name: 'x' } }, 'NO_ROLE');
  await both('กติกาแต้มพิเศษทั้งหมด (สถานะวันนี้)', { action: 'adminRules', idToken: A3 }, 'ok');
  const rs = (extra) => ({ action: 'adminRuleSave', idToken: O, requestId: rid(), rule: Object.assign({ name: 'กติกาใหม่', multiplier: 2, days: ['MON'], status: 'ACTIVE' }, extra) });
  await both('ตัวคูณที่ไม่มี', rs({ multiplier: 5 }), 'BAD_INPUT');
  await both('ไม่เลือกวัน', rs({ days: ['XYZ'] }), 'BAD_INPUT');
  await both('สาขาที่ไม่มี', rs({ branch: 'B999' }), 'BAD_BRANCH');
  await both('ยอดขั้นต่ำติดลบ', rs({ minAmount: -1 }), 'BAD_INPUT');
  await both('เพิ่มกติกา (วันซ้ำ/เรียงวันให้ + ยอดขั้นต่ำ)', rs({ days: ['sun', 'MON', 'mon'], minAmount: '1,500', showBadge: true, branch: 'b001', endDate: dayOffset(5) }), 'ok');
  await both('แก้กติกา PR004 (ยอดขั้นต่ำ 0 = ทุกบิล)', rs({ id: 'PR004', name: 'ทุกบิล ×1.5', multiplier: 1.5, days: [day], minAmount: 0 }), 'ok');
  await both('กติกาหลังแก้', { action: 'adminRules', idToken: O }, 'ok');
  await both('แก้กติกาที่ไม่มี', rs({ id: 'PR404' }), 'NOT_FOUND');

  console.log('\n[25] ส่งออก / อัปโหลดรูป');
  // ลำดับแถวในไฟล์ไม่มีความหมาย (ชีตเรียงตามลำดับที่เพิ่ม / ฐานข้อมูลเรียงตามวันสมัคร ซึ่งชุดทดสอบย้อนไว้บางคน) → เรียงก่อนเทียบ
  // เรียงด้วยช่องที่เหมือนกันทั้งสองระบบ (ไม่ใช้รหัสสุ่ม) / รหัสรายการ (สุ่ม ไม่เคยเห็นมาก่อน) ตัดทิ้ง
  const sortBy = (keyOf) => (o) => { o.rows.sort((x, y) => (keyOf(x) < keyOf(y) ? -1 : keyOf(x) > keyOf(y) ? 1 : 0)); return o; };
  await both('ส่งออกสมาชิก (เบอร์มีขีด + คอลัมน์สาขา)', { action: 'adminExport', idToken: O, kind: 'members' }, 'ok', sortBy((r) => r[3]));
  await both('ส่งออกรายการแต้ม 60 วัน', { action: 'adminExport', idToken: O, kind: 'transactions', ...range }, 'ok', (o) => {
    o.columns.shift();
    o.rows = o.rows.map((r) => r.slice(1));
    return sortBy((r) => JSON.stringify([r[0]].concat(r.slice(2))))(o);
  });
  await both('ส่งออกแบบที่ไม่มี', { action: 'adminExport', idToken: O, kind: 'staff' }, 'BAD_EXPORT');
  await both('อัปโหลด: ชนิดไฟล์ไม่รองรับ', { action: 'adminUploadImage', idToken: A3, mime: 'image/gif', data: 'R0lGOD' }, 'BAD_IMAGE');
  await both('อัปโหลด: ข้อมูลเสีย', { action: 'adminUploadImage', idToken: A3, mime: 'image/png', data: '!!!' }, 'BAD_IMAGE');
  await both('อัปโหลด: ไม่ใช่รูปจริง (หัวไฟล์ไม่ตรง)', { action: 'adminUploadImage', idToken: A3, mime: 'image/png', data: Buffer.from('hello world, not a png').toString('base64') }, 'BAD_IMAGE');
  await both('อัปโหลด: ใหญ่เกิน 2MB', { action: 'adminUploadImage', idToken: A3, mime: 'image/jpeg', data: Buffer.alloc(2 * 1024 * 1024 + 10, 0xFF).toString('base64') }, 'BAD_IMAGE');

  console.log('\n[15] ข้อมูลที่บันทึกจริงในสองระบบตรงกัน (ไม่ใช่แค่คำตอบ)');
  const sheetRows = (n) => { const s = sheet(n); const h = s.data[0]; return s.data.slice(1).filter((r) => r[0] !== '' && r[0] != null).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]]))); };
  const summary = async (user) => {
    const a = sheetRows('Members').find((r) => r.Member_ID === ids[user].A);
    const txA = sheetRows('Transactions').filter((r) => r.Member_ID === ids[user].A);
    const cpA = sheetRows('Coupons').filter((r) => r.Member_ID === ids[user].A);
    const b = (await db.query('select points, total_spend::float8 as spend, visit_count, status, marketing_consent from members where shop_id = $1 and id = $2', [SHOP, ids[user].B])).rows[0];
    const txB = (await db.query('select type, points, amount::float8 as amount, branch, staff, detail from transactions where shop_id = $1 and member_id = $2', [SHOP, ids[user].B])).rows;
    const cpB = (await db.query('select status, used_branch from coupons where shop_id = $1 and member_id = $2', [SHOP, ids[user].B])).rows;
    const txKey = (t) => [t.type, t.points, Number(t.amount), String(t.branch || ''), String(t.staff || ''), String(t.detail || '')].join('|');
    return {
      A: { points: Number(a.Points), spend: Number(a.Total_Spend), visits: Number(a.Visit_Count), status: a.Status, mk: a.Marketing_Consent === 'YES',
        tx: txA.map((t) => txKey({ type: t.Type, points: Number(t.Points), amount: t.Amount, branch: t.Branch, staff: t.Staff, detail: t.Detail })).sort(),
        cp: cpA.map((c) => c.Status + '|' + (c.Used_Branch || '')).sort() },
      B: { points: b.points, spend: b.spend, visits: b.visit_count, status: b.status, mk: b.marketing_consent,
        tx: txB.map(txKey).sort(), cp: cpB.map((c) => c.status + '|' + (c.used_branch || '')).sort() }
    };
  };
  for (const user of Object.keys(ids)) {
    const s = await summary(user);
    const d = diff(s.A, s.B, user, []);
    ok(d.length === 0, `${user}: แต้ม ${s.B.points} / ยอดซื้อ ${s.B.spend} / ${s.B.tx.length} รายการ / คูปอง ${s.B.cp.length} ใบ — ตรงกัน`, d.slice(0, 5));
  }
  const staffA = sheetRows('Staff').map((r) => [r.LINE_User_ID, r.Name, r.Role, r.Status].join('|')).sort();
  const staffB = (await db.query('select line_user_id, name, role, status from staff where shop_id = $1', [SHOP])).rows.map((r) => [r.line_user_id, r.name, r.role, r.status].join('|')).sort();
  ok(diff(staffA, staffB, 'staff', []).length === 0, 'รายชื่อพนักงาน + บทบาท + สถานะ ตรงกัน', { staffA, staffB });
  const logA = sheetRows('Profile_Log').map((r) => r.Changed + '|' + r.By).sort();
  const logB = (await db.query('select changed, by_name from profile_log where shop_id = $1', [SHOP])).rows.map((r) => r.changed + '|' + r.by_name).sort();
  ok(diff(logA, logB, 'log', []).length === 0, 'ประวัติการแก้ข้อมูลสมาชิก ตรงกัน (' + logB.length + ' รายการ)', { logA, logB });
  const issuedA = sheetRows('Rewards').map((r) => r.Reward_ID + ':' + Number(r.Issued)).sort();
  const issuedB = (await db.query('select id, issued from rewards where shop_id = $1', [SHOP])).rows.map((r) => r.id + ':' + r.issued).sort();
  ok(diff(issuedA, issuedB, 'issued', []).length === 0, 'จำนวนที่แลกไปของรางวัลแต่ละชิ้น ตรงกัน', { issuedA, issuedB });

  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
