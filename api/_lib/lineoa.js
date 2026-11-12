// ต่อ LINE OA ของร้าน (Messaging API) — ใช้ส่งข้อความตามกลุ่มจากหลังบ้าน
//
// รหัสส่งข้อความ (Channel access token แบบใช้ได้นาน) เป็นความลับ ใครได้ไปส่งข้อความในนามร้านได้
// → เก็บใน Vercel เท่านั้น ร้านละ 1 ตัว ชื่อ LINE_OA_TOKEN_<รหัสร้านตัวใหญ่ ขีดเป็นขีดล่าง> เช่น LINE_OA_TOKEN_DEMO
//   (ไม่มีค่านี้ = ร้านยังไม่ได้เชื่อม → ส่งไม่ได้ แม้แอบเรียกคำสั่งตรง)
// OA ต้องอยู่ใน Provider เดียวกับช่อง LINE Login ของหน้าสมาชิก ไม่งั้น LINE ID ที่เก็บไว้ใช้ส่งไม่ได้
'use strict';
const crypto = require('crypto');

const API = 'https://api.line.me';
const TIMEOUT_MS = 15000;

class OaError extends Error {
  constructor(status, message) {
    super('LINE OA ตอบ ' + status + ': ' + message);
    this.status = status;
  }
}

const envName = (shopId) => 'LINE_OA_TOKEN_' + String(shopId).toUpperCase().replace(/-/g, '_');
const tokenFor = (shopId, env = process.env) => String(env[envName(shopId)] || '').trim();

// รหัสกันส่งซ้ำของ LINE (X-Line-Retry-Key ต้องเป็นรูป UUID) — คิดจากข้อความเดิมได้ค่าเดิมเสมอ
// ส่งชุดเดิมซ้ำด้วยรหัสเดิม → LINE ตอบ 409 และไม่ส่งซ้ำ (ใช้ตอนเน็ตหลุด / กด "ส่งต่อ")
function retryKey(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function createOa({ token, fetch = globalThis.fetch }) {
  async function call(method, path, body, extra) {
    const res = await fetch(API + path, {
      method,
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}, extra || {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (e) { /* ไม่ใช่ JSON */ }
    if (!res.ok) throw new OaError(res.status, (json && json.message) || text.slice(0, 200));
    return json;
  }
  return {
    info: () => call('GET', '/v2/bot/info'),                                  // ชื่อ / @ไอดี / รูปของ OA
    quota: () => call('GET', '/v2/bot/message/quota'),                       // โควตาข้อความต่อเดือนตามแพ็กเกจ OA
    consumption: () => call('GET', '/v2/bot/message/quota/consumption'),     // ใช้ไปแล้วเดือนนี้
    profile: (userId) => call('GET', '/v2/bot/profile/' + encodeURIComponent(userId)), // 404 = ยังไม่เป็นเพื่อน (หรือ OA อยู่คนละ Provider)
    push: (to, messages, key) => call('POST', '/v2/bot/message/push', { to, messages }, { 'X-Line-Retry-Key': key }),
    multicast: (to, messages, key) => call('POST', '/v2/bot/message/multicast', { to, messages }, { 'X-Line-Retry-Key': key })
  };
}

module.exports = { createOa, tokenFor, envName, retryKey, OaError };
