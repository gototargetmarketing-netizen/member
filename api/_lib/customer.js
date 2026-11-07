// คำสั่งของลูกค้า (เดิม: ส่วนที่ 3, 3.1, 4.7 ของ code.gs)
// เปิดบัตร / สมัคร / แลกของรางวัล / รับของขวัญวันเกิด / แก้ข้อมูลตัวเอง
// กติกาและข้อความต้องเหมือนของเดิมทุกตัว — api-diff-test.js ส่งคำสั่งชุดเดียวกันให้ทั้งสองระบบแล้วเทียบคำตอบ
const { userError } = require('./errors');
const U = require('./util');
const { cfg } = require('./shop');
const { once } = require('./once');
const V = require('./views');
const M = require('./members');
const T = require('./tiers');

const BIRTHDAY_MIN_DAYS = 30; // ต้องเป็นสมาชิก ≥ 30 วัน และไม่ได้เพิ่งเปลี่ยนวันเกิด (กันสมัคร/แก้วันเกิดเพื่อรับของขวัญ)

// เปิดหน้าลูกค้า: ทุกอย่างที่หน้าแรกต้องใช้ในคำสั่ง SQL เดียว (ไปกลับฐานข้อมูลครั้งเดียว)
const BOOT_SQL = `
with m as (select ${V.MEMBER_COLS} from members where shop_id = $1 and line_user_id = $2)
select json_build_object(
  'member', (select row_to_json(m) from m),
  'tx', coalesce((select json_agg(t) from (
      select id, created_at, type, amount::float8 as amount, points, balance_after, detail
      from transactions where shop_id = $1 and member_id = (select id from m)
      order by created_at desc limit $3) t), '[]'::json),
  'coupons', coalesce((select json_agg(c) from (
      select ${V.COUPON_COLS} from coupons where shop_id = $1 and member_id = (select id from m)
      order by issued_at desc limit 200) c), '[]'::json),
  'rewards', coalesce((select json_agg(r) from (
      select ${V.REWARD_COLS} from rewards where shop_id = $1 and status = 'ACTIVE' and deleted_at is null order by sort, id) r), '[]'::json),
  'promos', coalesce((select json_agg(p) from (
      select id, title, subtitle, tag, image, link, to_char(start_date, 'YYYY-MM-DD') as start_date,
             to_char(end_date, 'YYYY-MM-DD') as end_date, sort, status, min_tier_id
      from promotions where shop_id = $1 and status = 'ACTIVE' and deleted_at is null order by sort, id) p), '[]'::json),
  'rules', coalesce((select json_agg(x) from (
      select id, name, multiplier, days, to_char(start_date, 'YYYY-MM-DD') as start_date,
             to_char(end_date, 'YYYY-MM-DD') as end_date, branch, min_amount, show_badge, status, min_tier_id
      from point_rules where shop_id = $1 and status = 'ACTIVE' and deleted_at is null) x), '[]'::json),
  'branches', coalesce((select json_agg(b) from (
      select id, name, status, sort from branches where shop_id = $1 order by sort, id) b), '[]'::json),
  'birthLog', coalesce((select json_agg(l) from (
      select created_at, changed from profile_log where shop_id = $1 and member_id = (select id from m)
      order by created_at desc limit 20) l), '[]'::json),
  -- ยอดซื้อ 12 เดือนล่าสุด (ระดับสมาชิก: บอกลูกค้าว่าขาดอีกเท่าไรถึงระดับถัดไป)
  'spend12m', (select coalesce(sum(amount), 0)::float8 from transactions where shop_id = $1 and member_id = (select id from m)
      and type = 'EARN' and created_at > ($4::timestamptz - interval '12 months') and created_at <= $4::timestamptz)
) as data`;

// ---------- ของขวัญวันเกิด (ผู้ใช้ตกลง 4 พ.ย. 2569) ----------
// รับได้ทั้งเดือนเกิด ปีละ 1 ครั้ง / ของขวัญ = ของรางวัลที่ type = BIRTHDAY

