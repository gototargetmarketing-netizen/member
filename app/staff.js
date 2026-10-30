// หน้าพนักงาน: สแกน QR ลูกค้า → บันทึกยอดซื้อ / ใช้คูปอง / ปรับแต้ม (ผู้จัดการ)
// สิทธิ์ตรวจที่ Apps Script ทุกคำสั่ง (ชีต Staff) — หน้านี้แค่ซ่อน/แสดงปุ่มให้ตรงบทบาท
import { loadShop } from './shop.js';
import { initLine, IS_LOCAL } from './line.js';
import { createApi, createRetryKeeper } from './api.js';
import { applyDevParams, mountDevBar } from './devbar.js';
import { esc, icon, toast, openModal, closeModal, fmtNum, fmtMoney, fmtDate, fmtDateTime, setBusy, loadScript } from './ui.js';

const SCANNER_JS = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
const ROLE_LABEL = { OWNER: 'เจ้าของร้าน', ADMIN: 'ผู้จัดการ', CASHIER: 'แคชเชียร์' };
const TX_LABEL = { EARN: 'ยอดซื้อ', WELCOME: 'แต้มต้อนรับ', REDEEM: 'แลกรางวัล', ADJUST: 'ปรับแต้ม' };

const app = document.getElementById('app');
const S = { shop: null, line: null, api: null, me: null, settings: null, view: null, flash: null, scanner: null };
const withRequestId = createRetryKeeper();

const cfg = () => S.shop.config;
const unit = () => (cfg().texts && cfg().texts.pointUnit) || 'แต้ม';
const isManager = () => S.me && (S.me.role === 'OWNER' || S.me.role === 'ADMIN');

document.addEventListener('click', onClick);
main();

async function main() {
  try {
    S.shop = await loadShop();
    applyDevParams(S.shop.id);
    app.innerHTML = `<div class="boot"><div class="boot-name">${esc(cfg().name)}</div><div class="muted">หน้าพนักงาน</div><div class="spinner"></div></div>`;
    S.line = await initLine(cfg().liffId);
    S.api = createApi(S.shop, S.line);
    if (IS_LOCAL) mountDevBar(S.shop, S.api, { openNow: !S.api.overridden });
    const r = await S.api.call('staffMe');
    S.me = r.staff;
    S.settings = r.settings || null;
    if (S.me.status !== 'ACTIVE') return renderPending(r.testMode);
    renderMain(r.testMode);
    loadRecent();
  } catch (e) {
    renderFatal(e);
  }
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'scan': scan(); break;
    case 'clear': S.view = null; S.flash = null; renderResult(); focusSearch(); break;
    case 'use-coupon': confirmUseCoupon(id); break;
    case 'use-coupon-confirm': doUseCoupon(id, el); break;
    case 'purchase-confirm': doPurchase(el); break;
    case 'adjust-confirm': doAdjust(el); break;
    case 'recent': loadRecent(); break;
    case 'copy-id': copyText(S.me.userId); break;
    case 'close': closeModal(); break;
    case 'reload': window.location.reload(); break;
    case 'relogin': if (S.line) S.line.relogin(); break;
  }
}

/* =====================================================
 * หน้ารออนุมัติ / ผิดพลาด
 * ===================================================== */
function renderFatal(e) {
  app.innerHTML = `
    <div class="state-page">
      <div class="state-icon">${icon('alert', 40)}</div>
      <h1>เปิดหน้าพนักงานไม่สำเร็จ</h1>
      <p>${esc((e && e.message) || 'เกิดข้อผิดพลาด')}</p>
      ${IS_LOCAL && e && e.debug ? `<pre class="debug">${esc(e.debug)}</pre>` : ''}
      <div class="stack">
        ${e && e.code === 'TOKEN_INVALID' ? '<button class="btn btn-primary" data-act="relogin">เข้าสู่ระบบใหม่</button>' : ''}
        <button class="btn" data-act="reload">ลองใหม่</button>
      </div>
    </div>`;
  if (IS_LOCAL && S.shop && !document.getElementById('devbar')) {
    mountDevBar(S.shop, S.api || { url: '', overridden: false }, { openNow: true });
  }
}

