// หลังบ้านของเจ้าของร้าน: ภาพรวม · สมาชิก · รายการแต้ม · คูปอง · ของรางวัล · โปรโมชัน · พนักงาน · ตั้งค่าร้าน
// ทำไว้ให้เจ้าของร้านดูข้อมูลได้โดยไม่ต้องเปิดหรือแชร์ Google Sheet ให้ใคร
// เปิดได้ทั้งคอมและมือถือ (บนคอมระบบจะพาไปเข้าสู่ระบบ LINE ก่อน)
// สิทธิ์ตรวจที่ Apps Script ทุกคำสั่ง (OWNER / ADMIN ในชีต Staff) — หน้านี้แค่ซ่อน/แสดงปุ่มให้ตรงบทบาท
import { loadShop, applyBrand, mergeBrand, THEME_DEFAULTS, textOn, contrast, shade } from './shop.js';
import { initLine, IS_LOCAL } from './line.js';
import { createApi, createRetryKeeper } from './api.js';
import { applyDevParams, mountDevBar } from './devbar.js';
import { esc, icon, toast, openModal, closeModal, fmtNum, fmtMoney, fmtDate, fmtDateTime, setBusy, showLoading, hideLoading, creditHtml, bootHtml, qrSvg, loadScript } from './ui.js';

const ROLE_LABEL = { OWNER: 'เจ้าของร้าน', ADMIN: 'ผู้จัดการ', CASHIER: 'แคชเชียร์' };
const TX_LABEL = { EARN: 'ยอดซื้อ', WELCOME: 'แต้มต้อนรับ', REDEEM: 'แลกรางวัล', ADJUST: 'ปรับแต้ม' };
const COUPON_LABEL = { ACTIVE: 'ใช้ได้', USED: 'ใช้แล้ว', EXPIRED: 'หมดอายุ', CANCELLED: 'ยกเลิก' };
const STAFF_STATUS_LABEL = { PENDING: 'รออนุมัติ', ACTIVE: 'ใช้งานได้', DISABLED: 'ปิดสิทธิ์' };
const PAGES = [
  { id: 'overview', label: 'ภาพรวม', icon: 'chart' },
  { id: 'members', label: 'สมาชิก', icon: 'users' },
  { id: 'transactions', label: 'รายการแต้ม', icon: 'receipt' },
  { id: 'coupons', label: 'คูปอง', icon: 'ticket' },
  { id: 'rewards', label: 'ของรางวัล', icon: 'gift' },
  { id: 'promos', label: 'โปรโมชัน', icon: 'star' },
  { id: 'rules', label: 'แต้มพิเศษ', icon: 'coins' },
  { id: 'staff', label: 'พนักงาน', icon: 'shield' },
  { id: 'branches', label: 'สาขา', icon: 'pin' },
  { id: 'brand', label: 'หน้าตาร้าน', icon: 'palette' },
  { id: 'settings', label: 'ตั้งค่าร้าน', icon: 'store' }
];
// สถานะที่ลูกค้าเห็นตอนนี้ (Apps Script คำนวณจากสถานะ + ช่วงวันที่ + จำนวนคงเหลือ)
const STATE_LABEL = { ACTIVE: 'ลูกค้าเห็น', INACTIVE: 'ปิดอยู่', SCHEDULED: 'ยังไม่ถึงวันเริ่ม', ENDED: 'หมดเขตแล้ว', SOLD_OUT: 'แลกครบแล้ว', INVALID: 'ตั้งแต้มไม่ถูก' };
const PRESETS = [
  { id: 'today', label: 'วันนี้' },
  { id: '7d', label: '7 วัน' },
  { id: '30d', label: '30 วัน' },
  { id: 'month', label: 'เดือนนี้' },
  { id: 'lastMonth', label: 'เดือนก่อน' },
  { id: 'custom', label: 'เลือกวัน' }
];
const RANGE_KEY = 'crm_admin_range';
const BRANCH_KEY = 'crm_admin_branch';
// ข้อความในป๊อปอัป "กำลังโหลด" ตามคำสั่ง (คำสั่งอ่านข้อมูลอื่นๆ = "กำลังโหลด...")
const SAVE_ACTIONS = ['adjustPoints', 'adminStaffUpdate', 'adminRewardSave', 'adminPromoSave', 'adminMemberStatus', 'adminSettingsSave', 'adminBrandSave', 'adminBranchSave', 'adminMemberUpdate', 'adminRuleSave'];
const LOADING_TEXT = { adminExport: 'กำลังเตรียมไฟล์...', adminUploadImage: 'กำลังอัปโหลดรูป...', adminRewardDelete: 'กำลังลบ...', adminPromoDelete: 'กำลังลบ...', adminRuleDelete: 'กำลังลบ...' };

const app = document.getElementById('app');
const S = {
  shop: null, line: null, api: null, me: null, testMode: false,
  range: loadRange(),
  // หลายสาขา: รายชื่อสาขาทั้งหมด (มาพร้อมคำขอแรก) + สาขาที่เลือกดูอยู่ ('' = ทุกสาขา) ใช้ร่วมกันทุกหน้า
  branches: [], branch: loadBranchFilter(),
  members: { q: '', sort: 'joined', status: '', birth: '', page: 1 },
  // ระบบนี้ลบของรางวัล/โปรโมชัน/แต้มพิเศษได้ไหม (ระบบใหม่บอกมากับรายการ / ระบบเดิมไม่มี → ไม่แสดงปุ่มลบ)
  canDelete: {},
  tx: { type: '', staff: '', q: '', page: 1 },
  coupons: { status: '', page: 1 },
  member: null, staffItems: [], pendingAdjust: null,
  rewards: [], couponDays: 30, promos: [], settingsItems: [], pendingSettings: null,
  seq: 0 // เลขคำขอล่าสุด: ผลของคำขอเก่าที่ตอบช้ากว่าจะไม่ทับหน้าที่เปิดใหม่
};
const withRequestId = createRetryKeeper();

const cfg = () => S.shop.config;
const unit = () => (cfg().texts && cfg().texts.pointUnit) || 'แต้ม';
const isOwner = () => S.me && S.me.role === 'OWNER';

/* แพ็กเกจหลายสาขา: เปิด/ปิดที่ shops/<ร้าน>/config.js → features.branches / features.maxBranches
 * ตั้งที่ไฟล์บน Vercel เพราะเจ้าของร้านแก้เองไม่ได้ (ชีต Settings อยู่ในบัญชีร้าน แก้ได้)
 * ปิดแพ็กเกจ = ซ่อนเมนูสาขา (เพิ่ม/แก้สาขาไม่ได้) แต่ข้อมูลสาขาเดิมยังอยู่ ดูรายงานแยกสาขาได้ตามเดิม */
const branchFeature = () => !!(cfg().features && cfg().features.branches === true);
const branchLimit = () => {
  const n = Number(cfg().features && cfg().features.maxBranches);
  return Number.isInteger(n) && n > 0 ? n : Infinity;
};
const visiblePages = () => PAGES.filter(p => p.id !== 'branches' || branchFeature());

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);
document.addEventListener('change', onChange);
window.addEventListener('hashchange', route);
main();

async function main() {
  try {
    S.shop = await loadShop();
    applyDevParams(S.shop.id);
    renderBoot('กำลังเข้าสู่ระบบ...');
    S.line = await initLine(cfg().liffId);
    S.api = createApi(S.shop, S.line, {
      // ลิงก์ (#หน้า) ติดไปกับการเข้าสู่ระบบใหม่อยู่แล้ว จึงไม่ต้องเก็บอะไรเพิ่ม
      onRelogin: () => { closeModal(); renderBoot('กำลังเชื่อมต่อ LINE ใหม่...'); },
      // ก่อนเข้าหลังบ้านได้ มีหน้าโหลดเต็มจออยู่แล้ว → ไม่ต้องขึ้นป๊อปอัปซ้อน
      loadingText: (action) => (!S.me ? null : LOADING_TEXT[action] || (SAVE_ACTIONS.includes(action) ? 'กำลังบันทึก...' : 'กำลังโหลด...'))
    });
    if (IS_LOCAL) mountDevBar(S.shop, S.api, { openNow: !S.api.overridden });
    // เปิดหน้าแรกเลย: ข้อมูลผู้ใช้มาพร้อมข้อมูลหน้านั้นในคำขอเดียว (ดู fetchView)
    route();
  } catch (e) {
    renderFatal(e);
  }
}

/* =====================================================
 * เหตุการณ์ (ปุ่มใช้ data-act ทั้งหมด)
 * ===================================================== */
function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'preset': setPreset(id); break;
    case 'page': S[el.dataset.of].page = Number(el.dataset.page) || 1; route(); break;
    case 'member': if (e.target.closest('a')) return; location.hash = '#member/' + encodeURIComponent(id); break;
    case 'coupon-status': S.coupons.status = id || ''; S.coupons.page = 1; route(); break;
    case 'staff-edit': openStaffEdit(id); break;
    case 'branch-filter': setBranchFilter(id); break;
    case 'branch-edit': openBranchEdit(id); break;
    case 'branch-qr': openBranchQr(id); break;
    case 'branch-qr-save': saveBranchQr(id, el); break;
    case 'export': confirmExport(id); break;
    case 'export-confirm': doExport(id, el); break;
    case 'adjust-confirm': doAdjust(el); break;
    case 'reward-edit': openRewardEdit(id); break;
    case 'promo-edit': openPromoEdit(id); break;
    case 'rule-edit': openRuleEdit(id); break;
    case 'item-delete': confirmDelete(el.dataset.kind, id); break;
    case 'item-delete-confirm': doDelete(el.dataset.kind, id, el); break;
    case 'member-status': openMemberStatus(); break;
    case 'member-edit': openMemberEdit(); break;
    case 'settings-confirm': doSaveSettings(el); break;
    case 'brand-confirm': doSaveBrand(S.pendingBrand, el); break;
    case 'color-reset': resetColor(id); break;
    case 'image-clear': clearImage(el, id); break;
    case 'copy': copyText(el.dataset.text); break;
    case 'refresh': route(); break;
    case 'close': closeModal(); break;
    case 'reload': window.location.reload(); break;
    case 'relogin': if (S.line) S.line.relogin(); break;
  }
}

function onSubmit(e) {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const f = form.elements;
  switch (form.dataset.form) {
    case 'range': {
      const from = f.from.value;
      const to = f.to.value;
      if (!from || !to) return toast('กรุณาเลือกวันเริ่มและวันสิ้นสุด', 'err');
      if (from > to) return toast('วันเริ่มต้องไม่หลังวันสิ้นสุด', 'err');
      S.range = { preset: 'custom', from, to };
      saveRange();
      resetPages();
      route();
      break;
    }
    case 'members':
      Object.assign(S.members, { q: f.q.value.trim(), sort: f.sort.value, status: f.status.value, birth: f.birth ? f.birth.value : '', page: 1 });
      route();
      break;
    case 'tx':
      Object.assign(S.tx, { type: f.type.value, staff: f.staff.value, q: f.q.value.trim(), page: 1 });
      route();
      break;
    case 'adjust': onAdjustSubmit(form); break;
    case 'staff-edit': saveStaff(form); break;
    case 'branch': saveBranch(form); break;
    case 'reward': saveReward(form); break;
    case 'promo': savePromo(form); break;
    case 'rule': saveRule(form); break;
    case 'member-status': saveMemberStatus(form); break;
    case 'member-edit': saveMemberEdit(form); break;
    case 'settings': confirmSettings(form); break;
    case 'brand': saveBrand(form); break;
  }
}

// พิมพ์/วางลิงก์รูป → แสดงตัวอย่างทันที (แปลงลิงก์ Drive แบบเดียวกับ Apps Script)
document.addEventListener('input', e => {
  const input = e.target.closest('[data-preview]');
  if (input) {
    const box = document.getElementById(input.dataset.preview);
    if (box) box.innerHTML = previewHtml(input.value, box.dataset.kind);
  }
  if (e.target.closest('form[data-form="brand"]')) onBrandInput(e.target);
});

// เปลี่ยนตัวเลือกในแถบกรอง → ค้นใหม่ทันที (ช่องพิมพ์ยังต้องกด Enter/ค้นหา)
function onChange(e) {
  const file = e.target.closest('input[type="file"][data-upload]');
  if (file) return uploadImage(file);
  if (e.target.matches('[data-branch-filter]')) return setBranchFilter(e.target.value);
  if (e.target.matches('[data-branch-all]')) return toggleBranchAll(e.target);
  if (e.target.matches('input[name="type"]')) return onRewardType(e.target);
  const form = e.target.closest('form[data-form="members"], form[data-form="tx"]');
  if (form && e.target.tagName === 'SELECT') form.requestSubmit();
}

/* =====================================================
 * ช่วงวันที่ (เวลาไทย) — ใช้ร่วมกันหน้าภาพรวม รายการแต้ม คูปอง
 * ===================================================== */
function todayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function rangeFor(preset, from, to) {
  const t = todayKey();
  switch (preset) {
    case 'today': return { preset, from: t, to: t };
    case '7d': return { preset, from: addDays(t, -6), to: t };
    case 'month': return { preset, from: t.slice(0, 8) + '01', to: t };
    case 'lastMonth': {
      const end = addDays(t.slice(0, 8) + '01', -1);
      return { preset, from: end.slice(0, 8) + '01', to: end };
    }
    case 'custom': return { preset, from: from || addDays(t, -29), to: to || t };
    default: return { preset: '30d', from: addDays(t, -29), to: t };
  }
}

// จำช่วงที่เลือกไว้ในแท็บนี้ (เผื่อหน้าโหลดใหม่ตอนเชื่อมต่อ LINE ใหม่) — ช่วงสำเร็จรูปคำนวณใหม่ทุกครั้งเพราะ "วันนี้" เปลี่ยน
function loadRange() {
  try {
    const r = JSON.parse(sessionStorage.getItem(RANGE_KEY) || 'null');
    if (r && PRESETS.some(p => p.id === r.preset)) return rangeFor(r.preset, r.from, r.to);
  } catch (e) { /* ไม่มีหรืออ่านไม่ได้ */ }
  return rangeFor('30d');
}

function saveRange() {
  try { sessionStorage.setItem(RANGE_KEY, JSON.stringify(S.range)); } catch (e) { /* ข้าม */ }
}

function setPreset(id) {
  S.range = id === 'custom' ? rangeFor('custom', S.range.from, S.range.to) : rangeFor(id);
  saveRange();
  resetPages();
  route();
}

function resetPages() {
  S.tx.page = 1;
  S.coupons.page = 1;
}

/* =====================================================
 * สาขา (เฉพาะร้านที่เพิ่มสาขาแล้ว — ร้านสาขาเดียวไม่เห็นอะไรเกี่ยวกับสาขาเลย)
 * ===================================================== */
const hasBranches = () => S.branches.length > 0;

function loadBranchFilter() {
  try { return sessionStorage.getItem(BRANCH_KEY) || ''; } catch (e) { return ''; }
}

function setBranchFilter(id) {
  S.branch = id || '';
  try { sessionStorage.setItem(BRANCH_KEY, S.branch); } catch (e) { /* ข้าม */ }
  resetPages();
  S.members.page = 1;
  route();
}

// ชื่อที่แสดงแทนรหัสสาขา (รหัสพิเศษ: ONLINE = สมัครเอง / ADMIN = ปรับจากหลังบ้าน / ว่าง = ก่อนเปิดใช้สาขา)
function branchName(id) {
  if (!id) return 'ไม่ระบุ';
  if (id === 'ONLINE') return 'ออนไลน์';
  if (id === 'ADMIN') return 'หลังบ้าน';
  const b = S.branches.find(x => x.id === id);
  return b ? b.name : id;
}

// ช่องเลือกสาขา (วางในแถบกรองของแต่ละหน้า)
function branchSelect() {
  if (!hasBranches()) return '';
  return `
    <label class="branch-select ${S.branch ? 'on' : ''}">${icon('pin', 16)}
      <select data-branch-filter aria-label="สาขา">
        <option value="">ทุกสาขา</option>
        ${S.branches.map(b => `<option value="${esc(b.id)}" ${S.branch === b.id ? 'selected' : ''}>${esc(b.name)}${b.status === 'ACTIVE' ? '' : ' (ปิดแล้ว)'}</option>`).join('')}
      </select></label>`;
}

const branchData = () => (S.branch ? { branch: S.branch } : {});
const branchNote = () => (S.branch ? ` · <b>${esc(branchName(S.branch))}</b>` : '');

const rangeData = () => ({ from: S.range.from, to: S.range.to });
const keyDate = k => new Date((k.length === 7 ? k + '-01' : k) + 'T00:00:00Z');
const fmtDayShort = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDayLong = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function rangeText() {
  const { from, to } = S.range;
  return from === to ? fmtDayLong.format(keyDate(from)) : `${fmtDayLong.format(keyDate(from))} – ${fmtDayLong.format(keyDate(to))}`;
}

function rangeBar() {
  const r = S.range;
  const t = todayKey();
  return `
    <div class="range-bar">
      ${branchSelect()}
      <div class="chips-scroll">${PRESETS.map(p => `
        <button type="button" class="chip-btn ${r.preset === p.id ? 'active' : ''}" data-act="preset" data-id="${p.id}">${p.label}</button>`).join('')}
      </div>
      ${r.preset === 'custom' ? `
        <form class="range-custom" data-form="range">
          <input type="date" name="from" value="${esc(r.from)}" max="${t}" aria-label="วันเริ่ม">
          <span class="muted">ถึง</span>
          <input type="date" name="to" value="${esc(r.to)}" max="${t}" aria-label="วันสิ้นสุด">
          <button class="btn btn-sm btn-primary" type="submit">ดูข้อมูล</button>
        </form>` : ''}
      <div class="range-label">${icon('clock', 14)} ${esc(rangeText())}</div>
    </div>`;
}

