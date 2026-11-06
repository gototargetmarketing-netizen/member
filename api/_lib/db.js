// เชื่อมฐานข้อมูล Supabase (PostgreSQL) — ใช้รหัสเชื่อมต่อจากตัวแปร DATABASE_URL ในหน้าตั้งค่า Vercel เท่านั้น
// (เป็นรหัสลับ ห้ามใส่ในไฟล์ใดๆ ในโปรเจค)
//
// ทำไมต่อฐานข้อมูลตรง ไม่ผ่าน API ของ Supabase:
//   • บันทึกหลายตารางพร้อมกันได้ (แต้ม + รายการ + คูปอง สำเร็จพร้อมกัน หรือไม่บันทึกเลย) → แต้มไม่เพี้ยนแม้ระบบสะดุดกลางทาง
//   • ชุดทดสอบในเครื่องใช้ PostgreSQL จำลอง (PGlite) รันคำสั่ง SQL ชุดเดียวกันได้ทุกตัว
//   • รหัสลับมีตัวเดียว
//
// ใช้ "Transaction pooler" ของ Supabase (พอร์ต 6543) ซึ่งทำมาสำหรับระบบแบบ Vercel ที่เปิด-ปิดเครื่องบ่อย
// ทุกฟังก์ชันคืน { query(sql, params), tx(fn) } หน้าตาเดียวกับตัวจำลองในชุดทดสอบ
const { userError } = require('./errors');

let pool = null;

function connectionConfig(url) {
  // sslmode ในลิงก์จะทับค่า ssl ด้านล่าง (pg รุ่นใหม่ถือว่า require = ตรวจใบรับรองเต็ม ซึ่งใบรับรองของ Supabase ไม่ผ่าน)
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    url = u.toString();
  } catch (e) { /* ลิงก์อ่านไม่ออก → ให้ pg แจ้ง error เอง */ }
  return {
    connectionString: url,
    // เข้ารหัสการเชื่อมต่อเสมอ / ยังไม่ตรวจใบรับรองของ Supabase (ต้องใช้ไฟล์ใบรับรองของ Supabase — ทำก่อนใช้กับข้อมูลจริง ขั้น 7)
    ssl: { rejectUnauthorized: false },
    max: 3,                        // เครื่องเดียวรับหลายคำขอพร้อมกันได้ แต่ไม่ต้องเปิดสายเยอะ (pooler ของ Supabase จำกัดจำนวน)
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    query_timeout: 8000,           // คำสั่งค้าง → ตอบผู้ใช้ว่าลองใหม่ ดีกว่าหมุนจนหมดเวลา
    application_name: 'line-crm-api'
  };
}

function wrap(p) {
  return {
    query: (text, params) => p.query(text, params),
    // ทำหลายคำสั่งเป็นก้อนเดียว: สำเร็จทั้งหมด หรือย้อนกลับทั้งหมด
    async tx(fn) {
      const client = await p.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('commit');
        return result;
      } catch (e) {
        try { await client.query('rollback'); } catch (e2) { /* สายหลุดไปแล้ว */ }
        throw e;
      } finally {
        client.release();
      }
    }
  };
}

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ยังไม่ได้ตั้ง DATABASE_URL ใน Vercel (Settings → Environment Variables) — ดู CLAUDE.md ขั้น 2');
    throw userError('ระบบยังตั้งค่าไม่ครบ กรุณาติดต่อผู้ดูแลระบบ', 'NO_DB');
  }
  if (!pool) {
    const { Pool } = require('pg'); // โหลดเมื่อใช้จริง → คำสั่งที่ไม่แตะฐานข้อมูล (ping) ไม่ต้องรอ
    pool = new Pool(connectionConfig(url));
    pool.on('error', e => console.error('db: สายที่พักอยู่หลุด — ' + e.message));
  }
  return wrap(pool);
}

module.exports = { getDb, wrap, connectionConfig };
