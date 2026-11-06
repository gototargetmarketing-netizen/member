// ย้ายข้อมูลจากชีตของร้าน (ระบบเดิม) → ตารางในฐานข้อมูล ของร้านหนึ่งร้าน
//
// ตอนนี้ใช้ในชุดทดสอบเทียบคู่ (api-diff-test.js): ตั้งต้นให้สองระบบมีข้อมูลเหมือนกันทุกตัว
// ขั้น 6 (ย้ายร้านคำหวาน) จะใช้ตัวนี้เป็นฐานของเครื่องมือย้ายจริง — รับชีตแบบตาราง 2 มิติ (แถวแรก = หัวตาราง)
// เหมือนที่ได้จากการส่งออกชีตจริง
//
// หลัก: แปลงค่าแบบเดียวกับที่ code.gs อ่าน (ค่าผิดรูปแบบ → ค่าเริ่มต้น) ระบบใหม่จึงทำงานเหมือนเดิมกับข้อมูลชุดเดิม
const U = require('../../api/_lib/util');

const rowsOf = (data) => {
  if (!data || !data.length) return [];
  const h = data[0].map((x) => String(x).trim());
  return data.slice(1)
    .filter((r) => r && r.some((v) => v !== '' && v != null))
    .map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined || r[i] === null ? '' : r[i]])));
};
const str = (v) => String(v == null ? '' : v).trim();
const posInt = (v) => { const n = U.toInt(v); return n > 0 ? n : null; };

// วันที่ในชีต: Date / yyyy-MM-dd / d/M/yyyy (ปี พ.ศ. ก็ได้) — เหมือน toDate_ ใน code.gs
function sheetDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = str(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00+07:00`);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y > 2400) y -= 543;
    return new Date(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00+07:00`);
  }
  return s ? U.toDate(s) : null;
}
const sheetDay = (v) => { const d = sheetDate(v); return d ? U.thaiDay(d) : null; };

// ค่าร้านแบบเดียวกับ cfg_() — ค่าในชีตที่ผิดรูปแบบใช้ค่าเริ่มต้น (ระบบเดิมก็ทำแบบนี้ตอนอ่าน)
function shopRow(shopId, settings) {
  const s = {};
  rowsOf(settings).forEach((r) => { const k = str(r.Key); if (k) s[k] = str(r.Value); });
  const pos = (v, d, max) => { const n = Number(v); return isFinite(n) && n > 0 && n <= max ? n : d; };
  const prefix = str(s.MEMBER_PREFIX).toUpperCase();
  return {
    id: shopId,
    name: str(s.SHOP_NAME).slice(0, 60),
    liff_id: /^\d+-[A-Za-z0-9]+$/.test(str(s.LIFF_ID)) ? str(s.LIFF_ID) : '',
    member_prefix: /^[A-Z]{1,4}$/.test(prefix) && prefix !== 'CP' && prefix !== 'TX' ? prefix : 'M',
    point_rate_baht: pos(s.POINT_RATE_BAHT, 20, 100000),
    welcome_points: Math.min(100000, Math.max(0, Math.floor(U.toNum(s.WELCOME_POINTS)))),
    max_purchase: pos(s.MAX_PURCHASE, 20000, 10000000),
    confirm_purchase_over: pos(s.CONFIRM_PURCHASE_OVER, 3000, 10000000),
    coupon_days: Math.min(3650, Math.max(1, Math.floor(pos(s.COUPON_DAYS, 30, 3650)))),
    history_limit: Math.min(200, Math.max(10, Math.floor(pos(s.HISTORY_LIMIT, 50, 1000)))),
    consent_version: Math.max(1, parseInt(s.CONSENT_VERSION, 10) || 1),
    brand: {
      logo: s.LOGO_URL || '', theme: s.THEME || '',
      colors: { primary: s.COLOR_PRIMARY || '', button: s.COLOR_BUTTON || '', accent: s.COLOR_ACCENT || '', card: s.COLOR_CARD || '' },
      texts: { pointUnit: s.TEXT_POINT_UNIT || '', greeting: s.TEXT_GREETING || '', registerTitle: s.TEXT_REGISTER_TITLE || '', registerSubtitle: s.TEXT_REGISTER_SUBTITLE || '' },
      privacyText: s.PRIVACY_TEXT || ''
    }
  };
}

