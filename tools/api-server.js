// เซิร์ฟเวอร์ทดสอบในเครื่อง: ทำตัวเหมือน Vercel (ไฟล์หน้าเว็บ + ตัวกลาง /api) แต่ใช้ฐานข้อมูลจำลอง (PGlite)
// ไม่ต้องมีบัญชี Vercel / Supabase และไม่แตะข้อมูลจริง
//
// รัน: node tools/api-server.js   (ติดตั้งครั้งแรก: cd tools/test && npm install)
// แล้วใช้กับเว็บทดสอบพอร์ต 8002: http://localhost:8002/demo?api=http://localhost:8105/api&user=U_DEMO_1&name=ทดสอบ
//   (U_DEMO_1 … U_DEMO_2000 = สมาชิกในข้อมูลทดลอง / รหัสอื่น = ยังไม่เป็นสมาชิก)
//
// โหมดเลียนแบบเซิร์ฟเวอร์เดิม (COMPAT=1): ใช้รันชุดทดสอบหน้าเว็บเดิม (e2e.js ฯลฯ) กับระบบใหม่โดยไม่ต้องแก้ชุดทดสอบ
//   COMPAT=1 PORT=8106 node tools/api-server.js   แล้ว   API=http://localhost:8106 node tools/test/e2e.js
//   - ร้าน khamwan / demo ตั้งต้นจากชีตจำลองชุดเดียวกับ gas-server (testSetup + KW + แต้มต้อนรับ 20)
//   - รับคำสั่งที่ "/" แบบเดียวกับ gas-server (หน่วง 150ms เหมือนกัน) และทางลัดของชุดทดสอบ:
//     /__admin (อนุมัติพนักงาน) /__set (แก้ช่อง) /__dump (ข้อมูลในรูปชีต) /__log (คำขอที่เข้ามา) /__uploads (รูปที่อัปโหลด)
//   - MOCK_LINE=1: LINE จำลองแบบเดียวกับ gas-server (รหัสผ่านเมื่อส่วนท้าย = valid และยังไม่หมดอายุ) ปิดรหัสทดสอบ
//
// พิเศษสำหรับทดสอบ (เปิดเฉพาะในเครื่องนี้ 127.0.0.1):
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

// ข้อมูลในรูปชีต (แถวแรก = หัวตาราง เรียงเก่า → ใหม่) ให้ชุดทดสอบที่อ่าน /__dump ของ gas-server ใช้ต่อได้
const DUMP = {
  Members: ['select id as "Member_ID", coalesce(line_user_id, \'\') as "LINE_User_ID", name as "Name", phone as "Phone", coalesce(to_char(birth_date, \'YYYY-MM-DD\'), \'\') as "Birth_Date", points as "Points", total_spend::float8 as "Total_Spend", visit_count as "Visit_Count", joined_at as "Joined_At", status as "Status", joined_branch as "Joined_Branch" from members order by joined_at, id'],
  Transactions: ['select id as "Tx_ID", created_at as "Date", member_id as "Member_ID", type as "Type", amount::float8 as "Amount", points as "Points", balance_after as "Balance_After", detail as "Detail", staff as "Staff", coalesce(request_id, \'\') as "Request_ID", ref as "Ref", branch as "Branch" from transactions order by created_at, id'],
  Coupons: ['select code as "Coupon_Code", member_id as "Member_ID", reward_id as "Reward_ID", name as "Name", status as "Status", used_by as "Used_By", used_branch as "Used_Branch" from coupons order by issued_at, code'],
  Staff: ['select line_user_id as "LINE_User_ID", name as "Name", role as "Role", status as "Status", coalesce(array_to_string(branches, \',\'), \'\') as "Branches" from staff order by requested_at']
};
async function dumpSheets(db) {
  const out = {};
  for (const [name, [sql]] of Object.entries(DUMP)) {
    const r = await db.query(sql);
    const head = r.fields ? r.fields.map((f) => f.name) : Object.keys(r.rows[0] || {});
    out[name] = [head].concat(r.rows.map((row) => head.map((h) => row[h])));
  }
  return out;
}

