// หน้าลูกค้า: สมัครสมาชิก บัตรสมาชิก + QR แลกของรางวัล คูปอง ประวัติแต้ม
// ทุกร้านใช้ไฟล์นี้ร่วมกัน — ข้อความ/สี/โลโก้มาจาก shops/<ร้าน>/config.js
import { loadShop, applyBrand, textOn, contrast, shade } from './shop.js';
import { tierBanner } from './tier.js';
import { initLine, IS_LOCAL } from './line.js';
import { createApi, createRetryKeeper } from './api.js';
import { applyDevParams, mountDevBar } from './devbar.js';
import { esc, icon, toast, openModal, closeModal, fmtNum, fmtMoney, fmtDate, fmtDateTime, qrSvg, setBusy, creditHtml, bootHtml } from './ui.js';

const app = document.getElementById('app');
const PAGES = ['home', 'rewards', 'coupons', 'history', 'collect', 'profile', 'tiers'];
const S = { shop: null, line: null, api: null, data: null, page: 'home', histFilter: 'all', couponTab: 'active', ready: false, stale: false };
const withRequestId = createRetryKeeper();

const cfg = () => S.shop.config;
const T = (key, fallback) => (cfg().texts && cfg().texts[key]) || fallback;
const unit = () => T('pointUnit', 'แต้ม');

document.addEventListener('click', onClick);
document.addEventListener('input', onPhoneInput);
document.addEventListener('change', onConsentToggle);
// กลับมาจากหน้าเพิ่มเพื่อนของ LINE → ตรวจใหม่เอง (หน้าเพิ่มเพื่อนก่อนสมัคร / การ์ดชวนเพิ่มเพื่อนบนหน้าแรก)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.ready && document.querySelector('.gate-card, .oa-card')) checkFriend(null);
});
window.addEventListener('hashchange', () => { S.page = pageFromHash(); closeModal(); if (S.data) render(); window.scrollTo(0, 0); });
main();

async function main() {
  try {
    S.shop = await loadShop();
    applyDevParams(S.shop.id);
    captureJoinBranch();
    renderBoot();
    S.line = await initLine(cfg().liffId);
    S.api = createApi(S.shop, S.line, {
      beforeRelogin: saveRegisterDraft,
      onRelogin: () => renderBoot('กำลังเชื่อมต่อ LINE ใหม่...'),
      // ตอนเปิดหน้าครั้งแรกมีหน้าโหลดเต็มจอ (หรือบัตรจากครั้งก่อน) อยู่แล้ว ไม่ต้องขึ้นป๊อปอัปซ้อน
      loadingText: (action) => (!S.ready ? null : LOADING_TEXT[action] || 'กำลังโหลด...')
    });
    if (IS_LOCAL) mountDevBar(S.shop, S.api, { openNow: !S.api.overridden });
    S.page = pageFromHash();
    // โชว์บัตรสมาชิกจากครั้งก่อนทันที แล้วค่อยอัปเดตเมื่อข้อมูลใหม่มาถึง (Apps Script ใช้เวลา 2–4 วินาที)
    const cached = readCache();
    if (cached) {
      S.data = cached;
      S.stale = true;
      render();
    }
    try {
      await refresh();
    } catch (e) {
      // มีบัตรจากครั้งก่อนให้ดูอยู่แล้ว → แจ้งเตือนเฉยๆ ไม่ต้องเปลี่ยนเป็นหน้าผิดพลาด
      if (!S.stale) throw e;
      toast('อัปเดตข้อมูลไม่สำเร็จ: ' + e.message, 'err');
    }
    S.ready = true;
  } catch (e) {
    renderError(e);
  }
}

const LOADING_TEXT = { register: 'กำลังสมัครสมาชิก...', redeem: 'กำลังแลกของรางวัล...', updateProfile: 'กำลังบันทึก...', claimBirthday: 'กำลังรับของขวัญ...' };

/* ---------- สาขาที่ลูกค้าสแกน QR สมัครสมาชิก (ลิงก์ ...?branch=B001) ----------
 * จำไว้ในเครื่องจนกว่าจะสมัครเสร็จ: ระหว่างนั้นหน้าอาจโหลดใหม่หลายรอบ (LINE พาไปเข้าสู่ระบบ / เชื่อมต่อใหม่)
 * หรือลูกค้าสแกนที่ร้านแล้วกลับไปสมัครที่บ้าน — Apps Script ตรวจเองว่าสาขามีจริงและยังเปิดอยู่ */
const JOIN_BRANCH_DAYS = 30;
const joinKey = () => 'crm_join_branch:' + S.shop.id;

function captureJoinBranch() {
  const q = new URLSearchParams(window.location.search);
  // เปิดผ่าน liff.line.me ครั้งแรก: ค่ายังซ่อนอยู่ใน liff.state (LINE จะพาไปหน้าที่มี ?branch= อีกรอบ)
  const inner = q.get('liff.state');
  const v = q.get('branch') || (inner ? new URLSearchParams(inner.replace(/^[^?]*\?/, '')).get('branch') : '');
  if (!v || !/^[A-Za-z0-9]{1,12}$/.test(v)) return;
  try { localStorage.setItem(joinKey(), JSON.stringify({ id: v.toUpperCase(), at: Date.now() })); } catch (e) { /* ข้าม */ }
}

function joinBranch() {
  try {
    const d = JSON.parse(localStorage.getItem(joinKey()) || 'null');
    return d && Date.now() - d.at < JOIN_BRANCH_DAYS * 86400000 ? d.id : '';
  } catch (e) {
    return '';
  }
}

async function refresh() {
  const d = await S.api.call('bootstrap', { withBrand: true });
  // หน้าตาร้านที่เจ้าของร้านแก้ในหลังบ้าน (ชื่อ สี โลโก้ ข้อความ นโยบาย)
  if (d.brand) await applyBrand(S.shop, d.brand);
  S.data = d;
  S.stale = false;
  writeCache(S.data);
  render();
}

/* ---------- บัตรสมาชิกจากครั้งก่อน (เก็บในเครื่องของลูกค้า แยกตามบัญชี LINE) ----------
 * ไม่เก็บเบอร์โทรและวันเกิด (หน้านี้ไม่ได้แสดง และไม่ควรค้างอยู่ในเครื่อง)
 * เป็นแค่ภาพที่โชว์ระหว่างรอ — แต้มและการแลกทุกครั้ง Apps Script ตรวจจากชีตจริงเสมอ */
const CACHE_PREFIX = 'crm_last:';
const cacheKey = () => CACHE_PREFIX + S.shop.id + ':' + S.line.userId;

function readCache() {
  if (!S.line.userId) return null;
  try {
    const d = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
    return d && d.member && d.settings && Array.isArray(d.rewards) ? d : null;
  } catch (e) {
    return null;
  }
}

