// แปลงแถวในฐานข้อมูล → ข้อมูลที่ส่งให้หน้าเว็บ (เดิม: ส่วนที่ 5 ของ code.gs)
// ชื่อช่องและรูปแบบค่าต้องเหมือนของเดิมทุกตัว หน้าเว็บจึงไม่ต้องแก้ — api-diff-test.js เทียบให้
const U = require('./util');
const T = require('./tiers');

const REWARD_BIRTHDAY = 'BIRTHDAY';
const BIRTH_SELF_EDITS = 1; // ลูกค้าแก้วันเกิดเองได้ 1 ครั้ง (กันเปลี่ยนเพื่อรับสิทธิ์วันเกิดซ้ำ)
const RULE_MULTIPLIERS = [1.5, 2, 3];
const BRANCH_ONLINE = 'ONLINE'; // ลูกค้าสมัครเองโดยไม่ได้สแกน QR ของสาขา
const BRANCH_ADMIN = 'ADMIN';   // ปรับแต้มจากหลังบ้าน

// คอลัมน์สมาชิกที่ทุกคำสั่งอ่าน — วันเกิดออกมาเป็นข้อความ yyyy-MM-dd เสมอ (pg แปลงช่อง date เป็นเวลาท้องถิ่นของเครื่อง ซึ่งเพี้ยนได้)
const MEMBER_COLS = `id, line_user_id, name, first_name, last_name, phone,
  to_char(birth_date, 'YYYY-MM-DD') as birth_date, birth_date_edits, picture, points,
  total_spend::float8 as total_spend, visit_count, tier_id, tier_since, to_char(tier_until, 'YYYY-MM-DD') as tier_until,
  joined_at, last_visit_at, status, marketing_consent, joined_branch, note`;

const REWARD_COLS = `id, name, description, type, points, image, valid_days, quota, issued, limit_per_member,
  to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date, sort, status, min_tier_id`;

const COUPON_COLS = 'code, member_id, reward_id, name, points_used, issued_at, expires_at, used_at, used_by, used_branch, status, tx_id, birthday_year';

// tiers = ระดับของร้าน (ส่งมาเมื่อร้านเปิดใช้ระดับ) → ใส่ชื่อระดับในช่อง tier
function publicMember(m, tiers) {
  const first = String(m.first_name || '');
  return {
    memberId: String(m.id || ''),
    name: String(m.name || ''),
    // สมาชิกรุ่นแรกที่ยังไม่มีช่องนามสกุล: ชื่อเต็มอยู่ใน name → ใส่ช่องชื่อ ให้ลูกค้าแยกนามสกุลเองตอนแก้
    firstName: first || String(m.name || ''),
    lastName: first ? String(m.last_name || '') : '',
    marketingConsent: m.marketing_consent === true,
    birthLocked: !!m.birth_date && U.toInt(m.birth_date_edits) >= BIRTH_SELF_EDITS,
    phone: String(m.phone || ''),
    birthDate: String(m.birth_date || ''),
    picture: U.safeUrl(m.picture),
    points: U.toInt(m.points),
    totalSpend: U.toNum(m.total_spend),
    visitCount: U.toInt(m.visit_count),
    tier: tierName(tiers, m),
    joinedAt: U.iso(m.joined_at),
    status: U.upper(m.status) || 'ACTIVE'
  };
}

// พนักงานเห็นเบอร์แค่ 4 ตัวท้าย (พอให้ถามยืนยันตัวตนลูกค้าได้)
function staffMember(m, tiers) {
  const phone = String(m.phone || '');
  const o = {
    memberId: String(m.id || ''),
    name: String(m.name || ''),
    phoneMasked: phone ? 'xxx-xxx-' + phone.slice(-4) : '',
    points: U.toInt(m.points),
    totalSpend: U.toNum(m.total_spend),
    visitCount: U.toInt(m.visit_count),
    tier: tierName(tiers, m),
    status: U.upper(m.status) || 'ACTIVE',
    lastVisitAt: U.iso(m.last_visit_at)
  };
  // ร้านเปิดใช้ระดับ: ใส่รหัส สี ตัวคูณ ให้หน้าพนักงานคิดตัวอย่างแต้ม / หลังบ้านกรอง
  if (T.tiersOn(tiers)) {
    const t = T.tierById(tiers, m.tier_id) || tiers[0];
    Object.assign(o, { tierId: t.id, tierColor: t.color, tierMultiplier: t.multiplier });
  }
  return o;
}

function tierName(tiers, m) {
  if (!T.tiersOn(tiers)) return '';
  const t = T.tierById(tiers, m.tier_id) || tiers[0];
  return t.name;
}

// ช่องระดับขั้นต่ำของของรางวัล/โปรโมชัน (เฉพาะร้านที่เปิดใช้ระดับ): minTier + ล็อกไหม (ผู้ใช้เลือก: แสดงแต่ล็อก)
function tierLock(o, row, tc) {
  if (!tc || !T.tiersOn(tc.tiers)) return o;
  o.minTier = T.tierBrief(tc.tiers, row.min_tier_id);
  o.locked = !T.meets(tc.tiers, tc.tierId, row.min_tier_id);
  return o;
}

