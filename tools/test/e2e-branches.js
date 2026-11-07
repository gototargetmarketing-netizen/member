// ทดสอบหลายสาขาใน Chrome: เพิ่มสาขา · QR สมัคร · ตั้งสาขาให้พนักงาน · หน้าพนักงานเลือกสาขา · ลูกค้าสมัครจาก QR · รายงานแยกสาขา
// ใช้ชีตจำลองแยกของตัวเอง (ร้านที่มีสาขาจะบังคับเลือกสาขา ถ้าใช้ชีตเดียวกับ e2e.js จะกระทบชุดทดสอบอื่น)
// ต้องเปิดก่อน: python3 tools/dev-server.py 8002  และ  PORT=8104 node tools/test/gas-server.js
const { launch, sleep } = require('./cdp');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const OUT = path.join(__dirname, 'shots');
const DL = path.join(os.tmpdir(), 'line-crm-e2e-branch-download');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const WEB = 'http://localhost:8002';
// API=... = รันกับระบบใหม่ (COMPAT=1 node tools/api-server.js) / ไม่ตั้ง = ระบบเดิมจำลอง (gas-server)
const API = process.env.API || 'http://localhost:8104';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); } };
const api = (action, user, data = {}) => fetch(API, { method: 'POST', body: JSON.stringify({ ...data, action, idToken: `TEST:${user}:${user}` }) }).then(r => r.json());
const adminOp = (op) => fetch(API + '/__admin', { method: 'POST', body: JSON.stringify(op) }).then(r => r.json());
const dump = () => fetch(API + '/__dump').then(r => r.json());
const rowsOf = (d, name) => { const [h, ...rows] = d[name]; return rows.filter(r => r.some(v => v !== '' && v != null)).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const rid = () => crypto.randomUUID();
const page = (p, user, name, extra = '') => `${WEB}/khamwan${p}?api=${encodeURIComponent(API)}&user=${user}&name=${encodeURIComponent(name)}${extra}`;

(async () => {
  // เจ้าของร้าน / ผู้จัดการ (ทุกสาขา) / แคชเชียร์ + ลูกค้า 1 คน
  for (const [id, role] of [['U_BR_OWNER', 'OWNER'], ['U_BR_MGR', 'ADMIN'], ['U_BR_CASH', 'CASHIER']]) {
    await api('staffMe', id);
    await adminOp({ userId: id, status: 'ACTIVE', role });
  }
  const reg = await api('register', 'U_BR_C1', { firstName: 'ลูกค้า', lastName: 'หลายสาขา', birthDate: '1991-04-04', phone: '0871234567', consentPrivacy: true });
  if (!reg.ok) throw new Error('สมัครสมาชิกทดสอบไม่สำเร็จ: ' + JSON.stringify(reg));
  const M = reg.member.memberId;

  const b = await launch({ port: 9337, profile: path.join(os.tmpdir(), 'line-crm-e2e-branch-chrome'), width: 1280, height: 860, dpr: 1, mobile: false });
  const settle = (sel) => b.waitFor(`document.querySelector(${JSON.stringify(sel)}) && !document.getElementById('view').classList.contains('is-loading')`, 10000, sel);
  try {
    await b.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

    console.log('\n[หลังบ้าน] ร้านยังไม่มีสาขา');
    await b.nav(page('/admin', 'U_BR_OWNER', 'เจ้าของร้าน') + '#overview');
    await b.waitFor(`document.querySelectorAll('.kpi').length === 8`, 10000, 'ภาพรวม');
    ok(!(await b.eval(`!!document.querySelector('.branch-select, .tbl.compare')`)), 'ยังไม่มีสาขา → ไม่มีช่องเลือกสาขา/ตารางเทียบสาขา');
    await b.click('.adm-nav a[data-page=branches]');
    await settle('.empty-branches');
    ok(/ร้านมีหลายสาขาใช่ไหม/.test(await b.text('.empty-branches')), 'เมนูสาขา: อธิบายสำหรับร้านที่ยังไม่มีสาขา');

    console.log('\n[หลังบ้าน] เพิ่มสาขา + QR สมัคร');
    for (const name of ['สาขาสยาม', 'สาขาอารีย์']) {
      await b.click('[data-act=branch-edit][data-id=""]');
      await b.waitFor(`document.querySelector('.modal form[data-form=branch]')`, 3000, 'ฟอร์มสาขา');
      await b.type('.modal input[name=name]', name);
      await b.eval(`document.querySelector('.modal form').requestSubmit()`);
      await b.waitFor(`!document.querySelector('.modal') && document.body.innerText.includes(${JSON.stringify(name)})`, 8000, 'เพิ่ม ' + name);
    }
    await settle('.tbl');
    ok((await b.eval(`document.querySelectorAll('.tbl tbody tr').length`)) === 2, 'เพิ่ม 2 สาขา → ขึ้นในตาราง');
    await b.click('[data-act=branch-qr][data-id=B001]');
    await b.waitFor(`document.querySelector('.modal .qr-svg')`, 8000, 'QR สาขา');
    ok(/liff\.line\.me\/2011913909-NcxFMTsN\?branch=B001/.test(await b.text('.modal .copy-row')), 'QR สมัครของสาขาสยาม = ลิงก์ LINE + ?branch=B001');
    await b.shot(path.join(OUT, 'b01-branch-qr.png'));
    await b.click('[data-act=branch-qr-save]');
    await b.waitFor(`/บันทึกรูป QR แล้ว/.test(document.getElementById('toast').innerText)`, 8000, 'บันทึกรูป');
    await sleep(800);
    const png = fs.readdirSync(DL).find(f => f.endsWith('.png'));
    ok(png && fs.statSync(path.join(DL, png)).size > 10000, 'บันทึก QR เป็นรูปสำหรับพิมพ์ได้ (' + png + ')');
    await b.click('.modal [data-act=close]');

    console.log('\n[หลังบ้าน] ตั้งสาขาให้แคชเชียร์');
    await b.click('.adm-nav a[data-page=staff]');
    await settle('.tbl');
    ok((await b.eval(`[...document.querySelectorAll('.tbl th')].some(th => th.innerText === 'สาขา')`)), 'ตารางพนักงานมีคอลัมน์สาขา');
    await b.eval(`[...document.querySelectorAll('.tbl tbody tr')].find(tr => tr.innerText.includes('U_BR_CASH')).querySelector('[data-act=staff-edit]').click()`);
    await b.waitFor(`document.querySelector('.modal .branch-field')`, 3000, 'ช่องเลือกสาขา');
    await b.eval(`(() => { const all = document.querySelector('.modal [data-branch-all]'); all.checked = false; all.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('.modal input[name=branch][value=B001]').checked = true; return true; })()`);
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`!document.querySelector('.modal')`, 8000, 'บันทึกพนักงาน');
    await settle('.tbl');
    const cashRow = await b.eval(`[...document.querySelectorAll('.tbl tbody tr')].find(tr => tr.innerText.includes('U_BR_CASH')).innerText`);
    ok(/สาขาสยาม/.test(cashRow) && !/อารีย์/.test(cashRow), 'แคชเชียร์อยู่สาขาสยามสาขาเดียว', cashRow);

    console.log('\n[หน้าพนักงาน] มือถือ');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await b.nav('about:blank');
    await b.nav(page('/staff', 'U_BR_CASH', 'น้องแคช'));
    await b.waitFor(`document.querySelector('#lookup')`, 10000, 'หน้าพนักงาน');
    ok(/สาขาสยาม/.test(await b.text('#branch-badge')) && await b.eval(`document.getElementById('branch-badge').disabled`), 'แคชเชียร์สาขาเดียว → เข้าหน้าหลักเลย ชื่อสาขาอยู่หัวหน้า (เปลี่ยนไม่ได้)');
    ok(/รายการล่าสุด · สาขาสยาม/.test(await b.text('#recent-title')), 'หัวข้อรายการล่าสุดบอกสาขา');
    await b.type('#lookup input', M);
    await b.eval(`document.querySelector('#lookup').requestSubmit()`);
    await b.waitFor(`document.querySelector('#purchase')`, 8000, 'ฟอร์มยอดซื้อ');
    await b.type('#purchase input[name=amount]', '420');
    await b.eval(`document.querySelector('#purchase').requestSubmit()`);
    await b.waitFor(`document.querySelector('.flash.ok')`, 8000, 'บันทึกสำเร็จ');
    let d = await dump();
    ok(rowsOf(d, 'Transactions').slice(-1)[0].Branch === 'B001', 'ยอดซื้อจากแคชเชียร์ → บันทึกเป็นสาขาสยาม');
    await b.shot(path.join(OUT, 'b02-staff-branch.png'));

    await b.nav('about:blank');
    await b.nav(page('/staff', 'U_BR_MGR', 'ผู้จัดการ'));
    await b.waitFor(`document.querySelector('.branch-page')`, 10000, 'หน้าเลือกสาขา');
    ok((await b.eval(`document.querySelectorAll('.branch-option').length`)) === 2, 'ผู้จัดการ (ทุกสาขา) → ให้เลือกสาขาก่อนเริ่มงาน');
    await b.shot(path.join(OUT, 'b03-staff-pick.png'));
    await b.click('[data-act=branch-set][data-id=B002]');
    await b.waitFor(`document.querySelector('#lookup')`, 5000, 'หน้าพนักงาน');
    ok(/สาขาอารีย์/.test(await b.text('#branch-badge')), 'เลือกสาขาอารีย์ → ชื่อสาขาอยู่หัวหน้า');
    await b.type('#lookup input', M);
    await b.eval(`document.querySelector('#lookup').requestSubmit()`);
    await b.waitFor(`document.querySelector('#purchase')`, 8000, 'ฟอร์มยอดซื้อ');
    await b.type('#purchase input[name=amount]', '990');
    await b.eval(`document.querySelector('#purchase').requestSubmit()`);
    await b.waitFor(`document.querySelector('.flash.ok')`, 8000, 'บันทึกสำเร็จ');
    d = await dump();
    ok(rowsOf(d, 'Transactions').slice(-1)[0].Branch === 'B002', 'ยอดซื้อจากผู้จัดการ → บันทึกเป็นสาขาอารีย์');
    await b.nav('about:blank');
    await b.nav(page('/staff', 'U_BR_MGR', 'ผู้จัดการ'));
    await b.waitFor(`document.querySelector('#lookup')`, 10000, 'หน้าพนักงาน');
    ok(/สาขาอารีย์/.test(await b.text('#branch-badge')), 'เปิดหน้าใหม่ → จำสาขาเดิม ไม่ต้องเลือกซ้ำ');
    await b.click('#branch-badge');
    await b.waitFor(`document.querySelector('.modal .branch-option')`, 3000, 'ป๊อปอัปเปลี่ยนสาขา');
    await b.click('.modal [data-act=branch-set][data-id=B001]');
    await b.waitFor(`/สาขาสยาม/.test(document.getElementById('branch-badge').innerText)`, 5000, 'เปลี่ยนสาขา');
    ok(true, 'กดชื่อสาขาที่หัวหน้า → เปลี่ยนสาขาได้');

    console.log('\n[ลูกค้า] สมัครจาก QR สาขาอารีย์');
    await b.nav('about:blank');
    await b.nav(page('', 'U_BR_NEW', 'ลูกค้าใหม่', '&branch=B002'));
    await b.waitFor(`document.querySelector('#reg')`, 10000, 'หน้าสมัคร');
    await b.type('#reg input[name=firstName]', 'ใหม่');
    await b.type('#reg input[name=lastName]', 'จากคิวอาร์');
    await b.eval(`(() => { const f = document.querySelector('#reg'); f.bdDay.value = '9'; f.bdMonth.value = '9'; f.bdYear.value = '2535'; f.phone.value = '0871112233'; f.consentPrivacy.checked = true; return true; })()`);
    await b.click('#reg button[type=submit]');
    await b.waitFor(`document.querySelector('.member-card')`, 10000, 'สมัครสำเร็จ');
    d = await dump();
    const newMember = rowsOf(d, 'Members').find(m => m.LINE_User_ID === 'U_BR_NEW');
    ok(newMember && newMember.Joined_Branch === 'B002', 'สมัครหลังสแกน QR สาขาอารีย์ → บันทึกสาขาที่สมัคร', newMember);
    ok(!(await b.eval(`localStorage.getItem('crm_join_branch:khamwan')`)), 'สมัครเสร็จ → ล้างสาขาที่จำไว้');

    console.log('\n[หลังบ้าน] รายงานแยกสาขา');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await b.nav('about:blank');
    await b.nav(page('/admin', 'U_BR_OWNER', 'เจ้าของร้าน') + '#overview');
    await b.waitFor(`document.querySelector('.tbl.compare')`, 10000, 'ตารางเทียบสาขา');
    const cmp = await b.text('.tbl.compare');
    ok(/สาขาสยาม[\s\S]*฿420/.test(cmp) && /สาขาอารีย์[\s\S]*฿990/.test(cmp), 'ภาพรวม: ตารางเทียบสาขาแสดงยอดแต่ละสาขา', cmp.slice(0, 200));
    await b.shot(path.join(OUT, 'b04-compare.png'), { full: true });
    await b.eval(`[...document.querySelectorAll('.tbl.compare tr.row-link')].find(tr => tr.innerText.includes('สาขาอารีย์')).querySelector('td:nth-child(2)').click()`);
    await b.waitFor(`document.querySelector('[data-branch-filter]').value === 'B002' && !document.querySelector('.tbl.compare') && !document.getElementById('view').classList.contains('is-loading')`, 8000, 'ดูเฉพาะสาขาอารีย์');
    const sales = await b.eval(`[...document.querySelectorAll('.kpi')].find(k => /ยอดซื้อรวม/.test(k.innerText)).querySelector('.kpi-value').innerText`);
    ok(sales === '฿990', 'กดแถวสาขาอารีย์ → ตัวเลขเฉพาะสาขานั้น (' + sales + ')');
    ok(/สมาชิกที่สมัครสาขานี้/.test(await b.text('.kpis')), 'การ์ดสมาชิกเปลี่ยนเป็น "สมาชิกที่สมัครสาขานี้"');
    await b.click('.adm-nav a[data-page=transactions]');
    await b.waitFor(`(document.querySelector('.adm-head h1')?.innerText || '') === 'รายการแต้ม' && !document.getElementById('view').classList.contains('is-loading')`, 10000, 'หน้ารายการแต้ม');
    const cells = await b.eval(`[...document.querySelectorAll('.tbl tbody tr')].map(tr => tr.lastElementChild.innerText)`);
    ok(cells.length >= 1 && cells.every(c => c === 'สาขาอารีย์'), 'สาขาที่เลือกติดไปหน้ารายการแต้มด้วย (เห็นเฉพาะสาขาอารีย์)', cells);
    await b.click('.adm-nav a[data-page=members]');
    await b.waitFor(`(document.querySelector('.adm-head h1')?.innerText || '') === 'สมาชิก' && !document.getElementById('view').classList.contains('is-loading')`, 10000, 'หน้าสมาชิก');
    ok(/ใหม่ จากคิวอาร์/.test(await b.text('.tbl')) && (await b.eval(`document.querySelectorAll('.tbl tbody tr.row-link').length`)) === 1, 'สมาชิก: เห็นเฉพาะคนที่สมัครสาขาอารีย์');
    await b.eval(`(() => { const s = document.querySelector('[data-branch-filter]'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await b.waitFor(`document.querySelectorAll('.tbl tbody tr.row-link').length === 2 && !document.getElementById('view').classList.contains('is-loading')`, 8000, 'ทุกสาขา');
    ok(true, 'เลือก "ทุกสาขา" → เห็นสมาชิกทั้งหมด');

    console.log('\n[มือถือ] หลังบ้านจอแคบ');
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await b.nav('about:blank');
    await b.nav(page('/admin', 'U_BR_OWNER', 'เจ้าของร้าน') + '#overview');
    await b.waitFor(`document.querySelector('.tbl.compare')`, 10000, 'ภาพรวมมือถือ');
    const overflow = await b.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    ok(overflow <= 0, 'มือถือไม่มีเลื่อนซ้ายขวาทั้งหน้า (มีช่องเลือกสาขา + ตารางเทียบสาขา)', overflow);
    await b.shot(path.join(OUT, 'b05-mobile-overview.png'));

    console.log('\n[แพ็กเกจ] เพดานจำนวนสาขา (คำหวานตั้งไว้ 6 สาขา)');
    for (const name of ['สาขาสาม', 'สาขาสี่', 'สาขาห้า', 'สาขาหก']) {
      const r = await api('adminBranchSave', 'U_BR_OWNER', { branch: { name }, requestId: rid() });
      if (!r.ok) throw new Error('เพิ่มสาขาทดสอบไม่สำเร็จ: ' + JSON.stringify(r));
    }
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await b.nav('about:blank');
    await b.nav(page('/admin', 'U_BR_OWNER', 'เจ้าของร้าน') + '#branches');
    await b.waitFor(`document.querySelectorAll('.tbl tbody tr').length === 6`, 10000, 'สาขาครบ 6');
    ok(/แพ็กเกจของร้านเปิดได้ 6 สาขา/.test(await b.text('.adm-head')), 'หน้าสาขาบอกจำนวนสาขาตามแพ็กเกจ');
    await b.click('[data-act=branch-edit][data-id=""]');
    await b.waitFor(`document.querySelector('.modal')`, 3000, 'ป๊อปอัป');
    ok(/สาขาครบตามแพ็กเกจแล้ว/.test(await b.text('.modal')) && !(await b.eval(`!!document.querySelector('.modal form[data-form=branch]')`)), 'เปิดครบ 6 สาขาแล้วกดเพิ่ม → แจ้งให้อัปเกรด (ไม่เปิดฟอร์ม)');
    await b.shot(path.join(OUT, 'b06-branch-limit.png'));
    await b.click('.modal [data-act=close]');
    // ปิดสาขาหนึ่ง → มีที่ว่าง เพิ่มสาขาใหม่ได้ / เปิดสาขาที่ปิดกลับมาเกินเพดานไม่ได้
    const closeOne = await api('adminBranchSave', 'U_BR_OWNER', { branch: { id: 'B006', name: 'สาขาหก', status: 'INACTIVE' }, requestId: rid() });
    await b.nav('about:blank');
    await b.nav(page('/admin', 'U_BR_OWNER', 'เจ้าของร้าน') + '#branches');
    await b.waitFor(`document.querySelectorAll('.tbl tbody tr').length === 6 && !document.getElementById('view').classList.contains('is-loading')`, 10000, 'หน้าสาขา');
    await b.click('[data-act=branch-edit][data-id=""]');
    await b.waitFor(`document.querySelector('.modal form[data-form=branch]')`, 3000, 'ฟอร์มสาขา');
    ok(closeOne.ok, 'ปิดสาขาหนึ่ง → กดเพิ่มสาขาใหม่ได้อีก (นับเฉพาะสาขาที่เปิดอยู่)');
    await b.type('.modal input[name=name]', 'สาขาเจ็ด');
    await b.eval(`document.querySelector('.modal form').requestSubmit()`);
    await b.waitFor(`!document.querySelector('.modal') && document.body.innerText.includes('สาขาเจ็ด')`, 8000, 'เพิ่มสาขาเจ็ด');
    await settle('.tbl');
    await b.click('[data-act=branch-edit][data-id=B006]');
    await b.waitFor(`document.querySelector('.modal form[data-form=branch]')`, 3000, 'แก้สาขาหก');
    await b.eval(`(() => { document.querySelector('.modal select[name=status]').value = 'ACTIVE'; document.querySelector('.modal form').requestSubmit(); return true; })()`);
    await b.waitFor(`/แพ็กเกจของร้านเปิดได้ 6 สาขา/.test(document.getElementById('toast').innerText)`, 3000, 'แจ้งเกินเพดาน');
    ok(true, 'เปิดสาขาที่ปิดไว้กลับมาตอนครบ 6 แล้ว → แจ้งเกินแพ็กเกจ');
    await b.click('.modal [data-act=close]');

    console.log('\n[แพ็กเกจ] ร้านแพ็กเกจพื้นฐาน (จำลอง demo: ไม่มีหลายสาขา ไม่มีส่งออก)');
    await b.setFeatures('demo', { tiers: false, branches: false });
    await b.nav('about:blank');
    await b.nav(`${WEB}/demo/admin?api=${encodeURIComponent(API)}&user=U_BR_OWNER&name=x#branches`);
    await b.waitFor(`document.querySelectorAll('.kpi').length === 8`, 10000, 'ภาพรวมร้าน demo');
    ok(!(await b.eval(`!!document.querySelector('.adm-nav a[data-page=branches]')`)), 'ไม่มีเมนูสาขาในหลังบ้าน');
    ok((await b.eval(`(document.querySelector('.adm-head h1') || {}).innerText`)) === 'ภาพรวม', 'เปิดลิงก์ #branches ตรงๆ → พาไปหน้าภาพรวมแทน');
    await b.click('.adm-nav a[data-page=members]');
    await settle('.tbl');
    ok(!(await b.eval(`!!document.querySelector('[data-act=export]')`)), 'แพ็กเกจไม่มีส่งออก → เจ้าของร้านไม่เห็นปุ่มส่งออก Excel (หน้าสมาชิก)');
    await b.click('.adm-nav a[data-page=transactions]');
    await settle('.tbl');
    ok(!(await b.eval(`!!document.querySelector('[data-act=export]')`)), 'แพ็กเกจไม่มีส่งออก → ไม่มีปุ่มส่งออกในหน้ารายการแต้ม');
  } catch (e) {
    fail++;
    console.log('  ✗ หยุดกลางทาง: ' + e.message);
    await b.shot(path.join(OUT, 'b99-error.png')).catch(() => {});
  } finally {
    await b.close();
  }
  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})();
