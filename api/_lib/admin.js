// คำสั่งของหลังบ้าน (เดิม: ส่วนที่ 4.1–4.6 ของ code.gs) — เจ้าของร้าน / ผู้จัดการ (ตรวจบทบาทใน router ทุกคำสั่ง)
// กติกาและข้อความเหมือนของเดิม — api-diff-test.js เทียบให้
//
// ต่างจากเดิมเรื่องเดียว: ระบบเดิมอ่านทุกแถวในชีตมานับเอง ที่นี่ให้ฐานข้อมูลนับ/กรอง/เรียง/แบ่งหน้าให้
// (ข้อมูลหลายหมื่นรายการต่อปี ถ้าดึงมานับเองจะช้าและเปลือง) — ผลต้องเหมือนเดิมทุกตัว
const { userError } = require('./errors');
const U = require('./util');
const { SHOP_SQL, cfg, publicBrand, LEGACY_SHOP_NAME, THEMES } = require('./shop');
const { once } = require('./once');
const V = require('./views');
const M = require('./members');
const S = require('./staff');

const PAGE_SIZE = 50;
const MAX_RANGE_DAYS = 366;
const MAX_BRANCHES = 50;
const TX_TYPES = ['EARN', 'WELCOME', 'REDEEM', 'ADJUST'];
const STAFF_STATUSES = ['PENDING', 'ACTIVE', 'DISABLED'];
const MULTIPLIERS = [1.5, 2, 3];

// ---------- ตรวจค่าที่ส่งมา (เหมือน code.gs) ----------
function intIn(v, min, max, label) {
  const raw = String(v == null ? '' : v).replace(/,/g, '').trim();
  const n = Number(raw);
  if (!raw || !isFinite(n) || Math.floor(n) !== n || n < min || n > max) {
    throw userError(label + 'ต้องเป็นจำนวนเต็ม ' + U.fmtNum(min) + '–' + U.fmtNum(max), 'BAD_INPUT');
  }
  return n;
}
// ช่องที่เว้นว่างได้ → null (ว่าง = ไม่จำกัด / ใช้ค่าตั้งต้นของร้าน)
const optInt = (v, min, max, label) => (String(v == null ? '' : v).trim() === '' ? null : intIn(v, min, max, label));

function cleanStatus(v) {
  const s = U.upper(v);
  if (s !== 'ACTIVE' && s !== 'INACTIVE') throw userError('สถานะไม่ถูกต้อง', 'BAD_STATUS');
  return s;
}

function cleanImage(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const url = U.driveImage(s);
  if (!U.safeUrl(url)) throw userError('ลิงก์รูปต้องขึ้นต้นด้วย https:// (หรือเว้นว่าง)', 'BAD_IMAGE');
  return url;
}

function cleanLink(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!U.safeUrl(s)) throw userError('ลิงก์ต้องขึ้นต้นด้วย https:// (หรือเว้นว่าง)', 'BAD_LINK');
  return s;
}

// วันที่ yyyy-MM-dd ที่มีอยู่จริง → Date (เที่ยงคืนเวลาไทย) / null = ผิดรูปแบบ
function parseDay(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00+07:00');
  return isNaN(d.getTime()) || U.thaiDay(d) !== s ? null : d;
}

// ช่วงวันเริ่ม-สิ้นสุด (ว่างได้) → { start_date, end_date } เป็น yyyy-MM-dd หรือ null
function cleanWindow(start, end) {
  const s = String(start == null ? '' : start).trim();
  const e = String(end == null ? '' : end).trim();
  const sd = s ? parseDay(s) : '';
  const ed = e ? parseDay(e) : '';
  if (sd === null || ed === null) throw userError('วันที่ไม่ถูกต้อง', 'BAD_DATE');
  if (sd && ed && ed.getTime() < sd.getTime()) throw userError('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม', 'BAD_DATE');
  return { start_date: s || null, end_date: e || null };
}

// '' = อยู่ในช่วง / SCHEDULED = ยังไม่ถึงวันเริ่ม / ENDED = เลยวันสิ้นสุดแล้ว
function windowState(start, end, now) {
  const s = U.toDate(start);
  if (s && now.getTime() < s.getTime()) return 'SCHEDULED';
  return U.inWindow(start, end, now) ? '' : 'ENDED';
}

// ช่วงวันที่จากหน้าเว็บ (yyyy-MM-dd เวลาไทย) + ช่วงก่อนหน้าที่ยาวเท่ากัน (ไว้เทียบ)
function period(p) {
  const from = parseDay(p.from);
  const to = parseDay(p.to);
  if (!from || !to || to.getTime() < from.getTime()) throw userError('ช่วงวันที่ไม่ถูกต้อง', 'BAD_DATE');
  const end = new Date(to.getTime() + U.DAY_MS);
  const days = Math.round((end.getTime() - from.getTime()) / U.DAY_MS);
  if (days > MAX_RANGE_DAYS) throw userError('เลือกช่วงได้ไม่เกิน ' + MAX_RANGE_DAYS + ' วัน', 'BAD_DATE');
  return { from, end, days, prevFrom: new Date(from.getTime() - days * U.DAY_MS) };
}

// ตัวกรองสาขาในหลังบ้าน: '' = ทุกสาขา / รหัสที่รูปแบบถูก (ไม่มีจริงก็แค่ไม่เจอข้อมูล)
function branchFilter(v) {
  const id = U.upper(v);
  if (!id) return '';
  if (!/^[A-Z0-9]{1,12}$/.test(id)) throw userError('สาขาไม่ถูกต้อง', 'BAD_BRANCH');
  return id;
}

function page(v, total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pg = Math.min(pages, Math.max(1, Math.floor(Number(v) || 1)));
  return { page: pg, pages, start: (pg - 1) * PAGE_SIZE };
}

// รหัสถัดไป เช่น R004 (เลขมากสุดที่มีอยู่ + 1)
async function nextId(q, table, shopId, prefix) {
  const r = await q.query(`select id from ${table} where shop_id = $1`, [shopId]);
  let max = 0;
  const re = new RegExp('^' + prefix + '(\\d+)$');
  r.rows.forEach((x) => { const m = String(x.id).match(re); if (m) max = Math.max(max, Number(m[1])); });
  return prefix + ('00' + (max + 1)).slice(-Math.max(3, String(max + 1).length));
}

// สมาชิกสำหรับหลังบ้าน: เจ้าของร้านเห็นเบอร์เต็ม / ผู้จัดการเห็น 4 ตัวท้าย
function adminMember(m, role) {
  const o = V.staffMember(m);
  o.joinedAt = U.iso(m.joined_at);
  o.picture = U.safeUrl(m.picture);
  o.joinedBranch = U.upper(m.joined_branch);
  if (role === 'OWNER') o.phone = String(m.phone || '');
  return o;
}

const fmtPhone = (v) => { const s = String(v == null ? '' : v); return /^0\d{9}$/.test(s) ? s.slice(0, 3) + '-' + s.slice(3, 6) + '-' + s.slice(6) : s; };
const fmtDateTimeOrBlank = (v) => (U.toDate(v) ? U.fmtDateTime(v) : '');

// ---------- ค่าร้าน (เดิม: ชีต Settings) ----------
// ช่อง IMAGE_FOLDER_ID ของระบบเดิมไม่มีแล้ว (รูปย้ายไปที่เก็บรูปของ Supabase)
const SETTINGS_SPEC = [
  ['SHOP_NAME', 'ชื่อร้านที่ลูกค้าเห็น (ว่าง = ใช้ชื่อในไฟล์ตั้งค่าของร้าน) — แก้ในหลังบ้าน เมนูหน้าตาร้าน'],
  ['LIFF_ID', 'LIFF ID ของร้าน เช่น 1234567890-AbCdEfGh (ใช้ตรวจการเข้าสู่ระบบ LINE)'],
  ['MEMBER_PREFIX', 'ตัวอักษรนำหน้ารหัสสมาชิก ภาษาอังกฤษ 1–4 ตัว เช่น KW (ห้ามใช้ CP กับ TX)'],
  ['POINT_RATE_BAHT', 'ยอดซื้อกี่บาทได้ 1 แต้ม'],
  ['MAX_PURCHASE', 'ยอดซื้อสูงสุดต่อบิลที่พนักงานบันทึกได้ (กันพิมพ์เลขผิด)'],
  ['CONFIRM_PURCHASE_OVER', 'ยอดซื้อตั้งแต่เท่านี้ หน้าพนักงานจะให้ยืนยันซ้ำ'],
  ['WELCOME_POINTS', 'แต้มต้อนรับเมื่อสมัครสมาชิก (0 = ไม่ให้)'],
  ['COUPON_DAYS', 'คูปองที่แลกแล้วใช้ได้กี่วัน (ใช้เมื่อรางวัลไม่ได้กำหนด Valid_Days)'],
  ['CONSENT_VERSION', 'เวอร์ชันนโยบายความเป็นส่วนตัว เปลี่ยนเลขเมื่อแก้นโยบาย'],
  ['HISTORY_LIMIT', 'จำนวนรายการประวัติล่าสุดที่ลูกค้าเห็น'],
  ['LOGO_URL', 'ลิงก์รูปโลโก้ (สี่เหลี่ยมจัตุรัส)'],
  ['THEME', 'สไตล์: luxury = หรู โทนเข้ม / minimal = เรียบ สว่าง'],
  ['COLOR_PRIMARY', 'สีหลัก (แถบหัวหน้าเว็บ) รูปแบบ #RRGGBB'],
  ['COLOR_BUTTON', 'สีปุ่ม รูปแบบ #RRGGBB'],
  ['COLOR_ACCENT', 'สีเน้น (ป้าย ตัวเลขแต้ม) รูปแบบ #RRGGBB'],
  ['COLOR_CARD', 'สีบัตรสมาชิก รูปแบบ #RRGGBB'],
  ['TEXT_POINT_UNIT', 'คำเรียกแต้ม เช่น แต้ม / พอยท์ / ดาว'],
  ['TEXT_GREETING', 'ข้อความทักทายหน้าแรก'],
  ['TEXT_REGISTER_TITLE', 'หัวข้อหน้าสมัครสมาชิก'],
  ['TEXT_REGISTER_SUBTITLE', 'คำอธิบายใต้หัวข้อหน้าสมัครสมาชิก'],
  ['PRIVACY_TEXT', 'นโยบายความเป็นส่วนตัว (แก้แล้ว CONSENT_VERSION เพิ่มให้เองเมื่อแก้ผ่านหลังบ้าน)']
];