// '' = มีสิทธิ์ / เหตุผลที่ยังไม่มีสิทธิ์ (ใช้ทั้งตอนแสดงการ์ดและตอนกดรับ)
function birthdayBlock(m, now, birthLog) {
  const birth = String(m.birth_date || '');
  if (!birth || birth.slice(5, 7) !== U.thaiDay(now).slice(5, 7)) return 'NOT_MONTH';
  const minAgo = now.getTime() - BIRTHDAY_MIN_DAYS * U.DAY_MS;
  const joined = U.toDate(m.joined_at);
  if (!joined || joined.getTime() > minAgo) return 'TOO_NEW';
  const changedRecently = (birthLog || []).some((l) => {
    const d = U.toDate(l.created_at);
    return String(l.changed || '').indexOf(M.PROFILE_LABEL.birth) >= 0 && d && d.getTime() > minAgo;
  });
  return changedRecently ? 'TOO_NEW' : '';
}

// ของขวัญวันเกิดที่แจกอยู่ — ร้านเปิดใช้ระดับ: ได้ชิ้นของระดับสูงสุดที่ตัวเองถึง (tc = { tiers, tierId })
// ระดับเท่ากัน / ร้านไม่มีระดับ → เรียงตามลำดับแสดง เอาชิ้นแรก (เหมือนเดิม)
function birthdayReward(rewards, now, tc) {
  const on = !!tc && T.tiersOn(tc.tiers);
  const need = (r) => { const t = on ? T.tierById(tc.tiers, r.min_tier_id) : null; return t ? t.rank : -1; };
  return (rewards || []).filter((r) => r.id && U.upper(r.type) === V.REWARD_BIRTHDAY && U.upper(r.status) === 'ACTIVE' &&
    U.inWindow(r.start_date, r.end_date, now) && (U.toInt(r.quota) <= 0 || U.toInt(r.issued) < U.toInt(r.quota)) &&
    (!on || T.meets(tc.tiers, tc.tierId, r.min_tier_id)))
    .sort((a, b) => (need(b) - need(a)) || (U.toInt(a.sort) - U.toInt(b.sort)))[0] || null;
}

const thaiYear = (now) => Number(U.thaiDay(now).slice(0, 4));

// คูปองวันเกิดของปีนี้ที่รับไปแล้ว (coupons เรียงใหม่ → เก่า)
function birthdayCouponOf(coupons, now) {
  const year = thaiYear(now);
  return (coupons || []).find((c) => Number(c.birthday_year) === year && U.upper(c.status) !== 'CANCELLED') || null;
}

// การ์ดหน้าลูกค้า: null = ไม่แสดง
function birthdayOffer(m, now, coupons, rewards, birthLog, tc) {
  if (U.upper(m.status || 'ACTIVE') !== 'ACTIVE' || birthdayBlock(m, now, birthLog)) return null;
  const got = birthdayCouponOf(coupons, now);
  if (got) return V.couponState(got, now) === 'ACTIVE' ? { claimed: true, coupon: V.publicCoupon(got, now) } : null;
  const r = birthdayReward(rewards, now, tc);
  if (!r) return null;
  return {
    claimed: false, rewardId: String(r.id), name: String(r.name || ''), description: String(r.description || ''),
    image: U.safeUrl(U.driveImage(r.image)), points: U.toInt(r.points), until: U.iso(U.endOfMonth(now))
  };
}

// ---------- คำสั่ง ----------

// ระดับของลูกค้าคนนี้ครบกำหนด / ยังไม่มีระดับ → ปรับก่อนแสดง (ส่วนใหญ่ไม่ต้องทำอะไร เป็นคำสั่งค้นสั้นๆ ครั้งเดียว)
async function syncTierByLine(ctx, tiers) {
  const due = (await ctx.db.query(`select id from members where shop_id = $1 and line_user_id = $2 and (tier_id is null or tier_until < $3::date)`,
    [ctx.shop.id, ctx.user.userId, U.thaiDay(ctx.now)])).rows[0];
  if (!due) return;
  await ctx.db.tx(async (q) => {
    const m = await M.memberById(q, ctx.shop.id, due.id, true);
    if (m) await T.syncMember(q, ctx.shop.id, m, tiers, ctx.now);
  });
}

