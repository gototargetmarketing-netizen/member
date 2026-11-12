-- =====================================================================
-- 005: ประวัติการส่งข้อความตามกลุ่ม (ผู้ใช้เลือกแบบ ข 12 พ.ย. 2569 — ร้านส่งข้อความหาลูกค้าผ่าน LINE OA ของร้านจากหลังบ้าน)
--   • จดทุกครั้งที่ส่ง: ใครส่ง เมื่อไร เงื่อนไขอะไร ข้อความอะไร ส่งถึงกี่คน (ย้อนดูได้ / ตรงกับข้อตกลง PDPA)
--   • เก็บรหัสสมาชิกผู้รับ ณ ตอนกดส่ง (ไม่เก็บ LINE ID) → ส่งไม่ครบแล้วกด "ส่งต่อ" ได้ชุดเดิม ไม่ซ้ำคนที่ได้ไปแล้ว
-- รันซ้ำได้ (ทุกคำสั่งเช็กก่อนทำ) — วางใน Supabase SQL Editor ทั้งไฟล์แล้วกด Run
-- ต้องรัน "ก่อน" ส่งโค้ดส่งข้อความรอบ 2 ขึ้นลิงก์ทดสอบ (ไม่งั้นหน้าส่งข้อความเปิดไม่ได้)
-- =====================================================================
begin;

create table if not exists broadcasts (
  shop_id         text not null references shops (id),
  id              text not null check (id ~ '^BC-[A-Z0-9]{6,12}$'),
  request_id      text not null check (request_id ~ '^[A-Za-z0-9-]{8,64}$'),  -- กดซ้ำ / เน็ตหลุดแล้วส่งใหม่ = แถวเดิม ไม่ส่งซ้ำ
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),  -- ขยับทุกชุดที่ส่ง: ค้างนานแปลว่าเครื่องหยุดกลางทาง → ส่งต่อได้
  finished_at     timestamptz,
  created_by      text not null,                       -- LINE ID ของเจ้าของร้านที่กดส่ง
  created_by_name text not null default '',
  filter          jsonb not null default '{}'::jsonb,  -- เงื่อนไขที่ใช้คัดกลุ่ม
  message_text    text not null default '' check (length(message_text) <= 5000),
  message_image   text not null default '',
  recipients      text[] not null,                     -- รหัสสมาชิกเรียงแล้ว แบ่งชุดละ 500 ตามลำดับนี้เสมอ
  total           integer not null check (total >= 0),
  sent            integer not null default 0 check (sent >= 0),
  batches_done    integer[] not null default '{}',
  status          text not null default 'SENDING' check (status in ('SENDING', 'DONE', 'PARTIAL', 'FAILED')),
  error           text not null default '',
  primary key (shop_id, id),
  unique (shop_id, request_id)
);
create index if not exists broadcasts_shop_created_idx on broadcasts (shop_id, created_at desc);

-- ปิดจากภายนอกเหมือนทุกตาราง (เข้าได้ทางตัวกลางเท่านั้น)
alter table broadcasts enable row level security;

commit;

-- ตรวจผล: ควรเห็น 1 แถว rowsecurity = true
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'broadcasts';
