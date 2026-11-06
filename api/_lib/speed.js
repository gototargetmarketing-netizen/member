// วัดความเร็วขั้น 2 — ใช้กับร้านทดลอง demo เท่านั้น (ข้อมูลปลอมจาก db/002_demo_seed.sql)
// ลบไฟล์นี้ + speed.html + คำสั่ง speedCard ใน router.js ก่อนรวมเข้าเว็บจริง
const { userError } = require('./errors');

// ดึงข้อมูลชุดเดียวกับที่หน้าลูกค้าใช้ตอนเปิดบัตรสะสมแต้ม (actBootstrap_ ใน code.gs):
// ข้อมูลสมาชิก + ประวัติล่าสุด + ของรางวัล + โปรโมชัน + คูปอง + แต้มพิเศษ + สาขา
// รวมเป็นคำสั่ง SQL เดียว = ไปกลับฐานข้อมูลครั้งเดียวไม่ว่าจะกี่ตาราง (ขั้น 3 ใช้วิธีนี้กับคำสั่งจริง)
// วันที่ "วันนี้" คิดตามเวลาไทย (ฐานข้อมูลของ Supabase ใช้เวลา UTC — ช่วงตี 0–7 จะผิดวันถ้าไม่แปลง)
const CARD_SQL = `
with m as (
  select * from members where shop_id = $1 and line_user_id = $2
), today as (
  select (now() at time zone 'Asia/Bangkok')::date as d
)
select json_build_object(
  'member', (select row_to_json(m) from m),
  'tx', coalesce((select json_agg(t) from (
          select id, created_at, type, amount, points, balance_after, detail, branch
          from transactions
          where shop_id = $1 and member_id = (select id from m)
          order by created_at desc
          limit $3) t), '[]'::json),
  'rewards', coalesce((select json_agg(r order by r.sort, r.id) from rewards r
          where r.shop_id = $1 and r.status = 'ACTIVE' and r.deleted_at is null), '[]'::json),
  'promos', coalesce((select json_agg(p order by p.sort, p.id) from promotions p, today
          where p.shop_id = $1 and p.status = 'ACTIVE' and p.deleted_at is null
            and (p.start_date is null or p.start_date <= today.d)
            and (p.end_date is null or p.end_date >= today.d)), '[]'::json),
  'coupons', coalesce((select json_agg(c) from (
          select code, reward_id, name, issued_at, expires_at, used_at, status
          from coupons
          where shop_id = $1 and member_id = (select id from m)
          order by issued_at desc
          limit 100) c), '[]'::json),
  'rules', coalesce((select json_agg(x) from point_rules x
          where x.shop_id = $1 and x.status = 'ACTIVE' and x.deleted_at is null), '[]'::json),
  'branches', coalesce((select json_agg(b order by b.sort, b.id) from branches b
          where b.shop_id = $1 and b.status = 'ACTIVE'), '[]'::json)
) as data`;

const ms = (t0) => Math.round((performance.now() - t0) * 10) / 10;

async function card(body, ctx) {
  if (ctx.shop.id !== 'demo') throw userError('ใช้ได้เฉพาะร้านทดลอง', 'DEMO_ONLY');
  // สมาชิกคนที่ n (1–2000) / ไม่บอก = สุ่ม — คนที่ 1 มีรายการเยอะสุด (ราว 600 รายการ) ใช้วัดกรณีลูกค้าประจำ
  const n = Number.isInteger(body.n) && body.n >= 1 && body.n <= 2000 ? body.n : 1 + Math.floor(Math.random() * 2000);

  const t = performance.now();
  const r = await ctx.deps.db().query(CARD_SQL, [ctx.shop.id, 'U_DEMO_' + n, ctx.shop.history_limit || 50]);
  const dbMs = ms(t);

  let data = r.rows[0] && r.rows[0].data;
  if (typeof data === 'string') data = JSON.parse(data);
  if (!data || !data.member) throw userError('ไม่พบสมาชิกทดลอง (วางไฟล์ db/002_demo_seed.sql แล้วหรือยัง)', 'NO_MEMBER');

  return {
    region: ctx.region,
    cold: ctx.cold,
    dbMs,
    ms: ms(ctx.t0),
    counts: {
      tx: data.tx.length, rewards: data.rewards.length, promos: data.promos.length,
      coupons: data.coupons.length, rules: data.rules.length, branches: data.branches.length
    },
    // ส่งข้อมูลกลับด้วย ให้ขนาดคำตอบใกล้ของจริง (เวลาส่งข้อมูลถึงมือถือก็นับรวม) — เป็นข้อมูลปลอมทั้งหมด
    data
  };
}

module.exports = { card, CARD_SQL };
