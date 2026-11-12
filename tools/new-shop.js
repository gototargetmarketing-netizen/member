#!/usr/bin/env node
// เพิ่มร้านใหม่ / แก้แพ็กเกจร้านเดิม — ถามทีละข้อ ตรวจทุกช่องด้วยกฎเดียวกับฐานข้อมูล แล้วสร้างไฟล์ให้ครบในครั้งเดียว
// (แก้ไฟล์ร้านด้วยมือพลาดจุดเดียว เช่น ลืมจุลภาค หน้าเว็บของร้านนั้นเปิดไม่ได้ทั้งร้าน / รหัส LIFF ผิดตัวเดียว ลูกค้าเข้าไม่ได้)
//
// ใช้:  node tools/new-shop.js          → เมนู (1 เพิ่มร้านใหม่ / 2 แก้แพ็กเกจร้านเดิม)
//       node tools/new-shop.js add      → เพิ่มร้านใหม่
//       node tools/new-shop.js edit demo → แก้แพ็กเกจร้าน demo
// หรือดับเบิลคลิก "เพิ่มร้านใหม่ - แก้แพ็กเกจ LINE CRM.command"
//
// ใส่คำตอบล่วงหน้าได้ (ข้ามคำถามข้อนั้น) เช่น --id baansuan --name "บ้านสวน" --liff 2012345678-AbCd --package 2
//   --prefix BS --rate 25 --color "#2E7D32" --theme minimal --domain "" --tiers y --branches n --max-branches 3 --export y --broadcast y
//   --yes = ไม่ถามเลย ใช้ค่าที่ใส่ + ค่าตั้งต้น และยืนยันเอง (ชุดทดสอบใช้) / --root = โฟลเดอร์โปรเจค (ชุดทดสอบใช้สำเนา)
//
// สร้างให้:  shops/<ร้าน>/config.js · บรรทัดใน shops/shops.js · db/shops/<ร้าน>.sql (เพิ่มร้าน) · db/shops/<ร้าน>-owner.sql (อนุมัติเจ้าของร้าน)
// ไม่เข้าฐานข้อมูลเอง: รหัสฐานข้อมูลจริงอยู่ใน Vercel เท่านั้น (ห้ามอยู่ในเครื่อง) → สร้างไฟล์ SQL ให้วางใน Supabase แทน
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { pathToFileURL } = require('url');

// ต้องตรงกับ RESERVED ใน app/shop.js + check ของตาราง shops (db/001_schema.sql) — new-shop-test ตรวจให้
const RESERVED = ['staff', 'admin', 'app', 'shops', 'themes', 'tools', 'api', 'assets'];
// เว็บจริงของน้อง (Vercel ขึ้นจาก main) — ขั้น 7 ถ้าย้ายโดเมนหลัก แก้ที่นี่ที่เดียว
const MAIN_HOST = 'member-cyan.vercel.app';

// แพ็กเกจสำเร็จรูป = ค่าตั้งต้นของสวิตช์ (ปรับทีละตัวได้เสมอ) — ราคาและชื่อแพ็กเกจยังไม่สรุป เปลี่ยนที่นี่ได้
const PACKAGES = {
  1: { name: 'เริ่มต้น', features: { tiers: false, branches: false, export: false, broadcast: false } },
  2: { name: 'มาตรฐาน', features: { tiers: true, branches: false, export: true, broadcast: true } },
  3: { name: 'หลายสาขา', features: { tiers: true, branches: true, maxBranches: 3, export: true, broadcast: true } },
  4: { name: 'เลือกเองทั้งหมด', features: { tiers: false, branches: false, export: false, broadcast: false } }
};
const SWITCHES = [
  { key: 'tiers', label: 'ระดับสมาชิก + หน้าสิทธิ์สมาชิก' },
  { key: 'branches', label: 'หลายสาขา + ตารางเทียบสาขา' },
  { key: 'export', label: 'ส่งออก Excel' },
  { key: 'broadcast', label: 'ส่งข้อความตามกลุ่ม (LINE OA ของร้าน)' }
];

