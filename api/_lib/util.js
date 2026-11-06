// เครื่องมือกลางที่ย้ายมาจาก code.gs — ต้องคิดผลเหมือนของเดิมทุกตัว (ชุดทดสอบ api-diff-test.js เทียบคำตอบสองระบบ)
// ถ้าแก้ตัวไหนในนี้ ให้แก้ฟังก์ชันชื่อเดียวกัน (ลงท้าย _) ใน code.gs ด้วย จนกว่าจะเลิกใช้ Apps Script (ขั้น 6)
const crypto = require('crypto');
const { userError } = require('./errors');

// ตัวอักษรที่ใช้สร้างรหัส — ตัด O 0 I 1 ออก เพราะพนักงานอ่าน/พิมพ์สับสน (32 ตัว: 256 หารลงตัว → สุ่มเท่ากันทุกตัว)
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000; // ไทยไม่มีเวลาออมแสง → บวก 7 ชั่วโมงตายตัวได้
const DAY_MS = 86400000;
const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ID_CHARS[bytes[i] % ID_CHARS.length];
  return out;
}

const upper = (v) => String(v == null ? '' : v).trim().toUpperCase();
const toNum = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const toInt = (v) => Math.floor(toNum(v));
const fmtNum = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ลิงก์รูป/ลิงก์โปรโมชัน: รับเฉพาะ https กันลิงก์อันตราย (เช่น javascript:)
function safeUrl(v) {
  const s = String(v == null ? '' : v).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 1000 ? s : '';
}

// ลิงก์แชร์ Google Drive (รูปเก่าที่ย้ายมาจากระบบเดิม) → ลิงก์รูปตรง
function driveImage(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#\s]*&)?id=)([A-Za-z0-9_-]{20,})/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1000' : s;
}

// ชื่อจาก LINE ตั้งได้อิสระ → ตัดอักขระควบคุมและ < > ทิ้ง (ไม่ปฏิเสธ เพราะลูกค้าแก้ชื่อ LINE ไม่ได้ทันที)
function cleanLineName(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

function cleanText(v, max, label, required) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().replace(/\s+/g, ' ');
  if (required && !s) throw userError('กรุณากรอก' + label, 'BAD_INPUT');
  if (s.length > max) throw userError(label + 'ยาวเกิน ' + max + ' ตัวอักษร', 'BAD_INPUT');
  return s;
}

function cleanLongText(v, max) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, ' ')
    .split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

// ชื่อ / นามสกุล แยกช่อง: ต้องมีตัวอักษร และไม่มีตัวเลข (กันพิมพ์เบอร์ผิดช่อง)
function cleanNamePart(v, label) {
  const s = cleanLineName(v);
  if (!s) throw userError('กรุณากรอก' + label, 'BAD_NAME');
  if (s.length > 40) throw userError(label + 'ยาวเกิน 40 ตัวอักษร', 'BAD_NAME');
  if (/\d/.test(s)) throw userError(label + 'ต้องไม่มีตัวเลข', 'BAD_NAME');
  return s;
}

// เบอร์สมาชิก = มือถือ 10 หลัก (รับ +66 ได้) — ต้องตรงกับ MOBILE ใน app/customer.js
function cleanMobile(v) {
  let digits = String(v == null ? '' : v).replace(/\D/g, '');
  if (digits.indexOf('66') === 0 && digits.length === 11) digits = '0' + digits.slice(2);
  if (!/^0[689]\d{8}$/.test(digits)) throw userError('กรุณากรอกเบอร์มือถือ 10 หลัก', 'BAD_PHONE');
  return digits;
}

// วันเกิดรูปแบบ yyyy-MM-dd ที่มีอยู่จริง อายุ 1–120 ปี ('' = ไม่ได้กรอก)
function cleanBirthDate(v, now) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw userError('วันเกิดไม่ถูกต้อง', 'BAD_BIRTHDATE');
  const d = new Date(s + 'T00:00:00+07:00');
  const age = ((now || new Date()).getTime() - d.getTime()) / (365.25 * DAY_MS);
  if (isNaN(d.getTime()) || thaiDay(d) !== s || age < 1 || age > 120) throw userError('วันเกิดไม่ถูกต้อง', 'BAD_BIRTHDATE');
  return s;
}

function cleanKey(v, label) {
  const s = String(v == null ? '' : v).trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(s)) throw userError(label + 'ไม่ถูกต้อง', 'BAD_KEY');
  return s;
}

