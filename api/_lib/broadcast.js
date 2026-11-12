// ส่งข้อความตามกลุ่ม (ผู้ใช้เลือกแบบ ข 12 พ.ย. 2569 — ร้านส่งข้อความหาลูกค้าผ่าน LINE OA ของร้านได้จากหลังบ้าน)
// รอบ 1 (ไฟล์นี้ตอนนี้): คัดกลุ่มลูกค้า → นับจำนวน + ตัวอย่างรายชื่อ
// รอบ 2: เขียนข้อความ + ส่งจริง (ต้องมีรหัสส่งข้อความของ OA ร้านใน Vercel) / รอบ 3: สถานะเพื่อน OA
//
// หลัก:
// - ส่งได้เฉพาะลูกค้าที่ "ยินยอมรับข่าวสาร" + ไม่ถูกระงับ + สมัครผ่าน LINE — กรองที่นี่เสมอ หน้าเว็บปิดไม่ได้ (PDPA)
// - LINE ID ของลูกค้าไม่ออกจากตัวกลาง (ตัวอย่างรายชื่อไม่มี LINE ID / เบอร์) — รอบ 2 ตัวกลางส่งเอง
// - เงื่อนไขทุกข้อต้องตรงพร้อมกัน (และ) / ช่องที่เว้นว่าง = ไม่กรองข้อนั้น
'use strict';
const { userError } = require('./errors');
const U = require('./util');
const T = require('./tiers');

const PREVIEW = 20;
const MAX_DAYS = 3650; // 10 ปี
const MAX_IDS = 50;    // ระดับ/สาขาที่เลือกได้ต่อครั้ง (ร้านมีระดับไม่เกิน 5 สาขาไม่เกิน 50)

// ส่งได้ = 3 เงื่อนไขนี้ครบ (ใช้ทั้งตอนนับ และรอบ 2 ตอนส่งจริง)
const SENDABLE_SQL = `status = 'ACTIVE' and marketing_consent and line_user_id is not null`;

const blank = (v) => String(v == null ? '' : v).replace(/,/g, '').trim() === '';
function num(v, max, label) {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!isFinite(n) || Math.floor(n) !== n || n < 0 || n > max) throw userError(label + 'ต้องเป็นจำนวนเต็ม 0–' + U.fmtNum(max), 'BAD_INPUT');
  return n;
}
function days(v, label) {
  if (blank(v)) return null;
  const n = num(v, MAX_DAYS, label);
  if (n < 1) throw userError(label + 'ต้องเป็น 1–' + U.fmtNum(MAX_DAYS) + ' วัน', 'BAD_INPUT');
  return n;
}
// ตั้งแต่ … ถึง … (เว้นว่างข้างใดข้างหนึ่งได้)
function range(f, key, max, label) {
  const lo = num(f[key + 'Min'], max, label);
  const hi = num(f[key + 'Max'], max, label);
  if (lo != null && hi != null && lo > hi) throw userError(label + ': ค่าเริ่มต้องไม่มากกว่าค่าสิ้นสุด', 'BAD_INPUT');
  return [lo, hi];
}
function idList(v, re, label) {
  if (v == null || v === '') return [];
  if (!Array.isArray(v) || v.length > MAX_IDS) throw userError(label + 'ไม่ถูกต้อง', 'BAD_INPUT');
  return [...new Set(v.map((x) => U.upper(x)))].map((x) => {
    if (!re.test(x)) throw userError(label + 'ไม่ถูกต้อง', 'BAD_INPUT');
    return x;
  });
}

// เงื่อนไขจากหน้าเว็บ → ค่าที่ตรวจแล้ว (ผิด = แจ้งผู้ใช้ ไม่เดาแทน)
function cleanFilter(raw, tiers, now) {
  const f = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // ระดับ: ต้องเป็นระดับที่ร้านนี้มีอยู่จริง (ร้านปิดใช้ระดับ → ไม่สนช่องนี้)
  const tierIds = T.tiersOn(tiers) ? idList(f.tiers, /^T\d{1,3}$/, 'ระดับ') : [];
  if (tierIds.some((id) => !T.tierById(tiers, id))) throw userError('ระดับที่เลือกไม่มีแล้ว กรุณาโหลดหน้าใหม่', 'BAD_TIER');
  // สาขาที่สมัคร: ตรวจแค่รูปแบบ (รหัสที่ไม่มีจริงก็แค่ไม่เจอใคร — แบบเดียวกับตัวกรองสาขาในหน้ารายชื่อ)
  const branches = idList(f.branches, /^[A-Z0-9]{1,12}$/, 'สาขา');
  const month = blank(f.birthMonth) ? 0 : num(f.birthMonth, 12, 'เดือนเกิด');
  if (month === 0 && !blank(f.birthMonth)) throw userError('เดือนเกิดไม่ถูกต้อง', 'BAD_INPUT');
  const [pointsMin, pointsMax] = range(f, 'points', 1e9, 'แต้มคงเหลือ');
  const [spendMin, spendMax] = range(f, 'spend', 1e10, 'ยอดซื้อรวม');
  const [visitsMin, visitsMax] = range(f, 'visits', 1e7, 'จำนวนครั้งที่มา');
  const ago = (n) => (n == null ? null : new Date(now.getTime() - n * U.DAY_MS));
  // มาซื้อครั้งล่าสุด: within = มาภายใน N วัน / over = ไม่ได้มาเกิน N วัน (ยังไม่เคยซื้อ นับจากวันสมัคร — ไว้ดึงลูกค้าที่หายไปกลับมา)
  const mode = String(f.lastVisit || '');
  if (['', 'within', 'over'].indexOf(mode) < 0) throw userError('เงื่อนไขมาซื้อครั้งล่าสุดไม่ถูกต้อง', 'BAD_INPUT');
  const lastDays = mode ? days(f.lastVisitDays, 'จำนวนวันที่มาซื้อครั้งล่าสุด') : null;
  if (mode && lastDays == null) throw userError('กรุณาใส่จำนวนวัน (มาซื้อครั้งล่าสุด)', 'BAD_INPUT');
  return {
    tierIds, branches, month, pointsMin, pointsMax, spendMin, spendMax, visitsMin, visitsMax,
    visitedSince: mode === 'within' ? ago(lastDays) : null,
    quietSince: mode === 'over' ? ago(lastDays) : null,
    joinedSince: ago(days(f.joinedDays, 'สมัครภายใน'))
  };
}

