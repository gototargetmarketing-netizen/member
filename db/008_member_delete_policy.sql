-- =====================================================================
-- 008: สิทธิ์ลูกค้าตาม PDPA ขั้นที่ 2 (ผู้ใช้ + น้องตกลงแผน 14 พ.ย. 2569)
--   • ลบบัญชีสมาชิก (ลูกค้าลบเอง / เจ้าของร้านลบให้) — ข้อมูลส่วนตัวลบจริง ประวัติยอดซื้อเหลือแบบไม่มีชื่อ
--   • เก็บ "รหัสแปลง" ของ LINE ID (sha256 ย้อนกลับไม่ได้) ในแถวที่ลบ → สมัครใหม่ไม่ได้แต้มรับข่าวสารซ้ำ (ผู้ใช้เลือกแบบ ก)
--   • รายการแต้มชนิดใหม่ DELETE = แต้มคงเหลือเป็น 0 ตอนลบบัญชี (ไม่ปนกับ ADJUST ของพนักงาน)
-- รันซ้ำได้ — วางใน Supabase SQL Editor ทั้งไฟล์แล้วกด Run
-- ต้องรัน "ก่อน" ส่งโค้ด PDPA ขั้นที่ 2 ขึ้นลิงก์ทดสอบ (ไม่งั้นลบบัญชีไม่ได้)
-- =====================================================================
begin;

alter table members add column if not exists deleted_at timestamptz;   -- ลบบัญชีเมื่อไร (null = ยังไม่ลบ)
alter table members add column if not exists line_hash text;           -- sha256 ของ "<ร้าน>:<LINE ID>" ใส่เฉพาะตอนลบ

-- สมาชิกที่ลบแล้วไม่มีเบอร์ (เบอร์เดิมกลับมาสมัครใหม่ได้) — ยังไม่ลบต้องมีเบอร์เหมือนเดิม
alter table members alter column phone drop not null;
alter table members drop constraint if exists members_phone_check;
alter table members add constraint members_phone_check check (phone is null or phone ~ '^0\d{8,9}$');

alter table members drop constraint if exists members_status_check;
alter table members add constraint members_status_check check (status in ('ACTIVE', 'BLOCKED', 'DELETED'));

-- ด่านสุดท้ายของฐานข้อมูล: สถานะ DELETED = ข้อมูลส่วนตัวต้องว่างหมดจริง (โค้ดลืมล้างช่องไหน → บันทึกไม่ผ่านทั้งก้อน)
alter table members drop constraint if exists members_deleted_wiped_check;
alter table members add constraint members_deleted_wiped_check check (
  case when status = 'DELETED'
    then phone is null and line_user_id is null and name = '' and first_name = '' and last_name = ''
         and birth_date is null and picture = '' and note = '' and points = 0 and not marketing_consent
         and deleted_at is not null
    else phone is not null and deleted_at is null and line_hash is null
  end);

alter table members drop constraint if exists members_line_hash_check;
alter table members add constraint members_line_hash_check check (line_hash is null or line_hash ~ '^[0-9a-f]{64}$');
create index if not exists members_line_hash_idx on members (shop_id, line_hash) where line_hash is not null;

alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check check (type in ('EARN', 'WELCOME', 'REDEEM', 'ADJUST', 'CONSENT', 'DELETE'));

commit;

-- ตรวจผล: ควรเห็น 2 แถว (deleted_at, line_hash) + phone เป็น YES (ว่างได้)
select column_name, data_type, is_nullable from information_schema.columns
where table_name = 'members' and column_name in ('deleted_at', 'line_hash', 'phone')
order by column_name;
