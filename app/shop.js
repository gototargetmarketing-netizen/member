// เลือกร้านจากโดเมนหรือลิงก์ แล้วโหลดไฟล์ตั้งค่า + ธีมของร้านนั้น
// ทุกหน้าใช้ไฟล์นี้ร่วมกัน ค่าเฉพาะร้านอยู่ใน shops/<id>/config.js เท่านั้น
import SHOPS from '/shops/shops.js';

// ชื่อที่ใช้เป็นส่วนของระบบ ห้ามใช้เป็นรหัสร้าน (ต้องตรงกับ vercel.json และ tools/dev-server.py)
const RESERVED = new Set(['staff', 'admin', 'app', 'shops', 'themes', 'tools', 'api']);

export function resolveShop(loc = window.location) {
  // 1) โดเมนของร้าน (เช่น khamwan.com) → ร้านนั้นเท่านั้น ไม่สนลิงก์ (กันเปิดร้านอื่นผ่านโดเมนนี้)
  const host = loc.hostname.toLowerCase().replace(/^www\./, '');
  const byDomain = SHOPS.find(s => (s.domains || []).some(d => d.toLowerCase().replace(/^www\./, '') === host));
  if (byDomain) return { id: byDomain.id, base: '' };

  // 2) โดเมนหลัก/ทดสอบ → ดูส่วนแรกของลิงก์ เช่น /khamwan หรือ /khamwan/staff
  const seg = decodeURIComponent(loc.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  if (!seg || RESERVED.has(seg) || !/^[a-z0-9-]+$/.test(seg)) return null;
  const shop = SHOPS.find(s => s.id === seg);
  return shop ? { id: shop.id, base: '/' + shop.id } : null;
}

export async function loadShop() {
  const ref = resolveShop();
  if (!ref) {
    const err = new Error('ไม่พบร้านจากลิงก์นี้ กรุณาเปิดจากเมนูใน LINE ของร้าน');
    err.code = 'NO_SHOP';
    throw err;
  }
  const config = (await import(`/shops/${ref.id}/config.js`)).default;
  const shop = {
    ...ref,
    config,
    // ลิงก์ไปหน้าอื่นของร้านเดียวกัน (ใช้ได้ทั้งแบบโดเมนร้านและแบบ /ชื่อร้าน)
    pageUrl: (page = '') => (ref.base + (page ? '/' + page : '')) || '/',
    // ไฟล์รูปของร้าน: ชื่อไฟล์ในโฟลเดอร์ร้าน หรือ URL https เต็ม
    asset: (p) => {
      const s = String(p || '');
      if (/^https:\/\//.test(s)) return s;
      if (!s || s.includes('..')) return '';
      return `/shops/${ref.id}/${s.replace(/^\/+/, '')}`;
    }
  };
  await applyTheme(shop);
  return shop;
}

// ใส่ธีม (ไฟล์ CSS สำเร็จรูป) แล้วทับด้วยสี/ฟอนต์ของร้าน
export function applyTheme(shop) {
  const c = shop.config;
  const root = document.documentElement;
  const theme = /^[a-z0-9-]+$/.test(c.theme || '') ? c.theme : 'luxury';
  root.dataset.theme = theme;

  // สีจาก config: primary → --primary, cardFrom → --card-from (รับเฉพาะค่าสีที่ปลอดภัย)
  Object.entries(c.colors || {}).forEach(([key, value]) => {
    if (/^[a-zA-Z0-9]+$/.test(key) && /^[#a-zA-Z0-9(),.%\s-]{1,60}$/.test(String(value))) {
      root.style.setProperty('--' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), String(value));
    }
  });

  if (c.font && c.font.family && /^[A-Za-z0-9 ]+$/.test(c.font.family)) {
    root.style.setProperty('--font', `"${c.font.family}", system-ui, -apple-system, "Segoe UI", sans-serif`);
    if (c.font.google && /^[A-Za-z0-9 +:@;,.]+$/.test(c.font.google)) {
      addStylesheet('https://fonts.googleapis.com/css2?family=' + c.font.google.replace(/ /g, '+') + '&display=swap');
    }
  }
  document.title = c.name || document.title;

  // รอไฟล์ธีมโหลดเสร็จก่อนแสดงหน้า (กันหน้าจอกระพริบสีผิด) แต่ไม่เกิน 3 วินาที
  return new Promise(resolve => {
    const link = document.getElementById('theme-css');
    const done = () => {
      const meta = document.querySelector('meta[name="theme-color"]');
      const color = getComputedStyle(root).getPropertyValue('--primary').trim();
      if (meta && color) meta.setAttribute('content', color);
      resolve();
    };
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    link.href = `/themes/${theme}.css`;
    setTimeout(done, 3000);
  });
}

function addStylesheet(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}
