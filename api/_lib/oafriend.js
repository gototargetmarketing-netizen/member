// สถานะเพื่อน LINE OA ของลูกค้า (ส่งข้อความตามกลุ่ม รอบ 3 — ผู้ใช้ตกลง 12 พ.ย. 2569)
// เช็กผ่านรหัส OA ของร้านที่อยู่ใน Vercel อยู่แล้ว (ดูโปรไฟล์ลูกค้า: 404 = ยังไม่เป็นเพื่อน/บล็อก)
// → ไม่ต้องตั้งค่าเพิ่มใน LINE Developers / ไม่ต้องให้ LINE แจ้งเหตุการณ์มา (ผู้ใช้เลือกแบบง่าย)
// ใช้ได้เฉพาะ OA ที่อยู่ Provider เดียวกับ LIFF ของร้าน (LINE ID ของลูกค้าถึงจะตรงกัน)
'use strict';

const FRESH_MS = 24 * 60 * 60 * 1000; // เป็นเพื่อนแล้ว เช็กซ้ำวันละครั้ง (คนที่ยังไม่เป็นเพื่อนเช็กทุกครั้งที่เปิดบัตร — ปุ่มเพิ่มเพื่อนหายทันทีหลังเพิ่ม)
const INFO_TTL_MS = 60 * 60 * 1000;   // @ไอดีของ OA เปลี่ยนยาก จำไว้ 1 ชม. (ไม่ต้องถาม LINE ทุกครั้งที่เปิดหน้าสมัคร)
const infoCache = new Map();          // ร้าน → { basicId, at }

const getOa = (ctx) => (ctx.deps && typeof ctx.deps.oa === 'function' ? ctx.deps.oa(ctx.shop.id) : null);

// true = เป็นเพื่อน / false = ยังไม่เป็นเพื่อนหรือบล็อก / null = ไม่รู้ (LINE ตอบไม่ได้ — ห้ามใช้ปิดกั้นลูกค้า)
async function isFriend(oa, userId) {
  try {
    await oa.profile(userId);
    return true;
  } catch (e) {
    if (e && e.status === 404) return false;
    console.error('เช็กเพื่อน LINE OA ไม่ได้: ' + (e && e.message ? e.message : e));
    return null;
  }
}

// ลิงก์เพิ่มเพื่อน OA (เปิดหน้าเพิ่มเพื่อนในแอป LINE) — ว่าง = หาไม่ได้ตอนนี้
async function addFriendUrl(oa, shopId, now = Date.now()) {
  const hit = infoCache.get(shopId);
  let basicId = hit && now - hit.at < INFO_TTL_MS ? hit.basicId : '';
  if (!basicId) {
    try {
      basicId = String((await oa.info()).basicId || '');
      if (basicId) infoCache.set(shopId, { basicId, at: now });
    } catch (e) {
      console.error('อ่าน @ไอดี LINE OA ไม่ได้: ' + (e && e.message ? e.message : e));
    }
  }
  return /^@[A-Za-z0-9._-]{2,40}$/.test(basicId) ? 'https://line.me/R/ti/p/' + encodeURIComponent(basicId) : '';
}

// ค่าที่จดไว้ยังใช้ได้ไหม (เป็นเพื่อน + เช็กไม่เกิน 1 วัน) — นอกนั้นถาม LINE ใหม่
const stillFriend = (row, now) => !!(row && row.friend === true && row.at && now.getTime() - new Date(row.at).getTime() < FRESH_MS);

module.exports = { getOa, isFriend, addFriendUrl, stillFriend, FRESH_MS, _infoCache: infoCache };
