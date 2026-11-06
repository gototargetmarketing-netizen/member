// ตารางคำสั่งของตัวกลาง + ขั้นตอนที่ทุกคำสั่งผ่าน: อ่านคำขอ → หาร้าน → ตรวจ LINE → ทำงาน → ตอบ
// รูปแบบคำขอ/คำตอบเหมือน doPost ใน code.gs: { action, idToken, shop, ... } → { ok: true, ... } / { ok: false, error, code }
// ต่างจาก Apps Script ข้อเดียว: ต้องบอกร้าน (shop) มาด้วย เพราะตัวกลางตัวเดียวรับทุกร้าน (Apps Script แยกตัวต่อร้าน)
//
// ทุกอย่างที่ต่อโลกภายนอก (ฐานข้อมูล / LINE) รับมาทาง deps → ชุดทดสอบใส่ตัวจำลองแทนได้
const { userError } = require('./errors');
const { InvalidToken } = require('./line');
const { cleanLineName } = require('./util');
const { SHOP_SQL, publicBrand } = require('./shop');
const customer = require('./customer');
const staff = require('./staff');
const speed = require('./speed');

const API_VERSION = '0.3.0'; // 0.2 = คำสั่งของลูกค้า (ขั้น 3 รอบ 1) / 0.3 = พนักงาน (รอบ 2)
const { ALL_STAFF, MANAGERS } = staff;
const SHOP_ID = /^[a-z0-9][a-z0-9-]{1,29}$/; // ตรงกับเงื่อนไขในตาราง shops
const SHOP_TTL_MS = 60 * 1000;               // ค่าร้านจำไว้ 1 นาที (แก้ค่าร้านแล้วมีผลภายใน 1 นาที)

// shop: ต้องบอกร้าน / auth: ต้องมีรหัส LINE ที่ตรวจผ่าน / roles: บทบาทพนักงานที่ใช้ได้ (ไม่มี = ลูกค้าทั่วไป)
// ตรวจบทบาทที่นี่ทุกคำสั่ง อย่าเชื่อการซ่อนปุ่มในหน้าเว็บ
const ACTIONS = {
  // ตัวกลางยังทำงานไหม (ไม่แตะฐานข้อมูล ไม่ต้องเข้าสู่ระบบ) — ใช้วัดเวลาเดินทางเปล่าๆ
  ping: { shop: false, auth: false, run: actPing },
  // ตรวจรหัส LINE อย่างเดียว — ไว้ลองการเข้าสู่ระบบบนลิงก์ทดสอบ
  whoami: { shop: true, auth: true, run: actWhoami },
  // วัดความเร็วขั้น 2 (ร้าน demo เท่านั้น) — ลบพร้อม speed.js และ speed.html ก่อนรวมเข้าเว็บจริง
  speedCard: { shop: true, auth: false, run: speed.card },

  // ลูกค้า (ขั้น 3 รอบ 1)
  bootstrap: { shop: true, auth: true, run: customer.bootstrap },
  register: { shop: true, auth: true, run: customer.register },
  redeem: { shop: true, auth: true, run: customer.redeem },
  claimBirthday: { shop: true, auth: true, run: customer.claimBirthday },
  updateProfile: { shop: true, auth: true, run: customer.updateProfile },

  // พนักงาน (ขั้น 3 รอบ 2) — staffMe ไม่ระบุบทบาท: คนที่ยังไม่ได้รับสิทธิ์ต้องเปิดได้ เพื่อส่งคำขอสิทธิ์
  staffMe: { shop: true, auth: true, run: staff.staffMe },
  staffLookup: { shop: true, auth: true, roles: ALL_STAFF, run: staff.staffLookup },
  addPurchase: { shop: true, auth: true, roles: ALL_STAFF, run: staff.addPurchase },
  useCoupon: { shop: true, auth: true, roles: ALL_STAFF, run: staff.useCoupon },
  adjustPoints: { shop: true, auth: true, roles: MANAGERS, run: staff.adjustPoints },
  staffRecent: { shop: true, auth: true, roles: ALL_STAFF, run: staff.staffRecent }
};

const ms = (t0) => Math.round((performance.now() - t0) * 10) / 10;

function actPing(body, ctx) {
  return { service: 'LINE CRM', version: API_VERSION, region: ctx.region, cold: ctx.cold, ms: ms(ctx.t0) };
}

function actWhoami(body, ctx) {
  return { userId: ctx.user.userId, name: ctx.user.name, via: ctx.via, region: ctx.region, ms: ms(ctx.t0) };
}