// ค่าที่แก้จากหลังบ้านได้ → คอลัมน์ในตาราง shops (LIFF_ID / MEMBER_PREFIX / CONSENT_VERSION ไม่เปิดให้แก้)
const EDITABLE_SETTINGS = {
  POINT_RATE_BAHT: { type: 'num', min: 1, max: 100000, label: 'ยอดซื้อต่อ 1 แต้ม', col: 'point_rate_baht' },
  WELCOME_POINTS: { type: 'int', min: 0, max: 100000, label: 'แต้มต้อนรับ', col: 'welcome_points' },
  MAX_PURCHASE: { type: 'num', min: 1, max: 10000000, label: 'ยอดซื้อสูงสุดต่อบิล', col: 'max_purchase' },
  CONFIRM_PURCHASE_OVER: { type: 'num', min: 1, max: 10000000, label: 'ยอดที่ต้องยืนยันซ้ำ', col: 'confirm_purchase_over' },
  COUPON_DAYS: { type: 'int', min: 1, max: 3650, label: 'อายุคูปอง', col: 'coupon_days' },
  HISTORY_LIMIT: { type: 'int', min: 10, max: 200, label: 'จำนวนประวัติที่ลูกค้าเห็น', col: 'history_limit' }
};

// หน้าตาร้าน → ช่องใน shops.brand (jsonb) / SHOP_NAME = shops.name
const BRAND_SETTINGS = {
  SHOP_NAME: { type: 'text', max: 60, label: 'ชื่อร้าน' },
  LOGO_URL: { type: 'image', label: 'โลโก้', path: ['logo'] },
  THEME: { type: 'choice', options: THEMES, label: 'สไตล์', path: ['theme'] },
  COLOR_PRIMARY: { type: 'color', label: 'สีหลัก', path: ['colors', 'primary'] },
  COLOR_BUTTON: { type: 'color', label: 'สีปุ่ม', path: ['colors', 'button'] },
  COLOR_ACCENT: { type: 'color', label: 'สีเน้น', path: ['colors', 'accent'] },
  COLOR_CARD: { type: 'color', label: 'สีบัตรสมาชิก', path: ['colors', 'card'] },
  TEXT_POINT_UNIT: { type: 'text', max: 20, label: 'คำเรียกแต้ม', path: ['texts', 'pointUnit'] },
  TEXT_GREETING: { type: 'text', max: 60, label: 'ข้อความทักทาย', path: ['texts', 'greeting'] },
  TEXT_REGISTER_TITLE: { type: 'text', max: 80, label: 'หัวข้อหน้าสมัคร', path: ['texts', 'registerTitle'] },
  TEXT_REGISTER_SUBTITLE: { type: 'text', max: 150, label: 'คำอธิบายหน้าสมัคร', path: ['texts', 'registerSubtitle'] },
  PRIVACY_TEXT: { type: 'longtext', max: 3000, label: 'นโยบายความเป็นส่วนตัว', path: ['privacyText'] }
};

const numStr = (v) => (v == null || v === '' ? '' : String(Number(v)));
const brandGet = (brand, path) => { let o = brand || {}; for (const k of path) o = o && typeof o === 'object' ? o[k] : undefined; return o == null ? '' : String(o); };

// ค่าร้านทุกช่องเป็นข้อความ (รูปเดียวกับที่ระบบเดิมอ่านจากชีต)
function settingValues(shop) {
  const s = {
    SHOP_NAME: String(shop.name || ''), LIFF_ID: String(shop.liff_id || ''), MEMBER_PREFIX: String(shop.member_prefix || ''),
    POINT_RATE_BAHT: numStr(shop.point_rate_baht), MAX_PURCHASE: numStr(shop.max_purchase), CONFIRM_PURCHASE_OVER: numStr(shop.confirm_purchase_over),
    WELCOME_POINTS: numStr(shop.welcome_points), COUPON_DAYS: numStr(shop.coupon_days), CONSENT_VERSION: numStr(shop.consent_version),
    HISTORY_LIMIT: numStr(shop.history_limit)
  };
  Object.keys(BRAND_SETTINGS).forEach((k) => { if (BRAND_SETTINGS[k].path) s[k] = brandGet(shop.brand, BRAND_SETTINGS[k].path); });
  return s;
}

const settingItems = (shop) => {
  const s = settingValues(shop);
  return SETTINGS_SPEC.map(([key, description]) => ({ key, value: s[key], description, editable: !!EDITABLE_SETTINGS[key] }));
};

function cleanSetting(key, v) {
  const spec = EDITABLE_SETTINGS[key];
  const raw = String(v == null ? '' : v).replace(/,/g, '').trim();
  const n = Number(raw);
  const ok = raw !== '' && isFinite(n) && n >= spec.min && n <= spec.max && (spec.type !== 'int' || Math.floor(n) === n);
  if (!ok) throw userError(spec.label + 'ต้องเป็น' + (spec.type === 'int' ? 'จำนวนเต็ม ' : 'ตัวเลข ') + U.fmtNum(spec.min) + '–' + U.fmtNum(spec.max), 'BAD_INPUT');
  return String(Math.round(n * 100) / 100);
}

