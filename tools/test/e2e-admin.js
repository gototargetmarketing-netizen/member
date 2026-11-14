// ทดสอบหลังบ้าน (admin.html) ใน Chrome: สิทธิ์ · ภาพรวม · สมาชิก · ปรับแต้ม · รายการ · คูปอง · พนักงาน · ส่งออกไฟล์
// ต้องเปิด 2 อย่างก่อน: python3 tools/dev-server.py 8002  และ  node tools/test/gas-server.js
// ใช้ผู้ใช้ชุด U_ADM_* ของตัวเอง จึงรันต่อจาก e2e.js บนเซิร์ฟเวอร์เดิมได้ / ภาพหน้าจออยู่ใน tools/test/shots/
const { launch, sleep } = require('./cdp');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const OUT = path.join(__dirname, 'shots');
const DL = path.join(os.tmpdir(), 'line-crm-e2e-download');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const WEB = 'http://localhost:8002';
// API=... = รันกับระบบใหม่ (COMPAT=1 node tools/api-server.js) / ไม่ตั้ง = ระบบเดิมจำลอง (gas-server)
const API = process.env.API || 'http://localhost:8102';
// ระบบใหม่เก็บรูปที่ Supabase Storage (ระบบเดิม: Google Drive) → ข้อตรวจเรื่องลิงก์รูปที่อัปโหลดต่างกันตามระบบ
const NEW_API = !!process.env.API;
const UPLOADED = NEW_API ? '/storage/v1/object/public/images/khamwan/reward-' : 'thumbnail?id=FILE';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); } };
const api = (action, user, data = {}) => fetch(API, { method: 'POST', body: JSON.stringify({ ...data, action, idToken: `TEST:${user}:${user}` }) }).then(r => r.json());
const adminOp = (op) => fetch(API + '/__admin', { method: 'POST', body: JSON.stringify(op) }).then(r => r.json());
const rid = () => crypto.randomUUID();
const NEW_STAFF = 'U_ADM_NEW_' + Date.now().toString(36); // คนใหม่ทุกครั้งที่รัน (รันซ้ำบนเซิร์ฟเวอร์เดิมได้)
const STAMP = Date.now().toString(36);
const asUser = (id, name) => `localStorage.setItem('crm_test_user', JSON.stringify({id:'${id}', name:'${name}'}))`;

async function seed() {
  // พนักงาน: เจ้าของร้าน / ผู้จัดการ / แคชเชียร์ / คนรออนุมัติ
  for (const [id, role] of [['U_ADM_OWNER', 'OWNER'], ['U_ADM_MGR', 'ADMIN'], ['U_ADM_CASH', 'CASHIER']]) {
    await api('staffMe', id);
    await adminOp({ userId: id, status: 'ACTIVE', role });
  }
  await api('staffMe', NEW_STAFF);
  // ลูกค้า 3 คน + ยอดซื้อ + แลกรางวัล + ใช้คูปอง
  const ids = [];
  for (let i = 1; i <= 3; i++) {
    const r = await api('register', 'U_ADM_C' + i, { firstName: (i === 3 ? '=' : '') + 'ลูกค้าหลังบ้าน', lastName: 'คนที่' + ['', 'หนึ่ง', 'สอง', 'สาม'][i], birthDate: '1990-0' + i + '-15', phone: '086111000' + i, consentPrivacy: true });
    if (!r.ok) throw new Error('สมัครสมาชิกทดสอบไม่สำเร็จ: ' + JSON.stringify(r));
    ids.push(r.member.memberId);
  }
  for (const [i, amount] of [[0, 1500], [0, 320], [1, 800], [2, 60]]) {
    await api('addPurchase', 'U_ADM_CASH', { memberId: ids[i], amount, requestId: rid() });
  }
  const red = await api('redeem', 'U_ADM_C1', { rewardId: 'R001', requestId: rid() });
  await api('useCoupon', 'U_ADM_CASH', { code: red.coupon.code, requestId: rid() });
  return ids;
}

