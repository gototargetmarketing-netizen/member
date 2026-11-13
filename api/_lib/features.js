// แพ็กเกจของร้าน (สวิตช์ features ใน shops/<ร้าน>/config.js) — ตัวกลางตรวจซ้ำ ไม่เชื่อแค่การซ่อนปุ่มในหน้าเว็บ (ขั้น 7 — ทำ 13 พ.ย. 2569)
//
// ทำไมอ่านจากไฟล์ร้าน ไม่เก็บในฐานข้อมูล:
//   • ไฟล์เดียวกับที่หน้าเว็บใช้ซ่อน/แสดงเมนู → หน้าเว็บกับตัวกลางเห็นแพ็กเกจตรงกันเสมอ (เก็บ 2 ที่ อาจไม่ตรงกัน: เมนูขึ้นแต่กดแล้วไม่ยอม)
//   • ไฟล์อยู่ใน repo เจ้าของร้านแก้เองไม่ได้ / แก้แพ็กเกจด้วย tools/new-shop.js แล้วขึ้นเว็บใหม่ ไม่ต้องวาง SQL
//   • Vercel ต้องแนบโฟลเดอร์ shops/ ไปกับตัวกลาง → vercel.json "functions" → "includeFiles" (ไม่แนบ = ทุกร้านถูกปิดทุกแพ็กเกจ)
//
// อ่านไม่ได้ / ไม่มีไฟล์ / ค่าไม่ใช่ true → ถือว่า "ปิด" (กันพลาดไปเปิดของที่ร้านไม่ได้ซื้อ) + เขียนสาเหตุลง log
// จำผลไว้ทั้งอายุเครื่อง: ไฟล์ร้านเปลี่ยนได้ทางเดียวคือขึ้นเว็บใหม่ ซึ่งเปิดเครื่องใหม่อยู่แล้ว
'use strict';

const fs = require('fs');
const path = require('path');

const SHOPS_DIR = path.join(__dirname, '..', '..', 'shops');
const SHOP_ID = /^[a-z0-9][a-z0-9-]{1,29}$/;
// ชื่อสวิตช์ต้องตรงกับ SWITCHES ใน tools/new-shop.js และฟังก์ชัน *Feature() ใน app/admin.js
const KEYS = ['tiers', 'branches', 'export', 'broadcast'];
const cache = new Map(); // ร้าน → Promise<แพ็กเกจ>

// รูปเดียวกับที่หน้าเว็บอ่าน: เปิดเมื่อเป็น true เท่านั้น / maxBranches จำนวนเต็ม > 0 (ไม่ใส่ = ไม่จำกัด)
function normalize(f) {
  const src = f && typeof f === 'object' ? f : {};
  const out = {};
  KEYS.forEach((k) => { out[k] = src[k] === true; });
  const n = Number(src.maxBranches);
  out.maxBranches = out.branches && Number.isInteger(n) && n > 0 ? n : null;
  return out;
}

const ALL_OFF = Object.freeze(normalize({}));

// อ่านไฟล์ร้านเป็น "ข้อความ" แล้วแยกเฉพาะส่วน features: { ... } — ไม่รันโค้ดในไฟล์
// (เคยใช้ import() แบบ data: URL ใช้ได้ในเครื่อง แต่บน Vercel อ่านไม่ได้ ทุกร้านถูกปิดทุกแพ็กเกจ — 13 พ.ย. 2569)
// รับเฉพาะค่าตรงตัว true / false / ตัวเลข แบบที่ tools/new-shop.js เขียน — ค่าอื่น (ตัวแปร สูตร) = ปิด
// api-test เทียบผลกับการเปิดไฟล์จริงแบบหน้าเว็บทุกร้าน (ต้องได้ค่าเท่ากัน)
function parseFeatures(text) {
  // ตัดคอมเมนต์ // ท้ายบรรทัด (ต้องมีช่องว่างหรือต้นบรรทัดนำหน้า → ไม่ตัด https:// ในข้อความ) และ /* */
  const clean = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const m = clean.match(/(?:^|[\s,{])features\s*:\s*\{([^{}]*)\}/);
  if (!m) return {};
  const out = {};
  m[1].split(/[,\n]/).forEach((part) => {
    const kv = part.match(/^\s*['"]?([A-Za-z]+)['"]?\s*:\s*(true|false|\d+)\s*$/);
    if (kv) out[kv[1]] = kv[2] === 'true' ? true : kv[2] === 'false' ? false : Number(kv[2]);
  });
  return out;
}

async function readFeatures(shopId) {
  if (!SHOP_ID.test(String(shopId || ''))) return ALL_OFF;
  const file = path.join(SHOPS_DIR, shopId, 'config.js');
  try {
    return Object.freeze(normalize(parseFeatures(fs.readFileSync(file, 'utf8'))));
  } catch (e) {
    console.error('อ่านแพ็กเกจของร้าน ' + shopId + ' ไม่ได้ (' + (e && e.code === 'ENOENT' ? 'ไม่พบ ' + file +
      ' — ตรวจ includeFiles ใน vercel.json' : (e && e.message) || e) + ') → ปิดทุกแพ็กเกจของร้านนี้ไว้ก่อน');
    return ALL_OFF;
  }
}

// จำนวนไฟล์ร้านที่ตัวกลางมองเห็น — ping ตอบค่านี้ ไว้เช็กจากภายนอกว่า Vercel แนบโฟลเดอร์ shops/ มาจริง (ไม่บอกแพ็กเกจของร้านไหน)
function shopFileCount() {
  try {
    return fs.readdirSync(SHOPS_DIR).filter((d) => SHOP_ID.test(d) && fs.existsSync(path.join(SHOPS_DIR, d, 'config.js'))).length;
  } catch (e) {
    return 0;
  }
}

function loadFeatures(shopId) {
  if (!cache.has(shopId)) cache.set(shopId, readFeatures(shopId));
  return cache.get(shopId);
}

const has = (ctx, key) => !!(ctx && ctx.features && ctx.features[key] === true);

module.exports = { loadFeatures, normalize, parseFeatures, shopFileCount, has, KEYS, ALL_OFF, _cache: cache };