function writeCache(d) {
  if (!S.line.userId) return;
  try {
    if (!d.member) { localStorage.removeItem(cacheKey()); return; }
    const copy = { ...d, member: { ...d.member, phone: '', birthDate: '' } };
    localStorage.setItem(cacheKey(), JSON.stringify(copy));
  } catch (e) { /* เครื่องไม่ให้เก็บ → ครั้งหน้าก็แค่รอโหลดตามปกติ */ }
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
    case 'tier-tab': setTierTab(Number(id), true); break;
    case 'tier-rules': showTierRules(); break;
    case 'profile-confirm': doSaveProfile(el); break;
    case 'birthday-claim': claimBirthday(el); break;
    case 'friend-check': checkFriend(el); break;
    case 'close': closeModal(); break;
    case 'reload': window.location.reload(); break;
    case 'relogin': if (S.line) S.line.relogin(); break;
  }
}

/* =====================================================
 * หน้าระหว่างโหลด / ผิดพลาด
 * ===================================================== */
// หน้าโหลดสีกลาง (เหตุผลอยู่ที่ bootHtml ใน ui.js)
function renderBoot(message = '') {
  app.innerHTML = bootHtml(message);
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
        ${code === 'TOKEN_INVALID' || code === 'NO_TOKEN' ? '<button class="btn btn-primary" data-act="relogin">เข้าสู่ระบบใหม่</button>' : ''}
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
  // ร้านบังคับเพิ่มเพื่อน LINE OA ก่อนสมัคร (ส่งข้อความรอบ 3) — LINE ตอบไม่ได้ (friend = null) ไม่ปิดกั้น
  if (!d.member && d.oa && d.oa.required && d.oa.friend === false) return renderFriendGate();
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
  const body = { home: pageHome, rewards: pageRewards, coupons: pageCoupons, history: pageHistory, collect: pageCollect, profile: pageProfile, tiers: pageTiers }[S.page] || pageHome;
  app.innerHTML = testBanner() + `<main class="screen">${body()}</main>${nav()}`;
  if (S.page === 'tiers') mountTierCarousel();
  const pf = document.getElementById('profile');
  if (pf) pf.addEventListener('submit', onProfileSubmit);
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
// วันเกิดเลือกเป็น วัน / เดือน / ปี พ.ศ. (คนไทยคุ้นกว่า และหน้าตาเหมือนกันทุกเครื่อง
// ปฏิทินของมือถือบางเครื่องเป็น ค.ศ. และต้องเลื่อนย้อนหลายสิบปี) — ส่งให้ Apps Script เป็น yyyy-mm-dd ค.ศ.
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

// value = วันเกิดเดิม yyyy-mm-dd (หน้าข้อมูลของฉัน) → เลือกไว้ให้
function birthSelects(value = '') {
  const thisYearBE = new Date().getFullYear() + 543;
  const [vy, vm, vd] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').map(Number) : [0, 0, 0];
  const pick = { bdDay: vd, bdMonth: vm, bdYear: vy ? vy + 543 : 0 };
  const opts = (placeholder, items, name) => `<option value="">${placeholder}</option>` + items.map(([v, t]) => `<option value="${v}" ${pick[name] === v ? 'selected' : ''}>${t}</option>`).join('');
  const days = Array.from({ length: 31 }, (_, i) => [i + 1, i + 1]);
  const months = TH_MONTHS.map((m, i) => [i + 1, m]);
  const years = Array.from({ length: 100 }, (_, i) => [thisYearBE - 1 - i, thisYearBE - 1 - i]);
  return `
    <div class="date-row">
      <select name="bdDay" class="select" aria-label="วันเกิด">${opts('วัน', days, 'bdDay')}</select>
      <select name="bdMonth" class="select" aria-label="เดือนเกิด">${opts('เดือน', months, 'bdMonth')}</select>
      <select name="bdYear" class="select" aria-label="ปีเกิด (พ.ศ.)">${opts('ปี พ.ศ.', years, 'bdYear')}</select>
    </div>`;
}

// วัน/เดือน/ปี พ.ศ. → yyyy-mm-dd (ค.ศ.) หรือ '' ถ้ายังเลือกไม่ครบ / null ถ้าเป็นวันที่ไม่มีจริง (เช่น 31 เม.ย.)
function birthValue(f) {
  const d = Number(f.bdDay.value), m = Number(f.bdMonth.value), yBE = Number(f.bdYear.value);
  if (!d || !m || !yBE) return '';
  const y = yBE - 543;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || dt.getTime() > Date.now()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* ---------- เพิ่มเพื่อน LINE OA ก่อนสมัคร (ร้านเปิดสวิตช์ "บังคับเพิ่มเพื่อนก่อนสมัคร") ----------
 * สาขาจาก QR ยังจำอยู่ในเครื่อง (captureJoinBranch) → เพิ่มเพื่อนแล้วกลับมาสมัครได้เลย
 * กลับมาที่หน้านี้ (หลังเพิ่มเพื่อนในแอป LINE) → ตรวจใหม่เอง / หรือกดปุ่ม "เพิ่มเพื่อนแล้ว" */
function renderFriendGate() {
  const d = S.data;
  const welcome = d.settings.welcomePoints;
  app.innerHTML = testBanner() + `
    <main class="screen register">
      <div class="reg-hero">
        ${logoHtml('logo-lg')}
        <h1>เพิ่มเพื่อน LINE ของร้านก่อนสมัครสมาชิก</h1>
        <p>รับโปรโมชัน ส่วนลด และสิทธิพิเศษเฉพาะสมาชิก${esc(cfg().name ? ' ' + cfg().name : '')} ทาง LINE</p>
        ${welcome > 0 ? `<div class="chip chip-accent">${icon('gift', 16)} สมัครแล้วรับทันที ${fmtNum(welcome)} ${esc(unit())}</div>` : ''}
      </div>
      <section class="card gate-card">
        <ol class="gate-steps">
          <li><b>กดเพิ่มเพื่อน</b> แล้วกด "เพิ่ม" ในหน้าของ LINE</li>
          <li><b>กลับมาที่หน้านี้</b> แล้วกรอกข้อมูลสมัครสมาชิก</li>
        </ol>
        ${d.oa.addUrl ? `<a class="btn btn-primary btn-block btn-lg" href="${esc(d.oa.addUrl)}" data-friend-add>${icon('chat', 20)} เพิ่มเพื่อน</a>` : ''}
        <button type="button" class="btn btn-block" data-act="friend-check">${icon('check', 18)} เพิ่มเพื่อนแล้ว ไปสมัครสมาชิก</button>
        <div class="form-error" id="gate-error" hidden></div>
      </section>
      ${creditHtml('credit-page')}
    </main>`;
}

// กดเพิ่มเพื่อนแล้ว → ถามตัวกลางใหม่ (ตัวกลางถาม LINE จริง ไม่เชื่อหน้าเว็บ)
async function checkFriend(btn) {
  if (btn) setBusy(btn, true, 'กำลังตรวจ...');
  try {
    await refresh();
    const box = document.getElementById('gate-error');
    if (box && S.data.oa && S.data.oa.friend === false) {
      box.textContent = 'ยังไม่พบว่าเพิ่มเพื่อนแล้ว กด "เพิ่มเพื่อน" แล้วกด "เพิ่ม" ในหน้าของ LINE ก่อน';
      box.hidden = false;
    }
  } catch (e) {
    if (btn) setBusy(btn, false);
    toast(e.message, 'err');
  }
}

// ข้อความช่องยินยอมรับข่าวสาร (ผู้ใช้เลือกแบบที่ 1 — 12 พ.ย. 2569) บรรทัดเล็กบอกช่องทาง + วิธียกเลิก ตาม PDPA
function consentLabel(bonus) {
  return `<span><b>${bonus > 0 ? `รับฟรี ${fmtNum(bonus)} ${esc(unit())}ทันที</b> เมื่อรับข่าวสารและโปรโมชันจากร้าน` : 'รับข่าวสาร โปรโมชัน และสิทธิพิเศษจากร้าน</b>'}
    <small class="consent-sub">ส่งทาง LINE ของร้าน · ยกเลิกได้ทุกเมื่อที่ "แก้ไขข้อมูล"</small></span>`;
}

function renderRegister() {
  const welcome = S.data.settings.welcomePoints;
  // ระบบเดิม (Apps Script) ไม่ส่ง signup มา → ช่องยินยอมแบบเดิม (ไม่ติ๊กไว้ให้)
  const su = S.data.signup;
  app.innerHTML = testBanner() + `
    <main class="screen register">
      <div class="reg-hero">
        ${logoHtml('logo-lg')}
        <h1>${esc(T('registerTitle', 'สมัครสมาชิก ' + cfg().name))}</h1>
        <p>${esc(T('registerSubtitle', 'สะสม' + unit() + 'ทุกครั้งที่ซื้อ แลกของรางวัลและสิทธิพิเศษ'))}</p>
        ${welcome > 0 ? `<div class="chip chip-accent">${icon('gift', 16)} รับทันที ${fmtNum(welcome)} ${esc(unit())} เมื่อสมัคร</div>` : ''}
      </div>
      <form id="reg" class="card form" novalidate>
        <label class="field"><span>ชื่อ <em>*</em></span>
          <input name="firstName" maxlength="40" autocomplete="given-name" placeholder="ชื่อจริง"></label>
        <label class="field"><span>นามสกุล <em>*</em></span>
          <input name="lastName" maxlength="40" autocomplete="family-name" placeholder="นามสกุล"></label>
        <div class="field"><span>วันเกิด <em>*</em> <small>ใช้มอบสิทธิพิเศษเดือนเกิด</small></span>
          ${birthSelects()}</div>
        <label class="field"><span>เบอร์มือถือ <em>*</em></span>
          ${phoneInput('')}</label>
        <label class="check"><input type="checkbox" name="consentPrivacy">
          <span>ฉันยอมรับ<button type="button" class="link" data-act="privacy">นโยบายความเป็นส่วนตัว</button>ของร้าน <em>*</em></span></label>
        ${su ? `<label class="check check-consent"><input type="checkbox" name="consentMarketing" ${su.preticked ? 'checked' : ''}>
          ${consentLabel(su.bonusAvailable ? su.bonusPoints : 0)}</label>`
        : `<label class="check"><input type="checkbox" name="consentMarketing">
          <span>ยินดีรับข่าวสารและโปรโมชันทาง LINE (ยกเลิกได้ทุกเมื่อ)</span></label>`}
        <div class="form-error" id="reg-error" hidden></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">สมัครสมาชิก</button>
      </form>
      ${creditHtml('credit-page')}
    </main>`;
  document.getElementById('reg').addEventListener('submit', onRegister);
  restoreRegisterDraft();
}

// ฟอร์มสมัครที่กรอกค้างไว้ตอนต้องเชื่อมต่อ LINE ใหม่ (หน้าเว็บโหลดใหม่) → เก็บไว้ชั่วคราวแล้วเติมกลับ ลูกค้าไม่ต้องพิมพ์ใหม่
// ใช้ sessionStorage: อยู่แค่ในหน้าต่างนี้ ปิดแล้วหายเอง และลบทันทีหลังเติมกลับ (มีเบอร์โทรอยู่ข้างใน)
const DRAFT_KEY = 'crm_register_draft';

function saveRegisterDraft() {
  const f = document.getElementById('reg');
  if (!f) return;
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
    firstName: f.firstName.value,
    lastName: f.lastName.value,
    bdDay: f.bdDay.value,
    bdMonth: f.bdMonth.value,
    bdYear: f.bdYear.value,
    phone: f.phone.value,
    consentPrivacy: f.consentPrivacy.checked,
    consentMarketing: f.consentMarketing.checked
  }));
}

