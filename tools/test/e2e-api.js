// ทดสอบหน้าเว็บจริงใน Chrome กับ "ระบบใหม่" (ตัวกลาง api/ + ฐานข้อมูลจำลอง) — ร้าน demo
// หน้าลูกค้า (สมัคร / บัตร / ประวัติ / แลก / แก้ข้อมูล / วันเกิด) + หลังบ้าน (ปุ่มลบ) + ระดับสมาชิก (ขั้น 4)
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

    console.log('\n[7] ระดับสมาชิก (ขั้น 4): เจ้าของร้านตั้ง → ลูกค้าเห็น → พนักงานบันทึกแล้วขึ้นระดับ');
    await b.nav(`${WEB}/demo/admin#tiers`);
    await b.waitFor(`document.querySelector('.tier-intro [data-act=tier-add]')`, 10000, 'หน้าระดับสมาชิก');
    ok(/ยังไม่ได้เปิดใช้ระดับสมาชิก/.test(await b.text('#view')), 'ร้านยังไม่มีระดับ → มีปุ่มเริ่มตั้งระดับ');
    await b.click('.tier-intro [data-act=tier-add]');
    await b.waitFor(`document.querySelectorAll('.tier-edit').length === 3`, 3000, 'ตัวอย่าง 3 ระดับ');
    await b.eval(`(() => { document.querySelectorAll('.tier-edit')[1].querySelector('[name=minSpend]').value = '3000'; return true; })()`);
    await b.click('[data-act=tier-add]');
    await b.waitFor(`document.querySelectorAll('.tier-edit').length === 4`, 3000, 'เพิ่มแถว');
    ok((await b.eval(`document.querySelectorAll('.tier-edit')[1].querySelector('[name=minSpend]').value`)) === '3000', 'เพิ่มแถวแล้ว ค่าที่พิมพ์ไว้ไม่หาย');
    await b.click('.tier-edit:nth-child(4) [data-act=tier-remove]');
    await b.waitFor(`document.querySelectorAll('.tier-edit').length === 3`, 3000, 'เอาแถวออก');
    await b.shot(path.join(OUT, 'n07-tiers-edit.png'), { full: true });
    await b.eval(`document.querySelector('[data-form=tiers]').requestSubmit()`);
    await b.waitFor(`document.querySelector('.modal [data-act=tiers-save-confirm]')`, 3000, 'ยืนยันเปิดใช้ระดับ');
    ok(/จัดระดับสมาชิกทุกคน/.test(await b.text('.modal')), 'ยืนยันก่อน: บอกว่าจะจัดระดับทุกคนตามยอด 12 เดือน');
    await b.click('.modal [data-act=tiers-save-confirm]');
    await b.waitFor(`document.querySelector('[data-act=tiers-off]')`, 20000, 'เปิดใช้ระดับแล้ว');
    const tiers = await sql(`select id, name, min_spend::float8 as m from tiers where shop_id='demo' order by min_spend`);
    ok(tiers.length === 3 && tiers[1].m === 3000 && tiers[2].name === 'Gold', 'ฐานข้อมูล: 3 ระดับ (Silver เริ่ม 3,000)', tiers);
    const [noTier] = await sql(`select count(*)::int as n from members where shop_id='demo' and tier_id is null`);
    ok(noTier.n === 0, 'สมาชิกทุกคนได้ระดับแล้ว', noTier);
    const gold = tiers[2].id;
    const [nGold] = await sql(`select count(*)::int as n from members where shop_id='demo' and tier_id=$1`, [gold]);

    await b.nav(`${WEB}/demo/admin#overview`);
    await b.waitFor(`document.querySelector('.tier-counts')`, 10000, 'การ์ดสมาชิกแต่ละระดับ');
    ok(/Gold/.test(await b.text('.tier-counts')), 'ภาพรวม: จำนวนสมาชิกแต่ละระดับ');
    await b.click(`.tier-count[data-id=${gold}]`);
    await b.waitFor(`document.querySelector('select[name=tier]') && document.querySelector('select[name=tier]').value === '${gold}' && document.querySelectorAll('.tbl tbody .chip-tier').length > 0`, 10000, 'รายชื่อกรองระดับ Gold');
    ok(await b.eval(`[...document.querySelectorAll('.tbl tbody .chip-tier')].every(x => /Gold/.test(x.innerText))`), `กดจากภาพรวม → รายชื่อเฉพาะ Gold (${nGold.n} คน)`);

    await b.nav(`${WEB}/demo/admin#rewards`);
    await b.waitFor(`document.querySelector('[data-act=reward-edit][data-id=R005]')`, 10000, 'รายการของรางวัล');
    await b.click('[data-act=reward-edit][data-id=R005]');
    await b.waitFor(`document.querySelector('.modal select[name=minTierId]')`, 3000, 'ช่องระดับขั้นต่ำ');
    await b.eval(`document.querySelector('.modal select[name=minTierId]').value = '${gold}'`);
    await b.eval(`document.querySelector('.modal form[data-form=reward]').requestSubmit()`);
    await b.waitFor(`/Gold ขึ้นไป/.test(document.querySelector('#view').innerText)`, 8000, 'ป้าย Gold ขึ้นไปในตาราง');
    const [r5] = await sql(`select min_tier_id from rewards where shop_id='demo' and id='R005'`);
    ok(r5.min_tier_id === gold, 'ของรางวัล R005 ตั้ง "Gold ขึ้นไป" แล้ว', r5);

    // ลูกค้าใหม่ (ยังไม่มียอดซื้อ) = ระดับแรก
    await b.eval(asUser('U_E2E_NEW', 'ลูกค้าใหม่'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo#home`);
    await b.waitFor(`document.querySelector('.tier-card')`, 10000, 'การ์ดระดับ');
    ok(/ระดับของคุณ Member/.test(await b.text('.tl-head')) && /อีก ฿3,000 ถึง Silver/.test(await b.text('.tl-next')),
      'หน้าลูกค้า: บันไดระดับ — ระดับ Member + อีก ฿3,000 ถึง Silver', await b.text('.tier-card'));
    ok(/ได้แต้ม ×1\.5 ทุกบิล/.test(await b.text('.tl-next')), 'บอกสิทธิ์ของระดับถัดไป (แต้ม ×1.5)', await b.text('.tl-next'));
    ok(await b.eval(`(() => { const n = [...document.querySelectorAll('.tl-node')]; return n.length === 3 && n[0].classList.contains('on') && /Gold/.test(document.querySelector('.tl-labels').innerText); })()`),
      'เห็นทุกระดับเรียงกัน 3 จุด + ระดับปัจจุบันเป็นจุดแรก');
    ok(/Member/.test(await b.text('.mc-tier')), 'บัตรสมาชิกมีป้ายระดับ');
    await b.shot(path.join(OUT, 'n08-customer-tier.png'), { full: true });
    await b.nav(`${WEB}/demo#rewards`);
    await b.waitFor(`document.querySelector('[data-act=redeem][data-id=R005]')`, 10000, 'ของรางวัล R005');
    ok(await b.eval(`(() => { const x = document.querySelector('[data-act=redeem][data-id=R005]'); return x.disabled && /Gold ขึ้นไป/.test(x.innerText) && !!x.closest('.is-locked'); })()`),
      'ของรางวัลระดับ Gold: ลูกค้า Member เห็นแต่ล็อก');
    await b.shot(path.join(OUT, 'n09-customer-locked.png'), { full: true });

    // พนักงานบันทึกยอดถึงเกณฑ์ Silver → ขึ้นทันที
    await b.eval(asUser('U_DEMO_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo/staff`);
    // ข้อมูลทดลองมี 6 สาขา → หน้าพนักงานถามสาขาก่อน (เครื่องนี้ยังไม่เคยเลือก)
    await b.waitFor(`document.querySelector('#lookup') || document.querySelector('[data-act=branch-set]')`, 10000, 'หน้าพนักงาน');
    if (await b.eval(`!document.querySelector('#lookup')`)) await b.click('[data-act=branch-set]');
    await b.waitFor(`document.querySelector('#lookup')`, 10000, 'ช่องค้นลูกค้า');
    await b.type('#lookup input', '0861234567');
    await b.eval(`document.querySelector('#lookup').requestSubmit()`);
    await b.waitFor(`document.querySelector('#purchase')`, 8000, 'ฟอร์มยอดซื้อ');
    ok(/Member/.test(await b.text('#result .chip-tier')), 'พนักงานเห็นระดับของลูกค้า');
    await b.type('#purchase input[name=amount]', '3500');
    await b.eval(`document.querySelector('#purchase').requestSubmit()`);
    await b.waitFor(`document.querySelector('.modal [data-act=purchase-confirm]')`, 3000, 'ยืนยันยอดสูง');
    await b.click('.modal [data-act=purchase-confirm]');
    await b.waitFor(`document.querySelector('.flash.ok')`, 8000, 'บันทึกสำเร็จ');
    ok(/เลื่อนเป็นระดับ Silver/.test(await b.text('.flash')), 'ยอดถึงเกณฑ์ → ขึ้น Silver ทันที + พนักงานเห็นแจ้ง');
    ok(/Silver ×1\.5/.test(await b.text('#result .chip-tier')), 'ป้ายลูกค้าในหน้าพนักงานเปลี่ยนเป็น Silver ×1.5');
    await b.shot(path.join(OUT, 'n10-staff-tierup.png'), { full: true });

    // เจ้าของร้านเปลี่ยนระดับให้เอง (ลูกค้า VIP)
    const [nw] = await sql(`select id, tier_id from members where shop_id='demo' and line_user_id='U_E2E_NEW'`);
    ok(nw.tier_id === tiers[1].id, 'ฐานข้อมูล: ลูกค้าอยู่ระดับ Silver', nw);
    await b.nav(`${WEB}/demo/admin#member/${nw.id}`);
    await b.waitFor(`document.querySelector('[data-act=member-tier]')`, 10000, 'การ์ดระดับในหน้าสมาชิก');
    ok(/ขึ้นระดับ/.test(await b.text('#view')) && /Member → Silver/.test(await b.text('#view')), 'หน้าสมาชิก: ประวัติ Member → Silver (ขึ้นระดับ)');
    await b.click('[data-act=member-tier]');
    await b.waitFor(`document.querySelector('.modal form[data-form=member-tier]')`, 3000, 'หน้าต่างเปลี่ยนระดับ');
    await b.eval(`document.querySelector('.modal select[name=tierId]').value = '${gold}'`);
    await b.type('.modal input[name=reason]', 'ลูกค้า VIP ทดสอบ');
    await b.eval(`document.querySelector('.modal form[data-form=member-tier]').requestSubmit()`);
    await b.waitFor(`/เปลี่ยนโดยร้าน/.test(document.querySelector('#view').innerText)`, 8000, 'ประวัติ "เปลี่ยนโดยร้าน"');
    const [nw2] = await sql(`select tier_id, to_char(tier_until, 'YYYY-MM-DD') as u from members where shop_id='demo' and id=$1`, [nw.id]);
    ok(nw2.tier_id === gold && !!nw2.u, 'เจ้าของร้านเปลี่ยนเป็น Gold + คงระดับ 12 เดือน + จดประวัติพร้อมเหตุผล', nw2);
    await b.shot(path.join(OUT, 'n11-member-tier.png'), { full: true });

    // ลูกค้าเป็น Gold แล้ว → ของรางวัล Gold ไม่ล็อก (แต่แต้มยังไม่พอ)
    await b.eval(asUser('U_E2E_NEW', 'ลูกค้าใหม่'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo#rewards`);
    await b.waitFor(`document.querySelector('[data-act=redeem][data-id=R005]')`, 10000, 'ของรางวัล R005');
    ok(await b.eval(`(() => { const x = document.querySelector('[data-act=redeem][data-id=R005]'); return /ขาดอีก/.test(x.innerText) && !x.closest('.is-locked'); })()`),
      'ลูกค้า Gold: ของรางวัล Gold ไม่ล็อกแล้ว (เหลือแค่แต้มไม่พอ)');

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