/* ---------- ตรวจข้อมูล (คืนข้อความผิด หรือ '' = ผ่าน) — กฎเดียวกับ check ในตาราง shops ---------- */
const HEX = /^#[0-9A-Fa-f]{6}$/;
const check = {
  id: (v, ctx) => {
    if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(v)) return 'ใช้ a-z ตัวเล็ก ตัวเลข หรือขีด (-) 2–30 ตัว ขึ้นต้นด้วยตัวอักษรหรือตัวเลข';
    if (RESERVED.includes(v)) return `"${v}" เป็นชื่อที่ระบบจองไว้ (${RESERVED.join(' ')})`;
    if (ctx.shops.some((s) => s.id === v) || fs.existsSync(path.join(ctx.root, 'shops', v))) return `มีร้านรหัส "${v}" อยู่แล้ว`;
    return '';
  },
  name: (v) => (!v ? 'กรุณาใส่ชื่อร้าน' : v.length > 60 ? 'ชื่อร้านยาวได้ไม่เกิน 60 ตัว' : /[<>]/.test(v) ? 'ชื่อร้านห้ามมี < หรือ >' : ''),
  liff: (v, ctx) => {
    if (!/^\d+-[A-Za-z0-9]+$/.test(v)) return 'รหัส LIFF หน้าตาแบบ 2012345678-AbCdEfGh (ก๊อปจาก LINE Developers → LIFF)';
    const dup = ctx.configs.find((c) => c.config.liffId === v);
    return dup ? `รหัส LIFF นี้ร้าน "${dup.id}" ใช้อยู่แล้ว (ร้านละ 1 ตัว)` : '';
  },
  // CP / TX ใช้นำหน้ารหัสคูปอง/รายการ — พนักงานค้นจากรหัสจะสับสน
  prefix: (v) => (!/^[A-Z]{1,4}$/.test(v) ? 'ใช้ A-Z ตัวใหญ่ 1–4 ตัว' : ['CP', 'TX'].includes(v) ? 'CP กับ TX ระบบใช้อยู่แล้ว' : ''),
  rate: (v) => (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) < 1 || Number(v) > 100000 ? 'ใส่ตัวเลข 1–100000 (บาท)' : ''),
  color: (v) => (HEX.test(v) ? '' : 'ใส่สีแบบ #2E7D32 (# ตามด้วย 6 ตัว)'),
  theme: (v) => (['minimal', 'luxury'].includes(v) ? '' : 'เลือก minimal (สว่าง เรียบ) หรือ luxury (หรู โทนเข้ม)'),
  domain: (v, ctx) => {
    if (!v) return '';
    if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v)) return 'โดเมนแบบ member.baansuan.com (ไม่ต้องมี https://)';
    const dup = ctx.shops.find((s) => (s.domains || []).includes(v));
    return dup ? `โดเมนนี้ร้าน "${dup.id}" ใช้อยู่แล้ว` : '';
  },
  package: (v) => (PACKAGES[v] ? '' : 'เลือก 1–4'),
  maxBranches: (v) => (v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 999) ? '' : 'ใส่ 1–999 หรือเว้นว่าง = ไม่จำกัด')
};