async function bootstrap(p, ctx) {
  const c = cfg(ctx.shop);
  const now = ctx.now;
  const tiers = await T.loadTiers(ctx.db, ctx.shop.id);
  const on = T.tiersOn(tiers);
  if (on) await syncTierByLine(ctx, tiers);
  const r = await ctx.db.query(BOOT_SQL, [ctx.shop.id, ctx.user.userId, c.historyLimit, now]);
  let d = r.rows[0].data;
  if (typeof d === 'string') d = JSON.parse(d);
  const names = V.branchNames(d.branches);
  const m = d.member;
  // ร้านเปิดใช้ระดับ: ของที่ตั้งระดับขั้นต่ำไว้ แสดงแต่ล็อก / ป้ายแต้มพิเศษแสดงเฉพาะกติกาที่ระดับนี้ได้
  const tc = on ? { tiers, tierId: m ? m.tier_id : null } : null;
  const out = {
    settings: { shopName: c.shopName, pointRate: c.pointRate, welcomePoints: c.welcomePoints, consentVersion: c.consentVersion },
    profile: { name: ctx.user.name, picture: ctx.user.picture },
    member: null,
    history: [],
    coupons: [],
    rewards: V.listRewards(d.rewards, now, tc),
    promos: V.listPromos(d.promos, now, tc),
    // ป้าย "แต้ม x2 วันนี้" (เฉพาะกติกาที่เจ้าของร้านติ๊กให้แสดง)
    badges: V.rulesOn(d.rules.map(V.ruleFromRow), now).filter((x) => x.showBadge && (!on || T.meets(tiers, tc.tierId, x.minTierId)))
      .map((x) => V.publicRule(x, names)),
    birthday: null
  };
  if (on) out.tiers = T.publicTiers(tiers);
  if (!m) return out;
  out.birthday = birthdayOffer(m, now, d.coupons, d.rewards, d.birthLog, tc);

  // อัปเดตรูปโปรไฟล์เมื่อลูกค้าเปลี่ยนรูปใน LINE (เขียนเฉพาะตอนที่เปลี่ยนจริง)
  if (ctx.user.picture && ctx.user.picture !== String(m.picture || '')) {
    await ctx.db.query('update members set picture = $3 where shop_id = $1 and id = $2', [ctx.shop.id, m.id, ctx.user.picture]);
    m.picture = ctx.user.picture;
  }
  out.member = V.publicMember(m, on ? tiers : null);
  if (on) out.member.tierInfo = T.tierInfo(tiers, m, d.spend12m);
  out.history = d.tx.map(V.publicTx);
  out.coupons = d.coupons.slice(0, 100).map((cp) => V.publicCoupon(cp, now));
  return out;
}

