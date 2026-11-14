// งานตรวจประจำวัน (Vercel Cron เรียกตามเวลาใน vercel.json → "crons") — แจ้งผู้ดูแลทาง LINE เฉพาะวันที่เจอปัญหา + สรุปตามรอบ
// Vercel รันงานอัตโนมัติเฉพาะเว็บจริง (Production) / แผนฟรีได้วันละครั้ง เวลาคลาดได้ภายใน 1 ชม.
// ทดสอบเอง: Vercel → Settings → Cron Jobs → Run (ปุ่มนี้ส่งรหัส CRON_SECRET ให้เอง)
//
// กันคนนอกเรียก: Vercel ส่ง "Authorization: Bearer <CRON_SECRET>" มาเองเมื่อตั้ง CRON_SECRET ใน Vercel
// ไม่ตั้ง CRON_SECRET = ไม่รับเลย (ปลอดภัยไว้ก่อน — งานนี้อ่านข้อมูลทุกร้าน แม้คำตอบจะไม่มีข้อมูลส่วนตัว)
'use strict';
const crypto = require('crypto');
const { getDb } = require('./_lib/db');
const { createOa, tokenFor } = require('./_lib/lineoa');
const features = require('./_lib/features');
const alerts = require('./_lib/alerts');

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(JSON.stringify(obj));
}

// เทียบรหัสแบบใช้เวลาเท่ากันทุกครั้ง (กันเดารหัสจากเวลาที่ตอบ)
function authorized(header, secret) {
  if (!secret) return false;
  const a = Buffer.from(String(header || ''));
  const b = Buffer.from('Bearer ' + secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createCronHandler(deps) {
  return async function handler(req, res) {
    if (!authorized(req.headers && req.headers.authorization, deps.secret())) {
      // บอกแค่ว่าสิ่งที่งานตรวจต้องใช้มาครบไหม (ไม่มีข้อมูลร้าน) — ไว้เช็กจากภายนอกหลังขึ้นเว็บ (ไฟล์ร้านจาก includeFiles ใน vercel.json)
      return send(res, 401, { ok: false, error: 'ไม่มีสิทธิ์', code: 'UNAUTHORIZED',
        ready: { checkPoints: /แต้มไม่ตรง/.test(alerts.CHECK_POINTS_SQL), shopFiles: features.shopFileCount(), secretSet: !!deps.secret() } });
    }
    try {
      const r = await alerts.runDaily({ db: deps.db(), features: deps.features, oa: deps.oa, now: deps.now ? deps.now() : new Date() });
      return send(res, 200, { ok: true, problems: r.problems.length, summary: r.summary, sent: r.sent });
    } catch (e) {
      // งานตรวจเองล้ม (เช่น ต่อฐานข้อมูลไม่ได้) → แจ้งตรงๆ ไม่งั้นเงียบ แล้วเข้าใจผิดว่าระบบปกติ
      console.error('งานตรวจประจำวันล้ม: ' + (e && e.stack ? e.stack : e));
      await alerts.sendText('🔴 งานตรวจประจำวันทำไม่สำเร็จ\n• ' + alerts.describe(e) + '\n• ดูวิธีรับมือ: คู่มือรับมือเหตุฉุกเฉิน เหตุ 4');
      return send(res, 500, { ok: false, error: 'ตรวจไม่สำเร็จ', code: 'ERROR' });
    }
  };
}

module.exports = createCronHandler({
  db: getDb,
  secret: () => String(process.env.CRON_SECRET || ''),
  features: (shopId) => features.loadFeatures(shopId),
  oa: (shopId) => { const token = tokenFor(shopId); return token ? createOa({ token }) : null; }
});
module.exports.createCronHandler = createCronHandler;