function restoreRegisterDraft() {
  let draft = null;
  try {
    draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    sessionStorage.removeItem(DRAFT_KEY);
  } catch (e) { /* ไม่มีหรืออ่านไม่ได้ */ }
  const f = document.getElementById('reg');
  if (!draft || !f) return;
  f.firstName.value = draft.firstName || '';
  f.lastName.value = draft.lastName || '';
  f.bdDay.value = draft.bdDay || '';
  f.bdMonth.value = draft.bdMonth || '';
  f.bdYear.value = draft.bdYear || '';
  f.phone.value = draft.phone || '';
  f.consentPrivacy.checked = !!draft.consentPrivacy;
  f.consentMarketing.checked = !!draft.consentMarketing;
  const box = document.getElementById('reg-error');
  box.textContent = 'เชื่อมต่อ LINE ใหม่แล้ว ข้อมูลที่กรอกยังอยู่ กดสมัครสมาชิกอีกครั้งได้เลย';
  box.className = 'flash ok';
  box.hidden = false;
}

/* =====================================================
 * ข้อมูลของฉัน: ลูกค้าแก้ชื่อ เบอร์ วันเกิด (ได้ 1 ครั้ง) และการรับข่าวสาร
 * Apps Script ตรวจซ้ำทุกอย่าง (เบอร์ซ้ำ / วันเกิดล็อก / สมาชิกถูกระงับ) — หน้านี้ตรวจแค่ให้รู้เร็ว
 * ===================================================== */
// เบอร์มือถือไทย 10 หลัก (ผู้ใช้ขอ 4 พ.ย. 2569) — ต้องตรงกับ cleanMobile_ ใน code.gs
const MOBILE = /^0[689]\d{8}$/;
const PHONE_MSG = 'กรุณากรอกเบอร์มือถือ 10 หลัก';

// ไม่ใช้ maxlength: วางเบอร์แบบ "+66 81 234 5678" ต้องแปลงก่อนตัด ไม่งั้นตัวเลขท้ายหาย — ตัดเหลือ 10 หลักใน onPhoneInput แทน
function phoneInput(value) {
  return `<input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="08xxxxxxxx" data-phone value="${esc(value)}">`;
}

function phoneDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('66') && d.length >= 11) d = '0' + d.slice(2);
  return d.slice(0, 10);
}

// รับเฉพาะตัวเลขตั้งแต่ตอนพิมพ์ พิมพ์เกิน 10 หลักแล้วไม่ขึ้น
function onPhoneInput(e) {
  const el = e.target.closest && e.target.closest('input[data-phone]');
  if (!el) return;
  const v = phoneDigits(el.value);
  if (v !== el.value) el.value = v;
  clearFieldError(el);
}

function fieldError(input, msg) {
  clearFieldError(input);
  input.classList.add('input-err');
  input.setAttribute('aria-invalid', 'true');
  input.insertAdjacentHTML('afterend', `<div class="field-err" role="alert">${esc(msg)}</div>`);
  input.focus();
}

