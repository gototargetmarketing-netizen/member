// ระดับสมาชิก (ขั้น 4) — กติกาที่ผู้ใช้ตกลง 6 พ.ย. 2569 (+ 7 พ.ย. 2569: เปลี่ยนจากยอดเงินเป็นแต้ม)
//   • ระดับคิดจาก "แต้มจากการซื้อ" 12 เดือนล่าสุด = แต้มปกติของบิลซื้อ (transactions.base_points)
//     ไม่นับแต้มพิเศษ / ตัวคูณของระดับ / แต้มต้อนรับ / แต้มที่ร้านปรับ และแลกของรางวัลแล้วไม่ลด
//     (นับตัวคูณด้วยจะดันกันเอง: Gold ×2 รักษาระดับได้ด้วยยอดครึ่งเดียว)
//   • ร้านตั้ง 2–5 ระดับ / ระดับแรกเริ่มที่ 0 แต้ม (ทุกคนอย่างน้อยอยู่ระดับแรก)
//   • ถึงเกณฑ์ → ขึ้นทันที แล้วคงระดับ 12 เดือน (tier_until) / ครบกำหนดแล้วแต้ม 12 เดือนไม่ถึงเกณฑ์ระดับนั้น → ลดลง 1 ระดับ
//     (ถึงเกณฑ์ → ต่ออีก 12 เดือน) / ระดับแรกไม่มีวันหมดอายุ
//   • ตัวคูณแต้มของระดับ ไม่ซ้อนกับแต้มพิเศษ ใช้ตัวที่มากกว่า
//   • ของรางวัล / โปรโมชัน / แต้มพิเศษ ตั้ง "ตั้งแต่ระดับนี้ขึ้นไป" ได้ (min_tier_id) — ผู้ใช้เลือก: ของที่ระดับไม่ถึง แสดงแต่ล็อก
//   • ของขวัญวันเกิด: ได้ชิ้นของระดับสูงสุดที่ตัวเองถึง
// ร้านที่มีระดับไม่ถึง 2 ระดับ = ไม่ได้เปิดใช้ → ทุกอย่างทำงานเหมือนก่อนมีระดับ (ไม่มีช่องใหม่ในคำตอบ)
//
// ลดระดับไม่ต้องตั้งงานรายวัน: ตรวจตอนมีคนเปิดใช้งาน (หน้าลูกค้า / พนักงานค้น / หลังบ้าน) ผลเหมือนกัน
const U = require('./util');

const TIER_MULTS = [1, 1.5, 2, 3];
const MIN_TIERS = 2;
const MAX_TIERS = 5;
const KEEP_MONTHS = 12;

const TIER_SQL = `select id, name, min_points, point_multiplier::float8 as multiplier, color, image, benefits
  from tiers where shop_id = $1 and status = 'ACTIVE' order by min_points, id`;

// สิทธิพิเศษที่ร้านเขียนเก็บเป็นข้อความบรรทัดละข้อ
const benefitLines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

async function loadTiers(q, shopId) {
  return (await q.query(TIER_SQL, [shopId])).rows.map((t, i) => ({
    id: t.id, name: String(t.name || ''), minPoints: U.toInt(t.min_points), multiplier: U.toNum(t.multiplier) || 1, color: t.color || '',
    image: U.safeUrl(t.image), benefits: benefitLines(t.benefits), rank: i
  }));
}

const tiersOn = (tiers) => !!tiers && tiers.length >= MIN_TIERS;
const tierById = (tiers, id) => (tiers || []).find((t) => t.id === id) || null;
// ระดับที่แต้มนี้ถึง (สูงสุด) — tiers เรียงเกณฑ์น้อย → มาก และระดับแรก = 0 แต้ม
const qualify = (tiers, pts) => tiers.reduce((best, t) => (pts >= t.minPoints ? t : best), tiers[0]);
// สมาชิกที่ยังไม่มีระดับ ถือเป็นระดับแรก
const rankOf = (tiers, tierId) => { const t = tierById(tiers, tierId); return t ? t.rank : 0; };