async function register(p, ctx) {
  if (p.consentPrivacy !== true) throw userError('กรุณายอมรับนโยบายความเป็นส่วนตัวก่อนสมัคร', 'NO_CONSENT');
  // ชื่อ นามสกุล วันเกิด เบอร์ บังคับทุกช่อง (ร้านต้องการข้อมูลครบตั้งแต่สมัคร — ตัดสินใจ 3 พ.ย. 2569)
  const firstName = U.cleanNamePart(p.firstName, 'ชื่อ');
  const lastName = U.cleanNamePart(p.lastName, 'นามสกุล');
  const birthDate = U.cleanBirthDate(p.birthDate, ctx.now);
  if (!birthDate) throw userError('กรุณาเลือกวันเกิด', 'BAD_BIRTHDATE');
  const phone = U.cleanMobile(p.phone);
  const c = cfg(ctx.shop);
  const shopId = ctx.shop.id;
  const phoneTaken = () => userError('เบอร์โทรนี้สมัครสมาชิกไว้แล้ว ถ้าเป็นเบอร์ของคุณ กรุณาติดต่อพนักงาน', 'PHONE_TAKEN');

  const existing = await M.memberByLine(ctx.db, shopId, ctx.user.userId);
  if (existing) return { member: V.publicMember(existing), already: true };
  if ((await ctx.db.query('select 1 from members where shop_id = $1 and phone = $2', [shopId, phone])).rows.length) throw phoneTaken();
  const joined = M.joinedBranch(p.branch, await M.activeBranches(ctx.db, shopId));
  const now = ctx.now;
  const tiers = await T.loadTiers(ctx.db, shopId);

  try {
    return await ctx.db.tx(async (q) => {
      const member = await M.insertWithNewId(q, () => c.memberPrefix + '-' + U.randomCode(6),
        `insert into members (shop_id, id, line_user_id, name, first_name, last_name, phone, birth_date, picture, points,
                              joined_at, joined_branch, consent_version, consent_at, marketing_consent)
         values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13, $11, $14)
         on conflict (shop_id, id) do nothing
         returning ${V.MEMBER_COLS}`,
        (id) => [shopId, id, ctx.user.userId, firstName + ' ' + lastName, firstName, lastName, phone, birthDate,
          ctx.user.picture || '', c.welcomePoints, now, joined, parseInt(c.consentVersion, 10) || 1, p.consentMarketing === true]);
      if (c.welcomePoints > 0) {
        await q.query(`insert into transactions (shop_id, id, created_at, member_id, type, amount, points, balance_after, detail, staff)
                       values ($1, $2, $3, $4, 'WELCOME', 0, $5, $5, 'แต้มต้อนรับสมาชิกใหม่', 'SYSTEM')`,
          [shopId, M.newTxId(), now, member.id, c.welcomePoints]);
      }
      // ร้านเปิดใช้ระดับ: สมาชิกใหม่เริ่มที่ระดับแรก (จดประวัติ START)
      await T.syncMember(q, shopId, member, tiers, now);
      return { member: V.publicMember(member, T.tiersOn(tiers) ? tiers : null), welcomePoints: c.welcomePoints };
    });
  } catch (e) {
    if (e && e.code === '23505') {
      // กดสมัครซ้ำพร้อมกัน → อีกคำขอสมัครสำเร็จไปแล้ว / หรือเบอร์เพิ่งถูกคนอื่นใช้ไปเสี้ยววินาทีก่อน
      const again = await M.memberByLine(ctx.db, shopId, ctx.user.userId);
      if (again) return { member: V.publicMember(again), already: true };
      if (/phone/.test(String(e.constraint || e.message || ''))) throw phoneTaken();
    }
    throw e;
  }
}

// สร้างคูปอง + รายการแลก + หักแต้ม (ใช้ทั้งแลกปกติและของขวัญวันเกิด) — m กับ reward ต้องจองแถวไว้แล้ว
async function issueCoupon(q, ctx, m, reward, cost, expiresAt, reqId, birthdayYear) {
  const shopId = ctx.shop.id;
  const now = ctx.now;
  const balance = U.toInt(m.points) - cost;
  const txId = cost > 0 ? M.newTxId() : null;
  const coupon = await M.insertWithNewId(q, () => 'CP-' + U.randomCode(8),
    `insert into coupons (shop_id, code, member_id, reward_id, name, points_used, issued_at, expires_at, status, tx_id, birthday_year)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, $10)
     on conflict (shop_id, code) do nothing
     returning ${V.COUPON_COLS}`,
    (code) => [shopId, code, m.id, reward.id, String(reward.name || ''), cost, now, expiresAt, txId, birthdayYear]);
  if (cost > 0) {
    await q.query('update members set points = $3 where shop_id = $1 and id = $2', [shopId, m.id, balance]);
    await q.query(`insert into transactions (shop_id, id, created_at, member_id, type, amount, points, balance_after, detail, request_id, ref)
                   values ($1, $2, $3, $4, 'REDEEM', 0, $5, $6, $7, $8, $9)`,
      [shopId, txId, now, m.id, -cost, balance, 'แลก ' + String(reward.name || ''), reqId, coupon.code]);
  }
  await q.query('update rewards set issued = issued + 1 where shop_id = $1 and id = $2', [shopId, reward.id]);
  return { coupon, balance };
}

const notEnough = (cost, points) =>
  userError('แต้มไม่พอ ต้องใช้ ' + U.fmtNum(cost) + ' แต้ม (มีอยู่ ' + U.fmtNum(points) + ')', 'NOT_ENOUGH');