// LINE จำลองแบบเดียวกับ gas-server (MOCK_LINE=1)
function mockVerifier() {
  const { InvalidToken } = require(path.join(ROOT, 'api', '_lib', 'line.js'));
  const { cleanLineName } = require(path.join(ROOT, 'api', '_lib', 'util.js'));
  return {
    async verify(token, channelId) {
      const parts = String(token || '').split('.');
      let p = {};
      try { p = JSON.parse(Buffer.from((parts[1] || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { /* รหัสเสีย */ }
      if (parts[2] === 'valid' && p.exp * 1000 > Date.now() && channelId === '1234567890') {
        return { user: { userId: String(p.sub), name: cleanLineName(p.name), picture: '' }, via: 'mock' };
      }
      throw new InvalidToken('LINE จำลองปฏิเสธ');
    }
  };
}

// ที่เก็บรูปจำลอง (จำในหน่วยความจำ) — ลิงก์หน้าตาเดียวกับ Supabase Storage
function fakeStorage(list) {
  return { async upload(p, bytes, mime) { list.push({ path: p, mime, size: bytes.length }); return 'https://storage.test/storage/v1/object/public/images/' + p; } };
}

async function readJson(req) {
  let body = '';
  for await (const c of req) body += c;
  return JSON.parse(body || '{}');
}

(async () => {
  const MOCK_LINE = COMPAT && process.env.MOCK_LINE === '1';
  const db = COMPAT ? await compatDb() : await createTestDb();
  if (MOCK_LINE) await db.query(`update shops set liff_id = '1234567890-MockLiff'`);
  const uploads = [];
  const log = [];
  const app = createApp({
    db: () => db, verifier: MOCK_LINE ? mockVerifier() : createVerifier(), storage: () => fakeStorage(uploads),
    allowTestTokens: !MOCK_LINE, region: 'local'
  });
  // จดทุกคำขอ (ให้ชุดทดสอบตรวจว่าหน้าเว็บส่งอะไรมา) + หน่วงเหมือน gas-server ในโหมดเลียนแบบ
  const logged = {
    async handle(raw) {
      let sent = {};
      try { sent = typeof raw === 'string' ? JSON.parse(raw) : raw || {}; } catch (e) { /* ข้าม */ }
      if (COMPAT) await new Promise((r) => setTimeout(r, 150));
      // gas-server มีร้านเดียว ชุดทดสอบเดิมบางชุดจึงเรียกโดยไม่บอกร้าน → ถือเป็น khamwan
      if (COMPAT && sent && typeof sent === 'object' && !Array.isArray(sent) && !sent.shop) raw = Object.assign({}, sent, { shop: 'khamwan' });
      const out = await app.handle(raw);
      log.push({ action: sent.action, hasToken: !!sent.idToken, ok: out.ok, code: out.code || '' });
      return out;
    }
  };
  const api = createHandler(logged);
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
        const had = (await db.query('select name from staff where line_user_id = $1 limit 1', [op.userId])).rows[0];
        if (!had) return json(res, { ok: false });
        // gas-server มีชีตเดียวใช้ร่วมทุกร้าน → พนักงานคนนี้เป็นพนักงานของทุกร้านด้วย (ระบบจริงแยกตามร้าน)
        await db.query(`insert into staff (shop_id, line_user_id, name, role, status) select id, $1, $2, $4, $3 from shops
                        on conflict (shop_id, line_user_id) do update set status = excluded.status, role = excluded.role`,
          [op.userId, had.name, op.status || 'ACTIVE', op.role || 'CASHIER']);
        return json(res, { ok: true });
      }
      if (COMPAT && pathname === '/__set') {
        const op = await readJson(req);
        const m = SET_MAP[op.sheet];
        if (!m || !m.key[op.matchCol] || !m.cols[op.col]) return json(res, { ok: false, error: 'ยังไม่รองรับ ' + op.sheet + '.' + op.col }, 400);
        const val = op.daysAgo != null ? new Date(Date.now() - op.daysAgo * 86400000) : op.val;
        await db.query(`update ${m.table} set ${m.cols[op.col]} = $1 where ${m.key[op.matchCol]} = $2`, [val, op.matchVal]);
        return json(res, { ok: true });
      }
      if (COMPAT && pathname === '/__dump') return json(res, await dumpSheets(db));
      if (COMPAT && pathname === '/__log') return json(res, log);
      if (pathname === '/__uploads') return json(res, uploads);
    } catch (e) {
      return json(res, { ok: false, error: e.message }, 400);
    }
    if (COMPAT && pathname === '/' && req.method === 'GET') return json(res, { ok: true, service: 'LINE CRM (ระบบใหม่ จำลอง)' });
    serveStatic(req, res);
  }).listen(PORT, '127.0.0.1', () => console.log(COMPAT
    ? `ระบบใหม่ เลียนแบบ gas-server → http://localhost:${PORT}`
    : `ตัวกลางทดสอบ (ฐานข้อมูลจำลอง + ร้าน demo) → http://localhost:${PORT}/api\n` +
      `ลองหน้าเว็บ (เปิด python3 tools/dev-server.py 8002 ด้วย): http://localhost:8002/demo?api=http://localhost:${PORT}/api&user=U_DEMO_1&name=ทดสอบ`));
})();
