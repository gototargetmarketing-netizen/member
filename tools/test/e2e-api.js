// ทดสอบหน้าเว็บจริงใน Chrome กับ "ระบบใหม่" (ตัวกลาง api/ + ฐานข้อมูลจำลอง) — ร้าน demo
// ขั้น 3 รอบ 1: หน้าลูกค้า (สมัคร / บัตร / ประวัติ / แลกของรางวัล / แก้ข้อมูล / ของขวัญวันเกิด)
// ต้องเปิด 2 อย่างก่อน: python3 tools/dev-server.py 8002  และ  node tools/api-server.js
const { launch, sleep } = require('./cdp');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
require('fs').mkdirSync(OUT, { recursive: true });

const WEB = 'http://localhost:8002';
const API = 'http://localhost:8105/api';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); } };
// แก้/อ่านฐานข้อมูลจำลองตรงๆ (เฉพาะเซิร์ฟเวอร์ทดสอบในเครื่อง)
const sql = async (q, params) => {
  const r = await (await fetch('http://localhost:8105/__sql', { method: 'POST', body: JSON.stringify({ sql: q, params }) })).json();
  if (!r.ok) throw new Error('sql: ' + r.error);
  return r.rows;
};
const asUser = (id, name) => `localStorage.setItem('crm_test_user', JSON.stringify({ id: '${id}', name: '${name}' }))`;
const num = (s) => Number(String(s).replace(/[^\d]/g, ''));

