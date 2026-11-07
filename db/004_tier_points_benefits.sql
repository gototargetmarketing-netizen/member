-- =====================================================================
-- 004: ระดับสมาชิกนับจาก "แต้มจากการซื้อ" + หน้าสิทธิ์สมาชิก (ผู้ใช้ตกลง 7 พ.ย. 2569)
--   • ระดับนับจากแต้มปกติของบิลซื้อใน 12 เดือน (ไม่นับแต้มพิเศษ ตัวคูณระดับ แต้มต้อนรับ แต้มที่ร้านปรับ / แลกของรางวัลไม่ลด)
--   • จดแต้มปกติของแต่ละบิลไว้ (base_points) → ร้านเปลี่ยนอัตราแต้มทีหลัง บิลเก่าไม่เปลี่ยน
--   • ระดับมีรูปบัตร + สิทธิพิเศษที่ร้านเขียนเอง / ร้านมีข้อความหัวหน้าสิทธิ์สมาชิก
-- รันซ้ำได้ (ทุกคำสั่งเช็กก่อนทำ) — วางใน Supabase SQL Editor ทั้งไฟล์แล้วกด Run
-- ต้องรัน "ก่อน" ส่งโค้ดที่อ้างช่องเหล่านี้ขึ้นลิงก์ทดสอบ (ไม่งั้นร้าน demo ล่ม)
-- =====================================================================
begin;

-- แต้มปกติของบิล (ก่อนคูณ) — บิลเก่าคิดจากอัตราแต้มปัจจุบันของร้าน
alter table transactions add column if not exists base_points integer check (base_points >= 0);
update transactions t set base_points = floor(t.amount / s.point_rate_baht)::int
  from shops s where s.id = t.shop_id and t.type = 'EARN' and t.base_points is null;

-- เกณฑ์ระดับเป็นแต้ม (ระดับที่ตั้งไว้แล้วแปลงจากยอดเงิน ÷ อัตราแต้มของร้าน เช่น ฿5,000 ÷ 20 = 250 แต้ม)
alter table tiers add column if not exists min_points integer check (min_points >= 0);
update tiers t set min_points = round(t.min_spend / s.point_rate_baht)::int
  from shops s where s.id = t.shop_id and t.min_points is null;
alter table tiers alter column min_points set default 0;
alter table tiers alter column min_points set not null;
-- เกณฑ์ยอดเงินเดิมไม่ใช้แล้ว (เก็บไว้เฉยๆ) / 2 ระดับใช้เกณฑ์แต้มเดียวกันไม่ได้
alter table tiers alter column min_spend drop not null;
alter table tiers drop constraint if exists tiers_shop_id_min_spend_key;
create unique index if not exists tiers_shop_min_points_key on tiers (shop_id, min_points);

-- หน้าสิทธิ์สมาชิก: รูปบัตร (ว่าง = ระบบวาดจากสีระดับ) + สิทธิพิเศษที่ร้านเขียน (บรรทัดละข้อ)
alter table tiers add column if not exists image text not null default '';
alter table tiers add column if not exists benefits text not null default '';
alter table shops add column if not exists tier_intro text not null default '';

-- ประวัติระดับจดแต้ม 12 เดือนตอนที่เปลี่ยน (แถวเก่ามีแต่ยอดเงินใน spend_12m)
alter table tier_history add column if not exists points_12m integer;

commit;

-- ตรวจผล: ควรเห็นครบ 6 ช่อง
select table_name, column_name from information_schema.columns
where table_schema = 'public' and (
  (table_name = 'transactions' and column_name = 'base_points') or
  (table_name = 'tiers' and column_name in ('min_points', 'image', 'benefits')) or
  (table_name = 'shops' and column_name = 'tier_intro') or
  (table_name = 'tier_history' and column_name = 'points_12m'))
order by table_name, column_name;