// เงื่อนไข SQL ชุดเดียว (ค่าว่าง/null = ไม่กรองข้อนั้น) — ไม่ต่อข้อความ SQL จากค่าที่ส่งมา
const WHERE = `shop_id = $1
  and (cardinality($2::text[]) = 0 or tier_id = any($2::text[]))
  and (cardinality($3::text[]) = 0 or joined_branch = any($3::text[]))
  and ($4::int = 0 or extract(month from birth_date) = $4::int)
  and ($5::int is null or points >= $5::int) and ($6::int is null or points <= $6::int)
  and ($7::numeric is null or total_spend >= $7::numeric) and ($8::numeric is null or total_spend <= $8::numeric)
  and ($9::int is null or visit_count >= $9::int) and ($10::int is null or visit_count <= $10::int)
  and ($11::timestamptz is null or last_visit_at >= $11::timestamptz)
  and ($12::timestamptz is null or coalesce(last_visit_at, joined_at) < $12::timestamptz)
  and ($13::timestamptz is null or joined_at >= $13::timestamptz)`;
const whereArgs = (shopId, c) => [shopId, c.tierIds, c.branches, c.month, c.pointsMin, c.pointsMax, c.spendMin, c.spendMax,
  c.visitsMin, c.visitsMax, c.visitedSince, c.quietSince, c.joinedSince];

// ---------- คำสั่ง: นับกลุ่ม + ตัวอย่างรายชื่อ (เจ้าของร้านเท่านั้น — ตรวจใน router) ----------
async function adminAudience(p, ctx) {
  const shopId = ctx.shop.id;
  const tiers = await T.loadTiers(ctx.db, shopId);
  const on = T.tiersOn(tiers);
  if (on) await T.syncDue(ctx.db, shopId, tiers, ctx.now); // ระดับที่ครบกำหนดลดก่อนกรอง
  const c = cleanFilter(p.filter, tiers, ctx.now);
  const args = whereArgs(shopId, c);

  // ตรงเงื่อนไขทั้งหมด แยกเหตุผลที่ส่งไม่ได้ (ไล่ตามลำดับ ไม่นับซ้ำ: ไม่ยินยอม → ถูกระงับ → ไม่ได้สมัครผ่าน LINE)
  const n = (await ctx.db.query(`select count(*)::int as matched,
      (count(*) filter (where ${SENDABLE_SQL}))::int as sendable,
      (count(*) filter (where not marketing_consent))::int as no_consent,
      (count(*) filter (where marketing_consent and status <> 'ACTIVE'))::int as blocked,
      (count(*) filter (where marketing_consent and status = 'ACTIVE' and line_user_id is null))::int as no_line
    from members where ${WHERE}`, args)).rows[0];

  // ตัวอย่าง: คนที่ส่งได้ สมัครล่าสุดก่อน — ไม่มี LINE ID / เบอร์ / วันเกิด (ดูได้ในหน้าสมาชิกอยู่แล้ว)
  const rows = (await ctx.db.query(`select id, name, tier_id, points, total_spend::float8 as total_spend, visit_count, last_visit_at, joined_at, joined_branch
    from members where ${WHERE} and ${SENDABLE_SQL} order by joined_at desc, id limit ${PREVIEW}`, args)).rows;
  const tierName = (id) => { const t = on && T.tierById(tiers, id); return t ? t.name : ''; };
  const out = {
    matched: n.matched,
    sendable: n.sendable,
    excluded: { noConsent: n.no_consent, blocked: n.blocked, noLine: n.no_line },
    items: rows.map((m) => ({
      memberId: String(m.id), name: String(m.name || ''), tierId: on ? String(m.tier_id || '') : '', tier: tierName(m.tier_id),
      points: U.toInt(m.points), totalSpend: U.toNum(m.total_spend), visitCount: U.toInt(m.visit_count),
      lastVisitAt: U.iso(m.last_visit_at), joinedAt: U.iso(m.joined_at), joinedBranch: U.upper(m.joined_branch)
    })),
    previewLimit: PREVIEW
  };
  if (on) out.tiers = T.publicTiers(tiers); // ตัวเลือกระดับในหน้าเว็บ
  return out;
}

module.exports = { adminAudience, cleanFilter, SENDABLE_SQL, PREVIEW };
