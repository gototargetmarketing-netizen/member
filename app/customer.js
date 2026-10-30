// หน้าลูกค้า: สมัครสมาชิก บัตรสมาชิก + QR แลกของรางวัล คูปอง ประวัติแต้ม
// ทุกร้านใช้ไฟล์นี้ร่วมกัน — ข้อความ/สี/โลโก้มาจาก shops/<ร้าน>/config.js
import { loadShop } from './shop.js';
import { initLine, IS_LOCAL } from './line.js';
import { createApi, createRetryKeeper } from './api.js';
import { applyDevParams, mountDevBar } from './devbar.js';
import { esc, icon, toast, openModal, closeModal, fmtNum, fmtMoney, fmtDate, fmtDateTime, qrSvg, setBusy } from './ui.js';

const app = document.getElementById('app');
const PAGES = ['home', 'rewards', 'coupons', 'history', 'collect'];
const S = { shop: null, line: null, api: null, data: null, page: 'home', histFilter: 'all', couponTab: 'active' };
const withRequestId = createRetryKeeper();

const cfg = () => S.shop.config;
const T = (key, fallback) => (cfg().texts && cfg().texts[key]) || fallback;
const unit = () => T('pointUnit', 'แต้ม');

document.addEventListener('click', onClick);
window.addEventListener('hashchange', () => { S.page = pageFromHash(); closeModal(); if (S.data) render(); window.scrollTo(0, 0); });
main();

async function main() {
  try {
    S.shop = await loadShop();
    applyDevParams(S.shop.id);
    renderBoot();
    S.line = await initLine(cfg().liffId);
    S.api = createApi(S.shop, S.line);
    if (IS_LOCAL) mountDevBar(S.shop, S.api, { openNow: !S.api.overridden });
    S.page = pageFromHash();
    await refresh();
  } catch (e) {
    renderError(e);
  }
}

async function refresh() {
  S.data = await S.api.call('bootstrap');
  render();
}

function pageFromHash() {
  const p = window.location.hash.slice(1);
  return PAGES.includes(p) ? p : 'home';
}

function go(page) {
  if (page === S.page) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  window.location.hash = page;
}

/* =====================================================
 * การกดปุ่ม (ปุ่มทุกปุ่มใช้ data-act แทน onclick ในข้อความ HTML เพื่อกันฝังโค้ด)
 * ===================================================== */
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'go': e.preventDefault(); closeModal(); go(el.dataset.page); break;
    case 'qr': showMemberQr(); break;
    case 'redeem': confirmRedeem(id); break;
    case 'redeem-confirm': doRedeem(id, el); break;
    case 'coupon-qr': showCouponQr(id); break;
    case 'coupon-tab': S.couponTab = el.dataset.tab; render(); break;
    case 'hist': S.histFilter = el.dataset.filter; render(); break;
    case 'privacy': showPrivacy(); break;
    case 'close': closeModal(); break;
    case 'reload': window.location.reload(); break;
    case 'relogin': if (S.line) S.line.relogin(); break;
  }
}

/* =====================================================
 * หน้าระหว่างโหลด / ผิดพลาด
 * ===================================================== */
function renderBoot() {
  app.innerHTML = `<div class="boot">${logoHtml('logo-lg')}<div class="boot-name">${esc(cfg().name)}</div><div class="spinner"></div></div>`;
}

function renderError(e) {
  const code = e && e.code;
  const hint = code === 'NO_API' && IS_LOCAL
    ? '<p class="muted">กดปุ่ม "🧪 ทดสอบ" มุมซ้ายล่าง แล้วใส่ URL Apps Script ทดสอบ</p>'
    : code === 'TEST_DISABLED' && IS_LOCAL
      ? '<p class="muted">URL นี้ไม่ใช่ Apps Script ทดสอบ (หรือยังไม่ได้รัน enableTestMode) — ตั้ง URL ทดสอบในแผง "🧪 ทดสอบ"</p>'
      : '';
  app.innerHTML = `
    <div class="state-page">
      <div class="state-icon">${icon('alert', 40)}</div>
      <h1>เปิดไม่สำเร็จ</h1>
      <p>${esc((e && e.message) || 'เกิดข้อผิดพลาด')}</p>
      ${hint}
      ${IS_LOCAL && e && e.debug ? `<pre class="debug">${esc(e.debug)}</pre>` : ''}
      <div class="stack">
        ${code === 'TOKEN_INVALID' ? '<button class="btn btn-primary" data-act="relogin">เข้าสู่ระบบใหม่</button>' : ''}
        ${code === 'NO_SHOP' ? '' : '<button class="btn" data-act="reload">ลองใหม่</button>'}
      </div>
    </div>`;
  if (IS_LOCAL && S.shop && !document.getElementById('devbar')) {
    mountDevBar(S.shop, S.api || { url: '', overridden: false }, { openNow: true });
  }
}

