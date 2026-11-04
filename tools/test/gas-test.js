// ทดสอบ code.gs ทุกขั้นตอนด้วยชีตจำลอง (ไม่ต้องใช้ Google จริง)
// รัน: node tools/test/gas-test.js
const { createWorld, call, run, callFn } = require('./gas-stub');
const crypto = require('crypto');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); }
}
const rid = () => crypto.randomUUID();
const tok = (id, name = 'ทดสอบ') => `TEST:${id}:${name}`;

const W = createWorld();
const sheet = n => W.ss.getSheetByName(n);
function rowsOf(name) {
  const s = sheet(name); const h = s.data[0];
  return s.data.slice(1).filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]])));
}
function setCell(name, matchCol, matchVal, col, val) {
  const s = sheet(name); const h = s.data[0];
  const ri = s.data.findIndex((r, i) => i > 0 && r[h.indexOf(matchCol)] === matchVal);
  if (ri < 0) throw new Error('setCell: not found ' + matchVal);
  s.data[ri][h.indexOf(col)] = val;
  W.cache.delete('rows:' + name); // เหมือนรอให้ค่าที่จำไว้หมดอายุ (แก้ในชีตเองเห็นผลภายใน 5 นาที)
}
function rowsOfW(world, name) {
  const s = world.ss.getSheetByName(name); const h = s.data[0];
  return s.data.slice(1).filter(r => r.some(v => v !== '')).map(r => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]])));
}
function hasFormula() {
  return Object.values(W.ss.sheets).some(s => s.data.some(r => r.some(v => v && typeof v === 'object' && v.FORMULA)));
}

console.log('\n[1] ติดตั้งชีต');
run(W, 'testSetup');
ok(['Settings', 'Members', 'Transactions', 'Rewards', 'Coupons', 'Staff', 'Promotions', 'Branches', 'Profile_Log', 'Point_Rules'].every(n => sheet(n)), 'สร้างครบ 10 ชีต (รวมสาขา + ประวัติแก้ข้อมูล + แต้มพิเศษ)');
ok(rowsOf('Settings').length === 22, 'Settings มี 22 ค่า (รวมโฟลเดอร์รูป + หน้าตาร้าน)', rowsOf('Settings').length);
ok(rowsOf('Rewards').length === 3 && rowsOf('Promotions').length === 1, 'มีรางวัลตัวอย่าง 3 / โปรโมชัน 1');
ok(!/Google|Drive|Sheet|ชีต|Apps Script/.test(JSON.stringify(rowsOf('Promotions')) + JSON.stringify(rowsOf('Rewards'))), 'ข้อความตัวอย่างที่ลูกค้าเห็น ไม่พูดถึงชีต', rowsOf('Promotions'));
run(W, 'testSetup');
ok(rowsOf('Settings').length === 22 && rowsOf('Rewards').length === 3, 'รัน testSetup ซ้ำ ไม่เพิ่มข้อมูลซ้ำ');
ok(W.logs.some(l => l.includes('ชีตพร้อมใช้งาน')), 'testSetup พิมพ์ผลใน Log');

console.log('\n[2] โหมดทดสอบ / ตรวจตัวตน');
let r = call(W, { action: 'bootstrap', idToken: tok('U1') });
ok(!r.ok && r.code === 'TEST_DISABLED', 'token ทดสอบใช้ไม่ได้เมื่อปิดโหมดทดสอบ', r);
run(W, 'enableTestMode');
r = call(W, { action: 'bootstrap' });
ok(!r.ok && r.code === 'NO_TOKEN', 'ไม่มี token → ปฏิเสธ', r);
r = call(W, '{bad json');
ok(!r.ok && r.code === 'BAD_REQUEST', 'JSON เสีย → ปฏิเสธ', r);
r = call(W, { action: 'hack', idToken: tok('U1') });
ok(!r.ok && r.code === 'UNKNOWN_ACTION', 'คำสั่งที่ไม่รู้จัก → ปฏิเสธ', r);
r = call(W, { action: 'constructor', idToken: tok('U1') });
ok(!r.ok && r.code === 'UNKNOWN_ACTION', 'ชื่อคำสั่งแปลก (constructor) → ปฏิเสธ', r);

console.log('\n[3] ลูกค้าสมัครสมาชิก');
r = call(W, { action: 'bootstrap', idToken: tok('U1', 'สมชาย') });
ok(r.ok && r.member === null && r.rewards.length === 3 && r.promos.length === 1 && r.testMode === true, 'bootstrap ก่อนสมัคร: member=null มีรางวัล/โปร', r);
const REG = { firstName: 'สมชาย', lastName: 'ใจดี', phone: '081-234-5678', birthDate: '1995-02-18', consentPrivacy: true };
r = call(W, { action: 'register', idToken: tok('U1'), ...REG, consentPrivacy: false });
ok(!r.ok && r.code === 'NO_CONSENT', 'ไม่ยอมรับ PDPA → สมัครไม่ได้', r);
r = call(W, { action: 'register', idToken: tok('U1'), ...REG, phone: '12345' });
ok(!r.ok && r.code === 'BAD_PHONE', 'เบอร์ผิด → ปฏิเสธ', r);
r = call(W, { action: 'register', idToken: tok('U1'), ...REG, birthDate: '2030-01-01' });
ok(!r.ok && r.code === 'BAD_BIRTHDATE', 'วันเกิดในอนาคต → ปฏิเสธ', r);
r = call(W, { action: 'register', idToken: tok('U1'), ...REG, birthDate: '' });
ok(!r.ok && r.code === 'BAD_BIRTHDATE', 'ไม่เลือกวันเกิด → ปฏิเสธ (บังคับ)', r);
r = call(W, { action: 'register', idToken: tok('U1'), ...REG, birthDate: '1995-02-30' });
ok(!r.ok && r.code === 'BAD_BIRTHDATE', 'วันที่ไม่มีจริง (30 ก.พ.) → ปฏิเสธ', r);
r = call(W, { action: 'register', idToken: tok('U1', 'ชื่อในไลน์'), ...REG, firstName: '' });
ok(!r.ok && r.code === 'BAD_NAME', 'ไม่กรอกชื่อ → ปฏิเสธ (ไม่ใช้ชื่อ LINE แทนแล้ว)', r);
r = call(W, { action: 'register', idToken: tok('U1'), ...REG, lastName: '  ' });
ok(!r.ok && r.code === 'BAD_NAME' && /นามสกุล/.test(r.error), 'ไม่กรอกนามสกุล → ปฏิเสธ', r);
r = call(W, { action: 'register', idToken: tok('U1'), ...REG, lastName: '0812345678' });
ok(!r.ok && r.code === 'BAD_NAME', 'นามสกุลเป็นตัวเลข (พิมพ์ผิดช่อง) → ปฏิเสธ', r);
r = call(W, { action: 'register', idToken: tok('U1'), name: 'สมชาย ใจดี', phone: '0812345678', birthDate: '1995-02-18', consentPrivacy: true });
ok(!r.ok && r.code === 'BAD_NAME', 'หน้าเว็บรุ่นเก่า (ส่งแค่ name) → ปฏิเสธ ต้องแยกชื่อ/นามสกุล', r);
// ชีตของร้านเดิมยังไม่มีคอลัมน์ใหม่ → ต้องไม่ล่ม และเติมคอลัมน์ให้เองตอนสมัคร
{
  const ms = sheet('Members'); const h = ms.data[0];
  ['First_Name', 'Last_Name'].forEach(c => { const i = h.indexOf(c); if (i >= 0) h[i] = ''; });
}
r = call(W, { action: 'bootstrap', idToken: tok('U1') });
ok(r.ok, 'ชีตเดิมยังไม่มีคอลัมน์ชื่อ/นามสกุล → ระบบยังทำงานได้ (ไม่ต้องรัน testSetup ก่อน)', r);
setCell('Settings', 'Key', 'MEMBER_PREFIX', 'Value', 'KW');
setCell('Settings', 'Key', 'WELCOME_POINTS', 'Value', '10');
r = call(W, { action: 'register', idToken: tok('U1'), ...REG, firstName: '=HYPERLINK("http://evil")', phone: '+66 81 234 5678', consentMarketing: true });
ok(r.ok && /^KW-[A-Z2-9]{6}$/.test(r.member.memberId) && r.member.points === 10 && r.welcomePoints === 10, 'สมัครสำเร็จ รหัส KW-xxxxxx + แต้มต้อนรับ 10', r);
const M1 = r.member.memberId;
const mrow = rowsOf('Members')[0];
ok(mrow.Phone === '0812345678' && typeof mrow.Phone === 'string', 'เบอร์เก็บเป็นข้อความ เลข 0 ไม่หาย (+66 แปลงเป็น 0)', mrow.Phone);
ok(mrow.First_Name === '=HYPERLINK("http://evil")' && mrow.Last_Name === 'ใจดี' && mrow.Name === '=HYPERLINK("http://evil") ใจดี' && !hasFormula(), 'เก็บชื่อ/นามสกุลแยก + ชื่อเต็มใน Name / ขึ้นต้นด้วย = ไม่กลายเป็นสูตร', mrow);
ok(sheet('Members').data[0].filter(x => x === 'First_Name').length === 1, 'เติมคอลัมน์ First_Name / Last_Name ให้เองครั้งเดียว');
ok(mrow.Birth_Date === '1995-02-18', 'บันทึกวันเกิด');
ok(mrow.Marketing_Consent === 'YES' && mrow.Consent_Version === '1' && mrow.Consent_At instanceof Date, 'บันทึกการยินยอม PDPA');
ok(rowsOf('Transactions').length === 1 && rowsOf('Transactions')[0].Type === 'WELCOME', 'มีรายการแต้มต้อนรับ');
r = call(W, { action: 'register', idToken: tok('U1'), ...REG, firstName: 'ซ้ำ', phone: '0899999999' });
ok(r.ok && r.already === true && rowsOf('Members').length === 1, 'สมัครซ้ำ → คืนสมาชิกเดิม ไม่สร้างใหม่', r);
r = call(W, { action: 'register', idToken: tok('U2'), ...REG, firstName: 'คนอื่น', phone: '0812345678' });
ok(!r.ok && r.code === 'PHONE_TAKEN', 'เบอร์ซ้ำกับคนอื่น → ปฏิเสธ', r);
r = call(W, { action: 'register', idToken: tok('U2', 'ไลน์มานี'), firstName: ' มานี ', lastName: 'รักเรียน', phone: '0899999999', birthDate: '2000-12-31', consentPrivacy: true });
ok(r.ok && r.member.name === 'มานี รักเรียน', 'ชื่อในระบบมาจากที่กรอก ไม่ใช่ชื่อ LINE (ตัดช่องว่างหัวท้าย)', r);
const M2 = r.member.memberId;

console.log('\n[4] พนักงานขอสิทธิ์ / อนุมัติ');
r = call(W, { action: 'staffMe', idToken: tok('S1', 'น้องแคชเชียร์') });
ok(r.ok && r.staff.status === 'PENDING' && rowsOf('Staff').length === 1, 'เปิดหน้าพนักงานครั้งแรก → PENDING', r);
r = call(W, { action: 'staffMe', idToken: tok('S1') });
ok(r.ok && rowsOf('Staff').length === 1 && !r.settings, 'เปิดซ้ำ ไม่เพิ่มแถวซ้ำ และยังไม่ได้ค่าตั้งค่า');
r = call(W, { action: 'staffLookup', idToken: tok('S1'), query: M1 });
ok(!r.ok && r.code === 'NOT_STAFF', 'ยังไม่อนุมัติ → ค้นสมาชิกไม่ได้', r);
r = call(W, { action: 'addPurchase', idToken: tok('U1'), memberId: M1, amount: 99999, requestId: rid() });
ok(!r.ok && r.code === 'NOT_STAFF', 'ลูกค้าเรียกคำสั่งเพิ่มแต้มเอง → ปฏิเสธ (ช่องโหว่เดิมปิดแล้ว)', r);
setCell('Staff', 'LINE_User_ID', 'S1', 'Status', 'ACTIVE');
r = call(W, { action: 'staffMe', idToken: tok('S1') });
ok(r.ok && r.staff.status === 'ACTIVE' && r.staff.role === 'CASHIER' && r.settings.pointRate === 20, 'อนุมัติแล้ว → ACTIVE ได้ค่าตั้งค่า', r);

console.log('\n[5] ค้นหาสมาชิก');
r = call(W, { action: 'staffLookup', idToken: tok('S1'), query: '081-234-5678' });
ok(r.ok && r.kind === 'member' && r.member.memberId === M1 && r.member.phoneMasked === 'xxx-xxx-5678', 'ค้นด้วยเบอร์ → เจอ และเห็นเบอร์แค่ 4 ตัวท้าย', r);
ok(!('phone' in r.member) && !('lineUserId' in r.member), 'พนักงานไม่เห็นเบอร์เต็ม/LINE ID');
r = call(W, { action: 'staffLookup', idToken: tok('S1'), query: M1.toLowerCase() });
ok(r.ok && r.member.memberId === M1, 'ค้นด้วยรหัสสมาชิก (ตัวเล็กก็ได้)', r);
r = call(W, { action: 'staffLookup', idToken: tok('S1'), query: 'KW-NOPE99' });
ok(!r.ok && r.code === 'NOT_FOUND', 'รหัสไม่มีจริง → ไม่พบ', r);

console.log('\n[6] บันทึกยอดซื้อ');
const req1 = rid();
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 105, requestId: req1 });
ok(r.ok && r.pointsAdded === 5 && r.balance === 15 && r.member.totalSpend === 105 && r.member.visitCount === 1, '105 บาท → +5 แต้ม (20 บาท/แต้ม)', r);
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 105, requestId: req1 });
ok(r.ok && r.balance === 15 && rowsOf('Transactions').filter(t => t.Type === 'EARN').length === 1, 'ส่งซ้ำ requestId เดิม → ไม่บันทึกซ้ำ', r);
W.cache.clear();
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 105, requestId: req1 });
ok(r.ok && r.duplicate === true && r.balance === 15 && rowsOf('Transactions').filter(t => t.Type === 'EARN').length === 1, 'แคชหาย ก็ยังกันซ้ำได้จากคอลัมน์ Request_ID', r);
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 15, requestId: rid() });
ok(r.ok && r.pointsAdded === 0 && r.member.totalSpend === 120 && r.member.visitCount === 2, 'ยอด 15 บาท → 0 แต้ม แต่บันทึกยอดซื้อและจำนวนครั้ง', r);
ok(rowsOf('Transactions').slice(-1)[0].Detail.includes('ไม่ถึงเกณฑ์'), 'รายการระบุว่าไม่ถึงเกณฑ์');
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 50000, requestId: rid() });
ok(!r.ok && r.code === 'OVER_MAX', 'ยอดเกิน MAX_PURCHASE → ปฏิเสธ', r);
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: -5, requestId: rid() });
ok(!r.ok && r.code === 'BAD_AMOUNT', 'ยอดติดลบ → ปฏิเสธ', r);
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 100, requestId: 'x' });
ok(!r.ok && r.code === 'BAD_REQUEST_ID', 'ไม่มี requestId ที่ถูกต้อง → ปฏิเสธ', r);
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 2000, note: '+cmd|calc', requestId: rid() });
ok(r.ok && r.pointsAdded === 100 && r.balance === 115, '2,000 บาท → +100 แต้ม', r);
ok(!hasFormula() && rowsOf('Transactions').slice(-1)[0].Detail === '+cmd|calc', 'หมายเหตุขึ้นต้นด้วย + ไม่กลายเป็นสูตร');
ok(rowsOf('Transactions').slice(-1)[0].Staff === 'น้องแคชเชียร์', 'บันทึกชื่อพนักงานที่เพิ่มแต้ม');

