// คุยกับหลังบ้าน (Apps Script) ทางเดียว: POST แบบ text/plain → ไม่ต้องตั้งค่าการเรียกข้ามเว็บ (CORS)
// ทุกหน้าใช้ไฟล์นี้ วันหน้าถ้าย้ายหลังบ้านไปฐานข้อมูลอื่น แก้ที่ไฟล์นี้ที่เดียว
//
// ทดสอบ: ตั้ง localStorage "crm_api_url:<ร้าน>" ให้ชี้ไป Apps Script ทดสอบของเรา
// (URL หลักใน config.js ไม่ต้องเปลี่ยน) — ตั้งผ่านแผง "ทดสอบ" ในหน้าเว็บที่เปิดในเครื่อง

export const apiKey = (shopId) => 'crm_api_url:' + shopId;

export function apiUrlFor(shop) {
  let override = '';
  try { override = localStorage.getItem(apiKey(shop.id)) || ''; } catch (e) { /* ปิด localStorage ไว้ */ }
  return override || shop.config.apiUrl || '';
}

export function createApi(shop, line) {
  const url = apiUrlFor(shop);
  return {
    url,
    overridden: !!url && url !== (shop.config.apiUrl || ''),
    async call(action, data = {}) {
      if (!url) throw apiError('ร้านนี้ยังไม่ได้ตั้งค่า apiUrl ใน config.js', 'NO_API');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ ...data, action, idToken: line.getIdToken() }),
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
      if (!json || !json.ok) throw apiError((json && json.error) || 'เกิดข้อผิดพลาด', (json && json.code) || 'ERROR', json && json.debug);
      return json;
    }
  };
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
