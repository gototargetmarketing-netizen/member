/*******************************************************
 * LINE CRM สะสมแต้ม — หลังบ้าน (Google Apps Script) v2
 *
 * ไฟล์นี้ใช้ "เหมือนกันทุกร้าน" ห้ามใส่ค่าเฉพาะร้านในไฟล์นี้
 * ค่าเฉพาะร้าน (ชื่อร้าน LIFF ID อัตราแต้ม ฯลฯ) อยู่ในชีต Settings
 * เหตุผล: เวลาอัปเดตโค้ด วางไฟล์ใหม่ทับได้เลย ค่าของร้านไม่หาย
 *
 * ติดตั้งร้านใหม่ (รายละเอียดเต็มใน README.md):
 * 1) ใช้บัญชี Google ของร้าน สร้าง Google Sheet → ส่วนขยาย → Apps Script → วางไฟล์นี้
 * 2) เลือกฟังก์ชัน testSetup แล้วกด Run (ครั้งแรกจะขออนุญาตสิทธิ์) ระบบจะสร้างชีตทั้งหมดให้
 * 3) กรอก LIFF_ID และ SHOP_NAME ในชีต Settings
 * 4) Deploy → New deployment → Web app: Execute as = Me, Who has access = Anyone
 * 5) นำ URL ที่ลงท้าย /exec ไปใส่ใน shops/<ร้าน>/config.js (apiUrl)
 *
 * หน้าเว็บส่งคำสั่งแบบ POST (text/plain) รูปแบบ { action, idToken, ...ข้อมูล }
 * ทุกคำสั่งต้องมี LINE ID Token ซึ่งตรวจกับ LINE ที่นี่ — ห้ามเชื่อ userId ที่หน้าเว็บส่งมา
 *******************************************************/

const APP_VERSION = '2.4.1';
const TZ = 'Asia/Bangkok';

const SHEET = {
  SETTINGS: 'Settings',
  MEMBERS: 'Members',
  TX: 'Transactions',
  REWARDS: 'Rewards',
  COUPONS: 'Coupons',
  STAFF: 'Staff',
  PROMOS: 'Promotions'
};

// รูปแบบเซลล์ — ตั้งก่อนเขียนทุกครั้ง เพราะ Google Sheets แปลงค่าเอง
// (เบอร์โทรเลข 0 ข้างหน้าหาย, รหัสบางแบบกลายเป็นวันที่)
const F_TEXT = '@';
const F_INT = '0';
const F_MONEY = '#,##0.00';
const F_DATETIME = 'd/M/yyyy H:mm:ss';
const F_DATE = 'd/M/yyyy';

// หัวตารางของแต่ละชีต [ชื่อคอลัมน์, รูปแบบเซลล์]
// โค้ดอ่านคอลัมน์จาก "ชื่อหัวตาราง" ไม่ใช่ลำดับ — แต่ถ้าจะเพิ่มคอลัมน์เอง ให้เพิ่มทางขวาสุด
const COLUMNS = {
  Settings: [['Key', F_TEXT], ['Value', F_TEXT], ['คำอธิบาย', F_TEXT]],
  Members: [
    ['Member_ID', F_TEXT], ['LINE_User_ID', F_TEXT], ['Name', F_TEXT], ['Phone', F_TEXT],
    ['Birth_Date', F_TEXT], ['Picture', F_TEXT], ['Points', F_INT], ['Total_Spend', F_MONEY],
    ['Visit_Count', F_INT], ['Tier', F_TEXT], ['Joined_At', F_DATETIME], ['Last_Visit_At', F_DATETIME],
    ['Consent_Version', F_TEXT], ['Consent_At', F_DATETIME], ['Marketing_Consent', F_TEXT],
    ['Status', F_TEXT], ['Note', F_TEXT],
    // เพิ่มใน 2.3.0 — Name ยังเก็บ "ชื่อ นามสกุล" รวมกัน (หน้าพนักงาน/หลังบ้านใช้ต่อได้)
    ['First_Name', F_TEXT], ['Last_Name', F_TEXT]
  ],
  Transactions: [
    ['Tx_ID', F_TEXT], ['Date', F_DATETIME], ['Member_ID', F_TEXT], ['Type', F_TEXT],
    ['Amount', F_MONEY], ['Points', F_INT], ['Balance_After', F_INT], ['Detail', F_TEXT],
    ['Staff', F_TEXT], ['Request_ID', F_TEXT], ['Ref', F_TEXT]
  ],
  Rewards: [
    ['Reward_ID', F_TEXT], ['Name', F_TEXT], ['Description', F_TEXT], ['Points', F_INT],
    ['Image', F_TEXT], ['Valid_Days', F_INT], ['Quota', F_INT], ['Issued', F_INT],
    ['Limit_Per_Member', F_INT], ['Start_Date', F_DATE], ['End_Date', F_DATE],
    ['Sort', F_INT], ['Status', F_TEXT]
  ],
  Coupons: [
    ['Coupon_Code', F_TEXT], ['Member_ID', F_TEXT], ['Reward_ID', F_TEXT], ['Name', F_TEXT],
    ['Points_Used', F_INT], ['Issued_At', F_DATETIME], ['Expires_At', F_DATETIME],
    ['Used_At', F_DATETIME], ['Used_By', F_TEXT], ['Status', F_TEXT], ['Tx_ID', F_TEXT]
  ],
  Staff: [
    ['LINE_User_ID', F_TEXT], ['Name', F_TEXT], ['Role', F_TEXT], ['Status', F_TEXT],
    ['Requested_At', F_DATETIME], ['Note', F_TEXT]
  ],
  Promotions: [
    ['Promo_ID', F_TEXT], ['Title', F_TEXT], ['Subtitle', F_TEXT], ['Tag', F_TEXT],
    ['Image', F_TEXT], ['Link', F_TEXT], ['Start_Date', F_DATE], ['End_Date', F_DATE],
    ['Sort', F_INT], ['Status', F_TEXT]
  ]
};

// ค่าตั้งต้นของชีต Settings [Key, ค่าเริ่มต้น, คำอธิบาย]
// เจ้าของร้านแก้ค่าในชีตได้เลย มีผลทันทีโดยไม่ต้อง Deploy ใหม่
const SETTINGS_SPEC = [
  ['SHOP_NAME', 'ร้านของฉัน', 'ชื่อร้าน'],
  ['LIFF_ID', '', 'LIFF ID ของร้าน เช่น 1234567890-AbCdEfGh (ใช้ตรวจการเข้าสู่ระบบ LINE)'],
  ['MEMBER_PREFIX', 'M', 'ตัวอักษรนำหน้ารหัสสมาชิก ภาษาอังกฤษ 1–4 ตัว เช่น KW (ห้ามใช้ CP กับ TX)'],
  ['POINT_RATE_BAHT', '20', 'ยอดซื้อกี่บาทได้ 1 แต้ม'],
  ['MAX_PURCHASE', '20000', 'ยอดซื้อสูงสุดต่อบิลที่พนักงานบันทึกได้ (กันพิมพ์เลขผิด)'],
  ['CONFIRM_PURCHASE_OVER', '3000', 'ยอดซื้อตั้งแต่เท่านี้ หน้าพนักงานจะให้ยืนยันซ้ำ'],
  ['WELCOME_POINTS', '0', 'แต้มต้อนรับเมื่อสมัครสมาชิก (0 = ไม่ให้)'],
  ['COUPON_DAYS', '30', 'คูปองที่แลกแล้วใช้ได้กี่วัน (ใช้เมื่อรางวัลไม่ได้กำหนด Valid_Days)'],
  ['CONSENT_VERSION', '1', 'เวอร์ชันนโยบายความเป็นส่วนตัว เปลี่ยนเลขเมื่อแก้นโยบาย'],
  ['HISTORY_LIMIT', '50', 'จำนวนรายการประวัติล่าสุดที่ลูกค้าเห็น'],
  ['IMAGE_FOLDER_ID', '', 'โฟลเดอร์ Google Drive ที่เก็บรูปจากหลังบ้าน (วางลิงก์โฟลเดอร์ได้ / ว่าง = ระบบสร้างโฟลเดอร์ให้เอง)']
];

// คอลัมน์ที่เพิ่มทีหลัง: ชีตของร้านเดิมยังไม่มีก็ทำงานได้ (ระบบเติมให้เองตอนต้องเขียน)
// กันกรณีวาง code.gs ใหม่แล้วลืมรัน testSetup → ทั้งระบบล่มเพราะหาคอลัมน์ไม่เจอ
const LATE_COLUMNS = { Members: ['First_Name', 'Last_Name'] };

const ROLES = ['OWNER', 'ADMIN', 'CASHIER'];
const ALL_STAFF = ROLES;
const MANAGERS = ['OWNER', 'ADMIN'];

// ตัวอักษรที่ใช้สร้างรหัส — ตัด O 0 I 1 ออก เพราะพนักงานอ่าน/พิมพ์สับสน
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';


/* =====================================================
 * 1) รับคำสั่งจากหน้าเว็บ
 * ===================================================== */

// คำสั่งทั้งหมด: roles = บทบาทพนักงานที่ใช้ได้ (ไม่มี = ลูกค้าทั่วไปที่เข้าสู่ระบบ LINE แล้ว)
const ACTIONS = {
  bootstrap: { run: actBootstrap_ },
  register: { run: actRegister_ },
  redeem: { run: actRedeem_ },
  staffMe: { run: actStaffMe_ },
  staffLookup: { roles: ALL_STAFF, run: actStaffLookup_ },
  addPurchase: { roles: ALL_STAFF, run: actAddPurchase_ },
  useCoupon: { roles: ALL_STAFF, run: actUseCoupon_ },
  adjustPoints: { roles: MANAGERS, run: actAdjustPoints_ },
  staffRecent: { roles: ALL_STAFF, run: actStaffRecent_ },
  // หลังบ้าน (หน้า /<ร้าน>/admin): ให้เจ้าของร้านดูข้อมูลได้โดยไม่ต้องเปิดหรือแชร์ Google Sheet
  adminMe: { roles: MANAGERS, run: actAdminMe_ },
  adminDashboard: { roles: MANAGERS, run: actAdminDashboard_ },
  adminMembers: { roles: MANAGERS, run: actAdminMembers_ },
  adminMember: { roles: MANAGERS, run: actAdminMember_ },
  adminTransactions: { roles: MANAGERS, run: actAdminTransactions_ },
  adminCoupons: { roles: MANAGERS, run: actAdminCoupons_ },
  adminStaff: { roles: MANAGERS, run: actAdminStaff_ },
  adminStaffUpdate: { roles: MANAGERS, run: actAdminStaffUpdate_ },
  // ไฟล์ที่ส่งออกไปแล้วร้านควบคุมไม่ได้ (PDPA) → ให้เฉพาะเจ้าของร้าน
  adminExport: { roles: ['OWNER'], run: actAdminExport_ },
  // จัดการร้านจากหลังบ้าน (แทนการแก้ในชีต)
  adminRewards: { roles: MANAGERS, run: actAdminRewards_ },
  adminRewardSave: { roles: MANAGERS, run: actAdminRewardSave_ },
  adminPromos: { roles: MANAGERS, run: actAdminPromos_ },
  adminPromoSave: { roles: MANAGERS, run: actAdminPromoSave_ },
  adminMemberStatus: { roles: MANAGERS, run: actAdminMemberStatus_ },
  adminSettings: { roles: MANAGERS, run: actAdminSettings_ },
  // อัตราแต้ม/ชื่อร้านมีผลกับทุกบิลถัดไป → เจ้าของร้านเท่านั้น
  adminSettingsSave: { roles: ['OWNER'], run: actAdminSettingsSave_ },
  adminUploadImage: { roles: MANAGERS, run: actAdminUploadImage_ }
};

