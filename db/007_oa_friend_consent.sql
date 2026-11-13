-- =====================================================================
-- 007: ส่งข้อความตามกลุ่ม รอบ 3 (ผู้ใช้ตกลงแผน 12 พ.ย. 2569)
--   • ร้านบังคับให้เพิ่มเพื่อน LINE OA ก่อนสมัครได้ (ส่งข้อความถึงสมาชิกได้แทบทุกคน)
--   • ช่อง "ยินยอมรับข่าวสาร" ติ๊กไว้ให้ได้ + แจกแต้มเมื่อยินยอม (ครั้งเดียวต่อคน)
--   • จดว่าลูกค้าเป็นเพื่อน OA ไหม (เช็กตอนเปิดบัตร) → หน้าส่งข้อความบอกจำนวนที่ได้รับจริง
-- รันซ้ำได้ — วางใน Supabase SQL Editor ทั้งไฟล์แล้วกด Run
-- ต้องรัน "ก่อน" ส่งโค้ดรอบ 3 ขึ้นลิงก์ทดสอบ (ไม่งั้นหน้าลูกค้าเปิดไม่ได้)
-- =====================================================================
begin;

-- ตั้งค่าร้าน (เจ้าของร้านแก้ในหลังบ้าน เมนูตั้งค่าร้าน) — ค่าเริ่มต้นตามที่ผู้ใช้เลือก: บังคับเพิ่มเพื่อน เปิด / ติ๊กไว้ให้ เปิด / แต้ม 0
alter table shops add column if not exists require_oa_friend boolean not null default true;   -- ใช้ได้เฉพาะร้านที่เชื่อม OA แล้ว
alter table shops add column if not exists consent_preticked boolean not null default true;
alter table shops add column if not exists consent_bonus_points integer not null default 0;

-- สมาชิก
alter table members add column if not exists oa_friend boolean;               -- null = ยังไม่รู้ (ร้านไม่มี OA / LINE ตอบไม่ได้)
alter table members add column if not exists oa_friend_at timestamptz;        -- เช็กล่าสุดเมื่อไร (เป็นเพื่อนแล้วเช็กซ้ำวันละครั้ง)
-- สมัครตอนที่ช่องยินยอมถูกติ๊กไว้ให้ → ถ้าวันหลังต้องขอความยินยอมใหม่ จะถามเฉพาะคนกลุ่มนี้ได้
alter table members add column if not exists consent_preticked boolean not null default false;
alter table members add column if not exists consent_bonus_at timestamptz;    -- ได้แต้มรับข่าวสารแล้วเมื่อไร (ได้ครั้งเดียว ยกเลิกแล้วติ๊กใหม่ไม่ได้ซ้ำ)

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shops_consent_bonus_points_check') then
    alter table shops add constraint shops_consent_bonus_points_check check (consent_bonus_points between 0 and 100000);
  end if;
end $$;

-- รายการแต้มชนิดใหม่ CONSENT = แต้มรับข่าวสาร (แยกจากแต้มต้อนรับ — ได้ทีหลังตอนเปิดรับข่าวสารก็ได้)
alter table transactions drop constraint if exists transactions_type_check;
alter table transactions add constraint transactions_type_check check (type in ('EARN', 'WELCOME', 'REDEEM', 'ADJUST', 'CONSENT'));

commit;

-- ตรวจผล: ควรเห็น 3 แถวของ shops + 4 แถวของ members
select table_name, column_name, data_type from information_schema.columns
where (table_name = 'shops' and column_name in ('require_oa_friend', 'consent_preticked', 'consent_bonus_points'))
   or (table_name = 'members' and column_name in ('oa_friend', 'oa_friend_at', 'consent_preticked', 'consent_bonus_at'))
order by table_name, column_name;
