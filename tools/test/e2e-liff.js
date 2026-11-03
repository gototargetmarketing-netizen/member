// ทดสอบการรับมือเมื่อรหัส LINE (ID token) หาย / หมดอายุ / ถูกปฏิเสธ — ใช้ LIFF จำลองแทน LINE จริง
// (เว็บในเครื่องปกติข้าม LIFF ไปเลย จึงต้องเปิดผ่านชื่อโดเมนปลอม crm.test ให้โค้ดเดินทางเดียวกับมือถือจริง)
//
// ต้องเปิดก่อน:
//   python3 tools/dev-server.py 8002
//   MOCK_LINE=1 PORT=8103 node tools/test/gas-server.js
// ถ้าจะเทียบกับโค้ดเก่า: OLD_WEB=http://crm-old.test:8004 (เว็บที่ใช้ไฟล์ app/ เวอร์ชันก่อนแก้)
const { launch, sleep } = require('./cdp');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
require('fs').mkdirSync(OUT, { recursive: true });

const WEB = 'http://crm.test:8002';
const OLD_WEB = process.env.OLD_WEB || '';
const API = 'http://localhost:8103';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); } };
const adminOp = (op) => fetch(API + '/__admin', { method: 'POST', body: JSON.stringify(op) }).then(r => r.json());
const serverLog = () => fetch(API + '/__log').then(r => r.json());

// LIFF จำลอง: ตั้งพฤติกรรมผ่าน localStorage "mockLiff"
//   dropAfter: n  → หลังเรียก getIDToken ครบ n ครั้ง คืนค่าว่าง (อาการที่เจอบน iPhone)
//   badAfter: n / badNext: true → คืนรหัสที่ LINE ไม่รับ
//   expOffset: วินาทีก่อนหมดอายุ (ติดลบ = หมดแล้ว) · stuck: true → เข้าสู่ระบบใหม่แล้วก็ยังเสีย
//   logout() แล้วเปิดหน้าใหม่ = LINE ออกรหัสใหม่ที่ใช้ได้ (เหมือนแอป LINE จริง)
const MOCK_LIFF = `(() => {
  const KEY = 'mockLiff';
  const cfg = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const save = c => localStorage.setItem(KEY, JSON.stringify(c));
  const b64 = o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  let calls = 0, body = '';
  const make = sig => body + '.' + sig;
  window.liff = {
    async init() {
      const c = cfg();
      c.inits = (c.inits || 0) + 1;
      if (c.loggedOut) {
        c.loggedOut = false;
        if (!c.stuck) { c.sig = 'valid'; c.expOffset = 3600; c.dropAfter = null; c.badAfter = null; c.badNext = false; }
      }
      save(c);
      body = b64({ alg: 'none' }) + '.' + b64({ sub: c.sub || 'Umock', name: c.name || 'ผู้ใช้จำลอง', exp: Math.floor(Date.now() / 1000) + (c.expOffset == null ? 3600 : c.expOffset) });
    },
    isLoggedIn: () => true,
    isInClient: () => true,
    getIDToken() {
      calls++;
      const c = cfg();
      if (c.dropAfter != null && calls > c.dropAfter) return null;
      if (c.badNext || (c.badAfter != null && calls > c.badAfter)) return make('bad');
      return make(c.sig || 'valid');
    },
    getDecodedIDToken() { const c = cfg(); return { name: c.name || 'ผู้ใช้จำลอง', picture: '' }; },
    logout() { const c = cfg(); c.loggedOut = true; c.logouts = (c.logouts || 0) + 1; save(c); },
    login() { location.reload(); }
  };
})();`;