// เปิด URL ตรงๆ ใช้เช็กว่า Deploy สำเร็จ (ไม่คืนข้อมูลใดๆ)
function doGet() {
  return json_({ ok: true, service: 'LINE CRM', version: APP_VERSION });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'คำขอไม่ถูกต้อง', code: 'BAD_REQUEST' });
  }

  try {
    const action = String(body.action || '');
    const def = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!def) throw userError_('ไม่รู้จักคำสั่งนี้', 'UNKNOWN_ACTION');

    const ctx = { user: requireUser_(body.idToken) };
    if (def.roles) ctx.staff = requireStaff_(ctx.user, def.roles);

    const result = def.run(body, ctx) || {};
    const out = { ok: true };
    if (isTestMode_()) out.testMode = true;
    // หลังบ้านเปิดครั้งแรก: ขอข้อมูลผู้ใช้มาพร้อมข้อมูลหน้าแรกเลย ไม่ต้องเรียก Apps Script 2 รอบ (ประหยัด ~2 วินาที)
    if (body.withMe === true && ctx.staff) out.me = { userId: ctx.user.userId, name: ctx.staff.name, role: ctx.staff.role };
    Object.keys(result).forEach(function (k) { out[k] = result[k]; });
    return json_(out);
  } catch (err) {
    // ข้อความที่ตั้งใจบอกผู้ใช้ → ส่งกลับตามนั้น / ข้อผิดพลาดอื่น → ไม่ส่งรายละเอียดภายในออกไป
    const known = err && err.userMessage;
    if (!known) console.error(err && err.stack ? err.stack : err);
    const out = {
      ok: false,
      error: known ? err.userMessage : 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
      code: (err && err.code) || 'ERROR'
    };
    if (!known && isTestMode_()) out.debug = String(err && err.message ? err.message : err);
    return json_(out);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ข้อผิดพลาดที่ "ตั้งใจ" ให้ผู้ใช้เห็นข้อความ
function userError_(message, code) {
  const err = new Error(message);
  err.userMessage = message;
  err.code = code || 'INVALID';
  return err;
}


/* =====================================================
 * 2) ตรวจตัวตน (LINE) และสิทธิ์พนักงาน
 * ===================================================== */

// โหมดทดสอบ: เปิดเฉพาะ Apps Script ตัวทดสอบของเราเอง (ห้ามเปิดในสคริปต์ของร้านจริง)
// เปิดแล้วจะรับ token ปลอมรูปแบบ "TEST:<userId>:<ชื่อ>" จากหน้าเว็บที่รันในเครื่อง
let testMode_ = null;
function isTestMode_() {
  if (testMode_ === null) testMode_ = PropertiesService.getScriptProperties().getProperty('TEST_MODE') === 'true';
  return testMode_;
}

function requireUser_(idToken) {
  const token = String(idToken || '');
  if (!token) throw userError_('กรุณาเปิดผ่าน LINE', 'NO_TOKEN');

  if (token.indexOf('TEST:') === 0) {
    if (!isTestMode_()) throw userError_('Apps Script นี้ไม่ได้เปิดโหมดทดสอบ', 'TEST_DISABLED');
    const parts = token.split(':');
    const userId = String(parts[1] || '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(userId)) throw userError_('รหัสผู้ทดสอบไม่ถูกต้อง', 'TEST_DISABLED');
    return { userId: userId, name: cleanLineName_(parts.slice(2).join(':')) || 'ผู้ทดสอบ', picture: '' };
  }

  // จำผลตรวจ token ไว้ชั่วคราว: ไม่ต้องถาม LINE ทุกคำสั่ง (เร็วขึ้น และประหยัดโควตา UrlFetch)
  const cache = CacheService.getScriptCache();
  const key = 'tok:' + sha256Hex_(token).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  let channelId = String(getSettings_().LIFF_ID || '').split('-')[0];
  if (!/^\d+$/.test(channelId)) {
    // เพิ่งกรอก LIFF_ID แต่ค่าที่จำไว้ยังเป็นของเก่า → อ่านชีตใหม่อีกครั้งก่อนบอกว่ายังไม่ได้ตั้ง
    invalidateRows_([SHEET.SETTINGS]);
    settings_ = null;
    channelId = String(getSettings_().LIFF_ID || '').split('-')[0];
  }
  if (!/^\d+$/.test(channelId)) throw userError_('ร้านยังไม่ได้ตั้งค่า LIFF_ID ในชีต Settings', 'NO_LIFF');

  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: token, client_id: channelId },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.warn('LINE verify ไม่ผ่าน: ' + res.getContentText());
    throw userError_('การเข้าสู่ระบบ LINE หมดอายุ กรุณาปิดแล้วเปิดใหม่', 'TOKEN_INVALID');
  }
  const data = JSON.parse(res.getContentText());
  if (!data.sub) throw userError_('การเข้าสู่ระบบ LINE ไม่สมบูรณ์ กรุณาเปิดใหม่', 'TOKEN_INVALID');

  const user = { userId: String(data.sub), name: cleanLineName_(data.name), picture: safeUrl_(data.picture) };
  const ttl = Math.min(21600, Math.floor(Number(data.exp || 0) - Date.now() / 1000) - 60);
  if (ttl > 60) cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function findStaff_(userId) {
  return findOne_(SHEET.STAFF, 'LINE_User_ID', userId);
}

// พนักงานต้องอยู่ในชีต Staff และ Status = ACTIVE (เจ้าของร้านเป็นคนเปลี่ยนในชีต)
function requireStaff_(user, roles) {
  const s = findStaff_(user.userId);
  if (!s || upper_(s.Status) !== 'ACTIVE') {
    throw userError_('บัญชี LINE นี้ยังไม่ได้รับสิทธิ์พนักงาน', 'NOT_STAFF');
  }
  // บทบาทที่สะกดผิดหรือว่าง → ให้สิทธิ์น้อยที่สุด (CASHIER) ไว้ก่อน
  const role = ROLES.indexOf(upper_(s.Role)) >= 0 ? upper_(s.Role) : 'CASHIER';
  if (roles.indexOf(role) < 0) {
    throw userError_('บทบาท ' + role + ' ใช้คำสั่งนี้ไม่ได้', 'NO_ROLE');
  }
  return { userId: user.userId, name: String(s.Name || user.name || 'พนักงาน'), role: role };
}


/* =====================================================
 * 3) คำสั่งของลูกค้า
 * ===================================================== */

// เปิดหน้าลูกค้า: ส่งทุกอย่างที่หน้าแรกต้องใช้ในคำสั่งเดียว (เดิมต้องเรียก 4 รอบ)
function actBootstrap_(p, ctx) {
  const c = cfg_();
  const now = new Date();
  const member = findMemberByLine_(ctx.user.userId);
  const out = {
    settings: {
      shopName: c.shopName,
      pointRate: c.pointRate,
      welcomePoints: c.welcomePoints,
      consentVersion: c.consentVersion
    },
    profile: { name: ctx.user.name, picture: ctx.user.picture },
    member: null,
    history: [],
    coupons: [],
    rewards: listRewards_(now),
    promos: listPromos_(now)
  };
  if (!member) return out;

  // อัปเดตรูปโปรไฟล์เมื่อลูกค้าเปลี่ยนรูปใน LINE (เขียนเฉพาะตอนที่เปลี่ยนจริง)
  if (ctx.user.picture && ctx.user.picture !== String(member.Picture || '')) {
    updateFields_(SHEET.MEMBERS, member._row, { Picture: ctx.user.picture });
    member.Picture = ctx.user.picture;
  }

  out.member = publicMember_(member);
  out.history = rowsWhere_(SHEET.TX, 'Member_ID', member.Member_ID, c.historyLimit).reverse().map(publicTx_);
  out.coupons = rowsWhere_(SHEET.COUPONS, 'Member_ID', member.Member_ID, 100).reverse()
    .map(function (cp) { return publicCoupon_(cp, now); });
  return out;
}

function actRegister_(p, ctx) {
  if (p.consentPrivacy !== true) throw userError_('กรุณายอมรับนโยบายความเป็นส่วนตัวก่อนสมัคร', 'NO_CONSENT');
  // ชื่อ นามสกุล วันเกิด เบอร์ บังคับทุกช่อง (ร้านต้องการข้อมูลครบตั้งแต่สมัคร — ตัดสินใจ 3 พ.ย. 2569)
  const firstName = cleanNamePart_(p.firstName, 'ชื่อ');
  const lastName = cleanNamePart_(p.lastName, 'นามสกุล');
  const name = firstName + ' ' + lastName;
  const birthDate = cleanBirthDate_(p.birthDate);
  if (!birthDate) throw userError_('กรุณาเลือกวันเกิด', 'BAD_BIRTHDATE');
  const phone = cleanPhone_(p.phone);
  const c = cfg_();

  return withLock_(function () {
    const existing = findMemberByLine_(ctx.user.userId);
    if (existing) return { member: publicMember_(existing), already: true };
    ensureColumns_(SHEET.MEMBERS);

    if (findRow_(SHEET.MEMBERS, 'Phone', phone)) {
      throw userError_('เบอร์โทรนี้สมัครสมาชิกไว้แล้ว ถ้าเป็นเบอร์ของคุณ กรุณาติดต่อพนักงาน', 'PHONE_TAKEN');
    }

    const now = new Date();
    const member = {
      Member_ID: newMemberId_(c.memberPrefix),
      LINE_User_ID: ctx.user.userId,
      Name: name,
      Phone: phone,
      Birth_Date: birthDate,
      Picture: ctx.user.picture || '',
      Points: c.welcomePoints,
      Total_Spend: 0,
      Visit_Count: 0,
      Tier: '',
      Joined_At: now,
      Last_Visit_At: '',
      Consent_Version: c.consentVersion,
      Consent_At: now,
      Marketing_Consent: p.consentMarketing === true ? 'YES' : 'NO',
      Status: 'ACTIVE',
      Note: '',
      First_Name: firstName,
      Last_Name: lastName
    };
    member._row = appendObj_(SHEET.MEMBERS, member);

    if (c.welcomePoints > 0) {
      appendTx_({
        memberId: member.Member_ID, type: 'WELCOME', points: c.welcomePoints,
        balance: c.welcomePoints, detail: 'แต้มต้อนรับสมาชิกใหม่', staff: 'SYSTEM'
      });
    }
    return { member: publicMember_(member), welcomePoints: c.welcomePoints };
  });
}

// แลกรางวัล: ตรวจทุกอย่างที่ Apps Script (แต้ม โควตา จำกัดต่อคน ช่วงเวลา) ไม่เชื่อตัวเลขจากหน้าเว็บ
function actRedeem_(p, ctx) {
  const rewardId = cleanKey_(p.rewardId, 'รหัสรางวัล');
  const c = cfg_();

  return afterWrite_([SHEET.REWARDS], function () {
   return withLock_(function () {
    return once_('redeem', ctx.user.userId, p.requestId, function (reqId) {
      const dup = findOne_(SHEET.TX, 'Request_ID', reqId);
      if (dup) return { duplicate: true, points: toInt_(dup.Balance_After) };

      const member = findMemberByLine_(ctx.user.userId);
      if (!member) throw userError_('กรุณาสมัครสมาชิกก่อน', 'NOT_MEMBER');
      assertActiveMember_(member);

      const now = new Date();
      const rRow = findRow_(SHEET.REWARDS, 'Reward_ID', rewardId);
      const reward = rRow ? readRow_(SHEET.REWARDS, rRow) : null;
      if (!reward || upper_(reward.Status) !== 'ACTIVE' || !inWindow_(reward.Start_Date, reward.End_Date, now)) {
        throw userError_('รางวัลนี้ไม่พร้อมให้แลกแล้ว', 'REWARD_UNAVAILABLE');
      }

      const cost = toInt_(reward.Points);
      if (cost <= 0) throw userError_('รางวัลนี้ตั้งค่าแต้มไม่ถูกต้อง', 'REWARD_UNAVAILABLE');

      const quota = toInt_(reward.Quota);
      const issued = toInt_(reward.Issued);
      if (quota > 0 && issued >= quota) throw userError_('รางวัลนี้ถูกแลกครบจำนวนแล้ว', 'SOLD_OUT');

      const limit = toInt_(reward.Limit_Per_Member);
      if (limit > 0) {
        const mine = rowsWhere_(SHEET.COUPONS, 'Member_ID', member.Member_ID, 1000).filter(function (cp) {
          return String(cp.Reward_ID) === rewardId && upper_(cp.Status) !== 'CANCELLED';
        }).length;
        if (mine >= limit) throw userError_('คุณแลกรางวัลนี้ครบ ' + limit + ' ครั้งแล้ว', 'LIMIT_REACHED');
      }

      const points = toInt_(member.Points);
      if (points < cost) {
        throw userError_('แต้มไม่พอ ต้องใช้ ' + fmtNum_(cost) + ' แต้ม (มีอยู่ ' + fmtNum_(points) + ')', 'NOT_ENOUGH');
      }

      const balance = points - cost;
      const code = newCouponCode_();
      const days = toInt_(reward.Valid_Days) > 0 ? toInt_(reward.Valid_Days) : c.couponDays;

      updateFields_(SHEET.MEMBERS, member._row, { Points: balance });
      const txId = appendTx_({
        memberId: member.Member_ID, type: 'REDEEM', points: -cost, balance: balance,
        detail: 'แลก ' + String(reward.Name || ''), requestId: reqId, ref: code
      });
      const coupon = {
        Coupon_Code: code,
        Member_ID: member.Member_ID,
        Reward_ID: rewardId,
        Name: String(reward.Name || ''),
        Points_Used: cost,
        Issued_At: now,
        Expires_At: endOfDayAfter_(now, days),
        Used_At: '',
        Used_By: '',
        Status: 'ACTIVE',
        Tx_ID: txId
      };
      appendObj_(SHEET.COUPONS, coupon);
      updateFields_(SHEET.REWARDS, rRow, { Issued: issued + 1 });

      return { points: balance, coupon: publicCoupon_(coupon, now) };
    });
   });
  });
}


/* =====================================================
 * 4) คำสั่งของพนักงาน
 * ===================================================== */

// เปิดหน้าพนักงาน: ถ้ายังไม่มีชื่อในชีต Staff จะเพิ่มเป็น PENDING ให้เจ้าของร้านอนุมัติ
function actStaffMe_(p, ctx) {
  let s = findStaff_(ctx.user.userId);
  if (!s) {
    withLock_(function () {
      if (findStaff_(ctx.user.userId)) return;
      appendObj_(SHEET.STAFF, {
        LINE_User_ID: ctx.user.userId,
        Name: ctx.user.name || 'พนักงาน',
        Role: 'CASHIER',
        Status: 'PENDING',
        Requested_At: new Date(),
        Note: 'ขอสิทธิ์จากหน้าพนักงาน — เปลี่ยน Status เป็น ACTIVE เพื่ออนุมัติ'
      });
    });
    s = findStaff_(ctx.user.userId);
  }

  const status = upper_(s.Status) || 'PENDING';
  const role = ROLES.indexOf(upper_(s.Role)) >= 0 ? upper_(s.Role) : 'CASHIER';
  const out = {
    staff: { userId: ctx.user.userId, name: String(s.Name || ctx.user.name || ''), role: role, status: status }
  };
  if (status === 'ACTIVE') {
    const c = cfg_();
    out.settings = {
      shopName: c.shopName,
      pointRate: c.pointRate,
      maxPurchase: c.maxPurchase,
      confirmOver: c.confirmOver
    };
  }
  return out;
}

// ค้นจาก QR หรือที่พิมพ์: รหัสคูปอง (CP-...) / เบอร์โทร / รหัสสมาชิก
function actStaffLookup_(p, ctx) {
  const q = String(p.query || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!q || q.length > 40) throw userError_('กรุณาใส่รหัสสมาชิก เบอร์โทร หรือรหัสคูปอง', 'BAD_QUERY');
  const now = new Date();

  if (/^CP-[A-Z0-9]+$/.test(q)) {
    const cp = findOne_(SHEET.COUPONS, 'Coupon_Code', q);
    if (!cp) throw userError_('ไม่พบคูปองรหัสนี้', 'NOT_FOUND');
    const owner = findOne_(SHEET.MEMBERS, 'Member_ID', cp.Member_ID);
    return { kind: 'coupon', coupon: publicCoupon_(cp, now), member: owner ? staffMember_(owner) : null };
  }

  let m = null;
  if (/^[0-9+\-]+$/.test(q)) {
    const phone = normalizePhone_(q);
    if (phone) m = findOne_(SHEET.MEMBERS, 'Phone', phone);
  }
  if (!m) m = findOne_(SHEET.MEMBERS, 'Member_ID', q);
  if (!m) throw userError_('ไม่พบสมาชิก', 'NOT_FOUND');

  const coupons = rowsWhere_(SHEET.COUPONS, 'Member_ID', m.Member_ID, 100).reverse()
    .map(function (cp) { return publicCoupon_(cp, now); })
    .filter(function (cp) { return cp.status === 'ACTIVE'; });
  return { kind: 'member', member: staffMember_(m), coupons: coupons };
}

// บันทึกยอดซื้อ: Apps Script คิดแต้มเอง และบันทึกทุกบิล (แม้ไม่ถึงเกณฑ์) เพื่อให้รู้ยอดซื้อสะสมจริง
function actAddPurchase_(p, ctx) {
  const c = cfg_();
  const memberId = cleanMemberId_(p.memberId);
  const amount = Math.round(Number(p.amount) * 100) / 100;
  if (!isFinite(amount) || amount <= 0) throw userError_('กรุณาใส่ยอดซื้อมากกว่า 0 บาท', 'BAD_AMOUNT');
  if (amount > c.maxPurchase) {
    throw userError_('ยอดซื้อเกิน ' + fmtNum_(c.maxPurchase) + ' บาทต่อบิล (ถ้าถูกต้อง ให้เจ้าของร้านปรับ MAX_PURCHASE ในชีต Settings)', 'OVER_MAX');
  }
  const note = cleanNote_(p.note);
  const points = Math.floor(amount / c.pointRate + 1e-9);

  return withLock_(function () {
    return once_('addPurchase', ctx.user.userId, p.requestId, function (reqId) {
      const dup = findOne_(SHEET.TX, 'Request_ID', reqId);
      if (dup) {
        const dm = findOne_(SHEET.MEMBERS, 'Member_ID', dup.Member_ID);
        return {
          duplicate: true, amount: toNum_(dup.Amount), pointsAdded: toInt_(dup.Points),
          balance: toInt_(dup.Balance_After), member: dm ? staffMember_(dm) : null
        };
      }

      const row = findRow_(SHEET.MEMBERS, 'Member_ID', memberId);
      if (!row) throw userError_('ไม่พบสมาชิก', 'NOT_FOUND');
      const m = readRow_(SHEET.MEMBERS, row);
      assertActiveMember_(m);

      const now = new Date();
      const balance = toInt_(m.Points) + points;
      const spend = Math.round((toNum_(m.Total_Spend) + amount) * 100) / 100;
      const visits = toInt_(m.Visit_Count) + 1;
      updateFields_(SHEET.MEMBERS, row, { Points: balance, Total_Spend: spend, Visit_Count: visits, Last_Visit_At: now });

      const detail = note || ('ซื้อสินค้า ' + fmtMoney_(amount) + ' บาท' + (points ? '' : ' (ไม่ถึงเกณฑ์รับแต้ม)'));
      const txId = appendTx_({
        memberId: memberId, type: 'EARN', amount: amount, points: points, balance: balance,
        detail: detail, staff: ctx.staff.name, requestId: reqId
      });

      m.Points = balance; m.Total_Spend = spend; m.Visit_Count = visits; m.Last_Visit_At = now;
      return { txId: txId, amount: amount, pointsAdded: points, balance: balance, member: staffMember_(m) };
    });
  });
}

// ใช้คูปอง: ทำได้เฉพาะพนักงาน (ลูกค้ากดใช้เองไม่ได้ เพื่อให้หน้าร้านตรวจได้จริง)
function actUseCoupon_(p, ctx) {
  const code = String(p.code || '').trim().toUpperCase();
  if (!/^CP-[A-Z0-9]{4,20}$/.test(code)) throw userError_('รหัสคูปองไม่ถูกต้อง', 'BAD_CODE');

  return withLock_(function () {
    return once_('useCoupon', ctx.user.userId, p.requestId, function () {
      const row = findRow_(SHEET.COUPONS, 'Coupon_Code', code);
      if (!row) throw userError_('ไม่พบคูปองรหัสนี้', 'NOT_FOUND');
      const cp = readRow_(SHEET.COUPONS, row);
      const now = new Date();
      const state = couponState_(cp, now);
      if (state === 'USED') throw userError_('คูปองนี้ถูกใช้ไปแล้วเมื่อ ' + fmtDateTime_(cp.Used_At), 'USED');
      if (state === 'EXPIRED') throw userError_('คูปองนี้หมดอายุแล้ว', 'EXPIRED');
      if (state !== 'ACTIVE') throw userError_('คูปองนี้ใช้ไม่ได้', 'INVALID_COUPON');

      const owner = findOne_(SHEET.MEMBERS, 'Member_ID', cp.Member_ID);
      if (owner) assertActiveMember_(owner);

      updateFields_(SHEET.COUPONS, row, { Status: 'USED', Used_At: now, Used_By: ctx.staff.name });
      cp.Status = 'USED'; cp.Used_At = now; cp.Used_By = ctx.staff.name;
      return { coupon: publicCoupon_(cp, now), member: owner ? staffMember_(owner) : null };
    });
  });
}

// ปรับแต้ม (แก้รายการผิด ชดเชย ฯลฯ): เฉพาะ OWNER / ADMIN และต้องมีเหตุผลเสมอ
function actAdjustPoints_(p, ctx) {
  const memberId = cleanMemberId_(p.memberId);
  const delta = Number(p.points);
  if (!isFinite(delta) || Math.floor(delta) !== delta || delta === 0 || Math.abs(delta) > 1000000) {
    throw userError_('จำนวนแต้มต้องเป็นจำนวนเต็ม และไม่เป็น 0', 'BAD_POINTS');
  }
  const reason = cleanNote_(p.reason);
  if (reason.length < 3) throw userError_('กรุณาใส่เหตุผลในการปรับแต้ม', 'NO_REASON');

  return withLock_(function () {
    return once_('adjustPoints', ctx.user.userId, p.requestId, function (reqId) {
      const dup = findOne_(SHEET.TX, 'Request_ID', reqId);
      if (dup) return { duplicate: true, pointsAdded: toInt_(dup.Points), balance: toInt_(dup.Balance_After) };

      const row = findRow_(SHEET.MEMBERS, 'Member_ID', memberId);
      if (!row) throw userError_('ไม่พบสมาชิก', 'NOT_FOUND');
      const m = readRow_(SHEET.MEMBERS, row);
      const balance = toInt_(m.Points) + delta;
      if (balance < 0) throw userError_('ปรับแล้วแต้มติดลบไม่ได้ (มีอยู่ ' + fmtNum_(toInt_(m.Points)) + ' แต้ม)', 'NEGATIVE');

      updateFields_(SHEET.MEMBERS, row, { Points: balance });
      appendTx_({
        memberId: memberId, type: 'ADJUST', points: delta, balance: balance,
        detail: 'ปรับแต้ม: ' + reason, staff: ctx.staff.name, requestId: reqId
      });
      m.Points = balance;
      return { pointsAdded: delta, balance: balance, member: staffMember_(m) };
    });
  });
}

// รายการล่าสุดของร้าน (ให้พนักงานตรวจสิ่งที่เพิ่งบันทึก) — อ่านเฉพาะท้ายชีต ไม่อ่านทั้งชีต
function actStaffRecent_() {
  const t = table_(SHEET.TX);
  const last = t.sheet.getLastRow();
  if (last < 2) return { items: [] };
  const n = Math.min(15, last - 1);
  const rows = t.sheet.getRange(last - n + 1, 1, n, t.width).getValues()
    .map(function (v, i) { return rowToObj_(t, v, last - n + 1 + i); }).reverse();

  const names = {};
  const mt = table_(SHEET.MEMBERS);
  const mLast = mt.sheet.getLastRow();
  if (mLast >= 2) {
    const ids = mt.sheet.getRange(2, mt.col.Member_ID, mLast - 1, 1).getValues();
    const nm = mt.sheet.getRange(2, mt.col.Name, mLast - 1, 1).getValues();
    ids.forEach(function (r, i) { names[String(r[0])] = String(nm[i][0]); });
  }

  return {
    items: rows.map(function (tx) {
      const o = publicTx_(tx);
      o.memberId = String(tx.Member_ID || '');
      o.memberName = names[o.memberId] || '';
      o.staff = String(tx.Staff || '');
      return o;
    })
  };
}


/* =====================================================
 * 4.1) คำสั่งของหลังบ้าน (เฉพาะ OWNER / ADMIN — ตรวจใน ACTIONS ทุกคำสั่ง)
 * อ่านอย่างเดียว ยกเว้น adminStaffUpdate (ปรับแต้มใช้ adjustPoints ตัวเดิม)
 * ===================================================== */

const ADMIN_PAGE_SIZE = 50;
const MAX_RANGE_DAYS = 366;
const TX_TYPES = ['EARN', 'WELCOME', 'REDEEM', 'ADJUST'];
const STAFF_STATUSES = ['PENDING', 'ACTIVE', 'DISABLED'];

function actAdminMe_(p, ctx) {
  const c = cfg_();
  return {
    me: { userId: ctx.user.userId, name: ctx.staff.name, role: ctx.staff.role },
    settings: { shopName: c.shopName, pointRate: c.pointRate, memberPrefix: c.memberPrefix }
  };
}

// ภาพรวมของช่วงเวลาที่เลือก + ช่วงก่อนหน้าที่ยาวเท่ากัน (ไว้เทียบว่าดีขึ้นหรือแย่ลง)
function actAdminDashboard_(p) {
  const per = period_(p);
  const members = readAll_(SHEET.MEMBERS).filter(function (m) { return m.Member_ID; });
  const coupons = readAll_(SHEET.COUPONS).filter(function (c) { return c.Coupon_Code; });
  const txs = txBetween_(per.prevFrom, per.end);
  const cur = txs.filter(function (tx) { return tx._date.getTime() >= per.from.getTime(); });
  const prev = txs.filter(function (tx) { return tx._date.getTime() < per.from.getTime(); });

  function summary(list, from, end) {
    const s = { newMembers: 0, buyers: 0, bills: 0, sales: 0, pointsIssued: 0, pointsRedeemed: 0, couponsUsed: 0 };
    members.forEach(function (m) { if (between_(m.Joined_At, from, end)) s.newMembers++; });
    coupons.forEach(function (c) { if (upper_(c.Status) === 'USED' && between_(c.Used_At, from, end)) s.couponsUsed++; });
    const buyers = {};
    list.forEach(function (tx) {
      const type = upper_(tx.Type);
      const pts = toInt_(tx.Points);
      if (type === 'EARN') { s.bills++; s.sales += toNum_(tx.Amount); buyers[String(tx.Member_ID)] = true; }
      if (pts > 0) s.pointsIssued += pts;              // แต้มจากยอดซื้อ + แต้มต้อนรับ + ปรับเพิ่ม
      if (type === 'REDEEM') s.pointsRedeemed -= pts;  // แต้มที่ลูกค้าใช้แลกรางวัล (เก็บเป็นค่าลบในชีต)
    });
    s.buyers = Object.keys(buyers).length;
    s.sales = round2_(s.sales);
    return s;
  }

  // กราฟ: ช่วงไม่เกิน 62 วันแสดงรายวัน ยาวกว่านั้นรวมเป็นรายเดือน (แท่งจะได้ไม่เล็กจนอ่านไม่ออก)
  const bucket = per.days <= 62 ? 'day' : 'month';
  const keyOf = function (d) {
    const k = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
    return bucket === 'day' ? k : k.slice(0, 7);
  };
  const series = [];
  const at = {};
  for (let t = per.from.getTime(); t < per.end.getTime(); t += 86400000) {
    const k = keyOf(new Date(t));
    if (!at[k]) { at[k] = { key: k, sales: 0, bills: 0, newMembers: 0 }; series.push(at[k]); }
  }
  cur.forEach(function (tx) {
    const b = at[keyOf(tx._date)];
    if (b && upper_(tx.Type) === 'EARN') { b.sales += toNum_(tx.Amount); b.bills++; }
  });
  members.forEach(function (m) {
    const d = toDate_(m.Joined_At);
    if (d && between_(d, per.from, per.end) && at[keyOf(d)]) at[keyOf(d)].newMembers++;
  });
  series.forEach(function (b) { b.sales = round2_(b.sales); });

  // ลูกค้าที่ซื้อมากสุด / ยอดตามพนักงาน (นับเฉพาะรายการยอดซื้อในช่วงนี้)
  const names = {};
  members.forEach(function (m) { names[String(m.Member_ID)] = String(m.Name || ''); });
  const byMember = {};
  const byStaff = {};
  cur.forEach(function (tx) {
    if (upper_(tx.Type) !== 'EARN') return;
    const id = String(tx.Member_ID);
    const bm = byMember[id] || (byMember[id] = { memberId: id, name: names[id] || '', sales: 0, bills: 0 });
    bm.sales += toNum_(tx.Amount); bm.bills++;
    const sn = String(tx.Staff || '-');
    const bs = byStaff[sn] || (byStaff[sn] = { staff: sn, sales: 0, bills: 0, couponsUsed: 0 });
    bs.sales += toNum_(tx.Amount); bs.bills++;
  });
  coupons.forEach(function (c) {
    if (upper_(c.Status) !== 'USED' || !between_(c.Used_At, per.from, per.end)) return;
    const sn = String(c.Used_By || '-');
    const bs = byStaff[sn] || (byStaff[sn] = { staff: sn, sales: 0, bills: 0, couponsUsed: 0 });
    bs.couponsUsed++;
  });

  // ของรางวัลยอดนิยม: คูปองที่แลกในช่วงนี้ และในนั้นถูกใช้ที่ร้านแล้วกี่ใบ
  const byReward = {};
  coupons.forEach(function (c) {
    if (!between_(c.Issued_At, per.from, per.end)) return;
    const k = String(c.Reward_ID || c.Name);
    const r = byReward[k] || (byReward[k] = { rewardId: String(c.Reward_ID || ''), name: String(c.Name || ''), issued: 0, used: 0, points: 0 });
    r.issued++;
    r.points += toInt_(c.Points_Used);
    if (upper_(c.Status) === 'USED') r.used++;
  });

  const values = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); };
  const roundSales = function (r) { r.sales = round2_(r.sales); return r; };
  let outstanding = 0;
  let activeMembers = 0;
  members.forEach(function (m) {
    if ((upper_(m.Status) || 'ACTIVE') !== 'ACTIVE') return;
    activeMembers++;
    outstanding += toInt_(m.Points);
  });

  return {
    period: { from: p.from, to: p.to, days: per.days, bucket: bucket },
    totals: { members: members.length, activeMembers: activeMembers, pointsOutstanding: outstanding },
    current: summary(cur, per.from, per.end),
    previous: summary(prev, per.prevFrom, per.from),
    series: series,
    topMembers: values(byMember).map(roundSales).sort(function (a, b) { return b.sales - a.sales; }).slice(0, 5),
    byStaff: values(byStaff).map(roundSales).sort(function (a, b) { return b.sales - a.sales || b.couponsUsed - a.couponsUsed; }),
    topRewards: values(byReward).sort(function (a, b) { return b.issued - a.issued; }).slice(0, 5)
  };
}