console.log('\n[7] ลูกค้าแลกรางวัล');
r = call(W, { action: 'redeem', idToken: tok('U1'), rewardId: 'R001', requestId: rid() });
ok(r.ok && r.points === 35 && /^CP-[A-Z2-9]{8}$/.test(r.coupon.code) && r.coupon.status === 'ACTIVE', 'แลก R001 (80) → เหลือ 35 ได้คูปอง', r);
const C1 = r.coupon.code;
ok(rowsOf('Rewards').find(x => x.Reward_ID === 'R001').Issued === 1, 'นับจำนวนที่แลกแล้วในรางวัล');
const cp1 = rowsOf('Coupons')[0];
const days = (cp1.Expires_At - cp1.Issued_At) / 86400000;
ok(days > 29 && days < 31, 'คูปองหมดอายุใน ~30 วัน', days);
r = call(W, { action: 'redeem', idToken: tok('U1'), rewardId: 'R002', requestId: rid() });
ok(!r.ok && r.code === 'NOT_ENOUGH', 'แต้มไม่พอ → ปฏิเสธ', r);
r = call(W, { action: 'redeem', idToken: tok('U1'), rewardId: 'R999', requestId: rid() });
ok(!r.ok && r.code === 'REWARD_UNAVAILABLE', 'รางวัลไม่มีจริง → ปฏิเสธ', r);
r = call(W, { action: 'redeem', idToken: tok('U9'), rewardId: 'R001', requestId: rid() });
ok(!r.ok && r.code === 'NOT_MEMBER', 'ยังไม่สมัคร → แลกไม่ได้', r);

console.log('\n[8] สิทธิ์ปรับแต้ม (เฉพาะผู้จัดการ)');
r = call(W, { action: 'adjustPoints', idToken: tok('S1'), memberId: M1, points: 500, reason: 'ชดเชย', requestId: rid() });
ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์ปรับแต้มไม่ได้', r);
setCell('Staff', 'LINE_User_ID', 'S1', 'Role', 'ADMIN');
r = call(W, { action: 'adjustPoints', idToken: tok('S1'), memberId: M1, points: 500, reason: '', requestId: rid() });
ok(!r.ok && r.code === 'NO_REASON', 'ไม่มีเหตุผล → ปฏิเสธ', r);
r = call(W, { action: 'adjustPoints', idToken: tok('S1'), memberId: M1, points: 1.5, reason: 'ทดสอบ', requestId: rid() });
ok(!r.ok && r.code === 'BAD_POINTS', 'แต้มไม่เป็นจำนวนเต็ม → ปฏิเสธ', r);
r = call(W, { action: 'adjustPoints', idToken: tok('S1'), memberId: M1, points: 500, reason: 'ชดเชยระบบล่ม', requestId: rid() });
ok(r.ok && r.balance === 535, 'ADMIN ปรับ +500 → 535', r);
r = call(W, { action: 'adjustPoints', idToken: tok('S1'), memberId: M1, points: -1000, reason: 'แก้ไข', requestId: rid() });
ok(!r.ok && r.code === 'NEGATIVE', 'ปรับจนติดลบไม่ได้', r);

console.log('\n[9] โควตา / จำกัดต่อคน');
setCell('Rewards', 'Reward_ID', 'R002', 'Quota', 1);
r = call(W, { action: 'redeem', idToken: tok('U1'), rewardId: 'R002', requestId: rid() });
ok(r.ok && r.points === 415, 'แลก R002 ชิ้นสุดท้าย', r);
r = call(W, { action: 'redeem', idToken: tok('U1'), rewardId: 'R002', requestId: rid() });
ok(!r.ok && r.code === 'SOLD_OUT', 'โควตาเต็ม → ปฏิเสธ', r);
setCell('Rewards', 'Reward_ID', 'R001', 'Limit_Per_Member', 1);
r = call(W, { action: 'redeem', idToken: tok('U1'), rewardId: 'R001', requestId: rid() });
ok(!r.ok && r.code === 'LIMIT_REACHED', 'แลกเกินจำนวนต่อคน → ปฏิเสธ', r);
r = call(W, { action: 'bootstrap', idToken: tok('U1') });
ok(r.ok && r.rewards.find(x => x.id === 'R002').remaining === 0, 'bootstrap บอกจำนวนคงเหลือ', r.rewards);
setCell('Rewards', 'Reward_ID', 'R003', 'End_Date', new Date('2020-01-01T00:00:00+07:00'));
r = call(W, { action: 'bootstrap', idToken: tok('U1') });
ok(r.ok && !r.rewards.find(x => x.id === 'R003'), 'รางวัลที่หมดช่วงเวลาไม่แสดง');

console.log('\n[10] ใช้คูปอง');
r = call(W, { action: 'staffLookup', idToken: tok('S1'), query: C1.toLowerCase() });
ok(r.ok && r.kind === 'coupon' && r.coupon.code === C1 && r.member.memberId === M1, 'สแกนรหัสคูปอง → เห็นคูปองและเจ้าของ', r);
r = call(W, { action: 'staffLookup', idToken: tok('S1'), query: M1 });
ok(r.ok && r.coupons.length === 2, 'ค้นสมาชิก → เห็นคูปองที่ใช้ได้ 2 ใบ', r.coupons);
const useReq = rid();
r = call(W, { action: 'useCoupon', idToken: tok('S1'), code: C1, requestId: useReq });
ok(r.ok && r.coupon.status === 'USED', 'ใช้คูปองสำเร็จ', r);
r = call(W, { action: 'useCoupon', idToken: tok('S1'), code: C1, requestId: useReq });
ok(r.ok && r.coupon.status === 'USED', 'กดซ้ำ (requestId เดิม) → ได้ผลสำเร็จเดิม ไม่ error', r);
r = call(W, { action: 'useCoupon', idToken: tok('S1'), code: C1, requestId: rid() });
ok(!r.ok && r.code === 'USED', 'ใช้ซ้ำ → ปฏิเสธ', r);
r = call(W, { action: 'useCoupon', idToken: tok('U1'), code: rowsOf('Coupons')[1].Coupon_Code, requestId: rid() });
ok(!r.ok && r.code === 'NOT_STAFF', 'ลูกค้ากดใช้คูปองเองไม่ได้', r);
setCell('Coupons', 'Coupon_Code', rowsOf('Coupons')[1].Coupon_Code, 'Expires_At', new Date(Date.now() - 1000));
r = call(W, { action: 'useCoupon', idToken: tok('S1'), code: rowsOf('Coupons')[1].Coupon_Code, requestId: rid() });
ok(!r.ok && r.code === 'EXPIRED', 'คูปองหมดอายุ → ใช้ไม่ได้', r);

console.log('\n[11] หน้าลูกค้าหลังมีรายการ');
r = call(W, { action: 'bootstrap', idToken: tok('U1') });
ok(r.ok && r.member.points === 415 && r.member.totalSpend === 2120 && r.member.visitCount === 3, 'ยอดแต้ม/ยอดซื้อ/จำนวนครั้งถูกต้อง', r.member);
ok(r.history.length === 7 && r.history[0].type === 'REDEEM' && r.history[r.history.length - 1].type === 'WELCOME', 'ประวัติเรียงใหม่→เก่า', r.history.map(h => h.type));
ok(r.coupons.map(c => c.status).sort().join(',') === 'EXPIRED,USED', 'สถานะคูปอง USED / EXPIRED', r.coupons);
ok(!('LINE_User_ID' in r.member) && !('_row' in r.member), 'ไม่ส่งข้อมูลภายในออกไป');
r = call(W, { action: 'staffRecent', idToken: tok('S1') });
ok(r.ok && r.items.length === 8 && r.items[0].memberName && r.items[0].staff !== undefined, 'รายการล่าสุดของร้าน มีชื่อสมาชิก', r.items[0]);

console.log('\n[12] ระงับสมาชิก');
setCell('Members', 'Member_ID', M2, 'Status', 'BLOCKED');
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M2, amount: 100, requestId: rid() });
ok(!r.ok && r.code === 'MEMBER_BLOCKED', 'สมาชิกถูกระงับ → เพิ่มแต้มไม่ได้', r);
r = call(W, { action: 'redeem', idToken: tok('U2'), rewardId: 'R001', requestId: rid() });
ok(!r.ok && r.code === 'MEMBER_BLOCKED', 'สมาชิกถูกระงับ → แลกไม่ได้', r);
setCell('Staff', 'LINE_User_ID', 'S1', 'Status', 'DISABLED');
r = call(W, { action: 'staffLookup', idToken: tok('S1'), query: M1 });
ok(!r.ok && r.code === 'NOT_STAFF', 'พนักงานถูกปิดสิทธิ์ → ใช้ไม่ได้ทันที', r);
setCell('Staff', 'LINE_User_ID', 'S1', 'Status', 'ACTIVE');

console.log('\n[13] ชีตเต็ม 1,000 แถว');
sheet('Transactions').maxRows = sheet('Transactions').getLastRow();
r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 40, requestId: rid() });
ok(r.ok && sheet('Transactions').inserted === 500, 'เขียนเกินขนาดชีต → เพิ่มแถวเองแล้วบันทึกได้', r);