function clearFieldError(input) {
  input.classList.remove('input-err');
  input.removeAttribute('aria-invalid');
  const next = input.nextElementSibling;
  if (next && next.classList.contains('field-err')) next.remove();
}

const fmtBirth = iso => (iso ? fmtDate(iso + 'T00:00:00+07:00') : '-');

function pageProfile() {
  const m = S.data.member;
  return `
    ${pageHead('ข้อมูลของฉัน')}
    <div class="profile-top">
      <span class="avatar avatar-lg">${avatarHtml()}</span>
      <b class="profile-name">${esc(m.name)}</b>
      <span class="muted small">รหัสสมาชิก ${esc(m.memberId)}</span>
    </div>
    <form id="profile" class="card form profile-form" novalidate>
      <label class="field"><span>ชื่อ <em>*</em></span>
        <input name="firstName" maxlength="40" autocomplete="given-name" value="${esc(m.firstName || '')}"></label>
      <label class="field"><span>นามสกุล <em>*</em></span>
        <input name="lastName" maxlength="40" autocomplete="family-name" value="${esc(m.lastName || '')}" placeholder="นามสกุล"></label>
      <label class="field"><span>เบอร์มือถือ <em>*</em></span>
        ${phoneInput(m.phone || '')}
        <small class="hint">ตัวเลข 10 หลัก พนักงานใช้ค้นหาบัตรสมาชิกของคุณ</small></label>
      <div class="field"><span>วันเกิด <em>*</em></span>
        ${m.birthLocked
          ? `<div class="locked">${icon('lock', 18)}<span>${esc(fmtBirth(m.birthDate))}</span></div>
             <small class="hint">แก้วันเกิดได้ 1 ครั้ง (ใช้ไปแล้ว) ต้องการแก้อีก กรุณาติดต่อร้าน</small>`
          : `${birthSelects(m.birthDate)}
             <small class="hint">${m.birthDate ? 'แก้วันเกิดได้ 1 ครั้ง (ใช้มอบสิทธิพิเศษเดือนเกิด)' : 'ใช้มอบสิทธิพิเศษเดือนเกิด'}</small>`}
      </div>
      <label class="switch-row">
        <span><b>รับข่าวสารและโปรโมชันทาง LINE</b><small class="hint" id="consent-hint">${esc(consentHint(m.marketingConsent))}</small></span>
        <input type="checkbox" name="consentMarketing" class="switch-input" ${m.marketingConsent ? 'checked' : ''}>
        <span class="switch" aria-hidden="true"></span>
      </label>
      <div class="form-error" id="profile-error" hidden></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit">บันทึกข้อมูล</button>
    </form>
    <p class="profile-note">ร้านใช้ข้อมูลนี้ตาม<button type="button" class="link" data-act="privacy">นโยบายความเป็นส่วนตัว</button> · ${esc(unit())}และคูปองไม่เปลี่ยน</p>`;
}

// คำใต้สวิตช์รับข่าวสาร: ยังไม่เคยได้แต้มรับข่าวสาร → บอกว่าเปิดแล้วได้กี่แต้ม / กำลังจะปิด → เตือนสั้นๆ ว่าจะพลาดอะไร (ไม่ห้ามปิด)
function consentHint(on) {
  const su = S.data.signup;
  const m = S.data.member;
  if (!on && m.marketingConsent) return 'ถ้ายกเลิก จะไม่ได้รับโปรโมชันและสิทธิพิเศษทาง LINE';
  if (!on && su && su.bonusAvailable && su.bonusPoints > 0) return `เปิดรับ รับฟรี ${fmtNum(su.bonusPoints)} ${unit()}ทันที`;
  return 'ปิดได้ทุกเมื่อ';
}

function onConsentToggle(e) {
  const el = e.target;
  if (!el || el.name !== 'consentMarketing' || !el.closest('#profile')) return;
  const hint = document.getElementById('consent-hint');
  if (hint) {
    hint.textContent = consentHint(el.checked);
    hint.classList.toggle('hint-warn', !el.checked && S.data.member.marketingConsent);
  }
}

function onProfileSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const m = S.data.member;
  const errBox = document.getElementById('profile-error');
  const showErr = (msg) => { errBox.textContent = msg; errBox.hidden = !msg; };
  showErr('');
  const firstName = f.firstName.value.trim();
  const lastName = f.lastName.value.trim();
  const phone = phoneDigits(f.phone.value);
  if (!firstName) return showErr('กรุณากรอกชื่อ');
  if (!lastName) return showErr('กรุณากรอกนามสกุล');
  if (/\d/.test(firstName + lastName)) return showErr('ชื่อและนามสกุลต้องไม่มีตัวเลข');
  if (!MOBILE.test(phone)) return fieldError(f.phone, PHONE_MSG);
  let birthDate = m.birthDate;
  if (!m.birthLocked) {
    birthDate = birthValue(f);
    if (birthDate === '') return showErr('กรุณาเลือกวันเกิดให้ครบ วัน เดือน ปี');
    if (birthDate === null) return showErr('วันเกิดไม่ถูกต้อง กรุณาตรวจวันที่อีกครั้ง');
  }
  S.pendingProfile = { firstName, lastName, phone, birthDate, consentMarketing: f.consentMarketing.checked };
  // เปลี่ยนวันเกิดได้ครั้งเดียว → ให้ยืนยันก่อน (เติมวันเกิดที่ยังว่างไม่นับ)
  if (m.birthDate && birthDate !== m.birthDate) {
    openModal(`
      <div class="modal-head"><h2>ยืนยันเปลี่ยนวันเกิด</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
      <div class="confirm-cost"><b class="birth-new">${esc(fmtBirth(birthDate))}</b><span>เดิม ${esc(fmtBirth(m.birthDate))}</span></div>
      <p class="notice">${icon('alert', 18)}<span>เปลี่ยนวันเกิดเองได้ครั้งเดียว หลังจากนี้ต้องติดต่อร้านถ้าต้องการแก้อีก</span></p>
      <div class="modal-actions">
        <button class="btn" data-act="close">ยกเลิก</button>
        <button class="btn btn-primary" data-act="profile-confirm">ยืนยัน บันทึก</button>
      </div>`);
    return;
  }
  doSaveProfile(f.querySelector('button[type="submit"]'));
}

async function doSaveProfile(btn) {
  const p = S.pendingProfile;
  if (!p) return;
  setBusy(btn, true);
  try {
    const r = await S.api.call('updateProfile', p);
    S.pendingProfile = null;
    S.data.member = r.member;
    writeCache(S.data);
    closeModal();
    if (r.consentBonus) {
      await refresh().catch(() => {}); // แต้มในบัตร + ประวัติ อัปเดตทันที
      toast(`บันทึกแล้ว รับ ${fmtNum(r.consentBonus)} ${unit()} จากการรับข่าวสาร`, 'ok');
    } else {
      toast(r.changed ? 'บันทึกข้อมูลแล้ว' : 'ข้อมูลเหมือนเดิม ไม่มีอะไรเปลี่ยน', 'ok');
    }
    go('home');
  } catch (e) {
    setBusy(btn, false);
    closeModal();
    const f = document.getElementById('profile');
    if (f && (e.code === 'BAD_PHONE' || e.code === 'PHONE_TAKEN')) return fieldError(f.phone, e.message);
    const box = document.getElementById('profile-error');
    if (box) { box.textContent = e.message; box.hidden = false; } else toast(e.message, 'err');
  }
}