/* =====================================================
 * โครงหน้า + เปลี่ยนหน้า (#overview, #members, #member/<รหัส>, ...)
 * ===================================================== */
// หน้าโหลดสีกลางเหมือนหน้าลูกค้า (ไม่โชว์ชื่อ/สีร้าน กันสีกะพริบ — เหตุผลอยู่ที่ bootHtml ใน ui.js)
function renderBoot(message) {
  app.innerHTML = bootHtml(message);
}

function renderFatal(e) {
  const noAccess = e && (e.code === 'NOT_STAFF' || e.code === 'NO_ROLE');
  app.innerHTML = `
    <div class="state-page">
      <div class="state-icon">${icon(noAccess ? 'shield' : 'alert', 40)}</div>
      <h1>${noAccess ? 'หน้านี้สำหรับเจ้าของร้านและผู้จัดการ' : 'เปิดหลังบ้านไม่สำเร็จ'}</h1>
      ${noAccess ? `
        <p>บัญชี LINE นี้ยังไม่มีสิทธิ์เข้าหลังบ้าน</p>
        <p class="muted small">ถ้าคุณเป็นเจ้าของร้าน ติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์</p>`
        : `<p>${esc((e && e.message) || 'เกิดข้อผิดพลาด')}</p>`}
      ${IS_LOCAL && e && e.debug ? `<pre class="debug">${esc(e.debug)}</pre>` : ''}
      <div class="stack">
        ${e && (e.code === 'TOKEN_INVALID' || e.code === 'NO_TOKEN') ? '<button class="btn btn-primary" data-act="relogin">เข้าสู่ระบบใหม่</button>' : ''}
        <button class="btn" data-act="reload">ลองใหม่</button>
      </div>
    </div>`;
  if (IS_LOCAL && S.shop && !document.getElementById('devbar')) {
    mountDevBar(S.shop, S.api || { url: '', overridden: false }, { openNow: true });
  }
}

function logoHtml() {
  const c = cfg();
  const src = c.logo ? S.shop.asset(c.logo) : '';
  return src
    ? `<img class="logo logo-sm" src="${esc(src)}" alt="">`
    : `<div class="logo logo-sm logo-text">${esc(c.logoText || (c.name || '?').slice(0, 1))}</div>`;
}

function renderShell() {
  app.innerHTML = (S.testMode ? '<div class="test-banner">โหมดทดสอบ — ข้อมูลไม่ใช่ของจริง</div>' : '') + `
    <div class="adm">
      <aside class="adm-side">
        <div class="adm-brand">
          ${logoHtml()}
          <div class="grow"><div class="adm-shop">${esc(cfg().name)}</div><div class="adm-sub">หลังบ้าน</div></div>
        </div>
        <nav class="adm-nav">${visiblePages().map(p => `
          <a href="#${p.id}" data-page="${p.id}">${icon(p.icon, 18)}<span>${p.label}</span></a>`).join('')}
        </nav>
        ${creditHtml('credit-side')}
        <div class="adm-me">
          <div class="adm-me-name">${esc(S.me.name)} <span class="chip">${esc(ROLE_LABEL[S.me.role] || S.me.role)}</span></div>
          <a class="adm-link" href="${esc(S.shop.pageUrl('staff'))}">${icon('scan', 16)} ไปหน้าพนักงาน</a>
        </div>
      </aside>
      <div class="adm-col">
        <main class="adm-main" id="view"></main>
        ${/* บนมือถือเมนูข้างกลายเป็นแถบบนและไม่มีที่ใส่เครดิต จึงแสดงท้ายเนื้อหาแทน (#view ถูกเขียนทับทุกครั้งที่เปลี่ยนหน้า เลยวางไว้นอก #view) */ creditHtml('credit-foot')}
      </div>
    </div>`;
}

function currentPage() {
  const [raw, arg] = (location.hash.slice(1) || 'overview').split('/');
  return { page: raw === 'member' || visiblePages().some(p => p.id === raw) ? raw : 'overview', arg };
}

function markNav() {
  const { page } = currentPage();
  const navId = page === 'member' ? 'members' : page;
  document.querySelectorAll('.adm-nav a').forEach(a => a.classList.toggle('active', a.dataset.page === navId));
}

function route() {
  if (!S.api) return;
  const { page, arg } = currentPage();
  markNav();
  window.scrollTo(0, 0);
  const load = {
    overview: loadOverview,
    members: loadMembers,
    member: () => loadMember(decodeURIComponent(arg || '')),
    transactions: loadTx,
    coupons: loadCoupons,
    rewards: loadRewards,
    promos: loadPromos,
    rules: loadRules,
    staff: loadStaff,
    branches: loadBranches,
    brand: loadBrand,
    settings: loadSettings
  }[page];
  load();
}

// เรียกหลังบ้านแล้ววาดหน้า: ระหว่างรอมีป๊อปอัป "กำลังโหลด" และหน้าเดิมจางลง (ไม่ล้างหน้า ผู้ใช้จะได้ไม่หลงตำแหน่ง)
// ครั้งแรก (ยังไม่รู้ว่าใครเข้า) ส่ง withMe ไปด้วย → Apps Script ตรวจสิทธิ์และส่งข้อมูลผู้ใช้กลับมาพร้อมข้อมูลหน้า
async function fetchView(action, data, render) {
  const seq = ++S.seq;
  const first = !S.me;
  const viewNow = document.getElementById('view');
  if (viewNow) viewNow.classList.add('is-loading');
  try {
    const r = await S.api.call(action, first ? { ...data, withMe: true, withBrand: true } : data);
    if (seq !== S.seq) return;
    if (first) {
      if (r.brand) await applyBrand(S.shop, r.brand);
      // code.gs รุ่นก่อน 2.4.0 ไม่ส่ง me มา → ถามแยกอีกรอบ (หน้าเว็บใหม่ใช้กับ code.gs เก่าได้)
      let me = r.me;
      let branches = r.branches;
      if (!me) {
        const r2 = await S.api.call('adminMe');
        me = r2.me;
        branches = r2.branches;
      }
      S.me = me;
      S.branches = branches || [];
      // สาขาที่เลือกไว้ถูกลบ/ร้านไม่มีสาขาแล้ว → กลับไปดูทุกสาขา
      if (S.branch && !S.branches.some(b => b.id === S.branch)) S.branch = '';
      S.testMode = !!r.testMode;
      renderShell();
      markNav();
    }
    render(r);
  } catch (e) {
    if (seq !== S.seq) return;
    if (first) return renderFatal(e);
    document.getElementById('view').innerHTML = `
      <div class="card notice notice-err">${icon('alert', 20)}<div>${esc(e.message)}
        <div><button class="link" data-act="refresh">${icon('refresh', 14)} ลองใหม่</button></div></div></div>`;
  } finally {
    const v = document.getElementById('view');
    if (seq === S.seq && v) v.classList.remove('is-loading');
  }
}

function pageHead(title, sub, actions = '') {
  return `
    <div class="adm-head">
      <div class="grow"><h1>${esc(title)}</h1>${sub ? `<p class="muted small">${sub}</p>` : ''}</div>
      <div class="adm-actions">${actions}</div>
    </div>`;
}

function exportBtn(kind) {
  return isOwner() ? `<button class="btn btn-sm" data-act="export" data-id="${kind}">${icon('download', 16)} ส่งออก Excel (CSV)</button>` : '';
}

function pager(r, of) {
  if (r.pages <= 1) return '';
  return `
    <div class="pager">
      <button class="btn btn-sm" data-act="page" data-of="${of}" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>${icon('left', 16)} ก่อนหน้า</button>
      <span class="muted small">หน้า ${fmtNum(r.page)} / ${fmtNum(r.pages)}</span>
      <button class="btn btn-sm" data-act="page" data-of="${of}" data-page="${r.page + 1}" ${r.page >= r.pages ? 'disabled' : ''}>ถัดไป ${icon('right', 16)}</button>
    </div>`;
}