function publicTx(t) {
  return {
    id: String(t.id || ''),
    date: U.iso(t.created_at),
    type: U.upper(t.type),
    amount: U.toNum(t.amount),
    points: U.toInt(t.points),
    balance: U.toInt(t.balance_after),
    detail: String(t.detail || '')
  };
}

function couponState(cp, now) {
  const st = U.upper(cp.status) || 'ACTIVE';
  if (st !== 'ACTIVE') return st;
  const exp = U.toDate(cp.expires_at);
  return exp && exp.getTime() < now.getTime() ? 'EXPIRED' : 'ACTIVE';
}

function publicCoupon(cp, now) {
  return {
    code: String(cp.code || ''),
    rewardId: String(cp.reward_id || ''),
    name: String(cp.name || ''),
    pointsUsed: U.toInt(cp.points_used),
    issuedAt: U.iso(cp.issued_at),
    expiresAt: U.iso(cp.expires_at),
    usedAt: U.iso(cp.used_at),
    status: couponState(cp, now)
  };
}

// ของรางวัลที่ลูกค้าแลกด้วยแต้มได้ตอนนี้ (ไม่รวมของขวัญวันเกิด)
function listRewards(rows, now, tc) {
  return (rows || [])
    .filter((r) => r.id && U.upper(r.status) === 'ACTIVE' && U.toInt(r.points) > 0 && U.upper(r.type) !== REWARD_BIRTHDAY &&
      U.inWindow(r.start_date, r.end_date, now))
    .map((r) => {
      const quota = U.toInt(r.quota);
      return tierLock({
        id: String(r.id),
        name: String(r.name || ''),
        description: String(r.description || ''),
        points: U.toInt(r.points),
        image: U.safeUrl(U.driveImage(r.image)),
        remaining: quota > 0 ? Math.max(0, quota - U.toInt(r.issued)) : null,
        limitPerMember: U.toInt(r.limit_per_member) || null,
        endDate: U.iso(r.end_date),
        sort: U.toInt(r.sort)
      }, r, tc);
    })
    .sort((a, b) => (a.sort - b.sort) || (a.points - b.points));
}

function listPromos(rows, now, tc) {
  return (rows || [])
    .filter((r) => r.id && U.upper(r.status) === 'ACTIVE' && U.inWindow(r.start_date, r.end_date, now))
    .map((r) => tierLock({
      id: String(r.id),
      title: String(r.title || ''),
      subtitle: String(r.subtitle || ''),
      tag: String(r.tag || ''),
      image: U.safeUrl(U.driveImage(r.image)),
      link: U.safeUrl(r.link),
      sort: U.toInt(r.sort)
    }, r, tc))
    .sort((a, b) => a.sort - b.sort);
}

// ---------- แต้มพิเศษ ----------
function ruleFromRow(r) {
  const days = (Array.isArray(r.days) ? r.days : []).map(U.upper).filter((d) => U.DAY_CODES.indexOf(d) >= 0);
  const mult = Number(r.multiplier);
  return {
    id: String(r.id),
    name: String(r.name || ''),
    multiplier: RULE_MULTIPLIERS.indexOf(mult) >= 0 ? mult : 1,
    days: days.length ? days : U.DAY_CODES.slice(),
    startDate: r.start_date || '',
    endDate: r.end_date || '',
    branch: U.upper(r.branch),
    minAmount: U.toNum(r.min_amount),
    showBadge: r.show_badge === true,
    status: U.upper(r.status) === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
    minTierId: r.min_tier_id || ''
  };
}

// กติกาที่เปิดอยู่และมีผลในวันนั้น (ยังไม่ดูสาขา/ยอดซื้อ)
function rulesOn(rules, now) {
  const day = U.dayCode(now);
  return rules.filter((r) => r.status === 'ACTIVE' && r.multiplier > 1 && r.days.indexOf(day) >= 0 && U.inWindow(r.startDate, r.endDate, now));
}

function branchNames(branches) {
  const names = {};
  (branches || []).forEach((b) => { names[U.upper(b.id)] = String(b.name || ''); });
  names[BRANCH_ONLINE] = 'ออนไลน์';
  names[BRANCH_ADMIN] = 'หลังบ้าน';
  return names;
}

// tiers (เมื่อร้านเปิดใช้ระดับ) → บอกระดับขั้นต่ำของกติกาด้วย (หน้าพนักงานคิดตัวอย่างแต้มตามระดับลูกค้า)
function publicRule(r, names, tiers) {
  const o = { id: r.id, name: r.name, multiplier: r.multiplier, branch: r.branch, branchName: r.branch ? names[r.branch] || '' : '', minAmount: r.minAmount };
  if (T.tiersOn(tiers)) {
    const t = T.tierById(tiers, r.minTierId);
    o.minTierId = t ? t.id : '';
    o.minTierName = t ? t.name : '';
  }
  return o;
}

module.exports = {
  REWARD_BIRTHDAY, BIRTH_SELF_EDITS, RULE_MULTIPLIERS, BRANCH_ONLINE, BRANCH_ADMIN, MEMBER_COLS, REWARD_COLS, COUPON_COLS,
  publicMember, staffMember, publicTx, couponState, publicCoupon, listRewards, listPromos, ruleFromRow, rulesOn, branchNames, publicRule, tierName
};