console.log('\n[13.5] หลังบ้าน (หน้าแอดมิน)');
{
  const bkk = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);
  const today = bkk(new Date());
  const shift = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const yesterday = shift(today, -1);

  setCell('Staff', 'LINE_User_ID', 'S1', 'Role', 'CASHIER'); // ส่วน [8] ตั้ง S1 เป็น ADMIN ไว้ → กลับเป็นแคชเชียร์
  r = call(W, { action: 'adminDashboard', idToken: tok('S1'), from: today, to: today });
  ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์เปิดหลังบ้านไม่ได้', r);
  r = call(W, { action: 'adminMe', idToken: tok('U1') });
  ok(!r.ok && r.code === 'NOT_STAFF', 'ลูกค้าเปิดหลังบ้านไม่ได้', r);
  call(W, { action: 'staffMe', idToken: tok('O1', 'เจ้าของ') });
  setCell('Staff', 'LINE_User_ID', 'O1', 'Status', 'ACTIVE'); setCell('Staff', 'LINE_User_ID', 'O1', 'Role', 'OWNER');
  call(W, { action: 'staffMe', idToken: tok('A1', 'ผู้จัดการ') });
  setCell('Staff', 'LINE_User_ID', 'A1', 'Status', 'ACTIVE'); setCell('Staff', 'LINE_User_ID', 'A1', 'Role', 'ADMIN');
  r = call(W, { action: 'adminMe', idToken: tok('O1') });
  ok(r.ok && r.me.role === 'OWNER' && r.settings.shopName, 'เจ้าของร้านเปิดหลังบ้านได้', r);

  // ย้ายรายการแต้มต้อนรับของ M1 ไปเมื่อวาน (ทดสอบการแบ่งช่วงเวลา + ช่วงก่อนหน้า)
  const txSheet = sheet('Transactions'); const th = txSheet.data[0];
  const welcomeRow = txSheet.data.findIndex((row, i) => i > 0 && row[th.indexOf('Type')] === 'WELCOME' && row[th.indexOf('Member_ID')] === M1);
  txSheet.data[welcomeRow][th.indexOf('Date')] = new Date(yesterday + 'T12:00:00+07:00');
  const todayTx = rowsOf('Transactions').filter(t => bkk(t.Date) === today);
  const earn = todayTx.filter(t => t.Type === 'EARN');
  const sales = Math.round(earn.reduce((s, t) => s + Number(t.Amount), 0) * 100) / 100;
  const redeemed = -todayTx.filter(t => t.Type === 'REDEEM').reduce((s, t) => s + Number(t.Points), 0);

  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: today, to: today });
  ok(r.ok && r.current.bills === earn.length && r.current.sales === sales, `ยอดซื้อวันนี้ ${sales} บาท ${earn.length} บิล`, r.current);
  ok(r.current.buyers === new Set(earn.map(t => t.Member_ID)).size && r.current.pointsRedeemed === redeemed && redeemed > 0, 'ลูกค้าที่มาซื้อ / แต้มที่ถูกแลก', r.current);
  ok(r.current.newMembers === 2 && r.totals.members === 2 && r.totals.activeMembers === 1, 'สมาชิกใหม่ 2 / ทั้งหมด 2 / ใช้งานได้ 1 (อีกคนถูกระงับ)', r.totals);
  ok(r.current.couponsUsed === 1, 'คูปองที่ใช้ที่ร้าน 1 ใบ', r.current);
  ok(r.previous.pointsIssued === 10 && r.previous.bills === 0, 'ช่วงก่อนหน้า (เมื่อวาน) มีแต้มต้อนรับ 10', r.previous);
  ok(r.series.length === 1 && r.series[0].key === today && r.series[0].sales === sales, 'กราฟรายวัน 1 แท่ง', r.series);
  ok(r.topMembers[0].memberId === M1 && r.topMembers[0].name, 'ลูกค้าซื้อมากสุดอันดับ 1 = M1', r.topMembers);
  ok(r.byStaff.some(s => s.staff === 'น้องแคชเชียร์' && s.couponsUsed === 1 && s.bills > 0), 'ยอดตามพนักงาน + คูปองที่พนักงานสแกน', r.byStaff);
  ok(r.topRewards.length >= 1 && r.topRewards[0].issued >= 1, 'ของรางวัลยอดนิยม', r.topRewards);
  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: shift(today, -6), to: today });
  ok(r.ok && r.series.length === 7 && r.period.bucket === 'day' && r.previous.bills === 0, '7 วัน → 7 แท่งรายวัน', r.period);
  r = call(W, { action: 'adminDashboard', idToken: tok('A1'), from: shift(today, -99), to: today });
  ok(r.ok && r.period.bucket === 'month' && r.series.length >= 4 && r.series.length <= 5, '100 วัน → รวมเป็นรายเดือน (ผู้จัดการเปิดได้)', r.series.map(s => s.key));
  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: today, to: yesterday });
  ok(!r.ok && r.code === 'BAD_DATE', 'วันเริ่มหลังวันจบ → ปฏิเสธ', r);
  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: '2026-02-30', to: '2026-03-01' });
  ok(!r.ok && r.code === 'BAD_DATE', 'วันที่ไม่มีจริง (30 ก.พ.) → ปฏิเสธ', r);
  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: shift(today, -400), to: today });
  ok(!r.ok && r.code === 'BAD_DATE', 'ช่วงยาวเกิน 366 วัน → ปฏิเสธ', r);

  r = call(W, { action: 'adminMembers', idToken: tok('O1') });
  ok(r.ok && r.total === 2 && r.items.find(m => m.memberId === M1).phone === '0812345678', 'เจ้าของร้านเห็นเบอร์เต็ม', r.items);
  ok(r.items.every(m => !('lineUserId' in m) && !('LINE_User_ID' in m)), 'ไม่ส่งรหัส LINE ของลูกค้าออกไป');
  r = call(W, { action: 'adminMembers', idToken: tok('A1') });
  ok(r.ok && r.items.every(m => !('phone' in m) && /^xxx-xxx-\d{4}$/.test(m.phoneMasked)), 'ผู้จัดการเห็นเบอร์แค่ 4 ตัวท้าย', r.items);
  r = call(W, { action: 'adminMembers', idToken: tok('O1'), q: '5678' });
  ok(r.ok && r.total === 1 && r.items[0].memberId === M1, 'เจ้าของร้านค้นเบอร์บางส่วนได้', r);
  r = call(W, { action: 'adminMembers', idToken: tok('A1'), q: '5678' });
  ok(r.ok && r.total === 0, 'ผู้จัดการค้นเบอร์บางส่วนไม่ได้ (กันไล่เดาเบอร์)', r);
  r = call(W, { action: 'adminMembers', idToken: tok('A1'), q: '081-234-5678' });
  ok(r.ok && r.total === 1, 'ผู้จัดการค้นด้วยเบอร์เต็มได้', r);
  r = call(W, { action: 'adminMembers', idToken: tok('O1'), q: 'มานี' });
  ok(r.ok && r.total === 1 && r.items[0].memberId === M2, 'ค้นด้วยชื่อ', r);
  r = call(W, { action: 'adminMembers', idToken: tok('O1'), status: 'BLOCKED' });
  ok(r.ok && r.total === 1 && r.items[0].status === 'BLOCKED', 'กรองเฉพาะที่ถูกระงับ', r);
  r = call(W, { action: 'adminMembers', idToken: tok('O1'), sort: 'points' });
  ok(r.ok && r.items[0].points >= r.items[1].points, 'เรียงตามแต้ม', r.items.map(m => m.points));

  r = call(W, { action: 'adminMember', idToken: tok('O1'), memberId: M1 });
  const m1tx = rowsOf('Transactions').filter(t => t.Member_ID === M1).length;
  ok(r.ok && r.history.length === m1tx && r.coupons.length === 2 && r.member.birthDate === '1995-02-18' && r.member.lineLinked === true, 'สมาชิกรายคน: ประวัติครบ คูปอง 2 วันเกิด', { h: r.history && r.history.length, m1tx, m: r.member });
  ok(r.member.marketingConsent === true && r.member.consentAt && !('LINE_User_ID' in r.member), 'แสดงการยินยอม PDPA ไม่ส่งรหัส LINE');
  r = call(W, { action: 'adminMember', idToken: tok('A1'), memberId: M1 });
  ok(r.ok && r.member.birthDate === '' && !('phone' in r.member), 'ผู้จัดการไม่เห็นวันเกิด/เบอร์เต็ม', r.member);
  r = call(W, { action: 'adminMember', idToken: tok('O1'), memberId: '<x>' });
  ok(!r.ok && r.code === 'BAD_MEMBER_ID', 'รหัสสมาชิกผิดรูปแบบ → ปฏิเสธ', r);

  r = call(W, { action: 'adminTransactions', idToken: tok('O1'), from: today, to: today });
  ok(r.ok && r.total === todayTx.length && r.summary.sales === sales && r.items[0].memberName, `รายการวันนี้ ${todayTx.length} รายการ มีชื่อสมาชิก`, r.summary);
  ok(r.items.every((t, i, a) => i === 0 || a[i - 1].date >= t.date), 'เรียงใหม่ → เก่า');
  ok(r.staffNames.includes('น้องแคชเชียร์'), 'มีรายชื่อพนักงานไว้กรอง', r.staffNames);
  r = call(W, { action: 'adminTransactions', idToken: tok('O1'), from: today, to: today, type: 'EARN' });
  ok(r.ok && r.total === earn.length && r.items.every(t => t.type === 'EARN'), 'กรองเฉพาะยอดซื้อ', r.total);
  r = call(W, { action: 'adminTransactions', idToken: tok('O1'), from: today, to: today, staff: 'ไม่มีคนนี้' });
  ok(r.ok && r.total === 0, 'กรองตามพนักงาน');
  r = call(W, { action: 'adminTransactions', idToken: tok('O1'), from: yesterday, to: today, q: 'สมชาย' });
  ok(r.ok && r.total === 0, 'ค้นชื่อที่ไม่มี → 0 (ชื่อ M1 เป็นข้อความ =HYPERLINK)', r.total);
  r = call(W, { action: 'adminTransactions', idToken: tok('O1'), from: yesterday, to: today, q: M1.toLowerCase() });
  ok(r.ok && r.total === m1tx, 'ค้นด้วยรหัสสมาชิก (รวมเมื่อวาน)', r.total);

  r = call(W, { action: 'adminCoupons', idToken: tok('O1'), from: today, to: today });
  ok(r.ok && r.all === 2 && r.counts.USED === 1 && r.counts.EXPIRED === 1, 'คูปอง: ใช้แล้ว 1 หมดอายุ 1', r.counts);
  r = call(W, { action: 'adminCoupons', idToken: tok('O1'), from: today, to: today, status: 'USED' });
  ok(r.ok && r.total === 1 && r.items[0].usedBy === 'น้องแคชเชียร์' && r.items[0].memberName, 'กรองคูปองที่ใช้แล้ว เห็นคนสแกน', r.items);

  r = call(W, { action: 'adminStaff', idToken: tok('A1') });
  ok(r.ok && r.items.length === 3 && r.items.find(s => s.userId === 'A1').isMe, 'รายชื่อพนักงาน 3 คน', r.items);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('A1'), userId: 'S1', role: 'ADMIN', status: 'ACTIVE' });
  ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการตั้งคนอื่นเป็นผู้จัดการไม่ได้', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('A1'), userId: 'O1', role: 'OWNER', status: 'DISABLED' });
  ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการปิดสิทธิ์เจ้าของร้านไม่ได้', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('A1'), userId: 'A1', role: 'OWNER', status: 'ACTIVE' });
  ok(!r.ok && r.code === 'SELF_EDIT', 'เลื่อนสิทธิ์ตัวเองไม่ได้', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('O1'), userId: 'O1', role: 'OWNER', status: 'DISABLED' });
  ok(!r.ok && r.code === 'SELF_EDIT', 'เจ้าของร้านปิดสิทธิ์ตัวเองไม่ได้ (กันล็อกตัวเองออก)', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('A1'), userId: 'S1', role: 'CASHIER', status: 'DISABLED' });
  ok(r.ok && r.staff.status === 'DISABLED', 'ผู้จัดการปิดสิทธิ์แคชเชียร์ได้', r);
  r = call(W, { action: 'staffLookup', idToken: tok('S1'), query: M1 });
  ok(!r.ok && r.code === 'NOT_STAFF', 'ปิดสิทธิ์จากหลังบ้าน → ใช้หน้าพนักงานไม่ได้ทันที', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('O1'), userId: 'S1', role: 'CASHIER', status: 'BOSS' });
  ok(!r.ok && r.code === 'BAD_STATUS', 'สถานะแปลก → ปฏิเสธ', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('O1'), userId: 'S1', role: 'CASHIER', status: 'ACTIVE', name: '=IMPORTXML("http://evil")' });
  ok(r.ok && r.staff.status === 'ACTIVE' && !hasFormula(), 'เจ้าของร้านเปิดสิทธิ์คืน + ชื่อที่ขึ้นต้นด้วย = ไม่กลายเป็นสูตร', r);
  call(W, { action: 'adminStaffUpdate', idToken: tok('O1'), userId: 'S1', role: 'CASHIER', status: 'ACTIVE', name: 'น้องแคชเชียร์' });
  call(W, { action: 'staffMe', idToken: tok('P1', 'พนักงานใหม่') });
  r = call(W, { action: 'adminStaff', idToken: tok('O1') });
  ok(r.items[0].userId === 'P1' && r.items[0].status === 'PENDING', 'คนรออนุมัติขึ้นบนสุด', r.items[0]);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('O1'), userId: 'P1', role: 'ADMIN', status: 'ACTIVE' });
  ok(r.ok && r.staff.role === 'ADMIN', 'เจ้าของร้านอนุมัติเป็นผู้จัดการได้', r);
  r = call(W, { action: 'staffLookup', idToken: tok('P1'), query: M1 });
  ok(r.ok, 'อนุมัติจากหลังบ้านแล้วใช้หน้าพนักงานได้ทันที', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('O1'), userId: 'NOPE', role: 'CASHIER', status: 'ACTIVE' });
  ok(!r.ok && r.code === 'NOT_FOUND', 'พนักงานที่ไม่มีจริง → ไม่พบ', r);

  r = call(W, { action: 'adminExport', idToken: tok('A1'), kind: 'members' });
  ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการส่งออกไฟล์ไม่ได้', r);
  r = call(W, { action: 'adminExport', idToken: tok('O1'), kind: 'members' });
  ok(r.ok && r.columns.length === 12 && r.columns[2] === 'นามสกุล' && r.rows.length === 2 && r.rows.some(x => x[2] === 'ใจดี' && x[3] === '081-234-5678'), 'เจ้าของร้านส่งออกสมาชิกได้ แยกนามสกุล เบอร์มีขีด (Excel ไม่ตัด 0)', r.rows && r.rows[0]);
  r = call(W, { action: 'adminExport', idToken: tok('O1'), kind: 'transactions', from: today, to: today });
  ok(r.ok && r.rows.length === todayTx.length, 'ส่งออกรายการตามช่วงวันที่', r.rows && r.rows.length);
  r = call(W, { action: 'adminExport', idToken: tok('O1'), kind: 'secrets' });
  ok(!r.ok && r.code === 'BAD_EXPORT', 'ส่งออกข้อมูลอื่น → ปฏิเสธ', r);
  ok(W.logs.some(l => l.startsWith('ส่งออก members')), 'บันทึกใน Log ว่าใครส่งออก');
}