function cleanBrand(key, v) {
  const spec = BRAND_SETTINGS[key];
  const s = String(v == null ? '' : v).trim();
  if (spec.type === 'text') return U.cleanText(s, spec.max, spec.label);
  if (spec.type === 'image') return cleanImage(s);
  if (spec.type === 'longtext') {
    const t = U.cleanLongText(s, Infinity);
    if (t.length > spec.max) throw userError(spec.label + 'ยาวเกิน ' + U.fmtNum(spec.max) + ' ตัวอักษร', 'BAD_INPUT');
    return t;
  }
  if (spec.type === 'choice') {
    if (s && spec.options.indexOf(s) < 0) throw userError(spec.label + 'ไม่ถูกต้อง', 'BAD_INPUT');
    return s;
  }
  if (s && !/^#[0-9A-Fa-f]{6}$/.test(s)) throw userError(spec.label + 'ต้องเป็นรหัสสีแบบ #RRGGBB', 'BAD_INPUT');
  return s.toUpperCase();
}

function brandValues(shop) {
  const s = settingValues(shop);
  const values = {};
  Object.keys(BRAND_SETTINGS).forEach((k) => { values[k] = s[k]; });
  if (values.SHOP_NAME === LEGACY_SHOP_NAME) values.SHOP_NAME = '';
  return values;
}

const lockShop = async (q, shopId) => (await q.query(SHOP_SQL + ' for update', [shopId])).rows[0];

// ===================== คำสั่ง =====================

async function adminMe(p, ctx) {
  const c = cfg(ctx.shop);
  return {
    me: { userId: ctx.user.userId, name: ctx.staff.name, role: ctx.staff.role },
    settings: { shopName: c.shopName, pointRate: c.pointRate, memberPrefix: c.memberPrefix },
    branches: await S.branchList(ctx.db, ctx.shop.id)
  };
}

// ---------- ภาพรวม ----------
// ยอดซื้อ/แต้ม = รายการที่เกิดที่สาขานั้น · สมาชิกใหม่ = สมัครที่สาขานั้น · คูปอง = ใช้ที่สาขานั้น
const SUMMARY_SQL = `
select p.k,
  (select count(*) from members m where m.shop_id = $1 and ($4::text = '' or m.joined_branch = $4::text)
      and m.joined_at >= p.f and m.joined_at < p.e)::int as new_members,
  (select count(*) from coupons c where c.shop_id = $1 and ($4::text = '' or c.used_branch = $4::text)
      and c.status = 'USED' and c.used_at >= p.f and c.used_at < p.e)::int as coupons_used,
  t.bills, t.sales, t.buyers, t.points_issued, t.points_redeemed
from (values ('cur', $2::timestamptz, $3::timestamptz), ('prev', $5::timestamptz, $2::timestamptz)) p(k, f, e)
cross join lateral (
  select count(*) filter (where type = 'EARN')::int as bills,
         coalesce(sum(amount) filter (where type = 'EARN'), 0)::float8 as sales,
         count(distinct member_id) filter (where type = 'EARN')::int as buyers,
         coalesce(sum(points) filter (where points > 0), 0)::float8 as points_issued,
         coalesce(-sum(points) filter (where type = 'REDEEM'), 0)::float8 as points_redeemed
  from transactions where shop_id = $1 and ($4::text = '' or branch = $4::text) and created_at >= p.f and created_at < p.e
) t`;

async function adminDashboard(p, ctx) {
  const per = period(p);
  const branch = branchFilter(p.branch);
  const shopId = ctx.shop.id;
  const db = ctx.db;
  const args = [shopId, per.from, per.end, branch];

  const totals = (await db.query(`select count(*)::int as members, count(*) filter (where status = 'ACTIVE')::int as active,
      coalesce(sum(points) filter (where status = 'ACTIVE'), 0)::float8 as outstanding,
      count(*) filter (where $2::text = '' or joined_branch = $2::text)::int as branch_members
    from members where shop_id = $1`, [shopId, branch])).rows[0];

  const sums = {};
  (await db.query(SUMMARY_SQL, args.concat([per.prevFrom]))).rows.forEach((r) => {
    sums[r.k] = { newMembers: r.new_members, buyers: r.buyers, bills: r.bills, sales: U.round2(r.sales),
      pointsIssued: r.points_issued, pointsRedeemed: r.points_redeemed, couponsUsed: r.coupons_used };
  });

  // กราฟ: ช่วงไม่เกิน 62 วันแสดงรายวัน ยาวกว่านั้นรวมเป็นรายเดือน
  const bucket = per.days <= 62 ? 'day' : 'month';
  const keyOf = (d) => (bucket === 'day' ? U.thaiDay(d) : U.thaiDay(d).slice(0, 7));
  const fmt = bucket === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const series = [];
  const at = {};
  for (let t = per.from.getTime(); t < per.end.getTime(); t += U.DAY_MS) {
    const k = keyOf(new Date(t));
    if (!at[k]) { at[k] = { key: k, sales: 0, bills: 0, newMembers: 0 }; series.push(at[k]); }
  }
  (await db.query(`select to_char(created_at at time zone 'Asia/Bangkok', '${fmt}') as k, count(*)::int as bills, sum(amount)::float8 as sales
      from transactions where shop_id = $1 and ($4::text = '' or branch = $4::text) and type = 'EARN' and created_at >= $2 and created_at < $3
      group by 1`, args)).rows.forEach((r) => { if (at[r.k]) { at[r.k].bills = r.bills; at[r.k].sales = U.round2(r.sales); } });
  (await db.query(`select to_char(joined_at at time zone 'Asia/Bangkok', '${fmt}') as k, count(*)::int as n
      from members where shop_id = $1 and ($4::text = '' or joined_branch = $4::text) and joined_at >= $2 and joined_at < $3
      group by 1`, args)).rows.forEach((r) => { if (at[r.k]) at[r.k].newMembers = r.n; });

  // ลูกค้าที่ซื้อมากสุด (ลูกค้าสมัครสาขาหนึ่ง ซื้ออีกสาขาได้ → ชื่อจากสมาชิกทั้งร้าน) / เท่ากัน = ใครซื้อก่อนขึ้นก่อน
  const topMembers = (await db.query(`select t.member_id, coalesce(max(m.name), '') as name, sum(t.amount)::float8 as sales, count(*)::int as bills
      from transactions t left join members m on m.shop_id = t.shop_id and m.id = t.member_id
      where t.shop_id = $1 and ($4::text = '' or t.branch = $4::text) and t.type = 'EARN' and t.created_at >= $2 and t.created_at < $3
      group by t.member_id order by round(sum(t.amount)::numeric, 2) desc, min(t.created_at) limit 5`, args)).rows
    .map((r) => ({ memberId: r.member_id, name: r.name, sales: U.round2(r.sales), bills: r.bills }));

  // ยอดตามพนักงาน: ยอดซื้อที่บันทึก + คูปองที่สแกนใช้ในช่วงนี้
  const byStaff = (await db.query(`select coalesce(nullif(staff, ''), '-') as staff, sum(amount)::float8 as sales, count(*)::int as bills
      from transactions where shop_id = $1 and ($4::text = '' or branch = $4::text) and type = 'EARN' and created_at >= $2 and created_at < $3
      group by 1 order by min(created_at)`, args)).rows.map((r) => ({ staff: r.staff, sales: U.round2(r.sales), bills: r.bills, couponsUsed: 0 }));
  (await db.query(`select coalesce(nullif(used_by, ''), '-') as staff, count(*)::int as n
      from coupons where shop_id = $1 and ($4::text = '' or used_branch = $4::text) and status = 'USED' and used_at >= $2 and used_at < $3
      group by 1 order by min(issued_at)`, args)).rows.forEach((r) => {
    const s = byStaff.find((x) => x.staff === r.staff);
    if (s) s.couponsUsed = r.n; else byStaff.push({ staff: r.staff, sales: 0, bills: 0, couponsUsed: r.n });
  });
  byStaff.sort((a, b) => b.sales - a.sales || b.couponsUsed - a.couponsUsed);

  // ของรางวัลยอดนิยม: คูปองที่แลกในช่วงนี้ (เลือกสาขา = คูปองที่ใช้ที่สาขานั้นในช่วงนี้ เพราะตอนแลกลูกค้าไม่ได้อยู่สาขาไหน)
  const dateCol = branch ? 'used_at' : 'issued_at';
  const topRewards = (await db.query(`select reward_id, (array_agg(name order by issued_at))[1] as name, count(*)::int as issued,
      count(*) filter (where status = 'USED')::int as used, coalesce(sum(points_used), 0)::float8 as points
      from coupons where shop_id = $1 and ($4::text = '' or used_branch = $4::text) and ${dateCol} >= $2 and ${dateCol} < $3
      group by reward_id order by count(*) desc, min(issued_at) limit 5`, args)).rows
    .map((r) => ({ rewardId: r.reward_id, name: r.name, issued: r.issued, used: r.used, points: r.points }));

  return {
    period: { from: p.from, to: p.to, days: per.days, bucket },
    totals: { members: totals.members, activeMembers: totals.active, pointsOutstanding: totals.outstanding, branchMembers: totals.branch_members },
    branch,
    byBranch: branch ? [] : await compareBranches(db, shopId, per),
    current: sums.cur,
    previous: sums.prev,
    series,
    topMembers,
    byStaff,
    topRewards
  };
}

// ตารางเทียบสาขา (ตอนดูทุกสาขา) — รายการที่ไม่มีสาขา/สาขาไม่รู้จัก รวมเป็นแถว OTHER / ร้านไม่มีสาขา = []
async function compareBranches(db, shopId, per) {
  const list = await S.branchList(db, shopId);
  if (!list.length) return [];
  const ids = list.map((b) => b.id);
  const rows = {};
  list.forEach((b) => { rows[b.id] = { id: b.id, name: b.name, status: b.status, sales: 0, bills: 0, buyers: 0, pointsIssued: 0, couponsUsed: 0, newMembers: 0 }; });
  rows.OTHER = { id: 'OTHER', name: '', status: '', sales: 0, bills: 0, buyers: 0, pointsIssued: 0, couponsUsed: 0, newMembers: 0 };
  const key = (col) => `case when ${col} = any($4::text[]) then ${col} else 'OTHER' end`;
  const args = [shopId, per.from, per.end, ids];
  (await db.query(`select ${key('branch')} as b, coalesce(sum(amount) filter (where type = 'EARN'), 0)::float8 as sales,
      count(*) filter (where type = 'EARN')::int as bills, count(distinct member_id) filter (where type = 'EARN')::int as buyers,
      coalesce(sum(points) filter (where points > 0), 0)::float8 as points_issued
      from transactions where shop_id = $1 and created_at >= $2 and created_at < $3 group by 1`, args)).rows
    .forEach((r) => Object.assign(rows[r.b], { sales: U.round2(r.sales), bills: r.bills, buyers: r.buyers, pointsIssued: r.points_issued }));
  (await db.query(`select ${key('joined_branch')} as b, count(*)::int as n from members
      where shop_id = $1 and joined_at >= $2 and joined_at < $3 group by 1`, args)).rows.forEach((r) => { rows[r.b].newMembers = r.n; });
  (await db.query(`select ${key('used_branch')} as b, count(*)::int as n from coupons
      where shop_id = $1 and status = 'USED' and used_at >= $2 and used_at < $3 group by 1`, args)).rows.forEach((r) => { rows[r.b].couponsUsed = r.n; });
  // สาขาที่ปิดแล้วและไม่มีข้อมูลในช่วงนี้ / แถว "อื่นๆ" ที่ว่าง → ไม่ต้องแสดง
  return ids.concat(['OTHER']).map((k) => rows[k])
    .filter((r) => r.status === 'ACTIVE' || r.sales || r.bills || r.pointsIssued || r.couponsUsed || r.newMembers);
}

// ---------- สมาชิก ----------
async function adminMembers(p, ctx) {
  const role = ctx.staff.role;
  const q = String(p.q || '').trim().toLowerCase().slice(0, 40);
  const sort = ['joined', 'points', 'spend', 'lastVisit', 'name'].indexOf(p.sort) >= 0 ? p.sort : 'joined';
  const status = ['ACTIVE', 'BLOCKED'].indexOf(U.upper(p.status)) >= 0 ? U.upper(p.status) : '';
  const branch = branchFilter(p.branch); // สาขาที่สมัคร
  const birthMonth = p.birthMonth === true && role === 'OWNER' ? Number(U.thaiDay(ctx.now).slice(5, 7)) : 0;
  // ค้นเบอร์: เจ้าของร้านค้นบางส่วนได้ / ผู้จัดการต้องพิมพ์เบอร์เต็ม (กันไล่เดาเบอร์ลูกค้าทีละหลัก)
  const digits = role === 'OWNER' && q.replace(/\D/g, '').length >= 3 ? q.replace(/\D/g, '') : '';
  const fullPhone = U.normalizePhone(q);

  const where = `shop_id = $1 and ($2::text = '' or joined_branch = $2::text) and ($3::int = 0 or extract(month from birth_date) = $3::int)
    and ($4::text = '' or status = $4::text)
    and ($5::text = '' or strpos(lower(name), $5::text) > 0 or strpos(lower(id), $5::text) > 0
         or ($6::text <> '' and strpos(phone, $6::text) > 0) or ($7::text <> '' and phone = $7::text))`;
  const args = [ctx.shop.id, branch, birthMonth, status, q, digits, fullPhone];
  const total = (await ctx.db.query(`select count(*)::int as n from members where ${where}`, args)).rows[0].n;
  const pg = page(p.page, total);

  let rows;
  if (sort === 'name') {
    // เรียงชื่อแบบภาษาไทย (ฐานข้อมูลอาจไม่มีชุดเรียงภาษาไทย) → ดึงแค่รหัส+ชื่อมาเรียงเอง แล้วอ่านเฉพาะหน้าที่แสดง
    const all = (await ctx.db.query(`select id, name from members where ${where} order by joined_at, id`, args)).rows;
    all.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'th'));
    const ids = all.slice(pg.start, pg.start + PAGE_SIZE).map((r) => r.id);
    const got = (await ctx.db.query(`select ${V.MEMBER_COLS} from members where shop_id = $1 and id = any($2::text[])`, [ctx.shop.id, ids])).rows;
    rows = ids.map((id) => got.find((m) => m.id === id));
  } else {
    // เท่ากัน = เรียงตามลำดับที่สมัคร (เหมือนลำดับแถวในชีตเดิม)
    const order = { joined: 'joined_at desc', points: 'points desc, joined_at', spend: 'total_spend desc, joined_at',
      lastVisit: 'last_visit_at desc nulls last, joined_at' }[sort];
    rows = (await ctx.db.query(`select ${V.MEMBER_COLS} from members where ${where} order by ${order}, id limit ${PAGE_SIZE} offset ${pg.start}`, args)).rows;
  }
  return { items: rows.map((m) => adminMember(m, role)), total, page: pg.page, pages: pg.pages };
}

