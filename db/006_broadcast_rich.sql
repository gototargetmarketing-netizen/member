-- =====================================================================
-- 006: รูปในข้อความตามกลุ่มเป็น "ริชเมสเสจ" เต็มความกว้างแชต (ผู้ใช้ขอ 12 พ.ย. 2569 — รูปแบบเดิมขึ้นเป็นรูปย่อ ไม่เต็ม)
--   • ริชเมสเสจต้องจำหลายค่า (ลิงก์รูป 5 ขนาด ความสูง ลิงก์ที่เปิดเมื่อแตะ ข้อความแจ้งเตือน)
--     → เก็บ "ข้อความในรูปแบบของ LINE ที่ส่งจริง" ทั้งก้อนไว้ในช่องใหม่ messages
--   • กด "ส่งต่อ" ทีหลัง = ส่งก้อนเดิมทุกตัวอักษร (แม้ร้านเปลี่ยนชื่อ/ลิงก์ไปแล้ว ลูกค้าแต่ละชุดได้ข้อความเหมือนกัน)
--   • ประวัติเก่า (ก่อนไฟล์นี้) ช่องนี้ว่าง → ตัวกลางสร้างข้อความจาก message_text / message_image แบบเดิม
-- รันซ้ำได้ — วางใน Supabase SQL Editor ทั้งไฟล์แล้วกด Run
-- ต้องรัน "ก่อน" ส่งโค้ดริชเมสเสจขึ้นลิงก์ทดสอบ (ไม่งั้นกดส่งข้อความไม่ได้)
-- =====================================================================
begin;

alter table broadcasts add column if not exists messages jsonb;

-- ต้องเป็นรายการ 1–5 ข้อความ (LINE ส่งได้ครั้งละไม่เกิน 5) หรือว่าง (ประวัติเก่า)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'broadcasts_messages_check') then
    alter table broadcasts add constraint broadcasts_messages_check
      check (messages is null or (jsonb_typeof(messages) = 'array' and jsonb_array_length(messages) between 1 and 5));
  end if;
end $$;

commit;

-- ตรวจผล: ควรเห็น 1 แถว data_type = jsonb
select column_name, data_type from information_schema.columns where table_name = 'broadcasts' and column_name = 'messages';