/* ---------- อ่านไฟล์ร้าน (เป็น ES module แต่สคริปต์นี้เป็น CommonJS → คัดลอกเป็น .mjs ชั่วคราวแล้ว import) ---------- */
async function loadModule(file) {
  const tmp = path.join(os.tmpdir(), `line-crm-shop-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmp, fs.readFileSync(file, 'utf8'));
  try { return (await import(pathToFileURL(tmp).href)).default; } finally { fs.rmSync(tmp, { force: true }); }
}
async function loadContext(root) {
  const shops = await loadModule(path.join(root, 'shops', 'shops.js'));
  const configs = [];
  for (const s of shops) {
    const f = path.join(root, 'shops', s.id, 'config.js');
    if (fs.existsSync(f)) configs.push({ id: s.id, file: f, config: await loadModule(f) });
  }
  return { root, shops, configs };
}

/* ---------- เขียนไฟล์ ---------- */
const js = (v) => JSON.stringify(v); // ข้อความในไฟล์ร้าน: JSON ถูกต้องตามรูป JS เสมอ (กันเครื่องหมายคำพูดในชื่อร้านทำไฟล์พัง)
const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;

function shade(hex, amount) { // เหมือน shade() ใน app/shop.js
  const to = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  return '#' + [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(v + (to - v) * p).toString(16).padStart(2, '0');
  }).join('').toUpperCase();
}

function featuresBlock(f) {
  const row = (code, note) => `    ${code}`.padEnd(24) + `// ${note}`; // คอมเมนต์ตรงคอลัมน์เดียวกัน อ่านง่าย
  const lines = [row(`tiers: ${!!f.tiers},`, 'ระดับสมาชิก + หน้าสิทธิ์สมาชิก'), row(`branches: ${!!f.branches},`, 'หลายสาขา + ตารางเทียบสาขา')];
  if (f.branches && f.maxBranches) lines.push(row(`maxBranches: ${f.maxBranches},`, 'จำนวนสาขาที่เปิดพร้อมกันได้ (ไม่มีบรรทัดนี้ = ไม่จำกัด)'));
  lines.push(row(`export: ${!!f.export},`, 'ปุ่มส่งออก Excel ในหลังบ้าน'));
  lines.push(row(`broadcast: ${!!f.broadcast}`, 'เมนูส่งข้อความตามกลุ่ม (ส่งจริงได้เมื่อเชื่อม LINE OA ของร้านแล้ว)'));
  return `  // แพ็กเกจของร้าน — แก้ด้วย node tools/new-shop.js edit <ร้าน> (เราเป็นคนตั้ง เจ้าของร้านแก้เองไม่ได้)\n` +
    `  // ตอนนี้แค่ซ่อนปุ่มในหน้าเว็บ ตัวกลางยังไม่ตรวจ (ขั้น 7)\n  features: {\n${lines.join('\n')}\n  },\n`;
}

// ตัวอักษรแรกที่เป็นพยัญชนะ/ตัวอักษร (ชื่อไทยอาจขึ้นต้นด้วยสระหน้า เช่น "เ")
const logoLetter = (name) => ((name.match(/[ก-ฮA-Za-z0-9]/) || ['?'])[0]).toUpperCase();

function configText(a, today) {
  return `// ค่าตั้งค่าของร้าน ${js(a.name)} — สร้างด้วย tools/new-shop.js เมื่อ ${today}
// ชื่อ โลโก้ สี ข้อความ: เจ้าของร้านแก้เองได้ในหลังบ้าน (เมนูหน้าตาร้าน) — ค่าในไฟล์นี้คือค่าตั้งต้น
// กฎแต้ม (อัตราแต้ม แต้มต้อนรับ ฯลฯ) อยู่ในฐานข้อมูล (ตาราง shops) แก้ในหลังบ้าน
export default {
  name: ${js(a.name)},
  logoText: ${js(logoLetter(a.name))},
  logo: '',
  liffId: ${js(a.liff)},
  // '/api' = ตัวกลางบนโดเมนเดียวกับหน้าเว็บ (ระบบใหม่ ฐานข้อมูล Supabase)
  apiUrl: '/api',
  theme: ${js(a.theme)},
  colors: {
    button: ${js(a.color.toUpperCase())},
    accent: ${js(a.color.toUpperCase())},
    cardFrom: ${js(shade(a.color, 0.15))},
    cardTo: ${js(shade(a.color, -0.35))}
  },
  font: { family: 'Prompt', google: 'Prompt:wght@400;500;600;700' },
  texts: {
    greeting: 'สวัสดี',
    pointUnit: 'แต้ม'
  },
${featuresBlock(a.features)}  // นโยบายความเป็นส่วนตัว (PDPA)
  // ⚠️ ข้อความด้านล่างเป็นตัวอย่าง ร้านต้องตรวจและแก้ให้ตรงกับการใช้ข้อมูลจริงก่อนเปิดใช้
  legal: {
    privacyUrl: '',
    privacyText:
      'ร้านเก็บชื่อ-นามสกุล วันเกิด เบอร์โทร และข้อมูลบัญชี LINE ของคุณ เพื่อใช้บริการสมาชิก สะสมแต้ม ' +
      'และมอบสิทธิพิเศษ ข้อมูลเก็บไว้ตลอดช่วงที่เป็นสมาชิก คุณขอดู แก้ไข หรือลบข้อมูลได้โดยติดต่อร้าน ' +
      'หากยินยอมรับข่าวสาร ร้านจะส่งโปรโมชันทาง LINE และยกเลิกได้ทุกเมื่อ'
  }
};
`;
}

function shopSql(a, today) {
  return `-- =====================================================================
-- เพิ่มร้าน ${a.name} (${a.id}) — สร้างด้วย tools/new-shop.js เมื่อ ${today}
-- วางใน Supabase SQL Editor ทั้งไฟล์แล้วกด Run (ในโปรเจคที่ร้านนี้ใช้)
-- รันซ้ำได้: ถ้ามีร้านรหัสนี้อยู่แล้วจะไม่ทับ (ค่าที่เจ้าของร้านแก้ไว้ไม่หาย)
-- ค่าอื่น (แต้มต้อนรับ ยอดซื้อสูงสุด อายุคูปอง ฯลฯ) ใช้ค่าตั้งต้น เจ้าของร้านแก้ในหลังบ้าน
-- =====================================================================
insert into shops (id, name, liff_id, member_prefix, point_rate_baht)
values (${sql(a.id)}, ${sql(a.name)}, ${sql(a.liff)}, ${sql(a.prefix)}, ${Number(a.rate)})
on conflict (id) do nothing;

-- ตรวจผล: ควรเห็น 1 แถว และ liff_id = ${a.liff}
-- (ถ้าไม่ตรง = มีร้านรหัสนี้อยู่ก่อนแล้ว อย่าใช้ต่อ ให้ถามผู้ดูแลระบบ)
select id, name, liff_id, member_prefix, point_rate_baht, status from shops where id = ${sql(a.id)};
`;
}

function ownerSql(a) {
  return `-- =====================================================================
-- อนุมัติเจ้าของร้าน ${a.name} (${a.id}) คนแรก
-- รันหลังจากเจ้าของร้านเปิด https://liff.line.me/${a.liff}/staff ผ่าน LINE แล้ว (ขึ้นว่ารออนุมัติ)
-- ปลอดภัย: อนุมัติเฉพาะเมื่อร้านนี้มีคนขอสิทธิ์อยู่คนเดียว และยังไม่มีเจ้าของร้าน
--   ถ้ามีหลายคนขอ → ไม่อนุมัติใคร ดูรายชื่อในผลลัพธ์แล้วถามผู้ดูแลระบบ
-- คนต่อไป: เจ้าของร้านอนุมัติเองในหลังบ้าน (เมนูพนักงาน)
-- =====================================================================
update staff set role = 'OWNER', status = 'ACTIVE', note = 'เจ้าของร้านคนแรก (อนุมัติจากไฟล์ของ tools/new-shop.js)'
where shop_id = ${sql(a.id)} and status = 'PENDING'
  and (select count(*) from staff where shop_id = ${sql(a.id)}) = 1
  and not exists (select 1 from staff where shop_id = ${sql(a.id)} and role = 'OWNER');

-- ตรวจผล: ควรเห็นเจ้าของร้าน 1 แถว role = OWNER, status = ACTIVE
select line_user_id, name, role, status, requested_at from staff where shop_id = ${sql(a.id)} order by requested_at;
`;
}

// เพิ่มบรรทัดใน shops/shops.js ก่อน "];" ตัวสุดท้าย (ตัดจุลภาคท้ายเดิมก่อน กันได้ ",," ซึ่งทำให้รายชื่อมีช่องว่าง)
function addToShopsJs(text, id, domain) {
  const line = `  { id: ${js(id).replace(/"/g, "'")}, domains: [${domain ? `'${domain}'` : ''}] }`;
  const out = text.replace(/,?\s*\n\];\s*$/, `,\n${line}\n];\n`);
  if (out === text) throw new Error('หาท้ายรายชื่อร้านใน shops/shops.js ไม่เจอ (ต้องจบด้วย "];")');
  return out;
}

