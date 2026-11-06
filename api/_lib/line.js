// ตรวจรหัสยืนยันตัวตนของ LINE (ID token) ที่หน้าเว็บส่งมากับทุกคำสั่ง
//
// ทำไมตรวจเอง: Apps Script ถาม LINE ทุกครั้ง (ไปกลับญี่ปุ่น ~0.1–0.2 วินาที) แต่รหัสจาก LIFF
// ลงลายเซ็นแบบ ES256 ซึ่งตรวจได้ด้วยกุญแจสาธารณะของ LINE (ดึงมาเก็บไว้ครั้งเดียว) → ตรวจในเครื่องได้ทันที
// ถ้ารหัสเป็นแบบอื่น หรือหากุญแจไม่เจอ → ถาม LINE แบบเดิม (ช้ากว่าแต่ถูกต้องเสมอ)
//
// สิ่งที่ต้องตรวจ (ขาดข้อใดข้อหนึ่ง = ปลอมได้):
//   ลายเซ็นถูก · ออกโดย LINE (iss) · ออกให้ร้านนี้ (aud = รหัส channel ของร้าน — กันเอารหัสร้านอื่นมาใช้)
//   · ยังไม่หมดอายุ (exp) · มีรหัสผู้ใช้ (sub)
const crypto = require('crypto');
const { cleanLineName, safeUrl } = require('./util');

const ISSUER = 'https://access.line.me';
const CERTS_URL = 'https://api.line.me/oauth2/v2.1/certs';
const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const KEYS_TTL_MS = 24 * 60 * 60 * 1000;   // LINE เปลี่ยนกุญแจไม่บ่อย
const KEYS_RETRY_MS = 5 * 60 * 1000;       // เจอกุญแจที่ไม่รู้จัก → ดึงใหม่ได้ แต่ไม่ถี่กว่านี้ (กันคนส่งรหัสมั่วมาให้เราดึงรัว)
const CACHE_MAX = 5000;
const NET_TIMEOUT_MS = 4000;
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;   // ตรงกับเงื่อนไขในตาราง members / staff

// ข้อผิดพลาดที่แปลว่า "รหัสนี้ใช้ไม่ได้" (ไม่ใช่ระบบเสีย)
class InvalidToken extends Error {}