// deps: { db(): {query, tx}, verifier: {verify}, allowTestTokens, region }
function createApp(deps) {
  const shops = new Map();
  let served = 0;

  async function loadShop(id) {
    const shopId = String(id || '');
    if (!SHOP_ID.test(shopId)) throw userError('ไม่พบร้านนี้', 'NO_SHOP');
    let shop;
    const hit = shops.get(shopId);
    if (hit && hit.until > Date.now()) {
      shop = hit.shop;
    } else {
      const r = await deps.db().query(SHOP_SQL, [shopId]);
      shop = r.rows[0];
      if (!shop) throw userError('ไม่พบร้านนี้', 'NO_SHOP');
      // ชุดทดสอบตั้ง shopTtlMs = 0 (แก้ค่าร้านแล้วเห็นผลทันที)
      shops.set(shopId, { shop, until: Date.now() + (deps.shopTtlMs != null ? deps.shopTtlMs : SHOP_TTL_MS) });
    }
    if (shop.status !== 'ACTIVE') throw userError('ร้านนี้ปิดใช้งานระบบสะสมแต้มแล้ว', 'SHOP_INACTIVE');
    return shop;
  }

  async function requireUser(idToken, shop) {
    const token = String(idToken || '');
    if (!token) throw userError('กรุณาเปิดผ่าน LINE', 'NO_TOKEN');

    // รหัสทดสอบ "TEST:<id>:<ชื่อ>" ใช้ได้เฉพาะเครื่องเราเอง (เปิดด้วย CRM_TEST_TOKENS=on และไม่ใช่เว็บจริง)
    if (token.indexOf('TEST:') === 0) {
      if (!deps.allowTestTokens) throw userError('ระบบนี้ไม่ได้เปิดโหมดทดสอบ', 'TEST_DISABLED');
      const parts = token.split(':');
      const userId = String(parts[1] || '');
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(userId)) throw userError('รหัสผู้ทดสอบไม่ถูกต้อง', 'TEST_DISABLED');
      return { user: { userId, name: cleanLineName(parts.slice(2).join(':')) || 'ผู้ทดสอบ', picture: '' }, via: 'test' };
    }

    // รหัส channel ของร้าน = ตัวเลขหน้า "-" ใน LIFF ID (เหมือน Apps Script)
    const channelId = String(shop.liff_id || '').split('-')[0];
    if (!/^\d+$/.test(channelId)) {
      console.error('ร้าน ' + shop.id + ' ยังไม่ได้ใส่ liff_id ในตาราง shops');
      throw userError('ระบบของร้านยังตั้งค่าไม่ครบ กรุณาติดต่อผู้ดูแลระบบ', 'NO_LIFF');
    }
    try {
      return await deps.verifier.verify(token, channelId);
    } catch (e) {
      if (e instanceof InvalidToken) {
        console.warn('รหัส LINE ไม่ผ่าน: ' + e.message);
        throw userError('การเข้าสู่ระบบ LINE หมดอายุ กรุณาปิดแล้วเปิดใหม่', 'TOKEN_INVALID');
      }
      throw e; // ติดต่อ LINE ไม่ได้ = ระบบขัดข้อง (ไม่ใช่รหัสเสีย → หน้าเว็บจะไม่พาเข้าสู่ระบบใหม่วนไปมา)
    }
  }

  async function handle(raw) {
    const t0 = performance.now();
    const cold = served++ === 0; // คำขอแรกของเครื่องนี้ (เครื่องเพิ่งเปิด → ช้ากว่าปกติ)
    let body;
    try {
      body = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not object');
    } catch (e) {
      return { ok: false, error: 'คำขอไม่ถูกต้อง', code: 'BAD_REQUEST' };
    }

    try {
      const action = String(body.action || '');
      const def = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
      if (!def) throw userError('ไม่รู้จักคำสั่งนี้', 'UNKNOWN_ACTION');

      // now: เวลาเดียวกันทั้งคำสั่ง (ชุดทดสอบใส่นาฬิกาปลอมได้)
      const ctx = { deps, cold, t0, region: deps.region || 'local', now: new Date(deps.now ? deps.now() : Date.now()) };
      if (def.shop) {
        ctx.shop = await loadShop(body.shop);
        ctx.db = deps.db();
      }
      if (def.auth) {
        const r = await requireUser(body.idToken, ctx.shop);
        ctx.user = r.user;
        ctx.via = r.via;
      }
      if (def.roles) ctx.staff = await staff.requireStaff(ctx, def.roles);

      const result = (await def.run(body, ctx)) || {};
      const out = { ok: true };
      if (deps.allowTestTokens) out.testMode = true; // หน้าเว็บขึ้นแถบ "โหมดทดสอบ" (เหมือน Apps Script ที่เปิดโหมดทดสอบ)
      // หลังบ้านเปิดครั้งแรก: ส่งข้อมูลผู้ใช้ + รายชื่อสาขามาพร้อมข้อมูลหน้าเลย ไม่ต้องเรียก 2 รอบ
      if (body.withMe === true && ctx.staff) {
        out.me = { userId: ctx.user.userId, name: ctx.staff.name, role: ctx.staff.role };
        out.branches = await staff.branchList(ctx.db, ctx.shop.id);
      }
      // หน้าตาร้านล่าสุด ส่งไปพร้อมคำสั่งแรกของทุกหน้า — ค่าร้านอ่านมาแล้วตอนหาร้าน จึงไม่เพิ่มเวลา
      if (body.withBrand === true && ctx.shop) out.brand = publicBrand(ctx.shop);
      Object.keys(result).forEach(k => { out[k] = result[k]; });
      return out;
    } catch (err) {
      // ข้อความที่ตั้งใจบอกผู้ใช้ → ส่งกลับตามนั้น / ข้อผิดพลาดอื่น → ไม่ส่งรายละเอียดภายในออกไป (จดลง log ของ Vercel แทน)
      const known = err && err.userMessage;
      if (!known) console.error(err && err.stack ? err.stack : err);
      const out = {
        ok: false,
        error: known ? err.userMessage : 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
        code: known ? (err.code || 'INVALID') : 'ERROR'
      };
      if (!known && deps.allowTestTokens) out.debug = String(err && err.message ? err.message : err); // ดูสาเหตุได้เฉพาะตอนทดสอบในเครื่อง
      return out;
    }
  }

  return { handle };
}

module.exports = { createApp, API_VERSION, ACTIONS };
