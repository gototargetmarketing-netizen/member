// ทดสอบว่าข้อมูลแต่ละร้านไม่ปนกัน — ทุกร้านอยู่ฐานข้อมูลเดียว แยกด้วย shop_id (ขั้น 7 ผู้ใช้ตกลง 7 พ.ย. 2569)
//
// ตั้ง 2 ร้าน "shopa" กับ "shopb" ที่รหัสซ้ำกันโดยตั้งใจ (ของรางวัล R001 สาขา B001 ระดับ T1 มีทั้งคู่ + สมาชิกรหัสเดียวกันคนละคน)
// และร้าน B มีของที่ร้าน A ไม่มี (สมาชิกอีกคน, ของรางวัล R002, สาขา B002 ...) → ถ้าคำสั่งไหนลืมกรองร้าน จะไปเจอของร้าน B
// แล้วให้เจ้าของร้าน A / ลูกค้าร้าน A เรียก "ทุกคำสั่ง" โดยอ้างของร้าน B แล้วตรวจ 3 ข้อ:
//   1) ข้อมูลร้าน B ไม่เปลี่ยนแม้แต่แถวเดียว (เทียบทุกตารางที่มี shop_id ก่อน-หลัง)
//   2) ไม่มีข้อมูลร้าน B หลุดในคำตอบ (คำลับ "ลับร้านบี" ฝังในทุกชื่อของร้าน B + เบอร์ + รหัสคูปองของร้าน B)
//   3) พนักงานร้าน B ใช้คำสั่งพนักงาน/หลังบ้านในร้าน A ไม่ได้
// **เพิ่มคำสั่งใหม่ใน api/_lib/router.js → ต้องเพิ่มกรณีใน CASES ด้วย** (ชุดนี้ฟ้องถ้ามีคำสั่งที่ยังไม่ได้ลอง)
// + ตรวจไฟล์ db/check_points.sql บนข้อมูลที่ระบบสร้างจริง
//
// รัน: node tools/test/two-shops-test.js  (ติดตั้งครั้งแรก: cd tools/test && npm install)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createTestDb } = require('./pglite-db');

const ROOT = path.join(__dirname, '..', '..');
const { createApp, ACTIONS } = require(path.join(ROOT, 'api', '_lib', 'router.js'));
const { normalize } = require(path.join(ROOT, 'api', '_lib', 'features.js'));
const U = require(path.join(ROOT, 'api', '_lib', 'util.js'));

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); } };

const A = 'shopa', B = 'shopb';
const SECRET = 'ลับร้านบี'; // ฝังในทุกชื่อของร้าน B — เจอในคำตอบของร้าน A = ข้อมูลหลุด

