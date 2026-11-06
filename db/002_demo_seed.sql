-- =====================================================================
-- ข้อมูลร้านทดลอง "demo" (ข้อมูลปลอมทั้งหมด) — ใช้วัดความเร็วขั้น 2 และทดสอบขั้นต่อไป
--
-- ใช้กับโปรเจค line-crm-test เท่านั้น
-- วิธีใช้: Supabase (line-crm-test) → SQL Editor → New query → วางทั้งไฟล์ → Run
--
-- ขนาดเท่ากับที่ใช้ทดสอบ Apps Script 2.8.1: สมาชิก 2,000 คน / ซื้อ 28,000 ครั้ง / แลกของรางวัล ~1,900 ครั้ง
--   สมาชิกคนที่ 1 ซื้อบ่อยสุด (~600 รายการ) ไล่ลงไปถึงคนที่ 2,000 ที่ซื้อน้อย — เหมือนร้านจริงที่มีลูกค้าประจำไม่กี่คน
--
-- รันซ้ำได้: ลบข้อมูลร้าน demo เดิมทิ้งแล้วสร้างใหม่ (ไม่แตะร้านอื่น) / ได้ข้อมูลชุดเดิมทุกครั้ง (setseed)
-- กันพลาด: ถ้าฐานข้อมูลนี้มีร้านอื่นนอกจาก demo (= ฐานข้อมูลที่ใช้จริง) จะหยุดทันทีโดยไม่เปลี่ยนอะไรเลย
-- =====================================================================

begin;

do $$
begin
  if exists (select 1 from shops where id <> 'demo') then
    raise exception 'ฐานข้อมูลนี้มีร้านจริงอยู่ — ไฟล์นี้ใช้กับ line-crm-test เท่านั้น (ไม่ได้เปลี่ยนอะไร)';
  end if;
end
$$;

-- ล้างของเดิม (ลำดับตามการอ้างถึงกันของตาราง: ลูกก่อนแม่)
delete from request_log  where shop_id = 'demo';
delete from tier_history where shop_id = 'demo';
delete from profile_log  where shop_id = 'demo';
delete from coupons      where shop_id = 'demo';
delete from transactions where shop_id = 'demo';
delete from point_rules  where shop_id = 'demo';
delete from promotions   where shop_id = 'demo';
delete from rewards      where shop_id = 'demo';
delete from staff        where shop_id = 'demo';
delete from branches     where shop_id = 'demo';
delete from members      where shop_id = 'demo';
delete from tiers        where shop_id = 'demo';
delete from shops        where id = 'demo';

select setseed(0.42);  -- ตัวเลขสุ่มชุดเดิมทุกครั้งที่รัน

-- liff_id = ช่อง LINE "Go To Target Demo" (ตัวเลขหน้า "-" ใช้ตรวจว่ารหัส LINE ออกให้ร้านนี้จริง) — ต้องตรงกับ shops/demo/config.js
insert into shops (id, name, liff_id, member_prefix, point_rate_baht, welcome_points)
values ('demo', 'ร้านทดลอง (ข้อมูลปลอม)', '2012434511-bQt38UpF', 'DM', 20, 10);

insert into branches (shop_id, id, name, sort)
select 'demo', 'B0' || i, 'สาขาทดลอง ' || i, i
from generate_series(1, 6) i;

insert into members (shop_id, id, line_user_id, name, first_name, last_name, phone, birth_date,
                     joined_at, joined_branch, consent_version, consent_at, marketing_consent)
select 'demo',
       'DM-' || lpad(i::text, 6, '0'),
       'U_DEMO_' || i,
       -- ชื่อห้ามมีตัวเลข (กฎเดียวกับตอนสมัคร) → สลับชื่อ-นามสกุลจากรายการ ไม่ใช่ "ลูกค้า1"
       fn || ' ' || ln, fn, ln,
       '08' || lpad(i::text, 8, '0'),
       date '1965-01-01' + (random() * 14000)::int,
       now() - interval '760 days' - random() * interval '30 days',  -- สมัครก่อนรายการซื้อทุกรายการ (ซื้อภายใน 730 วัน)
       'B0' || (1 + floor(random() * 6)::int),
       1, now() - interval '760 days', random() < 0.6