// แทนส่วน features (+ คอมเมนต์ที่อยู่ติดด้านบน) ด้วยรูปมาตรฐาน — ไม่มี features = เพิ่มก่อน "};" ท้ายไฟล์
const FEATURES_RE = /(?:^[ \t]*\/\/.*\n)*^[ \t]*features:\s*\{[^{}]*\}[ \t]*,?[ \t]*(?:\/\/.*)?\n/m;
function replaceFeatures(text, f) {
  if (FEATURES_RE.test(text)) return text.replace(FEATURES_RE, featuresBlock(f));
  const out = text.replace(/\n\};\s*$/, `\n${featuresBlock(f).replace(/,\n$/, '\n')}};\n`);
  if (out === text) throw new Error('หาส่วน features ในไฟล์ร้านไม่เจอ');
  // ช่องก่อนหน้าต้องมีจุลภาค
  return out.replace(/([^,{\s])(\s*\n {2}\/\/ แพ็กเกจของร้าน)/, '$1,$2');
}

// สวิตช์จากไฟล์ร้าน → รูปเดียวกับ PACKAGES (ไม่ใส่ = ปิด เหมือนที่หน้าเว็บอ่าน)
function normFeatures(f = {}) {
  const out = { tiers: f.tiers === true, branches: f.branches === true, export: f.export === true, broadcast: f.broadcast === true };
  const n = Number(f.maxBranches);
  if (out.branches && Number.isInteger(n) && n > 0) out.maxBranches = n;
  return out;
}
const featureText = (f) => SWITCHES.map((s) => `  • ${s.label}: ${f[s.key] ? 'เปิด' : 'ปิด'}` +
  (s.key === 'branches' && f.branches ? (f.maxBranches ? ` (สูงสุด ${f.maxBranches} สาขา)` : ' (ไม่จำกัดจำนวน)') : '')).join('\n');