console.log('\n[13.6] จัดการร้านจากหลังบ้าน (รางวัล / โปรโมชัน / ระงับสมาชิก / ตั้งค่า)');
{
  const bkk = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d);
  const today = bkk(new Date());
  const shift = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

  r = call(W, { action: 'adminRewards', idToken: tok('S1') });
  ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์ดู/แก้ของรางวัลไม่ได้', r);
  r = call(W, { action: 'adminRewards', idToken: tok('A1') });
  ok(r.ok && r.items.length === 3 && r.items[0].id === 'R001' && r.items[0].issued >= 1 && r.couponDays === 30, 'รายการของรางวัล 3 รายการ + จำนวนที่แลกไปแล้ว', r.items && r.items[0]);

  const base = { name: 'เค้กส้มฟรี 1 ชิ้น', description: 'เค้กส้มสูตรร้าน', points: '150', image: `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`,
    validDays: '', quota: '20', limitPerMember: '1', startDate: '', endDate: '', sort: '', status: 'ACTIVE' };
  r = call(W, { action: 'adminRewardSave', idToken: tok('A1'), reward: base });
  ok(!r.ok && r.code === 'BAD_REQUEST_ID', 'ไม่มี requestId → ปฏิเสธ (กันบันทึกซ้ำ)', r);
  const req = rid();
  r = call(W, { action: 'adminRewardSave', idToken: tok('A1'), reward: base, requestId: req });
  ok(r.ok && r.created && r.reward.id === 'R004' && r.reward.state === 'ACTIVE', 'เพิ่มของรางวัลใหม่ → รหัส R004', r);
  ok(r.reward.image === `https://drive.google.com/thumbnail?id=${DRIVE_ID}&sz=w1000`, 'ลิงก์แชร์ Google Drive ถูกแปลงเป็นลิงก์รูป', r.reward.image);
  call(W, { action: 'adminRewardSave', idToken: tok('A1'), reward: base, requestId: req });
  ok(rowsOf('Rewards').length === 4, 'ส่งซ้ำด้วย requestId เดิม → ไม่เพิ่มซ้ำ');
  r = call(W, { action: 'bootstrap', idToken: tok('U1') });
  ok(r.ok && r.rewards.some(x => x.id === 'R004' && x.points === 150 && x.remaining === 20 && /thumbnail/.test(x.image)), 'ลูกค้าเห็นของรางวัลใหม่ทันที', r.rewards && r.rewards.map(x => x.id));

  const bad = (patch, code, msg) => {
    const x = call(W, { action: 'adminRewardSave', idToken: tok('O1'), reward: { ...base, ...patch }, requestId: rid() });
    ok(!x.ok && x.code === code, msg, x);
  };
  bad({ name: '  ' }, 'BAD_INPUT', 'ไม่มีชื่อ → ปฏิเสธ');
  bad({ points: '0' }, 'BAD_INPUT', 'แต้ม 0 → ปฏิเสธ');
  bad({ points: '12.5' }, 'BAD_INPUT', 'แต้มมีทศนิยม → ปฏิเสธ');
  bad({ image: 'javascript:alert(1)' }, 'BAD_IMAGE', 'ลิงก์รูปอันตราย → ปฏิเสธ');
  bad({ image: 'http://example.com/a.jpg' }, 'BAD_IMAGE', 'ลิงก์รูป http (ไม่ใช่ https) → ปฏิเสธ');
  bad({ startDate: today, endDate: shift(today, -1) }, 'BAD_DATE', 'วันสิ้นสุดก่อนวันเริ่ม → ปฏิเสธ');
  bad({ startDate: '2026-13-01' }, 'BAD_DATE', 'วันที่ไม่มีจริง → ปฏิเสธ');
  bad({ status: 'DELETED' }, 'BAD_STATUS', 'สถานะแปลก → ปฏิเสธ');
  bad({ id: 'R999' }, 'NOT_FOUND', 'แก้รหัสที่ไม่มี → ไม่พบ');
  setCell('Rewards', 'Reward_ID', 'R004', 'Issued', 3); // สมมุติว่ามีคนแลกไปแล้ว 3 ใบ
  bad({ id: 'R004', quota: '2' }, 'BAD_QUOTA', 'ตั้งจำนวนทั้งหมดน้อยกว่าที่แลกไปแล้ว → ปฏิเสธ');

  r = call(W, { action: 'adminRewardSave', idToken: tok('O1'), reward: { ...base, id: 'R004', name: '=เค้กส้ม', status: 'INACTIVE' }, requestId: rid() });
  ok(r.ok && r.reward.state === 'INACTIVE' && !hasFormula(), 'ปิดของรางวัล + ชื่อขึ้นต้น = ไม่กลายเป็นสูตร', r);
  ok(rowsOf('Rewards').find(x => x.Reward_ID === 'R004').Issued === 3, 'แก้ของรางวัลแล้วจำนวนที่แลกไปแล้วไม่ถูกเขียนทับ');
  r = call(W, { action: 'bootstrap', idToken: tok('U1') });
  ok(!r.rewards.some(x => x.id === 'R004'), 'ปิดแล้วลูกค้าไม่เห็น');
  r = call(W, { action: 'adminRewardSave', idToken: tok('O1'), reward: { ...base, id: 'R004', startDate: shift(today, 3) }, requestId: rid() });
  ok(r.ok && r.reward.state === 'SCHEDULED' && r.reward.startDate === shift(today, 3), 'ตั้งวันเริ่มล่วงหน้า → "ยังไม่เริ่ม"', r.reward);
  r = call(W, { action: 'redeem', idToken: tok('U1'), rewardId: 'R004', requestId: rid() });
  ok(!r.ok && r.code === 'REWARD_UNAVAILABLE', 'ยังไม่ถึงวันเริ่ม → ลูกค้าแลกไม่ได้', r);
  r = call(W, { action: 'adminRewardSave', idToken: tok('O1'), reward: { ...base, id: 'R004', startDate: shift(today, -10), endDate: shift(today, -1) }, requestId: rid() });
  ok(r.ok && r.reward.state === 'ENDED', 'เลยวันสิ้นสุด → "หมดเขต"', r.reward);

  // รูปในชีตที่เจ้าของร้านวางลิงก์ Drive เอง ก็แสดงได้
  setCell('Rewards', 'Reward_ID', 'R001', 'Image', `https://drive.google.com/open?id=${DRIVE_ID}`);
  r = call(W, { action: 'bootstrap', idToken: tok('U1') });
  ok(r.rewards.find(x => x.id === 'R001').image === `https://drive.google.com/thumbnail?id=${DRIVE_ID}&sz=w1000`, 'ลิงก์ Drive ที่พิมพ์ในชีตเองก็แปลงให้ตอนแสดง');

  r = call(W, { action: 'adminPromos', idToken: tok('A1') });
  ok(r.ok && r.items.length === 1 && r.items[0].id === 'P001', 'รายการโปรโมชัน', r);
  const promo = { title: 'แต้ม x2 วันเสาร์', subtitle: 'ทุกเมนู', tag: 'โปรใหม่', image: '', link: 'https://line.me/R/ti/p/@khamwan', startDate: '', endDate: '', sort: '0', status: 'ACTIVE' };
  r = call(W, { action: 'adminPromoSave', idToken: tok('A1'), promo, requestId: rid() });
  ok(r.ok && r.created && r.promo.id === 'P002', 'เพิ่มโปรโมชัน P002', r);
  r = call(W, { action: 'bootstrap', idToken: tok('U1') });
  ok(r.promos[0].id === 'P002' && r.promos[0].link === promo.link, 'ลูกค้าเห็นโปรใหม่ (ลำดับ 0 ขึ้นก่อน)', r.promos);
  r = call(W, { action: 'adminPromoSave', idToken: tok('A1'), promo: { ...promo, link: 'javascript:alert(1)' }, requestId: rid() });
  ok(!r.ok && r.code === 'BAD_LINK', 'ลิงก์โปรโมชันอันตราย → ปฏิเสธ', r);
  r = call(W, { action: 'adminPromoSave', idToken: tok('A1'), promo: { ...promo, id: 'P002', status: 'INACTIVE' }, requestId: rid() });
  ok(r.ok && r.promo.state === 'INACTIVE' && rowsOf('Promotions').length === 2, 'ปิดโปรโมชัน (ไม่เพิ่มแถว)', r);

  r = call(W, { action: 'adminMemberStatus', idToken: tok('S1'), memberId: M1, status: 'BLOCKED', reason: 'ทดสอบ' });
  ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์ระงับสมาชิกไม่ได้', r);
  r = call(W, { action: 'adminMemberStatus', idToken: tok('A1'), memberId: M1, status: 'BLOCKED', reason: '' });
  ok(!r.ok && r.code === 'NO_REASON', 'ระงับโดยไม่ใส่เหตุผล → ปฏิเสธ', r);
  r = call(W, { action: 'adminMemberStatus', idToken: tok('A1'), memberId: M1, status: 'BLOCKED', reason: 'ใช้บัญชีผิดวิธี' });
  ok(r.ok && r.member.status === 'BLOCKED' && /ระงับ .* โดย ผู้จัดการ: ใช้บัญชีผิดวิธี/.test(rowsOf('Members').find(x => x.Member_ID === M1).Note), 'ระงับสมาชิก + บันทึกใคร/เหตุผลในช่อง Note', rowsOf('Members').find(x => x.Member_ID === M1).Note);
  r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 100, requestId: rid() });
  ok(!r.ok && r.code === 'MEMBER_BLOCKED', 'ระงับแล้วหน้าพนักงานบันทึกแต้มไม่ได้', r);
  r = call(W, { action: 'adminMemberStatus', idToken: tok('O1'), memberId: M1, status: 'ACTIVE' });
  ok(r.ok && r.member.status === 'ACTIVE' && /เปิดใช้อีกครั้ง/.test(rowsOf('Members').find(x => x.Member_ID === M1).Note), 'เปิดใช้อีกครั้งได้', r.member);

  r = call(W, { action: 'adminSettings', idToken: tok('A1') });
  ok(r.ok && r.items.length === 22 && r.items.find(x => x.key === 'LIFF_ID').editable === false && r.items.find(x => x.key === 'POINT_RATE_BAHT').editable === true, 'ผู้จัดการดูค่าตั้งร้านได้ (LIFF_ID แก้ไม่ได้)', r.items && r.items.map(x => x.key));
  r = call(W, { action: 'adminSettingsSave', idToken: tok('A1'), values: { POINT_RATE_BAHT: '10' } });
  ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการแก้ค่าตั้งร้านไม่ได้', r);
  r = call(W, { action: 'adminSettingsSave', idToken: tok('O1'), values: { POINT_RATE_BAHT: '0' } });
  ok(!r.ok && r.code === 'BAD_INPUT', 'อัตราแต้ม 0 → ปฏิเสธ', r);
  r = call(W, { action: 'adminSettingsSave', idToken: tok('O1'), values: { WELCOME_POINTS: '5.5' } });
  ok(!r.ok && r.code === 'BAD_INPUT', 'แต้มต้อนรับมีทศนิยม → ปฏิเสธ', r);
  r = call(W, { action: 'adminSettingsSave', idToken: tok('O1'), values: { LIFF_ID: 'hack' } });
  ok(!r.ok && r.code === 'BAD_INPUT' && rowsOf('Settings').find(x => x.Key === 'LIFF_ID').Value === '', 'แก้ LIFF_ID ผ่านหลังบ้านไม่ได้', r);
  r = call(W, { action: 'adminSettingsSave', idToken: tok('O1'), values: { SHOP_NAME: '=คำหวาน' } });
  ok(!r.ok && r.code === 'BAD_INPUT', 'ชื่อร้านแก้ผ่านหลังบ้านไม่ได้ (ชื่อที่ลูกค้าเห็นอยู่ใน config)', r);
  r = call(W, { action: 'adminSettingsSave', idToken: tok('O1'), values: { POINT_RATE_BAHT: '25', COUPON_DAYS: '14', WELCOME_POINTS: '10' } });
  ok(r.ok && r.changed === 2, 'เจ้าของร้านส่ง 3 ค่า → บันทึกเฉพาะ 2 ค่าที่เปลี่ยนจริง', r);
  ok(W.logs.some(l => l.includes('แก้ตั้งค่าร้าน โดย เจ้าของ') && l.includes('POINT_RATE_BAHT: 20 → 25')), 'บันทึกใน Log ว่าใครเปลี่ยนอะไร');
  r = call(W, { action: 'staffMe', idToken: tok('S1') });
  ok(r.settings.pointRate === 25, 'หน้าพนักงานใช้อัตราใหม่ทันที (25 บาท/แต้ม)', r.settings);
  r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 100, requestId: rid() });
  ok(r.ok && r.pointsAdded === 4, 'ซื้อ 100 บาท → +4 แต้ม ตามอัตราใหม่', r);
  call(W, { action: 'adminSettingsSave', idToken: tok('O1'), values: { POINT_RATE_BAHT: '20', COUPON_DAYS: '30' } });
}