(async () => {
  const db = await createTestDb({ withDemo: false });
  const log = console.log;
  console.log = (...a) => { if (/^ {2}[✓✗]|^\n?\[|^ผล/.test(String(a[0]))) log(...a); }; // ซ่อนบันทึกของระบบ
  const errLog = console.error;
  console.error = () => {};
  // LINE OA จำลองแยกร้าน — ชื่อ OA ร้าน B มีคำลับ: ร้าน A เห็นชื่อนี้ = ใช้ OA ผิดร้าน
  const { createFakeOa } = require('./fake-oa');
  const oas = { [A]: createFakeOa({ name: 'OA ร้านเอ', limit: null }), [B]: createFakeOa({ name: 'OA ร้านบี ' + SECRET, limit: null }) };
  // ที่เก็บรูปจำลอง: จดทุกไฟล์ → ตรวจว่ารูปของร้าน A ไปอยู่โฟลเดอร์ร้าน A
  const uploads = [];
  const storage = { upload: async (p) => { uploads.push(p); return 'https://storage.test/storage/v1/object/public/images/' + p; } };
  const app = createApp({ db: () => db, verifier: {}, allowTestTokens: true, region: 'test', storage: () => storage, oa: (shop) => (oas[shop] ? oas[shop].oa : null),
    // ร้านทดสอบไม่มีไฟล์ใน shops/ → เปิดทุกแพ็กเกจให้ทั้ง 2 ร้าน (ชุดนี้ตรวจว่าข้อมูลไม่ข้ามร้าน ทุกคำสั่งต้องเรียกได้จริง)
    features: async () => normalize({ tiers: true, branches: true, export: true, broadcast: true }) });
  // รูปริชเมสเสจ 5 ขนาด (หัวไฟล์ JPG ที่บอกขนาด — ตัวกลางอ่านแค่ส่วนหัว)
  const jpg = (w, h) => Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xFF, 0xD9]).toString('base64');
  const richImages = Object.fromEntries([1040, 700, 460, 300, 240].map((w) => [w, jpg(w, w)]));
  const richOf = (shop) => 'https://storage.test/storage/v1/object/public/images/' + shop + '/rich-2026-11-12-ABCDEF';
  const call = (shop, user, action, body) => app.handle(Object.assign({ shop, idToken: `TEST:${user}:${user}`, action, requestId: crypto.randomUUID() }, body || {}));
  const must = async (label, p) => { const r = await p; if (!r.ok) throw new Error(label + ': ' + JSON.stringify(r)); return r; };

  // ---------- ตั้งร้าน (แบบไฟล์ SQL ของ tools/new-shop.js + อนุมัติเจ้าของร้าน) ----------
  await db.pg.exec(`
    insert into shops (id, name, liff_id, member_prefix, point_rate_baht, welcome_points) values
      ('${A}', 'ร้านเอ', '1000000001-Aaaa', 'M', 10, 5),
      ('${B}', 'ร้านบี ${SECRET}', '1000000002-Bbbb', 'M', 10, 5);
    insert into staff (shop_id, line_user_id, name, role, status) values
      ('${A}', 'OA', 'เจ้าของเอ', 'OWNER', 'ACTIVE'),
      ('${B}', 'OB', 'เจ้าของบี', 'OWNER', 'ACTIVE'),
      ('${B}', 'CB', 'แคชเชียร์บี', 'CASHIER', 'ACTIVE');`);
  const week = [...Array(7)].map((_, i) => U.dayCode(new Date(Date.now() + i * U.DAY_MS)));

  console.log('\n[1] ตั้งข้อมูล 2 ร้านผ่านคำสั่งจริง (รหัสซ้ำกันโดยตั้งใจ)');
  // ร้าน B: มีมากกว่าร้าน A ทุกอย่าง
  for (const n of ['หนึ่ง', 'สอง']) await must('สาขา B', call(B, 'OB', 'adminBranchSave', { branch: { name: `สาขา${n} ${SECRET}` } }));
  for (const n of ['หนึ่ง', 'สอง', 'สาม']) await must('รางวัล B', call(B, 'OB', 'adminRewardSave', { reward: { name: `ของ${n} ${SECRET}`, points: 10, status: 'ACTIVE' } }));
  for (const n of ['หนึ่ง', 'สอง']) await must('โปร B', call(B, 'OB', 'adminPromoSave', { promo: { title: `โปร${n} ${SECRET}`, status: 'ACTIVE' } }));
  for (const n of ['หนึ่ง', 'สอง']) await must('แต้มพิเศษ B', call(B, 'OB', 'adminRuleSave', { rule: { name: `แต้ม${n} ${SECRET}`, multiplier: 2, days: week, status: 'ACTIVE' } }));
  await must('ระดับ B', call(B, 'OB', 'adminTiersSave', { tiers: [
    { name: `ระดับหนึ่ง ${SECRET}`, minPoints: 0, multiplier: 1 },
    { name: `ระดับสอง ${SECRET}`, minPoints: 50, multiplier: 1.5 },
    { name: `ระดับสาม ${SECRET}`, minPoints: 100, multiplier: 2 }] }));
  const idsB = [];
  for (const [i, u] of ['U_B1', 'U_B2', 'U_B3'].entries()) {
    const r = await must('สมัคร B', call(B, u, 'register', { consentPrivacy: true, consentMarketing: true, firstName: 'ลูกค้า', lastName: SECRET, birthDate: '1990-03-0' + (i + 1), phone: '086111111' + (i + 1) }));
    idsB.push(r.member.memberId);
    await must('ซื้อ B', call(B, 'OB', 'addPurchase', { memberId: r.member.memberId, amount: 500, branchId: 'B001' })); // ร้านที่มีสาขาต้องบอกสาขา
  }
  // ร้าน B เคยส่งข้อความตามกลุ่ม 1 ครั้ง (ข้อความมีคำลับ)
  const bcB = (await must('ส่งข้อความ B', call(B, 'OB', 'adminBroadcastSend', { filter: {}, draft: { text: 'ข่าวร้านบี ' + SECRET }, expect: 3 }))).broadcast.id;
  const cpB1 = (await must('แลก B', call(B, 'U_B1', 'redeem', { rewardId: 'R002' }))).coupon.code;
  const cpB2 = (await must('แลก B', call(B, 'U_B2', 'redeem', { rewardId: 'R001' }))).coupon.code;
  // ร้าน A: อย่างละน้อยกว่า (รหัสชุดแรกชนกับร้าน B)
  await must('สาขา A', call(A, 'OA', 'adminBranchSave', { branch: { name: 'สาขาเอ' } }));
  await must('รางวัล A', call(A, 'OA', 'adminRewardSave', { reward: { name: 'ของร้านเอ', points: 10, status: 'ACTIVE' } }));
  await must('โปร A', call(A, 'OA', 'adminPromoSave', { promo: { title: 'โปรร้านเอ', status: 'ACTIVE' } }));
  await must('แต้มพิเศษ A', call(A, 'OA', 'adminRuleSave', { rule: { name: 'แต้มร้านเอ', multiplier: 2, days: week, status: 'ACTIVE' } }));
  await must('ระดับ A', call(A, 'OA', 'adminTiersSave', { tiers: [{ name: 'ธรรมดา', minPoints: 0, multiplier: 1 }, { name: 'พิเศษ', minPoints: 50, multiplier: 1.5 }] }));
  const idsA = [];
  for (const [i, u] of ['U_A1', 'U_A2'].entries()) {
    const r = await must('สมัคร A', call(A, u, 'register', { consentPrivacy: true, consentMarketing: true, firstName: 'ลูกค้า', lastName: 'ร้านเอ', birthDate: '1991-04-0' + (i + 1), phone: '087111111' + (i + 1) }));
    idsA.push(r.member.memberId);
    await must('ซื้อ A', call(A, 'OA', 'addPurchase', { memberId: r.member.memberId, amount: 1000, branchId: 'B001' }));
  }
  // รหัสสมาชิกสุ่ม (M-XXXXXX) โอกาสชนกันข้ามร้านมีน้อยแต่เกิดได้ (ตารางกันซ้ำเฉพาะในร้านเดียวกัน)
  // → สร้างสมาชิกร้าน A ที่รหัสตรงกับลูกค้าร้าน B คนแรกเอง แล้วดูว่าทุกคำสั่งเลือกคนของร้าน A
  const clash = idsB[0];
  await db.query(`insert into members (shop_id, id, line_user_id, name, first_name, last_name, phone, birth_date, joined_at, consent_version, consent_at)
                  values ($1, $2, 'U_A_CLASH', 'ชนรหัส ร้านเอ', 'ชนรหัส', 'ร้านเอ', '0879999999', '1992-02-02', now(), 1, now())`, [A, clash]);
  ok((await db.query(`select count(*)::int as n from members where id = $1`, [clash])).rows[0].n === 2, `รหัสสมาชิก ${clash} มีทั้งสองร้าน (คนละคน)`);
  const onlyB = idsB[2];
  ok(/^CP-/.test(cpB1) && /^CP-/.test(cpB2), 'ร้าน B มีคูปองที่แลกแล้ว 2 ใบ');

  // ---------- ภาพข้อมูลร้าน B ก่อนลอง ----------
  const tables = (await db.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'shop_id' order by table_name`)).rows.map((r) => r.table_name);
  async function snapshot(shop) {
    const out = { shops: (await db.query(`select * from shops where id = $1`, [shop])).rows.map((r) => JSON.stringify(r)) };
    for (const t of tables) out[t] = (await db.query(`select * from ${t} where shop_id = $1`, [shop])).rows.map((r) => JSON.stringify(r)).sort();
    return out;
  }
  const before = await snapshot(B);
  const rowsB = Object.values(before).reduce((n, rows) => n + rows.length, 0);

  // ---------- เรียกทุกคำสั่งในร้าน A โดยอ้างของร้าน B ----------
  // as = ใคร (OA เจ้าของร้าน A / U_A1 ลูกค้าร้าน A / U_B1 ลูกค้าร้าน B ที่มาเปิดร้าน A) / reject = ต้องไม่สำเร็จ (อ้างของที่มีเฉพาะร้าน B)
  const OA = 'OA';
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const CASES = {
    whoami: [{ as: 'U_B1', body: {} }],
    bootstrap: [{ as: 'U_B1', body: {}, check: (r) => r.ok && r.member === null, note: 'ลูกค้าร้าน B เปิดร้าน A → ยังไม่เป็นสมาชิก (ไม่เห็นบัตรร้าน B)' }],
    updateProfile: [{ as: 'U_B1', body: { firstName: 'แก้', lastName: 'ข้ามร้าน', birthDate: '1990-03-01', phone: '0861111111' }, reject: true }],
    claimBirthday: [{ as: 'U_B1', body: {}, reject: true }],
    // PDPA ขั้นที่ 2: ลูกค้าร้าน B ยอมรับนโยบาย/ลบบัญชีที่ร้าน A → ไม่ใช่สมาชิกร้าน A (บัญชีร้าน B ต้องไม่ถูกลบ)
    acceptPolicy: [{ as: 'U_B1', body: { version: '1' }, reject: true }],
    deleteAccount: [{ as: 'U_B1', body: { confirm: 'ลบ' }, reject: true }],
    redeem: [{ as: 'U_A1', body: { rewardId: 'R002' }, reject: true, note: 'แลกของรางวัลที่มีเฉพาะร้าน B' }],
    staffMe: [{ as: OA, body: {} }, { as: 'OB', body: {}, check: (r) => r.ok && r.staff.status === 'PENDING', note: 'เจ้าของร้าน B เปิดหน้าพนักงานร้าน A → รออนุมัติ (ไม่ได้สิทธิ์ตามร้าน B)' }],
    staffLookup: [
      { as: OA, body: { query: '0861111111' }, reject: true, note: 'ค้นเบอร์ลูกค้าร้าน B' },
      { as: OA, body: { query: onlyB }, reject: true, note: 'ค้นรหัสสมาชิกที่มีเฉพาะร้าน B' },
      { as: OA, body: { query: cpB1 }, reject: true, note: 'ค้นคูปองร้าน B' },
      { as: OA, body: { query: clash }, check: (r) => r.ok && r.member && r.member.name === 'ชนรหัส ร้านเอ', note: 'ค้นรหัสที่ชนกัน → ได้คนของร้าน A' }],
    addPurchase: [{ as: OA, body: { memberId: onlyB, amount: 100, branchId: 'B001' }, reject: true },
      { as: OA, body: { memberId: idsA[0], amount: 100, branchId: 'B002' }, reject: true, note: 'บันทึกยอดโดยอ้างสาขาที่มีเฉพาะร้าน B' },
      { as: OA, body: { memberId: clash, amount: 300, branchId: 'B001' }, check: (r) => r.ok, note: 'บันทึกยอดให้รหัสที่ชนกัน → เข้าคนของร้าน A (ร้าน B ต้องไม่เปลี่ยน)' }],
    useCoupon: [{ as: OA, body: { code: cpB1, branchId: 'B001' }, reject: true }, { as: OA, body: { code: cpB2, branchId: 'B001' }, reject: true }],
    adjustPoints: [{ as: OA, body: { memberId: onlyB, points: 50, reason: 'ข้ามร้าน' }, reject: true },
      { as: OA, body: { memberId: clash, points: 2, reason: 'รหัสชน', branchId: 'B001' }, check: (r) => r.ok, note: 'ปรับแต้มรหัสที่ชนกัน → คนของร้าน A' },
      { as: OA, body: { memberId: idsA[0], points: 1, reason: 'ลองสาขาร้านบี', branchId: 'B002' }, reject: true, note: 'ปรับแต้มโดยอ้างสาขาที่มีเฉพาะร้าน B' }],
    staffRecent: [{ as: OA, body: {} }, { as: OA, body: { branchId: 'B002' } }],
    adminMe: [{ as: OA, body: { withMe: true } }],
    adminDashboard: [{ as: OA, body: {} }, { as: OA, body: { branch: 'B002' } }],
    adminMembers: [
      { as: OA, body: { q: SECRET }, check: (r) => r.ok && r.total === 0, note: 'ค้นชื่อลูกค้าร้าน B → 0 คน' },
      { as: OA, body: { q: '0861111113' }, check: (r) => r.ok && r.total === 0, note: 'ค้นเบอร์ลูกค้าร้าน B → 0 คน' },
      { as: OA, body: { branch: 'B002' } }, { as: OA, body: { tier: 'T3' } }],
    // คัดกลุ่มส่งข้อความ (วางก่อนคำสั่งที่แก้ระดับ/สถานะของร้าน A): ร้าน A มีคนยินยอมรับข่าวสาร 2 คน (สมาชิกที่ชนรหัสไม่ได้ยินยอม) — ร้าน B มี 3 คนต้องไม่ถูกนับ
    adminAudience: [{ as: OA, body: {}, check: (r) => r.ok && r.matched === 3 && r.sendable === 2 && r.items.length === 2 && r.items.every((x) => idsA.includes(x.memberId)),
      note: 'คัดกลุ่มเจอเฉพาะลูกค้าร้าน A (ตรง 3 ส่งได้ 2 — ไม่นับลูกค้าร้าน B)' },
    { as: OA, body: { filter: { branches: ['B002'] } }, check: (r) => r.ok && r.matched === 0, note: 'สาขาที่มีเฉพาะร้าน B → ไม่เจอใคร' },
    { as: OA, body: { filter: { tiers: ['T3'] } }, reject: true, note: 'ระดับที่มีเฉพาะร้าน B' }],
    // ส่งข้อความ: ร้าน A ใช้ OA ของร้าน A เท่านั้น / ส่งถึงลูกค้าร้าน A เท่านั้น / แตะการส่งของร้าน B ไม่ได้
    adminBroadcastInfo: [{ as: OA, body: {}, check: (r) => r.ok && r.connected && r.oa.name === 'OA ร้านเอ' && r.history.length === 0,
      note: 'เห็น OA และประวัติของร้าน A เท่านั้น (ร้าน B เคยส่ง 1 ครั้ง)' }],
    adminBroadcastTest: [{ as: OA, body: { draft: { text: 'ทดสอบร้านเอ' } }, check: (r) => r.ok && oas[A].state.pushes.length === 1 && oas[B].state.pushes.length === 0,
      note: 'ส่งทดสอบผ่าน OA ร้าน A' },
    { as: OA, body: { draft: { image: richOf(A), imageHeight: 1040 } },
      check: (r) => r.ok && oas[A].state.pushes.length === 2 && oas[A].state.pushes[1].messages[0].actions[0].linkUri === 'https://liff.line.me/1000000001-Aaaa',
      note: 'ริชเมสเสจไม่ใส่ลิงก์ → แตะแล้วเปิดบัตรสมาชิกของร้าน A (ไม่ใช่ร้าน B)' },
    { as: OA, body: { draft: { image: richOf(B), imageHeight: 1040 } }, reject: true, note: 'ส่งรูปริชเมสเสจของร้าน B' }],
    adminUploadRichImage: [{ as: OA, body: { images: richImages },
      check: (r) => r.ok && r.image === 'https://storage.test/storage/v1/object/public/images/' + uploads[uploads.length - 1].replace(/\/240$/, '') &&
        uploads.length === 5 && uploads.every((u) => u.startsWith(A + '/rich-')),
      note: 'อัปรูปริชเมสเสจ → เก็บ 5 ขนาดในโฟลเดอร์ร้าน A' }],
    adminBroadcastSend: [{ as: OA, body: { filter: {}, draft: { text: 'ข่าวร้านเอ' }, expect: 2 },
      check: (r) => r.ok && r.broadcast.sent === 2 && oas[B].state.multicasts.length === 1 &&
        JSON.stringify(oas[A].state.multicasts.flatMap((m) => m.to).sort()) === JSON.stringify(['U_A1', 'U_A2']),
      note: 'ส่งถึงลูกค้าร้าน A 2 คน ผ่าน OA ร้าน A (ลูกค้าร้าน B ไม่ได้รับ)' }],
    adminBroadcastResume: [{ as: OA, body: { id: bcB }, reject: true, note: 'กดส่งต่อการส่งของร้าน B' }],
    adminMember: [{ as: OA, body: { memberId: onlyB }, reject: true },
      { as: OA, body: { memberId: clash }, check: (r) => r.ok && JSON.stringify(r).includes('ชนรหัส'), note: 'เปิดรหัสที่ชนกัน → ข้อมูลคนของร้าน A' }],
    adminTransactions: [{ as: OA, body: {} }, { as: OA, body: { q: cpB1 } }, { as: OA, body: { branch: 'B002' } }],
    adminCoupons: [{ as: OA, body: {} }, { as: OA, body: { branch: 'B002' } }],
    adminStaff: [{ as: OA, body: {} }],
    adminStaffUpdate: [{ as: OA, body: { userId: 'CB', role: 'ADMIN', status: 'ACTIVE' }, reject: true, note: 'เลื่อนขั้นแคชเชียร์ร้าน B' }],
    adminExport: [{ as: OA, body: { kind: 'members' } }, { as: OA, body: { kind: 'transactions' } }],
    adminRewards: [{ as: OA, body: {} }],
    adminRewardSave: [{ as: OA, body: { reward: { id: 'R002', name: 'แก้ข้ามร้าน', points: 1, status: 'ACTIVE' } }, reject: true },
      { as: OA, body: { reward: { id: 'R001', name: 'ของร้านเอแก้แล้ว', points: 20, status: 'ACTIVE' } }, check: (r) => r.ok, note: 'แก้ R001 (มีทั้งสองร้าน) → แก้ของร้าน A' }],
    adminRewardDelete: [{ as: OA, body: { id: 'R003' }, reject: true }],
    adminPromos: [{ as: OA, body: {} }],
    adminPromoSave: [{ as: OA, body: { promo: { id: 'P002', title: 'แก้ข้ามร้าน', status: 'ACTIVE' } }, reject: true }],
    adminPromoDelete: [{ as: OA, body: { id: 'P002' }, reject: true }],
    adminRules: [{ as: OA, body: {} }],
    adminRuleSave: [{ as: OA, body: { rule: { id: 'PR002', name: 'แก้ข้ามร้าน', multiplier: 3, days: week, status: 'ACTIVE' } }, reject: true }],
    adminRuleDelete: [{ as: OA, body: { id: 'PR002' }, reject: true }],
    adminBranches: [{ as: OA, body: {} }],
    adminBranchSave: [{ as: OA, body: { branch: { id: 'B002', name: 'แก้ข้ามร้าน' } }, reject: true }],
    adminMemberStatus: [{ as: OA, body: { memberId: onlyB, status: 'BLOCKED', reason: 'ลองข้ามร้าน' }, reject: true },
      { as: OA, body: { memberId: clash, status: 'BLOCKED', reason: 'รหัสชนกัน' }, check: (r) => r.ok, note: 'ระงับรหัสที่ชนกัน → ระงับคนของร้าน A' }],
    adminMemberDelete: [{ as: OA, body: { memberId: onlyB, reason: 'ทดสอบลบข้ามร้าน', confirm: 'ลบ' }, reject: true, note: 'เจ้าของร้าน A ลบสมาชิกที่มีเฉพาะร้าน B' }],
    adminMemberUpdate: [{ as: OA, body: { memberId: onlyB, firstName: 'แก้', lastName: 'ข้ามร้าน', birthDate: '1990-01-01', phone: '0899999999' }, reject: true }],
    adminSettings: [{ as: OA, body: {} }],
    adminSettingsSave: [{ as: OA, body: { values: { POINT_RATE_BAHT: 12 } }, check: (r) => r.ok, note: 'เจ้าของร้าน A แก้อัตราแต้มร้านตัวเองได้ (ร้าน B ต้องไม่เปลี่ยน)' }],
    adminBrand: [{ as: OA, body: {} }],
    adminBrandSave: [{ as: OA, body: { values: { SHOP_NAME: 'ร้านเอชื่อใหม่' } }, check: (r) => r.ok, note: 'เจ้าของร้าน A แก้ชื่อร้านตัวเองได้' }],
    adminUploadImage: [{ as: OA, body: { kind: 'reward', mime: 'image/png', data: tinyPng } }],
    adminTiers: [{ as: OA, body: {} }],
    adminTiersSave: [{ as: OA, body: { tiers: [{ id: 'T1', name: 'ธรรมดา', minPoints: 0, multiplier: 1 }, { id: 'T3', name: 'แก้ข้ามร้าน', minPoints: 80, multiplier: 2 }] } }],
    adminMemberTier: [{ as: OA, body: { memberId: onlyB, tierId: 'T2', reason: 'ลองข้ามร้าน' }, reject: true },
      { as: OA, body: { memberId: idsA[0], tierId: 'T3', reason: 'ระดับที่มีเฉพาะร้าน B' }, reject: true }],
    // สมัครสมาชิก: ลูกค้าคนเดียวกัน (LINE เดียวกัน) สมัครได้ทั้งสองร้าน ข้อมูลแยกกัน — ทำท้ายสุด เพราะร้าน A จะมี M-000003 ของตัวเอง
    register: [{ as: 'U_B1', body: { consentPrivacy: true, firstName: 'ลูกค้า', lastName: 'สองร้าน', birthDate: '1990-03-01', phone: '0890000001' },
      check: (r) => r.ok && r.member.lastName === 'สองร้าน' && r.member.points === 5 && !idsB.includes(r.member.memberId),
      note: 'ลูกค้าร้าน B สมัครร้าน A ได้ เป็นสมาชิกใหม่แยกจากร้าน B (ได้แต้มต้อนรับของร้าน A เท่านั้น)' }]
  };

  console.log('\n[2] ทุกคำสั่งมีกรณีทดสอบ');
  const missing = Object.keys(ACTIONS).filter((a) => a !== 'ping' && !CASES[a]);
  const extra = Object.keys(CASES).filter((a) => !ACTIONS[a]);
  ok(missing.length === 0, 'ทุกคำสั่งใน router.js มีกรณีในชุดนี้ (' + (Object.keys(ACTIONS).length - 1) + ' คำสั่ง ไม่นับ ping)', { missing });
  ok(extra.length === 0, 'ไม่มีกรณีของคำสั่งที่ไม่มีอยู่แล้ว', { extra });

  console.log('\n[3] ใช้สิทธิ์ร้าน A อ้างของร้าน B → ไม่สำเร็จ + ไม่มีข้อมูลร้าน B หลุด');
  const leakRe = new RegExp([SECRET, '086-?111-?111[123]', cpB1, cpB2].join('|'));
  const leaks = [];
  let calls = 0;
  for (const [action, list] of Object.entries(CASES)) {
    for (const c of list) {
      const r = await call(A, c.as, action, c.body);
      calls++;
      const text = JSON.stringify(r);
      if (leakRe.test(text)) leaks.push(action + ': ' + text.match(leakRe)[0]);
      if (c.reject) ok(!r.ok, `${action}${c.note ? ' — ' + c.note : ''} → ไม่สำเร็จ (${r.code})`, r);
      if (c.check) ok(c.check(r), `${action} — ${c.note}`, r);
      if (r.code === 'ERROR') ok(false, `${action} → ระบบขัดข้อง (ไม่ควรเกิด)`, r);
    }
  }
  ok(leaks.length === 0, `เรียก ${calls} ครั้ง ไม่มีชื่อ / เบอร์ / คูปองของร้าน B หลุดในคำตอบ`, leaks);

  console.log('\n[4] ข้อมูลร้าน B ไม่เปลี่ยน');
  const after = await snapshot(B);
  const changed = Object.keys(before).filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
  ok(changed.length === 0, `ทุกตาราง (${Object.keys(before).length} ตาราง ${rowsB} แถว) เหมือนก่อนลองทุกตัวอักษร`, changed.map((t) => t + ': ' + after[t].filter((x) => !before[t].includes(x)).join(' ').slice(0, 200)));
  const rate = (await db.query(`select id, point_rate_baht::float8 as r, name from shops order by id`)).rows;
  ok(rate[0].r === 12 && rate[1].r === 10 && rate[0].name === 'ร้านเอชื่อใหม่', 'แก้ค่าร้าน A แล้ว ร้าน B ยังเป็นค่าเดิม', rate);

  console.log('\n[5] พนักงานร้าน B ใช้คำสั่งพนักงาน/หลังบ้านของร้าน A ไม่ได้');
  const staffActions = Object.keys(ACTIONS).filter((a) => ACTIONS[a].roles);
  for (const who of ['OB', 'CB']) {
    const wrong = [];
    for (const a of staffActions) {
      const r = await call(A, who, a, {});
      if (r.ok || r.code !== 'NOT_STAFF') wrong.push(a + ':' + (r.code || 'ok'));
    }
    ok(wrong.length === 0, `${who === 'OB' ? 'เจ้าของ' : 'แคชเชียร์'}ร้าน B → ถูกปฏิเสธครบ ${staffActions.length} คำสั่ง (NOT_STAFF)`, wrong);
  }
  ok(JSON.stringify(await snapshot(B)) === JSON.stringify(before), 'ข้อมูลร้าน B ยังไม่เปลี่ยน');

  console.log('\n[6] ไฟล์ตรวจแต้ม db/check_points.sql');
  const checkSql = fs.readFileSync(path.join(ROOT, 'db', 'check_points.sql'), 'utf8');
  const code = checkSql.replace(/--.*$/gm, '');
  ok(!/\b(insert|update|delete|alter|drop|truncate|create|grant)\b/i.test(code), 'ไฟล์อ่านอย่างเดียว (ไม่มีคำสั่งแก้ข้อมูล)');
  let res = (await db.pg.query(checkSql)).rows;
  ok(res.length === 2 && res.every((r) => r['แต้มไม่ตรง'] === 0), 'ข้อมูลที่ระบบสร้าง → แต้มตรงทุกคนทั้งสองร้าน', res);
  await db.query(`update members set points = points + 7 where shop_id = $1 and id = $2`, [B, idsB[1]]);
  res = (await db.pg.query(checkSql)).rows;
  const rb = res.find((r) => r['ร้าน'] === B);
  const ra = res.find((r) => r['ร้าน'] === A);
  ok(rb['แต้มไม่ตรง'] === 1 && rb['รายชื่อที่ไม่ตรง'].startsWith(idsB[1] + ' (บัตร') && ra['แต้มไม่ตรง'] === 0, 'แก้แต้มตรงๆ ด้วย SQL 1 คน → ฟ้องคนนั้นคนเดียว ร้านถูกต้อง', res);
  await db.query(`update members set points = points - 7 where shop_id = $1 and id = $2`, [B, idsB[1]]);

  console.log = log;
  console.error = errLog;
  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write('✗ หยุดกลางทาง: ' + (e.stack || e) + '\n'); process.exit(1); }); // console.log ถูกกรองอยู่ → เขียนตรง