// รายชื่อสมาชิก: ค้นหา + เรียง + แบ่งหน้า
function actAdminMembers_(p, ctx) {
  const role = ctx.staff.role;
  const q = String(p.q || '').trim().toLowerCase().slice(0, 40);
  const sort = ['joined', 'points', 'spend', 'lastVisit', 'name'].indexOf(p.sort) >= 0 ? p.sort : 'joined';
  const status = ['ACTIVE', 'BLOCKED'].indexOf(upper_(p.status)) >= 0 ? upper_(p.status) : '';

  let list = readAll_(SHEET.MEMBERS).filter(function (m) { return m.Member_ID; });
  if (status) list = list.filter(function (m) { return (upper_(m.Status) || 'ACTIVE') === status; });
  if (q) {
    // ค้นเบอร์: เจ้าของร้านค้นบางส่วนได้ / ผู้จัดการต้องพิมพ์เบอร์เต็ม (กันไล่เดาเบอร์ลูกค้าทีละหลัก)
    const digits = q.replace(/\D/g, '');
    const fullPhone = normalizePhone_(q);
    list = list.filter(function (m) {
      const phone = String(m.Phone || '');
      return String(m.Name || '').toLowerCase().indexOf(q) >= 0 ||
        String(m.Member_ID).toLowerCase().indexOf(q) >= 0 ||
        (role === 'OWNER' && digits.length >= 3 && phone.indexOf(digits) >= 0) ||
        (!!fullPhone && phone === fullPhone);
    });
  }

  const time = function (v) { const d = toDate_(v); return d ? d.getTime() : 0; };
  const cmp = {
    joined: function (a, b) { return time(b.Joined_At) - time(a.Joined_At); },
    points: function (a, b) { return toInt_(b.Points) - toInt_(a.Points); },
    spend: function (a, b) { return toNum_(b.Total_Spend) - toNum_(a.Total_Spend); },
    lastVisit: function (a, b) { return time(b.Last_Visit_At) - time(a.Last_Visit_At); },
    name: function (a, b) { return String(a.Name || '').localeCompare(String(b.Name || ''), 'th'); }
  }[sort];
  list.sort(cmp);

  const pg = page_(p.page, list.length);
  return {
    items: list.slice(pg.start, pg.start + ADMIN_PAGE_SIZE).map(function (m) { return adminMember_(m, role); }),
    total: list.length, page: pg.page, pages: pg.pages
  };
}

