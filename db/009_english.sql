-- =====================================================================
-- 009: ข้อความภาษาอังกฤษของร้าน (สองภาษา รอบ 2 — ผู้ใช้ตกลงแผน 19 พ.ย. 2569)
--   เพิ่มช่อง *_en ข้างช่องภาษาไทยเดิม ให้เจ้าของร้านกรอกในหลังบ้าน
--   ว่าง ('') = ลูกค้าที่เลือกภาษาอังกฤษเห็นข้อความภาษาไทยของร้านแทน (เหมือนก่อนมีช่องนี้)
--   หน้าตาร้าน (ชื่อร้าน ข้อความหน้าจอ นโยบาย) เก็บใน shops.brand (jsonb) อยู่แล้ว → ไม่ต้องเพิ่มคอลัมน์
--   ความยาวสูงสุดเท่าช่องภาษาไทยของเรื่องเดียวกัน
-- ไม่แก้ข้อมูลเดิม / รันซ้ำได้ — วางใน Supabase SQL Editor ทั้งไฟล์แล้วกด Run
-- ต้องรัน "ก่อน" ส่งโค้ดสองภาษารอบ 2 ขึ้นลิงก์ทดสอบ (โค้ดอ่านช่องเหล่านี้ ไม่มี = หน้าลูกค้าเปิดไม่ได้)
-- =====================================================================
begin;

alter table rewards add column if not exists name_en text not null default '' check (length(name_en) <= 80);
alter table rewards add column if not exists description_en text not null default '' check (length(description_en) <= 300);

alter table promotions add column if not exists title_en text not null default '' check (length(title_en) <= 80);
alter table promotions add column if not exists subtitle_en text not null default '' check (length(subtitle_en) <= 150);
alter table promotions add column if not exists tag_en text not null default '' check (length(tag_en) <= 30);

alter table point_rules add column if not exists name_en text not null default '' check (length(name_en) <= 60);

alter table tiers add column if not exists name_en text not null default '' check (length(name_en) <= 30);
alter table tiers add column if not exists benefits_en text not null default '';  -- บรรทัดละข้อ เหมือน benefits (โค้ดตรวจจำนวนข้อ/ความยาว)

alter table branches add column if not exists name_en text not null default '' check (length(name_en) <= 40);

alter table shops add column if not exists tier_intro_en text not null default '' check (length(tier_intro_en) <= 200);

commit;

-- ตรวจผล: ต้องได้ 10 แถว
select table_name, column_name from information_schema.columns
where table_schema = 'public' and column_name in ('name_en', 'description_en', 'title_en', 'subtitle_en', 'tag_en', 'benefits_en', 'tier_intro_en')
order by table_name, column_name;