// สมาชิกรายคน: ข้อมูล + ประวัติแต้ม + คูปอง
async function adminMemberDetail(p, ctx) {
  const id = U.cleanMemberId(p.memberId);
  const shopId = ctx.shop.id;
  const m = await M.memberById(ctx.db, shopId, id);
  if (!m) throw userError('ไม่พบสมาชิก', 'NOT_FOUND');
  const extra = (await ctx.db.query('select line_user_id, consent_version, consent_at from members where shop_id = $1 and id = $2', [shopId, id])).rows[0];
  const now = ctx.now;
  const owner = ctx.staff.role === 'OWNER';
  const out = adminMember(m, ctx.staff.role);
  out.birthDate = owner ? String(m.birth_date || '') : '';   // ข้อมูลส่วนตัว → เจ้าของร้านเท่านั้น
  out.consentVersion = extra.consent_version == null ? '' : String(extra.consent_version);
  out.consentAt = U.iso(extra.consent_at);
  out.marketingConsent = m.marketing_consent === true;
  out.note = String(m.note || '');
  out.lineLinked = !!extra.line_user_id;
  out.firstName = String(m.first_name || '');
  out.lastName = String(m.last_name || '');
  out.joinedBranch = U.upper(m.joined_branch);
  out.birthSelfEdits = U.toInt(m.birth_date_edits);
  out.profileLog = (await ctx.db.query('select created_at, changed, by_name from profile_log where shop_id = $1 and member_id = $2 order by created_at desc limit 30',
    [shopId, id])).rows.map((l) => ({ date: U.iso(l.created_at), changed: String(l.changed || ''), by: String(l.by_name || '') }));
  const history = (await ctx.db.query(`select id, created_at, type, amount::float8 as amount, points, balance_after, detail, staff, ref, branch
      from transactions where shop_id = $1 and member_id = $2 order by created_at desc limit 200`, [shopId, id])).rows;
  // สาขาที่มาบ่อยที่สุด (จากบิลซื้อในประวัติล่าสุด) — ดูว่าเป็นขาประจำสาขาไหน
  const visits = {};
  history.forEach((tx) => { const b = U.upper(tx.branch); if (U.upper(tx.type) === 'EARN' && b) visits[b] = (visits[b] || 0) + 1; });
  out.topBranch = Object.keys(visits).sort((a, b) => visits[b] - visits[a])[0] || '';
  out.topBranchVisits = out.topBranch ? visits[out.topBranch] : 0;
  const coupons = (await ctx.db.query(`select ${V.COUPON_COLS} from coupons where shop_id = $1 and member_id = $2 order by issued_at desc limit 200`, [shopId, id])).rows;
  return {
    member: out,
    history: history.map((tx) => Object.assign(V.publicTx(tx), { staff: String(tx.staff || ''), ref: String(tx.ref || ''), branch: U.upper(tx.branch) })),
    coupons: coupons.map((c) => Object.assign(V.publicCoupon(c, now), { usedBy: String(c.used_by || ''), usedBranch: U.upper(c.used_branch) }))
  };
}

// ---------- รายการแต้ม / คูปอง ----------
async function adminTransactions(p, ctx) {
  const per = period(p);
  const type = TX_TYPES.indexOf(U.upper(p.type)) >= 0 ? U.upper(p.type) : '';
  const staff = String(p.staff || '').slice(0, 60);
  const q = String(p.q || '').trim().toLowerCase().slice(0, 40);
  const branch = branchFilter(p.branch);
  const base = [ctx.shop.id, per.from, per.end, branch];
  const inRange = `t.shop_id = $1 and t.created_at >= $2 and t.created_at < $3 and ($4::text = '' or t.branch = $4::text)`;
  const filtered = `${inRange} and ($5::text = '' or t.type = $5::text) and ($6::text = '' or t.staff = $6::text)
    and ($7::text = '' or strpos(lower(t.member_id), $7::text) > 0 or strpos(lower(coalesce(m.name, '')), $7::text) > 0)`;
  const from = 'transactions t left join members m on m.shop_id = t.shop_id and m.id = t.member_id';
  const args = base.concat([type, staff, q]);

  const sum = (await ctx.db.query(`select count(*)::int as count, coalesce(sum(t.amount) filter (where t.type = 'EARN'), 0)::float8 as sales,
      coalesce(sum(t.points) filter (where t.points > 0), 0)::float8 as plus, coalesce(-sum(t.points) filter (where t.points < 0), 0)::float8 as minus
      from ${from} where ${filtered}`, args)).rows[0];
  const staffNames = (await ctx.db.query(`select distinct t.staff from transactions t where ${inRange} and t.staff <> ''`, base)).rows
    .map((r) => String(r.staff)).sort();
  const pg = page(p.page, sum.count);
  const items = (await ctx.db.query(`select t.id, t.created_at, t.type, t.amount::float8 as amount, t.points, t.balance_after, t.detail,
      t.member_id, t.staff, t.ref, t.branch, coalesce(m.name, '') as member_name
      from ${from} where ${filtered} order by t.created_at desc, t.id desc limit ${PAGE_SIZE} offset ${pg.start}`, args)).rows;
  return {
    items: items.map((tx) => Object.assign(V.publicTx(tx), {
      memberId: String(tx.member_id || ''), memberName: String(tx.member_name || ''), staff: String(tx.staff || ''), ref: String(tx.ref || ''), branch: U.upper(tx.branch)
    })),
    summary: { count: sum.count, sales: U.round2(sum.sales), pointsPlus: sum.plus, pointsMinus: sum.minus },
    staffNames,
    total: sum.count, page: pg.page, pages: pg.pages
  };
}