// สมาชิกรายคน: ข้อมูล + ประวัติแต้ม + คูปอง
function actAdminMember_(p, ctx) {
  const id = cleanMemberId_(p.memberId);
  const m = findOne_(SHEET.MEMBERS, 'Member_ID', id);
  if (!m) throw userError_('ไม่พบสมาชิก', 'NOT_FOUND');
  const now = new Date();
  const owner = ctx.staff.role === 'OWNER';
  const out = adminMember_(m, ctx.staff.role);
  out.birthDate = owner ? String(m.Birth_Date || '') : '';   // ข้อมูลส่วนตัว → เจ้าของร้านเท่านั้น
  out.consentVersion = String(m.Consent_Version || '');
  out.consentAt = iso_(m.Consent_At);
  out.marketingConsent = upper_(m.Marketing_Consent) === 'YES';
  out.note = String(m.Note || '');
  out.lineLinked = !!String(m.LINE_User_ID || '');
  out.firstName = String(m.First_Name || '');
  out.lastName = String(m.Last_Name || '');
  return {
    member: out,
    history: rowsWhere_(SHEET.TX, 'Member_ID', id, 200).reverse().map(function (tx) {
      const o = publicTx_(tx);
      o.staff = String(tx.Staff || '');
      o.ref = String(tx.Ref || '');
      return o;
    }),
    coupons: rowsWhere_(SHEET.COUPONS, 'Member_ID', id, 200).reverse().map(function (c) {
      const o = publicCoupon_(c, now);
      o.usedBy = String(c.Used_By || '');
      return o;
    })
  };
}

