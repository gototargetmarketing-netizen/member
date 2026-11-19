// แปลข้อความผิดพลาดที่ตัวกลางตอบ เป็นภาษาอังกฤษ (สองภาษา รอบ 1 — 19 พ.ย. 2569)
//
// หน้าเว็บส่ง lang: 'en' มากับทุกคำขอเมื่อลูกค้าเลือกภาษาอังกฤษ → router แปล error ก่อนตอบ
// กุญแจ = ข้อความภาษาไทยใน userError(...) ตรงทุกตัวอักษร (วิธีเดียวกับ app/i18n.js) → ไม่ต้องแก้จุดที่โยน error ทั้ง 160 กว่าจุด
// ข้อความที่มีตัวเลข/ชื่อแทรก ใช้ PATTERNS / ยังไม่มีคำแปล (เช่น ข้อความของหลังบ้าน — รอบ 4) → ตอบภาษาไทยตามเดิม
// เพิ่ม userError ใหม่ในคำสั่งที่ลูกค้าเรียก → ต้องเพิ่มคำแปลที่นี่ (tools/test/i18n-test.js ฟ้อง)
'use strict';

const EN = {
  // router.js
  'คำขอไม่ถูกต้อง': 'Invalid request',
  'ไม่รู้จักคำสั่งนี้': 'Unknown request',
  'ไม่พบร้านนี้': 'Shop not found',
  'ร้านนี้ปิดใช้งานระบบสะสมแต้มแล้ว': 'This shop has closed its loyalty program',
  'กรุณาเปิดผ่าน LINE': 'Please open this page in LINE',
  'ระบบนี้ไม่ได้เปิดโหมดทดสอบ': 'Test mode is not enabled',
  'รหัสผู้ทดสอบไม่ถูกต้อง': 'Invalid test user',
  'ระบบของร้านยังตั้งค่าไม่ครบ กรุณาติดต่อผู้ดูแลระบบ': 'The shop\'s system is not fully set up yet. Please contact the system administrator.',
  'การเข้าสู่ระบบ LINE หมดอายุ กรุณาปิดแล้วเปิดใหม่': 'Your LINE sign-in has expired. Please close and reopen this page.',
  'ร้านนี้ยังไม่ได้เปิดใช้ฟีเจอร์นี้ กรุณาติดต่อผู้ดูแลระบบ': 'This shop has not enabled this feature. Please contact the system administrator.',
  'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง': 'Something went wrong. Please try again.',
  // members.js
  'ไม่พบสมาชิก': 'Member not found',
  'บัญชีสมาชิกนี้ถูกระงับ กรุณาติดต่อร้าน': 'This membership is suspended. Please contact the shop.',
  'ร้านปรับปรุงนโยบายความเป็นส่วนตัว กรุณากดยอมรับก่อนใช้บัตรสมาชิก': 'The shop has updated its privacy policy. Please accept it before using your membership card.',
  'กรุณาเลือกวันเกิด': 'Please select your date of birth',
  'เบอร์นี้มีสมาชิกคนอื่นใช้แล้ว ถ้าเป็นเบอร์ของคุณ กรุณาติดต่อร้าน': 'This number is already used by another member. If it is yours, please contact the shop.',
  'แก้วันเกิดได้ครั้งเดียว ต้องการแก้อีก กรุณาติดต่อร้าน': 'You can only change your date of birth once. Please contact the shop to change it again.',
  // customer.js
  'กรุณายอมรับนโยบายความเป็นส่วนตัวก่อนสมัคร': 'Please accept the privacy policy before signing up',
  'เบอร์โทรนี้สมัครสมาชิกไว้แล้ว ถ้าเป็นเบอร์ของคุณ กรุณาติดต่อพนักงาน': 'This phone number is already registered. If it is yours, please contact staff.',
  'กรุณาเพิ่มเพื่อน LINE ของร้านก่อนสมัครสมาชิก': 'Please add the shop on LINE before signing up',
  'กรุณาสมัครสมาชิกก่อน': 'Please sign up first',
  'รางวัลนี้ไม่พร้อมให้แลกแล้ว': 'This reward is no longer available',
  'รางวัลนี้ตั้งค่าแต้มไม่ถูกต้อง': 'This reward is not set up correctly',
  'รางวัลนี้ถูกแลกครบจำนวนแล้ว': 'This reward has been fully redeemed',
  'ของขวัญวันเกิดรับได้เฉพาะในเดือนเกิดของคุณ': 'The birthday gift can only be claimed in your birth month',
  'ตอนนี้ร้านยังไม่มีของขวัญวันเกิด': 'The shop does not have a birthday gift right now',
  'ร้านเพิ่งปรับนโยบายอีกครั้ง กรุณาอ่านฉบับล่าสุดแล้วกดยอมรับ': 'The shop just updated its policy again. Please read the latest version and accept it.',
  'กรุณาพิมพ์คำว่า "ลบ" เพื่อยืนยัน': 'Please type DELETE to confirm',
  'ไม่พบบัญชีสมาชิก': 'Membership not found',
  // util.js
  'กรุณากรอกเบอร์มือถือ 10 หลัก': 'Please enter a 10-digit Thai mobile number',
  'วันเกิดไม่ถูกต้อง': 'Invalid date of birth',
  'รหัสสมาชิกไม่ถูกต้อง': 'Invalid member ID',
  'คำขอไม่ถูกต้อง กรุณาลองใหม่': 'Invalid request. Please try again.'
};