function testBanner() {
  return S.data && S.data.testMode ? '<div class="test-banner">โหมดทดสอบ — ข้อมูลไม่ใช่ของจริง</div>' : '';
}

/* =====================================================
 * โครงหน้า
 * ===================================================== */
function render() {
  const d = S.data;
  if (!d.member) return renderRegister();
  if (d.member.status !== 'ACTIVE') {
    app.innerHTML = testBanner() + `
      <div class="state-page">
        <div class="state-icon">${icon('shield', 40)}</div>
        <h1>บัญชีสมาชิกถูกระงับ</h1>
        <p>กรุณาติดต่อร้าน ${esc(cfg().name)}</p>
      </div>`;
    return;
  }
  const body = { home: pageHome, rewards: pageRewards, coupons: pageCoupons, history: pageHistory, collect: pageCollect }[S.page] || pageHome;
  app.innerHTML = testBanner() + `<main class="screen">${body()}</main>${nav()}`;
}

function nav() {
  const active = S.data.coupons.filter(c => c.status === 'ACTIVE').length;
  const items = [
    ['home', 'home', 'หน้าแรก'],
    ['rewards', 'gift', 'แลกของรางวัล'],
    ['coupons', 'ticket', 'คูปอง'],
    ['history', 'clock', 'ประวัติ']
  ];
  return `<nav class="nav">${items.map(([page, ic, label]) => `
    <button class="nav-btn ${S.page === page ? 'active' : ''}" data-act="go" data-page="${page}">
      <span class="nav-icon">${icon(ic, 22)}${page === 'coupons' && active ? `<b class="badge">${active}</b>` : ''}</span>${label}
    </button>`).join('')}</nav>`;
}

function pageHead(title, right = '') {
  return `<header class="page-head">
    <button class="back" data-act="go" data-page="home" aria-label="กลับหน้าแรก">${icon('left', 22)}</button>
    <h1>${esc(title)}</h1><div class="page-head-right">${right}</div>
  </header>`;
}

function logoHtml(cls = '') {
  const c = cfg();
  const src = c.logo ? S.shop.asset(c.logo) : '';
  return src
    ? `<img class="logo ${cls}" src="${esc(src)}" alt="${esc(c.name)}">`
    : `<div class="logo logo-text ${cls}">${esc(c.logoText || (c.name || '?').slice(0, 1))}</div>`;
}

function avatarHtml() {
  const pic = (S.data.member && S.data.member.picture) || S.data.profile.picture;
  return pic ? `<img src="${esc(pic)}" alt="">` : icon('user', 24);
}

/* =====================================================
 * สมัครสมาชิก
 * ===================================================== */
function renderRegister() {
  const p = S.data.profile;
  const welcome = S.data.settings.welcomePoints;
  const today = new Date().toISOString().slice(0, 10);
  app.innerHTML = testBanner() + `
    <main class="screen register">
      <div class="reg-hero">
        ${logoHtml('logo-lg')}
        <h1>${esc(T('registerTitle', 'สมัครสมาชิก ' + cfg().name))}</h1>
        <p>${esc(T('registerSubtitle', 'สะสม' + unit() + 'ทุกครั้งที่ซื้อ แลกของรางวัลและสิทธิพิเศษ'))}</p>
        ${welcome > 0 ? `<div class="chip chip-accent">${icon('gift', 16)} รับทันที ${fmtNum(welcome)} ${esc(unit())} เมื่อสมัคร</div>` : ''}
      </div>
      <form id="reg" class="card form" novalidate>
        <label class="field"><span>ชื่อ</span>
          <input name="name" maxlength="60" value="${esc(p.name)}" autocomplete="name"></label>
        <label class="field"><span>เบอร์โทรศัพท์ <em>*</em></span>
          <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" maxlength="15"></label>
        <label class="field"><span>วันเกิด <small>(ไม่บังคับ — ใช้มอบสิทธิพิเศษเดือนเกิด)</small></span>
          <input name="birthDate" type="date" max="${today}"></label>
        <label class="check"><input type="checkbox" name="consentPrivacy">
          <span>ฉันยอมรับ<button type="button" class="link" data-act="privacy">นโยบายความเป็นส่วนตัว</button>ของร้าน <em>*</em></span></label>
        <label class="check"><input type="checkbox" name="consentMarketing">
          <span>ยินดีรับข่าวสารและโปรโมชันทาง LINE (ยกเลิกได้ทุกเมื่อ)</span></label>
        <div class="form-error" id="reg-error" hidden></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">สมัครสมาชิก</button>
      </form>
    </main>`;
  document.getElementById('reg').addEventListener('submit', onRegister);
}