// รายการแต้มทั้งหมดในช่วงเวลา (ใหม่ → เก่า) กรองตามประเภท/พนักงาน/สมาชิกได้
function actAdminTransactions_(p) {
  const per = period_(p);
  const type = TX_TYPES.indexOf(upper_(p.type)) >= 0 ? upper_(p.type) : '';
  const staff = String(p.staff || '').slice(0, 60);
  const q = String(p.q || '').trim().toLowerCase().slice(0, 40);
  const names = memberNames_();

  const inRange = txBetween_(per.from, per.end);
  const staffNames = {};
  inRange.forEach(function (tx) { if (tx.Staff) staffNames[String(tx.Staff)] = true; });

  const list = inRange.filter(function (tx) {
    if (type && upper_(tx.Type) !== type) return false;
    if (staff && String(tx.Staff || '') !== staff) return false;
    if (q) {
      const id = String(tx.Member_ID || '');
      if (id.toLowerCase().indexOf(q) < 0 && String(names[id] || '').toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }).sort(function (a, b) { return b._date.getTime() - a._date.getTime() || b._row - a._row; });

  const sum = { count: list.length, sales: 0, pointsPlus: 0, pointsMinus: 0 };
  list.forEach(function (tx) {
    const pts = toInt_(tx.Points);
    if (upper_(tx.Type) === 'EARN') sum.sales += toNum_(tx.Amount);
    if (pts > 0) sum.pointsPlus += pts; else sum.pointsMinus -= pts;
  });
  sum.sales = round2_(sum.sales);

  const pg = page_(p.page, list.length);
  return {
    items: list.slice(pg.start, pg.start + ADMIN_PAGE_SIZE).map(function (tx) {
      const o = publicTx_(tx);
      o.memberId = String(tx.Member_ID || '');
      o.memberName = names[o.memberId] || '';
      o.staff = String(tx.Staff || '');
      o.ref = String(tx.Ref || '');
      return o;
    }),
    summary: sum,
    staffNames: Object.keys(staffNames).sort(),
    total: list.length, page: pg.page, pages: pg.pages
  };
}

// คูปองที่ลูกค้าแลกในช่วงเวลา + สถานะ (ใช้ได้ / ใช้แล้ว / หมดอายุ)
function actAdminCoupons_(p) {
  const per = period_(p);
  const status = ['ACTIVE', 'USED', 'EXPIRED', 'CANCELLED'].indexOf(upper_(p.status)) >= 0 ? upper_(p.status) : '';
  const now = new Date();
  const names = memberNames_();
  const counts = { ACTIVE: 0, USED: 0, EXPIRED: 0, CANCELLED: 0 };

  const all = readAll_(SHEET.COUPONS).filter(function (c) {
    return c.Coupon_Code && between_(c.Issued_At, per.from, per.end);
  }).map(function (c) {
    const o = publicCoupon_(c, now);
    o.memberId = String(c.Member_ID || '');
    o.memberName = names[o.memberId] || '';
    o.usedBy = String(c.Used_By || '');
    if (counts[o.status] != null) counts[o.status]++;
    return o;
  });
  const list = (status ? all.filter(function (c) { return c.status === status; }) : all)
    .sort(function (a, b) { return (b.issuedAt > a.issuedAt ? 1 : b.issuedAt < a.issuedAt ? -1 : 0); });

  const pg = page_(p.page, list.length);
  return {
    items: list.slice(pg.start, pg.start + ADMIN_PAGE_SIZE),
    counts: counts, all: all.length,
    total: list.length, page: pg.page, pages: pg.pages
  };
}

function actAdminStaff_(p, ctx) {
  const items = readAll_(SHEET.STAFF)
    .filter(function (s) { return s.LINE_User_ID; })
    .map(function (s) { return adminStaffRow_(s, ctx.user.userId); });
  // คนที่รออนุมัติขึ้นก่อน เจ้าของร้านจะได้เห็นทันที
  const order = { PENDING: 0, ACTIVE: 1, DISABLED: 2 };
  items.sort(function (a, b) { return (order[a.status] - order[b.status]) || (b.requestedAt > a.requestedAt ? 1 : -1); });
  return { items: items };
}

// อนุมัติ / ปิดสิทธิ์ / เปลี่ยนบทบาท / แก้ชื่อพนักงาน
// - แก้แถวของตัวเองไม่ได้ (กันเผลอปิดสิทธิ์ตัวเอง และกันผู้จัดการเลื่อนตัวเองเป็นเจ้าของร้าน)
// - ADMIN ดูแลได้เฉพาะแคชเชียร์ และตั้งใครเป็น ADMIN/OWNER ไม่ได้
// ตั้งค่าเป็นค่าเดิมซ้ำได้ผลเหมือนเดิม จึงไม่ต้องใช้ requestId กันส่งซ้ำ
function actAdminStaffUpdate_(p, ctx) {
  const userId = String(p.userId || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw userError_('รหัสพนักงานไม่ถูกต้อง', 'BAD_STAFF');
  if (userId === ctx.user.userId) throw userError_('แก้สิทธิ์ของตัวเองไม่ได้ ให้เจ้าของร้านคนอื่นแก้ให้', 'SELF_EDIT');
  const role = upper_(p.role);
  const status = upper_(p.status);
  if (ROLES.indexOf(role) < 0) throw userError_('บทบาทไม่ถูกต้อง', 'BAD_ROLE');
  if (STAFF_STATUSES.indexOf(status) < 0) throw userError_('สถานะไม่ถูกต้อง', 'BAD_STATUS');
  const name = cleanLineName_(p.name);
  const isOwner = ctx.staff.role === 'OWNER';

  return withLock_(function () {
    const row = findRow_(SHEET.STAFF, 'LINE_User_ID', userId);
    if (!row) throw userError_('ไม่พบพนักงานคนนี้', 'NOT_FOUND');
    const s = readRow_(SHEET.STAFF, row);
    const curRole = ROLES.indexOf(upper_(s.Role)) >= 0 ? upper_(s.Role) : 'CASHIER';
    if (!isOwner && (curRole !== 'CASHIER' || role !== 'CASHIER')) {
      throw userError_('ผู้จัดการแก้ได้เฉพาะแคชเชียร์ ถ้าต้องการเปลี่ยนบทบาทอื่น ให้เจ้าของร้านทำ', 'NO_ROLE');
    }
    const fields = { Role: role, Status: status };
    if (name) fields.Name = name;
    updateFields_(SHEET.STAFF, row, fields);
    return { staff: adminStaffRow_(readRow_(SHEET.STAFF, row), ctx.user.userId) };
  });
}

// ส่งออกเป็นไฟล์ (หน้าเว็บแปลงเป็น CSV เอง) — เฉพาะเจ้าของร้าน และบันทึกไว้ใน Log ว่าใครส่งออกเมื่อไร
function actAdminExport_(p, ctx) {
  const kind = String(p.kind || '');
  let columns, rows;
  if (kind === 'members') {
    columns = ['รหัสสมาชิก', 'ชื่อ', 'นามสกุล', 'เบอร์โทร', 'วันเกิด', 'แต้มคงเหลือ', 'ยอดซื้อรวม', 'จำนวนครั้งที่มา',
      'วันที่สมัคร', 'มาล่าสุด', 'ยินยอมรับข่าวสาร', 'สถานะ'];
    rows = readAll_(SHEET.MEMBERS).filter(function (m) { return m.Member_ID; }).map(function (m) {
      // สมาชิกที่สมัครก่อนมีช่องนามสกุล: ชื่อเต็มอยู่ในช่อง "ชื่อ" นามสกุลว่าง
      const first = String(m.First_Name || '') || String(m.Name || '');
      return [String(m.Member_ID), first, String(m.Last_Name || ''), fmtPhone_(m.Phone), String(m.Birth_Date || ''),
        toInt_(m.Points), toNum_(m.Total_Spend), toInt_(m.Visit_Count), fmtDateTimeOrBlank_(m.Joined_At),
        fmtDateTimeOrBlank_(m.Last_Visit_At), upper_(m.Marketing_Consent) === 'YES' ? 'ใช่' : 'ไม่',
        upper_(m.Status) || 'ACTIVE'];
    });
  } else if (kind === 'transactions') {
    const per = period_(p);
    const names = memberNames_();
    columns = ['รหัสรายการ', 'วันเวลา', 'รหัสสมาชิก', 'ชื่อสมาชิก', 'ประเภท', 'ยอดซื้อ', 'แต้ม', 'แต้มคงเหลือ', 'รายละเอียด', 'พนักงาน'];
    rows = txBetween_(per.from, per.end).map(function (tx) {
      return [String(tx.Tx_ID || ''), fmtDateTimeOrBlank_(tx.Date), String(tx.Member_ID || ''), names[String(tx.Member_ID)] || '',
        upper_(tx.Type), toNum_(tx.Amount), toInt_(tx.Points), toInt_(tx.Balance_After), String(tx.Detail || ''), String(tx.Staff || '')];
    });
  } else {
    throw userError_('ไม่รู้จักข้อมูลที่จะส่งออก', 'BAD_EXPORT');
  }
  console.log('ส่งออก ' + kind + ' ' + rows.length + ' แถว โดย ' + ctx.staff.name + ' (' + ctx.user.userId + ')');
  return { columns: columns, rows: rows };
}

/* =====================================================
 * 4.2) จัดการร้านจากหลังบ้าน: ของรางวัล · โปรโมชัน · ระงับสมาชิก · ตั้งค่าร้าน
 * ทุกค่าที่ส่งมาจากหน้าเว็บตรวจซ้ำที่นี่ (ชนิด ช่วงตัวเลข ความยาว ลิงก์ https)
 * ===================================================== */

// ค่าใน Settings ที่แก้จากหลังบ้านได้ — LIFF_ID / MEMBER_PREFIX / CONSENT_VERSION ไม่เปิดให้แก้
// เพราะเปลี่ยนผิดแล้วลูกค้าเข้าระบบไม่ได้ / รหัสสมาชิกปนกัน / ต้องเปลี่ยนคู่กับข้อความนโยบายใน config.js
// SHOP_NAME ก็ไม่เปิด: ชื่อที่ลูกค้าเห็นมาจาก shops/<ร้าน>/config.js แก้ที่นี่แล้วหน้าเว็บไม่เปลี่ยน จะทำให้งง
const EDITABLE_SETTINGS = {
  POINT_RATE_BAHT: { type: 'num', min: 1, max: 100000, label: 'ยอดซื้อต่อ 1 แต้ม' },
  WELCOME_POINTS: { type: 'int', min: 0, max: 100000, label: 'แต้มต้อนรับ' },
  MAX_PURCHASE: { type: 'num', min: 1, max: 10000000, label: 'ยอดซื้อสูงสุดต่อบิล' },
  CONFIRM_PURCHASE_OVER: { type: 'num', min: 1, max: 10000000, label: 'ยอดที่ต้องยืนยันซ้ำ' },
  COUPON_DAYS: { type: 'int', min: 1, max: 3650, label: 'อายุคูปอง' },
  HISTORY_LIMIT: { type: 'int', min: 10, max: 200, label: 'จำนวนประวัติที่ลูกค้าเห็น' }
};

function actAdminRewards_() {
  const now = new Date();
  const items = readAll_(SHEET.REWARDS).filter(function (r) { return r.Reward_ID; })
    .map(function (r) { return adminReward_(r, now); })
    .sort(function (a, b) { return (a.sort - b.sort) || (a.id < b.id ? -1 : 1); });
  return { items: items, couponDays: cfg_().couponDays };
}

// เพิ่มของรางวัลใหม่ (ไม่มี id) หรือแก้ของเดิม — ไม่ลบแถว เพราะคูปองที่แลกไปแล้วยังอ้างถึงอยู่ (ใช้ "ปิด" แทน)
function actAdminRewardSave_(p, ctx) {
  const r = p.reward || {};
  const id = r.id ? cleanKey_(r.id, 'รหัสรางวัล') : '';
  const fields = {
    Name: cleanText_(r.name, 80, 'ชื่อของรางวัล', true),
    Description: cleanText_(r.description, 300, 'รายละเอียด'),
    Points: intIn_(r.points, 1, 1000000, 'แต้มที่ใช้แลก'),
    Image: cleanImage_(r.image),
    Valid_Days: optInt_(r.validDays, 1, 3650, 'จำนวนวันที่ใช้ได้'),
    Quota: optInt_(r.quota, 1, 1000000, 'จำนวนทั้งหมด'),
    Limit_Per_Member: optInt_(r.limitPerMember, 1, 1000, 'จำกัดต่อคน'),
    Sort: optInt_(r.sort, 0, 9999, 'ลำดับ'),
    Status: cleanStatus_(r.status)
  };
  Object.assign(fields, cleanWindow_(r.startDate, r.endDate));

  return afterWrite_([SHEET.REWARDS], function () { return withLock_(function () {
    return once_('rewardSave', ctx.user.userId, p.requestId, function () {
      const now = new Date();
      if (id) {
        const row = findRow_(SHEET.REWARDS, 'Reward_ID', id);
        if (!row) throw userError_('ไม่พบของรางวัลนี้', 'NOT_FOUND');
        const issued = toInt_(readRow_(SHEET.REWARDS, row).Issued);
        if (fields.Quota !== '' && fields.Quota < issued) {
          throw userError_('จำนวนทั้งหมดต้องไม่น้อยกว่าที่แลกไปแล้ว (' + fmtNum_(issued) + ')', 'BAD_QUOTA');
        }
        updateFields_(SHEET.REWARDS, row, fields);
        return { reward: adminReward_(readRow_(SHEET.REWARDS, row), now) };
      }
      const obj = Object.assign({ Reward_ID: nextId_(SHEET.REWARDS, 'Reward_ID', 'R'), Issued: 0 }, fields);
      const row = appendObj_(SHEET.REWARDS, obj);
      return { reward: adminReward_(readRow_(SHEET.REWARDS, row), now), created: true };
    });
  }); });
}

function actAdminPromos_() {
  const now = new Date();
  const items = readAll_(SHEET.PROMOS).filter(function (r) { return r.Promo_ID; })
    .map(function (r) { return adminPromo_(r, now); })
    .sort(function (a, b) { return (a.sort - b.sort) || (a.id < b.id ? -1 : 1); });
  return { items: items };
}

function actAdminPromoSave_(p, ctx) {
  const r = p.promo || {};
  const id = r.id ? cleanKey_(r.id, 'รหัสโปรโมชัน') : '';
  const fields = {
    Title: cleanText_(r.title, 80, 'หัวข้อ', true),
    Subtitle: cleanText_(r.subtitle, 150, 'ข้อความรอง'),
    Tag: cleanText_(r.tag, 30, 'ป้าย'),
    Image: cleanImage_(r.image),
    Link: cleanLink_(r.link),
    Sort: optInt_(r.sort, 0, 9999, 'ลำดับ'),
    Status: cleanStatus_(r.status)
  };
  Object.assign(fields, cleanWindow_(r.startDate, r.endDate));

  return afterWrite_([SHEET.PROMOS], function () { return withLock_(function () {
    return once_('promoSave', ctx.user.userId, p.requestId, function () {
      const now = new Date();
      if (id) {
        const row = findRow_(SHEET.PROMOS, 'Promo_ID', id);
        if (!row) throw userError_('ไม่พบโปรโมชันนี้', 'NOT_FOUND');
        updateFields_(SHEET.PROMOS, row, fields);
        return { promo: adminPromo_(readRow_(SHEET.PROMOS, row), now) };
      }
      const obj = Object.assign({ Promo_ID: nextId_(SHEET.PROMOS, 'Promo_ID', 'P') }, fields);
      const row = appendObj_(SHEET.PROMOS, obj);
      return { promo: adminPromo_(readRow_(SHEET.PROMOS, row), now), created: true };
    });
  }); });
}

// ระงับ / เปิดใช้สมาชิก: ระงับแล้วสะสมแต้ม แลกรางวัล และใช้คูปองไม่ได้ (ข้อมูลและแต้มยังอยู่ครบ)
// บันทึกว่าใครทำ เมื่อไร เพราะอะไร ไว้ในช่อง Note — ตั้งค่าซ้ำได้ผลเดิม จึงไม่ต้องใช้ requestId
function actAdminMemberStatus_(p, ctx) {
  const id = cleanMemberId_(p.memberId);
  const status = upper_(p.status);
  if (status !== 'ACTIVE' && status !== 'BLOCKED') throw userError_('สถานะไม่ถูกต้อง', 'BAD_STATUS');
  const reason = cleanNote_(p.reason);
  if (status === 'BLOCKED' && reason.length < 3) throw userError_('กรุณาใส่เหตุผลที่ระงับ', 'NO_REASON');

  return withLock_(function () {
    const row = findRow_(SHEET.MEMBERS, 'Member_ID', id);
    if (!row) throw userError_('ไม่พบสมาชิก', 'NOT_FOUND');
    const note = (status === 'BLOCKED' ? 'ระงับ ' : 'เปิดใช้อีกครั้ง ') +
      Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') + ' โดย ' + ctx.staff.name + (reason ? ': ' + reason : '');
    updateFields_(SHEET.MEMBERS, row, { Status: status, Note: note.slice(0, 250) });
    return { member: adminMember_(readRow_(SHEET.MEMBERS, row), ctx.staff.role) };
  });
}

// หน้าตั้งค่าร้านในหลังบ้านอ่านจากชีตตรงๆ เสมอ (ไม่ใช้ค่าที่จำไว้) เจ้าของร้านจะเห็นค่าล่าสุดจริง
function actAdminSettings_() {
  const s = {};
  SETTINGS_SPEC.forEach(function (row) { s[row[0]] = row[1]; });
  readAll_(SHEET.SETTINGS).forEach(function (r) {
    const k = String(r.Key || '').trim();
    if (k) s[k] = String(r.Value == null ? '' : r.Value).trim();
  });
  return {
    items: SETTINGS_SPEC.map(function (spec) {
      const k = spec[0];
      return { key: k, value: String(s[k] == null ? '' : s[k]), description: spec[2], editable: !!EDITABLE_SETTINGS[k] };
    })
  };
}

// แก้ค่าในชีต Settings (เฉพาะค่าที่อนุญาต) — มีผลกับคำสั่งถัดไปทันที ไม่ต้อง Deploy ใหม่
function actAdminSettingsSave_(p, ctx) {
  const values = p.values || {};
  const keys = Object.keys(values).filter(function (k) { return Object.prototype.hasOwnProperty.call(EDITABLE_SETTINGS, k); });
  if (!keys.length) throw userError_('ไม่มีค่าที่จะบันทึก', 'BAD_INPUT');
  const clean = {};
  keys.forEach(function (k) { clean[k] = cleanSetting_(k, values[k]); });

  return afterWrite_([SHEET.SETTINGS], function () { return withLock_(function () {
    const rows = readAll_(SHEET.SETTINGS);
    const changed = [];
    keys.forEach(function (k) {
      const r = rows.filter(function (x) { return String(x.Key || '').trim() === k; })[0];
      const before = r ? String(r.Value == null ? '' : r.Value).trim() : '';
      if (before === clean[k]) return;
      if (r) updateFields_(SHEET.SETTINGS, r._row, { Value: clean[k] });
      else {
        const spec = SETTINGS_SPEC.filter(function (x) { return x[0] === k; })[0];
        appendObj_(SHEET.SETTINGS, { Key: k, Value: clean[k], 'คำอธิบาย': spec ? spec[2] : '' });
      }
      changed.push(k + ': ' + before + ' → ' + clean[k]);
    });
    settings_ = null;
    if (changed.length) console.log('แก้ตั้งค่าร้าน โดย ' + ctx.staff.name + ' — ' + changed.join(' | '));
    return { changed: changed.length, items: actAdminSettings_().items };
  }); });
}

function adminReward_(r, now) {
  const quota = toInt_(r.Quota);
  const issued = toInt_(r.Issued);
  const status = upper_(r.Status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  return {
    id: String(r.Reward_ID),
    name: String(r.Name || ''),
    description: String(r.Description || ''),
    points: toInt_(r.Points),
    image: String(r.Image || ''),
    imageUrl: safeUrl_(driveImage_(r.Image)),
    validDays: toInt_(r.Valid_Days) || '',
    quota: quota || '',
    issued: issued,
    limitPerMember: toInt_(r.Limit_Per_Member) || '',
    startDate: dayKey_(r.Start_Date),
    endDate: dayKey_(r.End_Date),
    sort: toInt_(r.Sort),
    status: status,
    // สิ่งที่ลูกค้าเห็นตอนนี้ (ตรงกับเงื่อนไขใน listRewards_)
    state: status !== 'ACTIVE' ? 'INACTIVE'
      : toInt_(r.Points) <= 0 ? 'INVALID'
      : windowState_(r.Start_Date, r.End_Date, now) || (quota > 0 && issued >= quota ? 'SOLD_OUT' : 'ACTIVE')
  };
}

function adminPromo_(r, now) {
  const status = upper_(r.Status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  return {
    id: String(r.Promo_ID),
    title: String(r.Title || ''),
    subtitle: String(r.Subtitle || ''),
    tag: String(r.Tag || ''),
    image: String(r.Image || ''),
    imageUrl: safeUrl_(driveImage_(r.Image)),
    link: String(r.Link || ''),
    startDate: dayKey_(r.Start_Date),
    endDate: dayKey_(r.End_Date),
    sort: toInt_(r.Sort),
    status: status,
    state: status !== 'ACTIVE' ? 'INACTIVE' : (windowState_(r.Start_Date, r.End_Date, now) || 'ACTIVE')
  };
}

// '' = อยู่ในช่วง / SCHEDULED = ยังไม่ถึงวันเริ่ม / ENDED = เลยวันสิ้นสุดแล้ว
function windowState_(start, end, now) {
  const s = toDate_(start);
  if (s && now.getTime() < s.getTime()) return 'SCHEDULED';
  return inWindow_(start, end, now) ? '' : 'ENDED';
}

function dayKey_(v) {
  const d = toDate_(v);
  return d ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : '';
}

// รหัสถัดไป เช่น R004 (ดูเลขมากสุดที่มีอยู่ ไม่ใช่นับแถว — กันชนเมื่อเจ้าของร้านลบแถวในชีตเอง)
function nextId_(name, header, prefix) {
  let max = 0;
  readAll_(name).forEach(function (r) {
    const m = String(r[header] || '').match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefix + ('00' + (max + 1)).slice(-Math.max(3, String(max + 1).length));
}

// ลิงก์แชร์ Google Drive เปิดแล้วเป็นหน้าเว็บ ไม่ใช่รูป → แปลงเป็นลิงก์รูปตรง
// (ไฟล์ต้องแชร์แบบ "ทุกคนที่มีลิงก์" ด้วย ไม่งั้นลูกค้าจะไม่เห็นรูป)
function driveImage_(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#\s]*&)?id=)([A-Za-z0-9_-]{20,})/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1000' : s;
}

function cleanImage_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const url = driveImage_(s);
  if (!safeUrl_(url)) throw userError_('ลิงก์รูปต้องขึ้นต้นด้วย https:// (หรือเว้นว่าง)', 'BAD_IMAGE');
  return url;
}

function cleanLink_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!safeUrl_(s)) throw userError_('ลิงก์ต้องขึ้นต้นด้วย https:// (หรือเว้นว่าง)', 'BAD_LINK');
  return s;
}

function cleanText_(v, max, label, required) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().replace(/\s+/g, ' ');
  if (required && !s) throw userError_('กรุณากรอก' + label, 'BAD_INPUT');
  if (s.length > max) throw userError_(label + 'ยาวเกิน ' + max + ' ตัวอักษร', 'BAD_INPUT');
  return s;
}

function cleanStatus_(v) {
  const s = upper_(v);
  if (s !== 'ACTIVE' && s !== 'INACTIVE') throw userError_('สถานะไม่ถูกต้อง', 'BAD_STATUS');
  return s;
}

function intIn_(v, min, max, label) {
  const raw = String(v == null ? '' : v).replace(/,/g, '').trim();
  const n = Number(raw);
  if (!raw || !isFinite(n) || Math.floor(n) !== n || n < min || n > max) {
    throw userError_(label + 'ต้องเป็นจำนวนเต็ม ' + fmtNum_(min) + '–' + fmtNum_(max), 'BAD_INPUT');
  }
  return n;
}

// ช่องที่เว้นว่างได้ (ว่าง = ไม่จำกัด / ใช้ค่าตั้งต้นของร้าน)
function optInt_(v, min, max, label) {
  return String(v == null ? '' : v).trim() === '' ? '' : intIn_(v, min, max, label);
}

function cleanWindow_(start, end) {
  const s = String(start == null ? '' : start).trim();
  const e = String(end == null ? '' : end).trim();
  const sd = s ? parseDay_(s) : '';
  const ed = e ? parseDay_(e) : '';
  if (sd === null || ed === null) throw userError_('วันที่ไม่ถูกต้อง', 'BAD_DATE');
  if (sd && ed && ed.getTime() < sd.getTime()) throw userError_('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', 'BAD_DATE');
  return { Start_Date: sd, End_Date: ed };
}

function cleanSetting_(key, v) {
  const spec = EDITABLE_SETTINGS[key];
  const raw = String(v == null ? '' : v).replace(/,/g, '').trim();
  const n = Number(raw);
  const ok = raw !== '' && isFinite(n) && n >= spec.min && n <= spec.max && (spec.type !== 'int' || Math.floor(n) === n);
  if (!ok) {
    throw userError_(spec.label + 'ต้องเป็น' + (spec.type === 'int' ? 'จำนวนเต็ม ' : 'ตัวเลข ') + fmtNum_(spec.min) + '–' + fmtNum_(spec.max), 'BAD_INPUT');
  }
  return String(Math.round(n * 100) / 100);
}

/* =====================================================
 * 4.3) อัปโหลดรูปของรางวัล / โปรโมชัน ไปเก็บใน Google Drive ของบัญชีเจ้าของ Apps Script
 * หน้าเว็บย่อรูปก่อนส่ง (กว้างไม่เกิน 1200px) — ที่นี่ตรวจซ้ำ: ชนิดไฟล์ ขนาด และหัวไฟล์ว่าเป็นรูปจริง
 * ไม่เขียนชีต จึงไม่เข้า lock (งานช้าอย่างอัปโหลดไม่ควรขวางการบันทึกแต้มของคนอื่น)
 * ===================================================== */
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function actAdminUploadImage_(p, ctx) {
  const mime = String(p.mime || '');
  const ext = Object.prototype.hasOwnProperty.call(IMAGE_TYPES, mime) ? IMAGE_TYPES[mime] : '';
  if (!ext) throw userError_('รองรับเฉพาะรูป JPG, PNG หรือ WebP', 'BAD_IMAGE');
  const data = String(p.data || '');
  if (!data || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw userError_('ไฟล์รูปใหญ่เกิน 2MB หรือไฟล์ไม่ถูกต้อง', 'BAD_IMAGE');
  }
  const bytes = Utilities.base64Decode(data);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !looksLikeImage_(bytes, mime)) {
    throw userError_('ไฟล์นี้ไม่ใช่รูปที่รองรับ', 'BAD_IMAGE');
  }
  const kind = p.kind === 'promo' ? 'promo' : 'reward';
  const name = kind + '-' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') + '-' + randomCode_(6) + '.' + ext;
  const folder = imageFolder_();

  let file;
  try {
    file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    throw userError_('บันทึกรูปลง Google Drive ไม่สำเร็จ — ตรวจว่าบัญชีเจ้าของ Apps Script เป็น "ผู้แก้ไข" โฟลเดอร์เก็บรูป', 'DRIVE_ERROR');
  }
  // ลูกค้าต้องเห็นรูปได้โดยไม่ต้องล็อกอิน Google → แชร์แบบ "ทุกคนที่มีลิงก์ ดูได้อย่างเดียว"
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // บางบัญชี Google ไม่ให้สคริปต์ตั้งแชร์ไฟล์เป็นสาธารณะเอง (เจอกับบัญชีทดสอบ 3 พ.ย. 2569)
    // ถ้าโฟลเดอร์ตั้ง "ทุกคนที่มีลิงก์" ไว้แล้ว ไฟล์ข้างในเปิดได้ตามโฟลเดอร์อยู่แล้ว → ใช้ต่อได้
    console.warn('ตั้งแชร์ไฟล์เองไม่ได้: ' + (e && e.message ? e.message : e));
    if (!isPublic_(file) && !isPublic_(folder)) {
      try { file.setTrashed(true); } catch (x) { /* ข้าม */ }
      throw userError_('ระบบตั้งแชร์รูปเองไม่ได้ — เปิดโฟลเดอร์เก็บรูปใน Google Drive กด "แชร์" แล้วตั้งเป็น "ทุกคนที่มีลิงก์ (ผู้มีสิทธิ์อ่าน)" จากนั้นอัปโหลดใหม่', 'SHARE_BLOCKED');
    }
  }
  console.log('อัปโหลดรูป ' + name + ' (' + bytes.length + ' bytes) โดย ' + ctx.staff.name);
  return { url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000' };
}

// ไฟล์/โฟลเดอร์นี้คนทั่วไปเปิดดูได้ไหม (ไฟล์ในโฟลเดอร์ที่แชร์ด้วยลิงก์ เปิดได้ตามโฟลเดอร์)
function isPublic_(item) {
  try {
    const a = item.getSharingAccess();
    return a === DriveApp.Access.ANYONE_WITH_LINK || a === DriveApp.Access.ANYONE;
  } catch (e) {
    return false;
  }
}

// ดูจากหัวไฟล์ (ไม่เชื่อชนิดไฟล์ที่หน้าเว็บบอกมา)
function looksLikeImage_(b, mime) {
  const u = function (i) { return b[i] & 255; };
  if (mime === 'image/jpeg') return u(0) === 0xFF && u(1) === 0xD8 && u(2) === 0xFF;
  if (mime === 'image/png') return u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47;
  return u(0) === 0x52 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x46 &&
    u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50;
}

// โฟลเดอร์เก็บรูป: IMAGE_FOLDER_ID ในชีต Settings (วางลิงก์โฟลเดอร์ได้)
// ว่าง = สร้างโฟลเดอร์ "LINE CRM - รูปร้าน" ให้ครั้งแรก แล้วจำรหัสไว้ใน Script Properties
function imageFolder_() {
  const raw = String(getSettings_().IMAGE_FOLDER_ID || '').trim();
  try {
    if (raw) {
      const m = raw.match(/folders\/([A-Za-z0-9_-]{10,})/) || raw.match(/^([A-Za-z0-9_-]{10,})$/);
      if (!m) throw userError_('IMAGE_FOLDER_ID ในชีต Settings ไม่ถูกต้อง — วางลิงก์โฟลเดอร์ Google Drive', 'NO_FOLDER');
      return DriveApp.getFolderById(m[1]);
    }
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty('AUTO_IMAGE_FOLDER_ID');
    if (saved) {
      try { return DriveApp.getFolderById(saved); } catch (e) { /* โฟลเดอร์ถูกลบไปแล้ว → สร้างใหม่ */ }
    }
    const folder = DriveApp.createFolder('LINE CRM - รูปร้าน');
    props.setProperty('AUTO_IMAGE_FOLDER_ID', folder.getId());
    return folder;
  } catch (e) {
    if (e && e.userMessage) throw e;
    console.error(e && e.stack ? e.stack : e);
    throw userError_('เปิดโฟลเดอร์เก็บรูปไม่ได้ — ให้เจ้าของ Apps Script กด Run testSetup (อนุญาตสิทธิ์ Google Drive) และตรวจโฟลเดอร์ใน IMAGE_FOLDER_ID', 'NO_FOLDER');
  }
}

// สมาชิกสำหรับหลังบ้าน: เจ้าของร้านเห็นเบอร์เต็ม / ผู้จัดการเห็น 4 ตัวท้าย (ลดคนที่เห็นข้อมูลส่วนตัว)
function adminMember_(m, role) {
  const o = staffMember_(m);
  o.joinedAt = iso_(m.Joined_At);
  o.picture = safeUrl_(m.Picture);
  if (role === 'OWNER') o.phone = String(m.Phone || '');
  return o;
}

function adminStaffRow_(s, myId) {
  const role = upper_(s.Role);
  return {
    userId: String(s.LINE_User_ID || ''),
    name: String(s.Name || ''),
    role: ROLES.indexOf(role) >= 0 ? role : 'CASHIER',
    status: STAFF_STATUSES.indexOf(upper_(s.Status)) >= 0 ? upper_(s.Status) : 'PENDING',
    requestedAt: iso_(s.Requested_At),
    isMe: String(s.LINE_User_ID) === myId
  };
}

function memberNames_() {
  const names = {};
  const t = table_(SHEET.MEMBERS);
  const last = t.sheet.getLastRow();
  if (last < 2) return names;
  const ids = t.sheet.getRange(2, t.col.Member_ID, last - 1, 1).getValues();
  const nm = t.sheet.getRange(2, t.col.Name, last - 1, 1).getValues();
  ids.forEach(function (r, i) { names[String(r[0])] = String(nm[i][0]); });
  return names;
}

// ช่วงวันที่จากหน้าเว็บ (yyyy-MM-dd ตามเวลาไทย) → ตรวจรูปแบบ/ความยาว แล้วคืนช่วงก่อนหน้าที่ยาวเท่ากันด้วย
function period_(p) {
  const from = parseDay_(p.from);
  const to = parseDay_(p.to);
  if (!from || !to || to.getTime() < from.getTime()) throw userError_('ช่วงวันที่ไม่ถูกต้อง', 'BAD_DATE');
  const end = new Date(to.getTime() + 86400000);
  const days = Math.round((end.getTime() - from.getTime()) / 86400000);
  if (days > MAX_RANGE_DAYS) throw userError_('เลือกช่วงได้ไม่เกิน ' + MAX_RANGE_DAYS + ' วัน', 'BAD_DATE');
  return { from: from, end: end, days: days, prevFrom: new Date(from.getTime() - days * 86400000) };
}

function parseDay_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00+07:00');
  return isNaN(d.getTime()) || Utilities.formatDate(d, TZ, 'yyyy-MM-dd') !== s ? null : d;
}

function between_(v, from, end) {
  const d = toDate_(v);
  return !!d && d.getTime() >= from.getTime() && d.getTime() < end.getTime();
}

// รายการแต้มในช่วงเวลา: อ่านคอลัมน์ Date คอลัมน์เดียวก่อน แล้วอ่านทั้งแถวเฉพาะช่วงที่ต้องใช้
// (ชีตนี้ยาวขึ้นเรื่อยๆ อ่านทั้งชีตทุกครั้งจะช้า)
function txBetween_(from, end) {
  const t = table_(SHEET.TX);
  const last = t.sheet.getLastRow();
  if (last < 2) return [];
  const dates = t.sheet.getRange(2, t.col.Date, last - 1, 1).getValues();
  let first = 0;
  let lastHit = 0;
  dates.forEach(function (r, i) {
    if (between_(r[0], from, end)) { if (!first) first = i + 2; lastHit = i + 2; }
  });
  if (!first) return [];
  const out = [];
  t.sheet.getRange(first, 1, lastHit - first + 1, t.width).getValues().forEach(function (v, i) {
    const o = rowToObj_(t, v, first + i);
    const d = toDate_(o.Date);
    if (d && d.getTime() >= from.getTime() && d.getTime() < end.getTime()) { o._date = d; out.push(o); }
  });
  return out;
}

function page_(v, total) {
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(v) || 1)));
  return { page: page, pages: pages, start: (page - 1) * ADMIN_PAGE_SIZE };
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

