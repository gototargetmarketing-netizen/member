// แจ้งเตือนผู้ดูแลระบบ (พี่กับน้อง) ทาง LINE — ผู้ใช้ตกลงแผน 14 พ.ย. 2569
// ส่งแบบเจาะจงคน (multicast) จาก LINE OA ของ Go To Target หา LINE ID ที่ตั้งไว้เท่านั้น ไม่ใช่บรอดแคสต์
// ข้อความห้ามมีชื่อ เบอร์ วันเกิด ของลูกค้า — มีแค่ชื่อร้าน จำนวน รหัสสมาชิก (ใครอ่าน LINE OA ได้ก็ไม่เห็นข้อมูลส่วนตัว)
//
// ตั้งใน Vercel (ไม่ตั้ง = ไม่ส่งอะไรเลย ระบบอื่นทำงานปกติ):
//   ALERT_LINE_TOKEN  รหัส Channel access token ของ OA ที่ใช้ส่ง (ลับ — อยู่ใน Vercel เท่านั้น)
//   ALERT_LINE_TO     LINE ID ผู้รับ คั่นด้วยจุลภาค (ต้องอยู่ Provider เดียวกับ OA + เป็นเพื่อนกับ OA)
//   ALERT_SUMMARY     weekly (ค่าเริ่มต้น = สรุปทุกวันจันทร์) / daily (สรุปทุกเช้า — ผู้ใช้แนะนำช่วง 2 สัปดาห์แรกหลังเปิดร้านจริง)
//   ALERT_DB_LIMIT_MB / ALERT_STORAGE_LIMIT_MB  เพดานของแผน Supabase (ค่าเริ่มต้น = แผนฟรี 500 / 1000) — สมัคร Pro แล้วเปลี่ยนเป็น 8000 / 100000
//
// แจ้ง 2 แบบ:
//   ทันที — noteError (error ที่ไม่ใช่ความผิดผู้ใช้ถึงเกณฑ์) / noteConfig (ตั้งค่าขาด รหัสใช้ไม่ได้ ไฟล์แพ็กเกจหาย)
//            นับในหน่วยความจำของเครื่องนั้น (ไม่พึ่งฐานข้อมูล → แจ้งได้แม้ฐานข้อมูลล่ม) / Vercel มีหลายเครื่อง อาจได้ซ้ำ 2–3 ข้อความ ยอมรับได้
//   ทุกเช้า — runDaily (เรียกจาก api/cron.js ที่ Vercel Cron เรียกวันละครั้ง) แจ้งเฉพาะวันที่เจอปัญหา + สรุปตามรอบ
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('./util');
const { createOa, tokenFor } = require('./lineoa');

const ERR_WINDOW_MS = 10 * 60 * 1000;   // นับ error ย้อนหลัง 10 นาที
const ERR_THRESHOLD = 5;                // ถึง 5 ครั้ง = ผิดปกติ (ครั้งเดียวอาจแค่เน็ตสะดุด)
const ERR_MUTE_MS = 30 * 60 * 1000;     // แจ้งแล้วเงียบ 30 นาที กันข้อความรัวตอนระบบล่มยาว
const CONFIG_MUTE_MS = 6 * 60 * 60 * 1000; // ปัญหาตั้งค่าเรื่องเดิม ร้านเดิม แจ้งซ้ำทุก 6 ชม. จนกว่าจะแก้
const SEND_TIMEOUT_MS = 5000;           // ส่งแจ้งเตือนไม่ทัน = ข้าม ห้ามทำให้คำตอบของลูกค้าช้า
const QUOTA_WARN = 0.9;                 // โควตา OA ของร้านใช้ไป ≥ 90% → บอกในสรุป (ให้เตือนร้านเพิ่มแพ็กเกจ)
const SIZE_WARN = 0.8;                  // ฐานข้อมูล / ที่เก็บรูป ≥ 80% ของเพดาน → แจ้งทุกเช้าจนกว่าจะแก้
const CA_WARN_DAYS = 180;               // ใบรับรอง SSL ของ Supabase เหลือไม่ถึง 180 วัน → แจ้ง
const LINE_ID = /^U[0-9a-f]{32}$/;
const STALE_SEC = 90;                   // ต้องตรงกับ STALE_SEC ใน broadcast.js ("กำลังส่ง" ไม่ขยับนานเท่านี้ = หยุดกลางทาง)