async function onRegister(e) {
  e.preventDefault();
  const f = e.target;
  const errBox = document.getElementById('reg-error');
  const showErr = (msg) => { errBox.textContent = msg; errBox.hidden = !msg; };
  const phone = f.phone.value.replace(/\D/g, '');
  if (!/^(0\d{8,9}|66\d{9})$/.test(phone)) return showErr('กรุณากรอกเบอร์โทรให้ถูกต้อง เช่น 0812345678');
  if (!f.consentPrivacy.checked) return showErr('กรุณายอมรับนโยบายความเป็นส่วนตัว');
  showErr('');

  const btn = f.querySelector('button[type="submit"]');
  setBusy(btn, true, 'กำลังสมัคร...');
  try {
    const r = await S.api.call('register', {
      name: f.name.value.trim(),
      phone,
      birthDate: f.birthDate.value,
      consentPrivacy: true,
      consentMarketing: f.consentMarketing.checked
    });
    await refresh();
    if (r.welcomePoints > 0) {
      openModal(`
        <div class="modal-center">
          <div class="big-icon ok">${icon('gift', 34)}</div>
          <h2>ยินดีต้อนรับ!</h2>
          <p>คุณได้รับ <b>${fmtNum(r.welcomePoints)} ${esc(unit())}</b> ต้อนรับสมาชิกใหม่</p>
          <button class="btn btn-primary btn-block" data-act="close">เริ่มใช้งาน</button>
        </div>`);
    } else {
      toast('สมัครสมาชิกสำเร็จ', 'ok');
    }
  } catch (err) {
    setBusy(btn, false);
    showErr(err.message);
  }
}

function showPrivacy() {
  const legal = cfg().legal || {};
  if (legal.privacyUrl && /^https:\/\//.test(legal.privacyUrl)) {
    window.open(legal.privacyUrl, '_blank', 'noopener');
    return;
  }
  openModal(`
    <div class="modal-head"><h2>นโยบายความเป็นส่วนตัว</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <p class="prose">${esc(legal.privacyText || 'ร้านยังไม่ได้ใส่นโยบายความเป็นส่วนตัว')}</p>
    <button class="btn btn-block" data-act="close">ปิด</button>`);
}

/* =====================================================
 * หน้าแรก
 * ===================================================== */
function pageHome() {
  const m = S.data.member;
  const active = S.data.coupons.filter(c => c.status === 'ACTIVE').length;
  const quick = [
    ['collect', 'up', 'วิธีสะสม' + unit()],
    ['rewards', 'gift', 'แลกของรางวัล'],
    ['coupons', 'ticket', active ? `คูปอง (${active})` : 'คูปองของฉัน'],
    ['history', 'clock', 'ประวัติ']
  ];
  return `
    <header class="hero">
      <div class="hero-row">
        <div class="avatar">${avatarHtml()}</div>
        <div class="hero-text">
          <div class="hello">${esc(T('greeting', 'สวัสดี'))}</div>
          <div class="hero-name">${esc(m.name)}</div>
        </div>
        ${logoHtml('logo-sm')}
      </div>
    </header>
    ${memberCard(m)}
    <section class="section">
      <div class="quick">${quick.map(([page, ic, label]) => `
        <button data-act="go" data-page="${page}"><span class="quick-icon">${icon(ic, 22)}</span><span>${esc(label)}</span></button>`).join('')}
      </div>
    </section>
    ${promos()}
    ${S.data.rewards.length ? `
      <section class="section">
        <div class="section-head"><h2>ของรางวัล</h2><button class="link" data-act="go" data-page="rewards">ดูทั้งหมด ${icon('right', 14)}</button></div>
        <div class="rewards-grid">${S.data.rewards.slice(0, 4).map(rewardCard).join('')}</div>
      </section>` : ''}`;
}

