-- =====================================================================
-- LINE CRM สะสมแต้ม — ตารางฐานข้อมูล รุ่นแรก (Supabase / PostgreSQL)
--
-- แทน Google Sheet 10 ชีตเดิม + เพิ่มระดับสมาชิก (tier) — ผู้ใช้ตกลงแบบเมื่อ 6 พ.ย. 2569
-- เหตุผลที่ย้าย: Apps Script ตอบช้า 1–3 วินาทีทุกครั้ง (ลูกค้าที่น้องไปเสนอขายติดเรื่องนี้)
-- รายละเอียดการตัดสินใจอยู่ใน CLAUDE.md หัวข้อ "ย้ายไปฐานข้อมูล"
--
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run
--   ใช้กับฐานข้อมูลเปล่าเท่านั้น (รันซ้ำจะ error ว่ามีตารางแล้ว — ไม่ทำลายข้อมูลเดิม)
--   ทั้งไฟล์อยู่ใน begin/commit: ถ้าพังกลางทาง จะไม่มีตารางครึ่งๆ กลางๆ ค้างอยู่
--
-- หลักของแบบนี้:
--   • ทุกร้านอยู่ในฐานข้อมูลเดียว ทุกตารางมี shop_id — เพิ่มร้านใหม่ = เพิ่ม 1 แถวในตาราง shops
--     (เดิมต้องสร้างชีต + Apps Script ใหม่ทุกร้าน)
--   • รหัสต่างๆ ใช้รูปแบบเดิม (KW-XXXXXX, TX-..., CP-..., R001, B001, PR001) หน้าเว็บจึงไม่ต้องแก้
--   • กฎที่เดิมตรวจในโค้ด (เบอร์ห้ามซ้ำ / กันบันทึกซ้ำ / แต้มห้ามติดลบ / ของขวัญวันเกิดปีละครั้ง)
--     ให้ฐานข้อมูลตรวจซ้ำอีกชั้น — ต่อให้โค้ดพลาด ข้อมูลก็ไม่ผิด
--   • เวลาเก็บแบบมีเขตเวลา (timestamptz) แสดงผลเป็นเวลาไทยในโค้ด / วันที่ล้วน (วันเกิด วันเริ่ม-สิ้นสุด) เก็บเป็น date
--   • ตัวเลขเก็บเป็นตัวเลขจริง ไม่มีปัญหาชีตตัดเลข 0 หน้าเบอร์ หรือแปลงข้อความเป็นวันที่เอง
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- ร้าน (เดิม: ชีต Settings ของแต่ละร้าน)
-- ค่าที่ต้องเป็นตัวเลขแยกเป็นคอลัมน์ (ฐานข้อมูลตรวจช่วงค่าให้) / หน้าตาร้านเก็บรวมใน brand (มีหลายช่อง ไม่บังคับ)
-- แพ็กเกจ (หลายสาขา / tier) ยังอยู่ใน shops/<ร้าน>/config.js เหมือนเดิม — ตัดสินใจ 4 พ.ย. 2569
-- ---------------------------------------------------------------------
create table shops (
  -- รหัสร้าน = ส่วนในลิงก์ /<ร้าน> ห้ามซ้ำกับชื่อที่จองไว้ (ต้องตรงกับ app/shop.js และ vercel.json)
  id                    text primary key
                        check (id ~ '^[a-z0-9][a-z0-9-]{1,29}$'
                               and id not in ('staff', 'admin', 'app', 'shops', 'themes', 'tools', 'api', 'assets')),
  name                  text not null default '' check (length(name) <= 60),  -- ว่าง = ใช้ชื่อใน config.js
  liff_id               text not null default '' check (liff_id = '' or liff_id ~ '^\d+-[A-Za-z0-9]+$'),
  -- CP กับ TX ใช้นำหน้ารหัสคูปอง/รายการ ห้ามใช้เป็นรหัสสมาชิก (พนักงานค้นจากรหัสจะสับสน)
  member_prefix         text not null default 'M'
                        check (member_prefix ~ '^[A-Z]{1,4}$' and member_prefix not in ('CP', 'TX')),
  point_rate_baht       numeric(10, 2) not null default 20 check (point_rate_baht between 1 and 100000),
  welcome_points        integer not null default 0 check (welcome_points between 0 and 100000),
  max_purchase          numeric(12, 2) not null default 20000 check (max_purchase between 1 and 10000000),
  confirm_purchase_over numeric(12, 2) not null default 3000 check (confirm_purchase_over between 1 and 10000000),
  coupon_days           integer not null default 30 check (coupon_days between 1 and 3650),
  history_limit         integer not null default 50 check (history_limit between 10 and 200),
  -- เลขฉบับนโยบายความเป็นส่วนตัว — เพิ่มเองเมื่อแก้ข้อความนโยบาย (PDPA: ต้องรู้ว่าลูกค้ายอมรับฉบับไหน)
  consent_version       integer not null default 1 check (consent_version >= 1),
  -- หน้าตาร้าน: logo theme colors{primary,button,accent,card} texts{pointUnit,greeting,...} privacyText
  brand                 jsonb not null default '{}'::jsonb check (jsonb_typeof(brand) = 'object'),
  status                text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ระดับสมาชิก (ใหม่) — ร้านตั้งเอง 2–5 ระดับ (จำนวนตรวจในโค้ด) เรียงตาม min_spend
-- ค่าเริ่มต้นที่ผู้ใช้ตกลง: ยอดซื้อ 12 เดือนล่าสุด / ขึ้นทันทีเมื่อถึงเกณฑ์ / คงระดับ 12 เดือน แล้วลดทีละ 1 ระดับ
-- ---------------------------------------------------------------------
create table tiers (
  shop_id          text not null references shops (id) on delete cascade,
  id               text not null check (id ~ '^T\d{1,3}$'),
  name             text not null check (length(name) between 1 and 30),
  min_spend        numeric(12, 2) not null default 0 check (min_spend >= 0),  -- ระดับแรกของร้าน = 0
  -- ตัวคูณแต้มทุกบิล — ถ้าวันนั้นมีแต้มพิเศษด้วย ใช้ตัวที่มากสุดตัวเดียว ไม่คูณซ้อน (เหมือนกติกาแต้มพิเศษเดิม)
  point_multiplier numeric(2, 1) not null default 1 check (point_multiplier in (1, 1.5, 2, 3)),
  color            text not null default '' check (color = '' or color ~ '^#[0-9A-Fa-f]{6}$'),
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at       timestamptz not null default now(),
  primary key (shop_id, id),
  unique (shop_id, min_spend)  -- 2 ระดับใช้เกณฑ์เดียวกันไม่ได้ (ระบบจะไม่รู้ว่าให้ระดับไหน)
);

-- ---------------------------------------------------------------------
-- สมาชิก (เดิม: Members) + ระดับปัจจุบัน
-- ---------------------------------------------------------------------
create table members (
  shop_id           text not null references shops (id),
  id                text not null check (id ~ '^[A-Z]{1,4}-[A-Z0-9]{4,12}$'),  -- เช่น KW-DKAFFC
  -- null ได้: สมาชิกที่ร้านเพิ่มเอง/ย้ายมาจากระบบเก่าโดยยังไม่ผูก LINE
  line_user_id      text check (line_user_id is null or line_user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name              text not null default '',  -- "ชื่อ นามสกุล" (สมาชิกรุ่นแรกมีแต่ช่องนี้)
  first_name        text not null default '',
  last_name         text not null default '',
  phone             text not null check (phone ~ '^0\d{8,9}$'),  -- สมัครใหม่บังคับมือถือ 10 หลัก (ตรวจในโค้ด) / ของเก่าอาจเป็นเบอร์บ้าน 9 หลัก
  birth_date        date,
  birth_date_edits  integer not null default 0 check (birth_date_edits >= 0),  -- ลูกค้าแก้วันเกิดเองได้ 1 ครั้ง
  picture           text not null default '',
  points            integer not null default 0 check (points >= 0),
  total_spend       numeric(14, 2) not null default 0 check (total_spend >= 0),
  visit_count       integer not null default 0 check (visit_count >= 0),
  tier_id           text,         -- null = ร้านยังไม่เปิดใช้ระดับ
  tier_since        timestamptz,  -- ได้ระดับนี้เมื่อไร
  tier_until        date,         -- คงระดับถึงวันไหน (ครบแล้วยอดไม่ถึง → ลด 1 ระดับ)
  joined_at         timestamptz not null default now(),
  joined_branch     text not null default '',  -- รหัสสาขา / ONLINE / ว่าง = ร้านยังไม่มีสาขา
  last_visit_at     timestamptz,
  consent_version   integer,
  consent_at        timestamptz,
  marketing_consent boolean not null default false,
  status            text not null default 'ACTIVE' check (status in ('ACTIVE', 'BLOCKED')),
  note              text not null default '',
  primary key (shop_id, id),
  unique (shop_id, line_user_id),  -- 1 บัญชี LINE = สมาชิก 1 คนต่อร้าน
  unique (shop_id, phone),         -- เบอร์ห้ามซ้ำในร้านเดียวกัน (ร้านอื่นใช้เบอร์เดียวกันได้)
  foreign key (shop_id, tier_id) references tiers (shop_id, id)
);

-- ---------------------------------------------------------------------
-- รายการแต้ม (เดิม: Transactions)
-- ---------------------------------------------------------------------
create table transactions (
  shop_id       text not null references shops (id),
  id            text not null check (id ~ '^TX-[A-Z0-9]{4,20}$'),
  created_at    timestamptz not null default now(),
  member_id     text not null,
  type          text not null check (type in ('EARN', 'WELCOME', 'REDEEM', 'ADJUST')),
  amount        numeric(12, 2) not null default 0 check (amount >= 0),
  points        integer not null default 0,
  balance_after integer not null check (balance_after >= 0),
  detail        text not null default '',
  staff         text not null default '',
  -- รหัสคำขอจากหน้าเว็บ — ห้ามซ้ำในร้าน = กันบันทึกซ้ำเมื่อเน็ตหลุดแล้วกดใหม่
  -- (แทนการค้นแค่ 2,000 รายการล่าสุดใน Apps Script 2.8.1 — ฐานข้อมูลตรวจได้ทั้งหมดในพริบตา)
  request_id    text check (request_id ~ '^[A-Za-z0-9-]{8,64}$'),
  ref           text not null default '',   -- รหัสคูปอง / รหัสกติกาแต้มพิเศษ
  branch        text not null default '',
  primary key (shop_id, id),
  foreign key (shop_id, member_id) references members (shop_id, id),
  unique (shop_id, request_id)
);
-- ประวัติของสมาชิกแต่ละคน (หน้าลูกค้า) / รายการตามช่วงวัน (หลังบ้าน) — ไม่ต้องไล่อ่านทั้งตาราง
create index transactions_member_idx on transactions (shop_id, member_id, created_at desc);
create index transactions_date_idx on transactions (shop_id, created_at desc);

-- ---------------------------------------------------------------------
-- ของรางวัล (เดิม: Rewards) + ระดับขั้นต่ำที่แลกได้
-- ---------------------------------------------------------------------
create table rewards (
  shop_id          text not null references shops (id),
  id               text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  name             text not null check (length(name) between 1 and 80),
  description      text not null default '' check (length(description) <= 300),
  type             text not null default '' check (type in ('', 'BIRTHDAY')),  -- BIRTHDAY = ของขวัญวันเกิด
  points           integer not null default 0 check (points between 0 and 1000000),  -- 0 ได้เฉพาะของขวัญวันเกิด (ตรวจในโค้ด)
  image            text not null default '',
  valid_days       integer check (valid_days between 1 and 3650),  -- null = ใช้ coupon_days ของร้าน
  quota            integer check (quota between 1 and 1000000),     -- null = ไม่จำกัด
  issued           integer not null default 0 check (issued >= 0),
  limit_per_member integer check (limit_per_member between 1 and 1000),
  start_date       date,
  end_date         date,
  -- ระดับขั้นต่ำ: "ตั้งแต่ระดับนี้ขึ้นไป" แลกได้ (null = ทุกระดับ) — ระดับสูงได้ทุกอย่างที่ระดับต่ำกว่าได้
  -- ของขวัญวันเกิด: ลูกค้าได้ชิ้นของระดับสูงสุดที่ตัวเองถึง (เช่น Gold ได้เค้ก ระดับอื่นได้เครื่องดื่ม)
  min_tier_id      text,
  sort             integer not null default 0,
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at       timestamptz not null default now(),
  primary key (shop_id, id),
  foreign key (shop_id, min_tier_id) references tiers (shop_id, id),
  check (start_date is null or end_date is null or end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- คูปอง (เดิม: Coupons)
-- ---------------------------------------------------------------------
create table coupons (
  shop_id       text not null references shops (id),
  code          text not null check (code ~ '^CP-[A-Z0-9]{4,20}$'),
  member_id     text not null,
  reward_id     text not null,
  name          text not null default '',  -- ชื่อของรางวัลตอนแลก (ร้านแก้ชื่อทีหลัง คูปองเก่ายังเป็นชื่อเดิม)
  points_used   integer not null default 0 check (points_used >= 0),
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz,
  used_at       timestamptz,
  used_by       text not null default '',
  used_branch   text not null default '',
  status        text not null default 'ACTIVE' check (status in ('ACTIVE', 'USED', 'CANCELLED')),
  tx_id         text,
  -- ปีที่รับของขวัญวันเกิด (null = คูปองปกติ) — ห้ามซ้ำ = ปีละครั้งต่อคน ต่อให้กดพร้อมกัน 2 เครื่อง
  -- ยกเลิกคูปองวันเกิด → ตั้งช่องนี้เป็น null ก่อน ลูกค้าจึงรับใหม่ได้
  birthday_year integer check (birthday_year between 2000 and 2200),
  primary key (shop_id, code),
  foreign key (shop_id, member_id) references members (shop_id, id),
  foreign key (shop_id, reward_id) references rewards (shop_id, id),
  unique (shop_id, member_id, birthday_year)
);
create index coupons_member_idx on coupons (shop_id, member_id, issued_at desc);
create index coupons_issued_idx on coupons (shop_id, issued_at desc);

-- ---------------------------------------------------------------------
-- พนักงาน (เดิม: Staff) — คนเดียวเป็นพนักงานได้หลายร้าน (คีย์คือ ร้าน + บัญชี LINE)
-- ---------------------------------------------------------------------
create table staff (
  shop_id      text not null references shops (id),
  line_user_id text not null check (line_user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name         text not null default '',
  role         text not null default 'CASHIER' check (role in ('OWNER', 'ADMIN', 'CASHIER')),
  status       text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'DISABLED')),
  branches     text[],  -- null = ทุกสาขา (เดิม: ช่องว่าง หรือ ALL) / OWNER ใช้ได้ทุกสาขาเสมอ (ตรวจในโค้ด)
  requested_at timestamptz not null default now(),
  note         text not null default '',
  primary key (shop_id, line_user_id)
);

-- ---------------------------------------------------------------------
-- โปรโมชัน / แบนเนอร์ (เดิม: Promotions) + ระดับขั้นต่ำที่เห็น
-- ---------------------------------------------------------------------
create table promotions (
  shop_id     text not null references shops (id),
  id          text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  title       text not null check (length(title) between 1 and 80),
  subtitle    text not null default '' check (length(subtitle) <= 150),
  tag         text not null default '' check (length(tag) <= 30),
  image       text not null default '',
  link        text not null default '' check (link = '' or link ~ '^https://'),  -- กันลิงก์อันตราย เช่น javascript:
  start_date  date,
  end_date    date,
  min_tier_id text,
  sort        integer not null default 0,
  status      text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at  timestamptz not null default now(),
  primary key (shop_id, id),
  foreign key (shop_id, min_tier_id) references tiers (shop_id, id),
  check (start_date is null or end_date is null or end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- สาขา (เดิม: Branches) — ไม่มีการลบ ใช้ INACTIVE (รายการเก่าอ้างถึง)
-- ---------------------------------------------------------------------
create table branches (
  shop_id    text not null references shops (id),
  -- ONLINE / ADMIN / OTHER / ALL เป็นรหัสพิเศษในระบบ ห้ามใช้เป็นรหัสสาขา
  id         text not null check (id ~ '^[A-Z0-9]{1,12}$' and id not in ('ONLINE', 'ADMIN', 'OTHER', 'ALL')),
  name       text not null check (length(name) between 1 and 40),
  status     text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (shop_id, id)
);
create unique index branches_name_uq on branches (shop_id, lower(name));  -- ชื่อสาขาห้ามซ้ำ (ไม่สนตัวพิมพ์เล็ก-ใหญ่)

-- ---------------------------------------------------------------------
-- ประวัติการแก้ข้อมูลสมาชิก (เดิม: Profile_Log) — จดว่าแก้ช่องไหน ไม่เก็บค่าเดิม (ลดข้อมูลส่วนตัว)
-- ---------------------------------------------------------------------
create table profile_log (
  id         bigint generated always as identity primary key,
  shop_id    text not null references shops (id),
  created_at timestamptz not null default now(),
  member_id  text not null,
  changed    text not null,
  by_name    text not null default '',
  foreign key (shop_id, member_id) references members (shop_id, id)
);
create index profile_log_member_idx on profile_log (shop_id, member_id, created_at desc);

-- ---------------------------------------------------------------------
-- กติกาแต้มพิเศษ (เดิม: Point_Rules) + ระดับขั้นต่ำที่ได้สิทธิ์ (เช่น "Gold ×2 ทุกวันพุธ")
-- ---------------------------------------------------------------------
create table point_rules (
  shop_id     text not null references shops (id),
  id          text not null check (id ~ '^PR\d{3,}$'),
  name        text not null check (length(name) between 1 and 60),
  multiplier  numeric(2, 1) not null check (multiplier in (1.5, 2, 3)),
  -- วันที่มีผล อย่างน้อย 1 วัน (เดิมช่องว่าง = ทุกวัน → ตอนย้ายข้อมูลแปลงเป็นครบ 7 วัน)
  days        text[] not null check (cardinality(days) >= 1
                                    and days <@ array['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
  start_date  date,
  end_date    date,
  branch      text not null default '',  -- ว่าง = ทุกสาขา
  min_amount  numeric(12, 2) check (min_amount > 0),  -- null = ทุกบิล
  min_tier_id text,
  show_badge  boolean not null default false,  -- แสดงการ์ด "วันนี้ได้พอยท์ ×2" ที่หน้าลูกค้า
  status      text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at  timestamptz not null default now(),
  primary key (shop_id, id),
  foreign key (shop_id, min_tier_id) references tiers (shop_id, id),
  check (start_date is null or end_date is null or end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- ประวัติระดับ (ใหม่) — ใครขึ้น/ลงระดับ เมื่อไร เพราะอะไร (ตอบลูกค้าได้ว่าทำไมระดับเปลี่ยน)
-- ---------------------------------------------------------------------
create table tier_history (
  id           bigint generated always as identity primary key,
  shop_id      text not null references shops (id),
  created_at   timestamptz not null default now(),
  member_id    text not null,
  from_tier_id text,
  to_tier_id   text,
  reason       text not null check (reason in ('START', 'UP', 'DOWN', 'ADMIN')),  -- ADMIN = เจ้าของร้านปรับเอง
  spend_12m    numeric(14, 2),  -- ยอดซื้อ 12 เดือนตอนที่เปลี่ยน
  by_name      text not null default '',
  foreign key (shop_id, member_id) references members (shop_id, id)
);
create index tier_history_member_idx on tier_history (shop_id, member_id, created_at desc);

-- ---------------------------------------------------------------------
-- กันกดซ้ำ (ใหม่) — จำผลของคำสั่งที่ทำไปแล้ว: ส่ง requestId เดิมมาอีก = ได้ผลเดิม ไม่ทำซ้ำ
-- แทน CacheService ของ Apps Script (หายเองใน 6 ชั่วโมง และบางทีหายก่อนกำหนด)
-- ลบรายการเก่ากว่า 30 วันทิ้งได้ (ตั้งงานลบอัตโนมัติตอนขั้นพร้อมขาย)
-- ---------------------------------------------------------------------
create table request_log (
  shop_id    text not null references shops (id),
  user_id    text not null,
  action     text not null,
  request_id text not null check (request_id ~ '^[A-Za-z0-9-]{8,64}$'),
  result     jsonb not null,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id, action, request_id)
);
create index request_log_created_idx on request_log (created_at);

-- ---------------------------------------------------------------------
-- ความปลอดภัย: ปิดทุกตารางจากภายนอก
-- เปิด Row Level Security โดยไม่ตั้งกติกาใดๆ = กุญแจสาธารณะ (anon) อ่าน/เขียนไม่ได้เลย
-- ตัวกลางบน Vercel ใช้กุญแจลับ (service_role) ซึ่งข้าม RLS ได้ → ข้อมูลเข้าออกได้ทางเดียว และตรวจสิทธิ์ทุกคำสั่งที่นั่น
-- (กุญแจลับเก็บในหน้าตั้งค่า Vercel เท่านั้น ห้ามอยู่ในไฟล์ใดๆ ในโปรเจค)
-- ---------------------------------------------------------------------
alter table shops        enable row level security;
alter table tiers        enable row level security;
alter table members      enable row level security;
alter table transactions enable row level security;
alter table rewards      enable row level security;
alter table coupons      enable row level security;
alter table staff        enable row level security;
alter table promotions   enable row level security;
alter table branches     enable row level security;
alter table profile_log  enable row level security;
alter table point_rules  enable row level security;
alter table tier_history enable row level security;
alter table request_log  enable row level security;

-- ถอนสิทธิ์ของบทบาทสาธารณะใน Supabase อีกชั้น (ฐานข้อมูลทดสอบในเครื่องไม่มีบทบาทเหล่านี้ → ข้าม)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon, authenticated;
    revoke all on all sequences in schema public from anon, authenticated;
  end if;
end
$$;

commit;
