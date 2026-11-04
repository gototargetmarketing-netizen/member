// Apps Script จำลอง + ข้อมูลตัวอย่างย้อนหลัง ~45 วัน (6 สาขา สมาชิก 18 คน รายการแต้ม คูปอง แต้มพิเศษ ของขวัญวันเกิด)
// ใช้ลองหน้าเว็บ / โชว์ลูกค้า โดยไม่แตะชีตจริง — ข้อมูลอยู่ในหน่วยความจำ ปิดแล้วหายหมด เปิดใหม่ได้ชุดเดิม (สุ่มแบบตายตัว)
// เปิดผ่าน "เปิดเว็บทดสอบ LINE CRM.command" หรือรันเอง: node tools/demo-server.js
// ใช้ code.gs ในโฟลเดอร์นี้จริงทุกคำขอ (ผ่าน gas-stub) → แก้ code.gs แล้วเห็นผลทันทีโดยไม่ต้องเปิดใหม่
// พอร์ต 8102 ชนกับ gas-server ของชุดทดสอบ e2e → ปิดตัวนี้ก่อนรันชุดทดสอบ
const http = require('http');
const path = require('path');
const { createWorld, call, run } = require(path.join(__dirname, 'test', 'gas-stub'));
const PORT = Number(process.env.PORT) || 8102;

const RealDate = Date;
let FAKE = null;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0 && FAKE !== null) super(FAKE); else super(...a); }
  static now() { return FAKE !== null ? FAKE : RealDate.now(); }
}

const W = createWorld();
run(W, 'testSetup');
run(W, 'enableTestMode');
function setSetting(key, value) {
  const s = W.ss.getSheetByName('Settings'); const h = s.data[0];
  s.data.find((r, i) => i > 0 && r[0] === key)[h.indexOf('Value')] = value;
  W.cache.delete('rows:Settings'); // แก้ชีตตรงๆ (ไม่ผ่าน onEdit) → ล้างค่าที่จำไว้
}
setSetting('MEMBER_PREFIX', 'KW');
setSetting('WELCOME_POINTS', '20');
setSetting('SHOP_NAME', 'คำหวาน CUISINE');
function setStaff(id, status, role) {
  const s = W.ss.getSheetByName('Staff'); const h = s.data[0];
  const row = s.data.find((r, i) => i > 0 && r[0] === id);
  row[h.indexOf('Status')] = status; row[h.indexOf('Role')] = role;
}

let seed = 20261031;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const tok = (id, name) => `TEST:${id}:${name}`;
let n = 0;
const rid = () => 'demo-req-' + (++n).toString().padStart(6, '0');

global.Date = FakeDate; // ให้ code.gs บันทึกเวลาตามที่เราจำลอง
const DAY = 86400000;
const start = RealDate.now() - 45 * DAY;
const at = (dayOffset, hour) => { FAKE = start + dayOffset * DAY + hour * 3600000 + Math.floor(rnd() * 3000000); };

// พนักงาน + 6 สาขา (แคชเชียร์ประจำสาขาละคน / ผู้จัดการอยู่ได้ทุกสาขา)
at(0, 9);
const BRANCHES = ['สาขาสยาม', 'สาขาอารีย์', 'สาขาทองหล่อ', 'สาขาบางนา', 'สาขาลาดพร้าว', 'สาขาเชียงใหม่'];
const CASH = [['U_CASH_1', 'น้องฝน'], ['U_CASH_2', 'น้องต้น'], ['U_CASH_3', 'น้องมิว'], ['U_CASH_4', 'น้องเจ'], ['U_CASH_5', 'น้องปลา'], ['U_CASH_6', 'น้องแบงค์']];
const staff = [['U_TEST_OWNER', 'คุณบีม', 'OWNER'], ['U_MGR_1', 'พี่หน่อย', 'ADMIN'], ...CASH.map(([id, n]) => [id, n, 'CASHIER'])];
staff.forEach(([id, name, role]) => { call(W, { action: 'staffMe', idToken: tok(id, name) }); setStaff(id, 'ACTIVE', role); });
BRANCHES.forEach((name, i) => call(W, { action: 'adminBranchSave', idToken: tok('U_TEST_OWNER', 'คุณบีม'), branch: { name }, requestId: 'demo-branch-' + i }));
const BIDS = BRANCHES.map((_, i) => 'B00' + (i + 1));
CASH.forEach(([id], i) => call(W, { action: 'adminStaffUpdate', idToken: tok('U_TEST_OWNER', 'คุณบีม'), userId: id, role: 'CASHIER', status: 'ACTIVE', branches: [BIDS[i]] }));
// สาขาขายดีไม่เท่ากัน (สยามขายดีสุด เชียงใหม่น้อยสุด) ให้ตารางเทียบสาขาดูมีความต่าง
const WEIGHT = [5, 3, 4, 2, 3, 1];
const pickBranch = () => { let n = rnd() * WEIGHT.reduce((a, w) => a + w, 0); for (let i = 0; i < WEIGHT.length; i++) { n -= WEIGHT[i]; if (n < 0) return i; } return 0; };

// ลูกค้า: ทยอยสมัครตลอด 45 วัน
const names = ['สมชาย ใจดี', 'มานี รักเรียน', 'วิภา ศรีสุข', 'ธนพล แก้วมณี', 'กมลวรรณ ทองดี', 'ปิยะ วงศ์ไทย', 'อรุณี พรหมมา',
  'ณัฐวุฒิ สายทอง', 'สุภาพร ชื่นใจ', 'ภูมิ รุ่งเรือง', 'จันทร์เพ็ญ บุญมา', 'กิตติ ศักดิ์ดี', 'พิมพ์ชนก แสงจันทร์', 'อนันต์ มีสุข',
  'ศิริพร ดวงดี', 'ชยพล นาคสุข', 'รัตนา คำแก้ว', 'วรเชษฐ์ ใจงาม'];
