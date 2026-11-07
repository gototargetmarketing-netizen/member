-- =====================================================================
-- ตรวจแต้มสมาชิก — อ่านอย่างเดียว ไม่แก้ข้อมูลใดๆ (วางรันได้ทุกเมื่อ ทั้งโปรเจคทดสอบและโปรเจคใช้จริง)
-- วางใน Supabase SQL Editor ทั้งไฟล์แล้วกด Run → ได้ร้านละ 1 แถว
--
-- หลักการ: ทุกครั้งที่แต้มเปลี่ยน ระบบจดรายการไว้เสมอ (ได้แต้ม / แลก / ปรับ / แต้มต้อนรับ)
--   → แต้มในบัตรต้องเท่ากับ "ผลรวมแต้มของทุกรายการ" และเท่ากับ "คงเหลือหลังรายการ" ของรายการล่าสุด
--   ไม่ตรง = มีอะไรแก้แต้มโดยไม่ผ่านระบบ (เช่น SQL ที่วางเอง) หรือโค้ดมีบั๊ก
--
-- อ่านผล: ช่อง "แต้มไม่ตรง" = 0 ทุกร้าน → ถูกต้องทั้งหมด
--         มากกว่า 0 → ดูช่อง "รายชื่อที่ไม่ตรง" (แสดงไม่เกิน 20 คน) แล้วส่งให้ผู้ดูแลระบบ
--         อย่าแก้แต้มเองด้วย SQL — ให้ปรับผ่านหลังบ้าน (ปรับแต้ม) ระบบจะจดรายการให้ครบ
-- =====================================================================
with sums as (
  select shop_id, member_id, sum(points)::int as total
  from transactions
  group by shop_id, member_id
), last_tx as (
  -- รายการล่าสุดของแต่ละคน (เวลาเท่ากันให้รหัสรายการตัดสิน — แทบไม่เกิดเพราะทุกคำสั่งของสมาชิกคนเดียวทำทีละคำสั่ง)
  select distinct on (shop_id, member_id) shop_id, member_id, balance_after
  from transactions
  order by shop_id, member_id, created_at desc, id desc
), chk as (
  select m.shop_id, m.id, m.points, coalesce(s.total, 0) as total, l.balance_after,
         (m.points <> coalesce(s.total, 0) or (l.balance_after is not null and l.balance_after <> m.points)) as bad
  from members m
  left join sums s on s.shop_id = m.shop_id and s.member_id = m.id
  left join last_tx l on l.shop_id = m.shop_id and l.member_id = m.id
)
select shop_id as "ร้าน",
       count(*)::int as "สมาชิกทั้งหมด",
       (count(*) filter (where bad))::int as "แต้มไม่ตรง",
       coalesce(array_to_string((array_agg(
         id || ' (บัตร ' || points || ' / ผลรวมประวัติ ' || total || ' / คงเหลือล่าสุด ' || coalesce(balance_after::text, '-') || ')'
         order by id) filter (where bad))[1:20], ', '), '') as "รายชื่อที่ไม่ตรง"  -- ชื่อช่องยาวได้ไม่เกิน 63 ไบต์ (ภาษาไทยตัวละ 3 ไบต์)
from chk
group by shop_id
order by shop_id;