async function adminCoupons(p, ctx) {
  const per = period(p);
  const status = ['ACTIVE', 'USED', 'EXPIRED', 'CANCELLED'].indexOf(U.upper(p.status)) >= 0 ? U.upper(p.status) : '';
  const branch = branchFilter(p.branch); // คูปองที่ถูกใช้ที่สาขานั้น
  const now = ctx.now;
  // สถานะที่ลูกค้าเห็น: ยังไม่ใช้แต่เลยวันหมดอายุ = EXPIRED (เหมือน couponState)
  const state = `case when c.status = 'ACTIVE' and c.expires_at < $5 then 'EXPIRED' else c.status end`;
  const where = `c.shop_id = $1 and c.issued_at >= $2 and c.issued_at < $3 and ($4::text = '' or c.used_branch = $4::text)`;
  const args = [ctx.shop.id, per.from, per.end, branch, now];
  const counts = { ACTIVE: 0, USED: 0, EXPIRED: 0, CANCELLED: 0 };
  let all = 0;
  (await ctx.db.query(`select ${state} as s, count(*)::int as n from coupons c where ${where} group by 1`, args)).rows.forEach((r) => {
    if (counts[r.s] != null) counts[r.s] = r.n;
    all += r.n;
  });
  const total = status ? counts[status] : all;
  const pg = page(p.page, total);
  const rows = (await ctx.db.query(`select ${V.COUPON_COLS.split(', ').map((c) => 'c.' + c).join(', ')}, coalesce(m.name, '') as member_name
      from coupons c left join members m on m.shop_id = c.shop_id and m.id = c.member_id
      where ${where} and ($6::text = '' or ${state} = $6::text)
      order by c.issued_at desc limit ${PAGE_SIZE} offset ${pg.start}`, args.concat([status]))).rows;
  return {
    items: rows.map((c) => Object.assign(V.publicCoupon(c, now), {
      memberId: String(c.member_id || ''), memberName: String(c.member_name || ''), usedBy: String(c.used_by || ''), usedBranch: U.upper(c.used_branch)
    })),
    counts, all, total, page: pg.page, pages: pg.pages
  };
}

// ---------- พนักงาน ----------
function adminStaffRow(s, myId) {
  const role = U.upper(s.role);
  return {
    branches: S.staffBranches(s) || ['ALL'],
    userId: String(s.line_user_id || ''),
    name: String(s.name || ''),
    role: S.ROLES.indexOf(role) >= 0 ? role : 'CASHIER',
    status: STAFF_STATUSES.indexOf(U.upper(s.status)) >= 0 ? U.upper(s.status) : 'PENDING',
    requestedAt: U.iso(s.requested_at),
    isMe: String(s.line_user_id) === myId
  };
}

const STAFF_COLS = 'line_user_id, name, role, status, branches, requested_at';

async function adminStaff(p, ctx) {
  const items = (await ctx.db.query(`select ${STAFF_COLS} from staff where shop_id = $1 order by requested_at, line_user_id`, [ctx.shop.id])).rows
    .map((s) => adminStaffRow(s, ctx.user.userId));
  // คนที่รออนุมัติขึ้นก่อน เจ้าของร้านจะได้เห็นทันที
  const order = { PENDING: 0, ACTIVE: 1, DISABLED: 2 };
  items.sort((a, b) => (order[a.status] - order[b.status]) || (b.requestedAt > a.requestedAt ? 1 : -1));
  return { items };
}

// สาขาของพนักงาน: ['ALL'] = ทุกสาขา (เก็บ null) / รายการรหัสที่มีอยู่จริง
async function cleanStaffBranches(db, shopId, v) {
  if (!Array.isArray(v) || v.length > MAX_BRANCHES) throw userError('สาขาไม่ถูกต้อง', 'BAD_BRANCH');
  const ids = v.map(U.upper);
  if (ids.indexOf('ALL') >= 0) return null;
  if (!ids.length) throw userError('กรุณาเลือกอย่างน้อย 1 สาขา', 'BAD_BRANCH');
  const known = (await S.branchList(db, shopId)).map((b) => b.id);
  const out = [];
  ids.forEach((id) => {
    if (known.indexOf(id) < 0) throw userError('ไม่พบสาขา ' + id, 'BAD_BRANCH');
    if (out.indexOf(id) < 0) out.push(id);
  });
  return out;
}