(async () => {
  const ids = await seed();
  console.log('เตรียมข้อมูลแล้ว: สมาชิก ' + ids.join(', '));
  const b = await launch({ port: 9335, profile: path.join(os.tmpdir(), 'line-crm-e2e-admin-chrome'), width: 1280, height: 860, dpr: 1, mobile: false });
  try {
    await b.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

    // เปลี่ยนหน้าในหลังบ้าน แล้วรอจนหน้าใหม่วาดเสร็จ (หน้าเดิมยังค้างจางๆ ระหว่างโหลด จึงต้องดูหัวข้อหน้า)
    const LABEL = {"overview": "ภาพรวม", "members": "สมาชิก", "transactions": "รายการแต้ม", "coupons": "คูปอง", "rewards": "ของรางวัล", "promos": "โปรโมชัน", "rules": "แต้มพิเศษ", "staff": "พนักงาน", "brand": "หน้าตาร้าน", "settings": "ตั้งค่าร้าน"};
    const gotoPage = async (page) => {
      await b.click(`.adm-nav a[data-page=${page}]`);
      await b.waitFor(`(document.querySelector('.adm-head h1')?.innerText || '') === ${JSON.stringify(LABEL[page])} && !document.getElementById('view').classList.contains('is-loading')`, 10000, 'หน้า ' + LABEL[page]);
    };

    console.log('\n[สิทธิ์] แคชเชียร์เข้าหลังบ้านไม่ได้');
    await b.nav(`${WEB}/khamwan/admin?api=${encodeURIComponent(API)}&user=U_ADM_CASH&name=${encodeURIComponent('แคชเชียร์')}`);
    await b.waitFor(`/เจ้าของร้านและผู้จัดการ/.test(document.body.innerText)`, 10000, 'หน้าไม่มีสิทธิ์');
    ok(true, 'แคชเชียร์ → "หน้านี้สำหรับเจ้าของร้านและผู้จัดการ"');
    await b.shot(path.join(OUT, 'a01-no-access.png'));

    console.log('\n[ภาพรวม] เจ้าของร้าน');
    await b.eval(asUser('U_ADM_OWNER', 'เจ้าของร้าน'));
    const slowBoot = await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch; window.fetch = async (...a) => { await new Promise(r => setTimeout(r, 1500)); return f(...a); }; })()` }); // หน่วงคำขอ ให้ทันเห็นหน้าโหลด
    await b.nav(`${WEB}/khamwan/admin`);
    await b.waitFor(`document.querySelector('.boot-screen .boot-ring') && /กำลังเข้าสู่ระบบ/.test(document.querySelector('.boot-screen .boot-msg').innerText) && /Design by Go To Target/.test(document.querySelector('.boot-screen .credit').innerText) && !document.querySelector('.boot-name')`, 3000, 'หน้าโหลดสีกลางของหลังบ้าน');
    ok(true, 'หลังบ้านเปิดด้วยหน้าโหลดสีกลาง (ไม่มีชื่อ/สีร้าน) + เครดิต Go To Target');
    await b.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: slowBoot.identifier });
    await b.waitFor(`document.querySelectorAll('.kpi').length === 8`, 10000, 'ตัวเลขสรุป 8 ช่อง');
    ok(/เจ้าของร้าน/.test(await b.text('.adm-me')), 'เมนูซ้ายแสดงชื่อ + บทบาท');
    await b.waitFor(`(() => { const c = document.querySelector('.credit-side'); const i = c && c.querySelector('img'); return !!c && c.offsetParent !== null && /Design by Go To Target/.test(c.innerText) && i.complete && i.naturalWidth > 0; })()`, 5000, 'เครดิตในเมนูข้าง');
    ok(!(await b.eval(`document.querySelector('.credit-foot').offsetParent !== null`)), 'คอม: เครดิตอยู่ในเมนูข้าง ไม่ซ้ำท้ายหน้า');
    ok((await b.eval(`document.querySelectorAll('.bar-col').length`)) === 30, 'ค่าเริ่มต้น 30 วัน → กราฟ 30 แท่ง');
    const kpiSales = await b.eval(`[...document.querySelectorAll('.kpi')].find(k => /ยอดซื้อรวม/.test(k.innerText)).querySelector('.kpi-value').innerText`);
    ok(/฿/.test(kpiSales) && Number(kpiSales.replace(/[^\d.]/g, '')) >= 2680, 'ยอดซื้อรวม ≥ 2,680 บาท (' + kpiSales + ')');
    ok(/ลูกค้าหลังบ้าน คนที่หนึ่ง/.test(await b.text('.adm-grid3')), 'ลูกค้าซื้อมากสุดมีลูกค้าหลังบ้าน คนที่หนึ่ง');
    ok(/แคชเชียร์|U_ADM_CASH/.test(await b.text('.adm-grid3')), 'ตารางตามพนักงานมีแคชเชียร์');
    await b.click('[data-act=preset][data-id=today]');
    await b.waitFor(`document.querySelectorAll('.bar-col').length === 1`, 8000, 'ช่วงวันนี้');
    ok(true, 'กด "วันนี้" → กราฟเหลือ 1 แท่ง');
    await b.click('[data-act=preset][data-id="7d"]');
    await b.waitFor(`document.querySelectorAll('.bar-col').length === 7`, 8000, 'ช่วง 7 วัน');
    await b.eval(`document.querySelector('.bar-col:last-child').dispatchEvent(new PointerEvent('pointerover', {bubbles:true}))`);
    ok(/ยอดซื้อ ฿/.test(await b.text('#chart-tip')), 'ชี้ที่แท่ง → แสดงกล่องตัวเลข');
    await b.shot(path.join(OUT, 'a02-overview.png'), { full: true });
    await b.click('[data-act=preset][data-id=custom]');
    await b.waitFor(`document.querySelector('form[data-form=range]')`, 8000, 'เลือกวันเอง');
    ok(true, 'กด "เลือกวัน" → มีช่องเลือกวันที่');

    console.log('\n[สมาชิก] ค้นหา → ดูรายคน → ปรับแต้ม');
    await gotoPage('members');
    await b.waitFor(`document.querySelectorAll('.tbl tbody tr.row-link').length >= 3`, 8000, 'ตารางสมาชิก');
    ok(/086-111-0001/.test(await b.text('.tbl')), 'เจ้าของร้านเห็นเบอร์เต็ม (086-111-0001)');
    ok(!!(await b.eval(`document.querySelector('[data-act=export][data-id=members]')`)), 'เจ้าของร้านมีปุ่มส่งออก');
    await b.type('form[data-form=members] input[name=q]', '0002');
    await b.eval(`document.querySelector('form[data-form=members]').requestSubmit()`);
    await b.waitFor(`document.querySelectorAll('.tbl tbody tr.row-link').length === 1`, 8000, 'ผลค้นหา 1 คน');
    ok(/ลูกค้าหลังบ้าน คนที่สอง/.test(await b.text('.tbl')), 'ค้นเบอร์บางส่วน 0002 → เจอลูกค้าหลังบ้าน คนที่สอง');
    await b.shot(path.join(OUT, 'a03-members.png'));
    await b.click('.tbl tbody tr.row-link td:nth-child(4)');
    await b.waitFor(`document.querySelector('form[data-form=adjust]')`, 8000, 'หน้าสมาชิกรายคน');
    ok((await b.eval('location.hash')).startsWith('#member/'), 'กดแถว → เปิดสมาชิกรายคน');
    const before = Number((await b.eval(`document.querySelector('.kpi .kpi-value').innerText`)).replace(/\D/g, ''));
    await b.type('form[data-form=adjust] input[name=points]', '15');
    await b.type('form[data-form=adjust] input[name=reason]', 'ชดเชยทดสอบหลังบ้าน');
    await b.eval(`document.querySelector('form[data-form=adjust]').requestSubmit()`);
    await b.waitFor(`document.querySelector('.modal [data-act=adjust-confirm]')`, 3000, 'ยืนยันปรับแต้ม');
    await b.click('.modal [data-act=adjust-confirm]');
    await b.waitFor(`Number(document.querySelector('.kpi .kpi-value').innerText.replace(/\\D/g,'')) === ${before + 15}`, 8000, 'แต้มเพิ่ม 15');
    ok(/ชดเชยทดสอบหลังบ้าน/.test(await b.text('.tbl')), `ปรับ +15 (${before} → ${before + 15}) และขึ้นในประวัติ`);
    await b.click('[data-act=member-edit]');
    await b.waitFor(`document.querySelector('.modal form[data-form=member-edit]')`, 3000, 'ฟอร์มแก้ข้อมูลสมาชิก');
    ok(!(await b.eval(`!!document.querySelector('.modal [name=consentMarketing]')`)), 'เจ้าของร้านแก้ข้อมูลได้ แต่ไม่มีช่องรับข่าวสาร (ลูกค้ายินยอมเองเท่านั้น)');
    await b.eval(`(() => { const f = document.querySelector('.modal form'); f.birthDate.value = '1990-02-20'; f.requestSubmit(); return true; })()`);
    await b.waitFor(`!document.querySelector('.modal') && /ประวัติการแก้ข้อมูล/.test(document.getElementById('view').innerText) && !document.getElementById('view').classList.contains('is-loading')`, 8000, 'บันทึก + ประวัติ');
    ok(/20 ก\.พ\. 2533/.test(await b.text('.kv')) && /ประวัติการแก้ข้อมูล[\s\S]*วันเกิด\s+U_ADM_OWNER/.test(await b.text('#view')), 'เจ้าของร้านแก้วันเกิดได้ และขึ้นในประวัติการแก้ข้อมูล');
    await b.shot(path.join(OUT, 'a04-member.png'), { full: true });
    await b.click('.back-link');
    await b.waitFor(`document.querySelector('form[data-form=members] input[name=q]')?.value === '0002'`, 8000, 'กลับรายชื่อ');
    ok(true, 'กลับมารายชื่อ คำค้นเดิมยังอยู่');

    console.log('\n[รายการแต้ม]');
    await gotoPage('transactions');
    await b.waitFor(`document.querySelector('form[data-form=tx]') && document.querySelectorAll('.tbl tbody tr.row-link').length > 0`, 8000, 'ตารางรายการ');
    await b.eval(`(() => { const s = document.querySelector('form[data-form=tx] select[name=type]'); s.value = 'EARN'; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await b.waitFor(`document.querySelector('form[data-form=tx] select[name=type]').value === 'EARN' && !document.getElementById('view').classList.contains('is-loading')`, 8000, 'กรองยอดซื้อ');
    const types = await b.eval(`[...document.querySelectorAll('.tbl tbody tr td:nth-child(3)')].map(td => td.innerText)`);
    ok(types.length >= 4 && types.every(t => t === 'ยอดซื้อ'), 'เลือกประเภท "ยอดซื้อ" → เปลี่ยนทันที เหลือแต่ยอดซื้อ', types);
    await b.shot(path.join(OUT, 'a05-transactions.png'));

    console.log('\n[คูปอง]');
    await gotoPage('coupons');
    await b.waitFor(`document.querySelector('.status-tabs')`, 8000, 'หน้าคูปอง');
    ok(/ใช้แล้ว \(\d+\)/.test(await b.text('.status-tabs')), 'แท็บสถานะมีจำนวน');
    await b.click('[data-act=coupon-status][data-id=USED]');
    await b.waitFor(`document.querySelector('[data-act=coupon-status][data-id=USED]').classList.contains('active') && document.querySelectorAll('.tbl tbody tr.row-link').length >= 1`, 8000, 'คูปองที่ใช้แล้ว');
    ok(/แคชเชียร์|U_ADM_CASH/.test(await b.text('.tbl')), 'เห็นว่าพนักงานคนไหนสแกนคูปอง');
    await b.shot(path.join(OUT, 'a06-coupons.png'));

    console.log('\n[พนักงาน] อนุมัติจากหลังบ้าน');
    await gotoPage('staff');
    await b.waitFor(`document.querySelector('.invite')`, 8000, 'หน้าพนักงาน');
    ok(/liff\.line\.me\/2011913909-NcxFMTsN\/staff/.test(await b.text('.invite')), 'มีลิงก์ชวนพนักงานใหม่');
    ok(/รออนุมัติ/.test(await b.text('.adm-head')), 'หัวหน้าบอกจำนวนคนรออนุมัติ');
    await b.click(`[data-act=staff-edit][data-id=${NEW_STAFF}]`);
    await b.waitFor(`document.querySelector('.modal form[data-form=staff-edit]')`, 3000, 'ป๊อปอัปอนุมัติ');
    ok((await b.eval(`document.querySelector('.modal select[name=status]').value`)) === 'ACTIVE', 'กดอนุมัติ → สถานะตั้งเป็นใช้งานได้ให้แล้ว');
    await b.shot(path.join(OUT, 'a07-staff-approve.png'));
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`!document.querySelector('.modal') && !/รออนุมัติ/.test(document.querySelector('.adm-head').innerText)`, 8000, 'อนุมัติแล้ว');
    const me = await api('staffMe', NEW_STAFF);
    ok(me.staff.status === 'ACTIVE' && me.staff.role === 'CASHIER', 'พนักงานใหม่ใช้หน้าพนักงานได้ทันที', me.staff);
    ok(!(await b.eval(`!!document.querySelector('[data-act=staff-edit][data-id=U_ADM_OWNER]')`)), 'แถวของตัวเองไม่มีปุ่มแก้');
    await b.shot(path.join(OUT, 'a08-staff.png'), { full: true });

    console.log('\n[ของรางวัล] เพิ่ม → ลูกค้าเห็น → ปิด');
    const RW = 'รางวัลทดสอบ ' + STAMP;
    const DRIVE = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing';
    const rowOf = text => `[...document.querySelectorAll('.tbl tbody tr')].find(tr => tr.innerText.includes(${JSON.stringify(text)}))`;
    await gotoPage('rewards');
    await b.waitFor(`document.querySelector('[data-act=reward-edit][data-id=""]') && document.querySelector('.tbl')`, 8000, 'หน้าของรางวัล');
    ok(/R001/.test(await b.text('.tbl')), 'เห็นของรางวัลเดิมในชีต');
    await b.shot(path.join(OUT, 'a11-rewards.png'));
    await b.click('[data-act=reward-edit][data-id=""]');
    await b.waitFor(`document.querySelector('.modal form[data-form=reward]')`, 3000, 'ฟอร์มของรางวัล');
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    ok(/กรุณากรอกชื่อ/.test(await b.text('#toast')) && !!(await b.eval(`document.querySelector('.modal')`)), 'ไม่กรอกชื่อ → เตือน ป๊อปอัปไม่ปิด');
    await b.type('.modal input[name=name]', RW);
    await b.type('.modal textarea[name=description]', 'ทดสอบจากหลังบ้าน');
    await b.type('.modal input[name=points]', '30');
    await b.type('.modal input[name=quota]', '50');
    await b.type('.modal input[name=image]', DRIVE);
    ok(/thumbnail\?id=1AbC/.test(await b.eval(`document.querySelector('#reward-preview img')?.getAttribute('src') || ''`)), 'วางลิงก์ Drive → ตัวอย่างรูปใช้ลิงก์ที่แปลงแล้ว');
    await b.shot(path.join(OUT, 'a12-reward-form.png'));
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`!document.querySelector('.modal') && ${rowOf(RW)}`, 8000, 'ของรางวัลใหม่ในตาราง');
    let boot = await api('bootstrap', 'U_ADM_C1');
    ok(boot.rewards.some(x => x.name === RW && x.points === 30 && x.remaining === 50 && /thumbnail/.test(x.image)), 'ลูกค้าเห็นของรางวัลใหม่ทันที (30 แต้ม เหลือ 50)');
    const rwId = await b.eval(`${rowOf(RW)}.querySelector('[data-act=reward-edit]').dataset.id`);
    await b.click(`[data-act=reward-edit][data-id=${rwId}]`);
    await b.waitFor(`document.querySelector('.modal select[name=status]')`, 3000);
    ok((await b.eval(`document.querySelector('.modal input[name=name]').value`)) === RW, 'กดแก้ไข → ฟอร์มมีค่าเดิม');
    await b.eval(`document.querySelector('.modal select[name=status]').value = 'INACTIVE'`);
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`!document.querySelector('.modal') && /ปิดอยู่/.test(${rowOf(RW)}.innerText)`, 8000, 'ปิดของรางวัล');
    boot = await api('bootstrap', 'U_ADM_C1');
    ok(!boot.rewards.some(x => x.name === RW), 'ปิดแล้วลูกค้าไม่เห็น');

    console.log('\n[อัปโหลดรูป + ป๊อปอัปกำลังโหลด]');
    await b.click(`[data-act=reward-edit][data-id=${rwId}]`);
    await b.waitFor(`document.querySelector('.modal input[data-upload]')`, 3000, 'ปุ่มอัปโหลดรูป');
    await b.eval(`(() => { if (!window.__f) { window.__f = window.fetch; window.fetch = async (...a) => { if (window.__slow) await new Promise(r => setTimeout(r, window.__slow)); return window.__f(...a); }; } window.__slow = 1200; return true; })()`); // หน่วงคำขอ 1.2 วินาที ให้เห็นป๊อปอัปเหมือน Apps Script จริง
    // รูปใหญ่ 2400×1600 → ต้องถูกย่อเหลือด้านยาว 1200px ก่อนส่ง
    await b.eval(`(async () => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1600; const x = c.getContext('2d'); x.fillStyle = '#cc3333'; x.fillRect(0, 0, 2400, 1600); x.fillStyle = '#ffffff'; x.fillRect(600, 400, 1200, 800);
      const blob = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'big.png', { type: 'image/png' }));
      const inp = document.querySelector('.modal input[data-upload]'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await b.waitFor(`document.querySelector('#loading-pop.show')`, 4000, 'ป๊อปอัปกำลังโหลด');
    ok(await b.eval(`(() => { const c = getComputedStyle(document.querySelector('#loading-pop .spinner')); return c.width === '48px' && c.borderTopWidth === '5px'; })()`), 'วงหมุนในป๊อปอัปทรงเดียวกับหน้าโหลด (48px เส้นหนา 5px)');
    ok(/กำลัง(อัปโหลด|เตรียม)รูป/.test(await b.text('#loading-pop')), 'ระหว่างอัปโหลดมีป๊อปอัป "กำลังอัปโหลดรูป..." (' + (await b.text('#loading-pop')).trim() + ')');
    ok(await b.eval(`!!document.elementFromPoint(innerWidth / 2, innerHeight - 40).closest('#loading-pop')`), 'ระหว่างรอ กดปุ่มอื่นไม่ได้ (ป๊อปอัปบังทั้งจอ)');
    await b.shot(path.join(OUT, 'a16-uploading.png'));
    await b.waitFor(`document.querySelector('.modal input[name=image]').value.includes(${JSON.stringify(UPLOADED)}) && !document.querySelector('#loading-pop.active')`, 15000, 'ลิงก์รูปที่อัปโหลด');
    ok(true, 'อัปโหลดเสร็จ → ช่องรูปได้ลิงก์รูป' + (NEW_API ? ' (ที่เก็บรูปของระบบใหม่)' : ' Google Drive') + ' และป๊อปอัปหายไป');
    if (NEW_API) {
      const ups = await (await fetch(API + '/__uploads')).json();
      const up = ups[ups.length - 1];
      ok(up && up.mime === 'image/png' && up.size < 200000 && /^khamwan\/reward-\d{4}-\d{2}-\d{2}-[A-Z2-9]{6}\.png$/.test(up.path), 'เก็บเป็น PNG ที่ย่อแล้ว แยกโฟลเดอร์ตามร้าน ชื่อไฟล์สุ่ม (' + (up && up.size) + ' bytes)', up);
    } else {
      const drive = await (await fetch(API + '/__drive')).json();
      const upFile = drive.files[drive.files.length - 1];
      ok(upFile.mime === 'image/png' && upFile.sharing === 'ANYONE_WITH_LINK:VIEW' && upFile.size < 200000, 'เก็บใน Drive เป็น PNG ที่ย่อแล้ว แชร์แบบทุกคนที่มีลิงก์ (' + upFile.size + ' bytes)', upFile);
    }
    await b.eval(`window.__slow = 0`);

    // ขนาดรูปแนะนำ + กรอบตัวอย่างทรงเดียวกับหน้าลูกค้า + เตือนเมื่อทรงผิดมาก (ผู้ใช้ขอ 5 พ.ย. 2569)
    ok(/1200 × 800 px/.test(await b.text('.modal .img-size')), 'ของรางวัล: บอกขนาดแนะนำ 1200 × 800 px', await b.text('.modal .img-size'));
    ok(await b.eval(`(() => { const f = document.querySelector('.modal .img-frame-reward'); const r = f.getBoundingClientRect(); return Math.abs(r.width / r.height - 173 / 118) < 0.05; })()`), 'ของรางวัล: กรอบตัวอย่างทรงเดียวกับการ์ดหน้าลูกค้า');
    // ใส่รูปทดสอบลงกรอบตัวอย่างเอง (รูปจากลิงก์ Drive โหลดไม่ได้ในเครื่องทดสอบ) — แนวตั้ง 650×1000 ต้องเตือน / แนวนอน 1200×800 ไม่เตือน
    const fakeImg = (w, h) => `(() => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; const f = document.querySelector('.modal .img-frame'); const old = f.querySelector('img'); const i = document.createElement('img'); i.dataset.kind = old.dataset.kind; i.src = c.toDataURL(); old.replaceWith(i); return true; })()`;
    await b.eval(fakeImg(650, 1000));
    await b.waitFor(`!document.querySelector('.modal .img-warn').hidden`, 3000, 'เตือนรูปแนวตั้ง');
    ok(/แนวตั้ง \(650 × 1000 px\).*1200 × 800/.test(await b.text('.modal .img-warn')), 'รูปแนวตั้ง 650×1000 → เตือนว่าถูกตัดเยอะ + แนะนำขนาด', await b.text('.modal .img-warn'));
    await b.eval(fakeImg(1200, 800));
    await b.waitFor(`document.querySelector('.modal .img-warn').hidden`, 3000, 'รูปทรงถูก ไม่เตือน');
    ok(true, 'รูป 1200×800 → ไม่เตือน');
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`!document.querySelector('.modal')`, 8000, 'บันทึกรูป');
    const withImg = (await api('adminRewards', 'U_ADM_OWNER')).items.find(x => x.id === rwId);
    ok(withImg.image.includes(UPLOADED), 'บันทึกของรางวัลพร้อมรูปที่อัปโหลด');

    console.log('\n[โปรโมชัน]');
    const PR = 'โปรทดสอบ ' + STAMP;
    await gotoPage('promos');
    await b.waitFor(`document.querySelector('[data-act=promo-edit][data-id=""]') && document.querySelector('.tbl')`, 8000, 'หน้าโปรโมชัน');
    await b.click('[data-act=promo-edit][data-id=""]');
    await b.waitFor(`document.querySelector('.modal form[data-form=promo]')`, 3000);
    ok(/1200 × 500 px/.test(await b.text('.modal .img-size')) && /ด้านซ้ายมีข้อความ/.test(await b.text('.modal .img-size')), 'โปรโมชัน: บอกขนาดแนะนำ 1200 × 500 px + ด้านซ้ายมีข้อความทับ', await b.text('.modal .img-size'));
    await b.type('.modal input[name=image]', 'https://example.com/banner.jpg');
    ok(await b.eval(`(() => { const f = document.querySelector('.modal .img-frame-promo'); const r = f.getBoundingClientRect(); return Math.abs(r.width / r.height - 335 / 150) < 0.05 && getComputedStyle(f, '::after').backgroundImage.includes('gradient'); })()`), 'โปรโมชัน: กรอบตัวอย่างทรงแบนเนอร์ + เงาด้านซ้ายแบบหน้าลูกค้า');
    await b.shot(path.join(OUT, 'a26-promo-image-hint.png'));
    await b.type('.modal input[name=image]', '');
    await b.type('.modal input[name=title]', PR);
    await b.type('.modal input[name=tag]', 'ใหม่');
    await b.type('.modal input[name=link]', 'javascript:alert(1)');
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`/https/.test(document.getElementById('toast').innerText)`, 8000, 'เตือนลิงก์');
    ok(!!(await b.eval(`document.querySelector('.modal')`)), 'ลิงก์อันตราย → Apps Script ปฏิเสธ ป๊อปอัปยังอยู่ให้แก้');
    await b.type('.modal input[name=link]', 'https://line.me/R/ti/p/@khamwan');
    await b.type('.modal input[name=sort]', '0');
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`!document.querySelector('.modal') && ${rowOf(PR)}`, 8000, 'โปรโมชันใหม่ในตาราง');
    boot = await api('bootstrap', 'U_ADM_C1');
    ok(boot.promos.some(x => x.title === PR && x.tag === 'ใหม่'), 'ลูกค้าเห็นโปรโมชันใหม่');
    await b.shot(path.join(OUT, 'a13-promos.png'));

    console.log('\n[สมาชิก] ระงับ → เปิดใช้');
    await b.eval(`location.hash = '#member/${ids[1]}'`);
    await b.waitFor(`document.querySelector('[data-act=member-status]')`, 8000, 'หน้าสมาชิก');
    await b.click('[data-act=member-status]');
    await b.waitFor(`document.querySelector('.modal form[data-form=member-status]')`, 3000);
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    ok(/เหตุผล/.test(await b.text('#toast')), 'ระงับโดยไม่ใส่เหตุผล → เตือน');
    await b.type('.modal input[name=reason]', 'ทดสอบระงับ');
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`/ถูกระงับ/.test(document.querySelector('.member-head')?.innerText || '')`, 8000, 'สถานะถูกระงับ');
    ok(/ทดสอบระงับ/.test(await b.text('.kv')), 'หมายเหตุแสดงเหตุผลที่ระงับ');
    const blocked = await api('addPurchase', 'U_ADM_CASH', { memberId: ids[1], amount: 100, requestId: rid() });
    ok(!blocked.ok && blocked.code === 'MEMBER_BLOCKED', 'ระงับแล้ว พนักงานบันทึกแต้มไม่ได้', blocked);
    await b.shot(path.join(OUT, 'a14-member-blocked.png'), { full: true });
    await b.click('[data-act=member-status]');
    await b.waitFor(`document.querySelector('.modal form[data-form=member-status]')`, 3000);
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`/ใช้งานได้/.test(document.querySelector('.member-head')?.innerText || '')`, 8000, 'เปิดใช้อีกครั้ง');
    ok(true, 'เปิดใช้อีกครั้งได้');

    console.log('\n[ตั้งค่าร้าน]');
    await gotoPage('settings');
    await b.waitFor(`document.querySelector('form[data-form=settings]')`, 8000, 'หน้าตั้งค่า');
    ok(/LIFF ID/.test(await b.text('.kv')) && /\bKW\b/.test(await b.text('.kv')) && !(await b.eval(`!!document.querySelector('input[name=LIFF_ID]')`)), 'ค่าระบบ (LIFF ID, รหัสนำหน้า KW) แสดงแบบดูอย่างเดียว');
    await b.eval(`document.querySelector('form[data-form=settings]').requestSubmit()`);
    ok(/ยังไม่ได้เปลี่ยน/.test(await b.text('#toast')), 'ไม่ได้แก้อะไร → บอกว่ายังไม่เปลี่ยน');
    await b.type('form[data-form=settings] input[name=POINT_RATE_BAHT]', '10');
    await b.eval(`document.querySelector('form[data-form=settings]').requestSubmit()`);
    await b.waitFor(`document.querySelector('.modal [data-act=settings-confirm]')`, 3000, 'ยืนยันการตั้งค่า');
    ok(/20 → 10/.test(await b.text('.modal')), 'ป๊อปอัปยืนยันแสดงค่าเดิม → ค่าใหม่');
    await b.shot(path.join(OUT, 'a15-settings-confirm.png'));
    await b.click('.modal [data-act=settings-confirm]');
    await b.waitFor(`!document.querySelector('.modal')`, 8000, 'บันทึกการตั้งค่า');
    const st = await api('staffMe', 'U_ADM_CASH');
    ok(st.settings.pointRate === 10, 'หน้าพนักงานใช้อัตราใหม่ทันที (10 บาท/แต้ม)', st.settings);
    await api('adminSettingsSave', 'U_ADM_OWNER', { values: { POINT_RATE_BAHT: '20' } }); // คืนค่าเดิมให้ชุดทดสอบอื่น

    console.log('\n[หน้าตาร้าน] เปลี่ยนชื่อ สี คำเรียกแต้ม นโยบาย → หลังบ้านและลูกค้าเห็นทันที');
    await gotoPage('brand');
    ok(await b.eval(`!!document.querySelector('#brand-preview .pv')`), 'มีตัวอย่างหน้าจอลูกค้า');
    await b.type('form[data-form=brand] input[name=SHOP_NAME]', 'ร้านทดสอบสีใหม่');
    await b.eval(`(() => { const c = document.querySelector('[data-color=COLOR_PRIMARY]'); c.value = '#0f766e'; c.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    ok((await b.eval(`document.querySelector('form[data-form=brand] input[name=COLOR_PRIMARY]').value`)) === '#0F766E', 'เลือกสีจากตัวเลือกสี → ช่องรหัสสีเปลี่ยนตาม');
    await b.type('form[data-form=brand] input[name=TEXT_POINT_UNIT]', 'ดาว');
    await sleep(250);
    ok(/ร้านทดสอบสีใหม่/.test(await b.text('#brand-preview')) && /ดาว/.test(await b.text('#brand-preview')) && /15, 118, 110/.test(await b.eval(`getComputedStyle(document.querySelector('.pv-head')).backgroundColor`)), 'ตัวอย่างเปลี่ยนชื่อ สี และคำเรียกแต้มทันทีที่พิมพ์');
    await b.eval(`(() => { const t = document.querySelector('form[data-form=brand] input[name=COLOR_CARD]'); t.value = '#FFFFFF'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(250);
    ok(/26, 26, 26/.test(await b.eval(`getComputedStyle(document.querySelector('.pv-card')).color`)), 'บัตรสีขาว → ตัวอักษรบนบัตรเปลี่ยนเป็นสีเข้มให้อ่านออกเอง');
    await b.click('[data-act=color-reset][data-id=COLOR_CARD]');
    ok((await b.eval(`document.querySelector('form[data-form=brand] input[name=COLOR_CARD]').value`)) === '', 'กด "ค่าเดิม" → ล้างสีที่ตั้ง');
    await b.type('form[data-form=brand] textarea[name=PRIVACY_TEXT]', 'นโยบายทดสอบฉบับใหม่ ' + STAMP + '\nบรรทัดที่สอง');
    await b.shot(path.join(OUT, 'a17-brand.png'), { full: true });
    await b.eval(`document.querySelector('form[data-form=brand]').requestSubmit()`);
    await b.waitFor(`document.querySelector('.modal [data-act=brand-confirm]')`, 3000, 'ยืนยันแก้นโยบาย');
    ok(/ฉบับที่ \d+/.test(await b.text('.modal')), 'แก้นโยบาย → เตือนก่อนว่าจะเป็นฉบับใหม่');
    await b.click('.modal [data-act=brand-confirm]');
    await b.waitFor(`!document.querySelector('.modal') && /ร้านทดสอบสีใหม่/.test(document.querySelector('.adm-shop')?.innerText || '')`, 8000, 'บันทึกหน้าตาร้าน');
    ok(/15, 118, 110/.test(await b.eval(`getComputedStyle(document.querySelector('.adm-side')).backgroundColor`)), 'หลังบ้านเปลี่ยนชื่อและสีใหม่ทันที');
    boot = await api('bootstrap', 'U_ADM_C1', { withBrand: true });
    ok(boot.brand.name === 'ร้านทดสอบสีใหม่' && boot.brand.colors.primary === '#0F766E' && boot.brand.texts.pointUnit === 'ดาว' && boot.brand.privacyText.includes(STAMP), 'Apps Script ส่งหน้าตาใหม่ให้ลูกค้า', boot.brand);
    await b.eval(asUser('U_ADM_C1', 'ลูกค้า'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/khamwan`);
    // ระบบใหม่ (PDPA ขั้นที่ 2): แก้นโยบายแล้ว ลูกค้าเดิมต้องกดยอมรับฉบับใหม่ก่อนเห็นบัตร / ระบบเดิม (Apps Script) ไม่มีหน้านี้ → เห็นบัตรเลย
    await b.waitFor(`/ร้านทดสอบสีใหม่/.test(document.querySelector('.mc-shop')?.innerText || '') || !!document.querySelector('[data-act=policy-accept]')`, 10000, 'บัตรสมาชิก หรือหน้ายอมรับนโยบาย');
    if (await b.eval(`!!document.querySelector('[data-act=policy-accept]')`)) {
      ok(/ร้านปรับปรุงนโยบายความเป็นส่วนตัว/.test(await b.text()), 'ระบบใหม่: แก้นโยบาย → ลูกค้าเดิมเจอหน้ายอมรับนโยบายฉบับใหม่ก่อน');
      await b.click('[data-act=policy-accept]');
    }
    await b.waitFor(`/ร้านทดสอบสีใหม่/.test(document.querySelector('.mc-shop')?.innerText || '')`, 10000, 'บัตรสมาชิกชื่อร้านใหม่');
    ok((await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toUpperCase()`)) === '#0F766E' && /ดาว/.test(await b.text('.mc-points')), 'หน้าลูกค้าใช้ชื่อ สี และคำเรียกแต้มใหม่');
    await b.shot(path.join(OUT, 'a18-customer-brand.png'));
    // คืนค่าตั้งต้น (ไม่ให้กระทบส่วนอื่นของชุดทดสอบ)
    await api('adminBrandSave', 'U_ADM_OWNER', { values: { SHOP_NAME: '', COLOR_PRIMARY: '', TEXT_POINT_UNIT: '', PRIVACY_TEXT: '' } });
    await b.nav(`${WEB}/khamwan`);
    // ล้างข้อความนโยบาย = นโยบายฉบับใหม่อีกรอบ → ระบบใหม่ขึ้นหน้ายอมรับนโยบายก่อน (ระบบเดิมไม่มี)
    await b.waitFor(`/คำหวาน CUISINE/.test(document.querySelector('.mc-shop')?.innerText || '') || !!document.querySelector('[data-act=policy-accept]')`, 10000, 'บัตรสมาชิก หรือหน้ายอมรับนโยบาย');
    if (await b.eval(`!!document.querySelector('[data-act=policy-accept]')`)) await b.click('[data-act=policy-accept]');
    await b.waitFor(`/คำหวาน CUISINE/.test(document.querySelector('.mc-shop')?.innerText || '')`, 10000, 'กลับเป็นชื่อเดิม');
    ok((await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toUpperCase()`)) === '#1F1914', 'ล้างค่าในหลังบ้าน → กลับไปใช้ชื่อและสีในไฟล์ตั้งค่าร้าน');
    await b.eval(asUser('U_ADM_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/khamwan/admin#overview`);
    await b.waitFor(`document.querySelectorAll('.kpi').length === 8`, 10000, 'กลับหลังบ้าน');

    console.log('\n[ส่งออกไฟล์]');
    await gotoPage('members');
    await b.waitFor(`document.querySelector('[data-act=export]')`, 8000);
    await b.click('[data-act=export]');
    ok(/PDPA/.test(await b.text('.modal')), 'ก่อนดาวน์โหลดเตือนเรื่องข้อมูลส่วนตัว (PDPA)');
    await b.click('.modal [data-act=export-confirm]');
    let file = '';
    for (let i = 0; i < 40 && !file; i++) { await sleep(200); file = fs.readdirSync(DL).find(f => f.endsWith('.csv')) || ''; }
    const csv = file ? fs.readFileSync(path.join(DL, file), 'utf8') : '';
    ok(csv.startsWith('\uFEFFรหัสสมาชิก,ชื่อ,นามสกุล,เบอร์โทร'), 'ได้ไฟล์ CSV ภาษาไทย (มี BOM ให้ Excel อ่านถูก) ' + file);
    ok(/086-111-0001/.test(csv), 'เบอร์ในไฟล์มีขีด (Excel ไม่ตัด 0 ข้างหน้า)');
    ok(csv.includes("'=ลูกค้าหลังบ้าน,คนที่สาม") && !/,=ลูกค้า/.test(csv), "ชื่อที่ขึ้นต้นด้วย = ในไฟล์มี ' นำหน้า (เปิดใน Excel ไม่กลายเป็นสูตร)");

    console.log('\n[ผู้จัดการ] เห็นข้อมูลน้อยกว่าเจ้าของร้าน');
    await b.eval(asUser('U_ADM_MGR', 'ผู้จัดการ'));
    await b.nav('about:blank'); // ลิงก์เดิมต่างกันแค่ # เบราว์เซอร์จะไม่โหลดหน้าใหม่ → ออกไปหน้าว่างก่อน
    await b.nav(`${WEB}/khamwan/admin#members`);
    await b.waitFor(`document.querySelectorAll('.tbl tbody tr.row-link').length >= 3`, 10000, 'ตารางสมาชิก (ผู้จัดการ)');
    ok(/xxx-xxx-0001/.test(await b.text('.tbl')) && !/086-?111-?0001/.test(await b.text('.tbl')), 'ผู้จัดการเห็นเบอร์แค่ 4 ตัวท้าย');
    ok(!(await b.eval(`!!document.querySelector('[data-act=export]')`)), 'ผู้จัดการไม่มีปุ่มส่งออก');
    await b.nav(`${WEB}/khamwan/admin#staff`);
    await b.waitFor(`document.querySelector('.invite')`, 8000);
    ok(!(await b.eval(`!!document.querySelector('[data-act=staff-edit][data-id=U_ADM_OWNER]')`)), 'ผู้จัดการแก้เจ้าของร้านไม่ได้ (ไม่มีปุ่ม)');
    await gotoPage('settings');
    await b.waitFor(`document.querySelector('form[data-form=settings]')`, 8000, 'หน้าตั้งค่า (ผู้จัดการ)');
    ok((await b.eval(`document.querySelector('input[name=POINT_RATE_BAHT]').disabled && !document.querySelector('form[data-form=settings] button')`)), 'ผู้จัดการดูค่าตั้งร้านได้อย่างเดียว');
    await gotoPage('brand');
    ok(await b.eval(`document.querySelector('form[data-form=brand] input[name=SHOP_NAME]').disabled && !document.querySelector('form[data-form=brand] button[type=submit]') && !document.querySelector('form[data-form=brand] input[data-upload]')`), 'ผู้จัดการดูหน้าตาร้านได้อย่างเดียว (ไม่มีปุ่มบันทึก/อัปโหลด)');

    console.log('\n[มือถือ] หน้าจอแคบ');
    await b.eval(asUser('U_ADM_OWNER', 'เจ้าของร้าน'));
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await b.nav('about:blank');
    await b.nav(`${WEB}/khamwan/admin#overview`);
    await b.waitFor(`document.querySelectorAll('.kpi').length === 8`, 10000);
    const overflow = await b.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    ok(overflow <= 0, 'มือถือไม่มีเลื่อนซ้ายขวาทั้งหน้า', overflow);
    await b.waitFor(`(() => { const c = document.querySelector('.credit-foot'); const i = c && c.querySelector('img'); return !!c && c.offsetParent !== null && /Design by Go To Target/.test(c.innerText) && i.complete && i.naturalWidth > 0; })()`, 5000, 'เครดิตท้ายหน้ามือถือ');
    ok(!(await b.eval(`document.querySelector('.credit-side').offsetParent !== null`)), 'มือถือ: เครดิตย้ายไปท้ายเนื้อหา');
    await sleep(300);
    await b.send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(OUT, 'a09-mobile-overview.png'), Buffer.from(r.data, 'base64')));
    await b.nav(`${WEB}/khamwan/admin#members`);
    await b.waitFor(`document.querySelectorAll('.tbl tbody tr.row-link').length >= 3`, 10000);
    await sleep(300);
    await b.send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(OUT, 'a10-mobile-members.png'), Buffer.from(r.data, 'base64')));
    ok(true, 'ภาพมือถือ a09, a10');

    // รูปจากที่เก็บรูปจำลองของระบบใหม่ (storage.test ไม่มีจริง — ระบบบังคับลิงก์รูป https จึงใช้เซิร์ฟเวอร์ในเครื่องแทนไม่ได้) โหลดไม่ได้เป็นเรื่องปกติ
    const errors = b.logs.filter(l => /EXCEPTION|console\.error|log\.error/.test(l) && !/favicon/.test(l) && !(NEW_API && /storage\.test/.test(l)));
    ok(errors.length === 0, 'ไม่มี error ใน console', errors);

    console.log('\n[แต้มพิเศษ] เจ้าของร้านตั้งกติกา → พนักงานเห็นตัวอย่างแต้ม → ลูกค้าเห็นป้าย');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await b.eval(asUser('U_ADM_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/khamwan/admin#overview`);
    await b.waitFor(`document.querySelectorAll('.kpi').length === 8`, 10000);
    await gotoPage('rules');
    const RULE = 'แต้ม x2 ทดสอบ ' + STAMP;
    await b.click('[data-act=rule-edit][data-id=""]');
    await b.waitFor(`document.querySelector('.modal form[data-form=rule]')`, 3000, 'ฟอร์มกติกา');
    ok((await b.eval(`document.querySelectorAll('.modal input[name=days]:checked').length`)) === 0 && (await b.eval(`document.querySelector('.modal input[name=multiplier]:checked').value`)) === '2', 'เพิ่มกติกาใหม่: ค่าตั้งต้น ×2 และยังไม่เลือกวัน');
    await b.type('.modal input[name=name]', RULE);
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    ok(/เลือกวันที่มีผลอย่างน้อย 1 วัน/.test(await b.text('#toast')) && (await b.eval(`!!document.querySelector('.modal form[data-form=rule]')`)), 'ไม่เลือกวันแล้วกดบันทึก → เตือนให้เลือกวัน');
    // เลือกวันนี้ (เวลาไทย) ให้กติกามีผลทันที
    await b.eval(`(() => { const k = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()); const d = ['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(k + 'T00:00:00Z').getUTCDay()]; document.querySelector('.modal input[name=days][value=' + d + ']').checked = true; return true; })()`);
    await b.shot(path.join(OUT, 'a19-rule-edit.png'));
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`!document.querySelector('.modal') && document.getElementById('view').innerText.includes(${JSON.stringify(RULE)}) && !document.getElementById('view').classList.contains('is-loading')`, 8000, 'บันทึกกติกา');
    ok(/มีผลวันนี้/.test(await b.eval(`[...document.querySelectorAll('.tbl tbody tr')].find(tr => tr.innerText.includes(${JSON.stringify(RULE)})).innerText`)), 'กติกาใหม่ขึ้นในตาราง สถานะ "มีผลวันนี้"');
    await b.shot(path.join(OUT, 'a20-rules.png'));
    await b.eval(asUser('U_ADM_CASH', 'แคชเชียร์'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/khamwan/staff`);
    await b.waitFor(`document.querySelector('#lookup')`, 10000, 'หน้าพนักงาน');
    await b.type('#lookup input', ids[0]);
    await b.eval(`document.querySelector('#lookup').requestSubmit()`);
    await b.waitFor(`document.querySelector('#purchase')`, 8000, 'ฟอร์มยอดซื้อ');
    ok((await b.text('.today-promo')).includes(RULE), 'หน้าพนักงาน: แถบบอกว่าวันนี้มีแต้มพิเศษ');
    await b.type('#purchase input[name=amount]', '400');
    ok(/\+40/.test(await b.text('#preview')) && /ปกติ \+20/.test(await b.text('#preview')), 'พิมพ์ 400 → ตัวอย่าง +40 (ปกติ +20)', await b.text('#preview'));
    await b.eval(`document.querySelector('#purchase').requestSubmit()`);
    await b.waitFor(`document.querySelector('.flash.ok')`, 8000, 'บันทึกสำเร็จ');
    ok(/\+40/.test(await b.text('.flash')) && (await b.text('.flash')).includes(RULE), 'บันทึกแล้วได้ +40 จริง (Apps Script คิดเอง)', await b.text('.flash'));
    await b.shot(path.join(OUT, 'a21-staff-bonus.png'), { full: true });
    await b.eval(asUser('U_ADM_C1', 'ลูกค้า'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/khamwan#home`);
    await b.waitFor(`document.querySelector('.bonus-card')`, 10000, 'การ์ดแต้มพิเศษ');
    {
      const t = await b.text('.bonus-cards');
      ok(t.includes(RULE) && /วันนี้ได้\S* ×2/.test(t) && (await b.text('.bonus-mult')).trim() === '×2', 'หน้าลูกค้า: การ์ด "วันนี้ได้…×2" + กล่อง ×2 + ชื่อกติกา', t);
      const anim = await b.eval(`getComputedStyle(document.querySelector('.bonus-mult'), '::after').animationName`);
      ok(anim === 'bonus-shine', 'กล่อง ×2 มีแสงวิ่ง', anim);
    }
    await b.shot(path.join(OUT, 'a25-bonus-card.png'));

    console.log('\n[ของขวัญวันเกิด]');
    await b.eval(asUser('U_ADM_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/khamwan/admin#overview`);
    await b.waitFor(`document.querySelectorAll('.kpi').length === 8`, 10000);
    await gotoPage('rewards');
    const GIFT = 'ของขวัญวันเกิด ' + STAMP;
    await b.click('[data-act=reward-edit][data-id=""]');
    await b.waitFor(`document.querySelector('.modal form[data-form=reward]')`, 3000);
    await b.type('.modal input[name=name]', GIFT);
    const shown = sel => b.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && el.offsetParent !== null; })()`);
    ok(!(await shown('#bday-hint')) && !(await shown('#quota-hint')) && (await shown('#limit-field')), 'ประเภทแลกด้วยแต้ม: ไม่เห็นคำอธิบายวันเกิด / เห็นช่องจำกัดต่อคน');
    await b.eval(`(() => { const r = document.querySelector('.modal input[name=type][value=BIRTHDAY]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    ok(!(await b.eval(`document.getElementById('bday-hint').hidden`)) && (await b.eval(`document.querySelector('.modal input[name=points]').placeholder`)) === 'ว่าง = ฟรี', 'เลือก "ของขวัญวันเกิด" → แต้มไม่บังคับ (ว่าง = ฟรี) + อธิบายเงื่อนไข');
    ok((await shown('#bday-hint')) && (await shown('#quota-hint')) && !(await shown('#limit-field')), 'ของขวัญวันเกิด: เห็นคำอธิบาย + คำแนะนำช่องจำนวน / ซ่อนช่องจำกัดต่อคน');
    await b.shot(path.join(OUT, 'a24-birthday-form.png'));
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`!document.querySelector('.modal') && document.getElementById('view').innerText.includes(${JSON.stringify(GIFT)}) && !document.getElementById('view').classList.contains('is-loading')`, 8000, 'บันทึกของขวัญ');
    const giftRow = await b.eval(`[...document.querySelectorAll('.tbl tbody tr')].find(tr => tr.innerText.includes(${JSON.stringify(GIFT)})).innerText`);
    ok(/ของขวัญวันเกิด/.test(giftRow) && /ฟรี/.test(giftRow), 'ตารางของรางวัลแสดงป้าย 🎂 และ "ฟรี"', giftRow);
    const bkk = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    const BD = 'U_ADM_BD_' + STAMP;
    const reg = await api('register', BD, { firstName: 'วันเกิด', lastName: 'เดือนนี้', birthDate: `1992-${bkk.slice(5, 7)}-01`, phone: '06' + String(Date.now()).slice(-8), consentPrivacy: true });
    await fetch(API + '/__set', { method: 'POST', body: JSON.stringify({ sheet: 'Members', matchCol: 'Member_ID', matchVal: reg.member.memberId, col: 'Joined_At', daysAgo: 40 }) });
    await b.eval(asUser(BD, 'วันเกิด'));
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await b.nav('about:blank');
    await b.nav(`${WEB}/khamwan#home`);
    await b.waitFor(`document.querySelector('.bday [data-act=birthday-claim]')`, 10000, 'การ์ดวันเกิด');
    ok((await b.text('.bday')).includes('สุขสันต์วันเกิด คุณวันเกิด'), 'สมาชิกครบ 30 วัน + เดือนเกิด → การ์ด "สุขสันต์วันเกิด"');
    await b.shot(path.join(OUT, 'a22-birthday-card.png'));
    await b.click('.bday [data-act=birthday-claim]');
    await b.waitFor(`document.querySelector('.modal .qr-svg')`, 10000, 'คูปองของขวัญ');
    ok(true, 'กดรับของขวัญ → เปิด QR คูปองให้เลย');
    await b.click('.modal [data-act=close]');
    ok(/รับของขวัญวันเกิดแล้ว/.test(await b.text('.bday')), 'การ์ดเปลี่ยนเป็น "รับของขวัญวันเกิดแล้ว" + ปุ่มแสดงคูปอง');
    await b.shot(path.join(OUT, 'a23-birthday-claimed.png'));

    console.log('\n[สมาชิก] กรองเกิดเดือนนี้ (เจ้าของร้าน)');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await b.eval(asUser('U_ADM_OWNER', 'เจ้าของร้าน'));
    await b.nav('about:blank');
    await b.nav(`${WEB}/khamwan/admin#members`);
    await b.waitFor(`document.querySelector('form[data-form=members] select[name=birth]')`, 10000);
    await b.eval(`(() => { const s = document.querySelector('form[data-form=members] select[name=birth]'); s.value = 'this'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await b.waitFor(`/ตามที่ค้นหา/.test(document.querySelector('.adm-head').innerText) && !document.getElementById('view').classList.contains('is-loading')`, 8000);
    ok(/วันเกิด เดือนนี้/.test(await b.text('.tbl')), 'เลือก "เกิดเดือนนี้" → เห็นสมาชิกที่เกิดเดือนนี้');
    // ปิดกติกาและของขวัญที่สร้าง ไม่ให้กระทบการรันรอบถัดไป
    for (const x of (await api('adminRules', 'U_ADM_OWNER')).items) await api('adminRuleSave', 'U_ADM_OWNER', { rule: { ...x, status: 'INACTIVE' }, requestId: rid() });
  } catch (e) {
    fail++;
    console.log('  ✗ หยุดกลางทาง: ' + e.message);
    try { await b.shot(path.join(OUT, 'zz-admin-error.png')); console.log((await b.text()).slice(0, 800)); } catch (x) { /* ข้าม */ }
    console.log(b.logs.slice(-20).join('\n'));
  } finally {
    await b.close();
    console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
