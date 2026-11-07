// ฐานข้อมูลจำลองในเครื่อง (PGlite = PostgreSQL ตัวจริงที่รันใน Node) หน้าตาเดียวกับ api/_lib/db.js
// ใช้ในชุดทดสอบและเซิร์ฟเวอร์ทดสอบ → ตัวกลางรันคำสั่ง SQL ชุดเดียวกับตอนต่อ Supabase จริง
const path = require('path');
const fs = require('fs');
const { PGlite } = require('@electric-sql/pglite');

const DB_DIR = path.join(__dirname, '..', '..', 'db');

function wrap(pg) {
  return {
    pg,
    query: (text, params) => pg.query(text, params),
    tx: (fn) => pg.transaction(tx => fn({ query: (text, params) => tx.query(text, params) }))
  };
}

// ไฟล์ปรับตารางตามลำดับ (เหมือนที่วางใน Supabase) — 002 เป็นข้อมูลทดลอง ไม่ใช่การปรับตาราง
const MIGRATIONS = ['001_schema.sql', '003_delete_and_tiers.sql', '004_tier_points_benefits.sql'];

// สร้างฐานข้อมูลใหม่ในหน่วยความจำ + ตาราง (001, 003 …) + ร้านทดลอง demo (002 ถ้า withDemo)
async function createTestDb({ withDemo = true } = {}) {
  const pg = new PGlite();
  for (const f of MIGRATIONS) await pg.exec(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
  if (withDemo) await pg.exec(fs.readFileSync(path.join(DB_DIR, '002_demo_seed.sql'), 'utf8'));
  return wrap(pg);
}

module.exports = { createTestDb, wrap, DB_DIR, MIGRATIONS };