const members = [];
const events = [];
names.forEach((name, i) => events.push({ day: Math.floor((i / names.length) * 44), hour: 10 + (i % 8), kind: 'join', i }));
for (let d = 0; d < 46; d++) {
  const busy = new RealDate(start + d * DAY).getDay() % 6 === 0 ? 14 : 8; // เสาร์-อาทิตย์ขายดีกว่า (6 สาขา)
  const count = Math.floor(rnd() * busy) + 1;
  for (let k = 0; k < count; k++) events.push({ day: d, hour: 11 + Math.floor(rnd() * 9), kind: 'buy' });
  if (rnd() < 0.35) events.push({ day: d, hour: 20, kind: 'redeem' });
}
events.sort((a, b) => a.day - b.day || a.hour - b.hour);

const coupons = [];
for (const e of events) {
  if (e.day > 45) continue;
  at(e.day, e.hour);
  if (e.kind === 'join') {
    const id = 'U_CUST_' + e.i;
    const [firstName, lastName] = names[e.i].split(' ');
    const r = call(W, { action: 'register', idToken: tok(id, names[e.i]), firstName, lastName, branch: rnd() < 0.8 ? BIDS[pickBranch()] : '',
      phone: '08' + String(10000000 + Math.floor(rnd() * 89999999)), birthDate: `19${70 + (e.i * 7) % 30}-0${1 + e.i % 9}-1${e.i % 9}`,
      consentPrivacy: true, consentMarketing: rnd() < 0.6 });
    if (r.ok) members.push({ uid: id, name: names[e.i], memberId: r.member.memberId });
  } else if (e.kind === 'buy' && members.length) {
    const m = rnd() < 0.5 ? pick(members.slice(0, 5)) : pick(members); // ลูกค้าประจำมาบ่อยกว่า
    const bi = pickBranch();
    const [cid, cname] = rnd() < 0.15 ? ['U_MGR_1', 'พี่หน่อย'] : CASH[bi];
    const amount = pick([85, 120, 150, 180, 220, 260, 320, 380, 450, 520, 680, 890, 1250, 1580]);
    call(W, { action: 'addPurchase', idToken: tok(cid, cname), memberId: m.memberId, amount, branchId: BIDS[bi], requestId: rid() });
  } else if (e.kind === 'redeem' && members.length) {
    const m = pick(members);
    const r = call(W, { action: 'redeem', idToken: tok(m.uid, m.name), rewardId: pick(['R001', 'R001', 'R002', 'R003']), requestId: rid() });
    if (r.ok) coupons.push({ code: r.coupon.code, day: e.day });
  }
}
// คูปองส่วนใหญ่ถูกใช้ภายใน 1–3 วัน บางใบปล่อยให้ค้าง/หมดอายุ
for (const c of coupons) {
  if (rnd() < 0.75) {
    at(Math.min(45, c.day + 1 + Math.floor(rnd() * 3)), 13);
    if (FAKE < RealDate.now()) {
      const bi = pickBranch();
      call(W, { action: 'useCoupon', idToken: tok(CASH[bi][0], CASH[bi][1]), code: c.code, branchId: BIDS[bi], requestId: rid() });
    }
  }
}
// มีพนักงานใหม่รออนุมัติ 1 คน
at(45, 8);
call(W, { action: 'staffMe', idToken: tok('U_NEW_1', 'น้องแพร') });

// แต้มพิเศษ x2 ทุกวัน (ให้เห็นในหน้าพนักงาน/ลูกค้าทันที) + ของขวัญวันเกิด + ลูกค้าคนแรกเกิดเดือนนี้
FAKE = null;
global.Date = RealDate;
call(W, { action: 'adminRuleSave', idToken: tok('U_TEST_OWNER', 'คุณบีม'), rule: { name: 'แต้ม x2 ทุกวัน (ตัวอย่าง)', multiplier: 2, days: ['MON','TUE','WED','THU','FRI','SAT','SUN'], showBadge: true, status: 'ACTIVE' }, requestId: 'demo-rule-1' });
call(W, { action: 'adminRewardSave', idToken: tok('U_TEST_OWNER', 'คุณบีม'), reward: { name: 'ของขวัญวันเกิด: ขนมหวานฟรี 1 ที่', type: 'BIRTHDAY', points: '', status: 'ACTIVE' }, requestId: 'demo-gift-1' });
{ const ms = W.ss.getSheetByName('Members'); const h = ms.data[0]; const row = ms.data.find((r, i) => i > 0 && r[h.indexOf('LINE_User_ID')] === 'U_CUST_0');
  const m = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()).slice(5, 7); row[h.indexOf('Birth_Date')] = '1990-' + m + '-20'; }
const count = name => W.ss.getSheetByName(name).getLastRow() - 1;
console.log(`ข้อมูลตัวอย่าง: สมาชิก ${count('Members')} · รายการแต้ม ${count('Transactions')} · คูปอง ${count('Coupons')}`);

http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (req.method !== 'POST') return res.end(JSON.stringify({ ok: true, service: 'LINE CRM (จำลอง + ข้อมูลตัวอย่าง)' }));
    setTimeout(() => res.end(JSON.stringify(call(W, body))), 200);
  });
}).listen(PORT, () => console.log('ข้อมูลตัวอย่างพร้อมแล้ว (พอร์ต ' + PORT + ')'));
