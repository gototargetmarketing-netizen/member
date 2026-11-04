// คุยกับหลังบ้าน (Apps Script) ทางเดียว: POST แบบ text/plain → ไม่ต้องตั้งค่าการเรียกข้ามเว็บ (CORS)
// ทุกหน้าใช้ไฟล์นี้ วันหน้าถ้าย้ายหลังบ้านไปฐานข้อมูลอื่น แก้ที่ไฟล์นี้ที่เดียว
//
// ทดสอบ: ตั้ง localStorage "crm_api_url:<ร้าน>" ให้ชี้ไป Apps Script ทดสอบของเรา
// (URL หลักใน config.js ไม่ต้องเปลี่ยน) — ตั้งผ่านแผง "ทดสอบ" ในหน้าเว็บที่เปิดในเครื่อง

import { showLoading, hideLoading } from './ui.js';

export const apiKey = (shopId) => 'crm_api_url:' + shopId;

// รหัสที่จะหมดอายุภายในเวลานี้ถือว่าหมดแล้ว (ส่งไปก็ถูก LINE ปฏิเสธระหว่างทาง)
const EXPIRY_MARGIN_MS = 60 * 1000;

// รหัสยืนยันตัวตนใช้ไม่ได้แล้วหรือยัง: ว่าง หรือหมดอายุ (อ่านเวลาหมดอายุจากตัวรหัสเอง ไม่ต้องถามใคร)
export function tokenUnusable(token) {
  if (!token) return true;
  if (token.indexOf('TEST:') === 0) return false;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + EXPIRY_MARGIN_MS;
  } catch (e) {
    return false; // อ่านไม่ออก ให้ Apps Script เป็นคนตัดสิน
  }
}

// เข้าสู่ระบบ LINE ใหม่อัตโนมัติได้ไม่เกิน 1 ครั้งใน 2 นาที (กันหน้าเว็บโหลดวนไม่จบ)
const RELOGIN_KEY = 'crm_relogin_at';
const RELOGIN_WINDOW_MS = 2 * 60 * 1000;
const AUTH_CODES = ['NO_TOKEN', 'TOKEN_INVALID'];

function reloginAllowed() {
  try { return Date.now() - Number(sessionStorage.getItem(RELOGIN_KEY) || 0) > RELOGIN_WINDOW_MS; } catch (e) { return false; }
}
function markRelogin() { try { sessionStorage.setItem(RELOGIN_KEY, String(Date.now())); } catch (e) { /* ข้าม */ } }
function clearRelogin() { try { sessionStorage.removeItem(RELOGIN_KEY); } catch (e) { /* ข้าม */ } }

export function apiUrlFor(shop) {
  let override = '';
  try { override = localStorage.getItem(apiKey(shop.id)) || ''; } catch (e) { /* ปิด localStorage ไว้ */ }
  return override || shop.config.apiUrl || '';
}

// options.beforeRelogin(): เก็บสิ่งที่ผู้ใช้กรอกไว้ก่อนหน้าเว็บโหลดใหม่ / options.onRelogin(): แสดงว่ากำลังเชื่อมต่อใหม่
// options.loadingText(action): ข้อความในป๊อปอัป "กำลังโหลด" ของคำสั่งนั้น (คืน null = ทำเบื้องหลัง ไม่ขึ้นป๊อปอัป)
export function createApi(shop, line, options = {}) {
  const url = apiUrlFor(shop);

  // รหัส LINE หายหรือหมดอายุ → เข้าสู่ระบบใหม่อัตโนมัติ 1 ครั้ง (คำขอที่ถูกปฏิเสธยังไม่ได้บันทึกอะไร จึงทำใหม่ได้ปลอดภัย)
  // ถ้าเพิ่งลองไปแล้วยังไม่หาย → แจ้งผู้ใช้แทน ไม่โหลดวน
  function recover(message, code) {
    if (line.test || !reloginAllowed()) {
      throw apiError(message || 'เชื่อมต่อ LINE ไม่สำเร็จ กรุณาปิดหน้านี้แล้วเปิดใหม่จากเมนูใน LINE', code);
    }
    markRelogin();
    hideLoading(true); // หน้ากำลังจะโหลดใหม่ ไม่ต้องค้างป๊อปอัปไว้บนหน้าเชื่อมต่อ LINE
    try { if (options.beforeRelogin) options.beforeRelogin(); } catch (e) { /* เก็บไม่ได้ก็เข้าสู่ระบบใหม่ต่อ */ }
    try { if (options.onRelogin) options.onRelogin(); } catch (e) { /* ข้าม */ }
    line.relogin();
    return new Promise(() => {}); // หน้าเว็บกำลังโหลดใหม่ ไม่ต้องทำอะไรต่อ
  }

  async function call(action, data = {}) {
    const text = options.loadingText ? options.loadingText(action) : null;
    if (text) showLoading(text);
    try {
      return await request(action, data);
    } finally {
      if (text) hideLoading();
    }
  }

  return {
    url,
    overridden: !!url && url !== (shop.config.apiUrl || ''),
    call
  };

  async function request(action, data) {
      if (!url) throw apiError('ร้านนี้ยังไม่ได้ตั้งค่า apiUrl ใน config.js', 'NO_API');
      const idToken = line.getIdToken();
      if (!line.test && tokenUnusable(idToken)) return recover('', 'NO_TOKEN');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ ...data, action, idToken }),
          signal: ctrl.signal
        });
      } catch (e) {
        throw apiError(e && e.name === 'AbortError'
          ? 'ระบบตอบช้าเกินไป กรุณาลองใหม่'
          : 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'NETWORK');
      } finally {
        clearTimeout(timer);
      }
      let json;
      try { json = await res.json(); } catch (e) {
        throw apiError('ระบบตอบกลับไม่ถูกต้อง (ตรวจสอบ apiUrl)', 'BAD_RESPONSE');
      }
      if (json && !json.ok && AUTH_CODES.includes(json.code)) return recover(json.error, json.code);
      if (!json || !json.ok) throw apiError((json && json.error) || 'เกิดข้อผิดพลาด', (json && json.code) || 'ERROR', json && json.debug);
      clearRelogin(); // ใช้งานได้ปกติแล้ว ครั้งหน้าถ้ารหัสหายอีกก็เข้าสู่ระบบใหม่ให้ได้อีก
      return json;
  }
}

export function apiError(message, code, debug) {
  const err = new Error(message);
  err.code = code;
  if (debug) err.debug = debug;
  return err;
}

// รหัสคำขอ: ใช้กันบันทึกซ้ำเวลาเน็ตหลุดแล้วกดใหม่ (ส่งรหัสเดิม = Apps Script ไม่ทำซ้ำ)
export function newRequestId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// เก็บรหัสคำขอไว้ใช้ซ้ำ เฉพาะกรณีไม่รู้ผล (เน็ตหลุด/ช้า) — กรณีอื่นสร้างรหัสใหม่
export function createRetryKeeper() {
  const pending = new Map();
  return async function withRequestId(key, fn) {
    const id = pending.get(key) || newRequestId();
    pending.set(key, id);
    try {
      const result = await fn(id);
      pending.delete(key);
      return result;
    } catch (e) {
      if (e.code !== 'NETWORK') pending.delete(key);
      throw e;
    }
  };
}