// ปัญหาตั้งค่าที่ผู้ใช้เห็นแค่ "ติดต่อผู้ดูแลระบบ" — ผู้ใช้แก้เองไม่ได้ ต้องให้เรารู้ (รหัส error เดียวกับใน errors ของแต่ละไฟล์)
const CONFIG_CODES = {
  NO_DB: 'ยังไม่ได้ตั้งรหัสฐานข้อมูล (DATABASE_URL) ใน Vercel ของเว็บนี้',
  NO_LIFF: 'ร้านยังไม่ได้ใส่ LIFF ID ในตาราง shops',
  STORAGE_ERROR: 'อัปโหลดรูปไม่ได้ — ตรวจ SUPABASE_URL / SUPABASE_SECRET_KEY ใน Vercel',
  OA_TOKEN: 'รหัส LINE OA ของร้านใช้ไม่ได้ (หมดอายุหรือถูกเปลี่ยน) — ออกรหัสใหม่แล้วใส่ใน Vercel',
  PACKAGE_FILE: 'อ่านไฟล์แพ็กเกจของร้านไม่ได้ → ทุกแพ็กเกจของร้านถูกปิด (ตรวจ shops/<ร้าน>/config.js และ includeFiles ใน vercel.json)'
};

const state = { env: process.env, fetch: globalThis.fetch, now: () => Date.now(), errors: [], mutedUntil: 0, configSent: new Map(), sent: [] };

// ชุดทดสอบใส่ env / fetch / นาฬิกาเอง (ไม่ส่ง LINE จริง)
function configure(o = {}) {
  Object.assign(state, o, { errors: [], mutedUntil: 0, configSent: new Map(), sent: [] });
}

function settings() {
  const env = state.env || {};
  const to = String(env.ALERT_LINE_TO || '').split(/[\s,]+/).filter((x) => LINE_ID.test(x));
  const mb = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    token: String(env.ALERT_LINE_TOKEN || '').trim(),
    to,
    summary: String(env.ALERT_SUMMARY || '').trim().toLowerCase() === 'daily' ? 'daily' : 'weekly',
    dbLimitMb: mb(env.ALERT_DB_LIMIT_MB, 500),
    storageLimitMb: mb(env.ALERT_STORAGE_LIMIT_MB, 1000),
    // ลิงก์ทดสอบ (Preview) ส่งได้ถ้าตั้งค่าไว้ แต่ขึ้นต้นข้อความให้รู้ว่าไม่ใช่เว็บจริง
    label: env.VERCEL_ENV && env.VERCEL_ENV !== 'production' ? '[ลิงก์ทดสอบ] ' : ''
  };
}
const enabled = () => { const s = settings(); return !!(s.token && s.to.length); };

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))]);

// ส่ง 1 ข้อความหาผู้รับทุกคน — key เดิมภายใน 24 ชม. LINE ไม่ส่งซ้ำ (กัน Vercel เรียกงานตรวจซ้ำ) / ผิดพลาดแค่จด log ไม่โยนต่อ
async function sendText(text, key) {
  const s = settings();
  if (!s.token || !s.to.length) return false;
  const body = (s.label + text).slice(0, 4900); // LINE รับข้อความละไม่เกิน 5,000 ตัว
  try {
    const oa = createOa({ token: s.token, fetch: state.fetch });
    const r = await withTimeout(oa.multicast(s.to, [{ type: 'text', text: body }],
      key || retryUuid('alert:' + body + ':' + state.now())), SEND_TIMEOUT_MS);
    if (r === 'timeout') { console.error('ส่งแจ้งเตือน LINE ไม่ทันเวลา'); return false; }
    state.sent.push(body);
    return true;
  } catch (e) {
    if (e && e.status === 409) return true; // ส่งด้วย key นี้ไปแล้ว (งานตรวจถูกเรียกซ้ำ)
    console.error('ส่งแจ้งเตือน LINE ไม่ได้: ' + (e && e.message ? e.message : e));
    return false;
  }
}

