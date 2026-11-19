// แปลข้อความผิดพลาดที่ตัวกลางตอบ เป็นภาษาอังกฤษ (สองภาษา รอบ 1 หน้าลูกค้า + หลังบ้าน — 19 พ.ย. 2569)
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
  'คำขอไม่ถูกต้อง กรุณาลองใหม่': 'Invalid request. Please try again.',
  // ---------- หลังบ้าน (admin.js / broadcast.js) ----------
  'สถานะไม่ถูกต้อง': 'Invalid status',
  'ลิงก์รูปต้องขึ้นต้นด้วย https:// (หรือเว้นว่าง)': 'The image link must start with https:// (or be empty)',
  'ลิงก์ต้องขึ้นต้นด้วย https:// (หรือเว้นว่าง)': 'The link must start with https:// (or be empty)',
  'วันที่ไม่ถูกต้อง': 'Invalid date',
  'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม': 'The end date must not be before the start date',
  'ช่วงวันที่ไม่ถูกต้อง': 'Invalid date range',
  'สาขาไม่ถูกต้อง': 'Invalid branch',
  'กรุณาเลือกอย่างน้อย 1 สาขา': 'Please choose at least 1 branch',
  'รหัสพนักงานไม่ถูกต้อง': 'Invalid staff ID',
  'แก้สิทธิ์ของตัวเองไม่ได้ ให้เจ้าของร้านคนอื่นแก้ให้': 'You cannot change your own access. Ask another owner to do it',
  'บทบาทไม่ถูกต้อง': 'Invalid role',
  'ไม่พบพนักงานคนนี้': 'Staff member not found',
  'ผู้จัดการแก้ได้เฉพาะแคชเชียร์ ถ้าต้องการเปลี่ยนบทบาทอื่น ให้เจ้าของร้านทำ': 'Managers can only edit cashiers. Ask the shop owner to change other roles',
  'ไม่รู้จักข้อมูลที่จะส่งออก': 'Unknown export type',
  'ไม่พบระดับสมาชิกนี้': 'Membership tier not found',
  'ไม่พบของรางวัลนี้': 'Reward not found',
  'ไม่พบโปรโมชันนี้': 'Promotion not found',
  'กรุณาใส่เหตุผลที่ระงับ': 'Please enter the reason for suspending',
  'กรุณาใส่เหตุผลที่ลบ': 'Please enter the reason for deleting',
  'ไม่มีค่าที่จะบันทึก': 'Nothing to save',
  'รองรับเฉพาะรูป JPG, PNG หรือ WebP': 'Only JPG, PNG or WebP images are supported',
  'ไฟล์รูปใหญ่เกิน 2MB หรือไฟล์ไม่ถูกต้อง': 'The image is larger than 2MB or the file is invalid',
  'ไฟล์นี้ไม่ใช่รูปที่รองรับ': 'This file is not a supported image',
  'บันทึกรูปไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้ติดต่อผู้ดูแลระบบ': 'Could not save the image. Please try again; if it still fails, contact the system administrator',
  'ไม่พบสาขานี้': 'Branch not found',
  'เลือกจำนวนเท่าของแต้ม ×1.5 ×2 หรือ ×3': 'Choose a points multiplier of ×1.5, ×2 or ×3',
  'เลือกวันที่มีผลอย่างน้อย 1 วัน': 'Choose at least 1 active day',
  'ยอดขั้นต่ำต้องเป็นตัวเลข 0–10,000,000': 'Minimum spend must be a number from 0 to 10,000,000',
  'ไม่พบกติกานี้': 'Rule not found',
  'ข้อมูลระดับไม่ถูกต้อง': 'Invalid tier data',
  'รหัสระดับไม่ถูกต้อง': 'Invalid tier ID',
  'ระดับแรกต้องเริ่มที่ 0 แต้ม (สมาชิกทุกคนอย่างน้อยอยู่ระดับแรก)': 'The first tier must start at 0 points (every member is at least in the first tier)',
  'แต่ละระดับต้องใช้แต้มไม่ซ้ำกัน': 'Each tier needs a different number of points',
  'รหัสระดับซ้ำกัน': 'Duplicate tier ID',
  'ไม่พบระดับนี้ (อาจถูกแก้จากอีกเครื่อง) กรุณาเปิดหน้าใหม่': 'Tier not found (it may have been changed on another device). Please reload the page',
  'กรุณาใส่เหตุผลในการเปลี่ยนระดับ': 'Please enter the reason for changing the tier',
  'ร้านยังไม่ได้เปิดใช้ระดับสมาชิก': 'This shop has not turned on membership tiers',
  'ระดับที่เลือกไม่มีแล้ว กรุณาโหลดหน้าใหม่': 'A selected tier no longer exists. Please reload the page',
  'เดือนเกิดไม่ถูกต้อง': 'Invalid birth month',
  'เงื่อนไขมาซื้อครั้งล่าสุดไม่ถูกต้อง': 'Invalid last purchase condition',
  'กรุณาใส่จำนวนวัน (มาซื้อครั้งล่าสุด)': 'Please enter the number of days (last purchase)',
  'ร้านยังไม่ได้เชื่อม LINE OA กับระบบ กรุณาติดต่อผู้ดูแลระบบ': 'The shop\'s LINE OA is not connected yet. Please contact the system administrator',
  'การเชื่อม LINE OA ของร้านใช้ไม่ได้ (รหัสหมดอายุหรือถูกเปลี่ยน) กรุณาติดต่อผู้ดูแลระบบ': 'The shop\'s LINE OA connection does not work (the token expired or was changed). Please contact the system administrator',
  'LINE OA ของร้านส่งเกินโควตาเดือนนี้ หรือส่งถี่เกินไป ลองใหม่ภายหลัง หรือเพิ่มแพ็กเกจ LINE OA': 'The shop\'s LINE OA is over this month\'s quota or sending too fast. Try later or upgrade the LINE OA plan',
  'LINE ไม่รับข้อความนี้ ลองตรวจรูปและข้อความอีกครั้ง': 'LINE rejected this message. Check the image and text again',
  'ติดต่อ LINE ไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้ง': 'LINE is temporarily unreachable. Please try again',
  'รูปไม่ถูกต้อง กรุณาอัปโหลดรูปจากหน้านี้ใหม่': 'Invalid image. Please upload the image again from this page',
  'ขนาดรูปไม่ถูกต้อง กรุณาอัปโหลดรูปจากหน้านี้ใหม่': 'Invalid image size. Please upload the image again from this page',
  'ลิงก์เมื่อแตะรูปต้องขึ้นต้นด้วย https:// (เว้นว่าง = เปิดบัตรสมาชิกของร้าน)': 'The image link must start with https:// (empty = opens the shop\'s membership card)',
  'กรุณาใส่ลิงก์ที่จะเปิดเมื่อลูกค้าแตะรูป': 'Please enter the link to open when customers tap the image',
  'กรุณาพิมพ์ข้อความหรือใส่รูปอย่างน้อย 1 อย่าง': 'Please type a message or add an image',
  'ไฟล์รูปไม่ถูกต้อง กรุณาเลือกรูปใหม่': 'Invalid image file. Please choose another image',
  'บัญชี LINE ของคุณยังไม่ได้เพิ่ม LINE OA ของร้านเป็นเพื่อน เพิ่มเพื่อนก่อนแล้วลองใหม่': 'Your LINE account has not added the shop\'s LINE OA as a friend. Add it first, then try again',
  'ไม่มีลูกค้าที่ส่งได้ตามเงื่อนไขนี้': 'No customers can be reached with these conditions',
  'ไม่พบการส่งนี้': 'Send not found',
  'การส่งนี้กำลังทำงานอยู่ รอสักครู่แล้วโหลดหน้าใหม่': 'This send is still running. Wait a moment, then reload the page',
  // ---------- พนักงาน (staff.js — หลังบ้านเรียกใช้: ปรับแต้ม) ----------
  'กรุณาเลือกสาขาก่อนบันทึก': 'Please choose a branch before saving',
  'ไม่พบสาขานี้ หรือสาขาปิดแล้ว กรุณาเลือกสาขาใหม่': 'Branch not found or closed. Please choose another branch',
  'คุณไม่ได้อยู่ในสาขานี้ กรุณาเลือกสาขาใหม่ หรือติดต่อเจ้าของร้าน': 'You are not assigned to this branch. Choose another branch or contact the shop owner',
  'บัญชี LINE นี้ยังไม่ได้รับสิทธิ์พนักงาน': 'This LINE account does not have staff access yet',
  'จำนวนแต้มต้องเป็นจำนวนเต็ม และไม่เป็น 0': 'Points must be a whole number other than 0',
  'กรุณาใส่เหตุผลในการปรับแต้ม': 'Please enter the reason for the adjustment'
};

