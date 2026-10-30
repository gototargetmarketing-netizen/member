// แผงทดสอบ — แสดงเฉพาะตอนเปิดในเครื่อง (localhost) เว็บจริงไม่มีแผงนี้
// ใช้ตั้ง: URL Apps Script ทดสอบของเรา และผู้ใช้จำลอง (สลับเป็นลูกค้า/พนักงานได้)
import { esc } from './ui.js';
import { apiKey } from './api.js';

export const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const USER_KEY = 'crm_test_user';

const PRESETS = [
  { id: 'U_TEST_1', name: 'ลูกค้าทดสอบ 1' },
  { id: 'U_TEST_2', name: 'ลูกค้าทดสอบ 2' },
  { id: 'U_TEST_STAFF', name: 'พนักงานทดสอบ' }
];

function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function write(key, value) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch (e) { /* ข้าม */ } }

export function getTestUser() {
  try {
    const u = JSON.parse(read(USER_KEY) || 'null');
    if (u && /^[A-Za-z0-9_-]{1,40}$/.test(u.id)) return { id: u.id, name: String(u.name || u.id).replace(/[:<>]/g, '').slice(0, 40) };
  } catch (e) { /* ค่าเสีย ใช้ค่าเริ่มต้น */ }
  return PRESETS[0];
}

// ลิงก์ทดสอบแบบสั้น: ?api=<URL>&user=<id>&name=<ชื่อ> → จำไว้ แล้วลบออกจากแถบที่อยู่
export function applyDevParams(shopId) {
  if (!IS_LOCAL) return;
  const q = new URLSearchParams(window.location.search);
  let changed = false;
  if (q.has('api')) { write(apiKey(shopId), q.get('api')); q.delete('api'); changed = true; }
  if (q.has('user')) {
    write(USER_KEY, JSON.stringify({ id: q.get('user'), name: q.get('name') || q.get('user') }));
    q.delete('user'); q.delete('name'); changed = true;
  }
  if (changed) {
    const qs = q.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
  }
}

export function mountDevBar(shop, api, { openNow = false } = {}) {
  if (!IS_LOCAL || document.getElementById('devbar')) return;
  const user = getTestUser();
  const bar = document.createElement('div');
  bar.id = 'devbar';
  bar.className = 'devbar';
  bar.innerHTML = `
    <button type="button" class="devbar-toggle">🧪 ทดสอบ</button>
    <form class="devbar-panel" ${openNow ? '' : 'hidden'}>
      <div class="devbar-title">โหมดทดสอบในเครื่อง · ร้าน <b>${esc(shop.id)}</b></div>
      <label>URL Apps Script ทดสอบ (ต้องรัน enableTestMode แล้ว)
        <input name="api" value="${esc(api.overridden ? api.url : '')}" placeholder="https://script.google.com/macros/s/.../exec">
      </label>
      <label>ผู้ใช้จำลอง
        <select name="preset">
          ${PRESETS.map(p => `<option value="${p.id}" ${p.id === user.id ? 'selected' : ''}>${esc(p.name)} (${p.id})</option>`).join('')}
          <option value="" ${PRESETS.some(p => p.id === user.id) ? '' : 'selected'}>กำหนดเอง</option>
        </select>
      </label>
      <div class="devbar-row">
        <input name="uid" value="${esc(user.id)}" placeholder="รหัสผู้ใช้">
        <input name="uname" value="${esc(user.name)}" placeholder="ชื่อ">
      </div>
      <div class="devbar-row">
        <button type="submit">บันทึกและโหลดใหม่</button>
        <a href="${esc(shop.pageUrl(''))}">หน้าลูกค้า</a>
        <a href="${esc(shop.pageUrl('staff'))}">หน้าพนักงาน</a>
      </div>
    </form>`;
  document.body.appendChild(bar);

  const panel = bar.querySelector('form');
  bar.querySelector('.devbar-toggle').addEventListener('click', () => { panel.hidden = !panel.hidden; });
  panel.preset.addEventListener('change', () => {
    const p = PRESETS.find(x => x.id === panel.preset.value);
    if (p) { panel.uid.value = p.id; panel.uname.value = p.name; }
  });
  panel.addEventListener('submit', e => {
    e.preventDefault();
    write(apiKey(shop.id), panel.api.value.trim());
    const id = panel.uid.value.trim();
    if (/^[A-Za-z0-9_-]{1,40}$/.test(id)) write(USER_KEY, JSON.stringify({ id, name: panel.uname.value.trim() || id }));
    window.location.reload();
  });
}