// เบอร์ในไฟล์ส่งออกใส่ขีด (081-234-5678) ไม่งั้น Excel มองเป็นตัวเลขแล้วตัด 0 ข้างหน้าทิ้ง
function fmtPhone_(v) {
  const s = String(v == null ? '' : v);
  return /^0\d{9}$/.test(s) ? s.slice(0, 3) + '-' + s.slice(3, 6) + '-' + s.slice(6) : s;
}

function fmtDateTimeOrBlank_(v) {
  return toDate_(v) ? fmtDateTime_(v) : '';
}


/* =====================================================
 * 5) ข้อมูลที่ส่งออกไปหน้าเว็บ (เลือกเฉพาะที่จำเป็น)
 * ===================================================== */

function findMemberByLine_(userId) {
  return findOne_(SHEET.MEMBERS, 'LINE_User_ID', userId);
}

function assertActiveMember_(m) {
  if (upper_(m.Status || 'ACTIVE') !== 'ACTIVE') {
    throw userError_('บัญชีสมาชิกนี้ถูกระงับ กรุณาติดต่อร้าน', 'MEMBER_BLOCKED');
  }
}

function publicMember_(m) {
  return {
    memberId: String(m.Member_ID || ''),
    name: String(m.Name || ''),
    phone: String(m.Phone || ''),
    birthDate: String(m.Birth_Date || ''),
    picture: safeUrl_(m.Picture),
    points: toInt_(m.Points),
    totalSpend: toNum_(m.Total_Spend),
    visitCount: toInt_(m.Visit_Count),
    tier: String(m.Tier || ''),
    joinedAt: iso_(m.Joined_At),
    status: upper_(m.Status) || 'ACTIVE'
  };
}

// พนักงานเห็นเบอร์แค่ 4 ตัวท้าย (พอให้ถามยืนยันตัวตนลูกค้าได้)
function staffMember_(m) {
  const phone = String(m.Phone || '');
  return {
    memberId: String(m.Member_ID || ''),
    name: String(m.Name || ''),
    phoneMasked: phone ? 'xxx-xxx-' + phone.slice(-4) : '',
    points: toInt_(m.Points),
    totalSpend: toNum_(m.Total_Spend),
    visitCount: toInt_(m.Visit_Count),
    tier: String(m.Tier || ''),
    status: upper_(m.Status) || 'ACTIVE',
    lastVisitAt: iso_(m.Last_Visit_At)
  };
}

function publicTx_(tx) {
  return {
    id: String(tx.Tx_ID || ''),
    date: iso_(tx.Date),
    type: upper_(tx.Type),
    amount: toNum_(tx.Amount),
    points: toInt_(tx.Points),
    balance: toInt_(tx.Balance_After),
    detail: String(tx.Detail || '')
  };
}

function couponState_(cp, now) {
  const st = upper_(cp.Status) || 'ACTIVE';
  if (st !== 'ACTIVE') return st;
  const exp = toDate_(cp.Expires_At);
  return exp && exp.getTime() < now.getTime() ? 'EXPIRED' : 'ACTIVE';
}