// ชื่อช่องในข้อความของหลังบ้าน ("กรุณากรอก" + ชื่อช่อง / ชื่อช่อง + "ไม่ถูกต้อง" ฯลฯ) → ใช้ขึ้นต้นประโยค
// ลงท้าย " (อังกฤษ)" = ช่องภาษาอังกฤษของช่องนั้น (labelEn ใส่ "English" ให้เอง)
const ADMIN_LABELS = {
  'ข้อความรอง': 'Subtitle', 'จำกัดต่อคน': 'Limit per person', 'จำนวนครั้งที่มา': 'Number of visits', 'จำนวนทั้งหมด': 'Total quantity',
  'จำนวนวันที่ใช้ได้': 'Days valid', 'ชื่อกติกา': 'Rule name', 'ชื่อของรางวัล': 'Reward name', 'ชื่อระดับ': 'Tier name', 'ชื่อสาขา': 'Branch name',
  'ป้าย': 'Tag', 'ยอดซื้อรวม': 'Total spending', 'รหัส': 'ID', 'รหัสกติกา': 'Rule ID', 'รหัสรางวัล': 'Reward ID', 'รหัสโปรโมชัน': 'Promotion ID',
  'รายละเอียด': 'Description', 'ลำดับ': 'Display order', 'หัวข้อ': 'Title', 'แต้มคงเหลือ': 'Points balance', 'แต้มที่ใช้แลก': 'Points needed to redeem',
  'ระดับ': 'Tier', 'สาขา': 'Branch', 'เดือนเกิด': 'Birth month', 'จำนวนวันที่มาซื้อครั้งล่าสุด': 'Days since last purchase', 'สมัครภายใน': 'Joined within',
  'ยอดซื้อต่อ 1 แต้ม': 'Baht per 1 point', 'แต้มต้อนรับ': 'Welcome points', 'ยอดซื้อสูงสุดต่อบิล': 'Maximum purchase per bill',
  'ยอดที่ต้องยืนยันซ้ำ': 'Amount needing confirmation', 'อายุคูปอง': 'Coupon validity', 'จำนวนประวัติที่ลูกค้าเห็น': 'History entries customers see',
  'บังคับเพิ่มเพื่อนก่อนสมัคร': 'Require LINE friend before sign-up', 'ติ๊กยินยอมรับข่าวสารไว้ให้': 'Pre-tick news consent', 'แต้มรับข่าวสาร': 'News consent points',
  'ชื่อร้าน': 'Shop name', 'โลโก้': 'Logo', 'สไตล์': 'Style', 'สีหลัก': 'Main color', 'สีปุ่ม': 'Button color', 'สีเน้น': 'Accent color',
  'สีบัตรสมาชิก': 'Card color', 'คำเรียกแต้ม': 'Points name', 'ข้อความทักทาย': 'Greeting', 'หัวข้อหน้าสมัคร': 'Sign-up title',
  'คำอธิบายหน้าสมัคร': 'Sign-up description', 'นโยบายความเป็นส่วนตัว': 'Privacy policy', 'เปิดลิงก์': 'Link',
  'ของรางวัล': 'Reward', 'โปรโมชัน': 'Promotion', 'กติกาแต้มพิเศษ': 'Bonus points rule'
};
function labelEn(th) {
  const s = String(th || '');
  if (Object.prototype.hasOwnProperty.call(LABEL_SUBJECT, s)) return LABEL_SUBJECT[s];
  if (Object.prototype.hasOwnProperty.call(ADMIN_LABELS, s)) return ADMIN_LABELS[s];
  let m = s.match(/^(.+) \(อังกฤษ\)$/);
  if (m) { const base = labelEn(m[1]); return base ? 'English ' + base.charAt(0).toLowerCase() + base.slice(1) : null; }
  m = s.match(/^สิทธิพิเศษ(ภาษาอังกฤษ)?ของระดับ "(.+)"( แต่ละข้อ)?$/);
  if (m) return (m[3] ? 'Each ' + (m[1] ? 'English benefit' : 'benefit') : (m[1] ? 'English benefits' : 'Benefits')) + ' of tier "' + m[2] + '"';
  return null;
}
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// ชื่อช่องที่ util.js ใส่ในข้อความ ("กรุณากรอก" + ชื่อช่อง) — ชื่อช่องที่ไม่รู้จัก → ไม่แปลทั้งข้อความ (ไม่ให้ไทยปนอังกฤษ)
const LABELS = { 'ชื่อ': 'your first name', 'นามสกุล': 'your last name' };
const LABEL_SUBJECT = { 'ชื่อ': 'First name', 'นามสกุล': 'Last name' };