function renderPending(testMode) {
  const disabled = S.me.status === 'DISABLED';
  app.innerHTML = (testMode ? '<div class="test-banner">โหมดทดสอบ</div>' : '') + `
    <div class="state-page">
      <div class="state-icon">${icon(disabled ? 'shield' : 'clock', 40)}</div>
      <h1>${disabled ? 'บัญชีนี้ถูกปิดสิทธิ์พนักงาน' : 'ส่งคำขอสิทธิ์พนักงานแล้ว'}</h1>
      ${disabled ? '<p>ติดต่อเจ้าของร้านหากต้องการใช้งาน</p>' : `
        <p>ให้เจ้าของร้านอนุมัติใน Google Sheet ของร้าน:</p>
        <ol class="howto">
          <li>เปิดชีต <b>Staff</b></li>
          <li>หาแถวชื่อ <b>${esc(S.me.name || '-')}</b></li>
          <li>เปลี่ยน <b>Status</b> เป็น <b>ACTIVE</b> และเลือก <b>Role</b></li>
        </ol>
        <p class="muted small">รหัส LINE ของคุณ: <code>${esc(S.me.userId)}</code>
          <button class="link" data-act="copy-id">${icon('copy', 14)} คัดลอก</button></p>`}
      <button class="btn btn-primary" data-act="reload">${icon('refresh', 18)} ตรวจสอบอีกครั้ง</button>
    </div>`;
}

/* =====================================================
 * หน้าหลักของพนักงาน
 * ===================================================== */
function renderMain(testMode) {
  app.innerHTML = (testMode ? '<div class="test-banner">โหมดทดสอบ — ข้อมูลไม่ใช่ของจริง</div>' : '') + `
    <header class="staff-head">
      <div>
        <div class="staff-shop">${esc(cfg().name)}</div>
        <div class="staff-sub">หน้าพนักงาน · ทุก ${fmtMoney(S.settings.pointRate)} บาท = 1 ${esc(unit())}</div>
      </div>
      <div class="staff-me"><span>${esc(S.me.name)}</span><span class="chip">${esc(ROLE_LABEL[S.me.role] || S.me.role)}</span></div>
    </header>
    <main class="staff-main">
      <section class="card">
        <button class="btn btn-primary btn-xl btn-block" data-act="scan">${icon('scan', 26)} สแกน QR ลูกค้า</button>
        <form id="lookup" class="lookup-row" autocomplete="off">
          <input name="q" placeholder="หรือพิมพ์ รหัสสมาชิก / เบอร์โทร / รหัสคูปอง" autocapitalize="characters" enterkeyhint="search">
          <button class="btn" type="submit" aria-label="ค้นหา">${icon('search', 20)}</button>
        </form>
      </section>
      <div id="result"></div>
      <section class="card">
        <div class="card-head"><h2>รายการล่าสุดของร้าน</h2><button class="link" data-act="recent">${icon('refresh', 14)} รีเฟรช</button></div>
        <div id="recent"><div class="muted small">กำลังโหลด...</div></div>
      </section>
    </main>`;
  document.getElementById('lookup').addEventListener('submit', e => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) lookup(q);
  });
}

function focusSearch() {
  const input = document.querySelector('#lookup input');
  if (input) { input.value = ''; input.focus(); }
}