/* ---------- ถามคำถาม ---------- */
function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (a === '--yes') flags.yes = true;
    else flags[a.slice(2)] = argv[++i] ?? '';
  }
  return { pos, flags };
}

function createAsker(flags) {
  let rl = null;
  const lines = [];
  let waiting = null;
  const getLine = () => {
    if (!rl) {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
      rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
      rl.on('close', () => { if (waiting) { const w = waiting; waiting = null; w(null); } });
    }
    return lines.length ? Promise.resolve(lines.shift()) : new Promise((r) => { waiting = r; });
  };
  // flag = ชื่อตัวเลือก --xxx / validate คืนข้อความผิด / ไม่ถาม = ใช้ค่าจากตัวเลือก (ผิด = หยุด)
  async function ask(label, { flag, def = '', validate = () => '', transform = (v) => v } = {}) {
    if (flag && flags[flag] !== undefined && flags[flag] !== true) {
      const v = transform(String(flags[flag]).trim());
      const err = validate(v);
      if (err) throw new Error(`--${flag}: ${err}`);
      console.log(`${label}: ${v}`);
      return v;
    }
    if (flags.yes) {
      const err = validate(def);
      if (err) throw new Error(`ไม่ได้ใส่ --${flag || label} (${err})`);
      return def;
    }
    for (;;) {
      process.stdout.write(`${label}${def !== '' ? ` [${def}]` : ''}: `);
      const raw = await getLine();
      if (raw === null) throw new Error('ยกเลิก (ไม่มีคำตอบ)');
      const v = transform(raw.trim() === '' ? def : raw.trim());
      const err = validate(v);
      if (!err) return v;
      console.log(`  ✗ ${err}`);
    }
  }
  async function askBool(label, { flag, def }) {
    const v = await ask(`${label} (y = เปิด / n = ปิด)`, {
      flag, def: def ? 'เปิด' : 'ปิด',
      transform: (s) => ({ y: 'เปิด', yes: 'เปิด', เปิด: 'เปิด', n: 'ปิด', no: 'ปิด', ปิด: 'ปิด' }[s.toLowerCase()] || s),
      validate: (s) => (s === 'เปิด' || s === 'ปิด' ? '' : 'พิมพ์ y หรือ n')
    });
    return v === 'เปิด';
  }
  return { ask, askBool, close: () => rl && rl.close() };
}

async function askFeatures(q, start) {
  console.log('\nสวิตช์แพ็กเกจ (กด Enter = ใช้ค่าในวงเล็บ):');
  const f = {};
  for (const s of SWITCHES) {
    f[s.key] = await q.askBool(`  ${s.label}`, { flag: s.key, def: !!start[s.key] });
    if (s.key === 'branches' && f.branches) {
      const n = await q.ask('     จำนวนสาขาสูงสุด (เว้นว่าง = ไม่จำกัด)', { flag: 'max-branches', def: start.maxBranches ? String(start.maxBranches) : '', validate: check.maxBranches });
      if (n) f.maxBranches = Number(n);
    }
  }
  return normFeatures(f);
}