(async () => {
  const b = await launch({ port: 9345, profile: path.join(require('os').tmpdir(), 'line-crm-e2e-api-chrome') });
  try {
    console.log('\n[1] สมัครสมาชิกใหม่ (ร้าน demo บนระบบใหม่)');
    await b.nav(`${WEB}/demo?api=${encodeURIComponent(API)}&user=U_E2E_NEW&name=${encodeURIComponent('ลูกค้าใหม่')}`);
    await b.waitFor(`document.querySelector('#reg')`, 10000, 'ฟอร์มสมัคร');
    ok(/โหมดทดสอบ/.test(await b.text()), 'แสดงแถบโหมดทดสอบ (ระบบใหม่บอกว่าเปิดรหัสทดสอบ)');
    ok(/รับทันที 10 แต้ม/.test(await b.text()), 'แต้มต้อนรับ 10 จากตาราง shops ของร้าน demo');
    await b.type('#reg input[name=firstName]', 'ทดลอง');
    await b.type('#reg input[name=lastName]', 'ระบบใหม่');
    await b.eval(`(() => { const f = document.querySelector('#reg'); f.bdDay.value = '5'; f.bdMonth.value = '3'; f.bdYear.value = '2535'; return true; })()`);
    await b.type('#reg input[name=phone]', '086-123-4567');
    await b.eval(`document.querySelector('#reg input[name=consentPrivacy]').click()`);
    await b.click('#reg button[type=submit]');
    await b.waitFor(`document.querySelector('.member-card')`, 10000, 'บัตรสมาชิก');
    await b.waitFor(`document.querySelector('.modal')`, 3000, 'ป๊อปอัปต้อนรับ');
    ok(/10 แต้ม/.test(await b.text('.modal')), 'ป๊อปอัปต้อนรับ 10 แต้ม');
    await b.click('.modal [data-act=close]');
    const memberId = await b.eval(`document.querySelector('.mc-bottom b').innerText`);
    ok(/^DM-[A-Z2-9]{6}$/.test(memberId), 'บัตรแสดงรหัสสมาชิก ' + memberId);
    const [nm] = await sql(`select name, phone, to_char(birth_date,'YYYY-MM-DD') b, points from members where shop_id='demo' and line_user_id='U_E2E_NEW'`);
    ok(nm && nm.name === 'ทดลอง ระบบใหม่' && nm.phone === '0861234567' && nm.b === '1992-03-05' && nm.points === 10,
      'ฐานข้อมูล: ชื่อ + เบอร์ + วันเกิด (พ.ศ. 2535 → 1992) + 10 แต้ม', nm);
    await b.shot(path.join(OUT, 'n01-registered.png'));

    console.log('\n[2] ลูกค้าประจำ (ข้อมูลทดลอง ~650 รายการ)');
    const [d1] = await sql(`select id, points from members where shop_id='demo' and line_user_id='U_DEMO_1'`);
    await b.eval(asUser('U_DEMO_1', 'ลูกค้าประจำ'));
    await b.nav('about:blank'); // เปลี่ยนแค่ #home หน้าเว็บไม่โหลดใหม่ → ยังเป็นผู้ใช้คนเดิม
    await b.nav(`${WEB}/demo#home`);
    await b.waitFor(`document.querySelector('.mc-points')`, 10000, 'บัตรสมาชิก');
    await b.waitFor(`Number(document.querySelector('.mc-points').innerText.replace(/[^0-9]/g, '')) === ${d1.points}`, 8000, 'แต้มตรงกับฐานข้อมูล');
    ok(true, 'บัตรแสดงแต้ม ' + d1.points.toLocaleString() + ' ตรงกับฐานข้อมูล');
    await b.nav(`${WEB}/demo#history`);
    await b.waitFor(`document.querySelector('.tx-list')`, 10000, 'ประวัติ');
    ok((await b.eval(`document.querySelectorAll('.tx').length`)) === 50, 'ประวัติแสดง 50 รายการล่าสุด (ตามค่าร้าน)');
    await b.shot(path.join(OUT, 'n02-history.png'), { full: true });

    console.log('\n[3] แลกของรางวัล');
    await b.nav(`${WEB}/demo#rewards`);
    await b.waitFor(`document.querySelector('[data-act=redeem][data-id=R001]')`, 10000, 'ปุ่มแลก R001');
    await b.click('[data-act=redeem][data-id=R001]');
    await b.waitFor(`document.querySelector('[data-act=redeem-confirm]')`, 5000, 'ยืนยันการแลก');
    await b.click('[data-act=redeem-confirm]');
    await b.waitFor(`/แลกสำเร็จ/.test(document.querySelector('.modal')?.innerText || '')`, 8000, 'แลกสำเร็จ');
    await b.click('.modal [data-act=coupon-qr]');
    await b.waitFor(`document.querySelector('.modal .qr-svg')`, 5000, 'QR คูปอง');
    const code = await b.eval(`document.querySelector('.modal .qr-code-text').innerText`);
    const [cp] = await sql(`select c.status, m.points from coupons c join members m on m.shop_id=c.shop_id and m.id=c.member_id where c.shop_id='demo' and c.code=$1`, [code]);
    ok(cp && cp.status === 'ACTIVE' && cp.points === d1.points - 100, 'คูปอง ' + code + ' อยู่ในฐานข้อมูล + แต้มลด 100', cp);
    const [tx] = await sql(`select type, points, ref from transactions where shop_id='demo' and member_id=$1 order by created_at desc limit 1`, [d1.id]);
    ok(tx && tx.type === 'REDEEM' && tx.points === -100 && tx.ref === code, 'รายการแลกล่าสุดอ้างถึงคูปองนี้', tx);
    await b.shot(path.join(OUT, 'n03-coupon.png'));
    await b.click('.modal [data-act=close]');

    console.log('\n[4] แก้ข้อมูลของฉัน');
    await b.nav(`${WEB}/demo#home`);
    await b.waitFor(`document.querySelector('.hero .avatar-wrap')`, 10000, 'รูปลูกค้า');
    await b.click('.hero .avatar-wrap');
    await b.waitFor(`document.querySelector('#profile')`, 5000, 'หน้าข้อมูลของฉัน');
    await b.type('#profile input[name=lastName]', 'ประจำร้าน');
    await b.click('#profile button[type=submit]');
    await b.waitFor(`document.querySelector('.hero-name') && /ประจำร้าน/.test(document.querySelector('.hero-name').innerText)`, 8000, 'ชื่อใหม่');
    const log = await sql(`select changed, by_name from profile_log where shop_id='demo' and member_id=$1`, [d1.id]);
    ok(log.length === 1 && log[0].changed === 'ชื่อ-นามสกุล' && log[0].by_name === 'ลูกค้า', 'บันทึกชื่อใหม่ + จดประวัติการแก้ (ไม่เก็บค่าเดิม)', log);

    console.log('\n[5] ของขวัญวันเกิด');
    await sql(`update members set birth_date = make_date(1990, extract(month from (now() at time zone 'Asia/Bangkok'))::int, 10)
               where shop_id='demo' and line_user_id='U_DEMO_7'`);
    await b.eval(asUser('U_DEMO_7', 'วันเกิดเดือนนี้'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo#home`);
    await b.waitFor(`document.querySelector('.bday [data-act=birthday-claim]')`, 10000, 'การ์ดวันเกิด');
    ok(/สุขสันต์วันเกิด/.test(await b.text('.bday')), 'เกิดเดือนนี้ + เป็นสมาชิกนาน → การ์ด "สุขสันต์วันเกิด"');
    await b.click('.bday [data-act=birthday-claim]');
    await b.waitFor(`document.querySelector('.modal .qr-svg')`, 10000, 'คูปองของขวัญ');
    await b.click('.modal [data-act=close]');
    ok(/รับของขวัญวันเกิดแล้ว/.test(await b.text('.bday')), 'การ์ดเปลี่ยนเป็น "รับของขวัญวันเกิดแล้ว"');
    const bd = await sql(`select c.birthday_year, c.reward_id from coupons c join members m on m.shop_id=c.shop_id and m.id=c.member_id
                          where c.shop_id='demo' and m.line_user_id='U_DEMO_7' and c.birthday_year is not null`);
    ok(bd.length === 1 && bd[0].reward_id === 'R008', 'ฐานข้อมูล: คูปองวันเกิด 1 ใบ จดปีไว้ (กันรับซ้ำ)', bd);
    await b.shot(path.join(OUT, 'n04-birthday.png'));

    console.log('\n[6] หลังบ้าน: ลบของรางวัล / โปรโมชัน / แต้มพิเศษ');
    await b.eval(asUser('U_DEMO_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo/admin#rewards`);
    await b.waitFor(`document.querySelector('[data-act=reward-edit][data-id=R004]')`, 10000, 'รายการของรางวัล');
    ok(/กดแก้ไข → ลบ/.test(await b.text('#view')), 'คำอธิบายท้ายตารางบอกว่าลบได้');
    await b.click('[data-act=reward-edit][data-id=R004]');
    await b.waitFor(`document.querySelector('.modal [data-act=item-delete]')`, 3000, 'ปุ่มลบในหน้าต่างแก้ไข');
    await b.shot(path.join(OUT, 'n05-delete-button.png'));
    await b.click('.modal [data-act=item-delete]');
    await b.waitFor(`document.querySelector('.modal [data-act=item-delete-confirm]')`, 3000, 'ยืนยันการลบ');
    ok(/ส่วนลด 100 บาท/.test(await b.text('.modal')) && /คูปองที่ลูกค้าแลกไปแล้วยังใช้/.test(await b.text('.modal')), 'ยืนยันก่อนลบ: บอกชื่อ + คูปองเดิมยังใช้ได้');
    await b.shot(path.join(OUT, 'n06-delete-confirm.png'));
    await b.click('.modal [data-act=item-delete-confirm]');
    await b.waitFor(`!document.querySelector('[data-act=reward-edit][data-id=R004]') && document.querySelector('[data-act=reward-edit][data-id=R005]')`, 8000, 'ของรางวัลหายจากตาราง');
    const [rw] = await sql(`select deleted_at is not null as deleted, status from rewards where shop_id='demo' and id='R004'`);
    ok(rw.deleted && rw.status === 'INACTIVE', 'ลบแล้ว: หายจากตาราง + ฐานข้อมูลจดเวลาลบ (แถวยังอยู่)', rw);
    await b.nav(`${WEB}/demo/admin#promos`);
    await b.waitFor(`document.querySelector('[data-act=promo-edit][data-id=P001]')`, 10000, 'รายการโปรโมชัน');
    await b.click('[data-act=promo-edit][data-id=P001]');
    await b.waitFor(`document.querySelector('.modal [data-act=item-delete]')`, 3000, 'ปุ่มลบโปรโมชัน');
    await b.click('.modal [data-act=item-delete]');
    await b.waitFor(`document.querySelector('.modal [data-act=item-delete-confirm]')`, 3000, 'ยืนยันลบโปรโมชัน');
    await b.click('.modal [data-act=item-delete-confirm]');
    await b.waitFor(`!document.querySelector('[data-act=promo-edit][data-id=P001]')`, 8000, 'โปรโมชันหายจากตาราง');
    ok(true, 'ลบโปรโมชันได้');
    await b.nav(`${WEB}/demo/admin#rules`);
    await b.waitFor(`document.querySelector('[data-act=rule-edit][data-id=PR002]')`, 10000, 'รายการแต้มพิเศษ');
    await b.click('[data-act=rule-edit][data-id=PR002]');
    await b.waitFor(`document.querySelector('.modal [data-act=item-delete]')`, 3000, 'ปุ่มลบกติกา');
    await b.click('.modal [data-act=item-delete]');
    await b.waitFor(`document.querySelector('.modal [data-act=item-delete-confirm]')`, 3000, 'ยืนยันลบกติกา');
    await b.click('.modal [data-act=item-delete-confirm]');
    await b.waitFor(`!document.querySelector('[data-act=rule-edit][data-id=PR002]')`, 8000, 'กติกาหายจากตาราง');
    ok(true, 'ลบกติกาแต้มพิเศษได้');
    await b.nav(`${WEB}/demo/admin#rewards`);
    await b.waitFor(`document.querySelector('[data-act=reward-edit][data-id=""]')`, 10000, 'ปุ่มเพิ่มของรางวัล');
    await b.click('[data-act=reward-edit][data-id=""]');
    await b.waitFor(`document.querySelector('.modal form[data-form=reward]')`, 3000, 'หน้าต่างเพิ่มของรางวัล');
    ok(!(await b.eval(`!!document.querySelector('.modal [data-act=item-delete]')`)), 'เพิ่มของรางวัลใหม่ → ไม่มีปุ่มลบ (ยังไม่มีอะไรให้ลบ)');
    await b.click('.modal [data-act=close]');

    const errs = b.logs.filter((l) => /EXCEPTION|console\.error/.test(l));
    ok(errs.length === 0, 'ไม่มีข้อผิดพลาดในหน้าเว็บ', errs);
  } catch (e) {
    fail++;
    console.log('  ✗ หยุดกลางทาง: ' + e.message);
    console.log(b.logs.slice(-10).join('\n'));
  } finally {
    await b.close();
  }
  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})();