/* =====================================================
 * แต้มพิเศษวันนี้ + ของขวัญวันเกิด (2.8.0)
 * Apps Script ตัดสินทั้งหมด (เดือนเกิด / สมาชิกครบ 30 วัน / ปีละครั้ง) หน้านี้แค่แสดงตามที่ได้มา
 * ===================================================== */
// การ์ดแต้มพิเศษวันนี้ (ผู้ใช้เลือกแบบมีแสงวิ่ง 5 พ.ย. 2569)
// หัวข้อเขียนจำนวนเท่าเอง ไม่พึ่งชื่อกติกา เพราะเจ้าของร้านตั้งชื่ออะไรก็ได้ (เช่น "แต้มพิเศษ ลอยกระทง" ไม่บอกว่ากี่เท่า)
function badgesHtml() {
  const list = S.data.badges || [];
  if (!list.length) return '';
  return `<div class="bonus-cards">${list.map(b => {
    const mult = '×' + esc(String(b.multiplier));
    const cond = [b.branchName ? 'เฉพาะ' + esc(b.branchName) : '', b.minAmount ? 'ซื้อครบ ฿' + fmtNum(b.minAmount) : ''].filter(Boolean).join(' · ');
    return `
    <section class="bonus-card">
      <div class="bonus-mult" aria-hidden="true">${mult}</div>
      <div class="grow">
        <div class="bonus-title">วันนี้ได้${esc(unit())} ${mult} ${icon('bolt', 17)}</div>
        <div class="bonus-name">${esc(b.name)}</div>
        ${cond ? `<div class="bonus-cond">${cond}</div>` : ''}
      </div>
    </section>`;
  }).join('')}</div>`;
}

// ยังไม่เป็นเพื่อน / บล็อก LINE OA ของร้าน → ชวนเพิ่มเพื่อน (ไม่งั้นไม่ได้รับโปรโมชันทาง LINE)
function friendCard() {
  const oa = S.data.oa;
  if (!oa || oa.friend !== false || !oa.addUrl) return '';
  return `
    <section class="oa-card">
      <div class="oa-card-icon">${icon('chat', 22)}</div>
      <div class="grow">
        <b>เพิ่มเพื่อน LINE ของร้าน</b>
        <small>รับโปรโมชันและสิทธิพิเศษสำหรับสมาชิก</small>
      </div>
      <a class="btn btn-primary btn-sm" href="${esc(oa.addUrl)}" data-friend-add>เพิ่มเพื่อน</a>
    </section>`;
}

function birthdayCard() {
  const b = S.data.birthday;
  if (!b) return '';
  const first = (S.data.member.firstName || S.data.member.name || '').split(' ')[0];
  if (b.claimed) {
    return `
      <section class="bday">
        <div class="bday-icon">${icon('cake', 30)}</div>
        <div class="grow">
          <div class="bday-tag">เดือนเกิดของคุณ 🎉</div>
          <h3>รับของขวัญวันเกิดแล้ว</h3>
          <p>${esc(b.coupon.name)} · ใช้ที่ร้านได้ถึง ${fmtDate(b.coupon.expiresAt)}</p>
          <button class="btn btn-primary btn-sm" data-act="coupon-qr" data-id="${esc(b.coupon.code)}">${icon('qr', 16)} แสดงคูปอง</button>
        </div>
      </section>`;
  }
  return `
    <section class="bday">
      <div class="bday-icon">${icon('cake', 30)}</div>
      <div class="grow">
        <div class="bday-tag">เดือนเกิดของคุณ 🎉</div>
        <h3>สุขสันต์วันเกิด คุณ${esc(first)}</h3>
        <p>ร้านมีของขวัญให้ รับได้ถึง ${fmtDate(b.until)}</p>
        <div class="bday-gift">${icon('gift', 18)} ${esc(b.name)}${b.points ? ` <span class="muted small">(ใช้ ${fmtNum(b.points)} ${esc(unit())})</span>` : ''}</div>
        <button class="btn btn-primary btn-sm" data-act="birthday-claim">รับของขวัญ</button>
      </div>
    </section>`;
}

