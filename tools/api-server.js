// เซิร์ฟเวอร์ทดสอบในเครื่อง: ทำตัวเหมือน Vercel (ไฟล์หน้าเว็บ + ตัวกลาง /api) แต่ใช้ฐานข้อมูลจำลอง (PGlite)
// ไม่ต้องมีบัญชี Vercel / Supabase และไม่แตะข้อมูลจริง
//
// รัน: node tools/api-server.js   (ติดตั้งครั้งแรก: cd tools/test && npm install)
// แล้วเปิด http://localhost:8105/speed.html
// หรือใช้กับเว็บทดสอบพอร์ต 8002: http://localhost:8002/demo?api=http://localhost:8105/api&user=U_DEMO_1&name=ทดสอบ
//   (U_DEMO_1 … U_DEMO_2000 = สมาชิกในข้อมูลทดลอง / รหัสอื่น = ยังไม่เป็นสมาชิก)
//
// โหมดเลียนแบบเซิร์ฟเวอร์เดิม (COMPAT=1): ใช้รันชุดทดสอบหน้าเว็บเดิม (e2e.js ฯลฯ) กับระบบใหม่โดยไม่ต้องแก้ชุดทดสอบ
//   COMPAT=1 PORT=8106 node tools/api-server.js   แล้ว   API=http://localhost:8106 node tools/test/e2e.js
//   - ร้าน khamwan / demo ตั้งต้นจากชีตจำลองชุดเดียวกับ gas-server (testSetup + KW + แต้มต้อนรับ 20)
//   - รับคำสั่งที่ "/" แบบเดียวกับ gas-server และทางลัดของชุดทดสอบ /__admin /__set
//
// พิเศษสำหรับทดสอบ (เปิดเฉพาะในเครื่องนี้ 127.0.0.1):
//   /__fake-old = แทนระบบเดิม (ตอบช้า 300ms) ให้หน้าวัดความเร็วไม่ต้องเรียกระบบจริงของร้าน
//   /__sql      = ชุดทดสอบแก้ข้อมูลจำลองตรงๆ (เช่น ย้อนวันสมัคร) — ฐานข้อมูลอยู่ในหน่วยความจำ ปิดแล้วหายหมด
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const COMPAT = process.env.COMPAT === '1';
const PORT = Number(process.env.PORT) || (COMPAT ? 8106 : 8105);
const { createTestDb } = require(path.join(__dirname, 'test', 'pglite-db.js'));
const { createApp } = require(path.join(ROOT, 'api', '_lib', 'router.js'));
const { createHandler } = require(path.join(ROOT, 'api', 'index.js'));
const { createVerifier } = require(path.join(ROOT, 'api', '_lib', 'line.js'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT + path.sep)) { res.statusCode = 403; return res.end(); }
  // ไฟล์ที่ .vercelignore ไม่ให้ขึ้นเว็บ → ทำตัวเหมือนเว็บจริง (ไม่พบ)
  const rel = path.relative(ROOT, file);
  if (/^(tools|db|backups|node_modules)(\/|$)|\.md$|^code\.gs$/.test(rel)) { res.statusCode = 404; return res.end('not found'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

// ข้อมูลตั้งต้นแบบเดียวกับ gas-server (ชีตจำลอง) → ย้ายเข้าตารางด้วยตัวย้ายข้อมูลชุดเดียวกับที่ใช้เทียบคู่
async function compatDb() {
  const { createWorld, run } = require(path.join(__dirname, 'test', 'gas-stub.js'));
  const { importShop } = require(path.join(__dirname, 'test', 'sheet-import.js'));
  const W = createWorld();
  run(W, 'testSetup');
  const set = (k, v) => { const s = W.ss.getSheetByName('Settings'); const h = s.data[0]; s.data.find((r) => r[0] === k)[h.indexOf('Value')] = v; };
  set('MEMBER_PREFIX', 'KW');
  set('WELCOME_POINTS', '20');
  const sheets = {};
  Object.keys(W.ss.sheets).forEach((n) => { sheets[n] = W.ss.sheets[n].data; });
  const db = await createTestDb({ withDemo: false });
  await importShop(db, 'khamwan', sheets);
  await importShop(db, 'demo', sheets);
  return db;
}

// ทางลัดของชุดทดสอบเดิม: แก้ "ช่องในชีต" → แปลงเป็นคอลัมน์ในตาราง (เฉพาะช่องที่ชุดทดสอบใช้)
const SET_MAP = {
  Members: { table: 'members', key: { Member_ID: 'id', LINE_User_ID: 'line_user_id' }, cols: { Joined_At: 'joined_at', Points: 'points', Status: 'status', Birth_Date: 'birth_date' } }
};

async function readJson(req) {
  let body = '';
  for await (const c of req) body += c;
  return JSON.parse(body || '{}');
}

(async () => {
  const db = COMPAT ? await compatDb() : await createTestDb();
  const app = createApp({ db: () => db, verifier: createVerifier(), allowTestTokens: true, region: 'local' });
  const api = createHandler(app);
  const json = (res, obj, status) => { res.statusCode = status || 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };

  http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    // เว็บทดสอบพอร์ต 8002 เรียกข้ามพอร์ตมา → อนุญาต (เฉพาะเครื่องทดสอบ / บน Vercel หน้าเว็บกับ /api อยู่โดเมนเดียวกัน ไม่ต้องใช้)
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (pathname === '/api' || pathname === '/api/') return api(req, res);
    if (COMPAT && pathname === '/' && req.method === 'POST') return api(req, res);
    try {
      if (pathname === '/__sql' && req.method === 'POST') {
        const { sql, params } = await readJson(req);
        return json(res, { ok: true, rows: (await db.query(sql, params || [])).rows });
      }
      if (COMPAT && pathname === '/__admin') { // อนุมัติ/เปลี่ยนบทบาทพนักงาน (เหมือน gas-server)
        const op = await readJson(req);
        const r = await db.query('update staff set status = $2, role = $3 where line_user_id = $1', [op.userId, op.status || 'ACTIVE', op.role || 'CASHIER']);
        return json(res, { ok: (r.affectedRows || r.rowCount || 0) > 0 });
      }
      if (COMPAT && pathname === '/__set') {
        const op = await readJson(req);
        const m = SET_MAP[op.sheet];
        if (!m || !m.key[op.matchCol] || !m.cols[op.col]) return json(res, { ok: false, error: 'ยังไม่รองรับ ' + op.sheet + '.' + op.col }, 400);
        const val = op.daysAgo != null ? new Date(Date.now() - op.daysAgo * 86400000) : op.val;
        await db.query(`update ${m.table} set ${m.cols[op.col]} = $1 where ${m.key[op.matchCol]} = $2`, [val, op.matchVal]);
        return json(res, { ok: true });
      }
    } catch (e) {
      return json(res, { ok: false, error: e.message }, 400);
    }
    if (pathname === '/__fake-old') {
      req.resume();
      setTimeout(() => json(res, { ok: false, error: 'ไม่รู้จักคำสั่งนี้', code: 'UNKNOWN_ACTION' }), 300);
      return;
    }
    if (COMPAT && pathname === '/' && req.method === 'GET') return json(res, { ok: true, service: 'LINE CRM (ระบบใหม่ จำลอง)' });
    serveStatic(req, res);
  }).listen(PORT, '127.0.0.1', () => console.log(COMPAT
    ? `ระบบใหม่ เลียนแบบ gas-server → http://localhost:${PORT}`
    : `ตัวกลางทดสอบ (ฐานข้อมูลจำลอง + ร้าน demo) → http://localhost:${PORT}/speed.html`));
})();