function memberCard(m) {
  const tiers = cfg().features && cfg().features.tiers;
  return `
    <section class="member-card">
      <div class="mc-top">
        <div><div class="mc-label">${esc(T('cardLabel', 'บัตรสมาชิก'))}</div><div class="mc-shop">${esc(cfg().name)}</div></div>
        ${tiers && m.tier ? `<span class="mc-tier">${esc(m.tier)}</span>` : ''}
      </div>
      <div class="mc-mid">
        <div>
          <div class="mc-label">${esc(unit())}สะสม</div>
          <div class="mc-points">${fmtNum(m.points)}<small>${esc(unit())}</small></div>
        </div>
        <button class="mc-qr" data-act="qr">${icon('qr', 26)}<span>แสดง QR</span></button>
      </div>
      <div class="mc-bottom">
        <div><span>รหัสสมาชิก</span><b>${esc(m.memberId)}</b></div>
        <div class="right"><span>สมาชิกตั้งแต่</span><b>${fmtDate(m.joinedAt)}</b></div>
      </div>
    </section>`;
}

function promos() {
  const list = S.data.promos;
  if (!list.length) return '';
  return `
    <section class="section">
      <div class="section-head"><h2>${esc(T('promoTitle', 'สิทธิพิเศษสำหรับคุณ'))}</h2></div>
      <div class="promo-track">${list.map(p => {
        const inner = `
          ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}
          <div class="promo-text">
            ${p.tag ? `<span class="promo-tag">${esc(p.tag)}</span>` : ''}
            <div class="promo-title">${esc(p.title)}</div>
            ${p.subtitle ? `<div class="promo-sub">${esc(p.subtitle)}</div>` : ''}
          </div>`;
        return p.link
          ? `<a class="promo-card" href="${esc(p.link)}" target="_blank" rel="noopener">${inner}</a>`
          : `<div class="promo-card">${inner}</div>`;
      }).join('')}</div>
    </section>`;
}

function showMemberQr() {
  const m = S.data.member;
  openModal(`
    <div class="modal-head"><h2>QR สมาชิก</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <div class="qr-box">${qrSvg(m.memberId)}<div class="qr-code-text">${esc(m.memberId)}</div></div>
    <p class="muted center">แสดง QR นี้ให้พนักงานสแกน เพื่อสะสม${esc(unit())}หรือใช้คูปอง</p>`);
}

/* =====================================================
 * แลกของรางวัล
 * ===================================================== */
function rewardCard(r) {
  const pts = S.data.member.points;
  const soldOut = r.remaining === 0;
  const can = !soldOut && pts >= r.points;
  const label = soldOut ? 'หมดแล้ว' : can ? 'แลกของรางวัล' : `ขาดอีก ${fmtNum(r.points - pts)}`;
  return `
    <article class="reward">
      <div class="reward-img">
        ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : `<div class="reward-ph">${icon('gift', 34)}</div>`}
        <span class="reward-cost">${fmtNum(r.points)} ${esc(unit())}</span>
      </div>
      <div class="reward-body">
        <h3>${esc(r.name)}</h3>
        ${r.description ? `<p>${esc(r.description)}</p>` : ''}
        ${r.remaining != null && r.remaining > 0 && r.remaining <= 10 ? `<div class="reward-left">เหลือ ${fmtNum(r.remaining)} สิทธิ์</div>` : ''}
        <button class="btn btn-primary btn-sm btn-block" data-act="redeem" data-id="${esc(r.id)}" ${can ? '' : 'disabled'}>${label}</button>
      </div>
    </article>`;
}

function pageRewards() {
  const list = S.data.rewards;
  return pageHead('แลกของรางวัล', `<span class="chip">${fmtNum(S.data.member.points)} ${esc(unit())}</span>`) + `
    <section class="section">
      ${list.length
        ? `<div class="rewards-grid">${list.map(rewardCard).join('')}</div>`
        : `<div class="empty">${icon('gift', 36)}<p>ยังไม่มีของรางวัลในตอนนี้</p></div>`}
    </section>`;
}

