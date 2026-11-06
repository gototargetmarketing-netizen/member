// ตัวกลางระหว่างหน้าเว็บกับฐานข้อมูล (Vercel Function ที่ /api) — มาแทน Apps Script (ขั้น 2 ของการย้าย ดู CLAUDE.md)
// รับคำขอแบบเดียวกับ Apps Script: POST แบบ text/plain → หน้าเว็บสลับมาใช้ได้แค่เปลี่ยน apiUrl
// ไฟล์นี้แค่รับ-ส่ง HTTP งานจริงอยู่ใน _lib/router.js (ไฟล์ใน _lib ไม่ถูกเปิดเป็นหน้าเว็บ เพราะขึ้นต้นด้วย _)
const { createApp, API_VERSION } = require('./_lib/router');
const { getDb } = require('./_lib/db');
const { createVerifier } = require('./_lib/line');
const { createStorage } = require('./_lib/storage');

const MAX_BODY = 4 * 1024 * 1024; // Vercel รับไม่เกิน 4.5 MB ต่อคำขออยู่แล้ว (รูปที่อัปโหลดต้องย่อก่อนส่ง)

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');          // คำตอบของแต่ละคนห้ามถูกจำไว้ให้คนอื่น
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(JSON.stringify(obj));
}

// Vercel อ่านเนื้อคำขอให้แล้ว (text/plain → ข้อความ) / เซิร์ฟเวอร์ทดสอบในเครื่องยังไม่อ่าน → อ่านเอง
async function readBody(req) {
  let body;
  try { body = req.body; } catch (e) { return '{bad'; } // Vercel แปลง JSON ไม่ผ่าน → ให้ตอบว่าคำขอไม่ถูกต้อง
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body && typeof body === 'object') return body;
  if (body === null) return '';
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { tooLarge: true });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function createHandler(app) {
  return async function handler(req, res) {
    if (req.method === 'GET') return send(res, 200, { ok: true, service: 'LINE CRM', version: API_VERSION });
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'คำขอไม่ถูกต้อง', code: 'BAD_REQUEST' });
    let raw;
    try {
      raw = await readBody(req);
    } catch (e) {
      return send(res, e.tooLarge ? 413 : 400, { ok: false, error: e.tooLarge ? 'ข้อมูลใหญ่เกินไป' : 'คำขอไม่ถูกต้อง', code: 'BAD_REQUEST' });
    }
    // ผิดพลาดระดับคำสั่ง (ไม่รู้จักคำสั่ง / รหัส LINE หมดอายุ) ตอบ 200 + ok:false เหมือน Apps Script → หน้าเว็บอ่านได้ทางเดียว
    send(res, 200, await app.handle(raw));
  };
}

let storage = null;
const app = createApp({
  db: getDb,
  verifier: createVerifier(),
  storage: () => storage || (storage = createStorage()), // ที่เก็บรูป (ใช้เฉพาะตอนอัปโหลด)
  // รหัสทดสอบใช้ได้เฉพาะเมื่อตั้ง CRM_TEST_TOKENS=on และไม่ใช่เว็บจริงเด็ดขาด
  allowTestTokens: process.env.CRM_TEST_TOKENS === 'on' && process.env.VERCEL_ENV !== 'production',
  region: process.env.VERCEL_REGION || 'local' // ใช้ยืนยันว่าตัวกลางรันที่สิงคโปร์ (sin1) จริง
});

module.exports = createHandler(app);
module.exports.createHandler = createHandler;