async function lookup(query) {
  S.flash = null;
  const box = document.getElementById('result');
  box.innerHTML = `<section class="card"><div class="muted">${icon('search', 18)} กำลังค้นหา...</div></section>`;
  try {
    S.view = await S.api.call('staffLookup', { query });
    renderResult();
    const input = document.querySelector('#lookup input');
    if (input) input.value = '';
  } catch (e) {
    S.view = null;
    box.innerHTML = `<section class="card notice notice-err">${icon('alert', 20)} ${esc(e.message)}</section>`;
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* =====================================================
 * ผลการค้นหา: สมาชิก หรือ คูปอง
 * ===================================================== */
function renderResult() {
  const box = document.getElementById('result');
  if (!box) return;
  const v = S.view;
  if (!v) { box.innerHTML = ''; return; }
  box.innerHTML = v.kind === 'coupon' ? couponView(v) : memberView(v);
  const form = document.getElementById('purchase');
  if (form) {
    const amount = form.amount;
    const update = () => {
      const a = parseAmount(amount.value);
      const pts = a > 0 ? Math.floor(a / S.settings.pointRate + 1e-9) : 0;
      document.getElementById('preview').innerHTML = a > 0
        ? `ลูกค้าจะได้ <b>+${fmtNum(pts)}</b> ${esc(unit())}${pts === 0 ? ' (ยอดไม่ถึงเกณฑ์ แต่จะบันทึกยอดซื้อ)' : ''}`
        : `ทุก ${fmtMoney(S.settings.pointRate)} บาท = 1 ${esc(unit())}`;
    };
    amount.addEventListener('input', update);
    form.addEventListener('submit', onPurchaseSubmit);
    update();
    if (!S.flash) amount.focus();
  }
  const adj = document.getElementById('adjust');
  if (adj) adj.addEventListener('submit', onAdjustSubmit);
}

function flashHtml() {
  const f = S.flash;
  if (!f) return '';
  return `<div class="flash ${f.kind}">${icon(f.kind === 'ok' ? 'check' : 'alert', 22)}<div>${f.html}</div></div>`;
}

function memberView(v) {
  const m = v.member;
  const blocked = m.status !== 'ACTIVE';
  return `
    <section class="card result">
      ${flashHtml()}
      <div class="member-row">
        <div class="avatar sm">${icon('user', 22)}</div>
        <div class="grow">
          <div class="m-name">${esc(m.name)}</div>
          <div class="m-sub">${esc(m.memberId)}${m.phoneMasked ? ' · ' + esc(m.phoneMasked) : ''}</div>
        </div>
        <button class="icon-btn" data-act="clear" aria-label="ลูกค้าคนถัดไป">${icon('x')}</button>
      </div>
      <div class="stats">
        <div><b>${fmtNum(m.points)}</b><span>${esc(unit())}คงเหลือ</span></div>
        <div><b>${fmtNum(m.visitCount)}</b><span>ครั้งที่มา</span></div>
        <div><b>฿${fmtMoney(m.totalSpend)}</b><span>ยอดซื้อรวม</span></div>
      </div>
      ${blocked ? `<div class="notice notice-err">${icon('shield', 18)} สมาชิกนี้ถูกระงับ บันทึกแต้มไม่ได้</div>` : `
      <form id="purchase" class="purchase" autocomplete="off">
        <label class="field"><span>ยอดซื้อ (บาท)</span>
          <input name="amount" class="input-xl" inputmode="decimal" placeholder="0" enterkeyhint="done"></label>
        <div class="preview" id="preview"></div>
        <label class="field"><span>หมายเหตุ <small>(ไม่บังคับ เช่น เลขที่บิล)</small></span>
          <input name="note" maxlength="100"></label>
        <button class="btn btn-success btn-block btn-lg" type="submit">${icon('receipt', 20)} บันทึกยอดซื้อ</button>
      </form>`}
      ${v.coupons && v.coupons.length && !blocked ? `
        <div class="sub-head">คูปองที่ใช้ได้ (${v.coupons.length})</div>
        <div class="coupon-list">${v.coupons.map(c => `
          <div class="coupon-mini">
            <div class="grow"><b>${esc(c.name)}</b><div class="m-sub">${esc(c.code)} · ถึง ${fmtDate(c.expiresAt)}</div></div>
            <button class="btn btn-sm" data-act="use-coupon" data-id="${esc(c.code)}">ใช้คูปอง</button>
          </div>`).join('')}</div>` : ''}
      ${isManager() ? `
        <details class="adjust">
          <summary>${icon('coins', 18)} ปรับแต้ม (ผู้จัดการ)</summary>
          <form id="adjust" autocomplete="off">
            <div class="adjust-row">
              <label class="field"><span>จำนวน (+ เพิ่ม / − ลด)</span><input name="points" inputmode="numeric" placeholder="เช่น 50 หรือ -20"></label>
            </div>
            <label class="field"><span>เหตุผล <em>*</em></span><input name="reason" maxlength="150" placeholder="เช่น แก้ยอดที่บันทึกผิด"></label>
            <button class="btn btn-block" type="submit">ปรับแต้ม</button>
          </form>
        </details>` : ''}
    </section>`;
}

function couponView(v) {
  const c = v.coupon;
  const label = { ACTIVE: 'ใช้ได้', USED: 'ใช้แล้ว', EXPIRED: 'หมดอายุ', CANCELLED: 'ยกเลิก' }[c.status] || c.status;
  return `
    <section class="card result">
      ${flashHtml()}
      <div class="member-row">
        <div class="avatar sm">${icon('ticket', 22)}</div>
        <div class="grow"><div class="m-name">${esc(c.name)}</div><div class="m-sub">${esc(c.code)}</div></div>
        <button class="icon-btn" data-act="clear" aria-label="ปิด">${icon('x')}</button>
      </div>
      <dl class="kv">
        <dt>สถานะ</dt><dd><span class="status status-${esc(c.status.toLowerCase())}">${esc(label)}</span></dd>
        <dt>เจ้าของ</dt><dd>${v.member ? esc(v.member.name) + ' · ' + esc(v.member.memberId) : '-'}</dd>
        <dt>ใช้ได้ถึง</dt><dd>${fmtDate(c.expiresAt)}</dd>
        ${c.usedAt ? `<dt>ใช้เมื่อ</dt><dd>${fmtDateTime(c.usedAt)}</dd>` : ''}
      </dl>
      ${c.status === 'ACTIVE'
        ? `<button class="btn btn-success btn-block btn-lg" data-act="use-coupon" data-id="${esc(c.code)}">${icon('check', 20)} ยืนยันใช้คูปอง</button>`
        : ''}
    </section>`;
}

/* =====================================================
 * บันทึกยอดซื้อ
 * ===================================================== */
function parseAmount(s) {
  const n = Number(String(s || '').replace(/[,\s฿]/g, ''));
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function onPurchaseSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const amount = parseAmount(f.amount.value);
  if (!(amount > 0)) return toast('กรุณาใส่ยอดซื้อ', 'err');
  if (amount > S.settings.maxPurchase) return toast(`ยอดเกิน ${fmtNum(S.settings.maxPurchase)} บาทต่อบิล`, 'err');
  const pts = Math.floor(amount / S.settings.pointRate + 1e-9);
  const m = S.view.member;
  S.pendingPurchase = { memberId: m.memberId, amount, note: f.note.value.trim() };

  // ยอดสูงกว่าปกติ → ให้ยืนยันอีกครั้ง (กันพิมพ์เลขเกิน เช่น 5000 แทน 500)
  if (amount >= S.settings.confirmOver) {
    openModal(`
      <div class="modal-head"><h2>ตรวจสอบยอดอีกครั้ง</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
      <div class="confirm-cost"><b>฿${fmtMoney(amount)}</b><span>ยอดซื้อของ ${esc(m.name)}</span>
        <div class="muted">ได้ +${fmtNum(pts)} ${esc(unit())}</div></div>
      <p class="notice">ยอดนี้สูงกว่าปกติ กรุณาตรวจตัวเลขให้ถูกต้องก่อนบันทึก</p>
      <div class="modal-actions">
        <button class="btn" data-act="close">แก้ไข</button>
        <button class="btn btn-success" data-act="purchase-confirm">ถูกต้อง บันทึก</button>
      </div>`);
    return;
  }
  doPurchase(f.querySelector('button[type="submit"]'));
}

async function doPurchase(btn) {
  const p = S.pendingPurchase;
  if (!p) return;
  setBusy(btn, true);
  try {
    const key = ['purchase', p.memberId, p.amount, p.note].join('|');
    const r = await withRequestId(key, rid => S.api.call('addPurchase', { ...p, requestId: rid }));
    closeModal();
    S.pendingPurchase = null;
    if (r.member) S.view.member = r.member;
    S.flash = r.duplicate
      ? { kind: 'warn', html: 'รายการนี้บันทึกไปแล้ว (ระบบไม่บันทึกซ้ำ)' }
      : { kind: 'ok', html: `บันทึก ฿${fmtMoney(r.amount)} → <b>+${fmtNum(r.pointsAdded)} ${esc(unit())}</b> · คงเหลือ ${fmtNum(r.balance)}` };
    renderResult();
    toast('บันทึกแล้ว', 'ok');
    loadRecent();
  } catch (e) {
    setBusy(btn, false);
    toast(e.code === 'NETWORK' ? e.message + ' (กดบันทึกอีกครั้งได้ ระบบจะไม่บันทึกซ้ำ)' : e.message, 'err');
  }
}

/* =====================================================
 * ใช้คูปอง
 * ===================================================== */
function findCoupon(code) {
  const v = S.view;
  if (!v) return null;
  if (v.kind === 'coupon') return v.coupon.code === code ? v.coupon : null;
  return (v.coupons || []).find(c => c.code === code) || null;
}

function confirmUseCoupon(code) {
  const c = findCoupon(code);
  if (!c) return;
  openModal(`
    <div class="modal-head"><h2>ยืนยันใช้คูปอง</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <div class="confirm-title">${esc(c.name)}</div>
    <p class="muted">${esc(c.code)} · ใช้แล้วจะนำกลับมาใช้อีกไม่ได้</p>
    <div class="modal-actions">
      <button class="btn" data-act="close">ยกเลิก</button>
      <button class="btn btn-success" data-act="use-coupon-confirm" data-id="${esc(c.code)}">ยืนยันใช้คูปอง</button>
    </div>`);
}

async function doUseCoupon(code, btn) {
  setBusy(btn, true, 'กำลังบันทึก...');
  try {
    const r = await withRequestId('coupon|' + code, rid => S.api.call('useCoupon', { code, requestId: rid }));
    closeModal();
    if (S.view.kind === 'coupon') {
      S.view.coupon = r.coupon;
    } else {
      S.view.coupons = (S.view.coupons || []).filter(c => c.code !== code);
    }
    S.flash = { kind: 'ok', html: `ใช้คูปอง <b>${esc(r.coupon.name)}</b> แล้ว — มอบของ/ส่วนลดให้ลูกค้าได้เลย` };
    renderResult();
    toast('ใช้คูปองแล้ว', 'ok');
  } catch (e) {
    setBusy(btn, false);
    closeModal();
    toast(e.message, 'err');
  }
}

/* =====================================================
 * ปรับแต้ม (OWNER / ADMIN — Apps Script ตรวจสิทธิ์ซ้ำอีกชั้น)
 * ===================================================== */
function onAdjustSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const points = Number(String(f.points.value).replace(/[,\s]/g, '').replace('−', '-'));
  const reason = f.reason.value.trim();
  if (!Number.isInteger(points) || points === 0) return toast('ใส่จำนวนแต้มเป็นจำนวนเต็ม เช่น 50 หรือ -20', 'err');
  if (reason.length < 3) return toast('กรุณาใส่เหตุผล', 'err');
  const m = S.view.member;
  S.pendingAdjust = { memberId: m.memberId, points, reason };
  openModal(`
    <div class="modal-head"><h2>ยืนยันปรับแต้ม</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <div class="confirm-cost"><b>${points > 0 ? '+' : ''}${fmtNum(points)}</b><span>${esc(unit())} · ${esc(m.name)}</span>
      <div class="muted">คงเหลือ ${fmtNum(m.points)} → ${fmtNum(m.points + points)}</div></div>
    <p class="muted">เหตุผล: ${esc(reason)}</p>
    <div class="modal-actions">
      <button class="btn" data-act="close">ยกเลิก</button>
      <button class="btn btn-primary" data-act="adjust-confirm">ยืนยัน</button>
    </div>`);
}

async function doAdjust(btn) {
  const p = S.pendingAdjust;
  if (!p) return;
  setBusy(btn, true);
  try {
    const key = ['adjust', p.memberId, p.points, p.reason].join('|');
    const r = await withRequestId(key, rid => S.api.call('adjustPoints', { ...p, requestId: rid }));
    closeModal();
    S.pendingAdjust = null;
    if (r.member) S.view.member = r.member;
    S.flash = { kind: 'ok', html: `ปรับ ${r.pointsAdded > 0 ? '+' : ''}${fmtNum(r.pointsAdded)} ${esc(unit())} · คงเหลือ ${fmtNum(r.balance)}` };
    renderResult();
    loadRecent();
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * รายการล่าสุด
 * ===================================================== */
async function loadRecent() {
  const box = document.getElementById('recent');
  if (!box) return;
  try {
    const r = await S.api.call('staffRecent');
    box.innerHTML = r.items.length ? `<div class="recent">${r.items.map(t => `
      <div class="recent-row">
        <div class="grow">
          <b>${esc(t.memberName || t.memberId)}</b>
          <div class="m-sub">${esc(TX_LABEL[t.type] || t.type)}${t.type === 'EARN' ? ' ฿' + fmtMoney(t.amount) : ''} · ${fmtDateTime(t.date)}${t.staff ? ' · ' + esc(t.staff) : ''}</div>
        </div>
        <div class="tx-points ${t.points > 0 ? 'plus' : t.points < 0 ? 'minus' : ''}">${t.points > 0 ? '+' : ''}${fmtNum(t.points)}</div>
      </div>`).join('')}</div>` : '<div class="muted small">ยังไม่มีรายการ</div>';
  } catch (e) {
    box.innerHTML = `<div class="muted small">${esc(e.message)}</div>`;
  }
}

/* =====================================================
 * สแกน QR: กล้องของแอป LINE ก่อน → ไม่ได้ก็ใช้กล้องผ่านเว็บ (html5-qrcode แบบเดียวกับหน้าสแกนคอนเสิร์ต)
 * ===================================================== */
async function scan() {
  if (S.line.scanCode) {
    try {
      const value = await S.line.scanCode();
      if (value) lookup(value);
      return;
    } catch (e) {
      console.warn('LINE scan ใช้ไม่ได้ ใช้กล้องผ่านเว็บแทน', e);
    }
  }
  openCamera();
}

async function openCamera() {
  const box = openModal(`
    <div class="modal-head"><h2>สแกน QR ลูกค้า</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <div id="reader" class="reader"><div class="muted center">กำลังเปิดกล้อง...</div></div>
    <p class="muted center small">ส่อง QR สมาชิกหรือ QR คูปองให้อยู่ในกรอบ</p>`, { onClose: stopCamera });
  try {
    await loadScript(SCANNER_JS);
    if (!document.getElementById('reader')) return; // ปิดป๊อปอัปไปก่อนกล้องเปิด
    S.scanner = new window.Html5Qrcode('reader');
    await S.scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
      text => { closeModal(); lookup(text); },
      () => {}
    );
  } catch (e) {
    const reader = box.querySelector('#reader');
    if (reader) reader.innerHTML = `<div class="notice notice-err">เปิดกล้องไม่ได้ — อนุญาตการใช้กล้อง หรือพิมพ์รหัสในช่องค้นหาแทน<br><small>${esc(e && e.message ? e.message : e)}</small></div>`;
  }
}

function stopCamera() {
  const s = S.scanner;
  S.scanner = null;
  if (s && s.isScanning) s.stop().catch(() => {});
}

function copyText(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('คัดลอกแล้ว', 'ok'), () => toast(text));
  else toast(text);
}