console.log('\n[13.7] อัปโหลดรูป / จำข้อมูลชั่วคราว / หลังบ้านเปิดรอบเดียว');
{
  const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 74, 70, 73, 70, 0, 1]).toString('base64');
  const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 13, 10, 26, 10, 0, 0, 0, 13]).toString('base64');
  const up = (who, data, mime, extra = {}) => call(W, { action: 'adminUploadImage', idToken: tok(who), data, mime, kind: 'reward', ...extra });

  r = up('S1', JPG, 'image/jpeg');
  ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์อัปโหลดรูปไม่ได้', r);
  r = up('A1', JPG, 'image/jpeg');
  ok(r.ok && /^https:\/\/drive\.google\.com\/thumbnail\?id=FILE\d+&sz=w1000$/.test(r.url), 'ไม่ได้ตั้งโฟลเดอร์ → สร้างโฟลเดอร์ให้เอง แล้วได้ลิงก์รูป', r);
  const auto = Object.entries(W.drive.folders).find(([, f]) => f.name === 'LINE CRM - รูปร้าน');
  ok(!!auto && W.props.get('AUTO_IMAGE_FOLDER_ID') === auto[0], 'จำโฟลเดอร์ที่สร้างไว้ใน Script Properties');
  ok(W.drive.files[0].sharing === 'ANYONE_WITH_LINK:VIEW' && W.drive.files[0].folder === auto[0] && /^reward-\d{4}-\d{2}-\d{2}-[A-Z2-9]{6}\.jpg$/.test(W.drive.files[0].name), 'แชร์แบบทุกคนที่มีลิงก์ดูได้ ชื่อไฟล์เป็นระเบียบ', W.drive.files[0]);
  up('A1', JPG, 'image/jpeg');
  ok(Object.values(W.drive.folders).filter(f => f.name === 'LINE CRM - รูปร้าน').length === 1, 'อัปรูปที่ 2 ใช้โฟลเดอร์เดิม ไม่สร้างซ้ำ');

  // โฟลเดอร์ที่ผู้ใช้กำหนดในชีต Settings (วางลิงก์ทั้งลิงก์)
  const MYFOLDER = '1W6GK-NklFhLRRrw3Uheeci1EbRyeAkXg';
  W.drive.folders[MYFOLDER] = { name: 'รูปทดสอบ', canEdit: true };
  setCell('Settings', 'Key', 'IMAGE_FOLDER_ID', 'Value', `https://drive.google.com/drive/folders/${MYFOLDER}?usp=sharing`);
  r = up('O1', PNG, 'image/png', { kind: 'promo' });
  ok(r.ok && W.drive.files.slice(-1)[0].folder === MYFOLDER && /^promo-.*\.png$/.test(W.drive.files.slice(-1)[0].name), 'ตั้ง IMAGE_FOLDER_ID เป็นลิงก์โฟลเดอร์ → รูปไปอยู่โฟลเดอร์นั้น', W.drive.files.slice(-1)[0]);
  r = up('O1', JPG, 'image/png');
  ok(!r.ok && r.code === 'BAD_IMAGE', 'บอกว่าเป็น PNG แต่หัวไฟล์เป็น JPG → ปฏิเสธ', r);
  r = up('O1', Buffer.from('<script>alert(1)</script>').toString('base64'), 'image/jpeg');
  ok(!r.ok && r.code === 'BAD_IMAGE', 'ไฟล์ที่ไม่ใช่รูป → ปฏิเสธ', r);
  r = up('O1', JPG, 'image/gif');
  ok(!r.ok && r.code === 'BAD_IMAGE', 'ชนิดไฟล์ที่ไม่รองรับ (GIF) → ปฏิเสธ', r);
  r = up('O1', Buffer.alloc(2 * 1024 * 1024 + 10, 0xFF).toString('base64'), 'image/jpeg');
  ok(!r.ok && r.code === 'BAD_IMAGE', 'ใหญ่เกิน 2MB → ปฏิเสธ', r);
  r = up('O1', 'not base64!!', 'image/jpeg');
  ok(!r.ok && r.code === 'BAD_IMAGE', 'ข้อมูลไม่ใช่ base64 → ปฏิเสธ', r);
  W.drive.folders[MYFOLDER].canEdit = false;
  r = up('O1', JPG, 'image/jpeg');
  ok(!r.ok && r.code === 'DRIVE_ERROR' && !/Drive|Google|ชีต/.test(r.error) && W.logs.some(l => l.includes('ผู้แก้ไขโฟลเดอร์')), 'โฟลเดอร์ที่ดูได้อย่างเดียว → แจ้งผู้ใช้กลางๆ (ไม่บอกว่าเก็บที่ไหน) วิธีแก้อยู่ใน Log', r);
  W.drive.folders[MYFOLDER].canEdit = true;
  W.drive.blockSharing = true;
  const before = W.drive.files.length;
  r = up('O1', JPG, 'image/jpeg');
  ok(!r.ok && r.code === 'SHARE_BLOCKED' && !/Drive|Google/.test(r.error) && W.logs.some(l => l.includes('ทุกคนที่มีลิงก์')) && W.drive.files.length === before + 1 && W.drive.files.slice(-1)[0].trashed, 'สคริปต์ตั้งแชร์เองไม่ได้ + โฟลเดอร์ไม่ได้แชร์ → บอกวิธีแชร์โฟลเดอร์ และย้ายไฟล์ไปถังขยะ', r);
  W.drive.folders[MYFOLDER].sharing = 'ANYONE_WITH_LINK'; // เจ้าของร้านตั้งแชร์โฟลเดอร์ด้วยลิงก์
  r = up('O1', JPG, 'image/jpeg');
  ok(r.ok && /thumbnail\?id=FILE/.test(r.url) && !W.drive.files.slice(-1)[0].trashed, 'สคริปต์ตั้งแชร์เองไม่ได้ แต่โฟลเดอร์แชร์ด้วยลิงก์แล้ว → อัปโหลดสำเร็จ (รูปเปิดได้ตามโฟลเดอร์)', r);
  W.drive.folders[MYFOLDER].sharing = null;
  W.drive.blockSharing = false;
  setCell('Settings', 'Key', 'IMAGE_FOLDER_ID', 'Value', 'https://example.com/not-a-folder');
  r = up('O1', JPG, 'image/jpeg');
  ok(!r.ok && r.code === 'NO_FOLDER', 'IMAGE_FOLDER_ID ผิดรูปแบบ → บอกให้แก้', r);
  setCell('Settings', 'Key', 'IMAGE_FOLDER_ID', 'Value', MYFOLDER);
  W.drive.noPermission = true;
  r = up('O1', JPG, 'image/jpeg');
  ok(!r.ok && r.code === 'NO_FOLDER' && !/testSetup|Drive/.test(r.error) && W.logs.some(l => l.includes('Run testSetup')), 'ยังไม่ได้อนุญาตสิทธิ์ Drive → ผู้ใช้เห็นข้อความกลางๆ วิธีแก้อยู่ใน Log', r);
  W.drive.noPermission = false;
  r = call(W, { action: 'adminSettings', idToken: tok('O1') });
  ok(r.items.find(x => x.key === 'IMAGE_FOLDER_ID').value === MYFOLDER && !r.items.find(x => x.key === 'IMAGE_FOLDER_ID').editable, 'หลังบ้านเห็นโฟลเดอร์เก็บรูป (แก้ในหลังบ้านไม่ได้)');

  // หลังบ้านเปิดรอบเดียว: ขอข้อมูลผู้ใช้มาพร้อมหน้าแรก
  r = call(W, { action: 'adminRewards', idToken: tok('A1'), withMe: true });
  ok(r.ok && r.me && r.me.role === 'ADMIN' && r.items.length >= 3, 'withMe → ได้ทั้งข้อมูลผู้ใช้และข้อมูลหน้า (เรียกครั้งเดียว)', r.me);
  r = call(W, { action: 'adminRewards', idToken: tok('S1'), withMe: true });
  ok(!r.ok && r.code === 'NO_ROLE' && !r.me, 'withMe ไม่ข้ามการตรวจสิทธิ์', r);

  // จำข้อมูลชั่วคราว: แก้ในชีตเองยังไม่เห็นทันที / แก้ผ่านหลังบ้านเห็นทันที
  call(W, { action: 'bootstrap', idToken: tok('U2') });
  const rw = sheet('Rewards'); const rh = rw.data[0];
  const r2 = rw.data.find((row, i) => i > 0 && row[0] === 'R002');
  r2[rh.indexOf('Name')] = 'ชื่อที่แก้ในชีตตรงๆ';
  r = call(W, { action: 'bootstrap', idToken: tok('U2') });
  ok(r.rewards.find(x => x.id === 'R002').name !== 'ชื่อที่แก้ในชีตตรงๆ', 'แก้ในชีตเอง → ลูกค้ายังเห็นค่าที่จำไว้ (สูงสุด 5 นาที)');
  const cur = call(W, { action: 'adminRewards', idToken: tok('O1') }).items.find(x => x.id === 'R002');
  ok(cur.name === 'ชื่อที่แก้ในชีตตรงๆ', 'หลังบ้านอ่านชีตตรงๆ เห็นค่าล่าสุดเสมอ');
  call(W, { action: 'adminRewardSave', idToken: tok('O1'), reward: { ...cur, name: 'ขนมหวานฟรี 1 ที่', quota: String(cur.quota), validDays: String(cur.validDays), limitPerMember: String(cur.limitPerMember), sort: String(cur.sort) }, requestId: rid() });
  r = call(W, { action: 'bootstrap', idToken: tok('U2') });
  ok(r.rewards.find(x => x.id === 'R002').name === 'ขนมหวานฟรี 1 ที่', 'แก้ผ่านหลังบ้าน → ลูกค้าเห็นทันที (ล้างค่าที่จำไว้)', r.rewards.find(x => x.id === 'R002'));
  ok(r.rewards.every(x => typeof x.endDate === 'string') && W.cache.has('rows:Rewards'), 'ข้อมูลที่จำไว้แปลงวันที่กลับถูกต้อง');
  r2[rh.indexOf('Name')] = 'พิมพ์แก้ในชีต';
  callFn(W, 'onEdit', { range: { getSheet: () => ({ getName: () => 'Rewards' }) } });
  r = call(W, { action: 'bootstrap', idToken: tok('U2') });
  ok(r.rewards.find(x => x.id === 'R002').name === 'พิมพ์แก้ในชีต', 'พิมพ์แก้ในชีตเอง (onEdit) → ลูกค้าเห็นทันที');
  r2[rh.indexOf('Name')] = 'ขนมหวานฟรี 1 ที่';
  callFn(W, 'clearCache');
  ok(!W.cache.has('rows:Rewards') && !W.cache.has('rows:Settings'), 'กด Run clearCache → ล้างค่าที่จำไว้ทั้งหมด');

  const issuedBefore = call(W, { action: 'bootstrap', idToken: tok('U2') }).rewards.find(x => x.id === 'R004');
  setCell('Members', 'Member_ID', M2, 'Status', 'ACTIVE');
  call(W, { action: 'adjustPoints', idToken: tok('O1'), memberId: M2, points: 500, reason: 'ทดสอบแลก', requestId: rid() });
  call(W, { action: 'adminRewardSave', idToken: tok('O1'), reward: { id: 'R004', name: 'เค้กส้มฟรี 1 ชิ้น', points: '150', quota: '20', status: 'ACTIVE', startDate: '', endDate: '' }, requestId: rid() });
  const left1 = call(W, { action: 'bootstrap', idToken: tok('U2') }).rewards.find(x => x.id === 'R004').remaining;
  r = call(W, { action: 'redeem', idToken: tok('U2'), rewardId: 'R004', requestId: rid() });
  const left2 = call(W, { action: 'bootstrap', idToken: tok('U2') }).rewards.find(x => x.id === 'R004').remaining;
  ok(r.ok && left2 === left1 - 1, `แลกแล้วจำนวนคงเหลือที่ลูกค้าเห็นลดทันที (${left1} → ${left2})`, r);
}

console.log('\n[13.8] หน้าตาร้าน (ชื่อ โลโก้ สี ข้อความ นโยบาย)');
{
  const DRIVE_ID = '1LogoLogoLogoLogoLogoLogoLogoLogo';
  r = call(W, { action: 'bootstrap', idToken: tok('U2'), withBrand: true });
  ok(r.ok && r.brand && r.brand.name === '' && r.brand.colors.primary === '' && r.brand.consentVersion === '1', 'ยังไม่ได้ตั้ง → ทุกช่องว่าง (หน้าเว็บใช้ค่าในไฟล์ตั้งค่าร้าน)', r.brand);
  setCell('Settings', 'Key', 'SHOP_NAME', 'Value', 'ร้านของฉัน');
  r = call(W, { action: 'bootstrap', idToken: tok('U2'), withBrand: true });
  ok(r.brand.name === '', 'ชื่อร้านค่าตั้งต้นเดิม "ร้านของฉัน" ไม่เอาไปโชว์ลูกค้า', r.brand.name);
  r = call(W, { action: 'bootstrap', idToken: tok('U2') });
  ok(r.ok && !('brand' in r), 'ไม่ขอ withBrand → ไม่ส่งหน้าตาร้านมา');

  r = call(W, { action: 'adminBrand', idToken: tok('S1') });
  ok(!r.ok && r.code === 'NO_ROLE', 'แคชเชียร์ดูหน้าตาร้านไม่ได้', r);
  r = call(W, { action: 'adminBrand', idToken: tok('A1') });
  ok(r.ok && r.values.SHOP_NAME === '' && 'PRIVACY_TEXT' in r.values && r.consentVersion === '1', 'ผู้จัดการดูหน้าตาร้านได้', r);
  r = call(W, { action: 'adminBrandSave', idToken: tok('A1'), values: { SHOP_NAME: 'แอบแก้' } });
  ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการแก้หน้าตาร้านไม่ได้ (เจ้าของร้านเท่านั้น)', r);

  const bad = (values, msg) => { const x = call(W, { action: 'adminBrandSave', idToken: tok('O1'), values }); ok(!x.ok && x.code === 'BAD_INPUT' || x.code === 'BAD_IMAGE', msg, x); };
  bad({ COLOR_PRIMARY: 'red' }, 'สีไม่ใช่ #RRGGBB → ปฏิเสธ');
  bad({ COLOR_BUTTON: '#12345' }, 'รหัสสีสั้นเกิน → ปฏิเสธ');
  bad({ THEME: 'neon' }, 'สไตล์ที่ไม่มี → ปฏิเสธ');
  bad({ LOGO_URL: 'javascript:alert(1)' }, 'ลิงก์โลโก้อันตราย → ปฏิเสธ');
  bad({ PRIVACY_TEXT: 'ก'.repeat(3001) }, 'นโยบายยาวเกิน 3,000 ตัวอักษร → ปฏิเสธ');

  const privacy = 'ข้อ 1 ร้านเก็บชื่อ-นามสกุล\r\n\r\n\r\n\r\nข้อ 2 <script>ลบได้</script>';
  r = call(W, { action: 'adminBrandSave', idToken: tok('O1'), values: {
    SHOP_NAME: '=คำหวานสาขาใหม่', LOGO_URL: `https://drive.google.com/file/d/${DRIVE_ID}/view`, THEME: 'minimal',
    COLOR_PRIMARY: '#0f766e', COLOR_BUTTON: '#0F766E', COLOR_ACCENT: '', COLOR_CARD: '#134E4A',
    TEXT_POINT_UNIT: 'ดาว', TEXT_GREETING: 'ยินดีต้อนรับ', TEXT_REGISTER_TITLE: '', TEXT_REGISTER_SUBTITLE: '', PRIVACY_TEXT: privacy } });
  ok(r.ok && r.changed === 9 && r.consentVersion === '2', 'เจ้าของร้านบันทึก 9 ค่า + แก้นโยบาย → ฉบับที่ 2 อัตโนมัติ', r);
  ok(r.brand.name === '=คำหวานสาขาใหม่' && r.brand.colors.primary === '#0F766E' && r.brand.theme === 'minimal' && r.brand.consentVersion === '2', 'ส่งหน้าตาร้านใหม่กลับมาให้หน้าหลังบ้านใช้ทันที', r.brand);
  ok(!hasFormula(), 'ชื่อร้านขึ้นต้นด้วย = ไม่กลายเป็นสูตร');
  ok(r.brand.privacyText === 'ข้อ 1 ร้านเก็บชื่อ-นามสกุล\n\nข้อ 2 script ลบได้ /script', 'นโยบาย: เก็บการขึ้นบรรทัดใหม่ ตัด < > และบรรทัดว่างเกิน', r.brand.privacyText);
  ok(r.brand.logo === `https://drive.google.com/thumbnail?id=${DRIVE_ID}&sz=w1000`, 'ลิงก์โลโก้จาก Drive แปลงเป็นลิงก์รูป');
  ok(W.logs.some(l => l.includes('แก้หน้าตาร้าน โดย เจ้าของ') && l.includes('ฉบับที่ 2')), 'บันทึกใน Log ว่าใครแก้ และนโยบายเป็นฉบับไหน');
  r = call(W, { action: 'bootstrap', idToken: tok('U2'), withBrand: true });
  ok(r.brand.name === '=คำหวานสาขาใหม่' && r.brand.texts.pointUnit === 'ดาว' && r.brand.colors.card === '#134E4A' && r.settings.consentVersion === '2', 'ลูกค้าได้หน้าตาร้านใหม่ทันที (ล้างค่าที่จำไว้)', r.brand);
  r = call(W, { action: 'adminBrandSave', idToken: tok('O1'), values: { PRIVACY_TEXT: privacy, SHOP_NAME: '=คำหวานสาขาใหม่' } });
  ok(r.ok && r.changed === 0 && r.consentVersion === '2', 'บันทึกค่าเดิมซ้ำ → เลขฉบับนโยบายไม่เพิ่ม', r);
  r = call(W, { action: 'register', idToken: tok('U9', 'ลูกค้าใหม่'), firstName: 'ใหม่', lastName: 'หลังแก้นโยบาย', phone: '0877777777', birthDate: '1999-09-09', consentPrivacy: true });
  ok(r.ok && rowsOf('Members').find(m => m.LINE_User_ID === 'U9').Consent_Version === '2', 'สมัครหลังแก้นโยบาย → บันทึกว่ายอมรับฉบับที่ 2');
  ok(rowsOf('Members').find(m => m.Member_ID === M1).Consent_Version === '1', 'สมาชิกเก่ายังเป็นฉบับที่ 1 (รู้ว่าใครยอมรับฉบับไหน)');
  setCell('Settings', 'Key', 'COLOR_ACCENT', 'Value', 'ไม่ใช่สี');
  r = call(W, { action: 'bootstrap', idToken: tok('U2'), withBrand: true });
  ok(r.brand.colors.accent === '', 'พิมพ์สีผิดรูปแบบในชีตเอง → ไม่ส่งไปหน้าเว็บ (ใช้ค่าตั้งต้นแทน)', r.brand.colors);
  // คืนค่าว่างทั้งหมด ไม่ให้กระทบส่วนอื่นของชุดทดสอบ
  const blank = {}; ['SHOP_NAME', 'LOGO_URL', 'THEME', 'COLOR_PRIMARY', 'COLOR_BUTTON', 'COLOR_ACCENT', 'COLOR_CARD', 'TEXT_POINT_UNIT', 'TEXT_GREETING', 'PRIVACY_TEXT'].forEach(k => { blank[k] = ''; });
  r = call(W, { action: 'adminBrandSave', idToken: tok('O1'), values: blank });
  ok(r.ok && r.consentVersion === '3' && r.brand.name === '' && r.brand.privacyText === '', 'ล้างกลับเป็นค่าตั้งต้นได้ (ลบนโยบาย = เปลี่ยนนโยบาย → ฉบับที่ 3)', r);
  r = call(W, { action: 'adminUploadImage', idToken: tok('O1'), data: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16]).toString('base64'), mime: 'image/jpeg', kind: 'logo' });
  ok(r.ok && /^logo-/.test(W.drive.files.slice(-1)[0].name), 'อัปโหลดโลโก้ได้ (ชื่อไฟล์ขึ้นต้น logo-)', r);
}

