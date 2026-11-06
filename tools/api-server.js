// เซิร์ฟเวอร์ทดสอบในเครื่อง: ทำตัวเหมือน Vercel (ไฟล์หน้าเว็บ + ตัวกลาง /api) แต่ใช้ฐานข้อมูลจำลอง (PGlite)
// ไม่ต้องมีบัญชี Vercel / Supabase และไม่แตะข้อมูลจริง
//
// รัน: node tools/api-server.js   (ติดตั้งครั้งแรก: cd tools/test && npm install)
// แล้วเปิด http://localhost:8105/speed.html
//
// พิเศษสำหรับทดสอบ: /__fake-old = แทนระบบเดิม (ตอบช้า 300ms) ให้หน้าวัดความเร็วไม่ต้องเรียกระบบจริงของร้าน
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8105;
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

(async () => {
  const db = await createTestDb();
  const app = createApp({ db: () => db, verifier: createVerifier(), allowTestTokens: true, region: 'local' });
  const api = createHandler(app);

  http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname === '/api' || pathname === '/api/') return api(req, res);
    if (pathname === '/__fake-old') {
      req.resume();
      setTimeout(() => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ ok: false, error: 'ไม่รู้จักคำสั่งนี้', code: 'UNKNOWN_ACTION' }));
      }, 300);
      return;
    }
    serveStatic(req, res);
  }).listen(PORT, () => console.log(`ตัวกลางทดสอบ (ฐานข้อมูลจำลอง + ร้าน demo) → http://localhost:${PORT}/speed.html`));
})();