function publicCoupon_(cp, now) {
  return {
    code: String(cp.Coupon_Code || ''),
    rewardId: String(cp.Reward_ID || ''),
    name: String(cp.Name || ''),
    pointsUsed: toInt_(cp.Points_Used),
    issuedAt: iso_(cp.Issued_At),
    expiresAt: iso_(cp.Expires_At),
    usedAt: iso_(cp.Used_At),
    status: couponState_(cp, now)
  };
}

function listRewards_(now) {
  return cachedRows_(SHEET.REWARDS)
    .filter(function (r) {
      return r.Reward_ID && upper_(r.Status) === 'ACTIVE' && toInt_(r.Points) > 0 &&
        inWindow_(r.Start_Date, r.End_Date, now);
    })
    .map(function (r) {
      const quota = toInt_(r.Quota);
      return {
        id: String(r.Reward_ID),
        name: String(r.Name || ''),
        description: String(r.Description || ''),
        points: toInt_(r.Points),
        image: safeUrl_(driveImage_(r.Image)),
        remaining: quota > 0 ? Math.max(0, quota - toInt_(r.Issued)) : null,
        limitPerMember: toInt_(r.Limit_Per_Member) || null,
        endDate: iso_(toDate_(r.End_Date)),
        sort: toInt_(r.Sort)
      };
    })
    .sort(function (a, b) { return (a.sort - b.sort) || (a.points - b.points); });
}

function listPromos_(now) {
  return cachedRows_(SHEET.PROMOS)
    .filter(function (r) {
      return r.Promo_ID && upper_(r.Status) === 'ACTIVE' && inWindow_(r.Start_Date, r.End_Date, now);
    })
    .map(function (r) {
      return {
        id: String(r.Promo_ID),
        title: String(r.Title || ''),
        subtitle: String(r.Subtitle || ''),
        tag: String(r.Tag || ''),
        image: safeUrl_(driveImage_(r.Image)),
        link: safeUrl_(r.Link),
        sort: toInt_(r.Sort)
      };
    })
    .sort(function (a, b) { return a.sort - b.sort; });
}


/* =====================================================
 * 6) ค่าตั้งต้นของร้าน (ชีต Settings)
 * ===================================================== */

let settings_ = null;
function getSettings_() {
  if (settings_) return settings_;
  const s = {};
  SETTINGS_SPEC.forEach(function (row) { s[row[0]] = row[1]; });
  cachedRows_(SHEET.SETTINGS).forEach(function (r) {
    const k = String(r.Key || '').trim();
    if (k) s[k] = String(r.Value == null ? '' : r.Value).trim();
  });
  settings_ = s;
  return s;
}

// แปลงค่าในชีตเป็นตัวเลข/ข้อความที่ถูกต้อง — ค่าผิดรูปแบบใช้ค่าเริ่มต้นแทน (ระบบไม่ล่มเพราะพิมพ์ผิด)
function cfg_() {
  const s = getSettings_();
  const prefix = String(s.MEMBER_PREFIX || '').toUpperCase();
  return {
    shopName: s.SHOP_NAME || 'ร้านของฉัน',
    memberPrefix: /^[A-Z]{1,4}$/.test(prefix) && prefix !== 'CP' && prefix !== 'TX' ? prefix : 'M',
    pointRate: posNum_(s.POINT_RATE_BAHT, 20),
    maxPurchase: posNum_(s.MAX_PURCHASE, 20000),
    confirmOver: posNum_(s.CONFIRM_PURCHASE_OVER, 3000),
    welcomePoints: Math.max(0, Math.floor(toNum_(s.WELCOME_POINTS))),
    couponDays: Math.max(1, Math.floor(posNum_(s.COUPON_DAYS, 30))),
    consentVersion: String(s.CONSENT_VERSION || '1'),
    historyLimit: Math.min(200, Math.max(10, Math.floor(posNum_(s.HISTORY_LIMIT, 50))))
  };
}

function posNum_(v, fallback) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : fallback;
}


/* =====================================================
 * 7) อ่าน/เขียนชีต
 * ===================================================== */

let ss_ = null;
// ชีตที่ผูกกับสคริปต์ → ใช้ได้เลย / สคริปต์แบบแยก (เช่นตัวทดสอบ) → ตั้ง Script Property ชื่อ SPREADSHEET_ID
// ไม่ใส่ ID ไว้บนสุดของไฟล์ เพราะไฟล์นี้ใช้ร่วมกันทุกร้าน (วางทับแล้วค่าของร้านต้องไม่หาย)
function getSpreadsheet_() {
  if (ss_) return ss_;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  ss_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss_) throw new Error('ไม่พบ Google Sheet — ถ้าเป็น Apps Script แบบแยก ให้ตั้ง Script Property ชื่อ SPREADSHEET_ID');
  return ss_;
}

const tables_ = {};
function table_(name) {
  if (tables_[name]) return tables_[name];
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีต ' + name + ' — กรุณารัน testSetup ก่อน');
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  const col = {};
  headers.forEach(function (h, i) { if (h && !col[h]) col[h] = i + 1; });
  const late = LATE_COLUMNS[name] || [];
  COLUMNS[name].forEach(function (spec) {
    if (!col[spec[0]] && late.indexOf(spec[0]) < 0) throw new Error('ชีต ' + name + ' ไม่มีคอลัมน์ ' + spec[0] + ' — กรุณารัน testSetup');
  });
  tables_[name] = { name: name, sheet: sheet, headers: headers, col: col, width: width };
  return tables_[name];
}

// เติมหัวคอลัมน์ที่เพิ่มทีหลังต่อท้ายทางขวา (เรียกภายใน withLock_ เท่านั้น ไม่งั้นสองคำขออาจเติมซ้ำ)
function ensureColumns_(name) {
  const t = table_(name);
  const missing = COLUMNS[name].filter(function (spec) { return !t.col[spec[0]]; });
  if (!missing.length) return t;
  const start = t.width + 1;
  t.sheet.getRange(1, start, 1, missing.length).setValues([missing.map(function (spec) { return spec[0]; })]);
  missing.forEach(function (spec, i) {
    t.sheet.getRange(2, start + i, Math.max(t.sheet.getMaxRows() - 1, 1), 1).setNumberFormat(spec[1]);
  });
  delete tables_[name];
  return table_(name);
}

function rowToObj_(t, values, rowNumber) {
  const o = { _row: rowNumber };
  t.headers.forEach(function (h, i) { if (h && !(h in o)) o[h] = values[i]; });
  return o;
}

function readAll_(name) {
  const t = table_(name);
  const last = t.sheet.getLastRow();
  if (last < 2) return [];
  return t.sheet.getRange(2, 1, last - 1, t.width).getValues()
    .map(function (v, i) { return rowToObj_(t, v, i + 2); });
}

function readRow_(name, row) {
  const t = table_(name);
  return rowToObj_(t, t.sheet.getRange(row, 1, 1, t.width).getValues()[0], row);
}

// หาแถวด้วย TextFinder (ค่าตรงทั้งช่อง) — ไม่ต้องอ่านทั้งชีต จึงเร็วแม้ข้อมูลเยอะ
function findRow_(name, header, value) {
  const v = String(value == null ? '' : value);
  if (!v) return 0;
  const t = table_(name);
  const last = t.sheet.getLastRow();
  if (last < 2) return 0;
  const cell = t.sheet.getRange(2, t.col[header], last - 1, 1)
    .createTextFinder(v).matchEntireCell(true).matchCase(true).findNext();
  return cell ? cell.getRow() : 0;
}

function findOne_(name, header, value) {
  const row = findRow_(name, header, value);
  return row ? readRow_(name, row) : null;
}

// แถวที่คอลัมน์ header = value (เอาเฉพาะ limit แถวล่าสุด เรียงจากเก่าไปใหม่)
// อ่านแค่ช่วงตั้งแต่แถวที่ต้องการแถวแรกจนท้ายชีต — สมาชิกที่มาบ่อยจะอ่านแค่ส่วนท้ายชีต
// ถ้าชีต Transactions ใหญ่มาก (หลายหมื่นแถว) ให้ย้ายข้อมูลปีเก่าไปชีตเก็บถาวร
function rowsWhere_(name, header, value, limit) {
  const v = String(value == null ? '' : value);
  const t = table_(name);
  const last = t.sheet.getLastRow();
  if (!v || last < 2) return [];
  const cells = t.sheet.getRange(2, t.col[header], last - 1, 1)
    .createTextFinder(v).matchEntireCell(true).matchCase(true).findAll();
  if (!cells.length) return [];
  const rows = cells.map(function (c) { return c.getRow(); }).sort(function (a, b) { return a - b; }).slice(-limit);
  const first = rows[0];
  const block = t.sheet.getRange(first, 1, last - first + 1, t.width).getValues();
  const want = {};
  rows.forEach(function (r) { want[r] = true; });
  const out = [];
  block.forEach(function (v, i) { if (want[first + i]) out.push(rowToObj_(t, v, first + i)); });
  return out;
}

function specFormat_(name, header) {
  const spec = COLUMNS[name].filter(function (s) { return s[0] === header; })[0];
  return spec ? spec[1] : null;
}

// เพิ่มแถวใหม่: ตั้งรูปแบบเซลล์ก่อนแล้วค่อยเขียน (เรียกภายใน withLock_ เท่านั้น เพื่อไม่ให้แถวชนกัน)
function appendObj_(name, obj) {
  const t = table_(name);
  const row = t.sheet.getLastRow() + 1;
  // ชีตใหม่มี 1,000 แถว เขียนเกินขนาดชีตจะ error → เพิ่มแถวว่างเผื่อไว้ทีละ 500
  if (row > t.sheet.getMaxRows()) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), 500);
  let span = 0;
  COLUMNS[name].forEach(function (s) { if (t.col[s[0]]) span = Math.max(span, t.col[s[0]]); });
  const values = [];
  const formats = [];
  for (let c = 1; c <= span; c++) {
    const h = t.headers[c - 1];
    values.push(Object.prototype.hasOwnProperty.call(obj, h) ? cellValue_(obj[h]) : '');
    formats.push(specFormat_(name, h) || F_TEXT);
  }
  const range = t.sheet.getRange(row, 1, 1, span);
  range.setNumberFormats([formats]);
  range.setValues([values]);
  return row;
}

function updateFields_(name, row, fields) {
  const t = table_(name);
  Object.keys(fields).forEach(function (h) {
    t.sheet.getRange(row, t.col[h]).setValue(cellValue_(fields[h]));
  });
}

function appendTx_(o) {
  const id = 'TX-' + randomCode_(10);
  appendObj_(SHEET.TX, {
    Tx_ID: id,
    Date: new Date(),
    Member_ID: o.memberId,
    Type: o.type,
    Amount: o.amount || 0,
    Points: o.points || 0,
    Balance_After: o.balance,
    Detail: o.detail || '',
    Staff: o.staff || '',
    Request_ID: o.requestId || '',
    Ref: o.ref || ''
  });
  return id;
}

// ข้อความที่ขึ้นต้นด้วย = + - @ ชีตจะมองเป็นสูตร (อาจถูกใช้แอบส่งข้อมูลออก) → ใส่ ' นำหน้าให้เป็นข้อความ
function cellValue_(v) {
  if (typeof v !== 'string') return v == null ? '' : v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

// งานที่เขียนข้อมูลต้องทำทีละคำขอ กันแต้ม/โควตาชนกันเมื่อมีหลายเครื่องกดพร้อมกัน
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw userError_('ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง', 'BUSY');
  }
  try {
    return fn();
  } finally {
    // เขียนลงชีตให้เสร็จก่อนปล่อยล็อก ไม่งั้นคำขอถัดไปอาจอ่านค่าเก่า
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// กันกดซ้ำ/เน็ตหลุดแล้วส่งซ้ำ: คำขอที่มี requestId เดิมจะได้ผลเดิม ไม่ทำรายการซ้ำ
// (จำไว้ 6 ชั่วโมง + รายการแต้มเช็กซ้ำจากคอลัมน์ Request_ID ในชีตอีกชั้น)
function once_(action, userId, requestId, fn) {
  const reqId = String(requestId || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(reqId)) throw userError_('คำขอไม่ถูกต้อง กรุณาลองใหม่', 'BAD_REQUEST_ID');
  const cache = CacheService.getScriptCache();
  const key = 'rq:' + sha256Hex_(action + ':' + userId + ':' + reqId).slice(0, 40);
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const result = fn(reqId);
  try { cache.put(key, JSON.stringify(result), 21600); } catch (e) { /* ผลใหญ่เกินที่ cache รับได้ — ข้าม */ }
  return result;
}


/* =====================================================
 * 7.1) จำข้อมูลที่ไม่ค่อยเปลี่ยนไว้ชั่วคราว (ค่าร้าน ของรางวัล โปรโมชัน) — ทำให้หน้าลูกค้าเปิดเร็วขึ้น
 * อ่านชีตแต่ละครั้งใช้ ~0.2–0.3 วินาที หน้าลูกค้าเปิดทุกครั้งต้องอ่าน 3 ชีตนี้
 * แก้ผ่านหลังบ้าน หรือพิมพ์แก้ในชีตเอง (onEdit) → ล้างความจำทันที / แก้ด้วยวิธีอื่น → เห็นผลภายใน 5 นาที
 * ===================================================== */
const ROW_CACHE_TTL = 300;

function cachedRows_(name) {
  const cache = CacheService.getScriptCache();
  const key = 'rows:' + name;
  const hit = cache.get(key);
  if (hit) {
    try {
      // วันที่ถูกเก็บเป็น { $d: เวลา } → แปลงกลับเป็น Date (JSON เก็บ Date ตรงๆ ไม่ได้)
      return JSON.parse(hit).map(function (r) {
        Object.keys(r).forEach(function (k) { const v = r[k]; if (v && typeof v === 'object' && '$d' in v) r[k] = new Date(v.$d); });
        return r;
      });
    } catch (e) { /* ข้อมูลเสีย อ่านชีตใหม่ */ }
  }
  const rows = readAll_(name);
  try {
    const json = JSON.stringify(rows.map(function (r) {
      const o = {};
      Object.keys(r).forEach(function (k) { const v = r[k]; o[k] = v instanceof Date ? { $d: v.getTime() } : v; });
      return o;
    }));
    if (json.length < 90000) cache.put(key, json, ROW_CACHE_TTL); // ใหญ่เกินที่ cache รับได้ → อ่านชีตทุกครั้งแทน
  } catch (e) { /* จำไม่ได้ก็ไม่เป็นไร */ }
  return rows;
}

function invalidateRows_(names) {
  try { CacheService.getScriptCache().removeAll(names.map(function (n) { return 'rows:' + n; })); } catch (e) { /* ข้าม */ }
}

// เจ้าของร้านแก้ชีต Settings / Rewards / Promotions เอง → ล้างค่าที่จำไว้ทันที ลูกค้าเห็นผลเลย
// (onEdit ทำงานเองเมื่อมีคนพิมพ์ในชีตที่ผูกกับสคริปต์นี้ ไม่ต้องตั้งค่าอะไรเพิ่ม)
function onEdit(e) {
  const name = e && e.range ? e.range.getSheet().getName() : '';
  if (name === SHEET.SETTINGS || name === SHEET.REWARDS || name === SHEET.PROMOS) invalidateRows_([name]);
}

// กด Run เองได้ ถ้าแก้ชีตด้วยวิธีอื่น (เช่นวางข้อมูลจากที่อื่น) แล้วอยากให้ลูกค้าเห็นทันที
function clearCache() {
  invalidateRows_([SHEET.SETTINGS, SHEET.REWARDS, SHEET.PROMOS]);
  Logger.log('ล้างข้อมูลที่จำไว้แล้ว ลูกค้าจะเห็นค่าล่าสุดจากชีต');
}

// ล้างความจำ "หลัง" เขียนชีตเสร็จและปล่อยล็อกแล้ว (ถ้าล้างก่อน คำขออื่นอาจอ่านค่าเก่าแล้วจำซ้ำไปอีก 5 นาที)
function afterWrite_(names, fn) {
  try {
    return fn();
  } finally {
    invalidateRows_(names);
  }
}

/* =====================================================
 * 8) ตรวจและแปลงข้อมูล
 * ===================================================== */

function upper_(v) {
  return String(v == null ? '' : v).trim().toUpperCase();
}

function toNum_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function toInt_(v) {
  return Math.floor(toNum_(v));
}

function toDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]) + 'T00:00:00+07:00');
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y > 2400) y -= 543; // พิมพ์ปี พ.ศ. มา
    return new Date(y + '-' + pad2_(m[2]) + '-' + pad2_(m[1]) + 'T00:00:00+07:00');
  }
  return null;
}