function confirmRedeem(id) {
  const r = S.data.rewards.find(x => x.id === id);
  if (!r) return;
  const pts = S.data.member.points;
  openModal(`
    <div class="modal-head"><h2>ยืนยันการแลก</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <div class="confirm-title">${esc(r.name)}</div>
    <div class="confirm-cost"><b>${fmtNum(r.points)}</b><span>${esc(unit())}ที่ใช้</span>
      <div class="muted">คงเหลือ ${fmtNum(pts)} → ${fmtNum(pts - r.points)} ${esc(unit())}</div></div>
    <p class="muted">หลังแลก คุณจะได้คูปองในหน้า "คูปอง" ให้แสดง QR คูปองกับพนักงานเพื่อรับของ</p>
    <div class="form-error" id="redeem-error" hidden></div>
    <div class="modal-actions">
      <button class="btn" data-act="close">ยกเลิก</button>
      <button class="btn btn-primary" data-act="redeem-confirm" data-id="${esc(r.id)}">ยืนยันการแลก</button>
    </div>`);
}

async function doRedeem(id, btn) {
  setBusy(btn, true, 'กำลังแลก...');
  try {
    const r = await withRequestId('redeem:' + id, rid => S.api.call('redeem', { rewardId: id, requestId: rid }));
    await refresh();
    const coupon = r.coupon;
    openModal(`
      <div class="modal-center">
        <div class="big-icon ok">${icon('check', 34)}</div>
        <h2>แลกสำเร็จ!</h2>
        ${coupon ? `<p><b>${esc(coupon.name)}</b><br><span class="muted">ใช้ได้ถึง ${fmtDate(coupon.expiresAt)}</span></p>` : '<p>รายการนี้แลกไปแล้ว</p>'}
        <div class="stack">
          ${coupon ? `<button class="btn btn-primary btn-block" data-act="coupon-qr" data-id="${esc(coupon.code)}">${icon('qr', 18)} แสดง QR คูปองเลย</button>` : ''}
          <button class="btn btn-block" data-act="go" data-page="coupons">ไปหน้าคูปอง</button>
        </div>
      </div>`);
  } catch (e) {
    setBusy(btn, false);
    const box = document.getElementById('redeem-error');
    if (box) { box.textContent = e.message; box.hidden = false; } else toast(e.message, 'err');
  }
}

/* =====================================================
 * คูปอง
 * ===================================================== */
function pageCoupons() {
  const all = S.data.coupons;
  const active = all.filter(c => c.status === 'ACTIVE');
  const past = all.filter(c => c.status !== 'ACTIVE');
  const list = S.couponTab === 'past' ? past : active;
  const tabs = `
    <div class="tabs">
      <button class="${S.couponTab !== 'past' ? 'active' : ''}" data-act="coupon-tab" data-tab="active">ใช้ได้ (${active.length})</button>
      <button class="${S.couponTab === 'past' ? 'active' : ''}" data-act="coupon-tab" data-tab="past">ใช้แล้ว/หมดอายุ</button>
    </div>`;
  return pageHead('คูปองของฉัน') + `<section class="section">${tabs}
    ${list.length ? list.map(couponCard).join('') : `
      <div class="empty">${icon('ticket', 36)}<p>${S.couponTab === 'past' ? 'ยังไม่มีคูปองที่ใช้แล้ว' : 'ยังไม่มีคูปอง'}</p>
        ${S.couponTab === 'past' ? '' : `<button class="btn btn-primary" data-act="go" data-page="rewards">แลกของรางวัลด้วย${esc(unit())}</button>`}
      </div>`}
  </section>`;
}

function couponCard(c) {
  const label = { ACTIVE: 'ใช้ได้', USED: 'ใช้แล้ว', EXPIRED: 'หมดอายุ', CANCELLED: 'ยกเลิก' }[c.status] || c.status;
  const meta = c.status === 'ACTIVE' ? 'ใช้ได้ถึง ' + fmtDate(c.expiresAt)
    : c.status === 'USED' ? 'ใช้เมื่อ ' + fmtDateTime(c.usedAt)
      : 'หมดอายุ ' + fmtDate(c.expiresAt);
  return `
    <article class="coupon ${c.status === 'ACTIVE' ? '' : 'is-past'}">
      <div class="coupon-side">${icon('ticket', 26)}<span>${esc(label)}</span></div>
      <div class="coupon-body">
        <h3>${esc(c.name)}</h3>
        <div class="coupon-meta">${esc(meta)}</div>
        <div class="coupon-code">${esc(c.code)}</div>
        ${c.status === 'ACTIVE' ? `<button class="btn btn-primary btn-sm" data-act="coupon-qr" data-id="${esc(c.code)}">${icon('qr', 16)} แสดง QR ให้พนักงาน</button>` : ''}
      </div>
    </article>`;
}