// สมาชิกระดับนี้ได้สิทธิ์ของที่ตั้ง "ตั้งแต่ระดับ minTierId ขึ้นไป" ไหม (ไม่ได้ตั้ง / ร้านปิดระดับ = ได้ทุกคน)
function meets(tiers, memberTierId, minTierId) {
  if (!minTierId || !tiersOn(tiers)) return true;
  const need = tierById(tiers, minTierId);
  return !need || rankOf(tiers, memberTierId) >= need.rank;
}

// วันที่ yyyy-MM-dd + n เดือน (31 ม.ค. + 1 เดือน = 28/29 ก.พ.)
function addMonths(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return first.toISOString().slice(0, 8) + String(Math.min(d, last)).padStart(2, '0');
}

// แต้มจากการซื้อของบิลเดียว: ใช้ที่จดไว้ตอนบันทึก / บิลที่ไม่มี (ก่อนมีช่องนี้) คิดจากอัตราแต้มปัจจุบันของร้าน
// ใช้ใน SQL ที่ join shops เป็น s และ transactions เป็น t
const BASE_POINTS_SQL = 'coalesce(t.base_points, floor(t.amount / s.point_rate_baht))';

// แต้มจากการซื้อ 12 เดือนก่อนเวลา asOf (นับเฉพาะบิลซื้อ)
async function points12m(q, shopId, memberId, asOf) {
  const r = await q.query(`select coalesce(sum(${BASE_POINTS_SQL}), 0)::int as p from transactions t join shops s on s.id = t.shop_id
    where t.shop_id = $1 and t.member_id = $2 and t.type = 'EARN' and t.created_at > ($3::timestamptz - interval '12 months') and t.created_at <= $3`,
  [shopId, memberId, asOf]);
  return U.toInt(r.rows[0].p);
}

// ระดับแรกไม่มีวันหมดอายุ / ระดับอื่นคง 12 เดือนนับจากวันนี้
const untilFor = (tier, day) => (tier.rank === 0 ? null : addMonths(day, KEEP_MONTHS));

// ปรับระดับของสมาชิก 1 คนให้เป็นปัจจุบัน — m = แถวสมาชิกที่จองไว้แล้ว (for update) มี tier_id / tier_until
// opt.upgrade: ตรวจขึ้นระดับด้วย (หลังบันทึกยอดซื้อ / หลังร้านลดเกณฑ์) / opt.by: ใครทำ (จดในประวัติ)
// คืน { tier, up } และบันทึกลงตาราง (เฉพาะเมื่อเปลี่ยน)
async function syncMember(q, shopId, m, tiers, now, opt = {}) {
  if (!tiersOn(tiers)) return { tier: null, up: null };
  if (U.upper(m && m.status) === 'DELETED') return { tier: null, up: null }; // ลบบัญชีแล้ว: ไม่ปรับระดับ ไม่จดประวัติเพิ่ม
  const today = U.thaiDay(now);
  let tier = tierById(tiers, m.tier_id);
  let until = m.tier_until || null;
  let since = m.tier_since || null;
  const history = [];
  let up = null;

  if (!tier) {
    // ยังไม่มีระดับ (ร้านเพิ่งเปิดใช้ / ระดับเดิมถูกเอาออก) → ตามแต้ม 12 เดือนตอนนี้
    const pts = await points12m(q, shopId, m.id, now);
    tier = qualify(tiers, pts);
    history.push({ at: now, from: m.tier_id || null, to: tier.id, reason: m.tier_id ? 'ADMIN' : 'START', pts });
    since = now;
    until = untilFor(tier, today);
  }

  // ครบกำหนดแล้ว (อาจหลายรอบถ้าไม่ได้มาเลยนาน): แต้ม 12 เดือนก่อนวันครบ ไม่ถึงเกณฑ์ → ลด 1 ระดับ / ถึง → ต่ออีก 12 เดือน
  for (let i = 0; until && until < today && i < 50; i++) {
    const asOf = new Date(until + 'T23:59:59.999+07:00');
    const pts = await points12m(q, shopId, m.id, asOf);
    if (pts < tier.minPoints && tier.rank > 0) {
      const lower = tiers[tier.rank - 1];
      history.push({ at: asOf, from: tier.id, to: lower.id, reason: 'DOWN', pts });
      tier = lower;
      since = asOf;
      until = lower.rank === 0 ? null : addMonths(until, KEEP_MONTHS);
    } else {
      until = addMonths(until, KEEP_MONTHS);
    }
  }

  if (opt.upgrade) {
    const pts = await points12m(q, shopId, m.id, now);
    const best = qualify(tiers, pts);
    if (best.rank > tier.rank) {
      history.push({ at: now, from: tier.id, to: best.id, reason: 'UP', pts, by: opt.by });
      tier = best;
      since = now;
      until = untilFor(best, today);
      up = best;
    }
  }

  const changed = tier.id !== m.tier_id || (until || null) !== (m.tier_until || null);
  if (changed) {
    await q.query('update members set tier_id = $3, tier_since = $4, tier_until = $5::date where shop_id = $1 and id = $2',
      [shopId, m.id, tier.id, since, until]);
    for (const h of history) {
      await q.query(`insert into tier_history (shop_id, created_at, member_id, from_tier_id, to_tier_id, reason, points_12m, by_name)
        values ($1, $2, $3, $4, $5, $6, $7, $8)`, [shopId, h.at, m.id, h.from, h.to, h.reason, h.pts, h.by || opt.by || 'ระบบ']);
    }
    Object.assign(m, { tier_id: tier.id, tier_since: since, tier_until: until });
  }
  return { tier, up };
}