const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="empty-cell">${esc(text)}</td></tr>`;
const signed = n => (n > 0 ? '+' : '') + fmtNum(n);
const ptsClass = n => (n > 0 ? 'plus' : n < 0 ? 'minus' : '');
const statusChip = (status, label) => `<span class="status status-${esc(String(status).toLowerCase())}">${esc(label || status)}</span>`;
// เบอร์ 10 หลักแสดงเป็น 086-111-0002 อ่านง่ายกว่า (เบอร์ที่ซ่อนแล้วแสดงตามเดิม)
const fmtPhone = p => (/^0\d{9}$/.test(p || '') ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p || '');
const memberLink = (id, name) => `<a href="#member/${encodeURIComponent(id)}">${esc(name || id)}</a>`;

/* =====================================================
 * ภาพรวม
 * ===================================================== */
function loadOverview() {
  fetchView('adminDashboard', { ...rangeData(), ...branchData() }, renderOverview);
}

// เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน — ใช้สีตัวอักษรปกติ เพราะ "เพิ่ม" ไม่ได้แปลว่าดีเสมอ (เช่นแต้มที่ถูกแลก)
function delta(cur, prev) {
  if (!prev && !cur) return '';
  if (!prev) return `<span class="kpi-delta">ช่วงก่อนหน้า 0</span>`;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return `<span class="kpi-delta">เท่ากับช่วงก่อนหน้า</span>`;
  return `<span class="kpi-delta">${pct > 0 ? '▲' : '▼'} ${fmtNum(Math.abs(pct))}% จากช่วงก่อนหน้า</span>`;
}

function renderOverview(d) {
  const c = d.current;
  const p = d.previous;
  const one = !!d.branch; // ดูสาขาเดียว
  const tiles = [
    one
      ? { label: 'สมาชิกที่สมัครสาขานี้', value: fmtNum(d.totals.branchMembers), sub: `ทั้งร้าน ${fmtNum(d.totals.members)} คน` }
      : { label: 'สมาชิกทั้งหมด', value: fmtNum(d.totals.members), sub: `${esc(unit())}คงค้างในระบบ ${fmtNum(d.totals.pointsOutstanding)}` },
    { label: 'สมาชิกใหม่', value: fmtNum(c.newMembers), sub: delta(c.newMembers, p.newMembers) },
    { label: 'ลูกค้าที่มาซื้อ', value: fmtNum(c.buyers), sub: delta(c.buyers, p.buyers) || 'คน (ไม่นับซ้ำ)' },
    { label: 'ยอดซื้อรวม', value: '฿' + fmtMoney(c.sales), sub: delta(c.sales, p.sales) },
    { label: 'จำนวนบิล', value: fmtNum(c.bills), sub: c.bills ? `เฉลี่ย ฿${fmtMoney(Math.round(c.sales / c.bills))} ต่อบิล` : delta(c.bills, p.bills) },
    { label: `${unit()}ที่แจก`, value: fmtNum(c.pointsIssued), sub: delta(c.pointsIssued, p.pointsIssued) },
    { label: `${unit()}ที่ถูกแลก`, value: fmtNum(c.pointsRedeemed), sub: delta(c.pointsRedeemed, p.pointsRedeemed) },
    { label: one ? 'คูปองที่ใช้ที่สาขานี้' : 'คูปองที่ใช้ที่ร้าน', value: fmtNum(c.couponsUsed), sub: delta(c.couponsUsed, p.couponsUsed) || 'พนักงานสแกนแล้ว' }
  ];
  document.getElementById('view').innerHTML = `
    ${pageHead('ภาพรวม', 'ตัวเลขของช่วงที่เลือก เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน' + branchNote(), `<button class="btn btn-sm" data-act="refresh">${icon('refresh', 16)} รีเฟรช</button>`)}
    ${rangeBar()}
    <div class="kpis">${tiles.map(t => `
      <div class="kpi"><div class="kpi-label">${esc(t.label)}</div><div class="kpi-value">${t.value}</div><div class="kpi-sub">${t.sub || ''}</div></div>`).join('')}
    </div>
    <section class="card adm-card">
      <div class="card-head"><h2>ยอดซื้อ${d.period.bucket === 'month' ? 'รายเดือน' : 'รายวัน'}</h2><span class="muted small">แตะหรือชี้ที่แท่งเพื่อดูตัวเลข</span></div>
      ${chartHtml(d)}
    </section>
    ${compareHtml(d)}
    <div class="adm-grid3">
      <section class="card adm-card">
        <div class="card-head"><h2>${one ? 'ของรางวัลที่ใช้ที่สาขานี้' : 'ของรางวัลยอดนิยม'}</h2></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>ของรางวัล</th>${one ? '' : '<th class="num">แลก</th>'}<th class="num">ใช้แล้ว</th></tr></thead>
          <tbody>${d.topRewards.length ? d.topRewards.map(r => `
            <tr><td>${esc(r.name)}</td>${one ? '' : `<td class="num">${fmtNum(r.issued)}</td>`}<td class="num">${fmtNum(r.used)}</td></tr>`).join('') : emptyRow(3, one ? 'ยังไม่มีคูปองที่ใช้ที่สาขานี้ในช่วงนี้' : 'ยังไม่มีการแลกในช่วงนี้')}
          </tbody></table></div>
      </section>
      <section class="card adm-card">
        <div class="card-head"><h2>ลูกค้าซื้อมากสุด</h2></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>สมาชิก</th><th class="num">บิล</th><th class="num">ยอดซื้อ</th></tr></thead>
          <tbody>${d.topMembers.length ? d.topMembers.map(m => `
            <tr class="row-link" data-act="member" data-id="${esc(m.memberId)}"><td>${memberLink(m.memberId, m.name)}</td><td class="num">${fmtNum(m.bills)}</td><td class="num">฿${fmtMoney(m.sales)}</td></tr>`).join('') : emptyRow(3, 'ยังไม่มียอดซื้อในช่วงนี้')}
          </tbody></table></div>
      </section>
      <section class="card adm-card">
        <div class="card-head"><h2>ตามพนักงาน</h2></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>พนักงาน</th><th class="num">บิล</th><th class="num">ยอดซื้อ</th><th class="num">คูปอง</th></tr></thead>
          <tbody>${d.byStaff.length ? d.byStaff.map(s => `
            <tr><td>${esc(s.staff)}</td><td class="num">${fmtNum(s.bills)}</td><td class="num">฿${fmtMoney(s.sales)}</td><td class="num">${fmtNum(s.couponsUsed)}</td></tr>`).join('') : emptyRow(4, 'ยังไม่มีรายการในช่วงนี้')}
          </tbody></table></div>
      </section>
    </div>`;
  setupChart(d);
}

// ตารางเทียบสาขา (ตอนดูทุกสาขา) — กดแถวเพื่อดูเฉพาะสาขานั้น / แถวท้าย = รายการที่ไม่ผูกกับสาขา
function compareHtml(d) {
  const rows = d.byBranch || [];
  if (!rows.length) return '';
  const top = Math.max(1, ...rows.map(r => r.sales));
  const total = rows.reduce((a, r) => a + r.sales, 0);
  return `
    <section class="card adm-card flush">
      <div class="card-head pad"><h2>${icon('pin', 18)} เทียบสาขา</h2><span class="muted small">กดชื่อสาขาเพื่อดูเฉพาะสาขานั้น</span></div>
      <div class="tbl-wrap"><table class="tbl compare">
        <thead><tr><th>สาขา</th><th class="num">ยอดซื้อ</th><th class="share-col">สัดส่วน</th><th class="num">บิล</th><th class="num">ลูกค้า</th><th class="num">${esc(unit())}ที่แจก</th><th class="num">คูปองที่ใช้</th><th class="num">สมาชิกใหม่</th></tr></thead>
        <tbody>${rows.map(r => {
          const other = r.id === 'OTHER';
          const pct = total ? Math.round((r.sales / total) * 100) : 0;
          return `
          <tr class="${other ? 'muted-row' : 'row-link'}" ${other ? '' : `data-act="branch-filter" data-id="${esc(r.id)}"`}>
            <td class="strong">${other ? 'ออนไลน์ / หลังบ้าน / ไม่ระบุ' : `<a href="#overview">${esc(r.name)}</a>${r.status === 'ACTIVE' ? '' : ' <span class="chip">ปิดแล้ว</span>'}`}</td>
            <td class="num">฿${fmtMoney(r.sales)}</td>
            <td class="share-col"><div class="share"><i style="width:${((r.sales / top) * 100).toFixed(1)}%"></i></div><span class="muted small">${fmtNum(pct)}%</span></td>
            <td class="num">${fmtNum(r.bills)}</td>
            <td class="num">${fmtNum(r.buyers)}</td>
            <td class="num">${fmtNum(r.pointsIssued)}</td>
            <td class="num">${fmtNum(r.couponsUsed)}</td>
            <td class="num">${fmtNum(r.newMembers)}</td>
          </tr>`;
        }).join('')}
        </tbody></table></div>
      ${rows.some(r => r.id === 'OTHER') ? '<p class="muted small pad">แถวสุดท้ายคือรายการก่อนเพิ่มสาขา ลูกค้าที่สมัครเองโดยไม่ได้สแกน QR สาขา และการปรับแต้มจากหลังบ้าน</p>' : ''}
    </section>`;
}

// ค่าบนสุดของแกนให้เป็นเลขกลมๆ (1, 2, 5 × 10ⁿ) อ่านง่ายกว่าค่าสูงสุดจริง
function niceMax(v) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(n => n >= v);
}

function shortBaht(n) {
  if (n >= 1000000) return '฿' + (n / 1000000).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + 'M';
  if (n >= 10000) return '฿' + (n / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 }) + 'K';
  return '฿' + fmtNum(n);
}

// กราฟแท่งเขียนด้วย HTML ธรรมดา (ไม่ต้องโหลดไลบรารีกราฟ) — ชุดข้อมูลเดียว จึงไม่ต้องมีคำอธิบายสี
// ทั้งคอลัมน์เป็นพื้นที่กด/ชี้ (ใหญ่กว่าแท่ง) และมีตารางให้ดูตัวเลขทั้งหมด
function chartHtml(d) {
  const s = d.series;
  const month = d.period.bucket === 'month';
  const label = k => (month ? fmtMonth : fmtDayShort).format(keyDate(k));
  const top = niceMax(Math.max(0, ...s.map(b => b.sales)));
  const every = Math.max(1, Math.ceil(s.length / 7)); // ป้ายวันที่ใต้กราฟไม่เกิน ~7 ป้าย ไม่ให้ตัวหนังสือชนกัน
  if (!top) return `<div class="chart-empty muted">ยังไม่มียอดซื้อในช่วงนี้</div>`;
  return `
    <div class="chart">
      <div class="chart-plot" id="chart-plot">
        ${[1, 0.5].map(f => `<div class="chart-grid" style="bottom:${f * 100}%"><span>${shortBaht(top * f)}</span></div>`).join('')}
        <div class="bars">${s.map((b, i) => `
          <button type="button" class="bar-col" data-i="${i}" aria-label="${esc(label(b.key))}: ยอดซื้อ ${fmtMoney(b.sales)} บาท ${fmtNum(b.bills)} บิล">
            <i class="${b.sales > 0 ? 'has' : ''}" style="height:${((b.sales / top) * 100).toFixed(2)}%"></i>
          </button>`).join('')}
        </div>
        <div class="chart-tip" id="chart-tip" hidden></div>
      </div>
      <div class="chart-x">${s.map((b, i) => `<span>${i % every === 0 ? esc(label(b.key)) : ''}</span>`).join('')}</div>
    </div>
    <details class="chart-table">
      <summary>ดูเป็นตาราง</summary>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${month ? 'เดือน' : 'วันที่'}</th><th class="num">ยอดซื้อ</th><th class="num">บิล</th><th class="num">สมาชิกใหม่</th></tr></thead>
        <tbody>${s.slice().reverse().map(b => `
          <tr><td>${esc(month ? fmtMonth.format(keyDate(b.key)) : fmtDayLong.format(keyDate(b.key)))}</td><td class="num">฿${fmtMoney(b.sales)}</td><td class="num">${fmtNum(b.bills)}</td><td class="num">${fmtNum(b.newMembers)}</td></tr>`).join('')}
        </tbody></table></div>
    </details>`;
}

function setupChart(d) {
  const plot = document.getElementById('chart-plot');
  if (!plot) return;
  const tip = document.getElementById('chart-tip');
  const month = d.period.bucket === 'month';
  const show = col => {
    const b = d.series[Number(col.dataset.i)];
    if (!b) return;
    plot.querySelectorAll('.bar-col.on').forEach(x => x.classList.remove('on'));
    col.classList.add('on');
    tip.innerHTML = `<b>${esc(month ? fmtMonth.format(keyDate(b.key)) : fmtDayLong.format(keyDate(b.key)))}</b>
      <div>ยอดซื้อ ฿${fmtMoney(b.sales)}</div><div>${fmtNum(b.bills)} บิล · สมาชิกใหม่ ${fmtNum(b.newMembers)}</div>`;
    tip.hidden = false;
    // วางกล่องตัวเลขเหนือแท่ง แต่ไม่ให้ล้นขอบกราฟ
    const pr = plot.getBoundingClientRect();
    const cr = col.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = Math.min(pr.width - half, Math.max(half, cr.left - pr.left + cr.width / 2));
    tip.style.left = x + 'px';
  };
  const hide = () => { tip.hidden = true; plot.querySelectorAll('.bar-col.on').forEach(x => x.classList.remove('on')); };
  plot.addEventListener('pointerover', e => { const col = e.target.closest('.bar-col'); if (col) show(col); });
  plot.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
  plot.addEventListener('focusin', e => { const col = e.target.closest('.bar-col'); if (col) show(col); });
  plot.addEventListener('click', e => { const col = e.target.closest('.bar-col'); if (col) show(col); });
}

/* =====================================================
 * สมาชิก
 * ===================================================== */
function loadMembers() {
  const m = S.members;
  fetchView('adminMembers', { q: m.q, sort: m.sort, status: m.status, page: m.page, birthMonth: m.birth === 'this', ...branchData() }, renderMembers);
}

function renderMembers(r) {
  const m = S.members;
  const opt = (value, label, cur) => `<option value="${value}" ${cur === value ? 'selected' : ''}>${label}</option>`;
  const owner = isOwner();
  document.getElementById('view').innerHTML = `
    ${pageHead('สมาชิก', `${fmtNum(r.total)} คน${m.q || m.status || m.birth ? ' (ตามที่ค้นหา)' : ''}${S.branch ? ` · สมัครที่${branchNote()}` : ''}`, exportBtn('members'))}
    <form class="filters" data-form="members" autocomplete="off">
      ${branchSelect()}
      <div class="search-box">${icon('search', 18)}<input name="q" value="${esc(m.q)}" placeholder="${owner ? 'ค้นชื่อ / รหัสสมาชิก / เบอร์โทร' : 'ค้นชื่อ / รหัสสมาชิก / เบอร์โทรเต็ม'}" enterkeyhint="search"></div>
      <select name="sort" aria-label="เรียงตาม">
        ${opt('joined', 'สมัครล่าสุด', m.sort)}${opt('lastVisit', 'มาล่าสุด', m.sort)}${opt('points', `${esc(unit())}มากสุด`, m.sort)}${opt('spend', 'ยอดซื้อมากสุด', m.sort)}${opt('name', 'ชื่อ ก–ฮ', m.sort)}
      </select>
      <select name="status" aria-label="สถานะ">
        ${opt('', 'ทุกสถานะ', m.status)}${opt('ACTIVE', 'ใช้งานได้', m.status)}${opt('BLOCKED', 'ถูกระงับ', m.status)}
      </select>
      ${owner ? `<select name="birth" aria-label="เดือนเกิด">${opt('', 'ทุกเดือนเกิด', m.birth)}${opt('this', '🎂 เกิดเดือนนี้', m.birth)}</select>` : ''}
      <button class="btn btn-sm btn-primary" type="submit">ค้นหา</button>
    </form>
    ${owner ? '' : '<p class="muted small adm-note">ผู้จัดการเห็นเบอร์โทรแค่ 4 ตัวท้าย (เจ้าของร้านเห็นเต็ม)</p>'}
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>ชื่อ</th><th>รหัสสมาชิก</th><th>เบอร์โทร</th><th class="num">${esc(unit())}</th><th class="num">ยอดซื้อรวม</th><th class="num">ครั้งที่มา</th><th>สมัครเมื่อ</th>${hasBranches() ? '<th>สมัครที่</th>' : ''}<th>มาล่าสุด</th><th>สถานะ</th></tr></thead>
        <tbody>${r.items.length ? r.items.map(x => `
          <tr class="row-link" data-act="member" data-id="${esc(x.memberId)}">
            <td class="strong">${memberLink(x.memberId, x.name)}</td>
            <td class="mono">${esc(x.memberId)}</td>
            <td class="nowrap">${esc(fmtPhone(x.phone) || x.phoneMasked || '-')}</td>
            <td class="num">${fmtNum(x.points)}</td>
            <td class="num">฿${fmtMoney(x.totalSpend)}</td>
            <td class="num">${fmtNum(x.visitCount)}</td>
            <td class="nowrap">${fmtDate(x.joinedAt)}</td>
            ${hasBranches() ? `<td class="nowrap">${esc(branchName(x.joinedBranch))}</td>` : ''}
            <td class="nowrap">${x.lastVisitAt ? fmtDate(x.lastVisitAt) : '-'}</td>
            <td>${x.status === 'ACTIVE' ? statusChip('active', 'ใช้งานได้') : statusChip('blocked', 'ถูกระงับ')}</td>
          </tr>`).join('') : emptyRow(10, m.q || S.branch ? 'ไม่พบสมาชิกที่ค้นหา' : 'ยังไม่มีสมาชิก')}
        </tbody></table></div>
    </section>
    ${pager(r, 'members')}`;
}

/* =====================================================
 * สมาชิกรายคน (+ ปรับแต้ม ใช้คำสั่ง adjustPoints ตัวเดียวกับหน้าพนักงาน)
 * ===================================================== */
function loadMember(id) {
  fetchView('adminMember', { memberId: id }, renderMember);
}

function renderMember(r) {
  const m = r.member;
  S.member = m;
  const owner = isOwner();
  document.getElementById('view').innerHTML = `
    <a class="back-link" href="#members">${icon('left', 16)} รายชื่อสมาชิก</a>
    <section class="card adm-card member-head">
      <div class="avatar">${m.picture ? `<img src="${esc(m.picture)}" alt="" referrerpolicy="no-referrer">` : icon('user', 26)}</div>
      <div class="grow">
        <div class="m-name">${esc(m.name)}</div>
        <div class="m-sub mono">${esc(m.memberId)}</div>
      </div>
      ${m.status === 'ACTIVE' ? statusChip('active', 'ใช้งานได้') : statusChip('blocked', 'ถูกระงับ')}
    </section>
    <div class="kpis kpis-3">
      <div class="kpi"><div class="kpi-label">${esc(unit())}คงเหลือ</div><div class="kpi-value">${fmtNum(m.points)}</div></div>
      <div class="kpi"><div class="kpi-label">ยอดซื้อรวม</div><div class="kpi-value">฿${fmtMoney(m.totalSpend)}</div></div>
      <div class="kpi"><div class="kpi-label">จำนวนครั้งที่มา</div><div class="kpi-value">${fmtNum(m.visitCount)}</div></div>
    </div>
    <div class="adm-grid2">
      <section class="card adm-card">
        <div class="card-head"><h2>ข้อมูลสมาชิก</h2></div>
        <dl class="kv">
          ${m.firstName ? `<dt>ชื่อ</dt><dd>${esc(m.firstName)}</dd><dt>นามสกุล</dt><dd>${esc(m.lastName || '-')}</dd>` : ''}
          <dt>เบอร์โทร</dt><dd>${esc(fmtPhone(m.phone) || m.phoneMasked || '-')}</dd>
          ${owner ? `<dt>วันเกิด</dt><dd>${m.birthDate ? fmtDate(m.birthDate + 'T00:00:00+07:00') : '-'}${m.birthSelfEdits ? ' <span class="muted small">(ลูกค้าแก้เองครบแล้ว)</span>' : ''}</dd>` : ''}
          <dt>สมัครเมื่อ</dt><dd>${fmtDateTime(m.joinedAt)}</dd>
          ${hasBranches() ? `<dt>สมัครที่สาขา</dt><dd>${esc(branchName(m.joinedBranch))}</dd>
          <dt>มาบ่อยที่สุด</dt><dd>${m.topBranch ? `${esc(branchName(m.topBranch))} <span class="muted small">(${fmtNum(m.topBranchVisits)} บิลล่าสุด)</span>` : '-'}</dd>` : ''}
          <dt>มาล่าสุด</dt><dd>${m.lastVisitAt ? fmtDateTime(m.lastVisitAt) : '-'}</dd>
          <dt>ยอมรับนโยบาย</dt><dd>${m.consentAt ? `ฉบับที่ ${esc(m.consentVersion || '-')} · ${fmtDate(m.consentAt)}` : '-'}</dd>
          <dt>รับข่าวสาร</dt><dd>${m.marketingConsent ? 'ยินยอม' : 'ไม่ยินยอม'}</dd>
          <dt>บัญชี LINE</dt><dd>${m.lineLinked ? 'เชื่อมแล้ว' : 'ยังไม่เชื่อม'}</dd>
          ${m.note ? `<dt>หมายเหตุ</dt><dd>${esc(m.note)}</dd>` : ''}
        </dl>
        <div class="member-status-row">
          ${owner ? `<button class="btn btn-sm" data-act="member-edit">${icon('edit', 16)} แก้ไขข้อมูล</button>` : ''}
          ${m.status === 'ACTIVE'
            ? `<button class="btn btn-sm btn-danger-outline" data-act="member-status">${icon('shield', 16)} ระงับสมาชิก</button>`
            : `<button class="btn btn-sm btn-primary" data-act="member-status">${icon('check', 16)} เปิดใช้อีกครั้ง</button>`}
        </div>
        ${owner ? '' : '<p class="muted small">ผู้จัดการไม่เห็นเบอร์เต็มและวันเกิด (เจ้าของร้านเห็น)</p>'}
      </section>
      <section class="card adm-card">
        <div class="card-head"><h2>${icon('coins', 18)} ปรับ${esc(unit())}</h2></div>
        <form class="form" data-form="adjust" autocomplete="off">
          <label class="field"><span>จำนวน (+ เพิ่ม / − ลด)</span><input name="points" inputmode="numeric" placeholder="เช่น 50 หรือ -20"></label>
          <label class="field"><span>เหตุผล <em>*</em></span><input name="reason" maxlength="150" placeholder="เช่น แก้ยอดที่บันทึกผิด"></label>
          <button class="btn btn-primary" type="submit">ปรับ${esc(unit())}</button>
          <p class="muted small">ทุกการปรับจะบันทึกชื่อคุณและเหตุผลไว้ในประวัติ</p>
        </form>
      </section>
    </div>
    <section class="card adm-card flush">
      <div class="card-head pad"><h2>ประวัติ${esc(unit())}</h2><span class="muted small">${fmtNum(r.history.length)} รายการล่าสุด</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>วันเวลา</th><th>ประเภท</th><th>รายละเอียด</th><th class="num">ยอดซื้อ</th><th class="num">${esc(unit())}</th><th class="num">คงเหลือ</th><th>พนักงาน</th>${hasBranches() ? '<th>สาขา</th>' : ''}</tr></thead>
        <tbody>${r.history.length ? r.history.map(t => `
          <tr>
            <td class="nowrap">${fmtDateTime(t.date)}</td>
            <td class="nowrap">${esc(TX_LABEL[t.type] || t.type)}</td>
            <td>${esc(t.detail)}</td>
            <td class="num">${t.type === 'EARN' ? '฿' + fmtMoney(t.amount) : ''}</td>
            <td class="num tx-points ${ptsClass(t.points)}">${signed(t.points)}</td>
            <td class="num">${fmtNum(t.balance)}</td>
            <td>${esc(t.staff === 'SYSTEM' ? 'ระบบ' : t.staff || '-')}</td>
            ${hasBranches() ? `<td class="nowrap">${esc(t.type === 'REDEEM' || t.type === 'WELCOME' ? '-' : branchName(t.branch))}</td>` : ''}
          </tr>`).join('') : emptyRow(8, 'ยังไม่มีรายการ')}
        </tbody></table></div>
    </section>
    ${(m.profileLog || []).length ? `
    <section class="card adm-card flush">
      <div class="card-head pad"><h2>ประวัติการแก้ข้อมูล</h2><span class="muted small">จดเฉพาะช่องที่แก้ ไม่เก็บค่าเดิม</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>วันเวลา</th><th>แก้ช่อง</th><th>โดย</th></tr></thead>
        <tbody>${m.profileLog.map(l => `
          <tr><td class="nowrap">${fmtDateTime(l.date)}</td><td>${esc(l.changed)}</td><td>${esc(l.by)}</td></tr>`).join('')}
        </tbody></table></div>
    </section>` : ''}
    <section class="card adm-card flush">
      <div class="card-head pad"><h2>คูปอง</h2><span class="muted small">${fmtNum(r.coupons.length)} ใบ</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>ของรางวัล</th><th>รหัสคูปอง</th><th>สถานะ</th><th>แลกเมื่อ</th><th>ใช้ได้ถึง</th><th>ใช้เมื่อ</th></tr></thead>
        <tbody>${r.coupons.length ? r.coupons.map(c => `
          <tr>
            <td>${esc(c.name)}</td>
            <td class="mono">${esc(c.code)}</td>
            <td>${statusChip(c.status, COUPON_LABEL[c.status])}</td>
            <td class="nowrap">${fmtDateTime(c.issuedAt)}</td>
            <td class="nowrap">${fmtDate(c.expiresAt)}</td>
            <td class="nowrap">${c.usedAt ? fmtDateTime(c.usedAt) + (c.usedBy ? ' · ' + esc(c.usedBy) : '') + (hasBranches() && c.usedBranch ? ' · ' + esc(branchName(c.usedBranch)) : '') : '-'}</td>
          </tr>`).join('') : emptyRow(6, 'ยังไม่เคยแลกรางวัล')}
        </tbody></table></div>
    </section>`;
}

function onAdjustSubmit(form) {
  const m = S.member;
  if (!m) return;
  const points = Number(String(form.points.value).replace(/[,\s]/g, '').replace('−', '-'));
  const reason = form.reason.value.trim();
  if (!Number.isInteger(points) || points === 0) return toast('ใส่จำนวนเป็นจำนวนเต็ม เช่น 50 หรือ -20', 'err');
  if (reason.length < 3) return toast('กรุณาใส่เหตุผล', 'err');
  if (m.points + points < 0) return toast(`ลดได้ไม่เกิน ${fmtNum(m.points)} ${unit()}`, 'err');
  S.pendingAdjust = { memberId: m.memberId, points, reason };
  openModal(`
    <div class="modal-head"><h2>ยืนยันปรับ${esc(unit())}</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <div class="confirm-cost"><b>${signed(points)}</b><span>${esc(unit())} · ${esc(m.name)}</span>
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
    toast(r.duplicate ? 'รายการนี้บันทึกไปแล้ว (ระบบไม่บันทึกซ้ำ)' : `ปรับแล้ว · คงเหลือ ${fmtNum(r.balance)} ${unit()}`, 'ok');
    loadMember(p.memberId);
  } catch (e) {
    setBusy(btn, false);
    toast(e.code === 'NETWORK' ? e.message + ' (กดยืนยันอีกครั้งได้ ระบบจะไม่บันทึกซ้ำ)' : e.message, 'err');
  }
}