console.log('\n[13.9] หลายสาขา (2.6.0)');
{
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const lastTx = () => rowsOf('Transactions').slice(-1)[0];
  r = call(W, { action: 'staffMe', idToken: tok('S1') });
  ok(r.ok && r.hasBranches === false && r.branches.length === 0, 'ร้านยังไม่มีสาขา → หน้าพนักงานไม่ต้องเลือกสาขา', r);
  r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 40, requestId: rid() });
  ok(r.ok && lastTx().Branch === '', 'ร้านยังไม่มีสาขา → บันทึกยอดซื้อได้เหมือนเดิม (ไม่มีสาขา)', r);

  r = call(W, { action: 'adminBranchSave', idToken: tok('A1'), branch: { name: 'สาขาแอบเพิ่ม' }, requestId: rid() });
  ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการเพิ่มสาขาไม่ได้ (เจ้าของร้านเท่านั้น)', r);
  r = call(W, { action: 'adminBranchSave', idToken: tok('O1'), branch: { name: '' }, requestId: rid() });
  ok(!r.ok && r.code === 'BAD_INPUT', 'ไม่ใส่ชื่อสาขา → ปฏิเสธ', r);
  const reqB1 = rid();
  r = call(W, { action: 'adminBranchSave', idToken: tok('O1'), branch: { name: 'สาขาสยาม' }, requestId: reqB1 });
  ok(r.ok && r.created && r.branch.id === 'B001' && r.items.length === 1, 'เพิ่มสาขาแรก → B001', r);
  r = call(W, { action: 'adminBranchSave', idToken: tok('O1'), branch: { name: 'สาขาสยาม' }, requestId: reqB1 });
  ok(r.ok && rowsOf('Branches').length === 1, 'กดบันทึกซ้ำ (requestId เดิม) → ไม่เพิ่มสาขาซ้ำ', r);
  r = call(W, { action: 'adminBranchSave', idToken: tok('O1'), branch: { name: ' สาขาสยาม ' }, requestId: rid() });
  ok(!r.ok && r.code === 'DUP_BRANCH', 'ชื่อสาขาซ้ำ → ปฏิเสธ', r);
  r = call(W, { action: 'adminBranchSave', idToken: tok('O1'), branch: { name: '=สาขาลาดพร้าว' }, requestId: rid() });
  ok(r.ok && r.branch.id === 'B002' && !hasFormula(), 'เพิ่มสาขาที่สอง (ชื่อขึ้นต้น = ไม่กลายเป็นสูตร)', r);
  r = call(W, { action: 'adminBranches', idToken: tok('A1') });
  ok(r.ok && r.items.length === 2 && r.items.every(b => b.status === 'ACTIVE' && b.staff >= 3), 'ผู้จัดการดูรายชื่อสาขาได้ / พนักงานเดิม (ช่องสาขาว่าง) อยู่ได้ทุกสาขา', r);
  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: today, to: today, withMe: true });
  ok(r.ok && r.branches.length === 2, 'หลังบ้านเปิดครั้งแรกได้รายชื่อสาขามาด้วย', r.branches);

  r = call(W, { action: 'staffMe', idToken: tok('S1') });
  ok(r.ok && r.hasBranches === true && r.branches.length === 2, 'มีสาขาแล้ว → พนักงานเห็นสาขาที่เลือกได้', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('A1'), userId: 'S1', role: 'CASHIER', status: 'ACTIVE', branches: ['B001'] });
  ok(r.ok && r.staff.branches.join() === 'B001' && rowsOf('Staff').find(x => x.LINE_User_ID === 'S1').Branches === 'B001', 'ผู้จัดการตั้งแคชเชียร์ให้อยู่สาขาสยาม', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('O1'), userId: 'S1', role: 'CASHIER', status: 'ACTIVE', branches: ['B999'] });
  ok(!r.ok && r.code === 'BAD_BRANCH', 'ตั้งสาขาที่ไม่มีจริง → ปฏิเสธ', r);
  r = call(W, { action: 'adminStaffUpdate', idToken: tok('O1'), userId: 'S1', role: 'CASHIER', status: 'ACTIVE', branches: [] });
  ok(!r.ok && r.code === 'BAD_BRANCH', 'ไม่เลือกสาขาเลย → ปฏิเสธ', r);
  r = call(W, { action: 'staffMe', idToken: tok('S1') });
  ok(r.ok && r.branches.length === 1 && r.branches[0].id === 'B001', 'แคชเชียร์เห็นเฉพาะสาขาของตัวเอง', r.branches);

  r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 300, requestId: rid() });
  ok(!r.ok && r.code === 'NO_BRANCH', 'มีสาขาแล้ว ไม่ระบุสาขา → บันทึกไม่ได้', r);
  r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 300, branchId: 'B002', requestId: rid() });
  ok(!r.ok && r.code === 'BAD_BRANCH', 'ส่งสาขาที่ตัวเองไม่ได้อยู่ → ปฏิเสธ (ไม่เชื่อหน้าเว็บ)', r);
  r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 300, branchId: 'B999', requestId: rid() });
  ok(!r.ok && r.code === 'BAD_BRANCH', 'สาขาที่ไม่มีจริง → ปฏิเสธ', r);
  r = call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount: 300, branchId: 'b001', requestId: rid() });
  ok(r.ok && lastTx().Branch === 'B001' && lastTx().Amount === 300, 'บันทึกยอดซื้อที่สาขาสยาม → รายการมีรหัสสาขา', lastTx());
  r = call(W, { action: 'addPurchase', idToken: tok('A1'), memberId: M1, amount: 777, branchId: 'B002', requestId: rid() });
  ok(r.ok && lastTx().Branch === 'B002', 'ผู้จัดการ (ทุกสาขา) บันทึกที่สาขาลาดพร้าวได้', r);
  r = call(W, { action: 'adjustPoints', idToken: tok('O1'), memberId: M1, points: 500, reason: 'เติมแต้มทดสอบสาขา', requestId: rid() });
  ok(r.ok && lastTx().Branch === 'ADMIN', 'ปรับแต้มจากหลังบ้าน (ไม่ส่งสาขา) → บันทึกเป็นหลังบ้าน', lastTx());
  r = call(W, { action: 'adjustPoints', idToken: tok('A1'), memberId: M1, points: 1, reason: 'ปรับจากหน้าพนักงาน', branchId: 'B002', requestId: rid() });
  ok(r.ok && lastTx().Branch === 'B002', 'ปรับแต้มจากหน้าพนักงาน → บันทึกสาขาที่เลือก', lastTx());

  r = call(W, { action: 'staffRecent', idToken: tok('S1'), branchId: 'B001' });
  ok(r.ok && r.items.some(t => t.amount === 300) && !r.items.some(t => t.amount === 777), 'รายการล่าสุดของแคชเชียร์ = เฉพาะสาขาสยาม', r.items.map(t => t.amount));
  r = call(W, { action: 'staffRecent', idToken: tok('S1'), branchId: 'B002' });
  ok(!r.ok && r.code === 'BAD_BRANCH', 'แคชเชียร์ขอดูรายการสาขาอื่น → ปฏิเสธ', r);

  // คูปอง: ลูกค้าแลกในแอป → พนักงานสาขาสยามสแกนใช้
  const rw = call(W, { action: 'bootstrap', idToken: tok('U1') }).rewards.find(x => !x.remaining || x.remaining > 0);
  r = call(W, { action: 'redeem', idToken: tok('U1'), rewardId: rw.id, requestId: rid() });
  ok(r.ok, 'ลูกค้าแลกรางวัล (ไม่ต้องเลือกสาขา)', r);
  const code = r.coupon.code;
  r = call(W, { action: 'useCoupon', idToken: tok('S1'), code, requestId: rid() });
  ok(!r.ok && r.code === 'NO_BRANCH', 'ใช้คูปองโดยไม่ระบุสาขา → ปฏิเสธ', r);
  r = call(W, { action: 'useCoupon', idToken: tok('S1'), code, branchId: 'B001', requestId: rid() });
  ok(r.ok && rowsOf('Coupons').find(c => c.Coupon_Code === code).Used_Branch === 'B001', 'ใช้คูปองที่สาขาสยาม → บันทึกสาขาที่ใช้', r);

  // ลูกค้าสมัครจาก QR สาขา
  const SURNAME = { UB1: 'หนึ่ง', UB2: 'สอง', UB3: 'สาม', UB4: 'สี่' };
  const reg = (id, phone, extra) => call(W, { action: 'register', idToken: tok(id), firstName: 'ลูกค้า', lastName: 'สาขา' + SURNAME[id], phone, birthDate: '1990-01-01', consentPrivacy: true, ...extra });
  r = reg('UB1', '0861000001', { branch: 'B002' });
  ok(r.ok && rowsOf('Members').find(m => m.LINE_User_ID === 'UB1').Joined_Branch === 'B002', 'สแกน QR สาขาลาดพร้าวแล้วสมัคร → บันทึกสาขาที่สมัคร', r);
  r = reg('UB2', '0861000002', { branch: 'ZZZ' });
  ok(r.ok && rowsOf('Members').find(m => m.LINE_User_ID === 'UB2').Joined_Branch === 'ONLINE', 'รหัสสาขาปลอม → ถือว่าสมัครออนไลน์', r);
  r = reg('UB3', '0861000003', {});
  ok(r.ok && rowsOf('Members').find(m => m.LINE_User_ID === 'UB3').Joined_Branch === 'ONLINE', 'สมัครเองไม่ผ่าน QR สาขา → ออนไลน์', r);

  // รายงานในหลังบ้าน
  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: today, to: today });
  const b1 = r.byBranch.find(b => b.id === 'B001');
  const b2 = r.byBranch.find(b => b.id === 'B002');
  const other = r.byBranch.find(b => b.id === 'OTHER');
  ok(r.ok && b1.sales === 300 && b1.bills === 1 && b1.couponsUsed === 1 && b2.sales === 777 && b2.newMembers === 1, 'ภาพรวม: ตารางเทียบสาขา ยอดซื้อ/บิล/คูปอง/สมาชิกใหม่ แยกถูกสาขา', r.byBranch);
  ok(other && other.newMembers >= 2 && other.bills >= 1, 'รายการก่อนมีสาขา + สมัครออนไลน์ รวมเป็นแถว "อื่นๆ"', other);
  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: today, to: today, branch: 'B001' });
  ok(r.ok && r.current.sales === 300 && r.current.bills === 1 && r.current.couponsUsed === 1 && r.byBranch.length === 0 && r.totals.members > r.totals.branchMembers, 'ภาพรวม: เลือกสาขาสยาม → ตัวเลขเฉพาะสาขานั้น', r.current);
  ok(r.topRewards.length === 1 && r.topRewards[0].used === 1, 'เลือกสาขา → ของรางวัลนับจากคูปองที่ใช้ที่สาขานั้น', r.topRewards);
  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: today, to: today, branch: 'B 1;' });
  ok(!r.ok && r.code === 'BAD_BRANCH', 'ตัวกรองสาขาผิดรูปแบบ → ปฏิเสธ', r);
  r = call(W, { action: 'adminTransactions', idToken: tok('O1'), from: today, to: today, branch: 'B002' });
  ok(r.ok && r.items.length === 2 && r.items.every(t => t.branch === 'B002'), 'รายการแต้ม: กรองสาขาลาดพร้าว', r.items);
  r = call(W, { action: 'adminCoupons', idToken: tok('O1'), from: today, to: today, branch: 'B001' });
  ok(r.ok && r.items.length === 1 && r.items[0].usedBranch === 'B001', 'คูปอง: กรองตามสาขาที่ใช้', r.items);
  r = call(W, { action: 'adminMembers', idToken: tok('O1'), branch: 'B002' });
  ok(r.ok && r.total === 1 && r.items[0].name === 'ลูกค้า สาขาหนึ่ง', 'สมาชิก: กรองตามสาขาที่สมัคร', r);
  r = call(W, { action: 'adminMember', idToken: tok('O1'), memberId: M1 });
  ok(r.ok && r.member.topBranch && r.history.some(t => t.branch === 'B001') && r.coupons.some(c => c.usedBranch === 'B001'), 'สมาชิกรายคน: สาขาที่มาบ่อย + สาขาในประวัติ/คูปอง', r.member);
  r = call(W, { action: 'adminExport', idToken: tok('O1'), kind: 'transactions', from: today, to: today });
  ok(r.ok && r.columns.slice(-1)[0] === 'สาขา' && r.rows.some(x => x.slice(-1)[0] === 'สาขาสยาม') && r.rows.some(x => x.slice(-1)[0] === 'หลังบ้าน'), 'ส่งออกรายการแต้มมีคอลัมน์สาขา (ชื่อสาขา)', r.columns);
  r = call(W, { action: 'adminExport', idToken: tok('O1'), kind: 'members' });
  ok(r.ok && r.columns.slice(-1)[0] === 'สาขาที่สมัคร' && r.rows.some(x => x.slice(-1)[0] === 'ออนไลน์'), 'ส่งออกสมาชิกมีคอลัมน์สาขาที่สมัคร', r.columns);

  // ปิดสาขา
  r = call(W, { action: 'adminBranchSave', idToken: tok('O1'), branch: { id: 'B002', name: '=สาขาลาดพร้าว', status: 'INACTIVE' }, requestId: rid() });
  ok(r.ok && r.items.find(b => b.id === 'B002').status === 'INACTIVE', 'ปิดสาขาลาดพร้าว', r);
  r = call(W, { action: 'staffMe', idToken: tok('A1') });
  ok(r.ok && r.branches.length === 1 && r.branches[0].id === 'B001', 'สาขาที่ปิดแล้วไม่ขึ้นให้พนักงานเลือก (เห็นผลทันที)', r.branches);
  r = call(W, { action: 'addPurchase', idToken: tok('A1'), memberId: M1, amount: 50, branchId: 'B002', requestId: rid() });
  ok(!r.ok && r.code === 'BAD_BRANCH', 'บันทึกที่สาขาที่ปิดแล้ว → ปฏิเสธ', r);
  r = reg('UB4', '0861000004', { branch: 'B002' });
  ok(r.ok && rowsOf('Members').find(m => m.LINE_User_ID === 'UB4').Joined_Branch === 'ONLINE', 'สแกน QR ของสาขาที่ปิดแล้ว → ถือว่าสมัครออนไลน์', r);
  r = call(W, { action: 'adminDashboard', idToken: tok('O1'), from: today, to: today });
  ok(r.byBranch.some(b => b.id === 'B002'), 'สาขาที่ปิดแล้วแต่มีข้อมูลในช่วงนี้ ยังอยู่ในตารางเทียบ', r.byBranch.map(b => b.id));

  // ร้านเดิมที่อัปเดตโค้ดแต่ยังไม่ได้กด testSetup: ไม่มีชีต Branches และไม่มีคอลัมน์สาขา
  const W2 = createWorld();
  run(W2, 'testSetup'); run(W2, 'enableTestMode');
  delete W2.ss.sheets.Branches;
  ['Transactions', 'Coupons', 'Members', 'Staff'].forEach(n => {
    const sh = W2.ss.getSheetByName(n);
    ['Branch', 'Used_Branch', 'Joined_Branch', 'Branches'].forEach(col => {
      const i = sh.data[0].indexOf(col);
      if (i >= 0) sh.data.forEach(row => row.splice(i, 1));
    });
  });
  const r2 = (b) => call(W2, b);
  let x = r2({ action: 'register', idToken: tok('V1'), firstName: 'เก่า', lastName: 'ร้านเดิม', phone: '0899990001', birthDate: '1990-01-01', consentPrivacy: true });
  ok(x.ok, 'ร้านเดิม (ไม่มีชีตสาขา) สมัครสมาชิกได้', x);
  r2({ action: 'staffMe', idToken: tok('SO', 'เจ้าของเดิม') });
  { const sh = W2.ss.getSheetByName('Staff'); const h = sh.data[0]; const row = sh.data.find((v, i) => i > 0 && v[0] === 'SO'); row[h.indexOf('Status')] = 'ACTIVE'; row[h.indexOf('Role')] = 'OWNER'; }
  x = r2({ action: 'staffMe', idToken: tok('SO') });
  ok(x.ok && x.hasBranches === false, 'ร้านเดิม: หน้าพนักงานไม่ต้องเลือกสาขา', x);
  x = r2({ action: 'addPurchase', idToken: tok('SO'), memberId: x && rowsOfW(W2, 'Members')[0].Member_ID, amount: 100, requestId: rid() });
  ok(x.ok, 'ร้านเดิม: บันทึกยอดซื้อได้', x);
  x = r2({ action: 'adminDashboard', idToken: tok('SO'), from: today, to: today, withMe: true });
  ok(x.ok && x.byBranch.length === 0 && x.branches.length === 0, 'ร้านเดิม: ภาพรวมไม่มีตารางสาขา', x.byBranch);
  x = r2({ action: 'adminBranchSave', idToken: tok('SO'), branch: { name: 'สาขาแรก' }, requestId: rid() });
  ok(x.ok && W2.ss.getSheetByName('Branches') && x.branch.id === 'B001', 'ร้านเดิมเพิ่มสาขาแรก → สร้างชีตสาขาให้เอง', x);
  x = r2({ action: 'addPurchase', idToken: tok('SO'), memberId: rowsOfW(W2, 'Members')[0].Member_ID, amount: 100, branchId: 'B001', requestId: rid() });
  ok(x.ok && rowsOfW(W2, 'Transactions').slice(-1)[0].Branch === 'B001', 'รายการแรกที่มีสาขา → เติมคอลัมน์ Branch ให้เองแล้วบันทึกได้', rowsOfW(W2, 'Transactions').slice(-1)[0]);
  x = r2({ action: 'adminStaffUpdate', idToken: tok('SO'), userId: 'SO', role: 'OWNER', status: 'ACTIVE', branches: ['B001'] });
  ok(!x.ok && x.code === 'SELF_EDIT', 'ยังแก้สิทธิ์ของตัวเองไม่ได้เหมือนเดิม', x);
}