// อนุมัติ / ปิดสิทธิ์ / เปลี่ยนบทบาท / แก้ชื่อ — แก้แถวตัวเองไม่ได้ / ผู้จัดการดูแลได้เฉพาะแคชเชียร์
async function adminStaffUpdate(p, ctx) {
  const userId = String(p.userId || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw userError('รหัสพนักงานไม่ถูกต้อง', 'BAD_STAFF');
  if (userId === ctx.user.userId) throw userError('แก้สิทธิ์ของตัวเองไม่ได้ ให้เจ้าของร้านคนอื่นแก้ให้', 'SELF_EDIT');
  const role = U.upper(p.role);
  const status = U.upper(p.status);
  if (S.ROLES.indexOf(role) < 0) throw userError('บทบาทไม่ถูกต้อง', 'BAD_ROLE');
  if (STAFF_STATUSES.indexOf(status) < 0) throw userError('สถานะไม่ถูกต้อง', 'BAD_STATUS');
  const name = U.cleanLineName(p.name);
  const isOwner = ctx.staff.role === 'OWNER';
  const shopId = ctx.shop.id;
  const branches = p.branches === undefined ? undefined : await cleanStaffBranches(ctx.db, shopId, p.branches); // undefined = ไม่แก้สาขา

  return ctx.db.tx(async (q) => {
    const s = (await q.query(`select ${STAFF_COLS} from staff where shop_id = $1 and line_user_id = $2 for update`, [shopId, userId])).rows[0];
    if (!s) throw userError('ไม่พบพนักงานคนนี้', 'NOT_FOUND');
    const curRole = S.ROLES.indexOf(U.upper(s.role)) >= 0 ? U.upper(s.role) : 'CASHIER';
    if (!isOwner && (curRole !== 'CASHIER' || role !== 'CASHIER')) {
      throw userError('ผู้จัดการแก้ได้เฉพาะแคชเชียร์ ถ้าต้องการเปลี่ยนบทบาทอื่น ให้เจ้าของร้านทำ', 'NO_ROLE');
    }
    await q.query(`update staff set role = $3, status = $4, name = case when $5::text = '' then name else $5::text end,
                   branches = case when $6::boolean then $7::text[] else branches end where shop_id = $1 and line_user_id = $2`,
      [shopId, userId, role, status, name, branches !== undefined, branches === undefined ? null : branches]);
    const fresh = (await q.query(`select ${STAFF_COLS} from staff where shop_id = $1 and line_user_id = $2`, [shopId, userId])).rows[0];
    return { staff: adminStaffRow(fresh, ctx.user.userId) };
  });
}

// ---------- ส่งออก (เฉพาะเจ้าของร้าน — ตรวจใน router) ----------
async function adminExport(p, ctx) {
  const kind = String(p.kind || '');
  const shopId = ctx.shop.id;
  const list = await S.branchList(ctx.db, shopId);
  const withBranch = list.length > 0; // คอลัมน์สาขาใส่เฉพาะร้านที่มีสาขา
  const bn = V.branchNames(list);
  const branchName = (v) => { const k = U.upper(v); return k ? (bn[k] || k) : 'ไม่ระบุ'; };
  let columns, rows;
  if (kind === 'members') {
    columns = ['รหัสสมาชิก', 'ชื่อ', 'นามสกุล', 'เบอร์โทร', 'วันเกิด', 'แต้มคงเหลือ', 'ยอดซื้อรวม', 'จำนวนครั้งที่มา',
      'วันที่สมัคร', 'มาล่าสุด', 'ยินยอมรับข่าวสาร', 'สถานะ'];
    rows = (await ctx.db.query(`select ${V.MEMBER_COLS} from members where shop_id = $1 order by joined_at, id`, [shopId])).rows.map((m) => {
      const first = String(m.first_name || '') || String(m.name || '');
      return [String(m.id), first, String(m.last_name || ''), fmtPhone(m.phone), String(m.birth_date || ''),
        U.toInt(m.points), U.toNum(m.total_spend), U.toInt(m.visit_count), fmtDateTimeOrBlank(m.joined_at),
        fmtDateTimeOrBlank(m.last_visit_at), m.marketing_consent === true ? 'ใช่' : 'ไม่', U.upper(m.status) || 'ACTIVE']
        .concat(withBranch ? [branchName(m.joined_branch)] : []);
    });
    if (withBranch) columns.push('สาขาที่สมัคร');
  } else if (kind === 'transactions') {
    const per = period(p);
    columns = ['รหัสรายการ', 'วันเวลา', 'รหัสสมาชิก', 'ชื่อสมาชิก', 'ประเภท', 'ยอดซื้อ', 'แต้ม', 'แต้มคงเหลือ', 'รายละเอียด', 'พนักงาน'];
    rows = (await ctx.db.query(`select t.id, t.created_at, t.member_id, coalesce(m.name, '') as member_name, t.type, t.amount::float8 as amount,
        t.points, t.balance_after, t.detail, t.staff, t.branch
        from transactions t left join members m on m.shop_id = t.shop_id and m.id = t.member_id
        where t.shop_id = $1 and t.created_at >= $2 and t.created_at < $3 order by t.created_at, t.id`, [shopId, per.from, per.end])).rows.map((tx) =>
      [String(tx.id), fmtDateTimeOrBlank(tx.created_at), String(tx.member_id || ''), String(tx.member_name || ''), U.upper(tx.type),
        U.toNum(tx.amount), U.toInt(tx.points), U.toInt(tx.balance_after), String(tx.detail || ''), String(tx.staff || '')]
        .concat(withBranch ? [branchName(tx.branch)] : []));
    if (withBranch) columns.push('สาขา');
  } else {
    throw userError('ไม่รู้จักข้อมูลที่จะส่งออก', 'BAD_EXPORT');
  }
  // ไฟล์ที่ส่งออกไปแล้วร้านควบคุมไม่ได้ (PDPA) → จดไว้ว่าใครส่งออกเมื่อไร
  console.log('ส่งออก ' + kind + ' ' + rows.length + ' แถว ร้าน ' + shopId + ' โดย ' + ctx.staff.name + ' (' + ctx.user.userId + ')');
  return { columns, rows };
}

// ---------- ของรางวัล / โปรโมชัน ----------
function adminReward(r, now) {
  const quota = U.toInt(r.quota);
  const issued = U.toInt(r.issued);
  const status = U.upper(r.status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  const birthday = U.upper(r.type) === V.REWARD_BIRTHDAY;
  return {
    id: String(r.id), name: String(r.name || ''), description: String(r.description || ''), points: U.toInt(r.points),
    image: String(r.image || ''), imageUrl: U.safeUrl(U.driveImage(r.image)),
    validDays: U.toInt(r.valid_days) || '', quota: quota || '', issued, limitPerMember: U.toInt(r.limit_per_member) || '',
    startDate: r.start_date || '', endDate: r.end_date || '', sort: U.toInt(r.sort), status,
    type: birthday ? V.REWARD_BIRTHDAY : '',
    // สิ่งที่ลูกค้าเห็นตอนนี้ (ตรงกับเงื่อนไขใน listRewards) — ของขวัญวันเกิดให้ 0 แต้มได้
    state: status !== 'ACTIVE' ? 'INACTIVE'
      : U.toInt(r.points) <= 0 && !birthday ? 'INVALID'
        : windowState(r.start_date, r.end_date, now) || (quota > 0 && issued >= quota ? 'SOLD_OUT' : 'ACTIVE')
  };
}

const PROMO_COLS = `id, title, subtitle, tag, image, link, to_char(start_date, 'YYYY-MM-DD') as start_date,
  to_char(end_date, 'YYYY-MM-DD') as end_date, sort, status`;

function adminPromo(r, now) {
  const status = U.upper(r.status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
  return {
    id: String(r.id), title: String(r.title || ''), subtitle: String(r.subtitle || ''), tag: String(r.tag || ''),
    image: String(r.image || ''), imageUrl: U.safeUrl(U.driveImage(r.image)), link: String(r.link || ''),
    startDate: r.start_date || '', endDate: r.end_date || '', sort: U.toInt(r.sort), status,
    state: status !== 'ACTIVE' ? 'INACTIVE' : (windowState(r.start_date, r.end_date, now) || 'ACTIVE')
  };
}

const bySortId = (a, b) => (a.sort - b.sort) || (a.id < b.id ? -1 : 1);

async function adminRewards(p, ctx) {
  const rows = (await ctx.db.query(`select ${V.REWARD_COLS} from rewards where shop_id = $1 and deleted_at is null`, [ctx.shop.id])).rows;
  return { items: rows.map((r) => adminReward(r, ctx.now)).sort(bySortId), couponDays: cfg(ctx.shop).couponDays, canDelete: true };
}

// เพิ่ม (ไม่มี id) หรือแก้ — ลบใช้ adminRewardDelete (ซ่อน แต่แถวยังอยู่ เพราะคูปองที่แลกไปแล้วอ้างถึง)
async function adminRewardSave(p, ctx) {
  const r = p.reward || {};
  const id = r.id ? U.cleanKey(r.id, 'รหัสรางวัล') : '';
  const birthday = U.upper(r.type) === V.REWARD_BIRTHDAY;
  const f = {
    name: U.cleanText(r.name, 80, 'ชื่อของรางวัล', true),
    description: U.cleanText(r.description, 300, 'รายละเอียด'),
    points: birthday ? (String(r.points == null ? '' : r.points).trim() === '' ? 0 : intIn(r.points, 0, 1000000, 'แต้มที่ใช้แลก'))
      : intIn(r.points, 1, 1000000, 'แต้มที่ใช้แลก'),
    type: birthday ? V.REWARD_BIRTHDAY : '',
    image: cleanImage(r.image),
    valid_days: optInt(r.validDays, 1, 3650, 'จำนวนวันที่ใช้ได้'),
    quota: optInt(r.quota, 1, 1000000, 'จำนวนทั้งหมด'),
    limit_per_member: optInt(r.limitPerMember, 1, 1000, 'จำกัดต่อคน'),
    sort: optInt(r.sort, 0, 9999, 'ลำดับ'),
    status: cleanStatus(r.status)
  };
  Object.assign(f, cleanWindow(r.startDate, r.endDate));
  if (f.sort == null) f.sort = 0;
  const shopId = ctx.shop.id;
  const cols = Object.keys(f);

  return once(ctx, 'rewardSave', p.requestId, async (q) => {
    if (id) {
      const cur = (await q.query('select issued from rewards where shop_id = $1 and id = $2 and deleted_at is null for update', [shopId, id])).rows[0];
      if (!cur) throw userError('ไม่พบของรางวัลนี้', 'NOT_FOUND');
      if (f.quota != null && f.quota < U.toInt(cur.issued)) {
        throw userError('จำนวนทั้งหมดต้องไม่น้อยกว่าที่แลกไปแล้ว (' + U.fmtNum(U.toInt(cur.issued)) + ')', 'BAD_QUOTA');
      }
      await q.query(`update rewards set ${cols.map((c, i) => c + ' = $' + (i + 3)).join(', ')} where shop_id = $1 and id = $2`,
        [shopId, id].concat(cols.map((c) => f[c])));
      return { reward: adminReward((await q.query(`select ${V.REWARD_COLS} from rewards where shop_id = $1 and id = $2`, [shopId, id])).rows[0], ctx.now) };
    }
    const newId = await nextId(q, 'rewards', shopId, 'R');
    await q.query(`insert into rewards (shop_id, id, ${cols.join(', ')}) values ($1, $2, ${cols.map((c, i) => '$' + (i + 3)).join(', ')})`,
      [shopId, newId].concat(cols.map((c) => f[c])));
    return { reward: adminReward((await q.query(`select ${V.REWARD_COLS} from rewards where shop_id = $1 and id = $2`, [shopId, newId])).rows[0], ctx.now), created: true };
  });
}

async function adminPromos(p, ctx) {
  const rows = (await ctx.db.query(`select ${PROMO_COLS} from promotions where shop_id = $1 and deleted_at is null`, [ctx.shop.id])).rows;
  return { items: rows.map((r) => adminPromo(r, ctx.now)).sort(bySortId), canDelete: true };
}

async function adminPromoSave(p, ctx) {
  const r = p.promo || {};
  const id = r.id ? U.cleanKey(r.id, 'รหัสโปรโมชัน') : '';
  const f = {
    title: U.cleanText(r.title, 80, 'หัวข้อ', true),
    subtitle: U.cleanText(r.subtitle, 150, 'ข้อความรอง'),
    tag: U.cleanText(r.tag, 30, 'ป้าย'),
    image: cleanImage(r.image),
    link: cleanLink(r.link),
    sort: optInt(r.sort, 0, 9999, 'ลำดับ'),
    status: cleanStatus(r.status)
  };
  Object.assign(f, cleanWindow(r.startDate, r.endDate));
  if (f.sort == null) f.sort = 0;
  const shopId = ctx.shop.id;
  const cols = Object.keys(f);

  return once(ctx, 'promoSave', p.requestId, async (q) => {
    if (id) {
      const cur = (await q.query('select 1 from promotions where shop_id = $1 and id = $2 and deleted_at is null for update', [shopId, id])).rows[0];
      if (!cur) throw userError('ไม่พบโปรโมชันนี้', 'NOT_FOUND');
      await q.query(`update promotions set ${cols.map((c, i) => c + ' = $' + (i + 3)).join(', ')} where shop_id = $1 and id = $2`,
        [shopId, id].concat(cols.map((c) => f[c])));
      return { promo: adminPromo((await q.query(`select ${PROMO_COLS} from promotions where shop_id = $1 and id = $2`, [shopId, id])).rows[0], ctx.now) };
    }
    const newId = await nextId(q, 'promotions', shopId, 'P');
    await q.query(`insert into promotions (shop_id, id, ${cols.join(', ')}) values ($1, $2, ${cols.map((c, i) => '$' + (i + 3)).join(', ')})`,
      [shopId, newId].concat(cols.map((c) => f[c])));
    return { promo: adminPromo((await q.query(`select ${PROMO_COLS} from promotions where shop_id = $1 and id = $2`, [shopId, newId])).rows[0], ctx.now), created: true };
  });
}

// ---------- จัดการสมาชิก ----------
// ระงับ / เปิดใช้: ระงับแล้วสะสมแต้ม แลกรางวัล และใช้คูปองไม่ได้ (ข้อมูลและแต้มยังอยู่ครบ) — จดว่าใครทำ เมื่อไร เพราะอะไร
async function adminMemberStatus(p, ctx) {
  const id = U.cleanMemberId(p.memberId);
  const status = U.upper(p.status);
  if (status !== 'ACTIVE' && status !== 'BLOCKED') throw userError('สถานะไม่ถูกต้อง', 'BAD_STATUS');
  const reason = U.cleanNote(p.reason);
  if (status === 'BLOCKED' && reason.length < 3) throw userError('กรุณาใส่เหตุผลที่ระงับ', 'NO_REASON');
  const shopId = ctx.shop.id;
  return ctx.db.tx(async (q) => {
    const m = await M.memberById(q, shopId, id, true);
    if (!m) throw userError('ไม่พบสมาชิก', 'NOT_FOUND');
    const note = ((status === 'BLOCKED' ? 'ระงับ ' : 'เปิดใช้อีกครั้ง ') + U.thaiDay(ctx.now) + ' โดย ' + ctx.staff.name + (reason ? ': ' + reason : '')).slice(0, 250);
    await q.query('update members set status = $3, note = $4 where shop_id = $1 and id = $2', [shopId, id, status, note]);
    return { member: adminMember(await M.memberById(q, shopId, id), ctx.staff.role) };
  });
}

// เจ้าของร้านแก้ชื่อ/เบอร์/วันเกิดให้ลูกค้า (วันเกิดไม่จำกัดครั้ง / รับข่าวสารแก้ไม่ได้ — ลูกค้าเลือกเองเท่านั้น)
async function adminMemberUpdate(p, ctx) {
  const id = U.cleanMemberId(p.memberId);
  const input = M.cleanProfileInput(p, false, ctx.now);
  const shopId = ctx.shop.id;
  try {
    return await ctx.db.tx(async (q) => {
      const m = await M.memberById(q, shopId, id, true);
      if (!m) throw userError('ไม่พบสมาชิก', 'NOT_FOUND');
      const changed = await M.applyProfile(q, shopId, m, input, { self: false, by: ctx.staff.name }, ctx.now);
      if (changed.length) console.log('แก้ข้อมูลสมาชิก ' + id + ' (' + changed.join(', ') + ') โดย ' + ctx.staff.name);
      return { changed: changed.length, member: adminMember(await M.memberById(q, shopId, id), ctx.staff.role) };
    });
  } catch (e) {
    if (e && e.code === '23505' && /phone/.test(String(e.constraint || e.message || ''))) {
      throw userError('เบอร์นี้มีสมาชิกคนอื่นใช้แล้ว ถ้าเป็นเบอร์ของคุณ กรุณาติดต่อร้าน', 'PHONE_TAKEN');
    }
    throw e;
  }
}

// ---------- ตั้งค่าร้าน / หน้าตาร้าน ----------
async function adminSettings(p, ctx) {
  return { items: settingItems(ctx.shop) };
}

async function adminSettingsSave(p, ctx) {
  const values = p.values || {};
  const keys = Object.keys(values).filter((k) => Object.prototype.hasOwnProperty.call(EDITABLE_SETTINGS, k));
  if (!keys.length) throw userError('ไม่มีค่าที่จะบันทึก', 'BAD_INPUT');
  const clean = {};
  keys.forEach((k) => { clean[k] = cleanSetting(k, values[k]); });
  const shopId = ctx.shop.id;
  return ctx.db.tx(async (q) => {
    const before = settingValues(await lockShop(q, shopId));
    const changed = keys.filter((k) => before[k] !== clean[k]);
    if (changed.length) {
      await q.query(`update shops set ${changed.map((k, i) => EDITABLE_SETTINGS[k].col + ' = $' + (i + 2)).join(', ')} where id = $1`,
        [shopId].concat(changed.map((k) => Number(clean[k]))));
      console.log('แก้ตั้งค่าร้าน ' + shopId + ' โดย ' + ctx.staff.name + ' — ' + changed.map((k) => k + ': ' + before[k] + ' → ' + clean[k]).join(' | '));
    }
    return { changed: changed.length, items: settingItems((await q.query(SHOP_SQL, [shopId])).rows[0]) };
  });
}

async function adminBrand(p, ctx) {
  return { values: brandValues(ctx.shop), consentVersion: String(ctx.shop.consent_version || '1') };
}

// แก้ข้อความนโยบาย → เพิ่มเลขฉบับนโยบายให้เอง (ต้องรู้ว่าลูกค้ายอมรับฉบับไหน ตาม PDPA) / ค่าเดิมซ้ำ = ไม่มีอะไรเปลี่ยน
async function adminBrandSave(p, ctx) {
  const input = p.values || {};
  const keys = Object.keys(input).filter((k) => Object.prototype.hasOwnProperty.call(BRAND_SETTINGS, k));
  if (!keys.length) throw userError('ไม่มีค่าที่จะบันทึก', 'BAD_INPUT');
  const clean = {};
  keys.forEach((k) => { clean[k] = cleanBrand(k, input[k]); });
  const shopId = ctx.shop.id;
  return ctx.db.tx(async (q) => {
    const shop = await lockShop(q, shopId);
    const before = brandValues(shop);
    const changed = keys.filter((k) => before[k] !== clean[k]);
    let consentVersion = Math.max(1, parseInt(shop.consent_version, 10) || 1);
    if (changed.length) {
      const brand = JSON.parse(JSON.stringify(shop.brand && typeof shop.brand === 'object' ? shop.brand : {}));
      let name = String(shop.name || '');
      changed.forEach((k) => {
        const path = BRAND_SETTINGS[k].path;
        if (!path) { name = clean[k]; return; }
        let o = brand;
        path.slice(0, -1).forEach((x) => { if (!o[x] || typeof o[x] !== 'object') o[x] = {}; o = o[x]; });
        o[path[path.length - 1]] = clean[k];
      });
      if (changed.indexOf('PRIVACY_TEXT') >= 0) consentVersion += 1;
      await q.query('update shops set name = $2, brand = $3::text::jsonb, consent_version = $4 where id = $1', [shopId, name, JSON.stringify(brand), consentVersion]);
      console.log('แก้หน้าตาร้าน ' + shopId + ' โดย ' + ctx.staff.name + ' — ' + changed.join(', ') + (changed.indexOf('PRIVACY_TEXT') >= 0 ? ' (นโยบายฉบับที่ ' + consentVersion + ')' : ''));
    }
    const fresh = (await q.query(SHOP_SQL, [shopId])).rows[0];
    return { changed: changed.length, consentVersion: String(consentVersion), values: brandValues(fresh), brand: publicBrand(fresh) };
  });
}

// ---------- อัปโหลดรูป ----------
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// ดูจากหัวไฟล์ (ไม่เชื่อชนิดไฟล์ที่หน้าเว็บบอกมา)
function looksLikeImage(b, mime) {
  if (mime === 'image/jpeg') return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
  if (mime === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
  return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
}

// หน้าเว็บย่อรูปก่อนส่ง (กว้างไม่เกิน 1200px) — ที่นี่ตรวจซ้ำ: ชนิดไฟล์ ขนาด และหัวไฟล์ว่าเป็นรูปจริง
// ไม่แตะฐานข้อมูล (ได้แค่ลิงก์รูปกลับไป หน้าเว็บนำไปใส่ในฟอร์มของรางวัล/โปรโมชัน/โลโก้)
async function adminUploadImage(p, ctx) {
  const mime = String(p.mime || '');
  const ext = Object.prototype.hasOwnProperty.call(IMAGE_TYPES, mime) ? IMAGE_TYPES[mime] : '';
  if (!ext) throw userError('รองรับเฉพาะรูป JPG, PNG หรือ WebP', 'BAD_IMAGE');
  const data = String(p.data || '');
  if (!data || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw userError('ไฟล์รูปใหญ่เกิน 2MB หรือไฟล์ไม่ถูกต้อง', 'BAD_IMAGE');
  }
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !looksLikeImage(bytes, mime)) throw userError('ไฟล์นี้ไม่ใช่รูปที่รองรับ', 'BAD_IMAGE');
  const kind = ['promo', 'logo'].indexOf(p.kind) >= 0 ? p.kind : 'reward';
  // แยกโฟลเดอร์ต่อร้าน / ชื่อมีรหัสสุ่ม (ไม่ทับรูปเดิม เดาชื่อไม่ได้)
  const path = ctx.shop.id + '/' + kind + '-' + U.thaiDay(ctx.now) + '-' + U.randomCode(6) + '.' + ext;
  let url;
  try {
    url = await ctx.deps.storage().upload(path, bytes, mime);
  } catch (e) {
    // ข้อความถึงผู้ใช้ไม่บอกว่ารูปเก็บที่ไหน — รายละเอียดสำหรับผู้ดูแลอยู่ใน log ของ Vercel
    console.error('อัปโหลดรูปไม่สำเร็จ: ' + (e && e.message ? e.message : e));
    throw userError('บันทึกรูปไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้ติดต่อผู้ดูแลระบบ', 'STORAGE_ERROR');
  }
  console.log('อัปโหลดรูป ' + path + ' (' + bytes.length + ' bytes) โดย ' + ctx.staff.name);
  return { url };
}

// ---------- สาขา ----------
async function adminBranches(p, ctx) {
  const shopId = ctx.shop.id;
  const items = await S.branchList(ctx.db, shopId);
  const staffCount = {};
  (await ctx.db.query(`select role, branches from staff where shop_id = $1 and status = 'ACTIVE'`, [shopId])).rows.forEach((s) => {
    const list = S.staffBranches(s);
    items.forEach((b) => { if (U.upper(s.role) === 'OWNER' || !list || list.indexOf(b.id) >= 0) staffCount[b.id] = (staffCount[b.id] || 0) + 1; });
  });
  const memberCount = {};
  (await ctx.db.query(`select joined_branch as b, count(*)::int as n from members where shop_id = $1 and joined_branch <> '' group by 1`, [shopId])).rows
    .forEach((r) => { memberCount[U.upper(r.b)] = r.n; });
  items.forEach((b) => { b.staff = staffCount[b.id] || 0; b.members = memberCount[b.id] || 0; });
  return { items, online: memberCount[V.BRANCH_ONLINE] || 0 };
}

async function adminBranchSave(p, ctx) {
  const b = p.branch || {};
  const id = b.id ? branchFilter(b.id) : '';
  const name = U.cleanText(b.name, 40, 'ชื่อสาขา', true);
  const sort = optInt(b.sort, 0, 9999, 'ลำดับ');
  const status = cleanStatus(b.status || 'ACTIVE');
  const shopId = ctx.shop.id;
  const dup = () => userError('มีสาขาชื่อ "' + name + '" อยู่แล้ว', 'DUP_BRANCH');

  try {
    return await once(ctx, 'branchSave', p.requestId, async (q) => {
      const rows = (await q.query('select id, name from branches where shop_id = $1', [shopId])).rows;
      if (rows.some((r) => U.upper(r.id) !== id && String(r.name || '').trim().toLowerCase() === name.toLowerCase())) throw dup();
      let savedId = id;
      if (id) {
        const cur = (await q.query('select 1 from branches where shop_id = $1 and id = $2 for update', [shopId, id])).rows[0];
        if (!cur) throw userError('ไม่พบสาขานี้', 'NOT_FOUND');
        await q.query('update branches set name = $3, sort = $4, status = $5 where shop_id = $1 and id = $2', [shopId, id, name, sort == null ? 0 : sort, status]);
      } else {
        if (rows.length >= MAX_BRANCHES) throw userError('เพิ่มสาขาได้ไม่เกิน ' + MAX_BRANCHES + ' สาขา', 'TOO_MANY');
        savedId = await nextId(q, 'branches', shopId, 'B');
        await q.query('insert into branches (shop_id, id, name, status, sort, created_at) values ($1, $2, $3, $4, $5, $6)',
          [shopId, savedId, name, status, sort == null ? rows.length + 1 : sort, ctx.now]);
      }
      console.log((id ? 'แก้สาขา ' : 'เพิ่มสาขา ') + savedId + ' ' + name + ' (' + status + ') ร้าน ' + shopId + ' โดย ' + ctx.staff.name);
      return { branch: { id: savedId, name, status }, created: !id, items: await S.branchList(q, shopId) };
    });
  } catch (e) {
    if (e && e.code === '23505' && /name/.test(String(e.constraint || e.message || ''))) throw dup(); // ตั้งชื่อซ้ำพร้อมกันพอดี
    throw e;
  }
}

// ---------- แต้มพิเศษ ----------
function adminRule(r, now, names) {
  const o = V.publicRule(r, names);
  Object.assign(o, { days: r.days, startDate: r.startDate, endDate: r.endDate, showBadge: r.showBadge, status: r.status });
  const win = windowState(r.startDate, r.endDate, now);
  o.state = r.status !== 'ACTIVE' ? 'INACTIVE' : win || (r.days.indexOf(U.dayCode(now)) >= 0 ? 'TODAY' : 'ACTIVE');
  return o;
}

async function adminRules(p, ctx) {
  const names = V.branchNames(await S.branchList(ctx.db, ctx.shop.id));
  return { items: (await S.loadRules(ctx.db, ctx.shop.id)).map((r) => adminRule(r, ctx.now, names)), canDelete: true };
}

async function adminRuleSave(p, ctx) {
  const r = p.rule || {};
  const id = r.id ? U.cleanKey(r.id, 'รหัสกติกา') : '';
  const mult = Number(r.multiplier);
  if (MULTIPLIERS.indexOf(mult) < 0) throw userError('เลือกจำนวนเท่าของแต้ม ×1.5 ×2 หรือ ×3', 'BAD_INPUT');
  const days = (Array.isArray(r.days) ? r.days : []).map(U.upper).filter((d, i, a) => U.DAY_CODES.indexOf(d) >= 0 && a.indexOf(d) === i);
  if (!days.length) throw userError('เลือกวันที่มีผลอย่างน้อย 1 วัน', 'BAD_INPUT');
  const shopId = ctx.shop.id;
  const list = await S.branchList(ctx.db, shopId);
  const branch = U.upper(r.branch);
  if (branch && !list.some((b) => b.id === branch)) throw userError('ไม่พบสาขานี้', 'BAD_BRANCH');
  const minRaw = String(r.minAmount == null ? '' : r.minAmount).replace(/,/g, '').trim();
  const min = minRaw === '' ? '' : Number(minRaw);
  if (min !== '' && (!isFinite(min) || min < 0 || min > 10000000)) throw userError('ยอดขั้นต่ำต้องเป็นตัวเลข 0–10,000,000', 'BAD_INPUT');
  const f = {
    name: U.cleanText(r.name, 60, 'ชื่อกติกา', true),
    multiplier: mult,
    days: U.DAY_CODES.filter((d) => days.indexOf(d) >= 0),
    branch,
    min_amount: min === '' || min === 0 ? null : U.round2(min),
    show_badge: r.showBadge === true,
    status: cleanStatus(r.status || 'ACTIVE')
  };
  Object.assign(f, cleanWindow(r.startDate, r.endDate));
  const cols = Object.keys(f);
  const names = V.branchNames(list);

  return once(ctx, 'ruleSave', p.requestId, async (q) => {
    let ruleId = id;
    if (id) {
      const cur = (await q.query('select 1 from point_rules where shop_id = $1 and id = $2 and deleted_at is null for update', [shopId, id])).rows[0];
      if (!cur) throw userError('ไม่พบกติกานี้', 'NOT_FOUND');
      await q.query(`update point_rules set ${cols.map((c, i) => c + ' = $' + (i + 3)).join(', ')} where shop_id = $1 and id = $2`,
        [shopId, id].concat(cols.map((c) => f[c])));
    } else {
      ruleId = await nextId(q, 'point_rules', shopId, 'PR');
      await q.query(`insert into point_rules (shop_id, id, created_at, ${cols.join(', ')}) values ($1, $2, $3, ${cols.map((c, i) => '$' + (i + 4)).join(', ')})`,
        [shopId, ruleId, ctx.now].concat(cols.map((c) => f[c])));
    }
    console.log((id ? 'แก้' : 'เพิ่ม') + 'กติกาแต้มพิเศษ ' + f.name + ' x' + f.multiplier + ' (' + f.status + ') ร้าน ' + shopId + ' โดย ' + ctx.staff.name);
    const saved = (await S.loadRules(q, shopId)).find((x) => x.id === ruleId);
    return { rule: adminRule(saved, ctx.now, names), created: !id };
  });
}

// ---------- ลบ ของรางวัล / โปรโมชัน / แต้มพิเศษ (ผู้ใช้ขอ 7 พ.ย. 2569) ----------
// "ลบ" = จดเวลาที่ลบ + ปิด แล้วซ่อนจากทุกหน้า แต่แถวยังอยู่:
// คูปองที่ลูกค้าแลกไปแล้วยังใช้ที่ร้านได้ / ประวัติแต้มเดิมยังอ่านได้ / รหัสไม่ถูกเอากลับมาใช้ซ้ำ (nextId นับรวมแถวที่ลบ)
// ลบซ้ำ (กดสองครั้ง / เน็ตหลุดแล้วส่งใหม่) = สำเร็จเหมือนเดิม
const DELETABLE = {
  reward: { table: 'rewards', label: 'ของรางวัล', nameCol: 'name' },
  promo: { table: 'promotions', label: 'โปรโมชัน', nameCol: 'title' },
  rule: { table: 'point_rules', label: 'กติกาแต้มพิเศษ', nameCol: 'name' }
};

function deleter(kind) {
  const d = DELETABLE[kind];
  return async function (p, ctx) {
    const id = U.cleanKey(p.id, 'รหัส' + d.label);
    const shopId = ctx.shop.id;
    return ctx.db.tx(async (q) => {
      const row = (await q.query(`select ${d.nameCol} as name, deleted_at from ${d.table} where shop_id = $1 and id = $2 for update`, [shopId, id])).rows[0];
      if (!row) throw userError('ไม่พบ' + d.label + 'นี้', 'NOT_FOUND');
      if (!row.deleted_at) {
        await q.query(`update ${d.table} set deleted_at = $3, status = 'INACTIVE' where shop_id = $1 and id = $2`, [shopId, id, ctx.now]);
        console.log('ลบ' + d.label + ' ' + id + ' ' + row.name + ' ร้าน ' + shopId + ' โดย ' + ctx.staff.name);
      }
      return { deleted: id, name: String(row.name || '') };
    });
  };
}

module.exports = {
  adminMe, adminDashboard, adminMembers, adminMember: adminMemberDetail, adminTransactions, adminCoupons, adminStaff, adminStaffUpdate,
  adminExport, adminRewards, adminRewardSave, adminPromos, adminPromoSave, adminMemberStatus, adminMemberUpdate,
  adminSettings, adminSettingsSave, adminUploadImage, adminBrand, adminBrandSave, adminBranches, adminBranchSave, adminRules, adminRuleSave,
  adminRewardDelete: deleter('reward'), adminPromoDelete: deleter('promo'), adminRuleDelete: deleter('rule'),
  looksLikeImage
};