/* =====================================================
 * แก้ข้อมูลสมาชิกแทนลูกค้า (เจ้าของร้านเท่านั้น — Apps Script ตรวจซ้ำ)
 * ใช้ตอนลูกค้าโทรมาขอแก้ หรือขอแก้วันเกิดครั้งที่สอง / การรับข่าวสารไม่มีให้แก้ (ลูกค้ายินยอมเองเท่านั้น)
 * ===================================================== */
function openMemberEdit() {
  const m = S.member;
  if (!m || !isOwner()) return;
  openModal(`
    <div class="modal-head"><h2>แก้ไขข้อมูลสมาชิก</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <p class="muted small mono">${esc(m.memberId)}</p>
    <form class="form" data-form="member-edit" autocomplete="off">
      <div class="form-grid">
        <label class="field"><span>ชื่อ <em>*</em></span><input name="firstName" value="${esc(m.firstName || m.name)}" maxlength="40"></label>
        <label class="field"><span>นามสกุล <em>*</em></span><input name="lastName" value="${esc(m.firstName ? m.lastName : '')}" maxlength="40"></label>
        <label class="field"><span>เบอร์มือถือ <em>*</em></span><input name="phone" value="${esc(m.phone || '')}" inputmode="numeric" maxlength="10" placeholder="08xxxxxxxx"></label>
        <label class="field"><span>วันเกิด <em>*</em></span><input type="date" name="birthDate" value="${esc(m.birthDate || '')}" max="${todayKey()}"></label>
      </div>
      <p class="muted small">ทุกการแก้จะจดไว้ในประวัติ (ช่องที่แก้ + ชื่อคุณ) · การรับข่าวสารลูกค้าต้องเปิด-ปิดเองในหน้าข้อมูลของฉัน</p>
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">ยกเลิก</button>
        <button class="btn btn-primary" type="submit">บันทึก</button>
      </div>
    </form>`);
}

async function saveMemberEdit(form) {
  const m = S.member;
  const v = formValues(form, ['firstName', 'lastName', 'phone', 'birthDate']);
  v.phone = v.phone.replace(/\D/g, '');
  if (!v.firstName || !v.lastName) return toast('กรุณากรอกชื่อและนามสกุล', 'err');
  if (!/^0[689]\d{8}$/.test(v.phone)) return toast('กรุณากรอกเบอร์มือถือ 10 หลัก', 'err');
  if (!v.birthDate) return toast('กรุณาเลือกวันเกิด', 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await S.api.call('adminMemberUpdate', { memberId: m.memberId, ...v });
    closeModal();
    toast(r.changed ? 'บันทึกข้อมูลสมาชิกแล้ว' : 'ข้อมูลเหมือนเดิม ไม่มีอะไรเปลี่ยน', 'ok');
    loadMember(m.memberId);
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * ระงับ / เปิดใช้สมาชิก (ระงับแล้วสะสมแต้ม แลก และใช้คูปองไม่ได้ ข้อมูลยังอยู่ครบ)
 * ===================================================== */
function openMemberStatus() {
  const m = S.member;
  if (!m) return;
  const blocking = m.status === 'ACTIVE';
  openModal(`
    <div class="modal-head"><h2>${blocking ? 'ระงับสมาชิก' : 'เปิดใช้สมาชิกอีกครั้ง'}</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <p><b>${esc(m.name)}</b> <span class="muted mono">${esc(m.memberId)}</span></p>
    <form class="form" data-form="member-status" autocomplete="off">
      ${blocking ? `
        <p class="notice">${icon('alert', 18)}<span>ระงับแล้ว ลูกค้าจะสะสม${esc(unit())} แลกรางวัล และใช้คูปองไม่ได้ จนกว่าจะเปิดใช้อีกครั้ง (${esc(unit())}ที่มีอยู่ไม่หาย)</span></p>
        <label class="field"><span>เหตุผล <em>*</em></span><input name="reason" maxlength="150" placeholder="เช่น ใช้บัญชีร่วมกันหลายคน"></label>`
        : `<label class="field"><span>หมายเหตุ <small>(ไม่บังคับ)</small></span><input name="reason" maxlength="150"></label>`}
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">ยกเลิก</button>
        <button class="btn ${blocking ? 'btn-danger' : 'btn-primary'}" type="submit">${blocking ? 'ระงับ' : 'เปิดใช้'}</button>
      </div>
    </form>`);
}

async function saveMemberStatus(form) {
  const m = S.member;
  const blocking = m.status === 'ACTIVE';
  const reason = form.elements.reason.value.trim();
  if (blocking && reason.length < 3) return toast('กรุณาใส่เหตุผลที่ระงับ', 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    await S.api.call('adminMemberStatus', { memberId: m.memberId, status: blocking ? 'BLOCKED' : 'ACTIVE', reason });
    closeModal();
    toast(blocking ? 'ระงับสมาชิกแล้ว' : 'เปิดใช้สมาชิกแล้ว', 'ok');
    loadMember(m.memberId);
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * ของรางวัล / โปรโมชัน (แทนการแก้ชีต Rewards / Promotions)
 * ===================================================== */
// ลิงก์แชร์ Google Drive → ลิงก์รูปตรง (ต้องตรงกับ driveImage_ ใน code.gs)
function driveImage(url) {
  const s = String(url || '').trim();
  const m = s.match(/^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#\s]*&)?id=)([A-Za-z0-9_-]{20,})/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1000` : s;
}

// ขนาดรูปที่แนะนำ + สัดส่วนที่หน้าลูกค้าแสดงจริง (ผู้ใช้ขอ 5 พ.ย. 2569)
// ratio วัดจากหน้าลูกค้าบนมือถือ (กว้าง 390px): แบนเนอร์โปรโมชัน ~335×150 / การ์ดของรางวัล ~173×118 / โลโก้ จัตุรัส
// แก้ขนาดการ์ดใน themes/base.css (.promo-card / .reward-img) แล้วต้องแก้ ratio ที่นี่ + .img-frame-* ด้วย
const IMAGE_SPECS = {
  promo: { w: 1200, h: 500, ratio: 335 / 150, shape: 'แนวนอนยาว', tip: 'วางของสำคัญไว้กลาง-ขวา ด้านซ้ายมีข้อความโปรโมชันทับ ขอบบน-ล่างอาจถูกตัด' },
  reward: { w: 1200, h: 800, ratio: 173 / 118, shape: 'แนวนอน', tip: 'วางของสำคัญไว้กลางภาพ ขอบอาจถูกตัดเล็กน้อย' },
  logo: { w: 500, h: 500, ratio: 1, shape: 'สี่เหลี่ยมจัตุรัส', tip: 'โลโก้อยู่กลางภาพ เว้นขอบนิดหน่อย' }
};
// รูปที่ถูกตัดออกเกินเท่านี้ → เตือน (เช่น รูปแนวตั้งในแบนเนอร์ ถูกตัดเกินครึ่ง) แค่เตือน ยังบันทึกได้
const CROP_WARN = 0.4;

function previewHtml(url, kind = 'reward') {
  const src = driveImage(url);
  if (!src) return '<span class="muted small">ยังไม่มีรูป</span>';
  if (!/^https:\/\/[^\s"'<>]+$/i.test(src)) return '<span class="form-error small">ลิงก์ต้องขึ้นต้นด้วย https://</span>';
  // กรอบทรงเดียวกับที่ลูกค้าเห็น → เจ้าของร้านรู้ทันทีว่ารูปถูกตัดตรงไหน
  return `<div class="img-frame img-frame-${esc(kind)}"><img src="${esc(src)}" alt="" referrerpolicy="no-referrer" data-kind="${esc(kind)}"></div>
    <span class="muted small img-note">ตัวอย่างนี้ตัดขอบแบบเดียวกับหน้าลูกค้า · ถ้าไม่เห็นรูป ลองอัปโหลดใหม่ หรือใช้ลิงก์รูปอื่น</span>
    <span class="img-warn small" hidden></span>`;
}

// รูปในกรอบตัวอย่างโหลดเสร็จ → ดูสัดส่วนจริง ถ้าทรงต่างจากที่ลูกค้าเห็นมาก ขึ้นคำเตือน
// (ใช้ load แบบดักทั้งหน้า เพราะรูปถูกสร้างใหม่ทุกครั้งที่เปลี่ยนลิงก์ และห้ามใช้ onload ในข้อความ HTML)
document.addEventListener('load', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.matches('.img-frame img')) return;
  const warn = img.closest('.img-preview') && img.closest('.img-preview').querySelector('.img-warn');
  const spec = IMAGE_SPECS[img.dataset.kind];
  if (!warn || !spec || !img.naturalWidth || !img.naturalHeight) return;
  const r = img.naturalWidth / img.naturalHeight;
  const cut = 1 - Math.min(r, spec.ratio) / Math.max(r, spec.ratio);
  const shape = r < 0.9 ? 'แนวตั้ง' : r > 1.1 ? 'แนวนอน' : 'จัตุรัส';
  warn.hidden = cut < CROP_WARN;
  warn.textContent = warn.hidden ? '' : `⚠️ รูปนี้เป็น${shape} (${img.naturalWidth} × ${img.naturalHeight} px) จะถูกตัดออกประมาณ ${Math.round(cut * 100)}% ดูกรอบตัวอย่างด้านบน — แนะนำ ${spec.w} × ${spec.h} px (${spec.shape}) · ใช้รูปนี้ต่อก็ได้`;
}, true);

const imageHint = 'วางลิงก์รูปที่ขึ้นต้นด้วย https://';

function periodText(start, end) {
  const d = k => fmtDayLong.format(keyDate(k));
  if (start && end) return `${d(start)} – ${d(end)}`;
  if (start) return `ตั้งแต่ ${d(start)}`;
  if (end) return `ถึง ${d(end)}`;
  return 'ไม่จำกัด';
}

function stateChip(state) {
  return statusChip(state === 'ACTIVE' ? 'active' : `state-${state.toLowerCase()}`, STATE_LABEL[state] || state);
}

function thumb(url, wide) {
  return `<div class="thumb ${wide ? 'wide' : ''}">${url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : icon(wide ? 'star' : 'gift', 20)}</div>`;
}

function loadRewards() {
  fetchView('adminRewards', {}, renderRewards);
}

function renderRewards(r) {
  S.rewards = r.items;
  S.couponDays = r.couponDays;
  S.canDelete.reward = !!r.canDelete;
  document.getElementById('view').innerHTML = `
    ${pageHead('ของรางวัล', `ลูกค้าเห็นอยู่ ${fmtNum(r.items.filter(x => x.state === 'ACTIVE').length)} จาก ${fmtNum(r.items.length)} รายการ`,
      `<button class="btn btn-sm btn-primary" data-act="reward-edit" data-id="">+ เพิ่มของรางวัล</button>`)}
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th></th><th>ของรางวัล</th><th class="num">ใช้${esc(unit())}</th><th class="num">แลกแล้ว / ทั้งหมด</th><th class="num">ต่อคน</th><th>ช่วงเวลา</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${r.items.length ? r.items.map(x => `
          <tr>
            <td class="thumb-cell">${thumb(x.imageUrl)}</td>
            <td><b>${esc(x.name)}</b>${x.type === 'BIRTHDAY' ? ' <span class="chip chip-bday">🎂 ของขวัญวันเกิด</span>' : ''}${x.description ? `<div class="m-sub">${esc(x.description)}</div>` : ''}<div class="m-sub mono">${esc(x.id)}</div></td>
            <td class="num">${x.points ? fmtNum(x.points) : 'ฟรี'}</td>
            <td class="num">${fmtNum(x.issued)} / ${x.quota ? fmtNum(x.quota) : 'ไม่จำกัด'}</td>
            <td class="num">${x.limitPerMember ? fmtNum(x.limitPerMember) : '-'}</td>
            <td class="nowrap">${esc(periodText(x.startDate, x.endDate))}</td>
            <td>${stateChip(x.state)}</td>
            <td class="actions"><button class="btn btn-sm" data-act="reward-edit" data-id="${esc(x.id)}">${icon('edit', 16)} แก้ไข</button></td>
          </tr>`).join('') : emptyRow(8, 'ยังไม่มีของรางวัล กด "เพิ่มของรางวัล" ได้เลย')}
        </tbody></table></div>
    </section>
    <p class="muted small">${S.canDelete.reward
      ? 'ของรางวัลที่ไม่ใช้แล้ว กดแก้ไข → ลบ (คูปองที่ลูกค้าแลกไปแล้วยังใช้ที่ร้านได้ตามปกติ) · ถ้าแค่พักไว้ชั่วคราว เลือก "ปิด" แทน'
      : 'ของรางวัลที่ไม่ใช้แล้วให้กดแก้ไขแล้วเลือก "ปิด" (ไม่ลบ เพราะคูปองที่ลูกค้าแลกไปแล้วยังอ้างถึงอยู่)'}</p>`;
}

function openRewardEdit(id) {
  const x = id ? S.rewards.find(r => r.id === id) : null;
  if (id && !x) return;
  const v = x || { name: '', description: '', points: '', image: '', validDays: '', quota: '', limitPerMember: '', startDate: '', endDate: '', sort: '', status: 'ACTIVE', issued: 0, type: '' };
  const bday = v.type === 'BIRTHDAY';
  openModal(`
    <div class="modal-head"><h2>${x ? 'แก้ไขของรางวัล' : 'เพิ่มของรางวัล'}</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <form class="form" data-form="reward" data-id="${esc(x ? x.id : '')}" autocomplete="off">
      <label class="field"><span>ชื่อของรางวัล <em>*</em></span><input name="name" value="${esc(v.name)}" maxlength="80" placeholder="เช่น เครื่องดื่มฟรี 1 แก้ว"></label>
      <label class="field"><span>รายละเอียด <small>(ไม่บังคับ)</small></span><textarea name="description" maxlength="300" rows="2" placeholder="เช่น เลือกเครื่องดื่มเย็นที่ร่วมรายการ">${esc(v.description)}</textarea></label>
      <div class="field"><span>ประเภท</span>
        <div class="pick-row">
          <label class="pick"><input type="radio" name="type" value="" ${bday ? '' : 'checked'}><span>แลกด้วย${esc(unit())}</span></label>
          <label class="pick"><input type="radio" name="type" value="BIRTHDAY" ${bday ? 'checked' : ''}><span>🎂 ของขวัญวันเกิด</span></label>
        </div>
        <small class="hint" id="bday-hint" ${bday ? '' : 'hidden'}>ลูกค้าเห็นและกดรับได้เฉพาะเดือนเกิด ปีละ 1 ครั้ง · ต้องเป็นสมาชิกอย่างน้อย 30 วัน · ระบบตรวจเดือนเกิดให้ พนักงานแค่สแกนคูปอง</small></div>
      <div class="form-grid">
        <label class="field"><span>ใช้กี่${esc(unit())}แลก <em id="points-req" ${bday ? 'hidden' : ''}>*</em></span><input name="points" value="${esc(bday && !v.points ? '' : v.points)}" inputmode="numeric" placeholder="${bday ? 'ว่าง = ฟรี' : 'เช่น 80'}"></label>
        <label class="field"><span>คูปองใช้ได้กี่วัน</span><input name="validDays" value="${esc(v.validDays)}" inputmode="numeric" placeholder="${bday ? 'ว่าง = ถึงสิ้นเดือนเกิด' : `ว่าง = ${fmtNum(S.couponDays)} วัน (ค่าร้าน)`}"></label>
        <label class="field"><span>วันเริ่ม</span><input type="date" name="startDate" value="${esc(v.startDate)}"></label>
        <label class="field"><span>วันสิ้นสุด</span><input type="date" name="endDate" value="${esc(v.endDate)}"></label>
        <label class="field"><span>จำนวนทั้งหมด</span><input name="quota" value="${esc(v.quota)}" inputmode="numeric" placeholder="ว่าง = ไม่จำกัด">${x ? `<small>แลกไปแล้ว ${fmtNum(x.issued)}</small>` : ''}
          <small class="hint" id="quota-hint" ${bday ? '' : 'hidden'}>ว่าง = แจกทุกคนที่เกิดเดือนนั้น (แนะนำ) · ครบจำนวนแล้วลูกค้าคนอื่นจะไม่เห็นการ์ด</small></label>
        ${/* ของขวัญวันเกิดจำกัดปีละครั้งต่อคนอยู่แล้ว ช่องนี้ไม่มีผล → ซ่อน กันเจ้าของร้านสับสน */ ''}
        <label class="field" id="limit-field" ${bday ? 'hidden' : ''}><span>จำกัดต่อคน</span><input name="limitPerMember" value="${esc(v.limitPerMember)}" inputmode="numeric" placeholder="ว่าง = ไม่จำกัด"></label>
      </div>
      ${imageField(v.image, 'reward-preview')}
      <div class="form-grid">
        <label class="field"><span>ลำดับที่แสดง</span><input name="sort" value="${esc(v.sort)}" inputmode="numeric" placeholder="เลขน้อยขึ้นก่อน"></label>
        ${statusField(v.status, 'เปิดให้ลูกค้าแลก')}
      </div>
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">ยกเลิก</button>
        <button class="btn btn-primary" type="submit">บันทึก</button>
      </div>
      ${deleteButton('reward', x)}
    </form>`);
}

// kind = promo / reward / logo → ขนาดแนะนำ + ทรงกรอบตัวอย่าง (IMAGE_SPECS)
function imageField(value, previewId, name = 'image', label = 'รูป', disabled = false, kind = 'reward') {
  const spec = IMAGE_SPECS[kind] || IMAGE_SPECS.reward;
  return `
    <div class="field"><span>${esc(label)} <small>(ไม่บังคับ)</small></span>
      ${disabled ? '' : `<div class="img-upload">
        <label class="btn btn-sm upload-btn">${icon('upload', 16)} อัปโหลดรูป
          <input type="file" accept="image/jpeg,image/png,image/webp,image/*" data-upload="${name}" hidden></label>
        <button type="button" class="link" data-act="image-clear" data-id="${name}">ลบรูป</button>
      </div>
      <small class="hint img-size">ขนาดแนะนำ <b>${spec.w} × ${spec.h} px</b> (${esc(spec.shape)}) · ${esc(spec.tip)}</small>`}
      <!-- ลิงก์ของรูปที่อัปโหลดไม่ต้องโชว์ (เจ้าของร้านไม่ต้องรู้ว่ารูปเก็บที่ไหน) — ซ่อนไว้ในหัวข้อพับได้ ใช้เมื่ออยากใช้รูปจากเว็บอื่น -->
      <details class="img-link">
        <summary>ใช้ลิงก์รูปจากเว็บอื่นแทน</summary>
        <input name="${name}" value="${esc(value)}" placeholder="https://..." data-preview="${previewId}" aria-label="ลิงก์รูป" ${disabled ? 'disabled' : ''}>
        <small>${esc(imageHint)}</small>
      </details></div>
    <div class="img-preview" id="${previewId}" data-kind="${esc(kind)}">${previewHtml(value, kind)}</div>`;
}

function clearImage(btn, name) {
  const form = btn.closest('form');
  const input = form && form.elements[name];
  if (!input) return;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ---------- อัปโหลดรูป: ย่อในเครื่องก่อน แล้วส่งให้ Apps Script เก็บใน Google Drive ----------
 * ย่อให้ด้านยาวไม่เกิน 1200px → ไฟล์เล็ก อัปเร็ว ลูกค้าเปิดเร็ว และการวาดใหม่ลง canvas
 * ตัดข้อมูลแฝงในรูปทิ้ง (เช่นพิกัด GPS ที่มือถือฝังไว้) */
const MAX_SIDE = 1200;
const MAX_UPLOAD = 2 * 1024 * 1024;

async function uploadImage(input) {
  const file = input.files && input.files[0];
  const form = input.closest('form');
  input.value = ''; // เลือกไฟล์เดิมซ้ำได้
  if (!file || !form) return;
  showLoading('กำลังเตรียมรูป...');
  try {
    const { blob, mime } = await shrinkImage(file);
    const data = await blobToBase64(blob);
    const kind = { promo: 'promo', brand: 'logo' }[form.dataset.form] || 'reward';
    const r = await S.api.call('adminUploadImage', { data, mime, kind });
    const target = form.elements[input.dataset.upload || 'image'];
    target.value = r.url;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    toast('อัปโหลดรูปแล้ว กดบันทึกเพื่อใช้รูปนี้', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideLoading();
  }
}

async function shrinkImage(file) {
  if (file.size > 30 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกินไป (เกิน 30MB)');
  let img;
  try {
    img = await decodeImage(file);
  } catch (e) {
    throw new Error('เปิดไฟล์รูปนี้ไม่ได้ (เช่นไฟล์ HEIC จาก iPhone ที่โอนมาไว้ในคอม) กรุณาใช้รูป JPG หรือ PNG');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const draw = (whiteBg) => {
    ctx.clearRect(0, 0, w, h);
    if (whiteBg) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); } // JPG ไม่มีพื้นใส → ใช้พื้นขาวแทนดำ
    ctx.drawImage(img, 0, 0, w, h);
  };
  // PNG (เช่นโลโก้พื้นใส) เก็บเป็น PNG / รูปถ่ายเก็บเป็น JPG ไฟล์เล็กกว่ามาก
  let mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  draw(mime === 'image/jpeg');
  let blob = await canvasBlob(canvas, mime, 0.85);
  if (blob.size > MAX_UPLOAD) {
    mime = 'image/jpeg';
    draw(true);
    blob = await canvasBlob(canvas, mime, 0.7);
  }
  if (img.close) img.close();
  if (blob.size > MAX_UPLOAD) throw new Error('รูปใหญ่เกิน 2MB แม้ย่อแล้ว ลองใช้รูปอื่น');
  return { blob, mime };
}

async function decodeImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* ลองอีกวิธี */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function canvasBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('แปลงรูปไม่สำเร็จ'))), mime, quality));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
    reader.readAsDataURL(blob);
  });
}

