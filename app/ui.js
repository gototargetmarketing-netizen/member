// เครื่องมือหน้าจอที่ใช้ร่วมกันทุกหน้า: escape ข้อความ ไอคอน ป๊อปอัป ข้อความแจ้งเตือน รูปแบบตัวเลข/วันที่ QR

// ข้อมูลทุกอย่างที่มาจากชีต/ผู้ใช้ ต้องผ่าน esc() ก่อนใส่ใน HTML (กันฝังโค้ด)
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ไอคอนเขียนเองแบบเส้น (ไม่พึ่งไลบรารีภายนอก โหลดเร็วและไม่พังเมื่อไลบรารีเปลี่ยนเวอร์ชัน)
const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8C10.5 5 7 4.5 7 6.5S10 8 12 8zM12 8c1.5-3 5-3.5 5-1.5S14 8 12 8z"/>',
  ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  up: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5a6 6 0 1 1-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  store: '<path d="M4 9l1-5h14l1 5"/><path d="M4 9h16v1a3 3 0 0 1-5.3 2 3 3 0 0 1-5.4 0A3 3 0 0 1 4 10z"/><path d="M5 13v8h14v-8"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5"/><path d="M4 20h16"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.6-9-7.6z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  cake: '<path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"/><path d="M5 16c2 1.5 3.5 1.5 5 0s3.5-1.5 5 0 3.5 1.5 4 0"/><path d="M12 12V8M12 5.5c.8-.8.8-1.7 0-2.5-.8.8-.8 1.7 0 2.5z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  crown: '<path d="M5 19L3 8l5.5 4L12 5l3.5 7L21 8l-2 11z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'
};

export function icon(name, size = 20) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ---------- เครดิตผู้พัฒนา ---------- */
// เหมือนกันทุกร้านและทุกหน้า (ลูกค้า พนักงาน หลังบ้าน) เก็บไว้ที่เดียว เปลี่ยนข้อความ/โลโก้จะได้แก้จุดเดียว
// cls บอกตำแหน่ง: credit-boot (หน้าโหลด) / credit-page (ท้ายหน้า) / credit-side (เมนูข้างหลังบ้าน) / credit-foot (ท้ายหลังบ้านบนมือถือ)
export function creditHtml(cls = '') {
  return `<div class="credit ${cls}"><img src="/assets/gototarget-logo.png" alt="" width="24" height="16">Design by Go To Target</div>`;
}

/* ---------- หน้าโหลดเต็มจอ (ใช้ร่วมกันทุกหน้า: ลูกค้า พนักงาน หลังบ้าน) ----------
 * พื้นขาว วงหมุนเทา ไม่มีชื่อ/สีร้าน — ระหว่างนี้ยังไม่รู้หน้าตาร้านล่าสุด ถ้าใส่สีร้านไว้
 * อาจเห็นสีเก่าแวบหนึ่งแล้วเปลี่ยนเป็นสีใหม่ (กะพริบ)
 * ต้องตรงกับหน้าโหลดที่เขียนไว้ใน index.html / staff.html / admin.html (ขึ้นก่อนโค้ดนี้ทำงาน) */
export function bootHtml(message = '') {
  return `<div class="boot-screen" role="status" aria-label="กำลังโหลด"><div class="boot-ring"></div><div class="boot-msg">${esc(message)}</div>${creditHtml('credit-boot')}</div>`;
}

/* ---------- ข้อความแจ้งเตือนสั้นๆ ---------- */
let toastTimer = null;
export function toast(message, kind = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, 2800);
}

/* ---------- ป๊อปอัป "กำลังโหลด" (ใช้ร่วมกันทุกหน้า) ----------
 * รอข้อมูลจาก Apps Script ปกติ 1–5 วินาที ผู้ใช้ต้องรู้ว่าระบบกำลังทำงาน ไม่ใช่ค้าง
 * - ขึ้นให้เห็นเมื่อรอนานเกิน 0.3 วินาที (เร็วกว่านั้นไม่ขึ้น จอจะได้ไม่กะพริบ)
 * - แต่บังจอแบบใสตั้งแต่เริ่ม กันกดปุ่มซ้ำระหว่างรอ (เช่นบันทึกยอดซื้อสองรอบ)
 * - เรียกซ้อนกันได้ (นับจำนวน) ปิดเมื่องานสุดท้ายเสร็จ */
let loadingCount = 0;
let loadingTimer = null;

export function showLoading(text = 'กำลังโหลด...') {
  let el = document.getElementById('loading-pop');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-pop';
    el.className = 'loading-pop';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="loading-box"><div class="spinner"></div><div class="loading-text"></div></div>';
    document.body.appendChild(el);
  }
  el.querySelector('.loading-text').textContent = text;
  loadingCount++;
  el.classList.add('active');
  if (!loadingTimer && !el.classList.contains('show')) {
    loadingTimer = setTimeout(() => {
      loadingTimer = null;
      if (loadingCount > 0) el.classList.add('show');
    }, 300);
  }
}

// force = ปิดทันทีไม่ว่าเหลือกี่งาน (ใช้ตอนหน้าเว็บกำลังโหลดใหม่ เช่นเชื่อมต่อ LINE ใหม่)
export function hideLoading(force = false) {
  loadingCount = force ? 0 : Math.max(0, loadingCount - 1);
  if (loadingCount) return;
  clearTimeout(loadingTimer);
  loadingTimer = null;
  const el = document.getElementById('loading-pop');
  if (el) el.classList.remove('active', 'show');
}

/* ---------- ป๊อปอัป ---------- */
let modalClose = null;
export function openModal(html, { onClose } = {}) {
  closeModal();
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-box">${html}</div></div>`;
  const overlay = root.firstElementChild;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  modalClose = onClose || null;
  return overlay.querySelector('.modal-box');
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (!root || !root.firstElementChild) return;
  root.innerHTML = '';
  const fn = modalClose;
  modalClose = null;
  if (fn) fn();
}

/* ---------- รูปแบบตัวเลข / วันที่ (เวลาไทย) ---------- */
const nf = new Intl.NumberFormat('th-TH');
const mf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
export const fmtNum = n => nf.format(Math.round(Number(n) || 0));
export const fmtMoney = n => mf.format(Number(n) || 0);

export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d) ? '-' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}

export function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d) ? '-' : d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

/* ---------- QR (สร้างในเครื่อง ไม่ส่งรหัสลูกค้าไปเว็บภายนอก) ---------- */
export function qrSvg(text) {
  if (typeof window.qrcode !== 'function') return `<div class="qr-fallback">${esc(text)}</div>`;
  const qr = window.qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag(8, 2).replace('<svg ', '<svg class="qr-svg" role="img" aria-label="QR Code" ');
}

/* ---------- ปุ่มระหว่างรอ ---------- */
export function setBusy(btn, busy, busyText = 'กำลังบันทึก...') {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = `<span class="spin"></span>${esc(busyText)}`;
    btn.disabled = true;
  } else {
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    btn.disabled = false;
  }
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('โหลดไฟล์ไม่สำเร็จ: ' + src));
    document.head.appendChild(s);
  });
}

// รูปที่โหลดไม่ได้ (ลิงก์เสีย) → ซ่อน ให้เห็นพื้นหลังแทนกรอบรูปแตก
document.addEventListener('error', e => {
  if (e.target && e.target.tagName === 'IMG') e.target.classList.add('img-broken');
}, true);