// สมาชิกที่ระดับครบกำหนดแล้ว (หรือยังไม่มีระดับ) ทั้งร้าน → ปรับให้เป็นปัจจุบันก่อนหลังบ้านนับ/กรอง
async function syncDue(db, shopId, tiers, now) {
  if (!tiersOn(tiers)) return 0;
  const today = U.thaiDay(now);
  const due = await db.query(`select id from members where shop_id = $1 and status <> 'DELETED' and (tier_id is null or tier_until < $2::date)`, [shopId, today]); // ลบแล้วไม่ต้องคิดระดับ
  for (const row of due.rows) {
    await db.tx(async (q) => {
      const m = (await q.query(`select id, tier_id, tier_since, to_char(tier_until, 'YYYY-MM-DD') as tier_until from members
        where shop_id = $1 and id = $2 for update`, [shopId, row.id])).rows[0];
      if (m) await syncMember(q, shopId, m, tiers, now);
    });
  }
  return due.rows.length;
}

// ข้อมูลระดับที่ส่งให้หน้าลูกค้า (ระดับตอนนี้ + ระดับถัดไป + แต้มที่ยังขาด)
function tierInfo(tiers, m, pts) {
  const t = tierById(tiers, m.tier_id) || tiers[0];
  const next = tiers[t.rank + 1] || null;
  pts = U.toInt(pts);
  return {
    id: t.id, name: t.name, color: t.color, multiplier: t.multiplier, until: m.tier_until || '', points12m: pts,
    next: next ? { id: next.id, name: next.name, minPoints: next.minPoints, remaining: Math.max(0, next.minPoints - pts) } : null
  };
}

const publicTiers = (tiers) => tiers.map((t) => ({ id: t.id, name: t.name, minPoints: t.minPoints, multiplier: t.multiplier, color: t.color,
  image: t.image, benefits: t.benefits }));
const tierBrief = (tiers, id) => { const t = tierById(tiers, id); return t ? { id: t.id, name: t.name, color: t.color } : null; };

module.exports = {
  TIER_MULTS, MIN_TIERS, MAX_TIERS, KEEP_MONTHS, BASE_POINTS_SQL, loadTiers, tiersOn, tierById, qualify, rankOf, meets, addMonths, points12m, benefitLines,
  untilFor, syncMember, syncDue, tierInfo, publicTiers, tierBrief
};