function pad2_(n) {
  return ('0' + n).slice(-2);
}

function iso_(v) {
  const d = toDate_(v);
  return d ? d.toISOString() : '';
}

// อยู่ในช่วงวันที่ (ช่องว่าง = ไม่จำกัด / วันสิ้นสุดนับถึงสิ้นวัน)
function inWindow_(start, end, now) {
  const s = toDate_(start);
  const e = toDate_(end);
  if (s && now.getTime() < s.getTime()) return false;
  if (e && now.getTime() > e.getTime() + 86400000 - 1) return false;
  return true;
}

// อีก N วัน ถึงเวลา 23:59:59 (เวลาไทย)
function endOfDayAfter_(now, days) {
  const d = new Date(now.getTime() + days * 86400000);
  return new Date(Utilities.formatDate(d, TZ, 'yyyy-MM-dd') + 'T23:59:59+07:00');
}

function fmtNum_(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtMoney_(n) {
  const fixed = (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
  const parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

function fmtDateTime_(v) {
  const d = toDate_(v);
  return d ? Utilities.formatDate(d, TZ, 'd/M/yyyy HH:mm') : '-';
}

// ลิงก์รูป/ลิงก์โปรโมชัน: รับเฉพาะ https เพื่อกันลิงก์อันตราย (เช่น javascript:)
function safeUrl_(v) {
  const s = String(v == null ? '' : v).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 1000 ? s : '';
}

// ชื่อจาก LINE ตั้งได้อิสระ → ตัดอักขระควบคุมและ < > ทิ้ง (ไม่ปฏิเสธ เพราะลูกค้าแก้ชื่อ LINE ไม่ได้ทันที)
function cleanLineName_(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

// ชื่อ / นามสกุล แยกช่อง: ต้องมีตัวอักษร และไม่มีตัวเลข (กันพิมพ์เบอร์ผิดช่อง)
function cleanNamePart_(v, label) {
  const s = cleanLineName_(v);
  if (!s) throw userError_('กรุณากรอก' + label, 'BAD_NAME');
  if (s.length > 40) throw userError_(label + 'ยาวเกิน 40 ตัวอักษร', 'BAD_NAME');
  if (/\d/.test(s)) throw userError_(label + 'ต้องไม่มีตัวเลข', 'BAD_NAME');
  return s;
}

// เบอร์มือถือ/บ้านไทย: 0XXXXXXXX(X) — รับ +66 ได้
function normalizePhone_(v) {
  let digits = String(v == null ? '' : v).replace(/\D/g, '');
  if (digits.indexOf('66') === 0 && digits.length >= 11) digits = '0' + digits.slice(2);
  return /^0\d{8,9}$/.test(digits) ? digits : '';
}

function cleanPhone_(v) {
  const phone = normalizePhone_(v);
  if (!phone) throw userError_('กรุณากรอกเบอร์โทรให้ถูกต้อง เช่น 0812345678', 'BAD_PHONE');
  return phone;
}

function cleanBirthDate_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw userError_('วันเกิดไม่ถูกต้อง', 'BAD_BIRTHDATE');
  const d = new Date(s + 'T00:00:00+07:00');
  const age = (Date.now() - d.getTime()) / (365.25 * 86400000);
  if (isNaN(d.getTime()) || Utilities.formatDate(d, TZ, 'yyyy-MM-dd') !== s || age < 1 || age > 120) {
    throw userError_('วันเกิดไม่ถูกต้อง', 'BAD_BIRTHDATE');
  }
  return s;
}

function cleanMemberId_(v) {
  const id = String(v == null ? '' : v).trim().toUpperCase();
  if (!/^[A-Z]{1,4}-[A-Z0-9]{4,12}$/.test(id)) throw userError_('รหัสสมาชิกไม่ถูกต้อง', 'BAD_MEMBER_ID');
  return id;
}

function cleanKey_(v, label) {
  const s = String(v == null ? '' : v).trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(s)) throw userError_(label + 'ไม่ถูกต้อง', 'BAD_KEY');
  return s;
}

function cleanNote_(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 200);
}

function randomCode_(len) {
  // ใช้ UUID (สุ่มแบบปลอดภัย) เป็นแหล่งสุ่ม — 256 หารด้วย 32 ลงตัว จึงกระจายเท่ากันทุกตัวอักษร
  let hex = '';
  while (hex.length < len * 2) hex += Utilities.getUuid().replace(/-/g, '');
  let out = '';
  for (let i = 0; i < len; i++) out += ID_CHARS[parseInt(hex.substr(i * 2, 2), 16) % ID_CHARS.length];
  return out;
}

function newMemberId_(prefix) {
  for (let i = 0; i < 10; i++) {
    const id = prefix + '-' + randomCode_(6);
    if (!findRow_(SHEET.MEMBERS, 'Member_ID', id)) return id;
  }
  throw new Error('สร้างรหัสสมาชิกไม่สำเร็จ');
}

function newCouponCode_() {
  for (let i = 0; i < 10; i++) {
    const code = 'CP-' + randomCode_(8);
    if (!findRow_(SHEET.COUPONS, 'Coupon_Code', code)) return code;
  }
  throw new Error('สร้างรหัสคูปองไม่สำเร็จ');
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}


/* =====================================================
 * 9) ติดตั้ง / ทดสอบ (กด Run ในหน้า Apps Script)
 * ===================================================== */

// กด Run ครั้งแรก: ขอสิทธิ์ + สร้าง/ซ่อมชีตทั้งหมด + ใส่ข้อมูลตัวอย่าง (รันซ้ำได้ ไม่ลบข้อมูลเดิม)
function testSetup() {
  const ss = getSpreadsheet_();
  Object.keys(COLUMNS).forEach(function (name) { ensureSheet_(ss, name); });
  seedSettings_();
  seedSamples_();
  invalidateRows_([SHEET.SETTINGS, SHEET.REWARDS, SHEET.PROMOS]); // ค่าที่จำไว้อาจเป็นของเก่า
  settings_ = null;
  const c = cfg_();
  const s = getSettings_();
  Logger.log('✅ ชีตพร้อมใช้งาน: ' + ss.getUrl());
  Logger.log('ร้าน: ' + c.shopName + ' | LIFF_ID: ' + (s.LIFF_ID || '(ยังไม่ได้ใส่ — กรอกในชีต Settings)') +
    ' | โหมดทดสอบ: ' + (isTestMode_() ? 'เปิด' : 'ปิด'));
  // ครั้งแรกที่รันหลังวางโค้ดรุ่นที่มีอัปโหลดรูป Google จะขอสิทธิ์ Drive — ตรวจโฟลเดอร์ให้เห็นใน Log เลย
  try {
    const folder = imageFolder_();
    Logger.log('📁 โฟลเดอร์เก็บรูป: ' + folder.getUrl());
    if (!isPublic_(folder)) {
      Logger.log('💡 แนะนำ: ตั้งแชร์โฟลเดอร์นี้เป็น "ทุกคนที่มีลิงก์ (ผู้มีสิทธิ์อ่าน)" — บางบัญชี Google ไม่ให้สคริปต์ตั้งแชร์รูปเอง');
    }
  } catch (e) {
    Logger.log('⚠️ โฟลเดอร์เก็บรูป: ' + (e && e.userMessage ? e.userMessage : e));
  }
  // ไม่ทิ้งค่าที่จำไว้ (เจ้าของร้านมักกรอก LIFF_ID ในชีตต่อจากนี้ทันที)
  invalidateRows_([SHEET.SETTINGS, SHEET.REWARDS, SHEET.PROMOS]);
}

// เปิดโหมดทดสอบ: ใช้กับ Apps Script ตัวทดสอบของเราเท่านั้น — ห้ามรันในสคริปต์ของร้านจริง
function enableTestMode() {
  PropertiesService.getScriptProperties().setProperty('TEST_MODE', 'true');
  Logger.log('⚠️ เปิดโหมดทดสอบแล้ว: สคริปต์นี้จะรับผู้ใช้ทดสอบจากหน้าเว็บในเครื่อง');
}

function disableTestMode() {
  PropertiesService.getScriptProperties().deleteProperty('TEST_MODE');
  Logger.log('ปิดโหมดทดสอบแล้ว');
}

function ensureSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const spec = COLUMNS[name];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, spec.length).setValues([spec.map(function (s) { return s[0]; })]);
  } else {
    // ชีตเดิมจากเวอร์ชันก่อน: เติมคอลัมน์ที่ขาดต่อท้ายทางขวา (ไม่ย้าย/ลบคอลัมน์เดิม)
    const width = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
    const missing = spec.filter(function (s) { return headers.indexOf(s[0]) < 0; }).map(function (s) { return s[0]; });
    if (missing.length) sheet.getRange(1, width + 1, 1, missing.length).setValues([missing]);
  }
  sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).setFontWeight('bold');
  sheet.setFrozenRows(1);
  delete tables_[name];

  // ตั้งรูปแบบทั้งคอลัมน์ไว้ล่วงหน้า: ข้อมูลที่เจ้าของร้านพิมพ์เองในชีตก็ได้รูปแบบถูกต้องด้วย
  const t = table_(name);
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  spec.forEach(function (s) { sheet.getRange(2, t.col[s[0]], rows, 1).setNumberFormat(s[1]); });

  // ช่องที่มีค่าให้เลือก → ทำเป็น dropdown กันเจ้าของร้านพิมพ์ผิด
  const lists = {
    Members: { Status: ['ACTIVE', 'BLOCKED'] },
    Rewards: { Status: ['ACTIVE', 'INACTIVE'] },
    Promotions: { Status: ['ACTIVE', 'INACTIVE'] },
    Coupons: { Status: ['ACTIVE', 'USED', 'CANCELLED'] },
    Staff: { Role: ROLES, Status: ['PENDING', 'ACTIVE', 'DISABLED'] }
  }[name] || {};
  Object.keys(lists).forEach(function (h) {
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(lists[h], true).setAllowInvalid(false).build();
    sheet.getRange(2, t.col[h], rows, 1).setDataValidation(rule);
  });
}

function seedSettings_() {
  const existing = {};
  readAll_(SHEET.SETTINGS).forEach(function (r) { existing[String(r.Key || '').trim()] = true; });
  SETTINGS_SPEC.forEach(function (s) {
    if (!existing[s[0]]) appendObj_(SHEET.SETTINGS, { Key: s[0], Value: s[1], 'คำอธิบาย': s[2] });
  });
}

// ตัวอย่างรางวัล/โปรโมชัน (ใส่เฉพาะตอนชีตยังว่าง) — เจ้าของร้านแก้หรือลบได้เลย
function seedSamples_() {
  if (table_(SHEET.REWARDS).sheet.getLastRow() < 2) {
    [
      ['R001', 'เครื่องดื่มฟรี 1 แก้ว', 'เลือกเครื่องดื่มเย็นที่ร่วมรายการ 1 แก้ว', 80,
        'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&q=80&w=600', 1],
      ['R002', 'ขนมหวานฟรี 1 ที่', 'ขนมหวานเมนูซิกเนเจอร์ 1 ที่', 120,
        'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&q=80&w=600', 2],
      ['R003', 'ส่วนลด 100 บาท', 'ใช้เมื่อซื้อครบ 500 บาทขึ้นไป', 200, '', 3]
    ].forEach(function (r) {
      appendObj_(SHEET.REWARDS, {
        Reward_ID: r[0], Name: r[1], Description: r[2], Points: r[3], Image: r[4],
        Valid_Days: 30, Quota: '', Issued: 0, Limit_Per_Member: '', Start_Date: '', End_Date: '',
        Sort: r[5], Status: 'ACTIVE'
      });
    });
  }
  if (table_(SHEET.PROMOS).sheet.getLastRow() < 2) {
    appendObj_(SHEET.PROMOS, {
      Promo_ID: 'P001', Title: 'ตัวอย่างโปรโมชัน: แต้ม x2 ทุกวันพุธ', Subtitle: 'แก้ข้อความนี้ในชีต Promotions',
      Tag: 'โปรประจำเดือน', Image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&q=80&w=900',
      Link: '', Start_Date: '', End_Date: '', Sort: 1, Status: 'ACTIVE'
    });
  }
}
