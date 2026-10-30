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

const APP_VERSION = '2.0.0';
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
    ['Status', F_TEXT], ['Note', F_TEXT]
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
  ['HISTORY_LIMIT', '50', 'จำนวนรายการประวัติล่าสุดที่ลูกค้าเห็น']
];

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
  staffRecent: { roles: ALL_STAFF, run: actStaffRecent_ }
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
function isTestMode_() {
  return PropertiesService.getScriptProperties().getProperty('TEST_MODE') === 'true';
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

  const channelId = String(getSettings_().LIFF_ID || '').split('-')[0];
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
  const name = cleanPersonName_(p.name || ctx.user.name);
  const phone = cleanPhone_(p.phone);
  const birthDate = cleanBirthDate_(p.birthDate);
  const c = cfg_();

  return withLock_(function () {
    const existing = findMemberByLine_(ctx.user.userId);
    if (existing) return { member: publicMember_(existing), already: true };

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
      Note: ''
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
  return readAll_(SHEET.REWARDS)
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
        image: safeUrl_(r.Image),
        remaining: quota > 0 ? Math.max(0, quota - toInt_(r.Issued)) : null,
        limitPerMember: toInt_(r.Limit_Per_Member) || null,
        endDate: iso_(toDate_(r.End_Date)),
        sort: toInt_(r.Sort)
      };
    })
    .sort(function (a, b) { return (a.sort - b.sort) || (a.points - b.points); });
}

function listPromos_(now) {
  return readAll_(SHEET.PROMOS)
    .filter(function (r) {
      return r.Promo_ID && upper_(r.Status) === 'ACTIVE' && inWindow_(r.Start_Date, r.End_Date, now);
    })
    .map(function (r) {
      return {
        id: String(r.Promo_ID),
        title: String(r.Title || ''),
        subtitle: String(r.Subtitle || ''),
        tag: String(r.Tag || ''),
        image: safeUrl_(r.Image),
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
  readAll_(SHEET.SETTINGS).forEach(function (r) {
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
  COLUMNS[name].forEach(function (spec) {
    if (!col[spec[0]]) throw new Error('ชีต ' + name + ' ไม่มีคอลัมน์ ' + spec[0] + ' — กรุณารัน testSetup');
  });
  tables_[name] = { name: name, sheet: sheet, headers: headers, col: col, width: width };
  return tables_[name];
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
  COLUMNS[name].forEach(function (s) { span = Math.max(span, t.col[s[0]]); });
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

function cleanPersonName_(v) {
  const name = cleanLineName_(v);
  if (!name) throw userError_('กรุณากรอกชื่อ', 'BAD_NAME');
  return name;
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
  settings_ = null;
  const c = cfg_();
  const s = getSettings_();
  Logger.log('✅ ชีตพร้อมใช้งาน: ' + ss.getUrl());
  Logger.log('ร้าน: ' + c.shopName + ' | LIFF_ID: ' + (s.LIFF_ID || '(ยังไม่ได้ใส่ — กรอกในชีต Settings)') +
    ' | โหมดทดสอบ: ' + (isTestMode_() ? 'เปิด' : 'ปิด'));
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
