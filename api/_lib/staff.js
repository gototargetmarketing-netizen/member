// คำสั่งของพนักงาน (เดิม: ส่วนที่ 2 requireStaff_ + ส่วนที่ 4 ของ code.gs) และเรื่องสาขาที่ใช้ร่วมกับหลังบ้าน
// เปิดหน้าพนักงาน / ค้นลูกค้า / บันทึกยอดซื้อ / ใช้คูปอง / ปรับแต้ม / รายการล่าสุด
// กติกาและข้อความต้องเหมือนของเดิมทุกตัว — api-diff-test.js เทียบให้
const { userError } = require('./errors');
const U = require('./util');
const { cfg } = require('./shop');
const { once } = require('./once');
const V = require('./views');
const M = require('./members');
const T = require('./tiers');

const ROLES = ['OWNER', 'ADMIN', 'CASHIER'];
const ALL_STAFF = ROLES;
const MANAGERS = ['OWNER', 'ADMIN'];

const RULES_SQL = `select id, name, multiplier, days, to_char(start_date, 'YYYY-MM-DD') as start_date,
  to_char(end_date, 'YYYY-MM-DD') as end_date, branch, min_amount::float8 as min_amount, show_badge, status, min_tier_id
  from point_rules where shop_id = $1 and deleted_at is null order by created_at, id`;