async function confirm(q, flags) {
  if (flags.yes) return true;
  const v = await q.ask('\nยืนยันบันทึก? (y/n)', { validate: (s) => (/^[yn]$/i.test(s) ? '' : 'พิมพ์ y หรือ n') });
  return v.toLowerCase() === 'y';
}

/* ---------- โหมด 1: เพิ่มร้านใหม่ ---------- */
async function addShop(ctx, q, flags) {
  console.log('\n=== เพิ่มร้านใหม่ ===');
  const a = {};
  a.id = await q.ask('รหัสร้าน (ภาษาอังกฤษ ใช้ในลิงก์ เช่น baansuan)', { flag: 'id', transform: (v) => v.toLowerCase(), validate: (v) => check.id(v, ctx) });
  a.name = await q.ask('ชื่อร้าน (ที่ลูกค้าเห็น)', { flag: 'name', validate: check.name });
  a.liff = await q.ask('รหัส LIFF ของร้าน', { flag: 'liff', validate: (v) => check.liff(v, ctx) });
  const defPrefix = (a.id.replace(/[^a-z]/g, '').slice(0, 2) || 'M').toUpperCase();
  a.prefix = await q.ask('ตัวย่อหน้ารหัสสมาชิก (A-Z 1–4 ตัว เช่น BS → BS-000001)', { flag: 'prefix', def: ['CP', 'TX'].includes(defPrefix) ? 'M' : defPrefix, transform: (v) => v.toUpperCase(), validate: check.prefix });
  a.rate = await q.ask('ยอดซื้อกี่บาท ได้ 1 แต้ม', { flag: 'rate', def: '20', validate: check.rate });
  a.color = await q.ask('สีหลักของร้าน (ปุ่ม + บัตรสมาชิก)', { flag: 'color', def: '#0EA5E9', validate: check.color });
  a.theme = await q.ask('สไตล์ minimal (สว่าง เรียบ) / luxury (หรู โทนเข้ม)', { flag: 'theme', def: 'minimal', transform: (v) => v.toLowerCase(), validate: check.theme });
  a.domain = await q.ask('โดเมนของร้าน (ไม่มี = กด Enter)', { flag: 'domain', def: '', transform: (v) => v.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''), validate: (v) => check.domain(v, ctx) });
  console.log('\nแพ็กเกจตั้งต้น: ' + Object.entries(PACKAGES).map(([k, p]) => `${k} ${p.name}`).join(' / '));
  const pkg = await q.ask('เลือกแพ็กเกจ', { flag: 'package', def: '2', validate: check.package });
  a.features = await askFeatures(q, PACKAGES[pkg].features);

  console.log(`\nสรุปร้าน "${a.name}" (${a.id})`);
  console.log(`  • ลิงก์ร้าน: https://liff.line.me/${a.liff}`);
  console.log(`  • รหัสสมาชิก ${a.prefix}-000001 · ${a.rate} บาท = 1 แต้ม · สี ${a.color.toUpperCase()} · ${a.theme}${a.domain ? ' · ' + a.domain : ''}`);
  console.log(featureText(a.features));
  if (!(await confirm(q, flags))) { console.log('ยกเลิก ไม่ได้สร้างอะไร'); return null; }

  const today = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });
  const root = ctx.root;
  const shopsFile = path.join(root, 'shops', 'shops.js');
  const shopsBefore = fs.readFileSync(shopsFile, 'utf8');
  const dir = path.join(root, 'shops', a.id);
  const cfgFile = path.join(dir, 'config.js');
  const sqlDir = path.join(root, 'db', 'shops');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cfgFile, configText(a, today));
    fs.writeFileSync(shopsFile, addToShopsJs(shopsBefore, a.id, a.domain));
    // ตรวจว่าไฟล์ที่เขียนอ่านกลับได้จริงและค่าตรง — ไม่ตรง = คืนสภาพเดิมทั้งหมด (ไม่ทิ้งร้านครึ่งๆ กลางๆ)
    const c = await loadModule(cfgFile);
    const list = await loadModule(shopsFile);
    if (c.liffId !== a.liff || c.name !== a.name || JSON.stringify(normFeatures(c.features)) !== JSON.stringify(a.features)) throw new Error('ไฟล์ร้านที่สร้างอ่านกลับได้ไม่ตรง');
    if (list.length !== ctx.shops.length + 1 || !list.some((s) => s.id === a.id)) throw new Error('รายชื่อร้านใน shops.js ไม่ถูกต้องหลังเพิ่ม');
    fs.mkdirSync(sqlDir, { recursive: true });
    fs.writeFileSync(path.join(sqlDir, `${a.id}.sql`), shopSql(a, today));
    fs.writeFileSync(path.join(sqlDir, `${a.id}-owner.sql`), ownerSql(a));
  } catch (e) {
    fs.writeFileSync(shopsFile, shopsBefore);
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }

  const host = a.domain || `${MAIN_HOST}/${a.id}`;
  console.log(`
✓ สร้างร้าน "${a.name}" แล้ว
  shops/${a.id}/config.js · shops/shops.js · db/shops/${a.id}.sql · db/shops/${a.id}-owner.sql

ขั้นต่อไป:
1) วาง db/shops/${a.id}.sql ใน Supabase SQL Editor แล้วกด Run
2) LINE Developers → LIFF ของร้าน → Endpoint URL = https://${host}
   (Size: Full · Scopes: openid + profile · เปิด Scan QR — หน้าพนักงานใช้กล้องของแอป LINE)
3) ส่งงานขึ้น GitHub (บอก Claude) — ร้านเปิดใช้ได้เมื่อขึ้นเว็บแล้ว${a.domain ? `
4) เพิ่มโดเมน ${a.domain} ในโปรเจค Vercel แล้วตั้ง DNS ตามที่ Vercel บอก` : ''}
${a.domain ? 5 : 4}) ให้เจ้าของร้านเปิด https://liff.line.me/${a.liff}/staff ผ่าน LINE (จะขึ้นว่ารออนุมัติ)
   แล้ววาง db/shops/${a.id}-owner.sql ใน Supabase กด Run → เป็นเจ้าของร้าน ตั้งค่าที่เหลือในหลังบ้านได้เอง
${a.domain ? 6 : 5}) ลิงก์ของร้าน: ลูกค้า https://liff.line.me/${a.liff}
   พนักงาน https://liff.line.me/${a.liff}/staff · หลังบ้าน https://liff.line.me/${a.liff}/admin`);
  return a;
}

