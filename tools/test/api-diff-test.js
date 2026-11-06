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
  async function both(label, body, expect) {
    const full = Object.assign({ shop: SHOP }, body);
    const a = call(W, full);
    const b = await app.handle(JSON.parse(JSON.stringify(full)));
    const d = diff(norm(a, 'A'), norm(b, 'B'), '', []);
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
  await db.query(`insert into point_rules (shop_id, id, name, multiplier, days, show_badge, end_date) values
    ($1, 'PR001', 'วันนี้แต้ม 2 เท่า', 2, array[$2], true, null), ($1, 'PR002', 'ไม่แสดงป้าย', 3, array[$2], false, null),
    ($1, 'PR003', 'หมดเขตแล้ว', 3, array[$2], true, $3::date)`, [SHOP, day, dayOffset(-1)]);
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

  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