console.log('\n[13.10] ลูกค้าแก้ข้อมูลตัวเอง / เจ้าของร้านแก้ให้ (2.7.0)');
{
  const regP = (id, phone, extra = {}) => call(W, { action: 'register', idToken: tok(id), firstName: 'แก้', lastName: 'ข้อมูล', phone, birthDate: '1992-05-05', consentPrivacy: true, ...extra });
  r = regP('UP0', '0212345678');
  ok(!r.ok && r.code === 'BAD_PHONE' && r.error === 'กรุณากรอกเบอร์มือถือ 10 หลัก', 'สมัครด้วยเบอร์บ้าน (02) → ต้องเป็นมือถือ 10 หลัก', r);
  r = regP('UP0', '081234567');
  ok(!r.ok && r.code === 'BAD_PHONE', 'เบอร์ 9 หลัก → ปฏิเสธ', r);
  r = regP('UP0', '08123456789');
  ok(!r.ok && r.code === 'BAD_PHONE', 'เบอร์ 11 หลัก → ปฏิเสธ', r);
  r = regP('UP1', '091-111-2222');
  ok(r.ok && r.member.phone === '0911112222' && r.member.firstName === 'แก้' && r.member.birthLocked === false, 'สมัครด้วยเบอร์มีขีด → เก็บเป็นตัวเลข 10 หลัก', r.member);
  const MP = r.member.memberId;
  regP('UP2', '0922223333');
  const base = { firstName: 'สมศรี', lastName: 'มีสุข', phone: '0911112222', birthDate: '1992-05-05' };

  r = call(W, { action: 'updateProfile', idToken: tok('UNOBODY'), ...base });
  ok(!r.ok && r.code === 'NOT_MEMBER', 'ยังไม่ได้สมัคร → แก้ข้อมูลไม่ได้', r);
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, consentMarketing: true });
  ok(r.ok && r.changed === 2 && r.member.name === 'สมศรี มีสุข' && r.member.marketingConsent === true, 'แก้ชื่อ + เปิดรับข่าวสาร', r);
  let row = rowsOf('Members').find(m => m.Member_ID === MP);
  ok(row.First_Name === 'สมศรี' && row.Last_Name === 'มีสุข' && row.Name === 'สมศรี มีสุข' && row.Marketing_Consent === 'YES', 'ชีตเปลี่ยนตามทั้งชื่อ นามสกุล และชื่อเต็ม', row);
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, consentMarketing: true });
  ok(r.ok && r.changed === 0, 'กดบันทึกซ้ำโดยไม่ได้แก้ → ไม่มีอะไรเปลี่ยน ไม่จดประวัติ', r);
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, phone: '0922223333' });
  ok(!r.ok && r.code === 'PHONE_TAKEN', 'เปลี่ยนเป็นเบอร์ที่สมาชิกคนอื่นใช้ → ปฏิเสธ', r);
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, phone: '0812' });
  ok(!r.ok && r.code === 'BAD_PHONE' && r.error === 'กรุณากรอกเบอร์มือถือ 10 หลัก', 'แก้เบอร์ไม่ครบ 10 หลัก → ปฏิเสธ', r);
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, phone: '+66 95 555 6666' });
  ok(r.ok && r.member.phone === '0955556666', 'เปลี่ยนเบอร์ใหม่ (+66 แปลงเป็น 0)', r.member);
  r = call(W, { action: 'staffLookup', idToken: tok('O1'), query: '0955556666' });
  ok(r.ok && r.member.memberId === MP, 'พนักงานค้นด้วยเบอร์ใหม่เจอทันที', r);
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, phone: '0955556666', firstName: '' });
  ok(!r.ok && r.code === 'BAD_NAME', 'ลบชื่อออก → ปฏิเสธ (บังคับเหมือนตอนสมัคร)', r);

  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, phone: '0955556666', birthDate: '1993-06-06' });
  ok(r.ok && r.member.birthDate === '1993-06-06' && r.member.birthLocked === true, 'แก้วันเกิดครั้งแรกได้ → แล้วล็อก', r.member);
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, phone: '0955556666', birthDate: '1994-07-07' });
  ok(!r.ok && r.code === 'BIRTH_LOCKED', 'แก้วันเกิดครั้งที่สอง → ให้ติดต่อร้าน', r);
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, phone: '0955556666', birthDate: '1993-06-06', firstName: 'ศรี' });
  ok(r.ok && r.changed === 1, 'วันเกิดล็อกแล้ว แต่ยังแก้ชื่อได้ (ส่งวันเกิดเดิมมา)', r);
  // สมาชิกเก่าที่ยังไม่มีวันเกิด: เติมครั้งแรกไม่นับเป็นการแก้
  setCell('Members', 'Member_ID', MP, 'Birth_Date', '');
  setCell('Members', 'Member_ID', MP, 'Birth_Date_Edits', 0);
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, phone: '0955556666', firstName: 'ศรี', birthDate: '1990-01-01' });
  ok(r.ok && r.member.birthLocked === false, 'สมาชิกเก่าเติมวันเกิดที่ยังว่าง → ไม่นับ ยังแก้ได้อีก 1 ครั้ง', r.member);

  r = call(W, { action: 'adminMemberUpdate', idToken: tok('A1'), memberId: MP, ...base, phone: '0955556666', birthDate: '1990-01-01' });
  ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการแก้ข้อมูลลูกค้าไม่ได้ (เจ้าของร้านเท่านั้น)', r);
  setCell('Members', 'Member_ID', MP, 'Birth_Date_Edits', 1);
  r = call(W, { action: 'adminMemberUpdate', idToken: tok('O1'), memberId: MP, ...base, phone: '0955556666', birthDate: '1988-08-08', consentMarketing: false });
  row = rowsOf('Members').find(m => m.Member_ID === MP);
  ok(r.ok && row.Birth_Date === '1988-08-08' && row.Marketing_Consent === 'YES', 'เจ้าของร้านแก้วันเกิดที่ล็อกแล้วได้ / แก้การรับข่าวสารแทนลูกค้าไม่ได้', row);
  r = call(W, { action: 'adminMemberUpdate', idToken: tok('O1'), memberId: MP, ...base, phone: '0922223333', birthDate: '1988-08-08' });
  ok(!r.ok && r.code === 'PHONE_TAKEN', 'เจ้าของร้านเปลี่ยนเป็นเบอร์ซ้ำก็ไม่ได้', r);
  r = call(W, { action: 'adminMember', idToken: tok('O1'), memberId: MP });
  const log = r.member.profileLog;
  ok(r.ok && log.length >= 5 && log[0].by === 'เจ้าของ' && /วันเกิด/.test(log[0].changed) && log.some(l => l.by === 'ลูกค้า' && /เบอร์โทร/.test(l.changed)), 'หลังบ้านเห็นประวัติการแก้ (ใหม่ → เก่า / ใครแก้)', log);
  ok(!rowsOf('Profile_Log').some(l => /09[0-9]{8}|19[0-9]{2}-/.test(l.Changed)), 'ประวัติจดแค่ชื่อช่องที่แก้ ไม่เก็บเบอร์/วันเกิด');

  setCell('Members', 'Member_ID', MP, 'Status', 'BLOCKED');
  r = call(W, { action: 'updateProfile', idToken: tok('UP1'), ...base, phone: '0955556666', birthDate: '1988-08-08' });
  ok(!r.ok && r.code === 'MEMBER_BLOCKED', 'สมาชิกถูกระงับ → แก้ข้อมูลเองไม่ได้', r);
  setCell('Members', 'Member_ID', MP, 'Status', 'ACTIVE');
  r = call(W, { action: 'bootstrap', idToken: tok('UP1') });
  ok(r.ok && r.member.firstName === 'สมศรี' && r.member.lastName === 'มีสุข' && typeof r.member.marketingConsent === 'boolean', 'หน้าลูกค้าได้ข้อมูลแยกชื่อ/นามสกุลไว้กรอกฟอร์ม', r.member);
}

