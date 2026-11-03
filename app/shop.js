// เลือกร้านจากโดเมนหรือลิงก์ แล้วโหลดไฟล์ตั้งค่า + ธีมของร้านนั้น
// ทุกหน้าใช้ไฟล์นี้ร่วมกัน ค่าเฉพาะร้านอยู่ใน shops/<id>/config.js เท่านั้น
import SHOPS from '/shops/shops.js';

// ชื่อที่ใช้เป็นส่วนของระบบ ห้ามใช้เป็นรหัสร้าน (ต้องตรงกับ vercel.json และ tools/dev-server.py)
const RESERVED = new Set(['staff', 'admin', 'app', 'shops', 'themes', 'tools', 'api', 'assets']);

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
  // หน้าตาร้านที่เจ้าของร้านตั้งในหลังบ้าน (จำไว้จากครั้งก่อน) → ใช้ทันที สีจะได้ไม่กะพริบจากค่าเดิมไปค่าใหม่
  const cached = readBrandCache(ref.id);
  const shop = {
    ...ref,
    baseConfig: config,
    config: cached ? mergeBrand(config, cached) : config,
    brandJson: cached ? JSON.stringify(cached) : '',
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
  root.style.cssText = ''; // ล้างสีชุดก่อน (เช่นเจ้าของร้านเพิ่งลบสีที่ตั้งไว้ → กลับไปใช้สีของสไตล์)

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
    const href = `/themes/${theme}.css`;
    if (link.getAttribute('href') === href) return done(); // ไฟล์ธีมเดิมโหลดไว้แล้ว ไม่ต้องรอ
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    link.href = href;
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

/* =====================================================
 * หน้าตาร้านจากหลังบ้าน (ชีต Settings) ทับค่าใน config.js
 * Apps Script ส่ง brand มาพร้อมคำสั่งแรกของทุกหน้า (withBrand) — ช่องว่าง = ใช้ค่าใน config.js
 * ===================================================== */
const BRAND_KEY = (id) => 'crm_brand:' + id;

// สีตั้งต้นของแต่ละสไตล์ (ต้องตรงกับ themes/*.css) ใช้หาสีตัวอักษรที่อ่านออกเมื่อเจ้าของร้านเปลี่ยนบางสี
export const THEME_DEFAULTS = {
  luxury: { primary: '#1F1914', button: '#8B5E34', accent: '#D4AF37', card: '#30231A' },
  minimal: { primary: '#FFFFFF', button: '#0EA5E9', accent: '#0EA5E9', card: '#38BDF8' }
};

export function readBrandCache(id) {
  try {
    const b = JSON.parse(localStorage.getItem(BRAND_KEY(id)) || 'null');
    return b && typeof b === 'object' ? b : null;
  } catch (e) {
    return null;
  }
}

// ใช้หน้าตาร้านล่าสุด (คืน true ถ้ามีอะไรเปลี่ยน — หน้าเว็บควรวาดใหม่)
export async function applyBrand(shop, brand) {
  if (!brand || typeof brand !== 'object') return false;
  const json = JSON.stringify(brand);
  if (json === shop.brandJson) return false;
  shop.brandJson = json;
  try { localStorage.setItem(BRAND_KEY(shop.id), json); } catch (e) { /* เก็บไม่ได้ ครั้งหน้าก็แค่กะพริบสีแวบเดียว */ }
  shop.config = mergeBrand(shop.baseConfig, brand);
  await applyTheme(shop);
  return true;
}

export function mergeBrand(base, b) {
  const c = { ...base, texts: { ...(base.texts || {}) }, legal: { ...(base.legal || {}) }, colors: { ...(base.colors || {}) } };
  if (b.name) c.name = b.name;
  if (b.logo) c.logo = b.logo;
  // เปลี่ยนสไตล์ → ใช้สีของสไตล์ใหม่ ไม่เอาสีเดิมในไฟล์ตั้งค่ามาปน (เช่นสีน้ำตาลของธีมหรูบนธีมสว่าง)
  if (b.theme && b.theme !== base.theme) { c.theme = b.theme; c.colors = {}; }
  const col = b.colors || {};
  const theme = THEME_DEFAULTS[c.theme] || THEME_DEFAULTS.luxury;
  if (col.primary) Object.assign(c.colors, { primary: col.primary, onPrimary: textOn(col.primary), onPrimaryMuted: mutedOn(col.primary) });
  if (col.button) Object.assign(c.colors, { button: col.button, onButton: textOn(col.button) });
  if (col.card) Object.assign(c.colors, { cardFrom: col.card, cardTo: shade(col.card, -0.45), onCard: textOn(col.card), cardMuted: mutedOn(col.card) });
  if (col.accent) Object.assign(c.colors, { accent: col.accent, onAccent: textOn(col.accent) });
  if (col.accent || col.card) {
    // ตัวเลขแต้มบนบัตรใช้สีเน้น แต่ถ้าสีเน้นกลืนกับสีบัตร (อ่านไม่ออก) ใช้สีตัวอักษรของบัตรแทน
    const card = c.colors.cardFrom || theme.card;
    const accent = c.colors.accent || theme.accent;
    c.colors.highlight = contrast(accent, card) >= 3 ? accent : textOn(card);
  }
  const t = b.texts || {};
  ['pointUnit', 'greeting', 'registerTitle', 'registerSubtitle'].forEach(k => { if (t[k]) c.texts[k] = t[k]; });
  if (b.privacyText) { c.legal.privacyText = b.privacyText; c.legal.privacyUrl = ''; }
  return c;
}

/* ---------- สีตัวอักษรที่อ่านออกบนพื้นสีที่เจ้าของร้านเลือก (ตามสูตรความต่างสีของ WCAG) ---------- */
function luminance(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(x => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function textOn(bg) {
  return contrast(bg, '#FFFFFF') >= contrast(bg, '#1A1A1A') ? '#FFFFFF' : '#1A1A1A';
}

function mutedOn(bg) {
  return textOn(bg) === '#FFFFFF' ? 'rgba(255, 255, 255, .72)' : 'rgba(0, 0, 0, .58)';
}

// ปรับสีให้เข้มขึ้น (amount ติดลบ) หรืออ่อนลง — ใช้ทำสีไล่ของบัตรสมาชิก
export function shade(hex, amount) {
  const to = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  return '#' + [1, 3, 5].map(i => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(v + (to - v) * p).toString(16).padStart(2, '0');
  }).join('').toUpperCase();
}