// หมายเหตุ/เหตุผลจากพนักงาน (ยาวได้ 200 ตัว)
function cleanNote(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 200);
}

// เบอร์ที่พนักงานพิมพ์ค้น (รับเบอร์บ้านด้วย สมาชิกรุ่นแรกอาจใช้) — '' = ไม่ใช่เบอร์
function normalizePhone(v) {
  let digits = String(v == null ? '' : v).replace(/\D/g, '');
  if (digits.indexOf('66') === 0 && digits.length >= 11) digits = '0' + digits.slice(2);
  return /^0\d{8,9}$/.test(digits) ? digits : '';
}

function cleanMemberId(v) {
  const id = String(v == null ? '' : v).trim().toUpperCase();
  if (!/^[A-Z]{1,4}-[A-Z0-9]{4,12}$/.test(id)) throw userError('รหัสสมาชิกไม่ถูกต้อง', 'BAD_MEMBER_ID');
  return id;
}

const round2 = (n) => Math.round(n * 100) / 100;

// 1,250 / 1,250.5 (ตัด .00 ทิ้ง)
function fmtMoney(n) {
  const parts = (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '').split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

// 6/11/2026 21:05 (เวลาไทย) — '-' เมื่อไม่มีวันที่
function fmtDateTime(v) {
  const d = toDate(v);
  if (!d) return '-';
  const t = new Date(d.getTime() + THAI_OFFSET_MS);
  const p2 = (n) => String(n).padStart(2, '0');
  return t.getUTCDate() + '/' + (t.getUTCMonth() + 1) + '/' + t.getUTCFullYear() + ' ' + p2(t.getUTCHours()) + ':' + p2(t.getUTCMinutes());
}

function cleanRequestId(v) {
  const s = String(v || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(s)) throw userError('คำขอไม่ถูกต้อง กรุณาลองใหม่', 'BAD_REQUEST_ID');
  return s;
}

// ---------- วันเวลา (คิดตามเวลาไทยเสมอ — ฐานข้อมูลของ Supabase และเครื่อง Vercel ใช้ UTC) ----------

// วันที่ไทย yyyy-MM-dd ของเวลานั้น
function thaiDay(d) {
  return new Date(d.getTime() + THAI_OFFSET_MS).toISOString().slice(0, 10);
}

// วันในสัปดาห์ตามเวลาไทย (MON…SUN)
function dayCode(now) {
  const d = new Date(thaiDay(now) + 'T00:00:00Z');
  return DAY_CODES[(d.getUTCDay() + 6) % 7];
}

// แปลงค่าวันที่ (Date / 'yyyy-MM-dd' = เที่ยงคืนเวลาไทย / ข้อความเวลาเต็ม) → Date หรือ null
function toDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00+07:00');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function iso(v) {
  const d = toDate(v);
  return d ? d.toISOString() : '';
}

// อยู่ในช่วงวันที่ (ว่าง = ไม่จำกัด / วันสิ้นสุดนับถึงสิ้นวัน)
function inWindow(start, end, now) {
  const s = toDate(start);
  const e = toDate(end);
  if (s && now.getTime() < s.getTime()) return false;
  if (e && now.getTime() > e.getTime() + DAY_MS - 1) return false;
  return true;
}

// อีก N วัน ถึงเวลา 23:59:59 (เวลาไทย)
function endOfDayAfter(now, days) {
  return new Date(thaiDay(new Date(now.getTime() + days * DAY_MS)) + 'T23:59:59+07:00');
}

// สิ้นเดือนนี้ 23:59:59 (เวลาไทย)
function endOfMonth(now) {
  const k = thaiDay(now);
  const last = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0));
  return new Date(last.toISOString().slice(0, 10) + 'T23:59:59+07:00');
}

module.exports = {
  ID_CHARS, DAY_CODES, DAY_MS, randomCode, upper, toNum, toInt, fmtNum, safeUrl, driveImage,
  cleanLineName, cleanText, cleanLongText, cleanNamePart, cleanMobile, cleanBirthDate, cleanKey, cleanRequestId,
  cleanNote, normalizePhone, cleanMemberId, round2, fmtMoney, fmtDateTime,
  thaiDay, dayCode, toDate, iso, inWindow, endOfDayAfter, endOfMonth
};