from generate_series(1, 2000) i,
     lateral (select (array['สมชาย','สมหญิง','มานะ','มานี','ปิติ','ชูใจ','วีระ','ดวงใจ','กมล','สุดา'])[1 + i % 10] as fn,
                     (array['ใจดี','รักเรียน','มีสุข','ทองดี','ศรีสุข','แสงทอง','บุญมา'])[1 + (i / 10) % 7] as ln) n;

-- แต้มต้อนรับตอนสมัคร
insert into transactions (shop_id, id, created_at, member_id, type, amount, points, balance_after, detail, branch)
select 'demo', 'TX-W' || lpad(substr(m.id, 4), 7, '0'), m.joined_at, m.id, 'WELCOME', 0, 10, 10, 'แต้มต้อนรับสมาชิกใหม่', m.joined_branch
from members m where m.shop_id = 'demo';

-- ซื้อสินค้า: สุ่มคน (ยกกำลังสอง = คนเลขน้อยซื้อบ่อยกว่า) / วัน / ยอด / สาขา
-- แต้มคงเหลือ = 10 (ต้อนรับ) + แต้มสะสมเรียงตามเวลา
with ev as (
  select i,
         1 + floor(power(random(), 2) * 2000)::int as m,
         now() - random() * interval '730 days' as at,
         (50 + floor(random() * 1950))::numeric(12, 2) as amount,
         1 + floor(random() * 6)::int as b
  from generate_series(1, 28000) i
)
insert into transactions (shop_id, id, created_at, member_id, type, amount, points, balance_after,
                          detail, staff, request_id, branch)
select 'demo',
       'TX-E' || lpad(i::text, 7, '0'),
       at,
       'DM-' || lpad(m::text, 6, '0'),
       'EARN',
       amount,
       floor(amount / 20)::int,
       10 + sum(floor(amount / 20)::int) over (partition by m order by at, i),
       'ซื้อสินค้า ' || amount::int || ' บาท',
       'แคชเชียร์ทดลอง',
       md5('demo-' || i),
       'B0' || b
from ev;

insert into rewards (shop_id, id, name, description, type, points, sort)
values ('demo', 'R001', 'เครื่องดื่ม 1 แก้ว',     'เลือกได้ทุกเมนูเครื่องดื่ม', '', 100, 1),
       ('demo', 'R002', 'ของหวาน 1 ที่',          'เลือกได้ทุกเมนูของหวาน', '', 200, 2),
       ('demo', 'R003', 'ส่วนลด 50 บาท',          'ใช้ได้เมื่อซื้อครบ 300 บาท', '', 300, 3),
       ('demo', 'R004', 'ส่วนลด 100 บาท',         'ใช้ได้เมื่อซื้อครบ 500 บาท', '', 500, 4),
       ('demo', 'R005', 'เมนูจานหลัก 1 ที่',      'ไม่รวมเมนูพิเศษ', '', 800, 5),
       ('demo', 'R006', 'เซ็ตอาหาร 2 ท่าน',       'ไม่รวมเครื่องดื่ม', '', 1500, 6),
       ('demo', 'R007', 'บัตรกำนัล 500 บาท',      'ใช้ได้ทุกสาขา', '', 2000, 7),
       ('demo', 'R008', 'ของขวัญวันเกิด: เค้ก 1 ชิ้น', 'รับได้ในเดือนเกิด ปีละครั้ง', 'BIRTHDAY', 0, 8);

insert into promotions (shop_id, id, title, subtitle, tag, sort, start_date, end_date)
values ('demo', 'P001', 'สมาชิกใหม่รับแต้มต้อนรับ', 'สมัครวันนี้รับทันที 10 แต้ม', 'ใหม่', 1, null, null),
       ('demo', 'P002', 'วันพุธแต้ม 2 เท่า', 'ทุกสาขา ทุกบิล', 'แต้ม x2', 2, null, null),
       ('demo', 'P003', 'เมนูใหม่ประจำเดือน', 'ลองแล้วบอกต่อ', '', 3, current_date - 10, current_date + 20),
       ('demo', 'P004', 'โปรที่หมดไปแล้ว (ไม่ควรแสดง)', '', '', 4, current_date - 60, current_date - 30);