/* ---------- โหมด 2: แก้แพ็กเกจร้านเดิม ---------- */
async function editShop(ctx, q, flags, shopArg) {
  console.log('\n=== แก้แพ็กเกจร้านเดิม ===');
  console.log('ร้านที่มี: ' + ctx.configs.map((c) => `${c.id} (${c.config.name})`).join(' · '));
  if (shopArg && flags.id === undefined) flags.id = shopArg; // node tools/new-shop.js edit demo → ไม่ต้องถามรหัสร้านซ้ำ
  const id = await q.ask('รหัสร้าน', {
    flag: 'id', transform: (v) => v.toLowerCase(),
    validate: (v) => (ctx.configs.some((c) => c.id === v) ? '' : `ไม่มีร้านรหัส "${v}"`)
  });
  const shop = ctx.configs.find((c) => c.id === id);
  const before = normFeatures(shop.config.features);
  console.log(`\nร้าน ${id} (${shop.config.name}) ตอนนี้:\n${featureText(before)}`);
  const after = await askFeatures(q, before);

  const changes = [];
  for (const s of SWITCHES) if (before[s.key] !== after[s.key]) changes.push(`  • ${s.label}: ${before[s.key] ? 'เปิด' : 'ปิด'} → ${after[s.key] ? 'เปิด' : 'ปิด'}`);
  if (after.branches && before.branches && (before.maxBranches || 0) !== (after.maxBranches || 0)) {
    changes.push(`  • จำนวนสาขาสูงสุด: ${before.maxBranches || 'ไม่จำกัด'} → ${after.maxBranches || 'ไม่จำกัด'}`);
  } else if (after.branches && !before.branches) changes.push(`  • จำนวนสาขาสูงสุด: ${after.maxBranches || 'ไม่จำกัด'}`);
  if (!changes.length) { console.log('\nไม่มีอะไรเปลี่ยน ไม่ได้แก้ไฟล์'); return { id, before, after, changed: false }; }
  console.log('\nจะเปลี่ยน:\n' + changes.join('\n'));

  // เตือนเรื่องที่ลืมง่ายตอนลดแพ็กเกจ (ข้อมูลเดิมไม่หายทุกกรณี — ปิด = ซ่อน)
  const warn = [];
  if (before.tiers && !after.tiers) warn.push('ปิดระดับสมาชิก: ถ้าร้านตั้งระดับไว้แล้ว ให้เจ้าของร้านกด "ปิดใช้ระดับสมาชิก" ในหลังบ้าน **ก่อน** ส่งไฟล์ขึ้นเว็บ (ไม่งั้นตัวคูณแต้มของระดับยังคิดอยู่ แต่เมนูหายไปแล้ว)');
  if (before.branches && !after.branches) warn.push('ปิดหลายสาขา: สาขาเดิมและข้อมูลยังอยู่ แค่ซ่อนเมนูสาขา (เพิ่ม/แก้สาขาไม่ได้)');
  if (after.branches && after.maxBranches && (!before.branches || !before.maxBranches || after.maxBranches < before.maxBranches)) {
    warn.push(`จำกัด ${after.maxBranches} สาขา: ถ้าร้านเปิดสาขาอยู่เกินนี้ สาขาเดิมยังใช้ได้ แต่เพิ่ม/เปิดสาขาใหม่ไม่ได้จนกว่าจะปิดให้เหลือไม่เกิน ${after.maxBranches}`);
  }
  if (after.tiers && !before.tiers && shop.config.apiUrl !== '/api') warn.push('ร้านนี้ยังใช้ระบบเดิม ระดับสมาชิกจะใช้ได้หลังย้ายมาระบบใหม่');
  if (warn.length) console.log('\n⚠️  ' + warn.join('\n⚠️  '));
  if (!(await confirm(q, flags))) { console.log('ยกเลิก ไม่ได้แก้ไฟล์'); return null; }

  const text = fs.readFileSync(shop.file, 'utf8');
  const next = replaceFeatures(text, after);
  fs.writeFileSync(shop.file, next);
  // ตรวจว่าแก้แล้วอ่านได้ + ค่าอื่นในไฟล์ไม่เปลี่ยน — ไม่ผ่าน = คืนไฟล์เดิม
  try {
    const c = await loadModule(shop.file);
    const rest = (o) => JSON.stringify({ ...o, features: undefined });
    if (JSON.stringify(normFeatures(c.features)) !== JSON.stringify(after)) throw new Error('สวิตช์ในไฟล์ที่แก้ไม่ตรงกับที่เลือก');
    if (rest(c) !== rest(shop.config)) throw new Error('ค่าอื่นในไฟล์ร้านเปลี่ยนไป');
  } catch (e) {
    fs.writeFileSync(shop.file, text);
    throw new Error(`${e.message} — คืนไฟล์เดิมแล้ว ไม่ได้แก้อะไร`);
  }
  console.log(`\n✓ แก้แพ็กเกจร้าน ${id} แล้ว (shops/${id}/config.js)\nขั้นต่อไป: ส่งงานขึ้น GitHub (บอก Claude) — มีผลกับร้านเมื่อขึ้นเว็บแล้ว`);
  return { id, before, after, changed: true };
}

async function main(argv = process.argv.slice(2)) {
  const { pos, flags } = parseArgs(argv);
  const root = path.resolve(flags.root || path.join(__dirname, '..'));
  const q = createAsker(flags);
  try {
    const ctx = await loadContext(root);
    let mode = pos[0];
    if (!['add', 'edit'].includes(mode)) {
      console.log('LINE CRM — จัดการร้าน\n  1) เพิ่มร้านใหม่\n  2) แก้แพ็กเกจร้านเดิม');
      const m = await q.ask('เลือก', { validate: (v) => (['1', '2'].includes(v) ? '' : 'เลือก 1 หรือ 2') });
      mode = m === '1' ? 'add' : 'edit';
    }
    return mode === 'add' ? await addShop(ctx, q, flags) : await editShop(ctx, q, flags, pos[1]);
  } finally {
    q.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.log(`\n✗ ${e.message}`); process.exitCode = 1; });
}

module.exports = { main, check, PACKAGES, RESERVED, normFeatures, replaceFeatures, addToShopsJs, shopSql, ownerSql, configText, loadModule };
