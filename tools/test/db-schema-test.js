// ตรวจ db/001_schema.sql (+ ไฟล์ปรับตาราง 003/004 ท้ายชุด) บน PostgreSQL จำลองในเครื่อง (PGlite — ไม่ต้องใช้ Supabase จริง)
// รันได้จริง + กฎกันข้อมูลผิดทำงาน + ความเร็วเมื่อข้อมูลเยอะ
// ติดตั้งครั้งแรก: cd tools/test && npm install
// รัน: node tools/test/db-schema-test.js
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const SCHEMA = require('path').join(__dirname, '..', '..', 'db', '001_schema.sql');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x ? '  → ' + x : '')); } };
async function rejects(db, sql, params, msg) {
  try { await db.query(sql, params); ok(false, msg, 'ฐานข้อมูลยอมรับ (ไม่ควร)'); }
  catch (e) { ok(true, msg + '  [' + e.message.split('\n')[0].slice(0, 70) + ']'); }
}
(async () => {
  const db = new PGlite();
  console.log('\n[1] สร้างตาราง');
  await db.exec(fs.readFileSync(SCHEMA, 'utf8'));
  const t = (await db.query(`select table_name from information_schema.tables where table_schema='public' order by 1`)).rows.map(r => r.table_name);
  ok(t.length === 13, 'สร้างครบ 13 ตาราง: ' + t.join(', '));
  const rls = (await db.query(`select relname from pg_class where relkind='r' and relnamespace='public'::regnamespace and not relrowsecurity`)).rows;
  ok(rls.length === 0, 'ทุกตารางเปิด Row Level Security (ภายนอกเข้าไม่ได้)', JSON.stringify(rls));
  try { await db.exec(fs.readFileSync(SCHEMA, 'utf8')); ok(false, 'รันซ้ำต้อง error'); }
  catch (e) { await db.exec('rollback'); const n = (await db.query(`select count(*)::int as n from information_schema.tables where table_schema='public'`)).rows[0].n; ok(n === 13, 'รันไฟล์ซ้ำ → error ทั้งก้อน ตารางเดิมยังอยู่ครบ'); }

  console.log('\n[2] ร้าน + ระดับ');
  await db.query(`insert into shops (id, name, liff_id, member_prefix) values ('khamwan','คำหวาน CUISINE','2011913909-NcxFMTsN','KW'), ('demo','ร้านตัวอย่าง','','DM')`);
  ok(true, 'เพิ่มร้าน 2 ร้าน');
  await rejects(db, `insert into shops (id) values ('admin')`, [], 'รหัสร้านซ้ำชื่อที่จองไว้ (admin) → ปฏิเสธ');
  await rejects(db, `insert into shops (id, member_prefix) values ('x1','CP')`, [], 'รหัสนำหน้าสมาชิก CP → ปฏิเสธ');
  await rejects(db, `update shops set point_rate_baht = 0 where id='khamwan'`, [], 'อัตราแต้ม 0 บาท → ปฏิเสธ');
  await db.query(`insert into tiers (shop_id,id,name,min_spend,point_multiplier) values ('khamwan','T1','Member',0,1),('khamwan','T2','Silver',5000,1),('khamwan','T3','Gold',15000,1.5)`);
  ok(true, 'ตั้งระดับ Member / Silver / Gold');
  await rejects(db, `insert into tiers (shop_id,id,name,min_spend) values ('khamwan','T4','ซ้ำ',5000)`, [], 'ระดับใช้เกณฑ์ยอดซ้ำ → ปฏิเสธ');
  await rejects(db, `insert into tiers (shop_id,id,name,point_multiplier) values ('khamwan','T5','แปลก',1.7)`, [], 'ตัวคูณแต้ม ×1.7 (ไม่อยู่ในตัวเลือก) → ปฏิเสธ');

  console.log('\n[3] สมาชิก');
  const mem = (shop, id, line, phone, tier = null) => db.query(`insert into members (shop_id,id,line_user_id,name,phone,tier_id) values ($1,$2,$3,'ทดสอบ',$4,$5)`, [shop, id, line, phone, tier]);
  await mem('khamwan', 'KW-AAAA11', 'U1', '0812345678', 'T1');
  ok(true, 'เพิ่มสมาชิก KW-AAAA11 (ระดับ Member)');
  await rejects(db, `insert into members (shop_id,id,line_user_id,name,phone) values ('khamwan','KW-BBBB22','U2','x','0812345678')`, [], 'เบอร์ซ้ำในร้านเดียวกัน → ปฏิเสธ');
  await rejects(db, `insert into members (shop_id,id,line_user_id,name,phone) values ('khamwan','KW-CCCC33','U1','x','0899999999')`, [], 'บัญชี LINE ซ้ำในร้านเดียวกัน → ปฏิเสธ');
  await mem('demo', 'DM-AAAA11', 'U1', '0812345678');
  ok(true, 'เบอร์ + LINE เดียวกัน สมัครอีกร้านได้ (ร้านแยกกัน)');
  await rejects(db, `insert into members (shop_id,id,line_user_id,name,phone,tier_id) values ('demo','DM-BBBB22','U9','x','0811111111','T3')`, [], 'ใช้ระดับของร้านอื่น → ปฏิเสธ (ร้าน demo ไม่มี T3)');
  await rejects(db, `insert into members (shop_id,id,line_user_id,name,phone) values ('khamwan','KW-DDDD44','U4','x','12345')`, [], 'เบอร์ผิดรูปแบบ → ปฏิเสธ');
  await rejects(db, `update members set points = -5 where id='KW-AAAA11'`, [], 'แต้มติดลบ → ปฏิเสธ');
  await db.query(`insert into members (shop_id,id,line_user_id,name,phone) values ('khamwan','KW-EEEE55',null,'ร้านเพิ่มเอง','0822222222'),('khamwan','KW-FFFF66',null,'ร้านเพิ่มเอง 2','0833333333')`);
  ok(true, 'สมาชิกที่ยังไม่ผูก LINE มีได้หลายคน');

  console.log('\n[4] รายการแต้ม + กันบันทึกซ้ำ');
  const tx = (id, req, pts = 10, bal = 10) => db.query(`insert into transactions (shop_id,id,member_id,type,amount,points,balance_after,request_id) values ('khamwan',$1,'KW-AAAA11','EARN',200,$2,$3,$4)`, [id, pts, bal, req]);
  await tx('TX-AAAAAAAAA1', 'req-00000001');
  ok(true, 'บันทึกยอดซื้อ');
  await rejects(db, `insert into transactions (shop_id,id,member_id,type,amount,points,balance_after,request_id) values ('khamwan','TX-AAAAAAAAA2','KW-AAAA11','EARN',200,10,20,'req-00000001')`, [], 'requestId ซ้ำ (เน็ตหลุดแล้วกดใหม่) → ปฏิเสธ ไม่บวกแต้มซ้ำ');
  await rejects(db, `insert into transactions (shop_id,id,member_id,type,points,balance_after) values ('khamwan','TX-AAAAAAAAA3','KW-NOPE00','EARN',1,1)`, [], 'รายการของสมาชิกที่ไม่มีจริง → ปฏิเสธ');
  await rejects(db, `insert into transactions (shop_id,id,member_id,type,points,balance_after) values ('khamwan','TX-AAAAAAAAA4','KW-AAAA11','HACK',1,1)`, [], 'ประเภทรายการแปลก → ปฏิเสธ');
  await db.query(`insert into transactions (shop_id,id,member_id,type,points,balance_after) values ('khamwan','TX-WELCOME01','KW-AAAA11','WELCOME',20,20),('khamwan','TX-WELCOME02','KW-AAAA11','WELCOME',20,40)`);
  ok(true, 'รายการที่ไม่มี requestId (แต้มต้อนรับ) มีได้หลายรายการ');

  console.log('\n[5] ของรางวัล + คูปอง + ของขวัญวันเกิด');
  await db.query(`insert into rewards (shop_id,id,name,points) values ('khamwan','R001','เครื่องดื่มฟรี',80)`);
  await db.query(`insert into rewards (shop_id,id,name,type,points,min_tier_id) values ('khamwan','R002','เค้กวันเกิด (Gold)','BIRTHDAY',0,'T3')`);
  ok(true, 'ของรางวัลปกติ + ของขวัญวันเกิดเฉพาะ Gold ขึ้นไป');
  await rejects(db, `insert into rewards (shop_id,id,name,points,start_date,end_date) values ('khamwan','R003','x',10,'2026-12-31','2026-01-01')`, [], 'วันสิ้นสุดก่อนวันเริ่ม → ปฏิเสธ');
  await db.query(`insert into coupons (shop_id,code,member_id,reward_id,birthday_year) values ('khamwan','CP-BDAY2026','KW-AAAA11','R002',2026)`);
  ok(true, 'รับของขวัญวันเกิดปี 2026');
  await rejects(db, `insert into coupons (shop_id,code,member_id,reward_id,birthday_year) values ('khamwan','CP-BDAY2026B','KW-AAAA11','R002',2026)`, [], 'รับของขวัญวันเกิดซ้ำปีเดียวกัน → ปฏิเสธ (กันกด 2 เครื่องพร้อมกัน)');
  await db.query(`insert into coupons (shop_id,code,member_id,reward_id) values ('khamwan','CP-NORMAL01','KW-AAAA11','R001'),('khamwan','CP-NORMAL02','KW-AAAA11','R001')`);
  ok(true, 'คูปองปกติแลกได้หลายใบ');

  console.log('\n[6] สาขา + พนักงาน + แต้มพิเศษ + โปรโมชัน');
  await db.query(`insert into branches (shop_id,id,name) values ('khamwan','B001','สาขาสยาม')`);
  await rejects(db, `insert into branches (shop_id,id,name) values ('khamwan','B002','สาขาสยาม')`, [], 'ชื่อสาขาซ้ำ → ปฏิเสธ');
  await rejects(db, `insert into branches (shop_id,id,name) values ('khamwan','ONLINE','ออนไลน์')`, [], 'รหัสสาขา ONLINE (รหัสพิเศษ) → ปฏิเสธ');
  await db.query(`insert into staff (shop_id,line_user_id,name,role,status,branches) values ('khamwan','U_STAFF1','น้องฝน','CASHIER','ACTIVE',array['B001'])`);
  await rejects(db, `insert into staff (shop_id,line_user_id,role) values ('khamwan','U_STAFF2','KING')`, [], 'บทบาทแปลก → ปฏิเสธ');
  await db.query(`insert into point_rules (shop_id,id,name,multiplier,days,min_tier_id,show_badge) values ('khamwan','PR001','Gold ×2 วันพุธ',2,array['WED'],'T3',true)`);
  ok(true, 'กติกาแต้มพิเศษเฉพาะ Gold');
  await rejects(db, `insert into point_rules (shop_id,id,name,multiplier,days) values ('khamwan','PR002','x',2,array[]::text[])`, [], 'กติกาไม่เลือกวัน → ปฏิเสธ');
  await rejects(db, `insert into point_rules (shop_id,id,name,multiplier,days) values ('khamwan','PR003','x',2,array['FUNDAY'])`, [], 'วันแปลก → ปฏิเสธ');
  await rejects(db, `insert into promotions (shop_id,id,title,link) values ('khamwan','P001','x','javascript:alert(1)')`, [], 'ลิงก์อันตรายในโปรโมชัน → ปฏิเสธ');

  console.log('\n[7] ความเร็วเมื่อข้อมูลเยอะ (30,000 รายการ — วัดในเครื่อง ยังไม่รวมเวลาเน็ต)');
  await db.query(`insert into members (shop_id,id,line_user_id,name,phone) select 'khamwan','KW-M'||lpad(i::text,5,'0'),'UM'||i,'ลูกค้า '||i,'09'||lpad(i::text,8,'0') from generate_series(1,500) i`);
  await db.query(`insert into transactions (shop_id,id,created_at,member_id,type,amount,points,balance_after,request_id)
    select 'khamwan','TX-B'||lpad(i::text,8,'0'), now() - (i||' minutes')::interval, 'KW-M'||lpad(((i % 500)+1)::text,5,'0'),'EARN',100+(i%900),5,5,'bulk-req-'||i from generate_series(1,30000) i`);
  let t0 = Date.now();
  const h = await db.query(`select id from transactions where shop_id='khamwan' and member_id='KW-M00007' order by created_at desc limit 50`);
  ok(h.rows.length === 50, `ประวัติ 50 รายการของลูกค้า 1 คน: ${Date.now() - t0} ms`);
  t0 = Date.now();
  const s = await db.query(`select coalesce(sum(amount),0) as spend from transactions where shop_id='khamwan' and member_id='KW-M00007' and type='EARN' and created_at >= now() - interval '12 months'`);
  ok(Number(s.rows[0].spend) > 0, `ยอดซื้อ 12 เดือน (ใช้คิด tier): ${Date.now() - t0} ms`);
  t0 = Date.now();
  await rejects(db, `insert into transactions (shop_id,id,member_id,type,points,balance_after,request_id) values ('khamwan','TX-DUPCHECK01','KW-M00007','EARN',1,1,'bulk-req-12')`, [], `กันซ้ำ requestId เก่า (อยู่ลึกเกิน 2,000 รายการ) ยังจับได้: ${Date.now() - t0} ms`);
  const plan = (await db.query(`explain select id from transactions where shop_id='khamwan' and member_id='KW-M00007' order by created_at desc limit 50`)).rows.map(r => r['QUERY PLAN']).join(' ');
  ok(/Index/.test(plan), 'ค้นประวัติใช้สารบัญ (index) ไม่ไล่อ่านทั้งตาราง', plan.slice(0, 120));

  console.log('\n[8] ไฟล์ปรับตาราง 003 + 004 บนข้อมูลเดิม (เหมือน Supabase ที่มีระดับแบบยอดเงินอยู่แล้ว) + รันซ้ำได้');
  const dir = require('path').join(__dirname, '..', '..', 'db');
  await db.exec(fs.readFileSync(require('path').join(dir, '003_delete_and_tiers.sql'), 'utf8'));
  const m004 = fs.readFileSync(require('path').join(dir, '004_tier_points_benefits.sql'), 'utf8');
  await db.exec(m004);
  const rate = (await db.query(`select point_rate_baht::float8 as r from shops where id='khamwan'`)).rows[0].r;
  const tp = (await db.query(`select id, min_points from tiers where shop_id='khamwan' order by id`)).rows.map(r => r.id + ':' + r.min_points).join(',');
  ok(tp === `T1:0,T2:${Math.round(5000 / rate)},T3:${Math.round(15000 / rate)}`, `เกณฑ์ระดับเดิม (บาท) แปลงเป็นแต้ม ÷ ${rate}: ${tp}`);
  const nb = (await db.query(`select count(*)::int as n from transactions where type='EARN' and base_points is null`)).rows[0].n;
  const bad = (await db.query(`select count(*)::int as n from transactions t join shops s on s.id = t.shop_id where t.type='EARN' and t.base_points <> floor(t.amount / s.point_rate_baht)`)).rows[0].n;
  ok(nb === 0 && bad === 0, 'บิลซื้อเดิมทุกบิลได้แต้มปกติ (ยอด ÷ อัตราแต้ม ปัดลง)');
  await db.exec(m004);
  const tp2 = (await db.query(`select id, min_points from tiers where shop_id='khamwan' order by id`)).rows.map(r => r.id + ':' + r.min_points).join(',');
  ok(tp2 === tp, 'รัน 004 ซ้ำ → ไม่ error ค่าเดิมไม่เปลี่ยน');
  await rejects(db, `insert into tiers (shop_id,id,name,min_points) values ('khamwan','T8','ซ้ำ',${Math.round(5000 / rate)})`, [], 'ระดับใช้เกณฑ์แต้มซ้ำ → ปฏิเสธ');
  await db.query(`insert into tiers (shop_id,id,name,min_points,min_spend,benefits) values ('khamwan','T9','Platinum',99999,null,'ห้องรับรอง')`);
  ok(true, 'ระดับใหม่ไม่ต้องมียอดเงิน (min_spend ว่างได้) + มีสิทธิพิเศษ');
  await rejects(db, `insert into transactions (shop_id,id,member_id,type,points,balance_after,base_points) values ('khamwan','TX-NEGBASE1','KW-M00007','EARN',1,1,-5)`, [], 'แต้มปกติติดลบ → ปฏิเสธ');

  console.log('\n[9] ไฟล์ปรับตาราง 005 ประวัติการส่งข้อความ + รันซ้ำได้');
  const m005 = fs.readFileSync(require('path').join(dir, '005_broadcasts.sql'), 'utf8');
  await db.exec(m005);
  await db.exec(m005);
  const rls5 = (await db.query(`select relrowsecurity as on from pg_class where relname = 'broadcasts'`)).rows[0];
  ok(rls5 && rls5.on === true, 'วาง 005 (สองรอบ ไม่ error) → มีตาราง broadcasts และปิดจากภายนอก (RLS)');
  const bc = (id, req, extra = '') => `insert into broadcasts (shop_id, id, request_id, created_by, recipients, total${extra ? ', ' + extra.split('=')[0] : ''})
    values ('khamwan', '${id}', '${req}', 'U_OWNER', array['KW-M00007'], 1${extra ? ', ' + extra.split('=')[1] : ''})`;
  await db.query(bc('BC-AAAA0001', 'req-aaaa-0001'));
  ok(true, 'จดการส่ง 1 ครั้งได้ (ค่าตั้งต้น: กำลังส่ง / ส่งแล้ว 0)');
  await rejects(db, bc('BC-AAAA0002', 'req-aaaa-0001'), [], 'รหัสคำขอซ้ำในร้านเดียวกัน → ปฏิเสธ (กดซ้ำไม่เกิดการส่งรอบใหม่)');
  await rejects(db, bc('XX-1', 'req-aaaa-0003'), [], 'รหัสการส่งผิดรูปแบบ → ปฏิเสธ');
  await rejects(db, bc('BC-AAAA0004', 'req-aaaa-0004', "status='SENT'"), [], 'สถานะแปลก → ปฏิเสธ');
  await rejects(db, bc('BC-AAAA0005', 'req-aaaa-0005', 'sent=-1'), [], 'จำนวนที่ส่งติดลบ → ปฏิเสธ');
  await rejects(db, `insert into broadcasts (shop_id, id, request_id, created_by, recipients, total) values ('nosuch', 'BC-AAAA0006', 'req-aaaa-0006', 'U', '{}', 0)`, [], 'ร้านที่ไม่มี → ปฏิเสธ');

  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