insert into point_rules (shop_id, id, name, multiplier, days, branch, show_badge)
values ('demo', 'PR001', 'วันพุธแต้ม 2 เท่า', 2, array['WED'], '', true),
       ('demo', 'PR002', 'เสาร์-อาทิตย์ สาขา 1 แต้ม 1.5 เท่า', 1.5, array['SAT', 'SUN'], 'B01', false);

insert into staff (shop_id, line_user_id, name, role, status)
values ('demo', 'U_DEMO_OWNER', 'เจ้าของร้านทดลอง', 'OWNER', 'ACTIVE'),
       ('demo', 'U_DEMO_CASHIER', 'แคชเชียร์ทดลอง', 'CASHIER', 'ACTIVE');

-- แลกเครื่องดื่ม 1 ครั้ง ต่อสมาชิกที่แต้มถึง 100 — ต่อท้ายรายการล่าสุดของแต่ละคน แต้มจึงไม่ติดลบ
-- ไม่ใช้ตารางชั่วคราว: SQL Editor ของ Supabase ล้างตารางชั่วคราวระหว่างคำสั่ง (เจอจริง 6 พ.ย. 2569:
-- relation "demo_redeem" does not exist) → ทุกคำสั่งในไฟล์นี้ต้องอ่านจากตารางจริงเท่านั้น
insert into transactions (shop_id, id, created_at, member_id, type, amount, points, balance_after, detail, ref)
select 'demo', 'TX-R' || lpad(n::text, 7, '0'), at, member_id, 'REDEEM', 0, -100, balance_after - 100,
       'แลก: เครื่องดื่ม 1 แก้ว', 'CP-' || lpad(n::text, 6, '0')
from (select row_number() over (order by member_id) as n,
             member_id,
             created_at + interval '1 minute' as at,
             balance_after
      from (select distinct on (member_id) member_id, created_at, balance_after
            from transactions where shop_id = 'demo'
            order by member_id, created_at desc, id desc) last
      where balance_after >= 100) r;

-- คูปองจากการแลก (สร้างจากรายการแลกด้านบน: รหัสคูปองอยู่ในช่อง ref)
-- ราว 60% ใช้แล้ว ที่เหลือยังไม่ใช้ (บางใบหมดอายุไปแล้วตามวันที่)
insert into coupons (shop_id, code, member_id, reward_id, name, points_used, issued_at, expires_at,
                     used_at, used_by, used_branch, status, tx_id)
select 'demo', ref, member_id, 'R001', 'เครื่องดื่ม 1 แก้ว', 100,
       created_at, created_at + interval '30 days',
       case when u then created_at + interval '1 day' end,
       case when u then 'แคชเชียร์ทดลอง' else '' end,
       case when u then 'B01' else '' end,
       case when u then 'USED' else 'ACTIVE' end,
       id
from (select t.*, random() < 0.6 as u
      from (select * from transactions where shop_id = 'demo' and type = 'REDEEM' order by id) t) r;

-- ยอดสรุปของสมาชิกให้ตรงกับรายการ (แต้มคงเหลือ = รายการล่าสุด)
update members m
set points        = s.bal,
    total_spend   = s.spend,
    visit_count   = s.visits,
    last_visit_at = s.last_at
from (select member_id,
             (array_agg(balance_after order by created_at desc, id desc))[1] as bal,
             coalesce(sum(amount) filter (where type = 'EARN'), 0) as spend,
             count(*) filter (where type = 'EARN') as visits,
             max(created_at) filter (where type = 'EARN') as last_at
      from transactions where shop_id = 'demo'
      group by member_id) s
where m.shop_id = 'demo' and m.id = s.member_id;

-- ให้ฐานข้อมูลรู้ขนาดข้อมูลใหม่ทันที (เลือกวิธีค้นที่เร็วได้ตั้งแต่ครั้งแรก ไม่ต้องรอระบบนับเอง)
analyze members;
analyze transactions;
analyze coupons;

commit;

-- ผลที่ควรเห็นหลังรัน: ตารางสรุปด้านล่าง (สมาชิก 2000 / รายการราว 31,900 / คูปองราว 1,900)
select (select count(*) from members where shop_id = 'demo')      as members,
       (select count(*) from transactions where shop_id = 'demo') as transactions,
       (select count(*) from coupons where shop_id = 'demo')      as coupons;