function retryUuid(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// error → คำอธิบายสั้นที่ไม่มีข้อมูลส่วนตัว (ข้อความจาก pg ไม่มีค่าที่บันทึก แต่ตัดตัวเลขยาว/อีเมลทิ้งเผื่อไว้)
function describe(err) {
  const msg = String((err && err.message) || err || '');
  const code = String((err && err.code) || '');
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|connect|Connection terminated|too many clients/i.test(code + ' ' + msg)) return 'ต่อฐานข้อมูลไม่ได้';
  if (/certificate|self.signed|SSL/i.test(msg)) return 'ใบรับรอง SSL ของฐานข้อมูลไม่ผ่าน';
  if (code === '57014' || /timeout/i.test(msg)) return 'ฐานข้อมูลตอบช้าเกินเวลา';
  if (code === '42703' || code === '42P01') return 'ตารางไม่ตรงกับโค้ด (ลืมวางไฟล์ SQL ใน Supabase?)';
  if (/password authentication|28P01/.test(msg + code)) return 'รหัสฐานข้อมูลผิด (เพิ่งเปลี่ยนรหัส?)';
  const clean = msg.replace(/\S+@\S+/g, '…').replace(/\d{6,}/g, '…').replace(/\s+/g, ' ').slice(0, 80);
  return 'โค้ดผิดพลาด: ' + (clean || 'ไม่ทราบสาเหตุ');
}

// error ที่ไม่ใช่ความผิดผู้ใช้ (router ตอบ "ระบบขัดข้อง") — ถึงเกณฑ์ใน 10 นาที แจ้งทันที แล้วเงียบ 30 นาที
async function noteError(action, err) {
  if (!enabled()) return false;
  const now = state.now();
  state.errors = state.errors.filter((t) => now - t < ERR_WINDOW_MS);
  state.errors.push(now);
  if (state.errors.length < ERR_THRESHOLD || now < state.mutedUntil) return false;
  state.mutedUntil = now + ERR_MUTE_MS;
  const n = state.errors.length;
  return sendText(`🔴 ระบบขัดข้อง ${n} ครั้งใน 10 นาที\n• ล่าสุด: ${describe(err)}${action ? ' (คำสั่ง ' + action + ')' : ''}\n` +
    '• ดูวิธีรับมือ: คู่มือรับมือเหตุฉุกเฉิน เหตุ 4\n(จะไม่แจ้งเรื่องนี้ซ้ำ 30 นาที)');
}

// ปัญหาตั้งค่า (ลูกค้าเห็นแค่ "ติดต่อผู้ดูแลระบบ") — แจ้งตั้งแต่ครั้งแรก เรื่องเดิม/ร้านเดิมซ้ำทุก 6 ชม.
async function noteConfig(code, shopId, action) {
  if (!CONFIG_CODES[code] || !enabled()) return false;
  const now = state.now();
  const key = code + ':' + (shopId || '');
  if (now - (state.configSent.get(key) || -Infinity) < CONFIG_MUTE_MS) return false;
  state.configSent.set(key, now);
  return sendText(`⚠️ ต้องตั้งค่าระบบ${shopId ? ' ร้าน ' + shopId : ''}\n• ${CONFIG_CODES[code]}${action ? '\n• เจอตอนคำสั่ง ' + action : ''}\n(ลูกค้าเห็นแค่ "กรุณาติดต่อผู้ดูแลระบบ")`);
}

// ---------- ตรวจทุกเช้า ----------
const CHECK_POINTS_FILE = path.join(__dirname, '..', '..', 'db', 'check_points.sql');

function caDaysLeft(now) {
  try {
    const x = new crypto.X509Certificate(require('./supabase-ca'));
    return Math.floor((new Date(x.validTo).getTime() - now) / U.DAY_MS);
  } catch (e) {
    return null;
  }
}