// แลกของรางวัล: ตรวจทุกอย่างที่นี่ (แต้ม โควตา จำกัดต่อคน ช่วงเวลา) ไม่เชื่อตัวเลขจากหน้าเว็บ
async function redeem(p, ctx) {
  const rewardId = U.cleanKey(p.rewardId, 'รหัสรางวัล');
  const c = cfg(ctx.shop);
  const shopId = ctx.shop.id;
  return once(ctx, 'redeem', p.requestId, async (q, reqId) => {
    const m = await M.memberByLine(q, shopId, ctx.user.userId, true);
    // รายการแต้มที่ใช้รหัสคำขอนี้ไปแล้ว (เช่น ทำสำเร็จก่อนย้ายระบบ) → ตอบผลเดิม
    const dup = await q.query('select balance_after from transactions where shop_id = $1 and request_id = $2', [shopId, reqId]);
    if (dup.rows[0]) return { duplicate: true, points: U.toInt(dup.rows[0].balance_after) };
    if (!m) throw userError('กรุณาสมัครสมาชิกก่อน', 'NOT_MEMBER');
    M.assertActiveMember(m);

    const now = ctx.now;
    const tiers = await T.loadTiers(q, shopId);
    await T.syncMember(q, shopId, m, tiers, now); // ระดับที่ครบกำหนดแล้ว ลดก่อนตรวจสิทธิ์
    const reward = (await q.query(`select ${V.REWARD_COLS} from rewards where shop_id = $1 and id = $2 and deleted_at is null for update`, [shopId, rewardId])).rows[0];
    if (!reward || U.upper(reward.status) !== 'ACTIVE' || !U.inWindow(reward.start_date, reward.end_date, now) ||
        U.upper(reward.type) === V.REWARD_BIRTHDAY) {
      throw userError('รางวัลนี้ไม่พร้อมให้แลกแล้ว', 'REWARD_UNAVAILABLE');
    }
    if (!T.meets(tiers, m.tier_id, reward.min_tier_id)) {
      throw userError('ของรางวัลนี้สำหรับสมาชิกระดับ ' + T.tierById(tiers, reward.min_tier_id).name + ' ขึ้นไป', 'TIER_LOCKED');
    }
    const cost = U.toInt(reward.points);
    if (cost <= 0) throw userError('รางวัลนี้ตั้งค่าแต้มไม่ถูกต้อง', 'REWARD_UNAVAILABLE');
    const quota = U.toInt(reward.quota);
    if (quota > 0 && U.toInt(reward.issued) >= quota) throw userError('รางวัลนี้ถูกแลกครบจำนวนแล้ว', 'SOLD_OUT');
    const limit = U.toInt(reward.limit_per_member);
    if (limit > 0) {
      const mine = (await q.query(`select count(*)::int as n from coupons where shop_id = $1 and member_id = $2 and reward_id = $3 and status <> 'CANCELLED'`,
        [shopId, m.id, rewardId])).rows[0].n;
      if (mine >= limit) throw userError('คุณแลกรางวัลนี้ครบ ' + limit + ' ครั้งแล้ว', 'LIMIT_REACHED');
    }
    const points = U.toInt(m.points);
    if (points < cost) throw notEnough(cost, points);

    const days = U.toInt(reward.valid_days) > 0 ? U.toInt(reward.valid_days) : c.couponDays;
    const r = await issueCoupon(q, ctx, m, reward, cost, U.endOfDayAfter(now, days), reqId, null);
    return { points: r.balance, coupon: V.publicCoupon(r.coupon, now) };
  });
}