// ชื่อช่องที่ util.js ใส่ในข้อความ ("กรุณากรอก" + ชื่อช่อง) — ชื่อช่องที่ไม่รู้จัก → ไม่แปลทั้งข้อความ (ไม่ให้ไทยปนอังกฤษ)
const LABELS = { 'ชื่อ': 'your first name', 'นามสกุล': 'your last name' };
const LABEL_SUBJECT = { 'ชื่อ': 'First name', 'นามสกุล': 'Last name' };

// ข้อความที่มีค่าแทรก: [รูปแบบภาษาไทย, ฟังก์ชันสร้างภาษาอังกฤษ (คืน null = ไม่แปล)]
const PATTERNS = [
  [/^แต้มไม่พอ ต้องใช้ ([\d,]+) แต้ม \(มีอยู่ ([\d,]+)\)$/, (m) => `Not enough points: this needs ${m[1]} points (you have ${m[2]})`],
  [/^ของรางวัลนี้สำหรับสมาชิกระดับ (.+) ขึ้นไป$/, (m) => `This reward is for ${m[1]} members and above`],
  [/^คุณแลกรางวัลนี้ครบ (\d+) ครั้งแล้ว$/, (m) => `You have reached the limit of ${m[1]} redemptions for this reward`],
  [/^ของขวัญวันเกิดสำหรับสมาชิกที่สมัครครบ (\d+) วันขึ้นไป$/, (m) => `The birthday gift is for members who joined at least ${m[1]} days ago`],
  [/^กรุณากรอก(.+)$/, (m) => (LABELS[m[1]] ? `Please enter ${LABELS[m[1]]}` : null)],
  [/^(.+)ยาวเกิน (\d+) ตัวอักษร$/, (m) => (LABEL_SUBJECT[m[1]] ? `${LABEL_SUBJECT[m[1]]} is too long (max ${m[2]} characters)` : null)],
  [/^(.+)ต้องไม่มีตัวเลข$/, (m) => (LABEL_SUBJECT[m[1]] ? `${LABEL_SUBJECT[m[1]]} cannot contain numbers` : null)]
];

function translate(message, lang) {
  const s = String(message == null ? '' : message);
  if (lang !== 'en' || !s) return s;
  if (Object.prototype.hasOwnProperty.call(EN, s)) return EN[s];
  for (const [re, fn] of PATTERNS) {
    const m = s.match(re);
    if (m) { const out = fn(m); if (out) return out; }
  }
  return s;
}

// lang จากคำขอ: รู้จักแค่ en (ค่าอื่น / ไม่ส่ง = ไทย เหมือนเดิม)
const langOf = (body) => (body && body.lang === 'en' ? 'en' : 'th');

module.exports = { translate, langOf, EN, PATTERNS };