const mbText = (bytes) => (bytes == null ? '-' : (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + ' MB');
const pct = (bytes, limitMb) => (bytes == null ? null : bytes / (limitMb * 1048576));

// deps: { db, now: Date, features(shopId) → Promise<แพ็กเกจ>, oa(shopId) → LINE OA ของร้าน | null }
// คืน { problems: [ข้อความ], summary: bool, sent: bool } — ไม่มีข้อมูลส่วนตัวลูกค้า
async function runDaily(deps) {
  const s = settings();
  const now = deps.now || new Date(state.now());
  const nowMs = now.getTime();
  const today = U.thaiDay(now);
  const monday = U.dayCode(now) === 'MON';
  const db = deps.db;
  const problems = [];
  const facts = [];

  // 1) แต้มไม่ตรง — ไฟล์เดียวกับที่ผู้ดูแลวางใน Supabase เอง (ผลตรงกันเสมอ)
  const pointRows = (await db.query(fs.readFileSync(CHECK_POINTS_FILE, 'utf8'))).rows;
  pointRows.filter((r) => U.toInt(r['แต้มไม่ตรง']) > 0).forEach((r) => {
    const list = String(r['รายชื่อที่ไม่ตรง'] || '').split(', ').slice(0, 5).join('\n  ');
    problems.push(`ร้าน ${r['ร้าน']}: แต้มไม่ตรง ${U.fmtNum(r['แต้มไม่ตรง'])} คน\n  ${list}\n  → คู่มือฉุกเฉิน เหตุ 3`);
  });

  // 2) ส่งข้อความตามกลุ่มค้าง / ไม่สำเร็จ ใน 25 ชม. ที่ผ่านมา (เผื่อเวลางานตรวจคลาด)
  const bc = (await db.query(`select shop_id, id, status, sent, total, (status = 'SENDING' and updated_at < $1::timestamptz - interval '${STALE_SEC} seconds') as stalled
      from broadcasts where updated_at > $1::timestamptz - interval '25 hours'
        and (status in ('PARTIAL', 'FAILED') or (status = 'SENDING' and updated_at < $1::timestamptz - interval '${STALE_SEC} seconds'))
      order by shop_id, created_at`, [now])).rows;
  bc.forEach((b) => {
    const what = b.stalled ? 'หยุดกลางทาง' : b.status === 'FAILED' ? 'ส่งไม่สำเร็จ' : 'ส่งได้ไม่ครบ';
    problems.push(`ร้าน ${b.shop_id}: ส่งข้อความ${what} (${U.fmtNum(b.sent)}/${U.fmtNum(b.total)} คน ${b.id})\n  → เจ้าของร้านกด "ส่งต่อ" ในหน้าส่งข้อความได้`);
  });

  // 3) LINE OA ของร้านที่เปิดแพ็กเกจส่งข้อความ: รหัสยังใช้ได้ไหม + โควตาเดือนนี้
  const shops = (await db.query(`select s.id, (select count(*)::int from members m where m.shop_id = s.id and m.status <> 'DELETED') as members
      from shops s where s.status = 'ACTIVE' order by s.id`)).rows;
  let totalMembers = 0;
  for (const sh of shops) {
    totalMembers += U.toInt(sh.members);
    const f = deps.features ? await deps.features(sh.id) : null;
    const oa = f && f.broadcast && deps.oa ? deps.oa(sh.id) : null;
    if (!oa) continue;
    try {
      const [q, c] = await Promise.all([oa.quota(), oa.consumption()]);
      const limit = q && q.type === 'limited' ? U.toInt(q.value) : 0;
      const used = U.toInt(c && c.totalUsage);
      if (limit > 0) {
        facts.push(`ร้าน ${sh.id}: LINE OA ใช้ไป ${U.fmtNum(used)}/${U.fmtNum(limit)} ข้อความเดือนนี้` + (used / limit >= QUOTA_WARN ? ' ⚠️ ใกล้หมด' : ''));
      }
    } catch (e) {
      if (e && (e.status === 401 || e.status === 403)) problems.push(`ร้าน ${sh.id}: ${CONFIG_CODES.OA_TOKEN}`);
      else console.error('งานตรวจ: ถามโควตา LINE OA ร้าน ' + sh.id + ' ไม่ได้ — ' + (e && e.message ? e.message : e));
    }
  }

  // 4) พื้นที่ฐานข้อมูล / ที่เก็บรูป (แผนฟรีเต็มแล้วบันทึกไม่ได้) — ที่เก็บรูปอ่านไม่ได้ (ไม่มีสิทธิ์ / ชุดทดสอบ) = ข้าม
  const dbBytes = Number((await db.query('select pg_database_size(current_database())::float8 as b')).rows[0].b);
  let imgBytes = null;
  try {
    imgBytes = Number((await db.query(`select coalesce(sum((metadata->>'size')::bigint), 0)::float8 as b from storage.objects where bucket_id = 'images'`)).rows[0].b);
  } catch (e) { /* ไม่มีตาราง storage (ชุดทดสอบ) */ }
  const dbPct = pct(dbBytes, s.dbLimitMb);
  const imgPct = pct(imgBytes, s.storageLimitMb);
  if (dbPct >= SIZE_WARN) problems.push(`ฐานข้อมูลใช้ไป ${mbText(dbBytes)} จาก ${U.fmtNum(s.dbLimitMb)} MB (${Math.round(dbPct * 100)}%) → สมัคร Supabase Pro ก่อนเต็ม`);
  if (imgPct != null && imgPct >= SIZE_WARN) problems.push(`ที่เก็บรูปใช้ไป ${mbText(imgBytes)} จาก ${U.fmtNum(s.storageLimitMb)} MB (${Math.round(imgPct * 100)}%) → สมัคร Supabase Pro ก่อนเต็ม`);

  // 5) ใบรับรอง SSL ที่ฝังในโค้ด ใกล้หมดอายุ (หมดแล้ว = ต่อฐานข้อมูลไม่ได้ทุกร้าน)
  const caDays = caDaysLeft(nowMs);
  if (caDays != null && caDays < CA_WARN_DAYS) problems.push(`ใบรับรอง SSL ของ Supabase หมดอายุในอีก ${caDays} วัน → โหลดใบใหม่มาแทน api/_lib/supabase-ca.js`);

  // ส่ง: มีปัญหา = ส่งทุกวัน / ไม่มี = ส่งเฉพาะวันสรุป (จันทร์ หรือทุกวันถ้าตั้ง daily) → รวมเป็นข้อความเดียว ประหยัดโควตา
  const summaryDay = s.summary === 'daily' || monday;
  if (!problems.length && !summaryDay) return { problems, summary: false, sent: false };
  const lines = [];
  lines.push(problems.length ? `⚠️ ตรวจประจำวัน ${today}: พบ ${problems.length} เรื่อง` : `✅ ระบบปกติ (ตรวจ ${today})`);
  problems.forEach((p, i) => lines.push(`${i + 1}) ${p}`));
  if (summaryDay) {
    lines.push('', `สรุป${s.summary === 'daily' ? 'ประจำวัน' : 'ประจำสัปดาห์'}`,
      `• ร้านที่เปิดใช้ ${U.fmtNum(shops.length)} ร้าน · สมาชิก ${U.fmtNum(totalMembers)} คน`,
      `• ฐานข้อมูล ${mbText(dbBytes)} จาก ${U.fmtNum(s.dbLimitMb)} MB` + (dbPct != null ? ` (${Math.round(dbPct * 100)}%)` : ''),
      `• ที่เก็บรูป ${mbText(imgBytes)}` + (imgPct != null ? ` จาก ${U.fmtNum(s.storageLimitMb)} MB (${Math.round(imgPct * 100)}%)` : ''));
    facts.forEach((x) => lines.push('• ' + x));
    if (caDays != null) lines.push(`• ใบรับรอง SSL เหลือ ${U.fmtNum(caDays)} วัน`);
  }
  // key ต่อวัน: Vercel เรียกงานตรวจซ้ำในวันเดียวกัน → LINE ไม่ส่งซ้ำ
  const sent = await sendText(lines.join('\n'), retryUuid('alert-daily:' + today));
  return { problems, summary: summaryDay, sent };
}

module.exports = { configure, enabled, sendText, noteError, noteConfig, runDaily, describe, CONFIG_CODES, CHECK_POINTS_FILE, ERR_THRESHOLD, _state: state };
