// เซิร์ฟเวอร์จำลอง Apps Script: รัน code.gs จริงบนชีตจำลอง ให้หน้าเว็บในเครื่องเรียกได้
const http = require('http');
const { createWorld, call, run } = require('./gas-stub');

const W = createWorld();
run(W, 'testSetup');
run(W, 'enableTestMode');
// ตั้งค่าร้านให้เหมือนคำหวาน
function setSetting(key, value) {
  const s = W.ss.getSheetByName('Settings'); const h = s.data[0];
  const row = s.data.find((r, i) => i > 0 && r[0] === key); row[h.indexOf('Value')] = value;
  W.cache.delete('rows:Settings'); // แก้ชีตตรงๆ (ไม่ผ่าน onEdit) → ล้างค่าที่จำไว้
}
setSetting('MEMBER_PREFIX', 'KW');
setSetting('WELCOME_POINTS', '20');
// ไม่ตั้ง SHOP_NAME: ร้านทดสอบ 2 ร้าน (khamwan / demo) ใช้ชีตจำลองเดียวกัน ถ้าตั้งไว้ ชื่อจะทับกันทั้งสองร้าน

function admin(op) {
  const s = W.ss.getSheetByName('Staff'); const h = s.data[0];
  const row = s.data.find((r, i) => i > 0 && r[0] === op.userId);
  if (!row) return { ok: false };
  row[h.indexOf('Status')] = op.status || 'ACTIVE';
  row[h.indexOf('Role')] = op.role || 'CASHIER';
  return { ok: true };
}

// โหมด LINE จำลอง (MOCK_LINE=1): ปิดโหมดทดสอบ แล้วให้ "LINE" ตรวจรหัสแบบ JWT จำลอง
// รหัสผ่านเมื่อส่วนท้าย = valid และยังไม่หมดอายุ (ใช้กับ tools/test/e2e-liff.js)
const log = [];
if (process.env.MOCK_LINE) {
  run(W, 'disableTestMode');
  setSetting('LIFF_ID', '1234567890-MockLiff');
  W.fetchImpl = (url, opts) => {
    const parts = String(opts.payload.id_token || '').split('.');
    let p = {};
    try { p = JSON.parse(Buffer.from((parts[1] || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { /* รหัสเสีย */ }
    if (parts[2] === 'valid' && p.exp * 1000 > Date.now() && opts.payload.client_id === '1234567890') {
      return { code: 200, body: JSON.stringify({ sub: p.sub, name: p.name, exp: p.exp }) };
    }
    return { code: 400, body: '{"error":"invalid_request","error_description":"IdToken expired."}' };
  };
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    try {
      if (req.url.startsWith('/__admin')) return res.end(JSON.stringify(admin(JSON.parse(body))));
      if (req.url.startsWith('/__log')) return res.end(JSON.stringify(log));
      if (req.url.startsWith('/__drive')) return res.end(JSON.stringify(W.drive));
      if (req.url.startsWith('/__dump')) return res.end(JSON.stringify(Object.fromEntries(Object.entries(W.ss.sheets).map(([k, v]) => [k, v.data]))));
      if (req.method !== 'POST') return res.end(JSON.stringify({ ok: true, service: 'LINE CRM (จำลอง)' }));
      // หน่วงเวลาเล็กน้อยให้เหมือน Apps Script จริง
      setTimeout(() => {
        const out = call(W, body);
        let sent = {}; try { sent = JSON.parse(body); } catch (e) { /* ข้าม */ }
        log.push({ action: sent.action, hasToken: !!sent.idToken, ok: out.ok, code: out.code || '' });
        res.end(JSON.stringify(out));
      }, 150);
    } catch (e) {
      res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
  });
}).listen(Number(process.env.PORT || 8102), () => console.log('gas-server :' + (process.env.PORT || 8102)));
