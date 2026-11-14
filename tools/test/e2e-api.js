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
    ok(/≈ ยอดซื้อ ฿5,000/.test(await b.text('.tier-edit:nth-child(2) .tier-baht')), 'ตัวอย่างเกณฑ์เป็นแต้ม + บอกยอดซื้อโดยประมาณ (250 แต้ม ≈ ฿5,000)');
    // Silver 150 แต้ม (≈ ฿3,000) + สิทธิพิเศษที่ร้านเขียน + ข้อความหัวหน้า
    await b.eval(`(() => { const row = document.querySelectorAll('.tier-edit')[1]; const f = row.querySelector('[name=minPoints]'); f.value = '150';
      f.dispatchEvent(new Event('input', { bubbles: true }));
      row.querySelector('[name=benefits]').value = 'ทดลองเมนูใหม่ก่อนใคร\\nที่นั่งริมหน้าต่าง';
      document.querySelector('[data-form=tiers] [name=intro]').value = 'สมาชิก GO TO CAFE\\nยิ่งสะสม ยิ่งคุ้ม'; return true; })()`);
    ok(/≈ ยอดซื้อ ฿3,000/.test(await b.text('.tier-edit:nth-child(2) .tier-baht')), 'พิมพ์ 150 แต้ม → บอก ≈ ฿3,000 ทันที');
    ok(await b.eval(`!!document.querySelector('.tier-edit:nth-child(3) .tier-auto .tier-banner')`), 'มีตัวอย่างบัตรที่ระบบวาดให้ (ยังไม่ใส่รูป)');
    await b.click('[data-act=tier-add]');
    await b.waitFor(`document.querySelectorAll('.tier-edit').length === 4`, 3000, 'เพิ่มแถว');
    ok((await b.eval(`document.querySelectorAll('.tier-edit')[1].querySelector('[name=minPoints]').value`)) === '150' &&
      /ที่นั่งริมหน้าต่าง/.test(await b.eval(`document.querySelectorAll('.tier-edit')[1].querySelector('[name=benefits]').value`)), 'เพิ่มแถวแล้ว ค่าที่พิมพ์ไว้ไม่หาย');
    await b.click('.tier-edit:nth-child(4) [data-act=tier-remove]');
    await b.waitFor(`document.querySelectorAll('.tier-edit').length === 3`, 3000, 'เอาแถวออก');
    await b.shot(path.join(OUT, 'n07-tiers-edit.png'), { full: true });
    await b.eval(`document.querySelector('[data-form=tiers]').requestSubmit()`);
    await b.waitFor(`document.querySelector('.modal [data-act=tiers-save-confirm]')`, 3000, 'ยืนยันเปิดใช้ระดับ');
    ok(/จัดระดับสมาชิกทุกคน/.test(await b.text('.modal')), 'ยืนยันก่อน: บอกว่าจะจัดระดับทุกคนตามแต้ม 12 เดือน');
    await b.click('.modal [data-act=tiers-save-confirm]');
    await b.waitFor(`document.querySelector('[data-act=tiers-off]')`, 20000, 'เปิดใช้ระดับแล้ว');
    const tiers = await sql(`select id, name, min_points as m, benefits from tiers where shop_id='demo' order by min_points`);
    ok(tiers.length === 3 && tiers[1].m === 150 && tiers[2].m === 1000 && tiers[2].name === 'Gold' && tiers[1].benefits === 'ทดลองเมนูใหม่ก่อนใคร\nที่นั่งริมหน้าต่าง',
      'ฐานข้อมูล: 3 ระดับ (Silver 150 แต้ม / Gold 1,000) + สิทธิพิเศษ', tiers);
    const [intro] = await sql(`select tier_intro from shops where id='demo'`);
    ok(intro.tier_intro === 'สมาชิก GO TO CAFE\nยิ่งสะสม ยิ่งคุ้ม', 'บันทึกข้อความหัวหน้าสิทธิ์สมาชิก', intro);
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
    ok(/ระดับสมาชิกของคุณ/.test(await b.text('.tier-ring')) && /Member/.test(await b.text('.tr-name')) && /อีก 150 แต้ม ถึง Silver/.test(await b.text('.tr-next')),
      'หน้าลูกค้า: การ์ดวงแหวนนับแต้ม — Member + อีก 150 แต้ม ถึง Silver', await b.text('.tier-card'));
    ok(!/ได้แต้ม ×|12 เดือน|คงระดับ|🎉/.test(await b.text('.tier-ring')),
      'การ์ดสั้น: ไม่มีบรรทัดสิทธิ์ / แต้มสะสม 12 เดือน (ย้ายไปหน้าสิทธิ์) / ระดับแรกไม่มีวันหมดจึงไม่มี "คงระดับถึง"', await b.text('.tier-ring'));
    ok(/แต้มคงเหลือ/.test(await b.text('.member-card')), 'บัตรเขียน "แต้มคงเหลือ" (คนละตัวกับแต้มสะสมที่นับระดับ)');
    // ยังไม่มียอดซื้อ → วงแสดงแค่หัววง (2%) ไม่ใช่วงเต็ม
    ok(await b.eval(`(() => { const v = document.querySelector('.tier-ring .tr-val'); const C = +v.getAttribute('stroke-dasharray'); const off = +v.getAttribute('stroke-dashoffset'); return C > 0 && off / C > 0.95 && off / C < 1; })()`),
      'วงแหวนความคืบหน้า: ยังไม่มีแต้มสะสม = หัววงเล็กๆ');
    ok(/Member/.test(await b.text('.mc-tier')), 'บัตรสมาชิกมีป้ายระดับ');
    await b.shot(path.join(OUT, 'n08-customer-tier.png'), { full: true });

    // หน้าสิทธิ์สมาชิก
    await b.click('.tier-ring');
    await b.waitFor(`document.querySelector('.tp-tabs') && document.querySelector('#tier-detail')`, 5000, 'หน้าสิทธิ์สมาชิก');
    ok(/#tiers$/.test(await b.eval('location.hash')) && (await b.eval(`document.querySelectorAll('.tp-carousel .tier-banner').length`)) === 3 &&
      /สมาชิก GO TO CAFE/.test(await b.text('.tp-intro')), 'กดการ์ดบันได → หน้าสิทธิ์: ข้อความร้าน + รูปบัตร 3 ระดับ');
    ok(/Member\s*ระดับของคุณ/.test(await b.text('.tp-tabs [aria-selected=true]')) && /คุณอยู่ระดับนี้/.test(await b.text('#tier-detail')),
      'เปิดมาที่ระดับของลูกค้า (Member)', await b.text('.tp-tabs'));
    ok(/สะสมจากการซื้อใน 12 เดือน 0 แต้ม/.test(await b.text('#tier-detail')), 'แท็บระดับของลูกค้าบอกแต้มสะสม 12 เดือน (ย้ายมาจากการ์ดหน้าแรก)', await b.text('#tier-detail'));
    await b.click('[data-act=tier-tab][data-id="1"]');
    await b.waitFor(`/Silver/.test(document.querySelector('.tp-tabs [aria-selected=true]').innerText)`, 3000, 'แท็บ Silver');
    const silver = await b.text('#tier-detail');
    ok(/สะสม 150 แต้มจากการซื้อ/.test(silver) && /สะสมจากการซื้อใน 12 เดือน 0 แต้ม · อีก 150 แต้ม/.test(silver) && /แลกของรางวัลแล้ว แต้มสะสมเพื่อเลื่อนระดับไม่ลด/.test(silver) && /ได้แต้ม ×1\.5 ทุกบิล/.test(silver) && /ทดลองเมนูใหม่ก่อนใคร/.test(silver),
      'แท็บ Silver: เงื่อนไข + แต้มที่ขาด + สิทธิ์ที่ระบบใส่ (×1.5) + สิทธิ์ที่ร้านเขียน', silver);
    await b.shot(path.join(OUT, 'n08b-tiers-page.png'), { full: true });
    await b.click('[data-act=tier-tab][data-id="2"]');
    await b.waitFor(`/Gold/.test(document.querySelector('.tp-tabs [aria-selected=true]').innerText)`, 3000, 'แท็บ Gold');
    ok(/ของรางวัลเฉพาะสมาชิกระดับนี้: เมนูจานหลัก 1 ที่/.test(await b.text('#tier-detail')), 'แท็บ Gold: บอกของรางวัลเฉพาะ Gold (R005) ให้เอง', await b.text('#tier-detail'));
    await b.eval(`document.getElementById('tier-carousel').scrollTo({ left: 0 })`);
    await b.waitFor(`/Member/.test(document.querySelector('.tp-tabs [aria-selected=true]').innerText)`, 3000, 'ปัดกลับ → แท็บ Member');
    ok(true, 'ปัดรูปบัตร → แท็บและรายละเอียดเปลี่ยนตาม');
    await b.click('[data-act=tier-rules]');
    await b.waitFor(`/เงื่อนไขสำหรับสมาชิก/.test(document.querySelector('.modal')?.innerText || '')`, 3000, 'เงื่อนไขสำหรับสมาชิก');
    ok(/ไม่นับรวม/.test(await b.text('.modal')) && /20 บาท = 1 แต้ม/.test(await b.text('.modal')), 'เงื่อนไขสำหรับสมาชิก: ระบบสรุปกติกาให้ (อัตราแต้มของร้าน)', await b.text('.modal'));
    await b.click('.modal [data-act=close]');
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
    // ระดับสูงสุด → วงเต็ม + ข้อความแบบ ข (ไม่มีอีโมจิ) + คงระดับถึง
    await b.nav(`${WEB}/demo#home`);
    await b.waitFor(`document.querySelector('.tier-ring')`, 10000, 'การ์ดวงแหวน');
    const ring = await b.text('.tier-ring');
    ok(/Gold/.test(await b.text('.tr-name')) && /คุณอยู่ระดับสูงสุดแล้ว/.test(ring) && /คงระดับถึง/.test(ring) && !/🎉/.test(ring) &&
      await b.eval(`+document.querySelector('.tier-ring .tr-val').getAttribute('stroke-dashoffset') === 0`),
      'ลูกค้า Gold (สูงสุด): วงเต็ม + "คุณอยู่ระดับสูงสุดแล้ว" + "คงระดับถึง"', ring);
    // สีวง = สีของระดับ (ไม่ใช่สีปุ่มร้าน) — CSS เคยทับสีที่ใส่ใน SVG
    const ringColor = await b.eval(`getComputedStyle(document.querySelector('.tier-ring .tr-val')).stroke`);
    const [gc] = await sql(`select color from tiers where shop_id='demo' and id=$1`, [gold]);
    const hex = c => { const m = String(c).match(/\d+/g); return m ? '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase() : ''; };
    ok(!gc.color || hex(ringColor) === gc.color.toUpperCase(), 'วงแหวนเป็นสีของระดับ Gold', { ringColor, tierColor: gc.color });
    await b.shot(path.join(OUT, 'n12-customer-ring-gold.png'), { full: true });

    console.log('\n[8] ส่งข้อความตามกลุ่ม: คัดกลุ่มลูกค้า (รอบ 1) + เขียนข้อความและส่งผ่าน LINE OA (รอบ 2)');
    const SENDABLE = `status = 'ACTIVE' and marketing_consent and line_user_id is not null`;
    await b.eval(asUser('U_DEMO_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo/admin#broadcast`); // เปิดลิงก์หน้านี้ตรงๆ ครั้งแรก (ยังไม่รู้ว่าใครเข้า)
    await b.waitFor(`document.querySelector('form[data-form=audience]') && document.querySelector('.aud-count')`, 10000, 'หน้าส่งข้อความ');
    ok(await b.eval(`!!document.querySelector('.adm-nav a[data-page=broadcast].active')`), 'เมนู "ส่งข้อความ" (เจ้าของร้าน + แพ็กเกจเปิด) เปิดจากลิงก์ตรงได้');
    const [allSend] = await sql(`select count(*)::int as n from members where shop_id = 'demo' and ${SENDABLE}`);
    ok(num(await b.text('.aud-count')) === allSend.n, `ไม่ใส่เงื่อนไข → ส่งได้ ${allSend.n} คน (ตรงกับฐานข้อมูล)`, await b.text('.aud-count'));
    ok(await b.eval(`document.querySelectorAll('.aud-result tbody tr').length`) === 20, 'ตัวอย่างรายชื่อ 20 คน');
    const [nb] = await sql(`select count(*)::int as n from branches where shop_id = 'demo'`);
    ok(await b.eval(`document.querySelectorAll('input[name=tiers]').length === 3 && document.querySelectorAll('input[name=branches]').length === ${nb.n + 1}`),
      `ตัวเลือกระดับ 3 ระดับ + สาขา ${nb.n} สาขา + ออนไลน์`);
    ok(await b.eval(`document.documentElement.scrollWidth <= window.innerWidth`), 'มือถือ: หน้าไม่ล้นจอด้านข้าง');
    await b.shot(path.join(OUT, 'n13-broadcast-all.png'), { full: true });

    // เลือก Gold + แต้มตั้งแต่ 50 → เทียบกับฐานข้อมูล
    await b.eval(`[...document.querySelectorAll('input[name=tiers]')].find((x) => /Gold/.test(x.parentElement.innerText)).click()`);
    await b.type('form[data-form=audience] input[name=pointsMin]', '50');
    await b.click('form[data-form=audience] button[type=submit]');
    await b.waitFor(`document.querySelector('.aud-count b').innerText.replace(/\\D/g, '') !== '${allSend.n}'`, 8000, 'จำนวนคนเปลี่ยน');
    const [gold50] = await sql(`select count(*)::int as n from members m join tiers t on t.shop_id = m.shop_id and t.id = m.tier_id
      where m.shop_id = 'demo' and t.name = 'Gold' and m.points >= 50 and m.${SENDABLE.replace(/ and /g, ' and m.')}`);
    ok(num(await b.text('.aud-count')) === gold50.n && gold50.n > 0, `Gold + ${'แต้ม'}ตั้งแต่ 50 → ส่งได้ ${gold50.n} คน (ตรงกับฐานข้อมูล)`, await b.text('.aud-count'));
    ok(await b.eval(`[...document.querySelectorAll('.aud-result tbody tr')].every((tr) => /Gold/.test(tr.innerText))`), 'ตัวอย่างรายชื่อเป็น Gold ทุกคน');
    ok(await b.eval(`document.querySelector('input[name=pointsMin]').value === '50'`), 'ฟอร์มยังเก็บค่าที่ใส่ไว้');
    await b.shot(path.join(OUT, 'n14-broadcast-gold.png'), { full: true });

    // ค่าผิด → เตือน ไม่ส่งคำขอ ผลเดิมยังอยู่
    await b.type('form[data-form=audience] input[name=pointsMax]', '10');
    await b.click('form[data-form=audience] button[type=submit]');
    await b.waitFor(`/ค่าเริ่มต้องไม่มากกว่า/.test((document.querySelector('.toast.show') || {}).innerText || '')`, 3000, 'เตือนช่วงแต้มผิด');
    ok(num(await b.text('.aud-count')) === gold50.n, 'แต้มเริ่มมากกว่าแต้มสิ้นสุด → เตือน และผลเดิมยังอยู่');

    // ล้างเงื่อนไข
    await b.click('[data-act=aud-clear]');
    await b.waitFor(`document.querySelector('.aud-count b') && document.querySelector('.aud-count b').innerText.replace(/\\D/g, '') === '${allSend.n}'`, 8000, 'ล้างเงื่อนไข');
    ok(await b.eval(`document.querySelector('input[name=pointsMin]').value === '' && !document.querySelector('input[name=tiers]:checked')`), 'ล้างเงื่อนไข → กลับเป็นทุกคนที่ส่งได้');

    // ---- รอบ 2: เขียนข้อความ + ส่งผ่าน LINE OA (เซิร์ฟเวอร์ในเครื่องใช้ OA จำลอง โควตา 300 ไม่ส่งจริง) ----
    const oaState = async (set) => (await fetch('http://localhost:8105/__oa', set ? { method: 'POST', body: JSON.stringify(set) } : {})).json();
    await b.waitFor(`document.querySelector('form[data-form=broadcast]')`, 8000, 'กล่องเขียนข้อความ (เชื่อม OA แล้ว)');
    ok(/OA ทดลอง/.test(await b.text('#bc-send')) && /เหลือ 300 \/ 300/.test(await b.text('#bc-send')), 'เชื่อม LINE OA แล้ว: เห็นชื่อ OA + โควตาเดือนนี้', await b.text('#bc-send'));
    ok(/ยังไม่เคยส่งข้อความ/.test(await b.text('#bc-history')), 'ประวัติการส่งยังว่าง');
    ok(await b.eval(`document.getElementById('bc-send-btn').disabled`), 'ยังไม่พิมพ์ข้อความ → ปุ่มส่งกดไม่ได้');
    const msg = 'สวัสดีค่ะ\nสมาชิก Gold รับส่วนลด 20%';
    await b.eval(`(() => { const t = document.querySelector('form[data-form=broadcast] textarea[name=text]'); t.value = ${JSON.stringify(msg)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    ok((await b.text('#bc-preview .lp-bubble')) === msg && /OA ทดลอง/.test(await b.text('#bc-preview')), 'ตัวอย่างในแชต LINE ขึ้นตามที่พิมพ์ (ขึ้นบรรทัดใหม่ได้)');
    await b.click('[data-act=bc-test]');
    await b.waitFor(`/ส่งทดสอบแล้ว/.test((document.querySelector('.toast.show') || {}).innerText || '')`, 8000, 'ส่งทดสอบ');
    let st = await oaState();
    ok(st.pushes.length === 1 && st.pushes[0].to === 'U_DEMO_OWNER' && st.pushes[0].messages[0].text === msg, 'ส่งทดสอบ → ถึงเจ้าของร้านคนเดียว', st.pushes);

    // รูปริชเมสเสจ: เลือกรูป 1 รูป → หน้าเว็บย่อเป็น 5 ขนาด อัปทีเดียว → ตัวอย่างเต็มความกว้าง + ช่อง "แตะรูปแล้วเปิด"
    ok(await b.eval(`document.getElementById('bc-link-field').hidden`), 'ยังไม่มีรูป → ไม่มีช่อง "แตะรูปแล้วเปิด"');
    const uploadsNow = async () => (await fetch('http://localhost:8105/__uploads')).json();
    const up0 = (await uploadsNow()).length;
    const pickImage = (w, h) => b.eval(`(async () => {
      const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
      const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, ${w}, ${h}); g.fillStyle = '#fff'; g.fillRect(${w / 4}, ${h / 4}, ${w / 2}, ${h / 2});
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'promo.png', { type: 'image/png' }));
      const input = document.querySelector('form[data-form=broadcast] input[type=file]');
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await pickImage(3000, 900);
    await b.waitFor(`/กว้างเกินไป/.test((document.querySelector('.toast.show') || {}).innerText || '')`, 8000, 'เตือนรูปกว้างเกิน');
    ok(!(await b.eval(`document.querySelector('form[data-form=broadcast] input[name=image]').value`)) && (await uploadsNow()).length === up0,
      'รูปแนวนอนเกิน 2:1 → บอกให้เปลี่ยนรูป ไม่อัปโหลด ไม่ตัดรูปเอง');
    await pickImage(1200, 900);
    await b.waitFor(`document.querySelector('#bc-preview .lp-rich')`, 10000, 'ตัวอย่างริชเมสเสจ');
    const ups = (await uploadsNow()).slice(up0);
    ok(ups.length === 5 && ups.map((u) => u.path.split('/').pop()).join() === '1040,700,460,300,240' && ups.every((u) => u.mime === 'image/jpeg' && /^demo\/rich-/.test(u.path)),
      'รูป 1200×900 → ย่อเป็น 5 ขนาด (JPG) อัปในคำขอเดียว', ups);
    ok(await b.eval(`(() => { const box = document.querySelector('#bc-preview .lp-rich').getBoundingClientRect(); const bub = document.querySelector('#bc-preview .lp-bubble').getBoundingClientRect();
      return Math.abs(box.width / box.height - 1040 / 780) < 0.02 && box.width > bub.width && !document.getElementById('bc-link-field').hidden; })()`),
      'ตัวอย่าง: รูปเต็มความกว้างตามสัดส่วน 4:3 (กว้างกว่ากล่องข้อความ) + ช่อง "แตะรูปแล้วเปิด" ขึ้น');
    await b.eval(`document.getElementById('bc-preview').scrollIntoView({ block: 'center' })`);
    await sleep(200);
    await b.shot(path.join(OUT, 'n14b-broadcast-rich.png'));
    await b.click('[data-act=bc-test]');
    for (let i = 0; i < 40 && (await oaState()).pushes.length < 2; i++) await sleep(200);
    st = await oaState();
    const rm = (st.pushes[1] || {}).messages || [];
    ok(rm.length === 2 && rm[0].type === 'imagemap' && rm[0].baseSize.width === 1040 && rm[0].baseSize.height === 780 && /\/images\/demo\/rich-[^/.]+$/.test(rm[0].baseUrl) &&
      /^https:\/\/liff\.line\.me\//.test(rm[0].actions[0].linkUri) && rm[1].text === msg, 'ส่งทดสอบ → ริชเมสเสจ (1040×780 แตะแล้วเปิดบัตรสมาชิก) + ข้อความ', rm);
    await b.eval(`(() => { const t = document.querySelector('form[data-form=broadcast] input[name=link]'); t.value = 'https://example.com/promo'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

    // ทุกคนที่ส่งได้ (เกิน 300) → โควตาไม่พอ กดยืนยันไม่ได้
    await b.waitFor(`/ส่งให้ ${allSend.n.toLocaleString('en-US')} คน/.test(document.getElementById('bc-send-btn').innerText) && !document.getElementById('bc-send-btn').disabled`, 8000, 'ปุ่มส่งพร้อม');
    await b.click('#bc-send-btn');
    await b.waitFor(`document.querySelector('.modal [data-act=bc-send-confirm]')`, 3000, 'หน้ายืนยันส่ง');
    ok(/ไม่พอส่ง/.test(await b.text('.modal')) && await b.eval(`document.querySelector('.modal [data-act=bc-send-confirm]').disabled`), 'โควตา LINE OA ไม่พอ → บอกในหน้ายืนยัน กดส่งไม่ได้');
    await b.click('.modal [data-act=close]');

    // แก้เงื่อนไขแล้วยังไม่กดดูจำนวน → ส่งไม่ได้
    await b.eval(`[...document.querySelectorAll('input[name=tiers]')].find((x) => /Gold/.test(x.parentElement.innerText)).click()`);
    await sleep(150);
    ok(await b.eval(`document.getElementById('bc-send-btn').disabled && /ดูจำนวนคน/.test(document.getElementById('bc-send-btn').innerText)`), 'แก้เงื่อนไขแล้วยังไม่กด "ดูจำนวนคน" → ปุ่มส่งล็อก');
    await b.click('form[data-form=audience] button[type=submit]');
    const [goldN] = await sql(`select count(*)::int as n from members m join tiers t on t.shop_id = m.shop_id and t.id = m.tier_id
      where m.shop_id = 'demo' and t.name = 'Gold' and m.${SENDABLE.replace(/ and /g, ' and m.')}`);
    await b.waitFor(`/ส่งให้ ${goldN.n} คน/.test(document.getElementById('bc-send-btn').innerText) && !document.getElementById('bc-send-btn').disabled`, 8000, 'ปุ่มส่ง Gold');
    await b.click('#bc-send-btn');
    await b.waitFor(`document.querySelector('.modal [data-act=bc-send-confirm]')`, 3000, 'หน้ายืนยันส่ง Gold');
    ok(new RegExp(`ส่งให้\\s*${goldN.n}\\s*คน`).test(await b.text('.modal')) && /ยกเลิกหรือแก้ไขไม่ได้/.test(await b.text('.modal')), `หน้ายืนยัน: ส่งให้ ${goldN.n} คน + เตือนว่าส่งแล้วยกเลิกไม่ได้`);
    await b.shot(path.join(OUT, 'n15-broadcast-confirm.png'));
    await b.click('.modal [data-act=bc-send-confirm]');
    await b.waitFor(`/ส่งแล้ว/.test((document.querySelector('.toast.show') || {}).innerText || '')`, 10000, 'ส่งแล้ว');
    await b.waitFor(`/ส่งครบ/.test(document.querySelector('#bc-history').innerText)`, 8000, 'ประวัติการส่ง');
    st = await oaState();
    const toIds = st.multicasts.flatMap((m) => m.to);
    const [goldIds] = await sql(`select array_agg(m.line_user_id order by m.line_user_id) as ids from members m join tiers t on t.shop_id = m.shop_id and t.id = m.tier_id
      where m.shop_id = 'demo' and t.name = 'Gold' and m.${SENDABLE.replace(/ and /g, ' and m.')}`);
    ok(JSON.stringify([...toIds].sort()) === JSON.stringify(goldIds.ids), `ส่งถึงลูกค้า Gold ที่ส่งได้ครบ ${goldN.n} คน ไม่เกินกลุ่ม`);
    ok(st.multicasts.every((m) => m.messages[0].type === 'imagemap' && m.messages[0].actions[0].linkUri === 'https://example.com/promo' && m.messages[1].text === msg),
      'ส่งจริง → ริชเมสเสจ (แตะแล้วเปิดลิงก์ที่ร้านใส่) + ข้อความ', st.multicasts.map((m) => m.messages));
    ok(new RegExp(`${goldN.n} / ${goldN.n}`).test(await b.text('#bc-history')) && /สวัสดีค่ะ/.test(await b.text('#bc-history')), 'ประวัติ: ข้อความ + ส่งครบ x / x คน');
    ok(await b.eval(`document.querySelector('form[data-form=broadcast] textarea').value === '' && document.querySelector('form[data-form=broadcast] input[name=image]').value === '' &&
      document.getElementById('bc-link-field').hidden && document.getElementById('bc-send-btn').disabled`), 'ส่งแล้วล้างข้อความ + รูป + ลิงก์ (กันเผลอส่งซ้ำ)');
    ok(/เหลือ \d+ \/ 300/.test(await b.text('#bc-send')) && !/เหลือ 300 \/ 300/.test(await b.text('#bc-send')), 'โควตาที่เหลืออัปเดตหลังส่ง');
    await b.shot(path.join(OUT, 'n16-broadcast-sent.png'), { full: true });

    // กดชื่อในตัวอย่าง → หน้าสมาชิกคนนั้น
    const firstId = await b.eval(`document.querySelector('.aud-result tbody tr').dataset.id`);
    await b.click('.aud-result tbody tr a');
    await b.waitFor(`/^#member\\//.test(location.hash) && document.querySelector('.member-head')`, 8000, 'หน้าสมาชิก');
    ok(decodeURIComponent(await b.eval('location.hash')) === '#member/' + firstId, 'กดชื่อในตัวอย่าง → หน้าสมาชิกคนนั้น');

    // ผู้จัดการ: ไม่มีเมนู + เปิดลิงก์ตรงก็กลับไปหน้าภาพรวม (ไม่ใช่หน้าไม่มีสิทธิ์)
    await sql(`insert into staff (shop_id, line_user_id, name, role, status) values ('demo', 'U_E2E_ADMIN', 'ผู้จัดการทดสอบ', 'ADMIN', 'ACTIVE') on conflict do nothing`);
    await b.eval(asUser('U_E2E_ADMIN', 'ผู้จัดการทดสอบ'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo/admin#broadcast`);
    await b.waitFor(`document.querySelector('.adm-nav') && document.querySelector('.kpis')`, 10000, 'หลังบ้านของผู้จัดการ');
    ok(await b.eval(`!document.querySelector('.adm-nav a[data-page=broadcast]') && !document.querySelector('form[data-form=audience]')`),
      'ผู้จัดการ: ไม่มีเมนูส่งข้อความ เปิดลิงก์ตรงแล้วไปหน้าภาพรวม');

    // ร้านที่ไม่ได้ซื้อแพ็กเกจนี้ → เจ้าของร้านก็ไม่เห็นเมนู
    await b.setFeatures('demo', { tiers: true, branches: true, export: true, broadcast: false });
    await b.eval(asUser('U_DEMO_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo/admin#broadcast`);
    await b.waitFor(`document.querySelector('.adm-nav') && document.querySelector('.kpis')`, 10000, 'หลังบ้าน (แพ็กเกจไม่มีส่งข้อความ)');
    ok(await b.eval(`!document.querySelector('.adm-nav a[data-page=broadcast]')`), 'แพ็กเกจไม่มีส่งข้อความ → เจ้าของร้านไม่เห็นเมนู');

    console.log('\n[9] ส่งข้อความ รอบ 3: เพิ่มเพื่อน LINE OA ก่อนสมัคร + ช่องยินยอมติ๊กไว้ให้ + แต้มรับข่าวสาร');
    await b.setFeatures('demo', { tiers: true, branches: true, export: true, broadcast: true });
    const oaSet = (set) => fetch('http://localhost:8105/__oa', { method: 'POST', body: JSON.stringify(set) });
    await oaSet({ friends: ['U_DEMO_OWNER'], limit: null }); // ลูกค้าใหม่ยังไม่ได้เพิ่มเพื่อน
    await sql(`update shops set consent_bonus_points = 20 where id = 'demo'`);
    await b.eval(asUser('U_E2E_R3', 'ลูกค้ารอบสาม'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo?branch=B02`); // สแกน QR ของสาขา 2
    await b.waitFor(`document.querySelector('.gate-card')`, 10000, 'หน้าเพิ่มเพื่อนก่อนสมัคร');
    ok(/เพิ่มเพื่อน LINE ของร้านก่อนสมัครสมาชิก/.test(await b.text()) && !(await b.eval(`!!document.querySelector('#reg')`)),
      'ยังไม่เป็นเพื่อน OA → หน้า "เพิ่มเพื่อนก่อนสมัคร" (ยังไม่เห็นฟอร์ม)');
    ok(await b.eval(`document.querySelector('[data-friend-add]').getAttribute('href')`) === 'https://line.me/R/ti/p/%40demo-oa', 'ปุ่มเพิ่มเพื่อนไปหน้าเพิ่มเพื่อน @ไอดีของ OA');
    await b.shot(path.join(OUT, 'n17-friend-gate.png'));
    await b.click('[data-act=friend-check]');
    await b.waitFor(`!document.querySelector('#gate-error').hidden`, 8000, 'แจ้งว่ายังไม่ได้เพิ่ม');
    ok(/ยังไม่พบว่าเพิ่มเพื่อนแล้ว/.test(await b.text('#gate-error')), 'กด "เพิ่มเพื่อนแล้ว" ทั้งที่ยังไม่ได้เพิ่ม → บอกให้เพิ่มก่อน');
    await oaSet({ friends: ['U_DEMO_OWNER', 'U_E2E_R3'] });
    await b.click('[data-act=friend-check]');
    await b.waitFor(`document.querySelector('#reg')`, 8000, 'ฟอร์มสมัครหลังเพิ่มเพื่อน');
    ok(true, 'เพิ่มเพื่อนแล้วกด "เพิ่มเพื่อนแล้ว" → ฟอร์มสมัครขึ้น');
    ok(await b.eval(`document.querySelector('#reg input[name=consentMarketing]').checked`) && /รับฟรี 20 แต้มทันที/.test(await b.text('#reg')) &&
      /ยกเลิกได้ทุกเมื่อที่ "แก้ไขข้อมูล"/.test(await b.text('#reg')), 'ช่องยินยอมติ๊กไว้ให้ + "รับฟรี 20 แต้มทันที" + บอกวิธียกเลิก (แบบที่ 1)');
    await b.shot(path.join(OUT, 'n18-register-consent.png'), { full: true });
    await b.type('#reg input[name=firstName]', 'รอบสาม');
    await b.type('#reg input[name=lastName]', 'ทดสอบ');
    await b.eval(`(() => { const f = document.querySelector('#reg'); f.bdDay.value = '9'; f.bdMonth.value = '9'; f.bdYear.value = '2530'; return true; })()`);
    await b.type('#reg input[name=phone]', '0867770003');
    await b.eval(`document.querySelector('#reg input[name=consentPrivacy]').click()`);
    await b.click('#reg button[type=submit]');
    await b.waitFor(`document.querySelector('.member-card') && document.querySelector('.modal')`, 10000, 'บัตร + ป๊อปอัปต้อนรับ');
    ok(/10 แต้ม/.test(await b.text('.modal')) && /20 แต้ม/.test(await b.text('.modal')) && /รับข่าวสาร/.test(await b.text('.modal')), 'ป๊อปอัป: แต้มต้อนรับ 10 + แต้มรับข่าวสาร 20', await b.text('.modal'));
    await b.click('.modal [data-act=close]');
    const [r3] = await sql(`select points, marketing_consent, consent_preticked, oa_friend, joined_branch from members where shop_id = 'demo' and line_user_id = 'U_E2E_R3'`);
    ok(r3 && r3.points === 30 && r3.marketing_consent === true && r3.consent_preticked === true && r3.oa_friend === true && r3.joined_branch === 'B02',
      'ฐานข้อมูล: 30 แต้ม / ยินยอม (ติ๊กไว้ให้) / เป็นเพื่อน OA / สาขาจาก QR ยังอยู่หลังเพิ่มเพื่อน', r3);
    ok(!(await b.eval(`!!document.querySelector('.oa-card')`)), 'เป็นเพื่อนแล้ว → หน้าแรกไม่มีการ์ดชวนเพิ่มเพื่อน');

    // บล็อก OA ทีหลัง (เช็กครบรอบ) → การ์ดชวนเพิ่มเพื่อน
    await oaSet({ friends: ['U_DEMO_OWNER'] });
    await sql(`update members set oa_friend_at = now() - interval '2 days' where shop_id = 'demo' and line_user_id = 'U_E2E_R3'`);
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo#home`);
    await b.waitFor(`document.querySelector('.oa-card')`, 10000, 'การ์ดชวนเพิ่มเพื่อน');
    ok(/เพิ่มเพื่อน LINE ของร้าน/.test(await b.text('.oa-card')), 'บล็อก OA → หน้าแรกมีการ์ด "เพิ่มเพื่อน LINE ของร้าน"');
    await b.shot(path.join(OUT, 'n19-friend-card.png'));
    // แก้ไขข้อมูล: ปิดรับข่าวสาร → เตือนสั้นๆ (ไม่ห้าม)
    await b.nav(`${WEB}/demo#profile`);
    await b.waitFor(`document.querySelector('#profile')`, 8000, 'หน้าแก้ไขข้อมูล');
    await b.eval(`document.querySelector('#profile input[name=consentMarketing]').click()`);
    ok(/ถ้ายกเลิก จะไม่ได้รับโปรโมชันและสิทธิพิเศษทาง LINE/.test(await b.text('#consent-hint')), 'ปิดสวิตช์รับข่าวสาร → เตือนว่าจะไม่ได้รับโปรโมชัน');
    await b.nav(`${WEB}/demo#history`);
    await b.waitFor(`document.querySelector('.tx-list')`, 8000, 'ประวัติ');
    ok(/รับข่าวสารจากร้าน/.test(await b.text('.tx-list')), 'ประวัติแต้ม: "รับข่าวสารจากร้าน"');

    // หลังบ้าน: ตั้งค่าร้าน 3 ข้อใหม่ + จำนวนที่ได้รับจริง
    await b.eval(asUser('U_DEMO_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo/admin#settings`);
    await b.waitFor(`document.querySelector('form[data-form=settings] select[name=REQUIRE_OA_FRIEND]')`, 10000, 'ตั้งค่าร้าน');
    ok(await b.eval(`document.querySelector('select[name=REQUIRE_OA_FRIEND]').value === 'ON' && document.querySelector('select[name=CONSENT_PRETICKED]').value === 'ON' &&
      document.querySelector('input[name=CONSENT_BONUS_POINTS]').value === '20'`), 'ตั้งค่าร้าน: บังคับเพิ่มเพื่อน เปิด / ติ๊กไว้ให้ เปิด / แต้มรับข่าวสาร 20');
    await b.eval(`(() => { const s = document.querySelector('select[name=CONSENT_PRETICKED]'); s.value = 'OFF'; return true; })()`);
    await b.click('form[data-form=settings] button[type=submit]');
    await b.waitFor(`document.querySelector('.modal [data-act=settings-confirm]')`, 3000, 'ยืนยันตั้งค่า');
    ok(/เปิด\s*→\s*ปิด/.test(await b.text('.modal')), 'หน้ายืนยัน: เปิด → ปิด', await b.text('.modal'));
    await b.click('.modal [data-act=settings-confirm]');
    await b.waitFor(`/บันทึกการตั้งค่าแล้ว/.test((document.querySelector('.toast.show') || {}).innerText || '')`, 8000, 'บันทึกตั้งค่า');
    const [s9] = await sql(`select consent_preticked from shops where id = 'demo'`);
    ok(s9.consent_preticked === false, 'บันทึกแล้ว: ไม่ติ๊กไว้ให้');
    await sql(`update shops set consent_preticked = true, consent_bonus_points = 0 where id = 'demo'`);
    await b.nav(`${WEB}/demo/admin#broadcast`);
    await b.waitFor(`document.querySelector('.aud-reach')`, 10000, 'จำนวนที่ได้รับจริง');
    ok(/ได้รับจริง [\d,]+ คน/.test(await b.text('.aud-reach')) && /ยังไม่เป็นเพื่อนหรือบล็อก 1 คน/.test(await b.text('.aud-reach')),
      'หน้าส่งข้อความ: "ได้รับจริง" + "ยังไม่เป็นเพื่อนหรือบล็อก 1 คน"', await b.text('.aud-reach'));
    await oaSet({ friends: null });

    console.log('\n[10] PDPA ขั้นที่ 2: หน้ายอมรับนโยบายฉบับใหม่ + ลูกค้าลบบัญชีเอง + เจ้าของร้านลบให้');
    const [v10] = await sql(`select consent_version from shops where id = 'demo'`);
    await sql(`update shops set consent_version = $1 where id = 'demo'`, [v10.consent_version + 1]);
    await b.eval(asUser('U_E2E_R3', 'ลูกค้ารอบสาม'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo#home`);
    await b.waitFor(`/ร้านปรับปรุงนโยบายความเป็นส่วนตัว/.test(document.body.innerText) && document.querySelector('[data-act=policy-accept]')`, 10000, 'หน้ายอมรับนโยบาย');
    ok(!(await b.eval(`!!document.querySelector('.member-card')`)) && !(await b.eval(`!!document.querySelector('.nav')`)),
      'ร้านแก้นโยบาย → เปิดบัตรเจอหน้ายอมรับนโยบาย (ยังไม่เห็นบัตร/เมนู)');
    await b.shot(path.join(OUT, 'n20-policy-gate.png'));
    await b.click('[data-act=privacy]');
    await b.waitFor(`document.querySelector('.modal .prose')`, 5000, 'อ่านนโยบาย');
    await b.click('.modal [data-act=close]');
    await b.click('[data-act=policy-accept]');
    await b.waitFor(`document.querySelector('.member-card')`, 10000, 'บัตรหลังยอมรับ');
    const [acc10] = await sql(`select consent_version from members where shop_id = 'demo' and line_user_id = 'U_E2E_R3'`);
    ok(acc10.consent_version === v10.consent_version + 1, 'กด "ยอมรับ" → เข้าบัตรได้ + จดฉบับที่ยอมรับ', acc10);

    // ลูกค้าลบบัญชีเอง (ยืนยัน 2 ชั้น)
    await b.nav(`${WEB}/demo#profile`);
    await b.waitFor(`document.querySelector('[data-act=delete-account]')`, 8000, 'ลิงก์ลบบัญชี');
    await b.click('[data-act=delete-account]');
    await b.waitFor(`document.querySelector('.modal [data-act=delete-next]')`, 3000, 'ขั้นแรก');
    ok(/30 แต้ม/.test(await b.text('.modal')) && /กู้คืนไม่ได้/.test(await b.text('.modal')), 'ขั้นแรก: บอกแต้มที่จะหาย + กู้คืนไม่ได้', await b.text('.modal'));
    await b.click('.modal [data-act=delete-next]');
    await b.waitFor(`document.querySelector('#delete-word')`, 3000, 'ขั้นที่สอง');
    ok(await b.eval(`document.querySelector('[data-act=delete-confirm]').disabled`), 'ขั้นที่สอง: ยังไม่พิมพ์ "ลบ" → ปุ่มลบกดไม่ได้');
    await b.type('#delete-word', 'ลบ');
    ok(!(await b.eval(`document.querySelector('[data-act=delete-confirm]').disabled`)), 'พิมพ์ "ลบ" → ปุ่มลบบัญชีกดได้');
    await b.shot(path.join(OUT, 'n21-delete-confirm.png'));
    await b.click('[data-act=delete-confirm]');
    await b.waitFor(`/ลบบัญชีแล้ว/.test((document.querySelector('.modal') || {}).innerText || '') && document.querySelector('#reg')`, 10000, 'ลบแล้ว → หน้าสมัคร');
    const [del10] = await sql(`select status, phone, name from members where shop_id = 'demo' and phone is null and status = 'DELETED' and id = (
      select member_id from profile_log where shop_id = 'demo' and changed = 'ลบบัญชี (ลูกค้าลบเอง)' order by created_at desc limit 1)`);
    ok(del10 && del10.name === '', 'ลบบัญชีสำเร็จ → กลับไปหน้าสมัคร + ฐานข้อมูลไม่มีชื่อ/เบอร์แล้ว', del10);
    ok(!(await b.eval(`Object.keys(localStorage).some((k) => k.indexOf('crm_last:demo:U_E2E_R3') === 0)`)), 'บัตรที่จำไว้ในเครื่องถูกลบด้วย');
    await b.click('.modal [data-act=close]');

    // เจ้าของร้านลบให้ในหลังบ้าน
    const [t10] = await sql(`select id from members where shop_id = 'demo' and status = 'ACTIVE' and line_user_id like 'U_DEMO_%' order by id desc limit 1`);
    await b.eval(asUser('U_DEMO_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo/admin#member/${t10.id}`);
    await b.waitFor(`document.querySelector('[data-act=member-delete]')`, 10000, 'ปุ่มลบข้อมูลสมาชิก');
    await b.click('[data-act=member-delete]');
    await b.waitFor(`document.querySelector('form[data-form=member-delete]')`, 3000, 'หน้าต่างลบ');
    ok(/ห้ามใส่ชื่อหรือเบอร์ลูกค้า/.test(await b.text('.modal')), 'หน้าต่างลบเตือนห้ามใส่ชื่อ/เบอร์ในเหตุผล');
    await b.type('form[data-form=member-delete] input[name=reason]', 'ลูกค้าขอที่หน้าร้าน');
    await b.type('form[data-form=member-delete] input[name=confirm]', 'ลบ');
    await b.shot(path.join(OUT, 'n22-admin-delete.png'));
    await b.click('form[data-form=member-delete] button[type=submit]');
    await b.waitFor(`location.hash === '#members' && /ลบข้อมูลสมาชิกแล้ว/.test((document.querySelector('.toast.show') || {}).innerText || '')`, 10000, 'ลบแล้วกลับรายชื่อ');
    const [g10] = await sql(`select status from members where shop_id = 'demo' and id = $1`, [t10.id]);
    ok(g10.status === 'DELETED', 'เจ้าของร้านลบให้ → สถานะลบแล้ว + กลับไปหน้ารายชื่อ');
    await b.nav(`${WEB}/demo/admin#member/${t10.id}`);
    await b.waitFor(`/ลบบัญชีแล้ว/.test(document.getElementById('view').innerText)`, 10000, 'หน้าสมาชิกที่ลบแล้ว');
    ok(/สมาชิกที่ลบแล้ว/.test(await b.text('#view')) && !(await b.eval(`!!document.querySelector('[data-act=member-status], [data-act=member-delete], form[data-form=adjust]')`)),
      'เปิดหน้าสมาชิกที่ลบแล้ว → "สมาชิกที่ลบแล้ว" ไม่มีปุ่มแก้/ระงับ/ปรับแต้ม');
    await b.nav(`${WEB}/demo/admin#brand`);
    await b.waitFor(`document.querySelector('.policy-count')`, 10000, 'ตัวนับยอมรับนโยบาย');
    ok(/ยอมรับฉบับที่ \d+ แล้ว [\d,]+ จาก [\d,]+ คน/.test(await b.text('.policy-count')), 'หน้าตาร้าน: "ยอมรับฉบับที่ N แล้ว X จาก Y คน"', await b.text('.policy-count'));
    await sql(`update shops set consent_version = $1 where id = 'demo'`, [v10.consent_version]);

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