(async () => {
  const b = await launch({
    profile: path.join(require('os').tmpdir(), 'line-crm-e2e-liff'),
    args: ['--host-resolver-rules=MAP crm.test 127.0.0.1, MAP crm-old.test 127.0.0.1']
  });
  // แทนไฟล์ LIFF จริงจาก LINE ด้วยตัวจำลอง
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*static.line-scdn.net/liff/*' }] });
  b.on('Fetch.requestPaused', (p) => {
    b.send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
      body: Buffer.from(MOCK_LIFF).toString('base64')
    });
  });

  const mock = () => b.eval(`JSON.parse(localStorage.getItem('mockLiff') || '{}')`);
  async function start(web, page, config) {
    await b.nav(`${web}/themes/base.css`); // หน้าที่ไม่มีโค้ดทำงาน: ตั้งค่าได้โดยไม่มีหน้าเก่าโหลดซ้อน
    await sleep(300);
    await b.eval(`sessionStorage.clear(); localStorage.setItem('crm_api_url:khamwan', '${API}'); localStorage.setItem('mockLiff', ${JSON.stringify(JSON.stringify(config))}); true`);
    await b.nav(`${web}/khamwan${page}`);
  }
  async function fillRegister(phone) {
    // หน้าเว็บรุ่นเก่า (สถานการณ์ 0) ไม่มีช่องชื่อ/นามสกุล/วันเกิดแบบใหม่ → กรอกเฉพาะช่องที่มี
    await b.eval(`(() => { const f = document.querySelector('#reg');
      if (f.firstName && !f.firstName.value) f.firstName.value = 'ทดสอบ';
      if (f.lastName && !f.lastName.value) f.lastName.value = 'ระบบ';
      if (f.bdDay && !f.bdDay.value) { f.bdDay.value = '1'; f.bdMonth.value = '1'; f.bdYear.value = '2530'; }
      return true; })()`);
    await b.type('#reg input[name=phone]', phone);
    await b.eval(`document.querySelector('#reg input[name=consentPrivacy]').checked = true`);
    await b.click('#reg button[type=submit]');
  }

  try {
    if (OLD_WEB) {
      console.log('\n[0] โค้ดเก่า + LINE ทำรหัสหายหลังเปิดหน้า (จำลองอาการบน iPhone)');
      await start(OLD_WEB, '', { sub: 'Uold', name: 'โค้ดเก่า', dropAfter: 1 });
      await b.waitFor(`document.querySelector('#reg')`, 10000, 'ฟอร์มสมัคร');
      await fillRegister('0811110000');
      await b.waitFor(`!document.querySelector('#reg-error').hidden`, 8000, 'ข้อความเตือน');
      const msg = await b.text('#reg-error');
      ok(msg === 'กรุณาเปิดผ่าน LINE', 'โค้ดเก่าขึ้น "กรุณาเปิดผ่าน LINE" เหมือนในภาพหน้าจอ = ตัวจำลองทำให้เกิดอาการเดียวกันได้', msg);
      await b.shot(path.join(OUT, 'liff-0-old-bug.png'));
    }

    console.log('\n[A] LINE ทำรหัสหายหลังเปิดหน้า → ใช้รหัสที่จำไว้ สมัครได้เลย ไม่ต้องโหลดใหม่');
    await start(WEB, '', { sub: 'Ua', name: 'ลูกค้า A', dropAfter: 1 });
    await b.waitFor(`document.querySelector('#reg')`, 10000, 'ฟอร์มสมัคร');
    await fillRegister('0811111111');
    await b.waitFor(`document.querySelector('.member-card')`, 10000, 'บัตรสมาชิก');
    const ma = await mock();
    ok(ma.inits === 1 && !ma.logouts, 'สมัครสำเร็จโดยไม่ต้องโหลดหน้าใหม่', ma);
    await b.shot(path.join(OUT, 'liff-A-registered.png'));

    console.log('\n[B] รหัสหมดอายุตั้งแต่เปิดหน้า → เข้าสู่ระบบใหม่เอง 1 ครั้ง แล้วใช้งานได้');
    await start(WEB, '', { sub: 'Ub', name: 'ลูกค้า B', expOffset: -30 });
    await b.waitFor(`document.querySelector('#reg')`, 12000, 'ฟอร์มสมัครหลังเข้าสู่ระบบใหม่');
    const mb = await mock();
    ok(mb.inits === 2 && mb.logouts === 1, 'ออกจากระบบ + เปิดหน้าใหม่ 1 ครั้ง ได้รหัสใหม่', mb);
    const lb = (await serverLog()).filter(x => x.action === 'bootstrap').slice(-1)[0];
    ok(lb && lb.ok, 'ไม่ส่งรหัสหมดอายุไปให้ Apps Script (ตรวจได้ตั้งแต่ในหน้าเว็บ)', lb);

    console.log('\n[C] LINE ไม่รับรหัสตอนกดสมัคร → เข้าสู่ระบบใหม่ ข้อมูลที่กรอกยังอยู่');
    await start(WEB, '', { sub: 'Uc', name: 'ลูกค้า C', badAfter: 2 });
    await b.waitFor(`document.querySelector('#reg')`, 10000, 'ฟอร์มสมัคร');
    await b.type('#reg input[name=firstName]', 'ซีซี');
    await b.eval(`(() => { const f = document.querySelector('#reg'); f.bdDay.value = '29'; f.bdMonth.value = '2'; f.bdYear.value = '2535'; return true; })()`);
    await b.eval(`document.querySelector('#reg input[name=consentMarketing]').checked = true`);
    await fillRegister('0822222222');
    await b.waitFor(`/เชื่อมต่อ LINE ใหม่แล้ว/.test(document.querySelector('#reg-error')?.innerText || '')`, 12000, 'ข้อความเชื่อมต่อใหม่');
    const form = await b.eval(`(() => { const f = document.querySelector('#reg'); return { first: f.firstName.value, last: f.lastName.value, phone: f.phone.value, birth: [f.bdDay.value, f.bdMonth.value, f.bdYear.value].join('/'), privacy: f.consentPrivacy.checked, mkt: f.consentMarketing.checked }; })()`);
    ok(form.first === 'ซีซี' && form.last === 'ระบบ' && form.phone === '0822222222' && form.birth === '29/2/2535' && form.privacy && form.mkt, 'ชื่อ นามสกุล เบอร์ วันเกิด และช่องที่ติ๊กไว้ เติมกลับครบ', form);
    ok((await b.eval(`sessionStorage.getItem('crm_register_draft')`)) === null, 'ลบข้อมูลที่เก็บชั่วคราวทิ้งแล้ว (มีเบอร์โทร)');
    await b.shot(path.join(OUT, 'liff-C-restored.png'));
    await b.click('#reg button[type=submit]');
    await b.waitFor(`document.querySelector('.member-card')`, 10000, 'บัตรสมาชิก');
    ok(true, 'กดสมัครอีกครั้ง สำเร็จ');

    console.log('\n[D] เข้าสู่ระบบใหม่แล้วยังเสีย → หยุดที่หน้าแจ้งเตือน ไม่โหลดวน');
    await start(WEB, '', { sub: 'Ud', name: 'ลูกค้า D', sig: 'bad', stuck: true });
    await b.waitFor(`/เปิดไม่สำเร็จ/.test(document.body.innerText)`, 12000, 'หน้าแจ้งเตือน');
    await sleep(2500);
    const md = await mock();
    ok(md.inits === 2 && md.logouts === 1, 'ลองเข้าสู่ระบบใหม่แค่ 1 ครั้ง แล้วหยุด', md);
    ok(/หมดอายุ/.test(await b.text()) && (await b.eval(`!!document.querySelector('[data-act=relogin]')`)), 'บอกว่าการเข้าสู่ระบบหมดอายุ + มีปุ่มเข้าสู่ระบบใหม่');
    await b.shot(path.join(OUT, 'liff-D-stuck.png'));

    console.log('\n[E] หน้าพนักงาน: รหัสเสียตอนกดบันทึกยอด → เชื่อมต่อใหม่ ค้นลูกค้าคนเดิม + เติมยอดให้ ไม่บันทึกซ้ำ');
    await start(WEB, '/staff', { sub: 'Ue', name: 'พนักงาน E' });
    await b.waitFor(`/ส่งคำขอสิทธิ์/.test(document.body.innerText)`, 10000, 'หน้ารออนุมัติ');
    await adminOp({ userId: 'Ue', status: 'ACTIVE', role: 'OWNER' });
    await b.click('[data-act=reload]');
    await b.waitFor(`document.querySelector('#lookup')`, 10000, 'หน้าพนักงาน');
    await b.type('#lookup input', '0822222222');
    await b.eval(`document.querySelector('#lookup').requestSubmit()`);
    await b.waitFor(`document.querySelector('#purchase')`, 8000, 'ฟอร์มยอดซื้อ');
    const memberId = await b.eval(`document.querySelector('.m-sub').innerText.split(' ')[0]`);
    await b.type('#purchase input[name=amount]', '500');
    await b.type('#purchase input[name=note]', 'บิล 123');
    await b.eval(`(() => { const c = JSON.parse(localStorage.getItem('mockLiff')); c.badNext = true; localStorage.setItem('mockLiff', JSON.stringify(c)); return true; })()`);
    await b.eval(`document.querySelector('#purchase').requestSubmit()`);
    await b.waitFor(`/เชื่อมต่อ LINE ใหม่แล้ว/.test(document.querySelector('.flash')?.innerText || '')`, 15000, 'เติมงานค้างกลับ');
    const sf = await b.eval(`(() => { const f = document.querySelector('#purchase'); return { amount: f.amount.value, note: f.note.value, preview: document.querySelector('#preview').innerText, member: document.querySelector('.m-sub').innerText }; })()`);
    ok(sf.amount === '500' && sf.note === 'บิล 123' && /\+25/.test(sf.preview) && sf.member.startsWith(memberId), 'ลูกค้าคนเดิม ยอด 500 และหมายเหตุ เติมกลับครบ', sf);
    await b.shot(path.join(OUT, 'liff-E-staff-restored.png'));
    await b.eval(`document.querySelector('#purchase').requestSubmit()`);
    await b.waitFor(`document.querySelector('.flash.ok')`, 8000, 'บันทึกสำเร็จ');
    const dump = await fetch(API + '/__dump').then(r => r.json());
    const h = dump.Transactions[0];
    const earn = dump.Transactions.slice(1).filter(r => r[h.indexOf('Member_ID')] === memberId && r[h.indexOf('Type')] === 'EARN');
    ok(earn.length === 1 && earn[0][h.indexOf('Points')] === 25, 'ชีตมีรายการยอดซื้อนี้ 1 รายการเท่านั้น (+25)', earn.length);

    const errors = b.logs.filter(l => /EXCEPTION|console\.error/.test(l));
    ok(errors.length === 0, 'ไม่มี error ใน console', errors);
  } catch (e) {
    fail++;
    console.log('  ✗ หยุดกลางทาง: ' + e.message);
    try { await b.shot(path.join(OUT, 'liff-zz-error.png')); console.log((await b.text()).slice(0, 400)); } catch (x) { /* ข้าม */ }
    console.log(b.logs.slice(-15).join('\n'));
  } finally {
    await b.close();
    console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