async function insert(db, table, row) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => (c === 'brand' || c === 'result' ? JSON.stringify(row[c]) : row[c]));
  const ph = cols.map((c, i) => '$' + (i + 1) + (c === 'brand' ? '::text::jsonb' : ''));
  await db.query(`insert into ${table} (${cols.join(', ')}) values (${ph.join(', ')})`, vals);
}

// sheets = { Settings: [[หัวตาราง], [แถว]...], Rewards: ..., ... } — ชีตไหนไม่มีก็ข้าม
async function importShop(db, shopId, sheets) {
  await insert(db, 'shops', shopRow(shopId, sheets.Settings));

  for (const r of rowsOf(sheets.Branches)) {
    if (!str(r.Branch_ID)) continue;
    await insert(db, 'branches', { shop_id: shopId, id: str(r.Branch_ID).toUpperCase(), name: str(r.Name) || str(r.Branch_ID),
      status: U.upper(r.Status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE', sort: U.toInt(r.Sort), created_at: sheetDate(r.Created_At) || new Date() });
  }
  const rewardType = {};
  for (const r of rowsOf(sheets.Rewards)) {
    if (!str(r.Reward_ID)) continue;
    const type = U.upper(r.Type) === 'BIRTHDAY' ? 'BIRTHDAY' : '';
    rewardType[str(r.Reward_ID)] = type;
    const start = sheetDay(r.Start_Date);
    let end = sheetDay(r.End_Date);
    if (start && end && end < start) end = start;
    await insert(db, 'rewards', { shop_id: shopId, id: str(r.Reward_ID), name: str(r.Name).slice(0, 80) || str(r.Reward_ID),
      description: str(r.Description).slice(0, 300), type, points: Math.min(1000000, Math.max(0, U.toInt(r.Points))), image: str(r.Image),
      valid_days: posInt(r.Valid_Days), quota: posInt(r.Quota), issued: Math.max(0, U.toInt(r.Issued)), limit_per_member: posInt(r.Limit_Per_Member),
      start_date: start, end_date: end, sort: U.toInt(r.Sort), status: U.upper(r.Status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' });
  }
  for (const r of rowsOf(sheets.Promotions)) {
    if (!str(r.Promo_ID)) continue;
    await insert(db, 'promotions', { shop_id: shopId, id: str(r.Promo_ID), title: str(r.Title).slice(0, 80) || str(r.Promo_ID),
      subtitle: str(r.Subtitle).slice(0, 150), tag: str(r.Tag).slice(0, 30), image: str(r.Image), link: U.safeUrl(r.Link),
      start_date: sheetDay(r.Start_Date), end_date: sheetDay(r.End_Date), sort: U.toInt(r.Sort),
      status: U.upper(r.Status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' });
  }
  for (const r of rowsOf(sheets.Point_Rules)) {
    const mult = Number(r.Multiplier);
    if (!str(r.Rule_ID) || [1.5, 2, 3].indexOf(mult) < 0) continue; // ×1 ในชีต = ไม่มีผลอยู่แล้ว
    const days = U.upper(r.Days).split(/[,\s]+/).filter((d) => U.DAY_CODES.indexOf(d) >= 0);
    await insert(db, 'point_rules', { shop_id: shopId, id: str(r.Rule_ID), name: str(r.Name).slice(0, 60) || str(r.Rule_ID), multiplier: mult,
      days: days.length ? days : U.DAY_CODES.slice(), start_date: sheetDay(r.Start_Date), end_date: sheetDay(r.End_Date),
      branch: U.upper(r.Branch), min_amount: U.toNum(r.Min_Amount) > 0 ? U.toNum(r.Min_Amount) : null, show_badge: U.upper(r.Show_Badge) === 'YES',
      status: U.upper(r.Status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE', created_at: sheetDate(r.Created_At) || new Date() });
  }
  for (const r of rowsOf(sheets.Staff)) {
    if (!str(r.LINE_User_ID)) continue;
    const br = U.upper(r.Branches);
    await insert(db, 'staff', { shop_id: shopId, line_user_id: str(r.LINE_User_ID), name: str(r.Name),
      role: ['OWNER', 'ADMIN', 'CASHIER'].indexOf(U.upper(r.Role)) >= 0 ? U.upper(r.Role) : 'CASHIER',
      status: ['PENDING', 'ACTIVE', 'DISABLED'].indexOf(U.upper(r.Status)) >= 0 ? U.upper(r.Status) : 'PENDING',
      branches: !br || br === 'ALL' ? null : br.split(/[,\s]+/).filter(Boolean), requested_at: sheetDate(r.Requested_At) || new Date(), note: str(r.Note) });
  }
  for (const r of rowsOf(sheets.Members)) {
    if (!str(r.Member_ID)) continue;
    await insert(db, 'members', { shop_id: shopId, id: str(r.Member_ID).toUpperCase(), line_user_id: str(r.LINE_User_ID) || null,
      name: str(r.Name), first_name: str(r.First_Name), last_name: str(r.Last_Name), phone: str(r.Phone),
      birth_date: /^\d{4}-\d{2}-\d{2}$/.test(str(r.Birth_Date)) ? str(r.Birth_Date) : sheetDay(r.Birth_Date),
      birth_date_edits: Math.max(0, U.toInt(r.Birth_Date_Edits)), picture: str(r.Picture), points: Math.max(0, U.toInt(r.Points)),
      total_spend: Math.max(0, U.toNum(r.Total_Spend)), visit_count: Math.max(0, U.toInt(r.Visit_Count)),
      joined_at: sheetDate(r.Joined_At) || new Date(), joined_branch: U.upper(r.Joined_Branch), last_visit_at: sheetDate(r.Last_Visit_At),
      consent_version: parseInt(r.Consent_Version, 10) || null, consent_at: sheetDate(r.Consent_At),
      marketing_consent: U.upper(r.Marketing_Consent) === 'YES', status: U.upper(r.Status) === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE', note: str(r.Note) });
  }
  for (const r of rowsOf(sheets.Transactions)) {
    if (!str(r.Tx_ID)) continue;
    await insert(db, 'transactions', { shop_id: shopId, id: str(r.Tx_ID), created_at: sheetDate(r.Date) || new Date(),
      member_id: str(r.Member_ID).toUpperCase(), type: U.upper(r.Type), amount: Math.max(0, U.toNum(r.Amount)), points: U.toInt(r.Points),
      balance_after: Math.max(0, U.toInt(r.Balance_After)), detail: str(r.Detail), staff: str(r.Staff),
      request_id: /^[A-Za-z0-9-]{8,64}$/.test(str(r.Request_ID)) ? str(r.Request_ID) : null, ref: str(r.Ref), branch: U.upper(r.Branch) });
  }
  const birthdayTaken = new Set();
  for (const r of rowsOf(sheets.Coupons)) {
    if (!str(r.Coupon_Code)) continue;
    const issued = sheetDate(r.Issued_At) || new Date();
    const status = ['ACTIVE', 'USED', 'CANCELLED'].indexOf(U.upper(r.Status)) >= 0 ? U.upper(r.Status) : 'ACTIVE';
    // คูปองวันเกิด: จดปีไว้ (ฐานข้อมูลกันรับซ้ำปีเดียวกัน) — คูปองที่ยกเลิกไม่นับ
    let year = null;
    const key = str(r.Member_ID) + ':' + U.thaiDay(issued).slice(0, 4);
    if (rewardType[str(r.Reward_ID)] === 'BIRTHDAY' && status !== 'CANCELLED' && !birthdayTaken.has(key)) {
      year = Number(U.thaiDay(issued).slice(0, 4));
      birthdayTaken.add(key);
    }
    await insert(db, 'coupons', { shop_id: shopId, code: str(r.Coupon_Code), member_id: str(r.Member_ID).toUpperCase(), reward_id: str(r.Reward_ID),
      name: str(r.Name), points_used: Math.max(0, U.toInt(r.Points_Used)), issued_at: issued, expires_at: sheetDate(r.Expires_At),
      used_at: sheetDate(r.Used_At), used_by: str(r.Used_By), used_branch: U.upper(r.Used_Branch), status, tx_id: str(r.Tx_ID) || null, birthday_year: year });
  }
  for (const r of rowsOf(sheets.Profile_Log)) {
    if (!str(r.Member_ID)) continue;
    await insert(db, 'profile_log', { shop_id: shopId, created_at: sheetDate(r.Date) || new Date(), member_id: str(r.Member_ID).toUpperCase(),
      changed: str(r.Changed), by_name: str(r.By) });
  }
}

module.exports = { importShop, shopRow, sheetDate, rowsOf };