async function claimBirthday(btn) {
  setBusy(btn, true, 'กำลังรับ...');
  try {
    const r = await withRequestId('birthday', rid => S.api.call('claimBirthday', { requestId: rid }));
    await refresh();
    toast(r.already ? 'คุณรับของขวัญปีนี้ไปแล้ว' : 'รับของขวัญวันเกิดแล้ว 🎉', 'ok');
    if (r.coupon) showCouponQr(r.coupon.code);
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

async function onRegister(e) {
  e.preventDefault();
  const f = e.target;
  const errBox = document.getElementById('reg-error');
  const showErr = (msg) => { errBox.className = 'form-error'; errBox.textContent = msg; errBox.hidden = !msg; };
  const firstName = f.firstName.value.trim();
  const lastName = f.lastName.value.trim();
  const birthDate = birthValue(f);
  const phone = phoneDigits(f.phone.value);
  if (!firstName) return showErr('กรุณากรอกชื่อ');
  if (!lastName) return showErr('กรุณากรอกนามสกุล');
  if (/\d/.test(firstName + lastName)) return showErr('ชื่อและนามสกุลต้องไม่มีตัวเลข');
  if (birthDate === '') return showErr('กรุณาเลือกวันเกิดให้ครบ วัน เดือน ปี');
  if (birthDate === null) return showErr('วันเกิดไม่ถูกต้อง กรุณาตรวจวันที่อีกครั้ง');
  if (!MOBILE.test(phone)) { showErr(''); return fieldError(f.phone, PHONE_MSG); }
  if (!f.consentPrivacy.checked) return showErr('กรุณายอมรับนโยบายความเป็นส่วนตัว');
  showErr('');

  const btn = f.querySelector('button[type="submit"]');
  setBusy(btn, true, 'กำลังสมัคร...');
  try {
    const r = await S.api.call('register', {
      firstName,
      lastName,
      name: firstName + ' ' + lastName, // เผื่อ code.gs รุ่นเก่า (ก่อน 2.3.0) ระหว่างรอน้องอัปเดต
      phone,
      birthDate,
      consentPrivacy: true,
      consentMarketing: f.consentMarketing.checked,
      branch: joinBranch() // ว่าง = สมัครออนไลน์
    });
    try { localStorage.removeItem(joinKey()); } catch (e) { /* ข้าม */ }
    await refresh();
    const bonus = r.consentBonus || 0;
    if (r.welcomePoints > 0 || bonus > 0) {
      const lines = [r.welcomePoints > 0 ? `<b>${fmtNum(r.welcomePoints)} ${esc(unit())}</b> ต้อนรับสมาชิกใหม่` : '',
        bonus > 0 ? `<b>${fmtNum(bonus)} ${esc(unit())}</b> รับข่าวสารจากร้าน` : ''].filter(Boolean);
      openModal(`
        <div class="modal-center">
          <div class="big-icon ok">${icon('gift', 34)}</div>
          <h2>ยินดีต้อนรับ!</h2>
          <p>คุณได้รับ ${lines.join(' + ')}</p>
          <button class="btn btn-primary btn-block" data-act="close">เริ่มใช้งาน</button>
        </div>`);
    } else {
      toast('สมัครสมาชิกสำเร็จ', 'ok');
    }
  } catch (err) {
    setBusy(btn, false);
    // ยังไม่ได้เพิ่มเพื่อน OA (ร้านบังคับ) → กลับไปหน้าเพิ่มเพื่อน ข้อมูลที่กรอกเก็บไว้ให้
    if (err.code === 'NOT_FRIEND') { saveRegisterDraft(); toast(err.message, 'err'); return refresh().catch(() => {}); }
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
        <button type="button" class="avatar-wrap" data-act="go" data-page="profile" aria-label="แก้ไขข้อมูลของฉัน">
          <span class="avatar">${avatarHtml()}</span><span class="avatar-edit">${icon('edit', 12)}</span></button>
        <div class="hero-text">
          <div class="hello">${esc(T('greeting', 'สวัสดี'))}</div>
          <div class="hero-name">${esc(m.name)}</div>
          <button type="button" class="hero-edit" data-act="go" data-page="profile">แก้ไขข้อมูล ${icon('right', 13)}</button>
        </div>
        ${logoHtml('logo-sm')}
      </div>
    </header>
    ${memberCard(m)}
    ${tierCard(m)}
    ${friendCard()}
    ${birthdayCard()}
    ${badgesHtml()}
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
      </section>` : ''}
    ${creditHtml('credit-page')}`;
}

/* ---------- ระดับสมาชิก (ขั้น 4) ----------
 * แสดงเมื่อร้านเปิดแพ็กเกจ (config features.tiers) และหลังบ้านส่งข้อมูลระดับมา (ระบบใหม่ + ร้านตั้งระดับแล้ว)
 * ระบบเดิมไม่ส่งข้อมูลระดับ → หน้าเหมือนเดิมทุกอย่าง */
const tiersOn = () => !!(cfg().features && cfg().features.tiers) && !!S.data && Array.isArray(S.data.tiers) && S.data.tiers.length >= 2;
// จุดสีของระดับ (สีมาจากหลังบ้าน ตรวจรูปแบบ #RRGGBB แล้ว)
const tierDot = color => (/^#[0-9A-Fa-f]{6}$/.test(color || '') ? `<i class="tier-dot" style="background:${color}"></i>` : '');

const HEX6 = /^#[0-9A-Fa-f]{6}$/;
const tierColor = c => (HEX6.test(c || '') ? c : '');

// การ์ดระดับแบบ "วงแหวน" (ผู้ใช้เลือกจากภาพจำลอง 8 พ.ย. 2569 — เดิมเป็นบันไดระดับ สำรองที่ backups/2569-11-08_ก่อนการ์ดระดับวงแหวน/)
// การ์ดขาวเตี้ย ทรงกลมต่างจากบัตรสมาชิกด้านบนชัดเจน / กดทั้งการ์ด → หน้าสิทธิ์สมาชิก (ภาพรวมทุกระดับอยู่ในแท็บของหน้านั้น)
// ข้อความแบบ ข (ผู้ใช้เลือก 7 พ.ย. 2569): บรรทัดหลัก "อีก X ถึง Y" หรือ "คุณอยู่ระดับสูงสุดแล้ว" + บรรทัดเล็กมีแค่ "คงระดับถึง"
//   ตัวเลขสะสม 12 เดือน / "แลกแล้วไม่ลด" / สิทธิ์ระดับถัดไป อยู่หน้าสิทธิ์ — ลูกค้าที่สงสัยว่า "อีก X" มาจากไหน กดการ์ดดูได้
function tierCard(m) {
  const t = m.tierInfo;
  if (!tiersOn() || !t) return '';
  const next = t.next;
  const u = esc(unit());
  // วงเต็ม = ถึงเกณฑ์ระดับถัดไป (นับจาก 0 ให้ตรงกับที่ลูกค้าคิดในใจ "สะสม 910 จาก 1,000") / อย่างน้อย 2% ให้เห็นหัววง / ระดับสูงสุด = เต็มวง
  const pct = next && next.minPoints > 0 ? Math.max(2, Math.min(100, t.points12m / next.minPoints * 100)) : 100;
  const color = tierColor(t.color);
  return `
    <button type="button" class="tier-card tier-ring" data-act="go" data-page="tiers" aria-label="ระดับของคุณ ${esc(t.name)} — ดูสิทธิ์สมาชิก">
      <span class="tr-ring">${ringSvg(pct, color)}<span class="tr-icon"${color ? ` style="color:${inkOn(color)}"` : ''}>${icon('crown', 22)}</span></span>
      <span class="tr-text">
        <span class="tr-label">ระดับสมาชิกของคุณ</span>
        <span class="tr-name">${esc(t.name)}${t.multiplier > 1 ? ` <small>· ${u} ×${t.multiplier}</small>` : ''}</span>
        <span class="tr-next">${next
          ? `อีก <b>${fmtNum(next.remaining)} ${u}</b> ถึง <b>${esc(next.name)}</b>`
          : `<b>คุณอยู่ระดับสูงสุดแล้ว</b>`}</span>
        ${t.until ? `<span class="tr-sub">คงระดับถึง ${fmtDate(t.until)}</span>` : ''}
      </span>
      <span class="tr-chev">${icon('right', 18)}</span>
    </button>`;
}

// วงแหวนความคืบหน้า (SVG) — เริ่มที่ 12 นาฬิกา เดินตามเข็ม / ไม่มีสีระดับ → ใช้สีปุ่มของร้าน (ตั้งใน CSS)
// สีระดับต้องใส่เป็น style ไม่ใช่ attribute stroke= เพราะ CSS (.tr-val) ทับ attribute ของ SVG ได้ — เคยเจอ: ลูกค้า Gold ได้วงสีฟ้า
function ringSvg(pct, color, size = 58, w = 6) {
  const r = (size - w) / 2, C = 2 * Math.PI * r, c = size / 2;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="tr-track" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${w}"/>
    <circle class="tr-val" cx="${c}" cy="${c}" r="${r}" fill="none"${color ? ` style="stroke:${color}"` : ''} stroke-width="${w}" stroke-linecap="round"
      stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(2)}" transform="rotate(-90 ${c} ${c})"/></svg>`;
}

// สีมงกุฎกลางวง: สีของระดับ แต่ถ้าอ่อนจนกลืนกับพื้นการ์ด (เช่น Silver บนพื้นขาว) ทำให้เข้มขึ้นจนต่างกันอย่างน้อย 3:1
function inkOn(c) {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
  const base = HEX6.test(bg) ? bg : '#FFFFFF';
  const dir = textOn(base) === '#FFFFFF' ? 0.18 : -0.18; // พื้นเข้ม → ทำให้อ่อนลง / พื้นอ่อน → ทำให้เข้มขึ้น
  let x = c;
  for (let i = 0; i < 6 && contrast(x, base) < 3; i++) x = shade(x, dir);
  return x;
}

// ป้ายระดับบนบัตร: พื้นเป็นสีของระดับนั้นเอง (เดิมพื้นสีเน้นของร้าน + จุดสีระดับ ทำให้สับสนว่าระดับนี้สีอะไร)
function mcTier(m) {
  const c = m.tierInfo && m.tierInfo.color;
  if (!HEX6.test(c || '')) return `<span class="mc-tier">${esc(m.tier)}</span>`;
  return `<span class="mc-tier" style="background:${c};color:${textOn(c)}">${icon('crown', 13)}${esc(m.tier)}</span>`;
}

function memberCard(m) {
  const tiers = cfg().features && cfg().features.tiers;
  return `
    <section class="member-card">
      <div class="mc-top">
        <div><div class="mc-label">${esc(T('cardLabel', 'บัตรสมาชิก'))}</div><div class="mc-shop">${esc(cfg().name)}</div></div>
        ${tiers && m.tier ? mcTier(m) : ''}
      </div>
      <div class="mc-mid">
        <div>
          <div class="mc-label">${esc(unit())}${tiersOn() ? 'คงเหลือ' : 'สะสม'}</div>
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
            ${p.minTier ? `<span class="promo-tag promo-tier">${p.locked ? icon('lock', 11) + ' ' : ''}สำหรับระดับ ${esc(p.minTier.name)} ขึ้นไป</span>` : ''}
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
  // ระดับไม่ถึง: แสดงแต่ล็อก (ผู้ใช้เลือก 7 พ.ย. 2569 — ลูกค้ารู้ว่ามีอะไรรออยู่ เป็นแรงจูงใจ) / ระบบก็ไม่ยอมให้แลกอีกชั้น
  const locked = r.locked === true && r.minTier;
  const can = !soldOut && !locked && pts >= r.points;
  const label = soldOut ? 'หมดแล้ว' : locked ? `${icon('lock', 14)} ระดับ ${esc(r.minTier.name)} ขึ้นไป` : can ? 'แลกของรางวัล' : `ขาดอีก ${fmtNum(r.points - pts)}`;
  return `
    <article class="reward ${locked ? 'is-locked' : ''}">
      <div class="reward-img">
        ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : `<div class="reward-ph">${icon('gift', 34)}</div>`}
        <span class="reward-cost">${fmtNum(r.points)} ${esc(unit())}</span>
        ${r.minTier ? `<span class="reward-tier">${locked ? icon('lock', 12) : ''}${esc(r.minTier.name)} ขึ้นไป</span>` : ''}
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
const TX_LABEL = { EARN: 'สะสมจากการซื้อ', WELCOME: 'แต้มต้อนรับ', REDEEM: 'แลกของรางวัล', ADJUST: 'ปรับโดยร้าน', CONSENT: 'รับข่าวสารจากร้าน' };
const TX_ICON = { EARN: 'up', WELCOME: 'star', REDEEM: 'gift', ADJUST: 'coins', CONSENT: 'chat' };

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
    </section>
    ${tierTable()}`;
}

// ตารางระดับสมาชิก (หน้าวิธีสะสม) — ระดับของลูกค้าคนนี้ไฮไลต์ไว้
function tierTable() {
  if (!tiersOn()) return '';
  const mine = S.data.member && S.data.member.tierInfo ? S.data.member.tierInfo.id : '';
  return `
    <section class="section">
      <div class="section-head"><h2>ระดับสมาชิก</h2></div>
      <p class="muted small">คิดจาก${esc(unit())}ที่ได้จากการซื้อ 12 เดือนล่าสุด · ถึงเกณฑ์ขึ้นระดับทันที และคงระดับไว้ 12 เดือน · ครบแล้วไม่ถึง ลดลงทีละ 1 ระดับ</p>
      <div class="tier-list">${S.data.tiers.map(t => `
        <div class="tier-row ${t.id === mine ? 'current' : ''}">
          <span class="tier-row-name">${tierDot(t.color)}${esc(t.name)}${t.id === mine ? ' <small>(ระดับของคุณ)</small>' : ''}</span>
          <span>${t.minPoints > 0 ? fmtNum(t.minPoints) + ' ' + esc(unit()) + ' ขึ้นไป' : 'สมาชิกทุกคน'}</span>
          <span class="tier-row-mult">${t.multiplier > 1 ? esc(unit()) + ' ×' + t.multiplier : '-'}</span>
        </div>`).join('')}
      </div>
      <button class="btn btn-block tier-more-btn" data-act="go" data-page="tiers">ดูสิทธิ์ของแต่ละระดับ ${icon('right', 16)}</button>
    </section>`;
}

/* =====================================================
 * หน้าสิทธิ์สมาชิก (ผู้ใช้ตกลง 7 พ.ย. 2569 จากตัวอย่าง — แบบหน้าสิทธิ์ของร้านใหญ่ที่ผู้ใช้ส่งรูปมา)
 * แท็บระดับ + รูปบัตรปัดได้ (ขยับตามกัน) + เงื่อนไข / สิทธิพิเศษ / นโยบาย ของระดับที่เลือก
 * สิทธิพิเศษ = ส่วนที่ระบบรู้ (ตัวคูณ ของรางวัล/โปรเฉพาะระดับ — ตรงกับที่ระบบทำจริงเสมอ) + ข้อความที่ร้านเขียนเอง
 * ===================================================== */
const tierIndex = id => Math.max(0, S.data.tiers.findIndex(t => t.id === id));

function pageTiers() {
  if (!tiersOn() || !S.data.member.tierInfo) return pageHome();
  const tiers = S.data.tiers;
  const mine = tierIndex(S.data.member.tierInfo.id);
  if (!(S.tierTab >= 0 && S.tierTab < tiers.length)) S.tierTab = mine;
  const intro = S.data.tierIntro || `สมัครสมาชิกฟรี สะสม${unit()}ทุกบิล\nยิ่งสะสมมาก ยิ่งได้สิทธิ์มาก`;
  const opts = { logo: logoHtml('logo-xs'), shopName: cfg().name, unit: unit() };
  return `
    <header class="tp-top">
      <button class="back tp-back" data-act="go" data-page="home" aria-label="กลับหน้าแรก">${icon('left', 22)}</button>
      ${logoHtml('logo-lg')}
      <p class="tp-intro">${esc(intro).replace(/\n/g, '<br>')}</p>
    </header>
    <div class="tp-tabs" role="tablist" aria-label="ระดับสมาชิก">${tiers.map((t, i) => `
      <button role="tab" data-act="tier-tab" data-id="${i}" aria-selected="${i === S.tierTab}">${esc(t.name)}<small>${i === mine ? 'ระดับของคุณ' : '&nbsp;'}</small></button>`).join('')}
    </div>
    <div class="tp-carousel" id="tier-carousel">${tiers.map(t => tierBanner(t, opts)).join('')}</div>
    <div class="tp-dots" aria-hidden="true">${tiers.map((t, i) => `<i class="${i === S.tierTab ? 'on' : ''}"></i>`).join('')}</div>
    <div class="tp-body" id="tier-detail">${tierDetail(S.tierTab)}</div>`;
}

// สิทธิ์ที่ระบบรู้เอง (ตรงกับที่ระบบทำจริง) ของระดับที่ i — ของรางวัล/โปร "ระดับ X ขึ้นไป" นับรวมของระดับที่ต่ำกว่า
function autoPerks(i) {
  const d = S.data;
  const t = d.tiers[i];
  const u = unit();
  const out = [];
  if (i === 0) out.push(`สะสม${u}ทุกบิล ${fmtMoney(d.settings.pointRate)} บาท = 1 ${u}`);
  if (t.multiplier > 1) out.push(`ได้${u} ×${t.multiplier} ทุกบิล`);
  const upTo = x => x.minTier && tierIndex(x.minTier.id) <= i && tierIndex(x.minTier.id) > 0;
  const list = names => (names.length > 3 ? names.slice(0, 3).join(', ') + ` และอีก ${names.length - 3} รายการ` : names.join(', '));
  const rewards = (d.rewards || []).filter(upTo).map(r => r.name);
  if (i > 0 && rewards.length) out.push('แลกของรางวัลเฉพาะสมาชิกระดับนี้: ' + list(rewards));
  const promos = (d.promos || []).filter(upTo).map(p => p.title);
  if (i > 0 && promos.length) out.push('โปรโมชันเฉพาะสมาชิกระดับนี้: ' + list(promos));
  return out;
}

function tierDetail(i) {
  const d = S.data;
  const t = d.tiers[i];
  const ti = d.member.tierInfo;
  const mine = tierIndex(ti.id);
  const u = esc(unit());
  let status;
  // นับจาก "แต้มจากการซื้อ" 12 เดือน ไม่ใช่แต้มคงเหลือบนบัตร → เขียนให้ชัด กันลูกค้าเอาแต้มคงเหลือไปเทียบกับเกณฑ์
  const got = `สะสมจากการซื้อใน 12 เดือน <b>${fmtNum(ti.points12m)}</b> ${u}`;
  if (i === mine) status = `${icon('check', 15)}<span>คุณอยู่ระดับนี้${ti.until ? ` · คงระดับถึง ${fmtDate(ti.until)}` : ''}<span class="tp-sub">${got}</span></span>`;
  else if (i < mine) status = `${icon('check', 15)}<span>คุณผ่านระดับนี้แล้ว</span>`;
  else {
    const pct = t.minPoints > 0 ? Math.max(2, Math.min(100, Math.round(ti.points12m / t.minPoints * 100))) : 100;
    status = `<span>${got} · อีก <b>${fmtNum(Math.max(0, t.minPoints - ti.points12m))}</b> ${u}
      <span class="tp-bar"><i style="width:${pct}%"></i></span></span>`;
  }
  const perks = autoPerks(i);
  return `
    <section class="tp-sec">
      <h2>${icon('receipt', 20)}เงื่อนไข</h2>
      <ul>${i === 0 ? '<li>สมัครสมาชิกฟรี ได้ระดับนี้ทันที</li><li>ไม่มีวันหมดอายุ</li>'
        : `<li>สะสม ${fmtNum(t.minPoints)} ${u}จากการซื้อ ภายใน 12 เดือน</li><li>ถึงเกณฑ์เลื่อนระดับทันที และคงระดับ 12 เดือน</li><li>แลกของรางวัลแล้ว ${u}สะสมเพื่อเลื่อนระดับไม่ลด</li>`}</ul>
      <div class="tp-status ${i > mine ? '' : 'done'}">${status}</div>
    </section>
    <section class="tp-sec">
      <h2>${icon('star', 20)}สิทธิพิเศษ</h2>
      <ul>${perks.map(x => `<li><b>${esc(x)}</b></li>`).join('')}${(t.benefits || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    </section>
    <section class="tp-sec">
      <h2>${icon('shield', 20)}นโยบายและเงื่อนไข</h2>
      <ul class="tp-links">
        <li><button type="button" class="link" data-act="tier-rules">เงื่อนไขสำหรับสมาชิก</button></li>
        <li><button type="button" class="link" data-act="privacy">นโยบายความเป็นส่วนตัว</button></li>
      </ul>
    </section>`;
}

// เปลี่ยนระดับที่ดู (กดแท็บ หรือปัดรูปบัตร) — วาดเฉพาะแท็บ จุด และรายละเอียด (ไม่วาดรูปบัตรใหม่ ไม่งั้นการปัดสะดุด)
function setTierTab(i, scroll) {
  if (!(i >= 0 && i < S.data.tiers.length)) return;
  S.tierTab = i;
  document.querySelectorAll('.tp-tabs [role="tab"]').forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
  document.querySelectorAll('.tp-dots i').forEach((dot, k) => dot.classList.toggle('on', k === i));
  const box = document.getElementById('tier-detail');
  if (box) box.innerHTML = tierDetail(i);
  const tab = document.querySelectorAll('.tp-tabs [role="tab"]')[i];
  if (tab) tab.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (scroll) scrollTierCard(i, true);
}

function scrollTierCard(i, smooth) {
  const car = document.getElementById('tier-carousel');
  const card = car && car.children[i];
  if (!card) return;
  const left = card.offsetLeft - (car.clientWidth - card.clientWidth) / 2;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  car.scrollTo({ left, behavior: smooth && !reduce ? 'smooth' : 'auto' });
}

// เปิดหน้ามาที่ระดับที่เลือกไว้ + ปัดรูปบัตรแล้วแท็บตาม (รอให้หยุดปัดก่อนค่อยเปลี่ยน)
function mountTierCarousel() {
  const car = document.getElementById('tier-carousel');
  if (!car) return;
  scrollTierCard(S.tierTab, false);
  let timer;
  car.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const mid = car.scrollLeft + car.clientWidth / 2;
      let best = 0;
      let dist = Infinity;
      [...car.children].forEach((c, k) => { const x = Math.abs(c.offsetLeft + c.clientWidth / 2 - mid); if (x < dist) { dist = x; best = k; } });
      if (best !== S.tierTab) setTierTab(best, false);
    }, 120);
  }, { passive: true });
}

// เงื่อนไขสำหรับสมาชิก: สรุปกติการะดับจากที่ระบบทำจริง (ร้านไม่ต้องเขียนเอง ไม่มีวันไม่ตรง)
function showTierRules() {
  const u = esc(unit());
  openModal(`
    <div class="modal-head"><h2>เงื่อนไขสำหรับสมาชิก</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <ul class="prose tp-rules">
      <li>ระดับสมาชิกคิดจาก${u}ที่ได้จากการซื้อ ภายใน 12 เดือนล่าสุด (${esc(fmtMoney(S.data.settings.pointRate))} บาท = 1 ${u})</li>
      <li>${u}พิเศษ ${u}ต้อนรับ และ${u}ที่ร้านปรับให้ ไม่นับรวม · แลกของรางวัลแล้ว${u}ที่ใช้นับระดับไม่ลด</li>
      <li>ถึงเกณฑ์ขึ้นระดับทันที และคงระดับไว้ 12 เดือน</li>
      <li>ครบ 12 เดือนแล้ว${u}ไม่ถึงเกณฑ์ของระดับนั้น ลดลง 1 ระดับ (ถึงเกณฑ์ คงระดับต่ออีก 12 เดือน)</li>
      <li>ระดับแรกไม่มีวันหมดอายุ</li>
      <li>ตัวคูณ${u}ของระดับไม่รวมกับ${u}พิเศษในวันโปรโมชัน ระบบให้แบบที่ได้มากกว่า</li>
    </ul>
    <button class="btn btn-block" data-act="close">ปิด</button>`);
}