console.log('\n[13.11] แต้มพิเศษ + ของขวัญวันเกิด (2.8.0)');
{
  const bkk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const today = DAYS[(new Date(bkk + 'T00:00:00Z').getUTCDay() + 6) % 7];
  const other = DAYS[(DAYS.indexOf(today) + 1) % 7];
  const lastTx = () => rowsOf('Transactions').slice(-1)[0];
  const buy = (amount) => call(W, { action: 'addPurchase', idToken: tok('S1'), memberId: M1, amount, branchId: 'B001', requestId: rid() });
  const rule = (o) => call(W, { action: 'adminRuleSave', idToken: tok('O1'), rule: { name: 'กติกา', multiplier: 2, days: DAYS, status: 'ACTIVE', ...o }, requestId: rid() });

  r = buy(400);
  ok(r.ok && r.pointsAdded === 20 && !r.rule, 'ยังไม่มีกติกา → แต้มปกติ (400 บาท = 20)', r);
  r = call(W, { action: 'adminRuleSave', idToken: tok('A1'), rule: { name: 'แอบตั้ง', multiplier: 3, days: DAYS }, requestId: rid() });
  ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการตั้งกติกาแต้มพิเศษไม่ได้ (เจ้าของร้านเท่านั้น)', r);
  r = rule({ multiplier: 5 });
  ok(!r.ok && r.code === 'BAD_INPUT', 'จำนวนเท่าที่ไม่มีให้เลือก (×5) → ปฏิเสธ', r);
  r = rule({ days: [] });
  ok(!r.ok && r.code === 'BAD_INPUT', 'ไม่เลือกวันเลย → ปฏิเสธ', r);
  r = rule({ name: 'แต้ม x2 ทุกวัน', showBadge: true });
  ok(r.ok && r.rule.id === 'PR001' && r.rule.state === 'TODAY', 'เจ้าของร้านเพิ่มกติกา x2 ทุกวัน → มีผลวันนี้', r);
  const R1 = r.rule.id;
  r = call(W, { action: 'staffMe', idToken: tok('S1') });
  ok(r.ok && r.rules.length === 1 && r.rules[0].multiplier === 2, 'หน้าพนักงานได้กติกาวันนี้ไว้โชว์ตัวอย่างแต้ม', r.rules);
  r = buy(400);
  ok(r.ok && r.pointsAdded === 40 && r.basePoints === 20 && r.rule.name === 'แต้ม x2 ทุกวัน', '400 บาท วันที่มีโปร x2 → +40 (ปกติ 20)', r);
  ok(/· แต้ม x2 ทุกวัน$/.test(lastTx().Detail) && lastTx().Ref === R1, 'ประวัติบอกชื่อกติกา + จดรหัสกติกาไว้', lastTx());
  r = buy(310);
  ok(r.ok && r.pointsAdded === 30, '310 บาท: ปกติ 15 → x2 = 30 (คูณจากแต้มที่ปัดแล้ว)', r);
  r = buy(15);
  ok(r.ok && r.pointsAdded === 0 && !r.rule && !/แต้ม x2/.test(lastTx().Detail), 'ยอดไม่ถึงเกณฑ์ (0 แต้ม) → ไม่ขึ้นชื่อกติกา', lastTx());
  r = rule({ name: 'สยาม x3 ซื้อครบพัน', multiplier: 3, branch: 'B001', minAmount: '1,000' });
  ok(r.ok, 'เพิ่มกติกา x3 เฉพาะสาขาสยาม ซื้อครบ 1,000', r);
  r = buy(400);
  ok(r.ok && r.pointsAdded === 40, 'ยอดไม่ถึง 1,000 → ใช้ x2', r);
  r = buy(1000);
  ok(r.ok && r.pointsAdded === 150 && r.rule.multiplier === 3, 'ซื้อ 1,000 ตรงทั้ง x2 และ x3 → ได้ x3 อันเดียว (ไม่คูณซ้อน)', r);
  r = call(W, { action: 'addPurchase', idToken: tok('A1'), memberId: M1, amount: 1000, branchId: 'B001', requestId: rid() });
  ok(r.ok && r.pointsAdded === 150, 'ผู้จัดการบันทึกที่สาขาสยามก็ได้ x3 เหมือนกัน', r);
  r = rule({ name: 'x3 พรุ่งนี้', multiplier: 3, days: [other] });
  r = rule({ name: 'x3 ปิดอยู่', multiplier: 3, status: 'INACTIVE' });
  r = buy(400);
  ok(r.ok && r.pointsAdded === 40, 'กติกาวันอื่น / กติกาที่ปิด → ไม่มีผลวันนี้', r);
  r = rule({ name: 'x1.5 หมดเขต', multiplier: 1.5, endDate: '2020-01-01' });
  r = call(W, { action: 'adminRules', idToken: tok('A1') });
  const st = Object.fromEntries(r.items.map(x => [x.name, x.state]));
  ok(r.ok && st['x3 พรุ่งนี้'] === 'ACTIVE' && st['x3 ปิดอยู่'] === 'INACTIVE' && st['x1.5 หมดเขต'] === 'ENDED' && st['แต้ม x2 ทุกวัน'] === 'TODAY', 'หลังบ้านบอกสถานะกติกา (วันนี้ / ใช้อยู่ / ปิด / หมดเขต)', st);
  r = call(W, { action: 'bootstrap', idToken: tok('U1') });
  ok(r.ok && r.badges.length === 1 && r.badges[0].name === 'แต้ม x2 ทุกวัน', 'หน้าลูกค้าได้ป้ายเฉพาะกติกาที่ติ๊กให้แสดง', r.badges);
  // ปิดทุกกติกา ไม่ให้กระทบส่วนอื่น
  call(W, { action: 'adminRules', idToken: tok('O1') }).items.forEach(x => rule({ id: x.id, name: x.name, multiplier: x.multiplier, days: x.days, branch: x.branch, status: 'INACTIVE' }));
  r = buy(400);
  ok(r.ok && r.pointsAdded === 20, 'ปิดกติกาแล้ว → กลับเป็นแต้มปกติ', r);

  // ของขวัญวันเกิด
  const month = bkk.slice(5, 7);
  r = call(W, { action: 'adminRewardSave', idToken: tok('A1'), reward: { name: 'ของขวัญวันเกิด: ขนมฟรี', type: 'BIRTHDAY', points: '', status: 'ACTIVE' }, requestId: rid() });
  ok(r.ok && r.reward.type === 'BIRTHDAY' && r.reward.points === 0 && r.reward.state === 'ACTIVE', 'เพิ่มของขวัญวันเกิด (ฟรี 0 แต้ม)', r);
  const BR = r.reward.id;
  r = call(W, { action: 'adminRewardSave', idToken: tok('A1'), reward: { name: 'แต้มศูนย์', points: '0', status: 'ACTIVE' }, requestId: rid() });
  ok(!r.ok && r.code === 'BAD_INPUT', 'ของรางวัลปกติตั้ง 0 แต้มไม่ได้เหมือนเดิม', r);
  r = call(W, { action: 'bootstrap', idToken: tok('U1') });
  ok(!r.rewards.some(x => x.id === BR), 'ของขวัญวันเกิดไม่อยู่ในหน้าแลกของรางวัลปกติ', r.rewards.map(x => x.id));
  r = call(W, { action: 'redeem', idToken: tok('U1'), rewardId: BR, requestId: rid() });
  ok(!r.ok && r.code === 'REWARD_UNAVAILABLE', 'แลกของขวัญวันเกิดผ่านปุ่มแลกปกติไม่ได้', r);

  const regB = (id, phone, birth) => call(W, { action: 'register', idToken: tok(id), firstName: 'วันเกิด', lastName: 'ทดสอบ', phone, birthDate: birth, consentPrivacy: true });
  r = regB('UBD1', '0631110001', `1990-${month}-15`);
  const MB = r.member.memberId;
  r = call(W, { action: 'bootstrap', idToken: tok('UBD1') });
  ok(r.ok && r.birthday === null, 'เกิดเดือนนี้แต่เพิ่งสมัคร → ยังไม่ขึ้นการ์ดของขวัญ', r.birthday);
  r = call(W, { action: 'claimBirthday', idToken: tok('UBD1'), requestId: rid() });
  ok(!r.ok && r.code === 'TOO_NEW', 'สมัครไม่ถึง 30 วัน → กดรับไม่ได้', r);
  setCell('Members', 'Member_ID', MB, 'Joined_At', new Date(Date.now() - 40 * 86400000));
  r = call(W, { action: 'bootstrap', idToken: tok('UBD1') });
  ok(r.ok && r.birthday && r.birthday.claimed === false && r.birthday.name === 'ของขวัญวันเกิด: ขนมฟรี' && r.birthday.points === 0, 'สมาชิกครบ 30 วัน + เดือนเกิด → ขึ้นการ์ดของขวัญ', r.birthday);
  const reqC = rid();
  r = call(W, { action: 'claimBirthday', idToken: tok('UBD1'), requestId: reqC });
  const exp = new Date(r.coupon && r.coupon.expiresAt);
  ok(r.ok && /^CP-/.test(r.coupon.code) && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(exp).slice(0, 7) === bkk.slice(0, 7), 'กดรับ → ได้คูปอง ใช้ได้ถึงสิ้นเดือนเกิด', r);
  const BCODE = r.coupon.code;
  r = call(W, { action: 'claimBirthday', idToken: tok('UBD1'), requestId: rid() });
  ok(r.ok && r.already === true && r.coupon.code === BCODE && rowsOf('Coupons').filter(c => c.Member_ID === MB).length === 1, 'กดรับซ้ำ → ได้คูปองเดิม ไม่ออกใหม่ (ปีละครั้ง)', r);
  r = call(W, { action: 'bootstrap', idToken: tok('UBD1') });
  ok(r.birthday && r.birthday.claimed === true && r.birthday.coupon.code === BCODE, 'การ์ดเปลี่ยนเป็น "รับแล้ว" พร้อมคูปอง', r.birthday);
  ok(!rowsOf('Transactions').some(t => t.Member_ID === MB && t.Type === 'REDEEM'), 'ของขวัญฟรี → ไม่มีรายการหักแต้ม');
  r = call(W, { action: 'useCoupon', idToken: tok('S1'), code: BCODE, branchId: 'B001', requestId: rid() });
  ok(r.ok && r.coupon.status === 'USED', 'พนักงานสแกนใช้คูปองวันเกิดได้เหมือนคูปองปกติ', r);
  r = call(W, { action: 'bootstrap', idToken: tok('UBD1') });
  ok(r.birthday === null, 'ใช้ของขวัญแล้ว → การ์ดหายไป', r.birthday);

  const otherMonth = String((Number(month) % 12) + 1).padStart(2, '0');
  r = regB('UBD2', '0631110002', `1991-${otherMonth}-10`);
  const MB2 = r.member.memberId;
  setCell('Members', 'Member_ID', MB2, 'Joined_At', new Date(Date.now() - 40 * 86400000));
  r = call(W, { action: 'claimBirthday', idToken: tok('UBD2'), requestId: rid() });
  ok(!r.ok && r.code === 'NOT_BIRTH_MONTH', 'ไม่ใช่เดือนเกิด → รับไม่ได้', r);
  r = call(W, { action: 'updateProfile', idToken: tok('UBD2'), firstName: 'วันเกิด', lastName: 'ทดสอบ', phone: '0631110002', birthDate: `1991-${month}-10` });
  ok(r.ok && r.member.birthLocked === true, 'แก้วันเกิดให้เป็นเดือนนี้ (ใช้สิทธิ์แก้ 1 ครั้ง)', r.member);
  r = call(W, { action: 'claimBirthday', idToken: tok('UBD2'), requestId: rid() });
  ok(!r.ok && r.code === 'TOO_NEW', 'เพิ่งเปลี่ยนวันเกิดไม่ถึง 30 วัน → ยังรับไม่ได้ (กันแก้วันเกิดเพื่อรับของขวัญ)', r);

  r = call(W, { action: 'adminMembers', idToken: tok('O1'), birthMonth: true });
  ok(r.ok && r.total >= 2 && r.items.every(m => ['วันเกิด ทดสอบ'].includes(m.name) || true) && r.items.some(m => m.memberId === MB), 'เจ้าของร้านกรอง "เกิดเดือนนี้" ได้', r.total);
  const all = call(W, { action: 'adminMembers', idToken: tok('A1'), birthMonth: true });
  ok(all.ok && all.total > r.total, 'ผู้จัดการกรองตามวันเกิดไม่ได้ (เห็นวันเกิดไม่ได้อยู่แล้ว)', [all.total, r.total]);
  call(W, { action: 'adminRewardSave', idToken: tok('O1'), reward: { id: BR, name: 'ของขวัญวันเกิด: ขนมฟรี', type: 'BIRTHDAY', points: '', status: 'INACTIVE' }, requestId: rid() });
}

console.log('\n[14] LINE token จริง (จำลอง LINE)');
run(W, 'disableTestMode');
r = call(W, { action: 'bootstrap', idToken: 'real-token-1' });
ok(!r.ok && r.code === 'NO_LIFF', 'ยังไม่ใส่ LIFF_ID → บอกให้ตั้งค่า', r);
// กรอก LIFF_ID ในชีตตรงๆ หลังระบบจำค่าเดิม (ว่าง) ไว้แล้ว — ไม่ล้าง cache เอง เพื่อตรวจว่าระบบอ่านใหม่ให้
{ const st = sheet('Settings'); const h = st.data[0]; st.data.find((x, i) => i > 0 && x[0] === 'LIFF_ID')[h.indexOf('Value')] = '2011913909-NcxFMTsN'; }
ok(W.cache.has('rows:Settings'), 'ระบบจำค่า Settings เดิม (LIFF_ID ว่าง) ไว้อยู่');
let lastPayload = null;
W.fetchImpl = (url, opts) => {
  lastPayload = opts.payload;
  if (opts.payload.id_token === 'real-token-1') return { code: 200, body: JSON.stringify({ sub: 'Ureal', name: 'ลูกค้าจริง', picture: 'https://profile.line-scdn.net/abc', exp: Math.floor(Date.now() / 1000) + 3600 }) };
  return { code: 400, body: '{"error":"invalid_request","error_description":"IdToken expired."}' };
};
W.fetchCalls = 0;
r = call(W, { action: 'bootstrap', idToken: 'real-token-1' });
ok(r.ok && r.profile.name === 'ลูกค้าจริง' && !r.testMode, 'token จริงผ่าน → เข้าระบบได้', r);
ok(lastPayload.client_id === '2011913909', 'ส่ง Channel ID (ส่วนหน้าของ LIFF ID) ไปตรวจกับ LINE', lastPayload);
call(W, { action: 'bootstrap', idToken: 'real-token-1' });
ok(W.fetchCalls === 1, 'คำสั่งถัดไปใช้ผลตรวจที่จำไว้ ไม่ถาม LINE ซ้ำ', W.fetchCalls);
r = call(W, { action: 'bootstrap', idToken: 'expired' });
ok(!r.ok && r.code === 'TOKEN_INVALID' && !r.error.includes('IdToken'), 'token หมดอายุ → ข้อความภาษาไทย ไม่โชว์รายละเอียดภายใน', r);
r = call(W, { action: 'bootstrap', idToken: tok('U1') });
ok(!r.ok && r.code === 'TEST_DISABLED', 'ปิดโหมดทดสอบแล้ว token ทดสอบใช้ไม่ได้', r);

console.log('\n[15] ข้อผิดพลาดภายในไม่หลุดออกไป');
delete W.ss.sheets.Promotions;
W.cache.delete('rows:Promotions'); // ไม่งั้นยังใช้ค่าที่จำไว้ได้อีก 5 นาที
r = call(W, { action: 'bootstrap', idToken: 'real-token-1' });
ok(!r.ok && r.error === 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' && !r.debug, 'ชีตหาย → ข้อความกลางๆ (โหมดจริงไม่มี debug)', r);
ok(W.logs.some(l => l.startsWith('ERROR')), 'บันทึกรายละเอียดไว้ใน Log ของ Apps Script');

console.log('\n[16] ข้อความที่ผู้ใช้เห็นไม่บอกว่าระบบเก็บข้อมูลที่ไหน (ผู้ใช้ตัดสินใจ 3 พ.ย. 2569)');
{
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..');
  const BANNED = /Google|Drive|Sheet|ชีต|Apps Script/;
  const gs = fs.readFileSync(path.join(root, 'code.gs'), 'utf8');
  // เฉพาะบรรทัดที่เรียก userError_ (ข้อความอยู่บรรทัดเดียวกันทุกจุด) ไม่นับตัวฟังก์ชันเอง
  const msgs = gs.split('\n').filter(l => l.includes('userError_(') && !l.includes('function userError_'))
    .map(l => l.slice(l.indexOf('userError_(')));
  const badMsgs = msgs.filter(m => BANNED.test(m));
  ok(msgs.length > 50 && badMsgs.length === 0, `ข้อความแจ้งผู้ใช้ใน code.gs ${msgs.length} จุด ไม่มีคำว่า Google / Drive / ชีต / Apps Script`, badMsgs);
  // หน้าเว็บ: ไม่นับบรรทัดคอมเมนต์ และข้อความแผงทดสอบที่โชว์เฉพาะตอนเปิดในเครื่อง (localhost)
  const badUi = [];
  ['customer.js', 'staff.js', 'admin.js', 'ui.js', 'api.js', 'line.js', 'shop.js'].forEach(f => {
    fs.readFileSync(path.join(root, 'app', f), 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (/^(\/\/|\/?\*|<!--)/.test(t) || /🧪|enableTestMode/.test(t)) return;
      const code = t.replace(/\/\/ .*$/, '').replace(/<!--.*?-->/g, '');
      if (BANNED.test(code)) badUi.push(f + ':' + (i + 1) + ' ' + t.slice(0, 80));
    });
  });
  ok(badUi.length === 0, 'ข้อความบนหน้าเว็บไม่มีคำว่า Google / Drive / ชีต / Apps Script', badUi);
}

console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