function statusField(value, onLabel) {
  return `<label class="field"><span>สถานะ</span>
    <select name="status" class="select">
      <option value="ACTIVE" ${value === 'ACTIVE' ? 'selected' : ''}>${esc(onLabel)}</option>
      <option value="INACTIVE" ${value !== 'ACTIVE' ? 'selected' : ''}>ปิด (ลูกค้าไม่เห็น)</option>
    </select></label>`;
}

// ค่าในฟอร์มส่งไปตามที่พิมพ์ Apps Script เป็นคนตรวจทั้งหมด (หน้าเว็บตรวจแค่ช่องบังคับให้รู้เร็วขึ้น)
function formValues(form, names) {
  const o = {};
  names.forEach(n => { o[n] = form.elements[n].value.trim(); });
  return o;
}

// เปลี่ยนประเภทของรางวัล → แต้มไม่บังคับ (ของขวัญวันเกิดให้ฟรีได้) และอายุคูปองค่าตั้งต้นเป็นสิ้นเดือนเกิด
function onRewardType(radio) {
  const form = radio.closest('form');
  const bday = form.elements.type.value === 'BIRTHDAY';
  form.querySelector('#bday-hint').hidden = !bday;
  form.querySelector('#quota-hint').hidden = !bday;
  form.querySelector('#limit-field').hidden = bday;
  form.querySelector('#points-req').hidden = bday;
  form.elements.points.placeholder = bday ? 'ว่าง = ฟรี' : 'เช่น 80';
  form.elements.validDays.placeholder = bday ? 'ว่าง = ถึงสิ้นเดือนเกิด' : `ว่าง = ${fmtNum(S.couponDays)} วัน (ค่าร้าน)`;
}