function b64json(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function toUser(sub, name, picture) {
  if (!USER_ID.test(String(sub || ''))) throw new InvalidToken('ไม่มีรหัสผู้ใช้ที่ถูกต้อง');
  return { userId: String(sub), name: cleanLineName(name), picture: safeUrl(picture) };
}

// deps ใส่แทนได้ตอนทดสอบ (fetch ปลอม / นาฬิกาปลอม / ที่อยู่กุญแจ)
function createVerifier({ fetch = globalThis.fetch, now = () => Date.now(), certsUrl = CERTS_URL, verifyUrl = VERIFY_URL } = {}) {
  let keys = null;        // kid → KeyObject
  let keysAt = 0;         // ดึงกุญแจล่าสุดเมื่อไร
  let keysTriedAt = -Infinity;
  const cache = new Map(); // ลายนิ้วมือของรหัส → { user, until } (รหัสเดิมส่งมาซ้ำทุกคำสั่งจนหมดอายุ)

  async function loadKeys(force) {
    const t = now();
    if (keys && !force && t - keysAt < KEYS_TTL_MS) return keys;
    if (force && t - keysTriedAt < KEYS_RETRY_MS) return keys;
    keysTriedAt = t;
    const res = await fetch(certsUrl, { signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
    if (!res.ok) throw new Error('ดึงกุญแจ LINE ไม่ได้ (' + res.status + ')');
    const body = await res.json();
    const next = new Map();
    for (const jwk of (body && body.keys) || []) {
      if (jwk && jwk.kid && jwk.kty === 'EC' && jwk.crv === 'P-256') {
        next.set(jwk.kid, crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' }));
      }
    }
    keys = next;
    keysAt = t;
    return keys;
  }

  // ตรวจในเครื่อง: คืนผู้ใช้ / null = ตรวจเองไม่ได้ (ให้ถาม LINE) / โยน InvalidToken = ปลอมหรือหมดอายุแน่นอน
  async function verifyLocal(token, channelId) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new InvalidToken('รูปแบบรหัสไม่ถูกต้อง');
    let header, payload;
    try { header = b64json(parts[0]); payload = b64json(parts[1]); } catch (e) { throw new InvalidToken('อ่านรหัสไม่ออก'); }
    // ล็อกวิธีลงลายเซ็นไว้ที่ ES256 เท่านั้น (กันรหัสปลอมที่บอกว่า "ไม่ต้องตรวจลายเซ็น" หรือเปลี่ยนวิธี)
    if (!header || header.alg !== 'ES256' || !header.kid) return null;

    let keyset;
    try { keyset = await loadKeys(false); } catch (e) { console.warn('line: ' + e.message + ' → ถาม LINE แทน'); return null; }
    let key = keyset && keyset.get(header.kid);
    if (!key) {
      try { keyset = await loadKeys(true); } catch (e) { console.warn('line: ' + e.message + ' → ถาม LINE แทน'); return null; }
      key = keyset && keyset.get(header.kid);
      if (!key) return null;
    }

    let okSig = false;
    try {
      const signature = Buffer.from(parts[2], 'base64url');
      okSig = crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), { key, dsaEncoding: 'ieee-p1363' }, signature);
    } catch (e) { okSig = false; } // ลายเซ็นผิดขนาด/เสีย → ถือว่าปลอม
    if (!okSig) throw new InvalidToken('ลายเซ็นไม่ถูกต้อง');
    if (payload.iss !== ISSUER) throw new InvalidToken('ไม่ได้ออกโดย LINE');
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.map(String).includes(String(channelId))) throw new InvalidToken('รหัสนี้ไม่ได้ออกให้ร้านนี้');
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now()) throw new InvalidToken('หมดอายุแล้ว');
    return { user: toUser(payload.sub, payload.name, payload.picture), exp: payload.exp };
  }

  // ถาม LINE โดยตรง (วิธีเดียวกับ Apps Script) — LINE ตรวจทั้งลายเซ็น ร้าน และวันหมดอายุให้
  async function verifyRemote(token, channelId) {
    const res = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: token, client_id: String(channelId) }).toString(),
      signal: AbortSignal.timeout(NET_TIMEOUT_MS)
    });
    if (res.status === 400 || res.status === 401) throw new InvalidToken('LINE ปฏิเสธ: ' + (await res.text()).slice(0, 200));
    if (!res.ok) throw new Error('LINE ตอบผิดปกติ (' + res.status + ')');
    const data = await res.json();
    return { user: toUser(data.sub, data.name, data.picture), exp: Number(data.exp || 0) };
  }

  // คืน { user, via } — via บอกว่าผ่านทางไหน (cache / local / line) ใช้ดูความเร็ว
  // โยน InvalidToken เมื่อรหัสใช้ไม่ได้ / โยน Error อื่นเมื่อติดต่อ LINE ไม่ได้
  async function verify(token, channelId) {
    token = String(token || '');
    const fp = crypto.createHash('sha256').update(channelId + ':' + token).digest('base64url');
    const hit = cache.get(fp);
    if (hit && hit.until > now()) return { user: hit.user, via: 'cache' };
    if (hit) cache.delete(fp);

    let result = await verifyLocal(token, channelId);
    let via = 'local';
    if (!result) { result = await verifyRemote(token, channelId); via = 'line'; }

    // จำไว้จนเกือบหมดอายุ (เหลือ 60 วินาที เหมือน Apps Script) แต่ไม่เกิน 6 ชั่วโมง
    const until = Math.min(result.exp * 1000 - 60 * 1000, now() + 6 * 60 * 60 * 1000);
    if (until > now()) {
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(fp, { user: result.user, until });
    }
    return { user: result.user, via };
  }

  return { verify };
}

module.exports = { createVerifier, InvalidToken, cleanLineName, safeUrl, ISSUER };