function showCouponQr(code) {
  const c = S.data.coupons.find(x => x.code === code);
  if (!c) return;
  openModal(`
    <div class="modal-head"><h2>${esc(c.name)}</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <div class="qr-box">${qrSvg(c.code)}<div class="qr-code-text">${esc(c.code)}</div></div>
    <p class="muted center">ให้พนักงานสแกน QR นี้เพื่อใช้คูปอง<br>คูปองจะถูกใช้เมื่อพนักงานยืนยันเท่านั้น · ใช้ได้ถึง ${fmtDate(c.expiresAt)}</p>`,
  { onClose: () => { refresh().catch(() => {}); } }); // พนักงานอาจเพิ่งใช้คูปองไป → โหลดสถานะใหม่
}

/* =====================================================
 * ประวัติแต้ม
 * ===================================================== */
const TX_LABEL = { EARN: 'สะสมจากการซื้อ', WELCOME: 'แต้มต้อนรับ', REDEEM: 'แลกของรางวัล', ADJUST: 'ปรับโดยร้าน' };
const TX_ICON = { EARN: 'up', WELCOME: 'star', REDEEM: 'gift', ADJUST: 'coins' };

function pageHistory() {
  const all = S.data.history;
  const list = all.filter(t => S.histFilter === 'all' || (S.histFilter === 'earn' ? t.points > 0 : t.points < 0));
  const filters = [['all', 'ทั้งหมด'], ['earn', 'ได้รับ'], ['use', 'ใช้ไป']];
  return pageHead('ประวัติ' + unit()) + `
    <section class="section">
      <div class="balance-box"><span>${esc(unit())}คงเหลือ</span><b>${fmtNum(S.data.member.points)}</b></div>
      <div class="chips">${filters.map(([k, label]) => `<button class="chip-btn ${S.histFilter === k ? 'active' : ''}" data-act="hist" data-filter="${k}">${label}</button>`).join('')}</div>
      ${list.length ? `<div class="tx-list">${list.map(t => `
        <div class="tx">
          <div class="tx-icon">${icon(TX_ICON[t.type] || 'coins', 20)}</div>
          <div class="tx-main">
            <div class="tx-title">${esc(t.detail || TX_LABEL[t.type] || t.type)}</div>
            <div class="tx-sub">${esc(TX_LABEL[t.type] || t.type)} · ${fmtDateTime(t.date)}</div>
          </div>
          <div class="tx-points ${t.points > 0 ? 'plus' : t.points < 0 ? 'minus' : ''}">${t.points > 0 ? '+' : ''}${fmtNum(t.points)}</div>
        </div>`).join('')}</div>
        <p class="muted center small">แสดงรายการล่าสุด ${fmtNum(all.length)} รายการ</p>`
      : `<div class="empty">${icon('clock', 36)}<p>ยังไม่มีประวัติ</p></div>`}
    </section>`;
}

/* =====================================================
 * วิธีสะสมแต้ม
 * ===================================================== */
function pageCollect() {
  const rate = S.data.settings.pointRate;
  const steps = cfg().howTo || [
    { title: 'แสดง QR สมาชิกตอนชำระเงิน', text: 'กดปุ่ม "แสดง QR" ที่บัตรสมาชิก แล้วให้พนักงานสแกน' },
    { title: 'รับ' + unit() + 'อัตโนมัติ', text: 'ระบบคำนวณจากยอดซื้อให้ทันที ดูได้ในหน้าประวัติ' },
    { title: 'แลกของรางวัล', text: 'ใช้' + unit() + 'แลกของรางวัล แล้วแสดง QR คูปองให้พนักงาน' }
  ];
  return pageHead('วิธีสะสม' + unit()) + `
    <section class="section">
      <div class="collect-hero">
        <div class="muted-on-dark">ทุกยอดซื้อ</div>
        <div class="collect-rate">${fmtMoney(rate)} บาท = 1 ${esc(unit())}</div>
        <button class="btn btn-accent" data-act="qr">${icon('qr', 18)} แสดง QR ของฉัน</button>
      </div>
      <ol class="steps">${steps.map((s, i) => `
        <li><span class="step-no">${i + 1}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div></li>`).join('')}
      </ol>
    </section>`;
}