// ข้อความที่มีค่าแทรก: [รูปแบบภาษาไทย, ฟังก์ชันสร้างภาษาอังกฤษ (คืน null = ไม่แปล)]
const PATTERNS = [
  [/^แต้มไม่พอ ต้องใช้ ([\d,]+) แต้ม \(มีอยู่ ([\d,]+)\)$/, (m) => `Not enough points: this needs ${m[1]} points (you have ${m[2]})`],
  [/^ของรางวัลนี้สำหรับสมาชิกระดับ (.+) ขึ้นไป$/, (m) => `This reward is for ${m[1]} members and above`],
  [/^คุณแลกรางวัลนี้ครบ (\d+) ครั้งแล้ว$/, (m) => `You have reached the limit of ${m[1]} redemptions for this reward`],
  [/^ของขวัญวันเกิดสำหรับสมาชิกที่สมัครครบ (\d+) วันขึ้นไป$/, (m) => `The birthday gift is for members who joined at least ${m[1]} days ago`],
  [/^กรุณากรอก(.+)$/, (m) => (LABELS[m[1]] ? `Please enter ${LABELS[m[1]]}` : labelEn(m[1]) ? `Please enter the ${lower(labelEn(m[1]))}` : null)],
  [/^(.+)ยาวเกิน ([\d,]+) ตัวอักษร$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])} is too long (max ${m[2]} characters)` : null)],
  [/^(.+)ต้องไม่มีตัวเลข$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])} cannot contain numbers` : null)],
  // ---------- หลังบ้าน ----------
  [/^(.+)ต้องเป็นจำนวนเต็ม ([\d,]+)–([\d,]+)$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])} must be a whole number from ${m[2]} to ${m[3]}` : null)],
  [/^(.+)ต้องเป็นตัวเลข ([\d,.]+)–([\d,.]+)$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])} must be a number from ${m[2]} to ${m[3]}` : null)],
  [/^(.+)ต้องเป็นจำนวนเต็ม 0–([\d,]+)$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])} must be a whole number from 0 to ${m[2]}` : null)],
  [/^(.+)ต้องเป็น 1–([\d,]+) วัน$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])} must be 1–${m[2]} days` : null)],
  [/^(.+)ต้องเป็น เปิด หรือ ปิด$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])} must be On or Off` : null)],
  [/^(.+)ต้องเป็นรหัสสีแบบ #RRGGBB$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])} must be a color code like #RRGGBB` : null)],
  [/^(.+): ค่าเริ่มต้องไม่มากกว่าค่าสิ้นสุด$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])}: the start value must not be greater than the end value` : null)],
  [/^(.+) ใส่ได้ไม่เกิน (\d+) ข้อ$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])}: at most ${m[2]} items` : null)],
  [/^(.+)ไม่ถูกต้อง$/, (m) => (labelEn(m[1]) ? `Invalid ${lower(labelEn(m[1]))}` : null)],
  [/^ไม่พบ(.+)นี้$/, (m) => (labelEn(m[1]) ? `${labelEn(m[1])} not found` : null)],
  [/^เลือกช่วงได้ไม่เกิน (\d+) วัน$/, (m) => `You can choose at most ${m[1]} days`],
  [/^ไม่พบสาขา (.+)$/, (m) => `Branch not found: ${m[1]}`],
  [/^จำนวนทั้งหมดต้องไม่น้อยกว่าที่แลกไปแล้ว \(([\d,]+)\)$/, (m) => `Total quantity must not be less than the number already redeemed (${m[1]})`],
  [/^มีสาขาชื่อ "(.+)" อยู่แล้ว$/, (m) => `A branch named "${m[1]}" already exists`],
  [/^แพ็กเกจของร้านเปิดได้ (\d+) สาขา ปิดสาขาอื่นก่อน หรือติดต่อผู้ดูแลระบบเพื่ออัปเกรด$/, (m) => `The shop's package allows ${m[1]} branches. Close another branch first, or contact the system administrator to upgrade`],
  [/^เพิ่มสาขาได้ไม่เกิน (\d+) สาขา$/, (m) => `You can add at most ${m[1]} branches`],
  [/^ตั้งได้ (\d+)–(\d+) ระดับ \(หรือปิดใช้ระดับสมาชิก\)$/, (m) => `Set ${m[1]}–${m[2]} tiers (or turn off membership tiers)`],
  [/^แต้มของระดับ "(.+)" ต้องเป็นจำนวนเต็ม 0–10,000,000$/, (m) => `Points for tier "${m[1]}" must be a whole number from 0 to 10,000,000`],
  [/^ตัวคูณแต้มของระดับ "(.+)" เลือกได้ ×1 ×1\.5 ×2 หรือ ×3$/, (m) => `The points multiplier for tier "${m[1]}" can be ×1, ×1.5, ×2 or ×3`],
  [/^สีของระดับ "(.+)" ต้องเป็นรหัสสีแบบ #RRGGBB$/, (m) => `The color of tier "${m[1]}" must be a color code like #RRGGBB`],
  [/^ชื่อระดับ "(.+)" ซ้ำกัน$/, (m) => `Tier name "${m[1]}" is used twice`],
  [/^ระดับ "(.+)" ยังใช้กับ(ของรางวัล|โปรโมชัน|แต้มพิเศษ) "(.+)" อยู่ — เปลี่ยนระดับขั้นต่ำของรายการนั้นก่อน$/,
    (m) => `Tier "${m[1]}" is still used by ${({ 'ของรางวัล': 'reward', 'โปรโมชัน': 'promotion', 'แต้มพิเศษ': 'bonus points rule' })[m[2]]} "${m[3]}" — change that item's minimum tier first`],
  [/^ข้อความยาวได้ไม่เกิน ([\d,]+) ตัวอักษร$/, (m) => `The message can be at most ${m[1]} characters`],
  [/^จำนวนลูกค้าในกลุ่มเปลี่ยนเป็น ([\d,]+) คน กรุณากด "ดูจำนวนคน" แล้วตรวจอีกครั้ง$/, (m) => `The group now has ${m[1]} people. Tap "Count people" and check again`],
  [/^โควตาข้อความเดือนนี้ของ LINE OA เหลือ ([\d,]+) ข้อความ ไม่พอส่ง ([\d,]+) คน ลดกลุ่มลง หรือเพิ่มแพ็กเกจ LINE OA$/,
    (m) => `The LINE OA has ${m[1]} messages left this month, not enough for ${m[2]} people. Make the group smaller or upgrade the LINE OA plan`],
  [/^บทบาท (\w+) ใช้คำสั่งนี้ไม่ได้$/, (m) => `The ${m[1]} role cannot do this`],
  [/^ปรับแล้วแต้มติดลบไม่ได้ \(มีอยู่ ([\d,]+) แต้ม\)$/, (m) => `Points cannot go below zero (current balance ${m[1]} points)`]
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

// ไฟล์ Excel ที่ส่งออกตอนหลังบ้านเป็นภาษาอังกฤษ: หัวคอลัมน์ + ค่าที่ระบบเขียน (ข้อมูลที่คนพิมพ์คงเดิม)
const EXPORT_EN = {
  'รหัสสมาชิก': 'Member ID', 'ชื่อ': 'First name', 'นามสกุล': 'Last name', 'เบอร์โทร': 'Phone', 'วันเกิด': 'Date of birth',
  'แต้มคงเหลือ': 'Points balance', 'ยอดซื้อรวม': 'Total spending', 'จำนวนครั้งที่มา': 'Visits', 'วันที่สมัคร': 'Joined',
  'มาล่าสุด': 'Last visit', 'ยินยอมรับข่าวสาร': 'News consent', 'สถานะ': 'Status', 'สาขาที่สมัคร': 'Joined at branch',
  'รหัสรายการ': 'Entry ID', 'วันเวลา': 'Date & time', 'ชื่อสมาชิก': 'Member name', 'ประเภท': 'Type', 'ยอดซื้อ': 'Purchase amount',
  'แต้ม': 'Points', 'รายละเอียด': 'Details', 'พนักงาน': 'Staff', 'สาขา': 'Branch',
  'ใช่': 'Yes', 'ไม่': 'No', 'ไม่ระบุ': 'Not specified', 'ออนไลน์': 'Online', 'หลังบ้าน': 'Back office', 'สมาชิกที่ลบแล้ว': 'Deleted member'
};
const exportText = (s, lang) => (lang === 'en' && Object.prototype.hasOwnProperty.call(EXPORT_EN, s) ? EXPORT_EN[s] : s);

// รายละเอียดรายการแต้มที่ระบบเขียนเป็นภาษาไทย → อังกฤษ (แบบเดียวกับ txDetail ในหน้าเว็บ) / หมายเหตุที่พนักงานพิมพ์เองคงเดิม
function detailText(type, d, lang) {
  d = String(d || '');
  if (lang !== 'en' || !d) return d;
  const fixed = { 'แต้มต้อนรับสมาชิกใหม่': 'Welcome points for new members', 'แต้มรับข่าวสารจากร้าน': 'Points for receiving shop news', 'ลบบัญชีสมาชิก': 'Membership deleted' };
  if (fixed[d]) return fixed[d];
  let m = type === 'REDEEM' && d.match(/^แลก:? (.+)$/);
  if (m) return 'Redeemed ' + m[1];
  m = type === 'EARN' && d.match(/^ซื้อสินค้า ([\d,.]+) บาท( \(ไม่ถึงเกณฑ์รับแต้ม\))?(.*)$/);
  if (m) return 'Purchase ฿' + m[1] + (m[2] ? ' (below the minimum for points)' : '') + m[3];
  return d;
}

module.exports = { translate, langOf, labelEn, exportText, detailText, EN, PATTERNS, ADMIN_LABELS, EXPORT_EN };