async function claimBirthday(p, ctx) {
  const shopId = ctx.shop.id;
  return once(ctx, 'claimBirthday', p.requestId, async (q, reqId) => {
    const m = await M.memberByLine(q, shopId, ctx.user.userId, true);
    if (!m) throw userError('กรุณาสมัครสมาชิกก่อน', 'NOT_MEMBER');
    M.assertActiveMember(m);
    const now = ctx.now;
    const log = (await q.query('select created_at, changed from profile_log where shop_id = $1 and member_id = $2 order by created_at desc limit 20',
      [shopId, m.id])).rows;
    const block = birthdayBlock(m, now, log);
    if (block === 'NOT_MONTH') throw userError('ของขวัญวันเกิดรับได้เฉพาะในเดือนเกิดของคุณ', 'NOT_BIRTH_MONTH');
    if (block) throw userError('ของขวัญวันเกิดสำหรับสมาชิกที่สมัครครบ ' + BIRTHDAY_MIN_DAYS + ' วันขึ้นไป', 'TOO_NEW');

    // อ่านสดภายในรายการเสมอ (แถวสมาชิกจองไว้แล้ว → คำขออื่นของคนนี้รอ) กันรับซ้ำ / ฐานข้อมูลกันซ้ำอีกชั้นด้วย unique (ร้าน, สมาชิก, ปี)
    const year = thaiYear(now);
    const got = (await q.query(`select ${V.COUPON_COLS} from coupons where shop_id = $1 and member_id = $2 and birthday_year = $3 and status <> 'CANCELLED'
                                order by issued_at desc limit 1`, [shopId, m.id, year])).rows[0];
    if (got) return { already: true, coupon: V.publicCoupon(got, now) };

    const tiers = await T.loadTiers(q, shopId);
    await T.syncMember(q, shopId, m, tiers, now);
    const tc = { tiers, tierId: m.tier_id };
    const list = (await q.query(`select ${V.REWARD_COLS} from rewards where shop_id = $1 and status = 'ACTIVE' and type = 'BIRTHDAY' and deleted_at is null`, [shopId])).rows;
    const pick = birthdayReward(list, now, tc);
    const reward = pick && (await q.query(`select ${V.REWARD_COLS} from rewards where shop_id = $1 and id = $2 and deleted_at is null for update`, [shopId, pick.id])).rows[0];
    // ตรวจโควตาซ้ำหลังจองแถว (อีกคนอาจเพิ่งรับชิ้นสุดท้ายไป)
    if (!reward || !birthdayReward([reward], now, tc)) throw userError('ตอนนี้ร้านยังไม่มีของขวัญวันเกิด', 'REWARD_UNAVAILABLE');
    const cost = U.toInt(reward.points);
    const points = U.toInt(m.points);
    if (cost > points) throw notEnough(cost, points);
    const days = U.toInt(reward.valid_days);
    const r = await issueCoupon(q, ctx, m, reward, cost, days > 0 ? U.endOfDayAfter(now, days) : U.endOfMonth(now), reqId, year);
    return { coupon: V.publicCoupon(r.coupon, now), points: r.balance };
  });
}

// ลูกค้าแก้ข้อมูลตัวเอง — ตั้งค่าเดิมซ้ำได้ผลเดิม จึงไม่ต้องใช้ requestId (เหมือนของเดิม)
async function updateProfile(p, ctx) {
  const input = M.cleanProfileInput(p, true, ctx.now);
  const shopId = ctx.shop.id;
  try {
    return await ctx.db.tx(async (q) => {
      const m = await M.memberByLine(q, shopId, ctx.user.userId, true);
      if (!m) throw userError('กรุณาสมัครสมาชิกก่อน', 'NOT_MEMBER');
      M.assertActiveMember(m);
      const changed = await M.applyProfile(q, shopId, m, input, { self: true, by: 'ลูกค้า' }, ctx.now);
      const fresh = await M.memberById(q, shopId, m.id);
      const tiers = await T.loadTiers(q, shopId);
      return { changed: changed.length, member: V.publicMember(fresh, T.tiersOn(tiers) ? tiers : null) };
    });
  } catch (e) {
    // เบอร์เพิ่งถูกคนอื่นใช้ไปพร้อมกันพอดี (ฐานข้อมูลกันซ้ำให้)
    if (e && e.code === '23505' && /phone/.test(String(e.constraint || e.message || ''))) {
      throw userError('เบอร์นี้มีสมาชิกคนอื่นใช้แล้ว ถ้าเป็นเบอร์ของคุณ กรุณาติดต่อร้าน', 'PHONE_TAKEN');
    }
    throw e;
  }
}

module.exports = { bootstrap, register, redeem, claimBirthday, updateProfile, birthdayBlock, birthdayReward, BOOT_SQL };