// ---------- สาขา ----------
// ทุกสาขาของร้าน (รวมที่ปิดแล้ว) เรียงตามลำดับที่ร้านตั้ง
async function branchList(q, shopId) {
  const r = await q.query('select id, name, status, sort from branches where shop_id = $1', [shopId]);
  return r.rows.map((b) => ({ id: U.upper(b.id), name: String(b.name || ''), status: U.upper(b.status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE', sort: U.toInt(b.sort) }))
    .sort((a, b) => (a.sort - b.sort) || (a.id < b.id ? -1 : 1));
}

// สาขาที่พนักงานคนนี้ทำงานได้: null = ทุกสาขา (ว่าง / ALL) หรือรายการรหัสสาขา
function staffBranches(s) {
  const list = (Array.isArray(s && s.branches) ? s.branches : []).map(U.upper).filter(Boolean);
  return !list.length || list.indexOf('ALL') >= 0 ? null : list;
}

// เจ้าของร้านใช้ได้ทุกสาขาเสมอ (กันเจ้าของร้านล็อกตัวเองออกจากสาขา)
function staffCanUse(staff, branchId) {
  return staff.role === 'OWNER' || !staff.branches || staff.branches.indexOf(branchId) >= 0;
}

// สาขาที่จะบันทึกกับรายการ — ร้านไม่มีสาขา = '' (บันทึกเหมือนเดิม)
async function resolveStaffBranch(ctx, p) {
  const active = await M.activeBranches(ctx.db, ctx.shop.id);
  if (!active.length) return '';
  const id = U.upper(p.branchId);
  if (!id) throw userError('กรุณาเลือกสาขาก่อนบันทึก', 'NO_BRANCH');
  if (active.indexOf(id) < 0) throw userError('ไม่พบสาขานี้ หรือสาขาปิดแล้ว กรุณาเลือกสาขาใหม่', 'BAD_BRANCH');
  if (!staffCanUse(ctx.staff, id)) throw userError('คุณไม่ได้อยู่ในสาขานี้ กรุณาเลือกสาขาใหม่ หรือติดต่อเจ้าของร้าน', 'BAD_BRANCH');
  return id;
}

// ---------- ตรวจสิทธิ์พนักงาน ----------
async function findStaff(q, shopId, userId) {
  const r = await q.query('select line_user_id, name, role, status, branches from staff where shop_id = $1 and line_user_id = $2', [shopId, userId]);
  return r.rows[0] || null;
}

// พนักงานต้องอยู่ในรายชื่อ และสถานะ ACTIVE (เจ้าของร้านอนุมัติในหลังบ้าน)
async function requireStaff(ctx, roles) {
  const s = await findStaff(ctx.db, ctx.shop.id, ctx.user.userId);
  if (!s || U.upper(s.status) !== 'ACTIVE') throw userError('บัญชี LINE นี้ยังไม่ได้รับสิทธิ์พนักงาน', 'NOT_STAFF');
  // บทบาทที่ผิดรูปแบบ → ให้สิทธิ์น้อยที่สุด (CASHIER) ไว้ก่อน
  const role = ROLES.indexOf(U.upper(s.role)) >= 0 ? U.upper(s.role) : 'CASHIER';
  if (roles.indexOf(role) < 0) throw userError('บทบาท ' + role + ' ใช้คำสั่งนี้ไม่ได้', 'NO_ROLE');
  return { userId: ctx.user.userId, name: String(s.name || ctx.user.name || 'พนักงาน'), role, branches: staffBranches(s) };
}

// ---------- แต้มพิเศษ ----------
// ตรงหลายกติกา → ใช้อันที่ให้มากสุดอันเดียว ไม่คูณซ้อน (ผู้ใช้ตกลง 4 พ.ย. 2569) — ต้องคิดเหมือน pointsFor ใน staff.js หน้าเว็บ
// tc = { tiers, tierId } (ร้านเปิดใช้ระดับ) → ข้ามกติกาที่ตั้ง "ตั้งแต่ระดับ X" ไว้สูงกว่าระดับของลูกค้า
function bestRule(rules, now, branch, amount, tc) {
  let best = null;
  V.rulesOn(rules, now).forEach((r) => {
    if (r.branch && r.branch !== branch) return;
    if (r.minAmount > 0 && amount < r.minAmount) return;
    if (tc && !T.meets(tc.tiers, tc.tierId, r.minTierId)) return;
    if (!best || r.multiplier > best.multiplier) best = r;
  });
  return best;
}

async function loadRules(q, shopId) {
  return (await q.query(RULES_SQL, [shopId])).rows.map(V.ruleFromRow);
}

// ---------- คำสั่ง ----------

// เปิดหน้าพนักงาน: ยังไม่มีชื่อในรายชื่อ → เพิ่มเป็น PENDING ให้เจ้าของร้านอนุมัติ
async function staffMe(p, ctx) {
  const shopId = ctx.shop.id;
  let s = await findStaff(ctx.db, shopId, ctx.user.userId);
  if (!s) {
    await ctx.db.query(`insert into staff (shop_id, line_user_id, name, role, status, requested_at, note)
                        values ($1, $2, $3, 'CASHIER', 'PENDING', $4, $5) on conflict (shop_id, line_user_id) do nothing`,
      [shopId, ctx.user.userId, ctx.user.name || 'พนักงาน', ctx.now, 'ขอสิทธิ์จากหน้าพนักงาน — เปลี่ยน Status เป็น ACTIVE เพื่ออนุมัติ']);
    s = await findStaff(ctx.db, shopId, ctx.user.userId);
  }
  const status = U.upper(s.status) || 'PENDING';
  const role = ROLES.indexOf(U.upper(s.role)) >= 0 ? U.upper(s.role) : 'CASHIER';
  const out = { staff: { userId: ctx.user.userId, name: String(s.name || ctx.user.name || ''), role, status } };
  if (status === 'ACTIVE') {
    const c = cfg(ctx.shop);
    out.settings = { shopName: c.shopName, pointRate: c.pointRate, maxPurchase: c.maxPurchase, confirmOver: c.confirmOver };
    // สาขาที่พนักงานคนนี้เลือกได้ (ร้านไม่มีสาขา = [] หน้าพนักงานไม่แสดงเรื่องสาขาเลย)
    const me = { role, branches: staffBranches(s) };
    const list = await branchList(ctx.db, shopId);
    const active = list.filter((b) => b.status === 'ACTIVE');
    out.hasBranches = active.length > 0;
    out.branches = active.filter((b) => staffCanUse(me, b.id)).map((b) => ({ id: b.id, name: b.name }));
    const names = V.branchNames(list);
    const tiers = await T.loadTiers(ctx.db, shopId);
    const on = T.tiersOn(tiers);
    out.rules = V.rulesOn(await loadRules(ctx.db, shopId), ctx.now).map((r) => V.publicRule(r, names, on ? tiers : null));
    // ร้านเปิดใช้ระดับ: หน้าพนักงานใช้ตัวคูณของแต่ละระดับคิดตัวอย่างแต้มก่อนกดบันทึก
    if (on) out.tiers = T.publicTiers(tiers);
  }
  return out;
}

// ค้นจาก QR หรือที่พิมพ์: รหัสคูปอง (CP-...) / เบอร์โทร / รหัสสมาชิก
// ร้านเปิดใช้ระดับ: ระดับของสมาชิกคนนี้ครบกำหนด → ปรับก่อนแสดง (คืนแถวสมาชิกที่เป็นปัจจุบัน)
async function freshTier(ctx, m, tiers) {
  if (!m || !T.tiersOn(tiers) || (m.tier_id && !(m.tier_until && m.tier_until < U.thaiDay(ctx.now)))) return m;
  return ctx.db.tx(async (q) => {
    const locked = await M.memberById(q, ctx.shop.id, m.id, true);
    await T.syncMember(q, ctx.shop.id, locked, tiers, ctx.now);
    return locked;
  });
}

async function staffLookup(p, ctx) {
  const q = String(p.query || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!q || q.length > 40) throw userError('กรุณาใส่รหัสสมาชิก เบอร์โทร หรือรหัสคูปอง', 'BAD_QUERY');
  const shopId = ctx.shop.id;
  const now = ctx.now;
  const tiers = await T.loadTiers(ctx.db, shopId);
  const tl = T.tiersOn(tiers) ? tiers : null;

  if (/^CP-[A-Z0-9]+$/.test(q)) {
    const cp = (await ctx.db.query(`select ${V.COUPON_COLS} from coupons where shop_id = $1 and code = $2`, [shopId, q])).rows[0];
    if (!cp) throw userError('ไม่พบคูปองรหัสนี้', 'NOT_FOUND');
    const owner = await freshTier(ctx, await M.memberById(ctx.db, shopId, cp.member_id), tiers);
    return { kind: 'coupon', coupon: V.publicCoupon(cp, now), member: owner ? V.staffMember(owner, tl) : null };
  }

  let m = null;
  if (/^[0-9+\-]+$/.test(q)) {
    const phone = U.normalizePhone(q);
    if (phone) m = (await ctx.db.query(`select ${V.MEMBER_COLS} from members where shop_id = $1 and phone = $2`, [shopId, phone])).rows[0] || null;
  }
  if (!m) m = await M.memberById(ctx.db, shopId, q);
  if (!m) throw userError('ไม่พบสมาชิก', 'NOT_FOUND');
  m = await freshTier(ctx, m, tiers);

  const coupons = (await ctx.db.query(`select ${V.COUPON_COLS} from coupons where shop_id = $1 and member_id = $2 order by issued_at desc limit 100`,
    [shopId, m.id])).rows.map((cp) => V.publicCoupon(cp, now)).filter((cp) => cp.status === 'ACTIVE');
  return { kind: 'member', member: V.staffMember(m, tl), coupons };
}

// บันทึกยอดซื้อ: ระบบคิดแต้มเอง และบันทึกทุกบิล (แม้ไม่ถึงเกณฑ์) เพื่อให้รู้ยอดซื้อสะสมจริง
async function addPurchase(p, ctx) {
  const c = cfg(ctx.shop);
  const memberId = U.cleanMemberId(p.memberId);
  const amount = U.round2(Number(p.amount));
  if (!isFinite(amount) || amount <= 0) throw userError('กรุณาใส่ยอดซื้อมากกว่า 0 บาท', 'BAD_AMOUNT');
  if (amount > c.maxPurchase) {
    throw userError('ยอดซื้อเกิน ' + U.fmtNum(c.maxPurchase) + ' บาทต่อบิล (ถ้าถูกต้อง ให้เจ้าของร้านปรับ "ยอดซื้อสูงสุดต่อบิล" ในหลังบ้าน เมนูตั้งค่าร้าน)', 'OVER_MAX');
  }
  const note = U.cleanNote(p.note);
  const basePoints = Math.floor(amount / c.pointRate + 1e-9);
  const branch = await resolveStaffBranch(ctx, p);
  const rules = await loadRules(ctx.db, ctx.shop.id);
  const tiers = await T.loadTiers(ctx.db, ctx.shop.id);
  const on = T.tiersOn(tiers);
  const shopId = ctx.shop.id;

  return once(ctx, 'addPurchase', p.requestId, async (q, reqId) => {
    const m = await M.memberById(q, shopId, memberId, true);
    const dup = (await q.query('select member_id, amount::float8 as amount, points, balance_after from transactions where shop_id = $1 and request_id = $2',
      [shopId, reqId])).rows[0];
    if (dup) {
      const dm = await M.memberById(q, shopId, dup.member_id);
      return { duplicate: true, amount: U.toNum(dup.amount), pointsAdded: U.toInt(dup.points), balance: U.toInt(dup.balance_after), member: dm ? V.staffMember(dm) : null };
    }
    if (!m) throw userError('ไม่พบสมาชิก', 'NOT_FOUND');
    M.assertActiveMember(m);

    const now = ctx.now;
    // ระดับที่ครบกำหนดลดก่อน แล้วค่อยคิดแต้ม (ระดับเก่าที่หมดอายุแล้วต้องไม่ได้ตัวคูณ)
    await T.syncMember(q, shopId, m, tiers, now);
    const tier = on ? T.tierById(tiers, m.tier_id) || tiers[0] : null;
    // แต้มพิเศษกับตัวคูณของระดับไม่ซ้อนกัน ใช้ตัวที่มากกว่า (ผู้ใช้ตกลง 6 พ.ย. 2569) / เท่ากัน → ใช้ชื่อกติกา (บอกเหตุผลชัดกว่า)
    const rule = bestRule(rules, now, branch, amount, on ? { tiers, tierId: m.tier_id } : null);
    const ruleMult = rule ? rule.multiplier : 1;
    const tierMult = tier ? tier.multiplier : 1;
    const byTier = tierMult > ruleMult;
    const mult = Math.max(ruleMult, tierMult);
    const points = mult > 1 ? Math.floor(basePoints * mult + 1e-9) : basePoints;
    const applied = points > basePoints ? (byTier ? { id: tier.id, name: 'ระดับ ' + tier.name, multiplier: tierMult } : rule) : null;
    const balance = U.toInt(m.points) + points;
    const spend = U.round2(U.toNum(m.total_spend) + amount);
    const visits = U.toInt(m.visit_count) + 1;
    await q.query('update members set points = $3, total_spend = $4, visit_count = $5, last_visit_at = $6 where shop_id = $1 and id = $2',
      [shopId, memberId, balance, spend, visits, now]);

    const base = note || ('ซื้อสินค้า ' + U.fmtMoney(amount) + ' บาท' + (points ? '' : ' (ไม่ถึงเกณฑ์รับแต้ม)'));
    // ชื่อกติกา (หรือ "ระดับ Gold") ต่อท้าย ลูกค้าเห็นในประวัติว่าได้พิเศษเพราะอะไร / รหัสเก็บใน ref ไว้ดูย้อนหลัง
    const detail = applied ? base + ' · ' + applied.name : base;
    const txId = M.newTxId();
    await q.query(`insert into transactions (shop_id, id, created_at, member_id, type, amount, points, balance_after, detail, staff, request_id, ref, branch)
                   values ($1, $2, $3, $4, 'EARN', $5, $6, $7, $8, $9, $10, $11, $12)`,
      [shopId, txId, now, memberId, amount, points, balance, detail, ctx.staff.name, reqId, applied ? applied.id : '', branch]);

    Object.assign(m, { points: balance, total_spend: spend, visit_count: visits, last_visit_at: now });
    // ยอด 12 เดือนถึงเกณฑ์ระดับที่สูงกว่า → ขึ้นทันที (บิลนี้คิดแต้มตามระดับเดิม บิลถัดไปได้ตัวคูณใหม่)
    const up = on ? (await T.syncMember(q, shopId, m, tiers, now, { upgrade: true, by: ctx.staff.name })).up : null;
    const out = {
      txId, amount, pointsAdded: points, basePoints, balance, member: V.staffMember(m, on ? tiers : null),
      rule: applied ? { name: applied.name, multiplier: applied.multiplier } : null
    };
    if (up) out.tierUp = { id: up.id, name: up.name, color: up.color };
    return out;
  });
}

// ใช้คูปอง: ทำได้เฉพาะพนักงาน (ลูกค้ากดใช้เองไม่ได้ เพื่อให้หน้าร้านตรวจได้จริง)
async function useCoupon(p, ctx) {
  const code = String(p.code || '').trim().toUpperCase();
  if (!/^CP-[A-Z0-9]{4,20}$/.test(code)) throw userError('รหัสคูปองไม่ถูกต้อง', 'BAD_CODE');
  const branch = await resolveStaffBranch(ctx, p);
  const shopId = ctx.shop.id;

  return once(ctx, 'useCoupon', p.requestId, async (q) => {
    // จองแถวตามลำดับเดียวกับคำสั่งอื่น: เจ้าของคูปองก่อน แล้วค่อยคูปอง (กันค้างรอกันเอง)
    const peek = (await q.query('select member_id from coupons where shop_id = $1 and code = $2', [shopId, code])).rows[0];
    if (!peek) throw userError('ไม่พบคูปองรหัสนี้', 'NOT_FOUND');
    const owner = await M.memberById(q, shopId, peek.member_id, true);
    const cp = (await q.query(`select ${V.COUPON_COLS} from coupons where shop_id = $1 and code = $2 for update`, [shopId, code])).rows[0];
    const now = ctx.now;
    const state = V.couponState(cp, now);
    if (state === 'USED') throw userError('คูปองนี้ถูกใช้ไปแล้วเมื่อ ' + U.fmtDateTime(cp.used_at), 'USED');
    if (state === 'EXPIRED') throw userError('คูปองนี้หมดอายุแล้ว', 'EXPIRED');
    if (state !== 'ACTIVE') throw userError('คูปองนี้ใช้ไม่ได้', 'INVALID_COUPON');
    if (owner) M.assertActiveMember(owner);

    await q.query(`update coupons set status = 'USED', used_at = $3, used_by = $4, used_branch = $5 where shop_id = $1 and code = $2`,
      [shopId, code, now, ctx.staff.name, branch]);
    Object.assign(cp, { status: 'USED', used_at: now, used_by: ctx.staff.name, used_branch: branch });
    const tiers = await T.loadTiers(q, shopId);
    return { coupon: V.publicCoupon(cp, now), member: owner ? V.staffMember(owner, T.tiersOn(tiers) ? tiers : null) : null };
  });
}

// ปรับแต้ม (แก้รายการผิด ชดเชย ฯลฯ): เฉพาะ OWNER / ADMIN และต้องมีเหตุผลเสมอ
async function adjustPoints(p, ctx) {
  const memberId = U.cleanMemberId(p.memberId);
  const delta = Number(p.points);
  if (!isFinite(delta) || Math.floor(delta) !== delta || delta === 0 || Math.abs(delta) > 1000000) {
    throw userError('จำนวนแต้มต้องเป็นจำนวนเต็ม และไม่เป็น 0', 'BAD_POINTS');
  }
  const reason = U.cleanNote(p.reason);
  if (reason.length < 3) throw userError('กรุณาใส่เหตุผลในการปรับแต้ม', 'NO_REASON');
  const branch = p.branchId ? await resolveStaffBranch(ctx, p)
    : ((await M.activeBranches(ctx.db, ctx.shop.id)).length ? V.BRANCH_ADMIN : '');
  const shopId = ctx.shop.id;

  return once(ctx, 'adjustPoints', p.requestId, async (q, reqId) => {
    const m = await M.memberById(q, shopId, memberId, true);
    const dup = (await q.query('select points, balance_after from transactions where shop_id = $1 and request_id = $2', [shopId, reqId])).rows[0];
    if (dup) return { duplicate: true, pointsAdded: U.toInt(dup.points), balance: U.toInt(dup.balance_after) };
    if (!m) throw userError('ไม่พบสมาชิก', 'NOT_FOUND');
    const balance = U.toInt(m.points) + delta;
    if (balance < 0) throw userError('ปรับแล้วแต้มติดลบไม่ได้ (มีอยู่ ' + U.fmtNum(U.toInt(m.points)) + ' แต้ม)', 'NEGATIVE');

    await q.query('update members set points = $3 where shop_id = $1 and id = $2', [shopId, memberId, balance]);
    await q.query(`insert into transactions (shop_id, id, created_at, member_id, type, amount, points, balance_after, detail, staff, request_id, branch)
                   values ($1, $2, $3, $4, 'ADJUST', 0, $5, $6, $7, $8, $9, $10)`,
      [shopId, M.newTxId(), ctx.now, memberId, delta, balance, 'ปรับแต้ม: ' + reason, ctx.staff.name, reqId, branch]);
    m.points = balance;
    const tiers = await T.loadTiers(q, shopId);
    return { pointsAdded: delta, balance, member: V.staffMember(m, T.tiersOn(tiers) ? tiers : null) };
  });
}

// รายการล่าสุดของร้าน 15 รายการ (ให้พนักงานตรวจสิ่งที่เพิ่งบันทึก) — มีสาขา: เฉพาะสาขาที่เลือกอยู่
async function staffRecent(p, ctx) {
  const branch = p.branchId ? await resolveStaffBranch(ctx, p) : '';
  const r = await ctx.db.query(
    `select t.id, t.created_at, t.type, t.amount::float8 as amount, t.points, t.balance_after, t.detail, t.member_id, t.staff, m.name as member_name
     from transactions t left join members m on m.shop_id = t.shop_id and m.id = t.member_id
     where t.shop_id = $1 and ($2::text = '' or t.branch = $2::text)
     order by t.created_at desc limit 15`, [ctx.shop.id, branch]);
  return {
    items: r.rows.map((t) => {
      const o = V.publicTx(t);
      o.memberId = String(t.member_id || '');
      o.memberName = String(t.member_name || '');
      o.staff = String(t.staff || '');
      return o;
    })
  };
}

module.exports = {
  ROLES, ALL_STAFF, MANAGERS, branchList, staffBranches, staffCanUse, resolveStaffBranch, requireStaff, bestRule, loadRules,
  staffMe, staffLookup, addPurchase, useCoupon, adjustPoints, staffRecent
};