async function saveReward(form) {
  const reward = formValues(form, ['name', 'description', 'points', 'image', 'validDays', 'quota', 'limitPerMember', 'startDate', 'endDate', 'sort', 'status']);
  reward.id = form.dataset.id;
  reward.type = form.elements.type.value;
  if (reward.type === 'BIRTHDAY') reward.limitPerMember = ''; // ช่องถูกซ่อน ไม่ส่งค่าเก่าที่ค้างอยู่
  if (!reward.name) return toast('กรุณากรอกชื่อของรางวัล', 'err');
  if (!reward.points && reward.type !== 'BIRTHDAY') return toast(`กรุณากรอกจำนวน${unit()}ที่ใช้แลก`, 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await withRequestId('reward|' + JSON.stringify(reward), rid => S.api.call('adminRewardSave', { reward, requestId: rid }));
    closeModal();
    toast(`${r.created ? 'เพิ่ม' : 'บันทึก'} "${r.reward.name}" แล้ว · ${STATE_LABEL[r.reward.state]}`, 'ok');
    loadRewards();
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

function loadPromos() {
  fetchView('adminPromos', {}, renderPromos);
}

function renderPromos(r) {
  S.promos = r.items;
  S.canDelete.promo = !!r.canDelete;
  document.getElementById('view').innerHTML = `
    ${pageHead('โปรโมชัน', `แบนเนอร์หน้าแรกของลูกค้า · แสดงอยู่ ${fmtNum(r.items.filter(x => x.state === 'ACTIVE').length)} จาก ${fmtNum(r.items.length)} รายการ`,
      `<button class="btn btn-sm btn-primary" data-act="promo-edit" data-id="">+ เพิ่มโปรโมชัน</button>`)}
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th></th><th>โปรโมชัน</th><th>ป้าย</th><th>ลิงก์</th><th>ช่วงเวลา</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${r.items.length ? r.items.map(x => `
          <tr>
            <td class="thumb-cell">${thumb(x.imageUrl, true)}</td>
            <td><b>${esc(x.title)}</b>${x.subtitle ? `<div class="m-sub">${esc(x.subtitle)}</div>` : ''}</td>
            <td>${x.tag ? `<span class="chip">${esc(x.tag)}</span>` : '-'}</td>
            <td class="link-cell">${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.link.replace(/^https:\/\//, ''))}</a>` : '-'}</td>
            <td class="nowrap">${esc(periodText(x.startDate, x.endDate))}</td>
            <td>${stateChip(x.state)}</td>
            <td class="actions"><button class="btn btn-sm" data-act="promo-edit" data-id="${esc(x.id)}">${icon('edit', 16)} แก้ไข</button></td>
          </tr>`).join('') : emptyRow(7, 'ยังไม่มีโปรโมชัน')}
        </tbody></table></div>
    </section>`;
}

function openPromoEdit(id) {
  const x = id ? S.promos.find(r => r.id === id) : null;
  if (id && !x) return;
  const v = x || { title: '', subtitle: '', tag: '', image: '', link: '', startDate: '', endDate: '', sort: '', status: 'ACTIVE' };
  openModal(`
    <div class="modal-head"><h2>${x ? 'แก้ไขโปรโมชัน' : 'เพิ่มโปรโมชัน'}</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <form class="form" data-form="promo" data-id="${esc(x ? x.id : '')}" autocomplete="off">
      <label class="field"><span>หัวข้อ <em>*</em></span><input name="title" value="${esc(v.title)}" maxlength="80" placeholder="เช่น แต้ม x2 ทุกวันพุธ"></label>
      <label class="field"><span>ข้อความรอง <small>(ไม่บังคับ)</small></span><input name="subtitle" value="${esc(v.subtitle)}" maxlength="150"></label>
      <div class="form-grid">
        <label class="field"><span>ป้ายเล็ก <small>(ไม่บังคับ)</small></span><input name="tag" value="${esc(v.tag)}" maxlength="30" placeholder="เช่น โปรประจำเดือน"></label>
        <label class="field"><span>ลิงก์เมื่อกด <small>(ไม่บังคับ)</small></span><input name="link" value="${esc(v.link)}" placeholder="https://..."></label>
        <label class="field"><span>วันเริ่ม</span><input type="date" name="startDate" value="${esc(v.startDate)}"></label>
        <label class="field"><span>วันสิ้นสุด</span><input type="date" name="endDate" value="${esc(v.endDate)}"></label>
      </div>
      ${imageField(v.image, 'promo-preview', 'image', 'รูป', false, 'promo')}
      <div class="form-grid">
        <label class="field"><span>ลำดับที่แสดง</span><input name="sort" value="${esc(v.sort)}" inputmode="numeric" placeholder="เลขน้อยขึ้นก่อน"></label>
        ${statusField(v.status, 'แสดงให้ลูกค้าเห็น')}
      </div>
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">ยกเลิก</button>
        <button class="btn btn-primary" type="submit">บันทึก</button>
      </div>
      ${deleteButton('promo', x)}
    </form>`);
}

async function savePromo(form) {
  const promo = formValues(form, ['title', 'subtitle', 'tag', 'image', 'link', 'startDate', 'endDate', 'sort', 'status']);
  promo.id = form.dataset.id;
  if (!promo.title) return toast('กรุณากรอกหัวข้อ', 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await withRequestId('promo|' + JSON.stringify(promo), rid => S.api.call('adminPromoSave', { promo, requestId: rid }));
    closeModal();
    toast(`${r.created ? 'เพิ่ม' : 'บันทึก'} "${r.promo.title}" แล้ว · ${STATE_LABEL[r.promo.state]}`, 'ok');
    loadPromos();
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * แต้มพิเศษ (2.8.0): กติกาคูณแต้ม — เจ้าของร้านตั้ง / ผู้จัดการดูได้ / Apps Script คิดแต้มเองตอนบันทึกยอด
 * ===================================================== */
const DAYS = [['MON', 'จ'], ['TUE', 'อ'], ['WED', 'พ'], ['THU', 'พฤ'], ['FRI', 'ศ'], ['SAT', 'ส'], ['SUN', 'อา']];
const MULTS = [1.5, 2, 3];
const RULE_STATE = { TODAY: ['active', 'มีผลวันนี้'], ACTIVE: ['active', 'ใช้อยู่'], SCHEDULED: ['state-scheduled', 'ยังไม่ถึงวันเริ่ม'], ENDED: ['state-ended', 'หมดเขตแล้ว'], INACTIVE: ['inactive', 'ปิดอยู่'] };

function loadRules() {
  fetchView('adminRules', {}, renderRules);
}

const daysHtml = on => `<div class="days">${DAYS.map(([k, t]) => `<span class="${on.includes(k) ? 'on' : ''}" title="${t}">${t}</span>`).join('')}</div>`;

function renderRules(r) {
  S.rules = r.items;
  S.canDelete.rule = !!r.canDelete;
  const owner = isOwner();
  document.getElementById('view').innerHTML = `
    ${pageHead('แต้มพิเศษ', 'กติกาให้แต้มเพิ่ม ระบบคิดให้เองตอนพนักงานบันทึกยอด · ตรงหลายกติกาพร้อมกัน ใช้อันที่ให้แต้มมากสุดอันเดียว',
      owner ? `<button class="btn btn-sm btn-primary" data-act="rule-edit" data-id="">+ เพิ่มกติกา</button>` : '')}
    <section class="card adm-card flush"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>กติกา</th><th>ได้แต้ม</th><th>วัน</th><th>ช่วงวันที่</th>${hasBranches() ? '<th>สาขา</th>' : ''}<th class="num">ยอดขั้นต่ำ</th><th>สถานะ</th><th></th></tr></thead>
      <tbody>${r.items.length ? r.items.map(x => `
        <tr>
          <td><b>${esc(x.name)}</b>${x.showBadge ? '<div class="m-sub">แสดงป้ายที่หน้าลูกค้า</div>' : ''}</td>
          <td><span class="mult">×${x.multiplier}</span></td>
          <td>${daysHtml(x.days)}</td>
          <td class="nowrap">${esc(periodText(x.startDate, x.endDate))}</td>
          ${hasBranches() ? `<td>${x.branch ? esc(branchName(x.branch)) : 'ทุกสาขา'}</td>` : ''}
          <td class="num">${x.minAmount ? '฿' + fmtMoney(x.minAmount) : '-'}</td>
          <td>${statusChip(...(RULE_STATE[x.state] || ['inactive', x.state]))}</td>
          <td class="actions">${owner ? `<button class="btn btn-sm" data-act="rule-edit" data-id="${esc(x.id)}">${icon('edit', 16)} แก้ไข</button>` : ''}</td>
        </tr>`).join('') : emptyRow(8, owner ? 'ยังไม่มีกติกา กด "เพิ่มกติกา" เช่น แต้ม x2 ทุกวันพุธ' : 'ยังไม่มีกติกา')}
      </tbody></table></div></section>
    <p class="muted small">ตัวอย่าง: บิลที่ปกติได้ 20 ${esc(unit())} วันที่มีกติกา ×2 จะได้ 40 (คูณจาก${esc(unit())}ปกติแล้วปัดเศษลง) · กติกาที่ไม่ใช้แล้ว กดแก้ไข${S.canDelete.rule ? ' → ลบ (แต้มที่ลูกค้าได้ไปแล้วไม่เปลี่ยน)' : 'แล้วเลือก "ปิด"'}${owner ? '' : ' · เจ้าของร้านเป็นคนตั้งกติกา'}</p>`;
}

function openRuleEdit(id) {
  if (!isOwner()) return;
  const x = id ? S.rules.find(r => r.id === id) : null;
  if (id && !x) return;
  // กติกาใหม่ยังไม่เลือกวัน ให้เจ้าของร้านเลือกเอง (ผู้ใช้ขอ 4 พ.ย. 2569 — กันเผลอได้แต้มพิเศษทุกวัน)
  const v = x || { name: '', multiplier: 2, days: [], startDate: '', endDate: '', branch: '', minAmount: '', showBadge: true, status: 'ACTIVE' };
  openModal(`
    <div class="modal-head"><h2>${x ? 'แก้ไขกติกาแต้มพิเศษ' : 'เพิ่มกติกาแต้มพิเศษ'}</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <form class="form" data-form="rule" data-id="${esc(x ? x.id : '')}" autocomplete="off">
      <label class="field"><span>ชื่อกติกา <em>*</em> <small>(ลูกค้าเห็นในประวัติ${esc(unit())})</small></span><input name="name" value="${esc(v.name)}" maxlength="60" placeholder="เช่น แต้ม x2 ทุกวันพุธ"></label>
      <div class="field"><span>ได้${esc(unit())}กี่เท่า</span>
        <div class="pick-row">${MULTS.map(m => `<label class="pick"><input type="radio" name="multiplier" value="${m}" ${Number(v.multiplier) === m ? 'checked' : ''}><span>×${m}</span></label>`).join('')}</div></div>
      <div class="field"><span>วันที่มีผล</span>
        <div class="day-picks">${DAYS.map(([k, t]) => `<label><input type="checkbox" name="days" value="${k}" ${v.days.includes(k) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
      <div class="form-grid">
        <label class="field"><span>วันเริ่ม</span><input type="date" name="startDate" value="${esc(v.startDate)}"></label>
        <label class="field"><span>วันสิ้นสุด</span><input type="date" name="endDate" value="${esc(v.endDate)}"></label>
        <label class="field"><span>ยอดขั้นต่ำต่อบิล (บาท)</span><input name="minAmount" value="${esc(v.minAmount || '')}" inputmode="decimal" placeholder="ว่าง = ทุกบิล"></label>
        ${hasBranches() ? `<label class="field"><span>สาขา</span><select name="branch" class="select"><option value="">ทุกสาขา</option>${S.branches.filter(b => b.status === 'ACTIVE' || b.id === v.branch).map(b => `<option value="${esc(b.id)}" ${b.id === v.branch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>` : ''}
      </div>
      <label class="check"><input type="checkbox" name="showBadge" ${v.showBadge ? 'checked' : ''}><span>แสดงป้าย "วันนี้ …" ที่หน้าลูกค้า เฉพาะวันที่มีผล</span></label>
      ${statusField(v.status, 'เปิดใช้')}
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">ยกเลิก</button>
        <button class="btn btn-primary" type="submit">บันทึก</button>
      </div>
      ${deleteButton('rule', x)}
    </form>`);
}

async function saveRule(form) {
  const f = form.elements;
  const rule = {
    id: form.dataset.id, name: f.name.value.trim(), multiplier: Number(f.multiplier.value),
    days: [...form.querySelectorAll('input[name="days"]:checked')].map(x => x.value),
    startDate: f.startDate.value, endDate: f.endDate.value, minAmount: f.minAmount.value.trim(),
    branch: f.branch ? f.branch.value : '', showBadge: f.showBadge.checked, status: f.status.value
  };
  if (!rule.name) return toast('กรุณากรอกชื่อกติกา', 'err');
  if (!rule.days.length) return toast('เลือกวันที่มีผลอย่างน้อย 1 วัน', 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await withRequestId('rule|' + JSON.stringify(rule), rid => S.api.call('adminRuleSave', { rule, requestId: rid }));
    closeModal();
    toast(`${r.created ? 'เพิ่ม' : 'บันทึก'} "${r.rule.name}" แล้ว · ${(RULE_STATE[r.rule.state] || [])[1] || ''}`, 'ok');
    loadRules();
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * ลบ ของรางวัล / โปรโมชัน / แต้มพิเศษ (ผู้ใช้ขอ 7 พ.ย. 2569 — มีเฉพาะระบบใหม่)
 * ลบแล้วหายจากทุกหน้า แต่ประวัติยังอยู่: คูปองที่แลกไปแล้วใช้ได้ต่อ / แต้มที่ได้ไปแล้วไม่เปลี่ยน
 * ===================================================== */
const DELETE_KIND = {
  reward: { action: 'adminRewardDelete', label: 'ของรางวัล', list: () => S.rewards, name: x => x.name, after: 'คูปองที่ลูกค้าแลกไปแล้วยังใช้ที่ร้านได้ตามปกติ', reload: () => loadRewards() },
  promo: { action: 'adminPromoDelete', label: 'โปรโมชัน', list: () => S.promos, name: x => x.title, after: 'ลูกค้าจะไม่เห็นแบนเนอร์นี้อีก', reload: () => loadPromos() },
  rule: { action: 'adminRuleDelete', label: 'กติกาแต้มพิเศษ', list: () => S.rules, name: x => x.name, after: 'บิลถัดไปจะไม่ได้แต้มพิเศษจากกติกานี้ · แต้มที่ลูกค้าได้ไปแล้วไม่เปลี่ยน', reload: () => loadRules() }
};

function deleteButton(kind, x) {
  if (!x || !S.canDelete[kind]) return '';
  return `<div class="modal-delete"><button type="button" class="link link-danger" data-act="item-delete" data-kind="${kind}" data-id="${esc(x.id)}">${icon('x', 14)} ลบ${esc(DELETE_KIND[kind].label)}นี้</button></div>`;
}

function confirmDelete(kind, id) {
  const k = DELETE_KIND[kind];
  const x = k && (k.list() || []).find(r => r.id === id);
  if (!x) return;
  openModal(`
    <div class="modal-head"><h2>ลบ${esc(k.label)}?</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <p><b>${esc(k.name(x))}</b></p>
    <ul class="muted small">
      <li>หายจากหลังบ้านและหน้าลูกค้าทันที</li>
      <li>${esc(k.after)}</li>
      <li>ลบแล้วกู้คืนเองไม่ได้ (ถ้าแค่พักไว้ ให้กดแก้ไขแล้วเลือก "ปิด" แทน)</li>
    </ul>
    <div class="modal-actions">
      <button class="btn" type="button" data-act="close">ยกเลิก</button>
      <button class="btn btn-danger" type="button" data-act="item-delete-confirm" data-kind="${kind}" data-id="${esc(id)}">ลบ</button>
    </div>`);
}

async function doDelete(kind, id, btn) {
  const k = DELETE_KIND[kind];
  if (!k) return;
  setBusy(btn, true);
  try {
    const r = await withRequestId('delete|' + kind + '|' + id, rid => S.api.call(k.action, { id, requestId: rid }));
    closeModal();
    toast(`ลบ "${r.name}" แล้ว`, 'ok');
    k.reload();
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * หน้าตาร้าน: ชื่อ โลโก้ สไตล์ สี ข้อความ นโยบาย (เก็บในชีต Settings — ว่าง = ใช้ค่าใน config.js)
 * เจ้าของร้านแก้ได้ / ผู้จัดการดูอย่างเดียว — มีตัวอย่างหน้าจอลูกค้าให้ดูก่อนบันทึก
 * ===================================================== */
const BRAND_KEYS = ['SHOP_NAME', 'LOGO_URL', 'THEME', 'COLOR_PRIMARY', 'COLOR_BUTTON', 'COLOR_ACCENT', 'COLOR_CARD',
  'TEXT_POINT_UNIT', 'TEXT_GREETING', 'TEXT_REGISTER_TITLE', 'TEXT_REGISTER_SUBTITLE', 'PRIVACY_TEXT'];
const BRAND_COLORS = [
  ['COLOR_PRIMARY', 'สีหลัก', 'แถบหัวหน้าเว็บ', 'primary'],
  ['COLOR_BUTTON', 'สีปุ่ม', 'ปุ่มกดต่างๆ', 'button'],
  ['COLOR_ACCENT', 'สีเน้น', 'ป้าย ตัวเลขแต้ม', 'accent'],
  ['COLOR_CARD', 'สีบัตรสมาชิก', 'บัตรสมาชิก คูปอง', 'card']
];
const THEME_LABEL = { luxury: 'หรู โทนเข้ม', minimal: 'เรียบ สว่าง' };
const HEX = /^#[0-9A-Fa-f]{6}$/;

function loadBrand() {
  fetchView('adminBrand', {}, renderBrand);
}

// สีที่ใช้อยู่จริงเมื่อช่องว่าง (สีในไฟล์ตั้งค่าร้าน หรือสีของสไตล์) — ใช้เป็นค่าในตัวเลือกสี
function defaultColor(key, theme) {
  const base = S.shop.baseConfig;
  const td = THEME_DEFAULTS[theme] || THEME_DEFAULTS.luxury;
  const own = theme === (base.theme || 'luxury') ? base.colors || {} : {};
  return { primary: own.primary, button: own.button, accent: own.accent, card: own.cardFrom }[key] || td[key];
}

function renderBrand(r) {
  S.brandValues = r.values;
  S.consentVersion = r.consentVersion;
  const v = r.values;
  const base = S.shop.baseConfig;
  const owner = isOwner();
  const dis = owner ? '' : 'disabled';
  const theme = v.THEME || base.theme || 'luxury';
  const next = (parseInt(r.consentVersion, 10) || 1) + 1;
  const text = (name, label, placeholder, max) => `
    <label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(v[name])}" maxlength="${max}" placeholder="${esc(placeholder)}" ${dis}></label>`;
  document.getElementById('view').innerHTML = `
    ${pageHead('หน้าตาร้าน', owner ? 'แก้แล้วลูกค้าเห็นทันที · ช่องที่เว้นว่างใช้ค่าตั้งต้นของร้าน' : 'ผู้จัดการดูได้อย่างเดียว เจ้าของร้านเป็นคนแก้')}
    <div class="brand-layout">
      <form class="card adm-card form brand-form" data-form="brand" autocomplete="off">
        <h2 class="form-section">ชื่อและโลโก้</h2>
        ${text('SHOP_NAME', 'ชื่อร้าน', base.name || '', 60)}
        ${imageField(v.LOGO_URL, 'logo-preview', 'LOGO_URL', 'โลโก้ (รูปสี่เหลี่ยมจัตุรัส)', !owner, 'logo')}
        <h2 class="form-section">สไตล์และสี</h2>
        <label class="field"><span>สไตล์</span>
          <select name="THEME" class="select" ${dis}>
            <option value="">ค่าตั้งต้นของร้าน (${esc(THEME_LABEL[base.theme] || base.theme || 'หรู โทนเข้ม')})</option>
            ${Object.keys(THEME_LABEL).map(k => `<option value="${k}" ${v.THEME === k ? 'selected' : ''}>${THEME_LABEL[k]}</option>`).join('')}
          </select></label>
        <div class="color-list">${BRAND_COLORS.map(([k, label, hint, slot]) => `
          <div class="color-row">
            <span class="color-label">${esc(label)}<small>${esc(hint)}</small></span>
            <span class="color-input">
              <input type="color" data-color="${k}" value="${esc(HEX.test(v[k]) ? v[k] : defaultColor(slot, theme))}" aria-label="เลือก${esc(label)}" ${dis}>
              <input name="${k}" class="hex" value="${esc(v[k])}" maxlength="7" placeholder="ค่าเดิม" aria-label="รหัส${esc(label)}" ${dis}>
              ${owner ? `<button type="button" class="link" data-act="color-reset" data-id="${k}">ค่าเดิม</button>` : ''}
            </span>
          </div>`).join('')}
        </div>
        <h2 class="form-section">ข้อความ</h2>
        <div class="form-grid">
          ${text('TEXT_POINT_UNIT', 'คำเรียกแต้ม', (base.texts && base.texts.pointUnit) || 'แต้ม', 20)}
          ${text('TEXT_GREETING', 'ข้อความทักทายหน้าแรก', (base.texts && base.texts.greeting) || 'สวัสดี', 60)}
        </div>
        ${text('TEXT_REGISTER_TITLE', 'หัวข้อหน้าสมัครสมาชิก', (base.texts && base.texts.registerTitle) || 'สมัครสมาชิก ' + (base.name || ''), 80)}
        ${text('TEXT_REGISTER_SUBTITLE', 'คำอธิบายหน้าสมัครสมาชิก', (base.texts && base.texts.registerSubtitle) || 'สะสมแต้มทุกครั้งที่ซื้อ แลกของรางวัลและสิทธิพิเศษ', 150)}
        <h2 class="form-section">นโยบายความเป็นส่วนตัว</h2>
        <label class="field"><span>ข้อความที่ลูกค้าอ่านตอนสมัคร <small>ตอนนี้เป็นฉบับที่ ${esc(r.consentVersion)}</small></span>
          <textarea name="PRIVACY_TEXT" rows="9" maxlength="3000" placeholder="${esc((base.legal && base.legal.privacyText) || '')}" ${dis}>${esc(v.PRIVACY_TEXT)}</textarea>
          <small>แก้แล้วจะเป็นฉบับที่ ${next} อัตโนมัติ — ลูกค้าที่สมัครหลังจากนี้ยอมรับฉบับใหม่ ส่วนลูกค้าเก่ายังบันทึกเป็นฉบับเดิม (ตามที่ PDPA ต้องการ) · ว่าง = ใช้ข้อความตั้งต้นของร้าน</small></label>
        ${owner ? '<div class="form-actions"><button class="btn btn-primary" type="submit">บันทึกหน้าตาร้าน</button></div>' : ''}
      </form>
      <aside class="brand-side">
        <div class="muted small">ตัวอย่างหน้าจอลูกค้า (เปลี่ยนตามที่แก้ทันที)</div>
        <div id="brand-preview"></div>
      </aside>
    </div>`;
  updateBrandPreview();
}

// ค่าที่กรอกในฟอร์ม → รูปแบบเดียวกับที่ Apps Script ส่งให้หน้าลูกค้า (ใช้วาดตัวอย่าง)
function formBrand(form) {
  const f = form.elements;
  const val = k => f[k].value.trim();
  const color = k => (HEX.test(val(k)) ? val(k).toUpperCase() : '');
  return {
    name: val('SHOP_NAME'),
    logo: /^https:\/\/[^\s"'<>]+$/i.test(driveImage(val('LOGO_URL'))) ? driveImage(val('LOGO_URL')) : '',
    theme: val('THEME'),
    colors: { primary: color('COLOR_PRIMARY'), button: color('COLOR_BUTTON'), accent: color('COLOR_ACCENT'), card: color('COLOR_CARD') },
    texts: { pointUnit: val('TEXT_POINT_UNIT'), greeting: val('TEXT_GREETING'), registerTitle: val('TEXT_REGISTER_TITLE'), registerSubtitle: val('TEXT_REGISTER_SUBTITLE') },
    privacyText: val('PRIVACY_TEXT')
  };
}

let previewTimer = null;
function onBrandInput(target) {
  const form = target.closest('form');
  // ตัวเลือกสี ↔ ช่องรหัสสี ให้ตรงกันเสมอ
  if (target.dataset.color) form.elements[target.dataset.color].value = target.value.toUpperCase();
  else if (target.classList.contains('hex') && HEX.test(target.value.trim())) {
    form.querySelector(`[data-color="${target.name}"]`).value = target.value.trim();
  }
  if (target.name === 'THEME') {
    // เปลี่ยนสไตล์ → ตัวเลือกของช่องสีที่ว่างโชว์สีของสไตล์ใหม่
    const theme = target.value || S.shop.baseConfig.theme || 'luxury';
    BRAND_COLORS.forEach(([k, , , slot]) => { if (!form.elements[k].value) form.querySelector(`[data-color="${k}"]`).value = defaultColor(slot, theme); });
  }
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updateBrandPreview, 80);
}

function resetColor(key) {
  const form = document.querySelector('form[data-form="brand"]');
  if (!form) return;
  form.elements[key].value = '';
  const slot = BRAND_COLORS.find(c => c[0] === key)[3];
  form.querySelector(`[data-color="${key}"]`).value = defaultColor(slot, form.elements.THEME.value || S.shop.baseConfig.theme || 'luxury');
  updateBrandPreview();
}

function updateBrandPreview() {
  const form = document.querySelector('form[data-form="brand"]');
  const box = document.getElementById('brand-preview');
  if (!form || !box) return;
  const c = mergeBrand(S.shop.baseConfig, formBrand(form));
  const td = THEME_DEFAULTS[c.theme] || THEME_DEFAULTS.luxury;
  const k = c.colors;
  const primary = k.primary || td.primary;
  const button = k.button || td.button;
  const accent = k.accent || td.accent;
  const card = k.cardFrom || td.card;
  const vars = {
    '--pv-primary': primary, '--pv-on-primary': textOn(primary),
    '--pv-button': button, '--pv-on-button': textOn(button),
    '--pv-accent': accent, '--pv-on-accent': textOn(accent),
    '--pv-card': card, '--pv-card-to': k.cardTo || shade(card, -0.45), '--pv-on-card': textOn(card),
    '--pv-highlight': k.highlight || (contrast(accent, card) >= 3 ? accent : textOn(card))
  };
  const unitText = (c.texts && c.texts.pointUnit) || 'แต้ม';
  const logo = c.logo ? S.shop.asset(c.logo) : '';
  box.innerHTML = `
    <div class="pv" style="${Object.entries(vars).map(([n, x]) => `${n}:${esc(x)}`).join(';')}">
      <div class="pv-head">
        ${logo ? `<img class="pv-logo" src="${esc(logo)}" alt="" referrerpolicy="no-referrer">` : `<div class="pv-logo pv-logo-text">${esc(c.logoText || (c.name || '?').slice(0, 1))}</div>`}
        <div><div class="pv-hello">${esc((c.texts && c.texts.greeting) || 'สวัสดี')}</div><div class="pv-name">ลูกค้าตัวอย่าง</div></div>
      </div>
      <div class="pv-card">
        <div class="pv-card-top"><span>บัตรสมาชิก</span><b>${esc(c.name || '')}</b></div>
        <div class="pv-points">1,250 <small>${esc(unitText)}</small></div>
      </div>
      <div class="pv-body">
        <span class="pv-chip">โปรใหม่</span>
        <div class="pv-btn">แลกของรางวัล</div>
        <div class="pv-reg"><b>${esc((c.texts && c.texts.registerTitle) || 'สมัครสมาชิก ' + (c.name || ''))}</b><span>${esc((c.texts && c.texts.registerSubtitle) || 'สะสม' + unitText + 'ทุกครั้งที่ซื้อ')}</span></div>
      </div>
    </div>`;
}

function saveBrand(form) {
  if (!isOwner()) return;
  const values = {};
  BRAND_KEYS.forEach(k => { values[k] = form.elements[k].value.trim(); });
  const badColor = BRAND_COLORS.find(([k]) => values[k] && !HEX.test(values[k]));
  if (badColor) return toast(`${badColor[1]} ต้องเป็นรหัสสีแบบ #RRGGBB หรือเว้นว่าง`, 'err');
  const changed = BRAND_KEYS.filter(k => values[k] !== String(S.brandValues[k] || '').trim());
  if (!changed.length) return toast('ยังไม่ได้เปลี่ยนค่าใด', '');
  S.pendingBrand = values;
  if (!changed.includes('PRIVACY_TEXT')) return doSaveBrand(values, form.querySelector('button[type="submit"]'));
  const next = (parseInt(S.consentVersion, 10) || 1) + 1;
  openModal(`
    <div class="modal-head"><h2>ยืนยันแก้นโยบายความเป็นส่วนตัว</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <p class="notice">${icon('shield', 18)}<span>นโยบายจะเปลี่ยนเป็น <b>ฉบับที่ ${next}</b> ลูกค้าที่สมัครหลังจากนี้ยอมรับฉบับใหม่ ส่วนลูกค้าเก่ายังบันทึกเป็นฉบับเดิม ถ้าเป็นการเปลี่ยนสาระสำคัญ ควรแจ้งลูกค้าเก่าด้วย</span></p>
    <div class="modal-actions">
      <button class="btn" data-act="close">ยกเลิก</button>
      <button class="btn btn-primary" data-act="brand-confirm">บันทึก</button>
    </div>`);
}

async function doSaveBrand(values, btn) {
  if (!values) return;
  setBusy(btn, true);
  try {
    const prevVersion = S.consentVersion;
    const r = await S.api.call('adminBrandSave', { values });
    S.pendingBrand = null;
    closeModal();
    // ใช้หน้าตาใหม่กับหลังบ้านด้วยทันที (เจ้าของร้านเห็นผลเลย)
    if (r.brand) await applyBrand(S.shop, r.brand);
    renderShell();
    markNav();
    renderBrand(r);
    const policy = r.consentVersion !== prevVersion ? ` · นโยบายเป็นฉบับที่ ${r.consentVersion}` : '';
    toast(r.changed ? `บันทึกแล้ว ลูกค้าเห็นหน้าตาใหม่ทันที${policy}` : 'ค่าเหมือนเดิม ไม่มีอะไรเปลี่ยน', 'ok');
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * ตั้งค่าร้าน (ชีต Settings) — ทุกคนในหลังบ้านดูได้ แก้ได้เฉพาะเจ้าของร้าน
 * ===================================================== */
const SETTING_UI = {
  POINT_RATE_BAHT: { label: 'ยอดซื้อกี่บาท ได้ 1 แต้ม', suffix: 'บาท' },
  WELCOME_POINTS: { label: 'แต้มต้อนรับสมาชิกใหม่', suffix: 'แต้ม', hint: '0 = ไม่ให้' },
  COUPON_DAYS: { label: 'คูปองใช้ได้กี่วันหลังแลก', suffix: 'วัน', hint: 'ใช้กับของรางวัลที่ไม่ได้กำหนดจำนวนวันเอง' },
  MAX_PURCHASE: { label: 'ยอดซื้อสูงสุดต่อบิล', suffix: 'บาท', hint: 'กันพนักงานพิมพ์ตัวเลขเกิน' },
  CONFIRM_PURCHASE_OVER: { label: 'ยอดที่พนักงานต้องกดยืนยันซ้ำ', suffix: 'บาท', hint: 'ตั้งแต่ยอดนี้ขึ้นไป หน้าพนักงานจะถามอีกครั้ง' },
  HISTORY_LIMIT: { label: 'จำนวนประวัติที่ลูกค้าเห็น', suffix: 'รายการ' }
};
const READONLY_UI = {
  LIFF_ID: 'LIFF ID',
  MEMBER_PREFIX: 'ตัวอักษรนำหน้ารหัสสมาชิก',
  CONSENT_VERSION: 'ฉบับนโยบายความเป็นส่วนตัว'
};

function loadSettings() {
  fetchView('adminSettings', {}, renderSettings);
}

function renderSettings(r) {
  S.settingsItems = r.items;
  const owner = isOwner();
  const get = k => (r.items.find(x => x.key === k) || {}).value || '';
  const unitOf = s => (s === 'แต้ม' ? unit() : s);
  document.getElementById('view').innerHTML = `
    ${pageHead('ตั้งค่าร้าน', owner ? 'แก้แล้วมีผลกับรายการถัดไปทันที' : 'ผู้จัดการดูได้อย่างเดียว เจ้าของร้านเป็นคนแก้')}
    <section class="card adm-card">
      <form class="form settings-form" data-form="settings" autocomplete="off">
        ${Object.keys(SETTING_UI).map(k => `
          <label class="setting-row">
            <span class="setting-label">${esc(SETTING_UI[k].label.replace('แต้ม', unit()))}${SETTING_UI[k].hint ? `<small>${esc(SETTING_UI[k].hint)}</small>` : ''}</span>
            <span class="setting-input"><input name="${k}" value="${esc(get(k))}" inputmode="decimal" ${owner ? '' : 'disabled'}><span class="muted">${esc(unitOf(SETTING_UI[k].suffix))}</span></span>
          </label>`).join('')}
        ${owner ? '<div><button class="btn btn-primary" type="submit">บันทึกการตั้งค่า</button></div>' : ''}
      </form>
    </section>
    <section class="card adm-card">
      <div class="card-head"><h2>ค่าระบบ</h2></div>
      <dl class="kv">${Object.keys(READONLY_UI).map(k => `<dt>${esc(READONLY_UI[k])}</dt><dd class="mono">${esc(get(k) || '-')}</dd>`).join('')}</dl>
      <p class="muted small">ค่าเหล่านี้เปลี่ยนแล้วกระทบการเข้าสู่ระบบหรือรหัสสมาชิก จึงไม่เปิดให้แก้ที่นี่ ถ้าต้องเปลี่ยนให้ติดต่อผู้ดูแลระบบ · ชื่อร้าน โลโก้ สี และนโยบาย แก้ได้ที่เมนู "หน้าตาร้าน"</p>
    </section>`;
}

function confirmSettings(form) {
  if (!isOwner()) return;
  const changes = [];
  Object.keys(SETTING_UI).forEach(k => {
    const before = (S.settingsItems.find(x => x.key === k) || {}).value || '';
    const after = form.elements[k].value.replace(/,/g, '').trim();
    if (after !== before) changes.push({ key: k, before, after });
  });
  if (!changes.length) return toast('ยังไม่ได้เปลี่ยนค่าใด', '');
  S.pendingSettings = Object.fromEntries(changes.map(c => [c.key, c.after]));
  openModal(`
    <div class="modal-head"><h2>ยืนยันการตั้งค่า</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <dl class="kv">${changes.map(c => `<dt>${esc(SETTING_UI[c.key].label.replace('แต้ม', unit()))}</dt><dd>${esc(c.before || '-')} → <b>${esc(c.after || '-')}</b></dd>`).join('')}</dl>
    <p class="notice">${icon('alert', 18)}<span>มีผลกับรายการถัดไปทันที ${esc(unit())}ที่ลูกค้าได้ไปแล้วไม่เปลี่ยน</span></p>
    <div class="modal-actions">
      <button class="btn" data-act="close">ยกเลิก</button>
      <button class="btn btn-primary" data-act="settings-confirm">บันทึก</button>
    </div>`);
}

async function doSaveSettings(btn) {
  if (!S.pendingSettings) return;
  setBusy(btn, true);
  try {
    const r = await S.api.call('adminSettingsSave', { values: S.pendingSettings });
    S.pendingSettings = null;
    closeModal();
    renderSettings(r);
    toast(r.changed ? 'บันทึกการตั้งค่าแล้ว' : 'ค่าเหมือนเดิม ไม่มีอะไรเปลี่ยน', 'ok');
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * รายการแต้ม
 * ===================================================== */
function loadTx() {
  const t = S.tx;
  fetchView('adminTransactions', { ...rangeData(), ...branchData(), type: t.type, staff: t.staff, q: t.q, page: t.page }, renderTx);
}

function renderTx(r) {
  const t = S.tx;
  const opt = (value, label, cur) => `<option value="${esc(value)}" ${cur === value ? 'selected' : ''}>${esc(label)}</option>`;
  // พนักงานที่เลือกไว้แต่ไม่มีรายการในช่วงใหม่ ยังต้องอยู่ในรายการ ไม่งั้นตัวกรองหายเงียบๆ
  const staffList = t.staff && !r.staffNames.includes(t.staff) ? [t.staff, ...r.staffNames] : r.staffNames;
  const s = r.summary;
  document.getElementById('view').innerHTML = `
    ${pageHead('รายการแต้ม', 'ทุกรายการที่ได้หรือใช้แต้ม เรียงจากใหม่ไปเก่า' + branchNote(), exportBtn('transactions'))}
    ${rangeBar()}
    <form class="filters" data-form="tx" autocomplete="off">
      <select name="type" aria-label="ประเภท">
        ${opt('', 'ทุกประเภท', t.type)}${Object.keys(TX_LABEL).map(k => opt(k, TX_LABEL[k], t.type)).join('')}
      </select>
      <select name="staff" aria-label="พนักงาน">
        ${opt('', 'พนักงานทุกคน', t.staff)}${staffList.map(n => opt(n, n === 'SYSTEM' ? 'ระบบ' : n, t.staff)).join('')}
      </select>
      <div class="search-box">${icon('search', 18)}<input name="q" value="${esc(t.q)}" placeholder="ชื่อหรือรหัสสมาชิก" enterkeyhint="search"></div>
      <button class="btn btn-sm btn-primary" type="submit">ค้นหา</button>
    </form>
    <div class="sum-row">
      <span class="chip">${fmtNum(s.count)} รายการ</span>
      <span class="chip">ยอดซื้อ ฿${fmtMoney(s.sales)}</span>
      <span class="chip">ได้ +${fmtNum(s.pointsPlus)} ${esc(unit())}</span>
      <span class="chip">ใช้ −${fmtNum(s.pointsMinus)} ${esc(unit())}</span>
    </div>
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>วันเวลา</th><th>สมาชิก</th><th>ประเภท</th><th>รายละเอียด</th><th class="num">ยอดซื้อ</th><th class="num">${esc(unit())}</th><th class="num">คงเหลือ</th><th>พนักงาน</th>${hasBranches() ? '<th>สาขา</th>' : ''}</tr></thead>
        <tbody>${r.items.length ? r.items.map(x => `
          <tr class="row-link" data-act="member" data-id="${esc(x.memberId)}">
            <td class="nowrap">${fmtDateTime(x.date)}</td>
            <td>${memberLink(x.memberId, x.memberName)}<div class="m-sub mono">${esc(x.memberId)}</div></td>
            <td class="nowrap">${esc(TX_LABEL[x.type] || x.type)}</td>
            <td>${esc(x.detail)}</td>
            <td class="num">${x.type === 'EARN' ? '฿' + fmtMoney(x.amount) : ''}</td>
            <td class="num tx-points ${ptsClass(x.points)}">${signed(x.points)}</td>
            <td class="num">${fmtNum(x.balance)}</td>
            <td>${esc(x.staff === 'SYSTEM' ? 'ระบบ' : x.staff || '-')}</td>
            ${hasBranches() ? `<td class="nowrap">${esc(x.type === 'REDEEM' || x.type === 'WELCOME' ? '-' : branchName(x.branch))}</td>` : ''}
          </tr>`).join('') : emptyRow(9, 'ไม่มีรายการในช่วงนี้')}
        </tbody></table></div>
    </section>
    ${pager(r, 'tx')}`;
}

/* =====================================================
 * คูปอง
 * ===================================================== */
function loadCoupons() {
  const c = S.coupons;
  fetchView('adminCoupons', { ...rangeData(), ...branchData(), status: c.status, page: c.page }, renderCoupons);
}

function renderCoupons(r) {
  const cur = S.coupons.status;
  const tabs = [['', 'ทั้งหมด', r.all], ['ACTIVE', 'ใช้ได้', r.counts.ACTIVE], ['USED', 'ใช้แล้ว', r.counts.USED], ['EXPIRED', 'หมดอายุ', r.counts.EXPIRED]];
  if (r.counts.CANCELLED) tabs.push(['CANCELLED', 'ยกเลิก', r.counts.CANCELLED]);
  document.getElementById('view').innerHTML = `
    ${pageHead('คูปอง', S.branch ? `คูปองที่ถูกใช้ที่${branchNote()} (ลูกค้าแลกในช่วงที่เลือก)` : 'คูปองที่ลูกค้าแลกในช่วงที่เลือก และสถานะตอนนี้')}
    ${rangeBar()}
    <div class="chips-scroll status-tabs">${tabs.map(([id, label, n]) => `
      <button type="button" class="chip-btn ${cur === id ? 'active' : ''}" data-act="coupon-status" data-id="${id}">${label} (${fmtNum(n)})</button>`).join('')}
    </div>
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>แลกเมื่อ</th><th>ของรางวัล</th><th>รหัสคูปอง</th><th>สมาชิก</th><th class="num">ใช้${esc(unit())}</th><th>สถานะ</th><th>ใช้ได้ถึง</th><th>ใช้เมื่อ · โดย</th>${hasBranches() ? '<th>ใช้ที่สาขา</th>' : ''}</tr></thead>
        <tbody>${r.items.length ? r.items.map(c => `
          <tr class="row-link" data-act="member" data-id="${esc(c.memberId)}">
            <td class="nowrap">${fmtDateTime(c.issuedAt)}</td>
            <td>${esc(c.name)}</td>
            <td class="mono">${esc(c.code)}</td>
            <td>${memberLink(c.memberId, c.memberName)}</td>
            <td class="num">${fmtNum(c.pointsUsed)}</td>
            <td>${statusChip(c.status, COUPON_LABEL[c.status])}</td>
            <td class="nowrap">${fmtDate(c.expiresAt)}</td>
            <td class="nowrap">${c.usedAt ? fmtDateTime(c.usedAt) + (c.usedBy ? ' · ' + esc(c.usedBy) : '') : '-'}</td>
            ${hasBranches() ? `<td class="nowrap">${c.usedAt ? esc(branchName(c.usedBranch)) : '-'}</td>` : ''}
          </tr>`).join('') : emptyRow(9, 'ไม่มีคูปองในช่วงนี้')}
        </tbody></table></div>
    </section>
    ${pager(r, 'coupons')}`;
}

/* =====================================================
 * พนักงาน: อนุมัติ / ปิดสิทธิ์ / เปลี่ยนบทบาท (ไม่ต้องเข้าชีต Staff อีก)
 * ===================================================== */
function loadStaff() {
  fetchView('adminStaff', {}, renderStaff);
}

// เจ้าของร้านแก้ได้ทุกคน / ผู้จัดการแก้ได้เฉพาะแคชเชียร์ / แก้ตัวเองไม่ได้ (Apps Script ตรวจซ้ำ)
const canEdit = s => !s.isMe && (isOwner() || s.role === 'CASHIER');

// สาขาของพนักงาน: เจ้าของร้านใช้ได้ทุกสาขาเสมอ / ALL = ทุกสาขา
const allBranches = s => s.role === 'OWNER' || !s.branches || s.branches.includes('ALL');
const staffBranchText = s => (allBranches(s) ? 'ทุกสาขา' : s.branches.map(branchName).join(', '));

function renderStaff(r) {
  S.staffItems = r.items;
  const link = `https://liff.line.me/${cfg().liffId}/staff`;
  const pending = r.items.filter(s => s.status === 'PENDING').length;
  // เลือกสาขา → แสดงคนที่ทำงานสาขานั้นได้ (รวมคนที่อยู่ทุกสาขา) / คนรออนุมัติยังไม่มีสาขา จึงแสดงเสมอ
  const items = S.branch ? r.items.filter(s => s.status === 'PENDING' || allBranches(s) || s.branches.includes(S.branch)) : r.items;
  const withBranch = hasBranches();
  document.getElementById('view').innerHTML = `
    ${pageHead('พนักงาน', (pending ? `<b>${fmtNum(pending)} คนรออนุมัติ</b>` : `${fmtNum(items.length)} คน`) + branchNote())}
    ${withBranch ? `<div class="filters">${branchSelect()}</div>` : ''}
    <section class="card adm-card invite">
      <div class="grow">
        <b>เพิ่มพนักงานใหม่</b>
        <p class="muted small">ส่งลิงก์นี้ให้พนักงานทาง LINE ส่วนตัว เมื่อเปิดแล้วชื่อจะขึ้นในรายการด้านล่างให้กดอนุมัติ</p>
        <code>${esc(link)}</code>
      </div>
      <button class="btn btn-sm" data-act="copy" data-text="${esc(link)}">${icon('copy', 16)} คัดลอกลิงก์</button>
    </section>
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>ชื่อ</th><th>บทบาท</th>${withBranch ? '<th>สาขา</th>' : ''}<th>สถานะ</th><th>ขอสิทธิ์เมื่อ</th><th></th></tr></thead>
        <tbody>${items.length ? items.map(s => `
          <tr>
            <td class="strong">${esc(s.name || '-')}${s.isMe ? ' <span class="chip">คุณ</span>' : ''}</td>
            <td>${esc(ROLE_LABEL[s.role] || s.role)}</td>
            ${withBranch ? `<td>${s.status === 'PENDING' ? '-' : esc(staffBranchText(s))}</td>` : ''}
            <td>${statusChip(s.status, STAFF_STATUS_LABEL[s.status])}</td>
            <td class="nowrap">${s.requestedAt ? fmtDateTime(s.requestedAt) : '-'}</td>
            <td class="actions">${canEdit(s)
              ? (s.status === 'PENDING'
                ? `<button class="btn btn-sm btn-primary" data-act="staff-edit" data-id="${esc(s.userId)}">${icon('check', 16)} อนุมัติ</button>`
                : `<button class="btn btn-sm" data-act="staff-edit" data-id="${esc(s.userId)}">${icon('edit', 16)} แก้ไข</button>`)
              : ''}</td>
          </tr>`).join('') : emptyRow(6, 'ยังไม่มีพนักงาน')}
        </tbody></table></div>
    </section>
    <section class="card adm-card">
      <div class="card-head"><h2>แต่ละบทบาททำอะไรได้</h2></div>
      <dl class="kv roles">
        <dt>แคชเชียร์</dt><dd>บันทึกยอดซื้อ ใช้คูปอง (เห็นเบอร์ลูกค้าแค่ 4 ตัวท้าย)</dd>
        <dt>ผู้จัดการ</dt><dd>ทำได้เหมือนแคชเชียร์ + ปรับแต้ม + ดูหลังบ้าน + อนุมัติแคชเชียร์</dd>
        <dt>เจ้าของร้าน</dt><dd>ทำได้ทุกอย่าง + เห็นเบอร์และวันเกิดลูกค้า + ส่งออกไฟล์ + ตั้งผู้จัดการ</dd>
      </dl>
    </section>`;
}

function openStaffEdit(userId) {
  const s = S.staffItems.find(x => x.userId === userId);
  if (!s || !canEdit(s)) return;
  const approving = s.status === 'PENDING';
  const roles = isOwner() ? ['CASHIER', 'ADMIN', 'OWNER'] : ['CASHIER'];
  const status = approving ? 'ACTIVE' : s.status;
  openModal(`
    <div class="modal-head"><h2>${approving ? 'อนุมัติพนักงาน' : 'แก้ไขพนักงาน'}</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <form class="form" data-form="staff-edit" data-id="${esc(s.userId)}" autocomplete="off">
      <label class="field"><span>ชื่อที่แสดงในรายการ</span><input name="name" value="${esc(s.name)}" maxlength="60"></label>
      <label class="field"><span>บทบาท</span>
        <select name="role" class="select">${roles.map(r => `<option value="${r}" ${r === s.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></label>
      <label class="field"><span>สถานะ</span>
        <select name="status" class="select">${['ACTIVE', 'DISABLED', 'PENDING'].map(v => `<option value="${v}" ${v === status ? 'selected' : ''}>${STAFF_STATUS_LABEL[v]}</option>`).join('')}</select></label>
      ${hasBranches() ? staffBranchField(s, approving) : ''}
      ${isOwner() ? '' : '<p class="muted small">ผู้จัดการแก้ได้เฉพาะแคชเชียร์ ถ้าต้องการตั้งผู้จัดการ ให้เจ้าของร้านทำ</p>'}
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">ยกเลิก</button>
        <button class="btn btn-primary" type="submit">${approving ? 'อนุมัติ' : 'บันทึก'}</button>
      </div>
    </form>`);
}

// เลือกสาขาที่พนักงานทำงานได้ (ติ๊ก "ทุกสาขา" = ไม่จำกัด รวมสาขาที่เพิ่มในอนาคต)
// อนุมัติคนใหม่: ยังไม่ติ๊กอะไร ให้เจ้าของร้านเลือกเองว่าคนนี้อยู่สาขาไหน (ไม่ปล่อยเป็นทุกสาขาโดยไม่ตั้งใจ)
function staffBranchField(s, approving) {
  const all = !approving && (!s.branches || s.branches.includes('ALL'));
  const open = S.branches.filter(b => b.status === 'ACTIVE' || (s.branches || []).includes(b.id));
  return `
    <fieldset class="field branch-field"><legend>สาขาที่ทำงานได้</legend>
      <label class="check"><input type="checkbox" name="branchAll" data-branch-all ${all ? 'checked' : ''}><span><b>ทุกสาขา</b> (รวมสาขาที่เพิ่มทีหลัง)</span></label>
      <div class="branch-checks">${open.map(b => `
        <label class="check"><input type="checkbox" name="branch" value="${esc(b.id)}" ${!all && !approving && s.branches.includes(b.id) ? 'checked' : ''} ${all ? 'disabled' : ''}><span>${esc(b.name)}${b.status === 'ACTIVE' ? '' : ' (ปิดแล้ว)'}</span></label>`).join('')}
      </div>
      <small>เจ้าของร้านใช้ได้ทุกสาขาเสมอ / พนักงานหลายสาขาจะเลือกสาขาตอนเปิดหน้าพนักงาน</small>
    </fieldset>`;
}

function toggleBranchAll(box) {
  box.closest('form').querySelectorAll('input[name="branch"]').forEach(x => { x.disabled = box.checked; });
}

function staffBranchValue(form) {
  if (!form.elements.branchAll) return undefined; // ร้านไม่มีสาขา → ไม่ส่ง (Apps Script ไม่แก้ช่องสาขา)
  if (form.elements.branchAll.checked) return ['ALL'];
  return [...form.querySelectorAll('input[name="branch"]:checked')].map(x => x.value);
}

async function saveStaff(form) {
  const branches = staffBranchValue(form);
  if (branches && !branches.length) return toast('เลือกอย่างน้อย 1 สาขา หรือติ๊ก "ทุกสาขา"', 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await S.api.call('adminStaffUpdate', {
      userId: form.dataset.id, name: form.elements.name.value.trim(),
      role: form.elements.role.value, status: form.elements.status.value, branches
    });
    closeModal();
    toast(`บันทึกแล้ว · ${r.staff.name} เป็น${ROLE_LABEL[r.staff.role]} (${STAFF_STATUS_LABEL[r.staff.status]})`, 'ok');
    loadStaff();
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * สาขา: เพิ่ม / แก้ชื่อ / ปิดสาขา + QR สมัครสมาชิกของแต่ละสาขา (เจ้าของร้านแก้ ผู้จัดการดู)
 * ===================================================== */
const QR_JS = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

function loadBranches() {
  fetchView('adminBranches', {}, renderBranches);
}

// ลิงก์สมัครสมาชิกของสาขา: เปิดผ่าน LINE แล้วหน้าลูกค้าจำสาขาไว้จนสมัครเสร็จ
const branchJoinLink = id => `https://liff.line.me/${cfg().liffId}?branch=${encodeURIComponent(id)}`;

function renderBranches(r) {
  S.branches = r.items.map(({ id, name, status, sort }) => ({ id, name, status, sort }));
  S.branchItems = r.items;
  const owner = isOwner();
  const open = r.items.filter(b => b.status === 'ACTIVE').length;
  const limit = branchLimit();
  const quota = limit === Infinity ? '' : ` · แพ็กเกจของร้านเปิดได้ ${fmtNum(limit)} สาขา`;
  document.getElementById('view').innerHTML = `
    ${pageHead('สาขา', (r.items.length ? `เปิดอยู่ ${fmtNum(open)} จาก ${fmtNum(r.items.length)} สาขา` : 'ร้านนี้ยังไม่ได้เพิ่มสาขา') + quota,
      owner ? `<button class="btn btn-sm btn-primary" data-act="branch-edit" data-id="">+ เพิ่มสาขา</button>` : '')}
    ${r.items.length ? `
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>สาขา</th><th class="num">พนักงาน</th><th class="num">สมาชิกที่สมัคร</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${r.items.map(b => `
          <tr>
            <td><b>${esc(b.name)}</b><div class="m-sub mono">${esc(b.id)}</div></td>
            <td class="num">${fmtNum(b.staff)}</td>
            <td class="num">${fmtNum(b.members)}</td>
            <td>${b.status === 'ACTIVE' ? statusChip('active', 'เปิดอยู่') : statusChip('inactive', 'ปิดแล้ว')}</td>
            <td class="actions">
              ${b.status === 'ACTIVE' ? `<button class="btn btn-sm" data-act="branch-qr" data-id="${esc(b.id)}">${icon('qr', 16)} QR สมัคร</button>` : ''}
              ${owner ? `<button class="btn btn-sm" data-act="branch-edit" data-id="${esc(b.id)}">${icon('edit', 16)} แก้ไข</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody></table></div>
    </section>
    <p class="muted small">สมัครออนไลน์ (ไม่ได้สแกน QR ของสาขา) ${fmtNum(r.online)} คน · สาขาที่ไม่ใช้แล้วให้กดแก้ไขแล้วเลือก "ปิดสาขา" (ไม่ลบ เพราะรายการเก่ายังอ้างถึงอยู่)</p>` : `
    <section class="card adm-card empty-branches">
      <div class="state-icon">${icon('pin', 36)}</div>
      <h2>ร้านมีหลายสาขาใช่ไหม</h2>
      <p class="muted">เพิ่มสาขาแล้วจะดูยอดซื้อ สมาชิกใหม่ และคูปองแยกตามสาขาได้ พนักงานจะเลือกสาขาตอนเปิดหน้าพนักงาน และแต่ละสาขามี QR สมัครสมาชิกของตัวเอง</p>
      <p class="muted small">ร้านที่มีสาขาเดียวไม่ต้องเพิ่ม ระบบทำงานเหมือนเดิมทุกอย่าง · ${esc(unit())}ใช้ร่วมกันทุกสาขา</p>
      ${owner ? `<button class="btn btn-primary" data-act="branch-edit" data-id="">+ เพิ่มสาขาแรก</button>` : '<p class="muted small">เจ้าของร้านเป็นคนเพิ่มสาขา</p>'}
    </section>`}
    <section class="card adm-card">
      <div class="card-head"><h2>ระบบรู้ได้อย่างไรว่าเกิดที่สาขาไหน</h2></div>
      <dl class="kv roles">
        <dt>ยอดซื้อ / ใช้คูปอง</dt><dd>สาขาที่พนักงานเลือกไว้ในหน้าพนักงาน (ตั้งว่าใครอยู่สาขาไหนได้ที่เมนูพนักงาน)</dd>
        <dt>สมาชิกใหม่</dt><dd>สาขาของ QR ที่ลูกค้าสแกนสมัคร (สมัครเองโดยไม่สแกน = ออนไลน์)</dd>
        <dt>${esc(unit())}</dt><dd>ใช้ร่วมกันทุกสาขา สะสมที่สาขาหนึ่ง แลกที่อีกสาขาได้</dd>
      </dl>
    </section>`;
}

// เพดานตามแพ็กเกจนับเฉพาะสาขาที่เปิดอยู่ (ปิดสาขาเก่าแล้วเปิดสาขาใหม่แทนได้)
function overBranchLimit(adding) {
  const open = (S.branchItems || []).filter(x => x.status === 'ACTIVE').length;
  if (!adding || open < branchLimit()) return false;
  openModal(`
    <div class="modal-head"><h2>สาขาครบตามแพ็กเกจแล้ว</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <p>แพ็กเกจของร้านเปิดสาขาพร้อมกันได้ <b>${fmtNum(branchLimit())} สาขา</b> (เปิดอยู่ ${fmtNum(open)})</p>
    <p class="muted">ต้องการเพิ่มสาขา ติดต่อผู้ดูแลระบบเพื่ออัปเกรดแพ็กเกจ หรือปิดสาขาที่ไม่ใช้แล้วก่อน</p>
    <div class="modal-actions"><button class="btn btn-primary" data-act="close">ตกลง</button></div>`);
  return true;
}

function openBranchEdit(id) {
  if (!isOwner() || !branchFeature()) return;
  const b = id ? (S.branchItems || []).find(x => x.id === id) : null;
  if (id && !b) return;
  if (overBranchLimit(!b)) return;
  openModal(`
    <div class="modal-head"><h2>${b ? 'แก้ไขสาขา' : 'เพิ่มสาขา'}</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <form class="form" data-form="branch" data-id="${esc(b ? b.id : '')}" autocomplete="off">
      <label class="field"><span>ชื่อสาขา <em>*</em></span><input name="name" value="${esc(b ? b.name : '')}" maxlength="40" placeholder="เช่น สาขาสยาม"></label>
      <div class="form-grid">
        <label class="field"><span>ลำดับที่แสดง</span><input name="sort" value="${esc(b ? b.sort : '')}" inputmode="numeric" placeholder="เลขน้อยขึ้นก่อน"></label>
        <label class="field"><span>สถานะ</span>
          <select name="status" class="select">
            <option value="ACTIVE" ${!b || b.status === 'ACTIVE' ? 'selected' : ''}>เปิดอยู่</option>
            <option value="INACTIVE" ${b && b.status !== 'ACTIVE' ? 'selected' : ''}>ปิดสาขา</option>
          </select></label>
      </div>
      ${b ? '<p class="muted small">ปิดสาขาแล้ว พนักงานจะบันทึกให้สาขานี้ไม่ได้ และ QR สมัครของสาขานี้จะนับเป็นสมัครออนไลน์ (ข้อมูลเก่ายังอยู่ครบ)</p>' : ''}
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">ยกเลิก</button>
        <button class="btn btn-primary" type="submit">บันทึก</button>
      </div>
    </form>`);
}

async function saveBranch(form) {
  const branch = formValues(form, ['name', 'sort', 'status']);
  branch.id = form.dataset.id;
  if (!branch.name) return toast('กรุณากรอกชื่อสาขา', 'err');
  // เปิดสาขาที่ปิดไปแล้วกลับมา ก็นับเป็นสาขาที่เปิดเพิ่ม
  const before = branch.id ? (S.branchItems || []).find(x => x.id === branch.id) : null;
  if (branch.status === 'ACTIVE' && before && before.status !== 'ACTIVE') {
    const open = S.branchItems.filter(x => x.status === 'ACTIVE').length;
    if (open >= branchLimit()) return toast(`แพ็กเกจของร้านเปิดได้ ${fmtNum(branchLimit())} สาขา ปิดสาขาอื่นก่อน หรือติดต่อผู้ดูแลระบบเพื่ออัปเกรด`, 'err');
  }
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await withRequestId('branch|' + JSON.stringify(branch), rid => S.api.call('adminBranchSave', { branch, requestId: rid }));
    S.branches = r.items;
    closeModal();
    toast(`${r.created ? 'เพิ่ม' : 'บันทึก'} "${r.branch.name}" แล้ว${r.created ? ' · ตั้งสาขาให้พนักงานได้ที่เมนูพนักงาน' : ''}`, 'ok');
    loadBranches();
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

async function openBranchQr(id) {
  const b = S.branches.find(x => x.id === id);
  if (!b) return;
  const link = branchJoinLink(id);
  showLoading('กำลังสร้าง QR...');
  try {
    await loadScript(QR_JS);
  } catch (e) {
    return toast('สร้าง QR ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่', 'err');
  } finally {
    hideLoading();
  }
  openModal(`
    <div class="modal-head"><h2>QR สมัครสมาชิก · ${esc(b.name)}</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <div class="qr-box branch-qr">${qrSvg(link)}</div>
    <p class="muted small center">พิมพ์ติดที่เคาน์เตอร์ของสาขานี้ ลูกค้าที่สแกนแล้วสมัครจะนับเป็นสมาชิกของ${esc(b.name)}</p>
    <div class="copy-row"><code>${esc(link)}</code><button class="btn btn-sm" data-act="copy" data-text="${esc(link)}">${icon('copy', 16)} คัดลอก</button></div>
    <div class="modal-actions">
      <button class="btn" data-act="close">ปิด</button>
      <button class="btn btn-primary" data-act="branch-qr-save" data-id="${esc(id)}">${icon('download', 16)} บันทึกเป็นรูป</button>
    </div>`);
}

// รูปสำหรับพิมพ์: ชื่อร้าน + ชื่อสาขา + QR + คำอธิบาย (วาดลง canvas เอง ตัวหนังสือไม่เพี้ยนตามขนาดจอ)
async function saveBranchQr(id, btn) {
  const b = S.branches.find(x => x.id === id);
  if (!b) return;
  setBusy(btn, true, 'กำลังสร้างรูป...');
  try {
    const svg = qrSvg(branchJoinLink(id)).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const W = 1000, H = 1300;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const font = getComputedStyle(document.body).fontFamily;
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#111111'; x.textAlign = 'center';
    x.font = `800 60px ${font}`; x.fillText(cfg().name || '', W / 2, 120, W - 80);
    x.font = `700 46px ${font}`; x.fillText(b.name, W / 2, 196, W - 80);
    x.imageSmoothingEnabled = false; // QR ต้องคม ไม่ให้ขอบเบลอจนสแกนยาก
    x.drawImage(img, 120, 250, 760, 760);
    x.font = `700 44px ${font}`; x.fillText('สแกนเพื่อสมัครสมาชิก', W / 2, 1100, W - 80);
    x.fillStyle = '#666666'; x.font = `400 32px ${font}`; x.fillText(`สะสม${unit()}ทุกครั้งที่ซื้อ`, W / 2, 1160, W - 80);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QR-สมัครสมาชิก-${b.name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('บันทึกรูป QR แล้ว', 'ok');
  } catch (e) {
    toast('บันทึกรูปไม่สำเร็จ ลองแคปหน้าจอ QR แทนได้', 'err');
  } finally {
    setBusy(btn, false);
  }
}

/* =====================================================
 * ส่งออกไฟล์ (เฉพาะเจ้าของร้าน) — สร้าง CSV ในเครื่อง เปิดด้วย Excel / Google Sheets ได้
 * ===================================================== */
function confirmExport(kind) {
  if (!isOwner()) return;
  const what = kind === 'members' ? 'รายชื่อสมาชิกทั้งหมด' : `รายการแต้ม ${rangeText()}`;
  openModal(`
    <div class="modal-head"><h2>ส่งออกไฟล์</h2><button class="icon-btn" data-act="close" aria-label="ปิด">${icon('x')}</button></div>
    <p><b>${esc(what)}</b></p>
    <p class="notice">${icon('shield', 18)}<span>ไฟล์นี้มีข้อมูลส่วนตัวของลูกค้า (ชื่อ เบอร์โทร วันเกิด) เก็บไว้ในเครื่องที่ปลอดภัย และอย่าส่งต่อให้คนนอก ตามกฎหมาย PDPA</span></p>
    <div class="modal-actions">
      <button class="btn" data-act="close">ยกเลิก</button>
      <button class="btn btn-primary" data-act="export-confirm" data-id="${esc(kind)}">${icon('download', 16)} ดาวน์โหลด</button>
    </div>`);
}

async function doExport(kind, btn) {
  setBusy(btn, true, 'กำลังเตรียมไฟล์...');
  try {
    const r = await S.api.call('adminExport', kind === 'transactions' ? { kind, ...rangeData() } : { kind });
    const name = kind === 'members' ? 'สมาชิก' : `รายการแต้ม-${S.range.from}-ถึง-${S.range.to}`;
    downloadCsv(`${S.shop.id}-${name}-${todayKey()}.csv`, [r.columns, ...r.rows]);
    closeModal();
    toast(`ส่งออก ${fmtNum(r.rows.length)} แถวแล้ว`, 'ok');
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

// ข้อความที่ขึ้นต้นด้วย = + - @ จะกลายเป็นสูตรตอนเปิดใน Excel (อาจถูกใช้แอบส่งข้อมูลออก) → ใส่ ' นำหน้า
function csvCell(v) {
  if (typeof v === 'number') return String(v);
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsv(filename, rows) {
  // ﻿ ข้างหน้า = บอก Excel ว่าเป็น UTF-8 ไม่งั้นภาษาไทยเพี้ยน
  const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function copyText(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('คัดลอกแล้ว', 'ok'), () => toast(text));
  else toast(text);
}
