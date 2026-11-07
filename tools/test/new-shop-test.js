// ทดสอบสคริปต์เพิ่มร้านใหม่ / แก้แพ็กเกจ (tools/new-shop.js) — ทำในสำเนาโฟลเดอร์ shops/ ไม่แตะไฟล์ร้านจริง
// ตรวจ: กฎตรวจข้อมูล · ไฟล์ที่สร้างอ่านได้และค่าตรง · SQL รันในฐานข้อมูลจำลองได้ (ซ้ำได้) · ร้านใหม่ใช้ตัวกลางได้จริง
//       · อนุมัติเจ้าของร้านคนแรกเฉพาะกรณีปลอดภัย · แก้แพ็กเกจแล้วค่าอื่นในไฟล์ไม่เปลี่ยน · พังกลางทาง = คืนสภาพเดิม
// รัน: node tools/test/new-shop-test.js  (ติดตั้งครั้งแรก: cd tools/test && npm install)
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { createTestDb } = require('./pglite-db');

const ROOT = path.join(__dirname, '..', '..');
const NS = require(path.join(ROOT, 'tools', 'new-shop.js'));
const { createApp } = require(path.join(ROOT, 'api', '_lib', 'router.js'));

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); } };

// สำเนาโฟลเดอร์ shops/ (+ db/ ว่าง) ให้สคริปต์เขียนเล่น
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-crm-newshop-'));
  fs.cpSync(path.join(ROOT, 'shops'), path.join(dir, 'shops'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'db'));
  return dir;
}
// รันสคริปต์แบบไม่ถาม (--yes) + ซ่อนข้อความที่สคริปต์พิมพ์ / คืน { result, error, out }
async function run(args) {
  const log = console.log;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  try { return { result: await NS.main([...args, '--yes']), out: out.join('\n') }; } catch (e) { return { error: e.message, out: out.join('\n') }; } finally { console.log = log; }
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const shopsList = (dir) => NS.loadModule(path.join(dir, 'shops', 'shops.js'));
const cfgOf = (dir, id) => NS.loadModule(path.join(dir, 'shops', id, 'config.js'));

(async () => {
  console.log('\n[1] ชื่อที่จองไว้ตรงกับหน้าเว็บและฐานข้อมูล');
  const shopJs = read(ROOT, 'app/shop.js');
  const webReserved = JSON.parse(shopJs.match(/RESERVED = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  ok(JSON.stringify(webReserved) === JSON.stringify(NS.RESERVED), 'RESERVED เท่ากับ app/shop.js', webReserved);
  const schemaReserved = read(ROOT, 'db/001_schema.sql').match(/id not in \(([^)]*)\)/)[1].replace(/'/g, '').split(',').map((s) => s.trim());
  ok(JSON.stringify(schemaReserved) === JSON.stringify(NS.RESERVED), 'RESERVED เท่ากับ check ของตาราง shops', schemaReserved);

  console.log('\n[2] แพ็กเกจสำเร็จรูป');
  ok(JSON.stringify(NS.PACKAGES[1].features) === JSON.stringify({ tiers: false, branches: false, export: false }), '1 เริ่มต้น = ปิดทุกสวิตช์');
  ok(NS.PACKAGES[2].features.tiers && NS.PACKAGES[2].features.export && !NS.PACKAGES[2].features.branches, '2 มาตรฐาน = ระดับสมาชิก + ส่งออก ไม่มีหลายสาขา');
  ok(NS.PACKAGES[3].features.branches && NS.PACKAGES[3].features.maxBranches === 3, '3 หลายสาขา = เปิดสาขา (3 สาขา)');

  console.log('\n[3] ตรวจข้อมูลผิด → ไม่สร้างอะไร');
  const S = sandbox();
  const shopsBefore = read(S, 'shops/shops.js');
  const base = ['add', '--root', S, '--name', 'ร้านทดสอบ', '--liff', '2012000001-Abc'];
  const bad = [
    [['--id', 'Baan Suan'], 'รหัสร้านมีช่องว่าง/ตัวใหญ่ (ตัวใหญ่แปลงเป็นเล็กแล้วยังมีช่องว่าง)'],
    [['--id', 'admin'], 'รหัสร้านเป็นชื่อที่จองไว้'],
    [['--id', 'demo'], 'รหัสร้านซ้ำร้านเดิม'],
    [['--id', 'x'], 'รหัสร้านสั้นเกิน'],
    [['--id', 'okshop', '--liff', '2012434511-bQt38UpF'], 'รหัส LIFF ซ้ำกับร้าน demo'],
    [['--id', 'okshop', '--liff', 'liff-123'], 'รหัส LIFF ผิดรูปแบบ'],
    [['--id', 'okshop', '--prefix', 'CP'], 'ตัวย่อรหัสสมาชิก CP (ระบบใช้กับคูปอง)'],
    [['--id', 'okshop', '--color', 'red'], 'สีผิดรูปแบบ'],
    [['--id', 'okshop', '--rate', '0'], 'อัตราแต้ม 0 บาท'],
    [['--id', 'okshop', '--package', '9'], 'แพ็กเกจที่ไม่มี'],
    [['--id', 'okshop', '--max-branches', '0', '--branches', 'y'], 'จำนวนสาขา 0'],
    [['--id', 'okshop', '--name', 'ร้าน<script>'], 'ชื่อร้านมี < >']
  ];
  for (const [extra, label] of bad) {
    const r = await run([...base, ...extra]);
    ok(r.error && !fs.existsSync(path.join(S, 'shops', 'okshop')), `${label} → ไม่ผ่าน: ${r.error || ''}`);
  }
  ok(read(S, 'shops/shops.js') === shopsBefore && !fs.existsSync(path.join(S, 'db', 'shops')), 'ไม่มีไฟล์ไหนถูกแก้/สร้าง');

  console.log('\n[4] เพิ่มร้านใหม่ (ชื่อมีเครื่องหมายคำพูด + โดเมน + แพ็กเกจหลายสาขาปรับเอง)');
  const r = await run(['add', '--root', S, '--id', 'BaanSuan', '--name', "บ้านสวน 'คาเฟ่' \"เชียงใหม่\"", '--liff', '2012999999-AbCdEf',
    '--prefix', 'bs', '--rate', '25', '--color', '#2e7d32', '--domain', 'https://Member.BaanSuan.com/', '--package', '3', '--max-branches', '5', '--export', 'n']);
  ok(!r.error && r.result, 'สร้างสำเร็จ', r.error);
  const c = await cfgOf(S, 'baansuan');
  ok(c.name === "บ้านสวน 'คาเฟ่' \"เชียงใหม่\"" && c.liffId === '2012999999-AbCdEf' && c.apiUrl === '/api', 'ไฟล์ร้านอ่านได้ ชื่อ (มี \' และ ") + LIFF + ระบบใหม่ ตรง', c);
  ok(JSON.stringify(c.features) === JSON.stringify({ tiers: true, branches: true, maxBranches: 5, export: false }), 'สวิตช์ = แพ็กเกจ 3 + ปรับเอง (5 สาขา ไม่มีส่งออก)', c.features);
  ok(c.colors.button === '#2E7D32' && /^#[0-9A-F]{6}$/.test(c.colors.cardFrom) && /^#[0-9A-F]{6}$/.test(c.colors.cardTo) && c.logoText === 'บ', 'สี + ตัวอักษรโลโก้', c.colors);
  ok(['name', 'liffId', 'apiUrl', 'theme', 'colors', 'font', 'texts', 'features', 'legal'].every((k) => k in c) && fs.existsSync(path.join(ROOT, 'themes', c.theme + '.css')), 'มีครบทุกช่องที่หน้าเว็บใช้ + ไฟล์ธีมมีจริง');
  const list = await shopsList(S);
  ok(list.length === 3 && list[2].id === 'baansuan' && list[2].domains[0] === 'member.baansuan.com', 'เพิ่มใน shops.js (โดเมนตัด https:// และ / ท้าย)', list);
  ok(/Endpoint URL = https:\/\/member\.baansuan\.com/.test(r.out) && /baansuan-owner\.sql/.test(r.out), 'บอกขั้นตอนต่อ (Endpoint ใช้โดเมนร้าน + ไฟล์อนุมัติเจ้าของ)');
  const dupDomain = await run(['add', '--root', S, '--id', 'other', '--name', 'อีกร้าน', '--liff', '2012000002-Xy', '--domain', 'member.baansuan.com']);
  ok(dupDomain.error && /ใช้อยู่แล้ว/.test(dupDomain.error), 'โดเมนซ้ำร้านอื่น → ไม่ผ่าน', dupDomain.error);
  const dupLiff = await run(['add', '--root', S, '--id', 'other', '--name', 'อีกร้าน', '--liff', '2012999999-AbCdEf']);
  ok(dupLiff.error && /baansuan/.test(dupLiff.error), 'รหัส LIFF ซ้ำกับร้านที่เพิ่งเพิ่ม → ไม่ผ่าน', dupLiff.error);
  // ร้านที่ 2 ต่อท้ายได้ (shops.js ยังถูกต้องหลังเพิ่มหลายครั้ง) + ค่าตั้งต้นทั้งหมด
  const r2 = await run(['add', '--root', S, '--id', 'cafe-2', '--name', 'คาเฟ่สอง', '--liff', '2012000003-Zz']);
  const c2 = await cfgOf(S, 'cafe-2');
  ok(!r2.error && (await shopsList(S)).length === 4 && JSON.stringify(c2.features) === JSON.stringify(NS.PACKAGES[2].features), 'ร้านที่ 2 ไม่ใส่แพ็กเกจ = มาตรฐาน (ค่าตั้งต้น)', r2.error || c2.features);

  console.log('\n[5] SQL ที่สร้าง รันในฐานข้อมูลจำลอง');
  const db = await createTestDb();
  const shopSqlText = read(S, 'db/shops/baansuan.sql');
  await db.pg.exec(shopSqlText);
  let row = (await db.query(`select name, liff_id, member_prefix, point_rate_baht::float8 as rate, status from shops where id = 'baansuan'`)).rows[0];
  ok(row && row.name === "บ้านสวน 'คาเฟ่' \"เชียงใหม่\"" && row.liff_id === '2012999999-AbCdEf' && row.member_prefix === 'BS' && row.rate === 25 && row.status === 'ACTIVE', 'เพิ่มร้านในฐานข้อมูล ค่าตรง', row);
  await db.query(`update shops set point_rate_baht = 30 where id = 'baansuan'`);
  await db.pg.exec(shopSqlText);
  row = (await db.query(`select point_rate_baht::float8 as rate from shops where id = 'baansuan'`)).rows[0];
  ok(row.rate === 30, 'รันซ้ำได้ ไม่ทับค่าที่เจ้าของร้านแก้ไว้');
  await db.pg.exec(read(S, 'db/shops/cafe-2.sql'));

  console.log('\n[6] ร้านใหม่ใช้ตัวกลางได้จริง + อนุมัติเจ้าของร้านคนแรก');
  const log = console.log;
  console.log = (...a) => { if (/^ {2}[✓✗]|^\n?\[/.test(String(a[0]))) log(...a); }; // ซ่อนบันทึกของระบบ
  const app = createApp({ db: () => db, verifier: {}, allowTestTokens: true, region: 'test' });
  const call = (shop, user, action, body) => app.handle(Object.assign({ shop, idToken: `TEST:${user}:${user}`, action, requestId: crypto.randomUUID() }, body || {}));
  let a = await call('baansuan', 'U_NEW_1', 'bootstrap');
  ok(a.ok && a.member === null, 'ลูกค้าเปิดบัตรร้านใหม่ได้ (ยังไม่เป็นสมาชิก)', a);
  a = await call('baansuan', 'U_NEW_1', 'register', { consentPrivacy: true, firstName: 'ลูกค้า', lastName: 'ร้านใหม่', birthDate: '1990-05-05', phone: '0891234567' });
  ok(a.ok && /^BS-/.test(a.member.memberId), 'สมัครสมาชิกได้ รหัสขึ้นต้นด้วยตัวย่อของร้าน', a.member || a);
  a = await call('baansuan', 'U_OWNER', 'staffMe');
  ok(a.ok && a.staff.status === 'PENDING', 'เจ้าของร้านเปิดหน้าพนักงาน → รออนุมัติ', a.staff);
  const ownerSql = read(S, 'db/shops/baansuan-owner.sql');
  await db.pg.exec(ownerSql);
  a = await call('baansuan', 'U_OWNER', 'staffMe');
  ok(a.ok && a.staff.status === 'ACTIVE' && a.staff.role === 'OWNER', 'วางไฟล์อนุมัติ → เป็นเจ้าของร้าน', a.staff);
  a = await call('baansuan', 'U_OWNER', 'staffLookup', { query: '0891234567' });
  ok(a.ok && a.member && /^BS-/.test(a.member.memberId), 'เจ้าของร้านค้นสมาชิกร้านตัวเองได้', a);
  a = await call('baansuan', 'U_OWNER', 'staffLookup', { query: 'DM-000001' });
  ok(!a.ok && a.code === 'NOT_FOUND', 'ค้นสมาชิกของร้าน demo จากร้านใหม่ไม่เจอ (ข้อมูลไม่ปนกัน)', a);
  a = await call('demo', 'U_OWNER', 'staffMe');
  ok(a.ok && a.staff.status === 'PENDING', 'เป็นเจ้าของร้านใหม่ ไม่ได้สิทธิ์ในร้าน demo', a.staff);
  // รันไฟล์อนุมัติซ้ำ / มีคนอื่นมาขอสิทธิ์ทีหลัง → ไม่อนุมัติใครเพิ่ม
  await call('baansuan', 'U_STRANGER', 'staffMe');
  await db.pg.exec(ownerSql);
  a = await call('baansuan', 'U_STRANGER', 'staffMe');
  ok(a.staff.status === 'PENDING', 'รันไฟล์อนุมัติซ้ำหลังมีคนอื่นขอสิทธิ์ → คนนั้นยังรออนุมัติ', a.staff);
  // ร้านที่มีคนขอสิทธิ์ 2 คนก่อนอนุมัติ → ไม่อนุมัติใครเลย (ไม่รู้ว่าใครคือเจ้าของ)
  await call('cafe-2', 'U_A', 'staffMe');
  await call('cafe-2', 'U_B', 'staffMe');
  await db.pg.exec(read(S, 'db/shops/cafe-2-owner.sql'));
  const n = (await db.query(`select count(*)::int as n from staff where shop_id = 'cafe-2' and status = 'ACTIVE'`)).rows[0].n;
  ok(n === 0, 'มีคนขอสิทธิ์ 2 คน → ไม่อนุมัติใคร (ให้ถามผู้ดูแลระบบ)');
  console.log = log;

  console.log('\n[7] แก้แพ็กเกจร้านเดิม');
  const kwBefore = read(S, 'shops/khamwan/config.js');
  const kwCfg = await cfgOf(S, 'khamwan');
  let e = await run(['edit', 'khamwan', '--root', S, '--tiers', 'y', '--max-branches', '', '--export', 'n']);
  const kw = await cfgOf(S, 'khamwan');
  ok(!e.error && JSON.stringify(kw.features) === JSON.stringify({ tiers: true, branches: true, export: false }), 'เปิดระดับ + สาขาไม่จำกัด + ปิดส่งออก', e.error || kw.features);
  ok(JSON.stringify({ ...kw, features: 0 }) === JSON.stringify({ ...kwCfg, features: 0 }), 'ค่าอื่นในไฟล์ร้านไม่เปลี่ยน');
  const kwAfter = read(S, 'shops/khamwan/config.js');
  const outside = (t) => t.replace(/(?:^[ \t]*\/\/.*\n)*^[ \t]*features:\s*\{[^{}]*\},?.*\n/m, '');
  ok(outside(kwAfter) === outside(kwBefore), 'ข้อความนอกส่วนแพ็กเกจเหมือนเดิมทุกตัวอักษร (รวมคอมเมนต์)');
  ok(/ยังใช้ระบบเดิม/.test(e.out), 'เตือน: ร้านยังใช้ระบบเดิม ระดับสมาชิกยังใช้ไม่ได้');
  e = await run(['edit', 'khamwan', '--root', S, '--tiers', 'n', '--branches', 'n']);
  ok(/ปิดใช้ระดับสมาชิก/.test(e.out) && /สาขาเดิมและข้อมูลยังอยู่/.test(e.out), 'ลดแพ็กเกจ → เตือนเรื่องระดับสมาชิกและสาขา');
  const same = read(S, 'shops/khamwan/config.js');
  e = await run(['edit', 'khamwan', '--root', S]);
  ok(!e.error && e.result.changed === false && read(S, 'shops/khamwan/config.js') === same, 'ไม่เปลี่ยนอะไร → ไม่แตะไฟล์');
  e = await run(['edit', 'demo', '--root', S, '--max-branches', '4']);
  ok((await cfgOf(S, 'demo')).features.maxBranches === 4 && /จำกัด 4 สาขา/.test(e.out), 'ร้าน demo (features บรรทัดเดียว) แก้ได้ + เตือนเมื่อจำกัดจำนวนสาขา');
  e = await run(['edit', 'nope', '--root', S]);
  ok(e.error && /ไม่มีร้าน/.test(e.error), 'ร้านที่ไม่มี → ไม่ผ่าน');
  // ไฟล์ร้านที่ไม่มีส่วน features เลย → เพิ่มให้ท้ายไฟล์
  fs.writeFileSync(path.join(S, 'shops', 'cafe-2', 'config.js'), "export default {\n  name: 'คาเฟ่สอง',\n  liffId: '2012000003-Zz'\n};\n");
  e = await run(['edit', 'cafe-2', '--root', S, '--export', 'y']);
  const c2b = await cfgOf(S, 'cafe-2');
  ok(!e.error && c2b.features.export === true && c2b.name === 'คาเฟ่สอง', 'ไฟล์ที่ไม่มี features → เพิ่มให้ อ่านได้', e.error || c2b);

  console.log('\n[8] พังกลางทาง → คืนสภาพเดิม');
  const S2 = sandbox();
  fs.writeFileSync(path.join(S2, 'shops', 'shops.js'), read(S2, 'shops/shops.js').replace(/\];\s*$/, ']; // แก้มือจนรูปแบบเพี้ยน\n'));
  const broken = read(S2, 'shops/shops.js');
  e = await run(['add', '--root', S2, '--id', 'fresh', '--name', 'ร้านใหม่', '--liff', '2012000009-Q']);
  ok(e.error && !fs.existsSync(path.join(S2, 'shops', 'fresh')) && read(S2, 'shops/shops.js') === broken && !fs.existsSync(path.join(S2, 'db', 'shops')), 'shops.js รูปแบบไม่ตรง → ไม่สร้างอะไรค้างไว้', e.error);

  fs.rmSync(S, { recursive: true, force: true });
  fs.rmSync(S2, { recursive: true, force: true });
  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('✗ หยุดกลางทาง: ' + e.stack); process.exit(1); });
