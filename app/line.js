// เข้าสู่ระบบ LINE (LIFF)
// ทดสอบในเครื่อง (localhost): LIFF ใช้ไม่ได้ จึงจำลองผู้ใช้แทน แล้วส่ง token ทดสอบ "TEST:<id>:<ชื่อ>"
// Apps Script จะรับ token นี้ก็ต่อเมื่อเปิดโหมดทดสอบไว้ (เปิดเฉพาะสคริปต์ทดสอบของเรา) — ร้านจริงไม่รับ
import { IS_LOCAL, getTestUser } from './devbar.js';

export { IS_LOCAL };

export async function initLine(liffId) {
  if (IS_LOCAL) {
    const u = getTestUser();
    return {
      test: true,
      inClient: false,
      userId: u.id,
      getIdToken: () => `TEST:${u.id}:${u.name}`,
      profile: { name: u.name, picture: '' },
      relogin: () => window.location.reload(),
      scanCode: null
    };
  }

  if (!window.liff) throw lineError('โหลดระบบ LINE ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
  if (!liffId) throw lineError('ร้านนี้ยังไม่ได้ตั้งค่า LIFF');

  await window.liff.init({ liffId, withLoginOnExternalBrowser: true });

  // เปิดผ่านลิงก์ liff.line.me/<id>/staff: LIFF จะพาไปหน้าปลายทางเอง หยุดทำงานในหน้านี้
  if (new URLSearchParams(window.location.search).has('liff.state')) return new Promise(() => {});

  if (!window.liff.isLoggedIn()) {
    window.liff.login({ redirectUri: window.location.href });
    return new Promise(() => {});
  }

  const decoded = window.liff.getDecodedIDToken() || {};
  const inClient = window.liff.isInClient();

  // จำรหัสยืนยันตัวตนไว้ตั้งแต่เปิดหน้า: เคยเจอว่าตอนเปิดหน้ามีรหัส แต่พอลูกค้ากดสมัคร
  // LINE คืนรหัสว่าง (ทดสอบบน iPhone 30 ต.ค. 2569) — ถ้า LINE ให้รหัสใหม่มา ก็ใช้ตัวใหม่แทน
  let lastToken = window.liff.getIDToken() || '';

  return {
    test: false,
    inClient,
    // รหัสผู้ใช้ LINE จากตัวรหัสยืนยัน ใช้แยกข้อมูลที่จำไว้ในเครื่องของแต่ละคน (ไม่ได้ใช้ยืนยันตัวตน — Apps Script ตรวจเอง)
    userId: String(decoded.sub || ''),
    getIdToken() {
      const current = window.liff.getIDToken();
      if (current) lastToken = current;
      return current || lastToken;
    },
    profile: { name: decoded.name || '', picture: decoded.picture || '' },
    // เข้าสู่ระบบใหม่: ออกจากระบบก่อนเพื่อทิ้งรหัสเก่าที่ใช้ไม่ได้ แล้วให้ LINE ออกรหัสใหม่
    // ในแอป LINE เปิดหน้าใหม่แล้ว LIFF เข้าสู่ระบบให้เองอัตโนมัติ / นอกแอปพาไปหน้าเข้าสู่ระบบ LINE
    relogin() {
      try { window.liff.logout(); } catch (e) { /* ออกจากระบบไม่ได้ก็เปิดหน้าใหม่ต่อ */ }
      if (inClient) window.location.reload();
      else window.liff.login({ redirectUri: window.location.href });
    },
    // สแกนด้วยกล้องของแอป LINE (ต้องเปิด "Scan QR" ในการตั้งค่า LIFF) — ใช้ไม่ได้ก็ไปใช้กล้องผ่านเว็บแทน
    scanCode: inClient && typeof window.liff.scanCodeV2 === 'function'
      ? async () => ((await window.liff.scanCodeV2()) || {}).value || ''
      : null
  };
}

function lineError(message) {
  const err = new Error(message);
  err.code = 'LINE';
  return err;
}
