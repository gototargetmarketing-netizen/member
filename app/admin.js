// หลังบ้านของเจ้าของร้าน: ภาพรวม · สมาชิก · รายการแต้ม · คูปอง · ของรางวัล · โปรโมชัน · พนักงาน · ตั้งค่าร้าน
// ทำไว้ให้เจ้าของร้านดูข้อมูลได้โดยไม่ต้องเปิดหรือแชร์ Google Sheet ให้ใคร
// เปิดได้ทั้งคอมและมือถือ (บนคอมระบบจะพาไปเข้าสู่ระบบ LINE ก่อน)
// สิทธิ์ตรวจที่ Apps Script ทุกคำสั่ง (OWNER / ADMIN ในชีต Staff) — หน้านี้แค่ซ่อน/แสดงปุ่มให้ตรงบทบาท
import { loadShop, applyBrand, mergeBrand, THEME_DEFAULTS, textOn, contrast, shade } from './shop.js';
import { initLine, IS_LOCAL } from './line.js';
import { createApi, createRetryKeeper } from './api.js';
import { applyDevParams, mountDevBar } from './devbar.js';
import { tierBanner } from './tier.js';
import EN_TEXT from './i18n-en.js';
// สองภาษา หลังบ้าน (ผู้ใช้ขอ 19 พ.ย. 2569 — จะขายระบบให้ร้านต่างชาติ): ข้อความทั้งหมดผ่าน tr() / คำแปลอยู่ใน i18n-admin-en.js
// ใช้ชื่อ tr ไม่ใช่ t เพราะไฟล์นี้มีตัวแปรชื่อ t หลายที่ (ระดับ / รายการแต้ม / วันนี้)
import { t as tBase, isEn, initLang, autoLang, save as saveLang, langSwitchHtml, extend as extendLang, monthNames, dateLocale } from './i18n.js';
import ADMIN_EN from './i18n-admin-en.js';
extendLang(ADMIN_EN);
// ส่งคำเรียกแต้ม {u} มา → ใส่ {U} (ตัวแรกใหญ่ — ขึ้นต้นประโยคภาษาอังกฤษ) ให้เอง
// {U} = ขึ้นต้นประโยค / {u1} = เอกพจน์ ("1 point" ไม่ใช่ "1 points")
const tr = (s, v) => tBase(s, v && typeof v.u === 'string' && v.U === undefined ? { U: v.u.charAt(0).toUpperCase() + v.u.slice(1), u1: isEn() ? v.u.replace(/s$/i, '') : v.u, ...v } : v);
import { esc, icon, toast, openModal, closeModal, fmtNum, fmtMoney, fmtDate, fmtDateTime, setBusy, showLoading, hideLoading, creditHtml, bootHtml, qrSvg, loadScript } from './ui.js';

const ROLE_LABEL = { OWNER: 'เจ้าของร้าน', ADMIN: 'ผู้จัดการ', CASHIER: 'แคชเชียร์' };
const TX_LABEL = { EARN: 'ยอดซื้อ', WELCOME: 'แต้มต้อนรับ', REDEEM: 'แลกรางวัล', ADJUST: 'ปรับแต้ม', CONSENT: 'รับข่าวสาร', DELETE: 'ลบบัญชี' };
const COUPON_LABEL = { ACTIVE: 'ใช้ได้', USED: 'ใช้แล้ว', EXPIRED: 'หมดอายุ', CANCELLED: 'ยกเลิกแล้ว' };
const STAFF_STATUS_LABEL = { PENDING: 'รออนุมัติ', ACTIVE: 'ใช้งานได้', DISABLED: 'ปิดสิทธิ์' };
const PAGES = [
  { id: 'overview', label: 'ภาพรวม', icon: 'chart' },
  { id: 'members', label: 'สมาชิก', icon: 'users' },
  { id: 'transactions', label: 'รายการแต้ม', icon: 'receipt' },
  { id: 'coupons', label: 'คูปอง', icon: 'ticket' },
  { id: 'rewards', label: 'ของรางวัล', icon: 'gift' },
  { id: 'promos', label: 'โปรโมชัน', icon: 'star' },
  { id: 'broadcast', label: 'ส่งข้อความ', icon: 'send' },
  { id: 'rules', label: 'แต้มพิเศษ', icon: 'coins' },
  { id: 'tiers', label: 'ระดับสมาชิก', icon: 'up' },
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
const SAVE_ACTIONS = ['adjustPoints', 'adminStaffUpdate', 'adminRewardSave', 'adminPromoSave', 'adminMemberStatus', 'adminMemberDelete', 'adminSettingsSave', 'adminBrandSave', 'adminBranchSave', 'adminMemberUpdate', 'adminRuleSave', 'adminTiersSave', 'adminMemberTier'];
const LOADING_TEXT = { adminAudience: 'กำลังคัดกลุ่มลูกค้า...', adminBroadcastInfo: null, adminBroadcastTest: 'กำลังส่งทดสอบ...', adminBroadcastSend: 'กำลังส่งข้อความ...', adminBroadcastResume: 'กำลังส่งต่อ...', adminUploadRichImage: 'กำลังอัปโหลดรูป...', adminExport: 'กำลังเตรียมไฟล์...', adminUploadImage: 'กำลังอัปโหลดรูป...', adminRewardDelete: 'กำลังลบ...', adminPromoDelete: 'กำลังลบ...', adminRuleDelete: 'กำลังลบ...', adminMemberDelete: 'กำลังลบข้อมูลสมาชิก...' };
// ร่างข้อความตามกลุ่ม: image = ลิงก์ฐานของริชเมสเสจ (ไม่มีนามสกุล) / imageHeight = ความสูงเมื่อกว้าง 1040 / link = แตะรูปแล้วเปิด (ว่าง = บัตรสมาชิก)
const BC_EMPTY = () => ({ text: '', image: '', imageHeight: '', link: '' });

const app = document.getElementById('app');
const S = {
  shop: null, line: null, api: null, me: null, testMode: false,
  range: loadRange(),
  // หลายสาขา: รายชื่อสาขาทั้งหมด (มาพร้อมคำขอแรก) + สาขาที่เลือกดูอยู่ ('' = ทุกสาขา) ใช้ร่วมกันทุกหน้า
  branches: [], branch: loadBranchFilter(),
  members: { q: '', sort: 'joined', status: '', birth: '', tier: '', page: 1 },
  // ระบบนี้ลบของรางวัล/โปรโมชัน/แต้มพิเศษได้ไหม (ระบบใหม่บอกมากับรายการ / ระบบเดิมไม่มี → ไม่แสดงปุ่มลบ)
  canDelete: {},
  tx: { type: '', staff: '', q: '', page: 1 },
  coupons: { status: '', page: 1 },
  // ส่งข้อความตามกลุ่ม: เงื่อนไขที่เลือกไว้ (จำไว้ระหว่างสลับหน้า ไม่เก็บในเครื่อง)
  aud: { filter: {}, dirty: false },
  // ข้อความที่กำลังเขียน + สถานะ LINE OA (มาจาก adminBroadcastInfo) + จำนวนคนของกลุ่มล่าสุดที่กดดู
  bc: { draft: BC_EMPTY(), info: null, count: null, pending: null },
  member: null, staffItems: [], pendingAdjust: null,
  rewards: [], couponDays: 30, promos: [], settingsItems: [], pendingSettings: null,
  seq: 0 // เลขคำขอล่าสุด: ผลของคำขอเก่าที่ตอบช้ากว่าจะไม่ทับหน้าที่เปิดใหม่
};
const withRequestId = createRetryKeeper();

const cfg = () => S.shop.config;
const unit = () => (isEn() ? (cfg().textsEn && cfg().textsEn.pointUnit) || 'points' : (cfg().texts && cfg().texts.pointUnit) || 'แต้ม');
const unitOne = () => (isEn() ? unit().replace(/s$/i, '') : unit()); // "1 point" ไม่ใช่ "1 points"
const isOwner = () => S.me && S.me.role === 'OWNER';

/* แพ็กเกจหลายสาขา: เปิด/ปิดที่ shops/<ร้าน>/config.js → features.branches / features.maxBranches
 * ตั้งที่ไฟล์บน Vercel เพราะเจ้าของร้านแก้เองไม่ได้ (ชีต Settings อยู่ในบัญชีร้าน แก้ได้)
 * ปิดแพ็กเกจ = ซ่อนเมนูสาขา (เพิ่ม/แก้สาขาไม่ได้) แต่ข้อมูลสาขาเดิมยังอยู่ ดูรายงานแยกสาขาได้ตามเดิม */
const branchFeature = () => !!(cfg().features && cfg().features.branches === true);
const branchLimit = () => {
  const n = Number(cfg().features && cfg().features.maxBranches);
  return Number.isInteger(n) && n > 0 ? n : Infinity;
};
/* แพ็กเกจระดับสมาชิก (ขั้น 4): เปิดที่ config features.tiers — มีเฉพาะระบบใหม่ (ระบบเดิมไม่มีคำสั่งระดับ)
 * ร้านยังไม่ตั้งระดับ / ระบบไม่ส่งข้อมูลระดับมา → ไม่เห็นอะไรเกี่ยวกับระดับเลย */
const tierFeature = () => !!(cfg().features && cfg().features.tiers === true);
/* แพ็กเกจส่งออก Excel: เปิดที่ config features.export (ไม่ใส่ = ปิด → ร้านใหม่ต้องตั้งเองตามแพ็กเกจที่ซื้อ)
 * หน้าเว็บซ่อนปุ่ม + ตัวกลางตรวจซ้ำทุกสวิตช์ (api/_lib/features.js — อ่านไฟล์ config เดียวกันนี้ กติกาเดียวกัน: true เท่านั้นถึงเปิด) */
const exportFeature = () => !!(cfg().features && cfg().features.export === true);
/* แพ็กเกจส่งข้อความตามกลุ่ม (12 พ.ย. 2569): config features.broadcast / เมนูนี้เจ้าของร้านเท่านั้น (ตัวกลางตรวจซ้ำ)
 * ส่งจริงต้องเชื่อม LINE OA ของร้านก่อน (รอบ 2) — ตอนนี้คัดกลุ่ม + ดูจำนวนคนได้ */
const broadcastFeature = () => !!(cfg().features && cfg().features.broadcast === true);
/* สองภาษา (features.english — สวิตช์อยู่ที่ผู้ดูแลระบบ ไม่คิดราคา): รอบ 2 = ช่องภาษาอังกฤษของเนื้อหาร้าน + ตัวนับที่ยังขาด
 * ช่องภาษาอังกฤษอยู่ใต้ช่องไทยของเรื่องเดียวกัน (ผู้ใช้เลือกแบบ ก 19 พ.ย. 2569) / ร้านที่ไม่เปิด = ไม่มีช่อง → บันทึกแล้วไม่ส่ง = ไม่แก้คำแปลเดิม
 * ตัวหน้าหลังบ้านเองยังเป็นภาษาไทย (รอบ 4) */
const englishFeature = () => !!(cfg().features && cfg().features.english === true);
const HAS_THAI = /[\u0E00-\u0E7F]/;
// ช่องภาษาอังกฤษ: placeholder บอกว่าเว้นว่างแล้วลูกค้าเห็นอะไร
function enField(label, name, value, max, opts = {}) {
  if (!englishFeature()) return '';
  const ph = opts.placeholder || tr('ว่าง = ลูกค้าที่เลือกภาษาอังกฤษเห็นภาษาไทย');
  const attrs = `name="${name}" maxlength="${max}" placeholder="${esc(ph)}" lang="en"${opts.disabled ? ' disabled' : ''}`;
  return `<label class="field field-en"><span><b class="en-tag">EN</b> ${esc(label)}${opts.hint ? ` <small>${opts.hint}</small>` : ''}</span>
    ${opts.rows ? `<textarea ${attrs} rows="${opts.rows}">${esc(value || '')}</textarea>` : `<input ${attrs} value="${esc(value || '')}">`}</label>`;
}
// ค่าช่องภาษาอังกฤษในฟอร์ม (เฉพาะช่องที่มีอยู่จริง)
function enValues(form, names) {
  const o = {};
  names.forEach(n => { if (form.elements[n]) o[n] = form.elements[n].value.trim(); });
  return o;
}
// ข้อความไทยนี้ยังไม่มีคำแปล (ข้อความที่ไม่มีอักษรไทย เช่น "Gold" ไม่ต้องแปล — ตรงกับ englishStatus ในตัวกลาง)
const needsEn = (x, pairs) => pairs.some(([th, en]) => HAS_THAI.test(String(x[th] || '')) && !String(x[en] || '').trim());
// ป้ายในตาราง: รายการที่ลูกค้าเห็น/กำลังจะเห็น แต่ยังไม่มีภาษาอังกฤษ
const enChip = (x, pairs) => (englishFeature() && ['ACTIVE', 'SCHEDULED', 'SOLD_OUT'].includes(x.state) && needsEn(x, pairs)
  ? ` <span class="chip chip-en">${tr('ยังไม่มี EN')}</span>` : '');
const REWARD_EN = [['name', 'nameEn'], ['description', 'descriptionEn']];
const PROMO_EN = [['title', 'titleEn'], ['subtitle', 'subtitleEn'], ['tag', 'tagEn']];
// การ์ดในหน้าภาพรวม → กดรายการที่ยังขาด แล้วเปิดฟอร์มของรายการนั้นให้เลย (หน้าโหลดเสร็จแล้วค่อยเปิด — ดู openPending)
const EN_PAGE = { reward: 'rewards', promo: 'promos', rule: 'rules', branch: 'branches', tier: 'tiers', tierIntro: 'tiers', shopName: 'brand', policy: 'brand' };
const EN_KIND = { reward: 'ของรางวัล', promo: 'โปรโมชัน', rule: 'แต้มพิเศษ', branch: 'สาขา', tier: 'ระดับ', tierIntro: 'หน้าสิทธิ์สมาชิก', shopName: 'หน้าตาร้าน', policy: 'หน้าตาร้าน' };
function openPending(kind, fn) {
  const p = S.openAfter;
  if (!p || (Array.isArray(kind) ? !kind.includes(p.kind) : p.kind !== kind)) return;
  S.openAfter = null;
  fn(p.id, p.kind);
}
function focusField(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.focus({ preventScroll: true });
}
const tierDot = c => (/^#[0-9A-Fa-f]{6}$/.test(c || '') ? `<i class="tier-dot" style="background:${c}"></i>` : '');
const tierChip = (name, color) => (name ? `<span class="chip chip-tier">${tierDot(color)}${esc(name)}</span>` : '');
const TIER_REASON = { START: 'เริ่มระดับ', UP: 'ขึ้นระดับ', DOWN: 'ลดระดับ (ครบ 12 เดือน ยอดไม่ถึง)', ADMIN: 'เปลี่ยนโดยร้าน' };
// ตัวอย่างตอนเริ่มตั้งครั้งแรก: เกณฑ์เป็นแต้ม คิดจากยอดซื้อ ฿5,000 / ฿20,000 ตามอัตราแต้มของร้าน
const tierDefaults = rate => [
  { name: 'Member', minPoints: 0, multiplier: 1, color: '#9CA3AF' },
  { name: 'Silver', minPoints: Math.round(5000 / rate), multiplier: 1.5, color: '#A8A9AD' },
  { name: 'Gold', minPoints: Math.round(20000 / rate), multiplier: 2, color: '#D4AF37' }
].map(t => ({ ...t, id: '', image: '', benefits: '', members: 0, nameEn: '', benefitsEn: '' }));
// ส่งข้อความ: ยังไม่รู้ว่าใครเข้า (เปิดลิงก์ครั้งแรก) ให้ผ่านไปก่อน แล้ว loadBroadcast ถามสิทธิ์เอง
const visiblePages = () => PAGES.filter(p => (p.id !== 'branches' || branchFeature()) && (p.id !== 'tiers' || tierFeature()) &&
  (p.id !== 'broadcast' || (broadcastFeature() && (!S.me || isOwner()))));

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);
document.addEventListener('change', onChange);
window.addEventListener('hashchange', route);
main();

async function main() {
  try {
    S.shop = await loadShop();
    initLang(cfg(), { key: 'crm_admin_lang', always: true });
    applyDevParams(S.shop.id);
    renderBoot(tr('กำลังเข้าสู่ระบบ...'));
    S.line = await initLine(cfg().liffId);
    autoLang(S.line.language); // เปิดในแอป LINE ที่ตั้งภาษาอังกฤษ → หลังบ้านเป็นอังกฤษเอง (ถ้ายังไม่เคยเลือก)
    S.api = createApi(S.shop, S.line, {
      // ลิงก์ (#หน้า) ติดไปกับการเข้าสู่ระบบใหม่อยู่แล้ว จึงไม่ต้องเก็บอะไรเพิ่ม
      onRelogin: () => { closeModal(); renderBoot(tr('กำลังเชื่อมต่อ LINE ใหม่...')); },
      // ก่อนเข้าหลังบ้านได้ มีหน้าโหลดเต็มจออยู่แล้ว → ไม่ต้องขึ้นป๊อปอัปซ้อน
      // ใส่ไว้ในตารางเป็น null = ทำเบื้องหลัง ไม่บังจอ (เช่น เช็กการเชื่อม LINE OA ตอนเปิดหน้าส่งข้อความ)
      loadingText: (action) => (!S.me ? null : Object.prototype.hasOwnProperty.call(LOADING_TEXT, action) ? LOADING_TEXT[action] && tr(LOADING_TEXT[action])
        : SAVE_ACTIONS.includes(action) ? tr('กำลังบันทึก...') : tr('กำลังโหลด...'))
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
    case 'lang': setAdminLang(el.dataset.lang); break;
    case 'en-go': S.openAfter = { kind: el.dataset.kind, id }; location.hash = '#' + (EN_PAGE[el.dataset.kind] || 'overview'); break;
    case 'brand-lang': S.previewLang = id; updateBrandPreview(); break;
    case 'promo-edit': openPromoEdit(id); break;
    case 'rule-edit': openRuleEdit(id); break;
    case 'item-delete': confirmDelete(el.dataset.kind, id); break;
    case 'tier-add': tierAdd(); break;
    case 'tier-remove': tierRemove(Number(id)); break;
    case 'tiers-save-confirm': doSaveTiers(el); break;
    case 'tiers-off': confirmTiersOff(); break;
    case 'tiers-off-confirm': doSaveTiers(el, true); break;
    case 'member-tier': openMemberTier(); break;
    case 'aud-clear': S.aud.filter = {}; route(); break;
    case 'bc-test': bcTest(el); break;
    case 'bc-send': confirmBroadcast(); break;
    case 'bc-send-confirm': doBroadcast(el); break;
    case 'bc-resume': bcResume(id, el); break;
    case 'bc-reload': loadBroadcastInfo(); break;
    case 'tier-filter': Object.assign(S.members, { tier: id || '', page: 1 }); break; // ลิงก์ #members พาไปหน้ารายชื่อที่กรองแล้ว
    case 'item-delete-confirm': doDelete(el.dataset.kind, id, el); break;
    case 'member-status': openMemberStatus(); break;
    case 'member-delete': openMemberDelete(); break;
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
      if (!from || !to) return toast(tr('กรุณาเลือกวันเริ่มและวันสิ้นสุด'), 'err');
      if (from > to) return toast(tr('วันเริ่มต้องไม่หลังวันสิ้นสุด'), 'err');
      S.range = { preset: 'custom', from, to };
      saveRange();
      resetPages();
      route();
      break;
    }
    case 'members':
      Object.assign(S.members, { q: f.q.value.trim(), sort: f.sort.value, status: f.status.value, birth: f.birth ? f.birth.value : '', tier: f.tier ? f.tier.value : '', page: 1 });
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
    case 'member-delete': saveMemberDelete(form); break;
    case 'member-edit': saveMemberEdit(form); break;
    case 'tiers': confirmTiers(form); break;
    case 'member-tier': saveMemberTier(form); break;
    case 'audience': submitAudience(form); break;
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
  if (e.target.closest('form[data-form="tiers"]')) onTierInput(e.target);
  if (e.target.closest('form[data-form="broadcast"]')) onDraftInput(e.target.closest('form'));
  if (e.target.closest('form[data-form="audience"]')) markAudDirty();
});

// เปลี่ยนตัวเลือกในแถบกรอง → ค้นใหม่ทันที (ช่องพิมพ์ยังต้องกด Enter/ค้นหา)
function onChange(e) {
  const file = e.target.closest('input[type="file"][data-upload]');
  if (file) return uploadImage(file);
  if (e.target.matches('[data-branch-filter]')) return setBranchFilter(e.target.value);
  if (e.target.matches('[data-branch-all]')) return toggleBranchAll(e.target);
  if (e.target.matches('input[name="type"]')) return onRewardType(e.target);
  if (e.target.closest('form[data-form="audience"]')) markAudDirty(); // ติ๊กระดับ/สาขา หรือเปลี่ยนตัวเลือก
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
  if (!id) return tr('ไม่ระบุ');
  if (id === 'ONLINE') return tr('ออนไลน์');
  if (id === 'ADMIN') return tr('หลังบ้าน');
  const b = S.branches.find(x => x.id === id);
  return b ? b.name : id;
}

// ช่องเลือกสาขา (วางในแถบกรองของแต่ละหน้า)
function branchSelect() {
  if (!hasBranches()) return '';
  return `
    <label class="branch-select ${S.branch ? 'on' : ''}">${icon('pin', 16)}
      <select data-branch-filter aria-label="${tr('สาขา')}">
        <option value="">${tr('ทุกสาขา')}</option>
        ${S.branches.map(b => `<option value="${esc(b.id)}" ${S.branch === b.id ? 'selected' : ''}>${esc(b.name)}${b.status === 'ACTIVE' ? '' : tr(' (ปิดแล้ว)')}</option>`).join('')}
      </select></label>`;
}

const branchData = () => (S.branch ? { branch: S.branch } : {});
const branchNote = () => (S.branch ? ` · <b>${esc(branchName(S.branch))}</b>` : '');

const rangeData = () => ({ from: S.range.from, to: S.range.to });
const keyDate = k => new Date((k.length === 7 ? k + '-01' : k) + 'T00:00:00Z');
const dtf = {};
const dateFmt = (k, opt) => (dtf[k + dateLocale()] = dtf[k + dateLocale()] || new Intl.DateTimeFormat(dateLocale(), { ...opt, timeZone: 'UTC' }));
const fmtDayShort = { format: d => dateFmt('ds', { day: 'numeric', month: 'short' }).format(d) };
const fmtDayLong = { format: d => dateFmt('dl', { day: 'numeric', month: 'short', year: '2-digit' }).format(d) };
const fmtMonth = { format: d => dateFmt('m', { month: 'short', year: '2-digit' }).format(d) };

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
        <button type="button" class="chip-btn ${r.preset === p.id ? 'active' : ''}" data-act="preset" data-id="${p.id}">${tr(p.label)}</button>`).join('')}
      </div>
      ${r.preset === 'custom' ? `
        <form class="range-custom" data-form="range">
          <input type="date" name="from" value="${esc(r.from)}" max="${t}" aria-label="${tr('วันเริ่ม')}">
          <span class="muted">${tr('ถึง')}</span>
          <input type="date" name="to" value="${esc(r.to)}" max="${t}" aria-label="${tr('วันสิ้นสุด')}">
          <button class="btn btn-sm btn-primary" type="submit">${tr('ดูข้อมูล')}</button>
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
      <h1>${noAccess ? tr('หน้านี้สำหรับเจ้าของร้านและผู้จัดการ') : tr('เปิดหลังบ้านไม่สำเร็จ')}</h1>
      ${noAccess ? `
        <p>${tr('บัญชี LINE นี้ยังไม่มีสิทธิ์เข้าหลังบ้าน')}</p>
        <p class="muted small">${tr('ถ้าคุณเป็นเจ้าของร้าน ติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์')}</p>`
        : `<p>${esc((e && e.message) || tr('เกิดข้อผิดพลาด'))}</p>`}
      ${IS_LOCAL && e && e.debug ? `<pre class="debug">${esc(e.debug)}</pre>` : ''}
      <div class="stack">
        ${e && (e.code === 'TOKEN_INVALID' || e.code === 'NO_TOKEN') ? `<button class="btn btn-primary" data-act="relogin">${tr('เข้าสู่ระบบใหม่')}</button>` : ''}
        <button class="btn" data-act="reload">${tr('ลองใหม่')}</button>
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

// สลับภาษาหลังบ้าน: จำไว้ในเครื่อง แล้ววาดทั้งหน้าใหม่ (ข้อความจากตัวกลางของหน้านี้ก็เปลี่ยนภาษาตามคำขอถัดไป)
function setAdminLang(l) {
  saveLang(l);
  closeModal();
  if (!S.me) return;
  renderShell();
  markNav();
  route();
}

// รายละเอียดที่ระบบเขียนลงประวัติเป็นภาษาไทย → แปลตอนแสดง (แบบเดียวกับ txDetail ในหน้าลูกค้า)
// หมายเหตุที่พนักงานพิมพ์เอง (ปรับแต้ม) แสดงตามที่พิมพ์ — แก้ข้อความ detail ในตัวกลาง ต้องแก้รูปแบบที่นี่ด้วย
function txDetail(tx) {
  const d = String(tx.detail || '');
  if (!isEn() || !d) return d;
  if (d === 'แต้มต้อนรับสมาชิกใหม่' || d === 'แต้มรับข่าวสารจากร้าน') return tr(d);
  if (d === 'ลบบัญชีสมาชิก') return tr(d + '@@ประวัติ');
  let m = tx.type === 'REDEEM' && d.match(/^แลก:? (.+)$/);
  if (m) return tr('แลก {name}', { name: m[1] });
  m = tx.type === 'EARN' && d.match(/^ซื้อสินค้า ([\d,.]+) บาท( \(ไม่ถึงเกณฑ์รับแต้ม\))?(.*)$/);
  if (m) return tr('ซื้อสินค้า ฿{amount}', { amount: m[1] }) + (m[2] ? tr(' (ไม่ถึงเกณฑ์รับแต้ม)') : '') + m[3];
  return d;
}

// ผู้ทำรายการที่ระบบเขียนเอง: SYSTEM (แต้มต้อนรับ ฯลฯ) / ลูกค้า (แลกเอง ลบบัญชีเอง) → แปล / ชื่อพนักงานแสดงตามเดิม
const staffLabel = n => (n === 'SYSTEM' ? tr('ระบบ') : n === 'ลูกค้า' ? tr('ลูกค้า@@ผู้ทำ') : n || '-');

function renderShell() {
  app.innerHTML = (S.testMode ? `<div class="test-banner">${tr('โหมดทดสอบ — ข้อมูลไม่ใช่ของจริง')}</div>` : '') + `
    <div class="adm">
      <aside class="adm-side">
        <div class="adm-brand">
          ${logoHtml()}
          <div class="grow"><div class="adm-shop">${esc(cfg().name)}</div><div class="adm-sub">${tr('หลังบ้าน')}</div></div>
          ${/* ปุ่มภาษาบนแถบบน แสดงเฉพาะมือถือ (คอมย้ายไปไว้ล่างเมนูข้าง — วางข้างชื่อร้านแล้วชื่อร้านโดนตัด ผู้ใช้ขอย้าย 19 พ.ย. 2569) */ langSwitchHtml('adm-lang adm-lang-top')}
        </div>
        <nav class="adm-nav">${visiblePages().map(p => `
          <a href="#${p.id}" data-page="${p.id}">${icon(p.icon, 18)}<span>${tr(p.label)}</span></a>`).join('')}
        </nav>
        ${creditHtml('credit-side')}
        <div class="adm-me">
          <div class="adm-me-name">${esc(S.me.name)} <span class="chip">${esc(tr(ROLE_LABEL[S.me.role] || S.me.role))}</span></div>
          <a class="adm-link" href="${esc(S.shop.pageUrl('staff'))}">${icon('scan', 16)} ${tr('ไปหน้าพนักงาน')}</a>
          <div class="adm-lang-row"><span>${tr('ภาษา')}</span>${langSwitchHtml('adm-lang adm-lang-side')}</div>
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
    broadcast: loadBroadcast,
    rules: loadRules,
    tiers: loadTierPage,
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
        <div><button class="link" data-act="refresh">${icon('refresh', 14)} ${tr('ลองใหม่')}</button></div></div></div>`;
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
  return isOwner() && exportFeature() ? `<button class="btn btn-sm" data-act="export" data-id="${kind}">${icon('download', 16)} ${tr('ส่งออก Excel (CSV)')}</button>` : '';
}

function pager(r, of) {
  if (r.pages <= 1) return '';
  return `
    <div class="pager">
      <button class="btn btn-sm" data-act="page" data-of="${of}" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>${icon('left', 16)} ${tr('ก่อนหน้า')}</button>
      <span class="muted small">${tr('หน้า {n} / {n2}', { n: fmtNum(r.page), n2: fmtNum(r.pages) })}</span>
      <button class="btn btn-sm" data-act="page" data-of="${of}" data-page="${r.page + 1}" ${r.page >= r.pages ? 'disabled' : ''}>${tr('ถัดไป')} ${icon('right', 16)}</button>
    </div>`;
}

const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="empty-cell">${esc(text)}</td></tr>`;
const signed = n => (n > 0 ? '+' : '') + fmtNum(n);
const ptsClass = n => (n > 0 ? 'plus' : n < 0 ? 'minus' : '');
const statusChip = (status, label) => `<span class="status status-${esc(String(status).toLowerCase())}">${esc(label || status)}</span>`;
// เบอร์ 10 หลักแสดงเป็น 086-111-0002 อ่านง่ายกว่า (เบอร์ที่ซ่อนแล้วแสดงตามเดิม)
const fmtPhone = p => (/^0\d{9}$/.test(p || '') ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p || '');
// "สมาชิกที่ลบแล้ว" ตัวกลางเขียนเป็นภาษาไทย (members.js DELETED_NAME) → แปลตามภาษาหลังบ้าน
const memberLink = (id, name) => `<a href="#member/${encodeURIComponent(id)}">${esc(name === 'สมาชิกที่ลบแล้ว' ? tr(name) : name || id)}</a>`;

/* =====================================================
 * ภาพรวม
 * ===================================================== */
function loadOverview() {
  fetchView('adminDashboard', { ...rangeData(), ...branchData() }, renderOverview);
}

// เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน — ใช้สีตัวอักษรปกติ เพราะ "เพิ่ม" ไม่ได้แปลว่าดีเสมอ (เช่นแต้มที่ถูกแลก)
function delta(cur, prev) {
  if (!prev && !cur) return '';
  if (!prev) return `<span class="kpi-delta">${tr('ช่วงก่อนหน้า 0')}</span>`;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return `<span class="kpi-delta">${tr('เท่ากับช่วงก่อนหน้า')}</span>`;
  return `<span class="kpi-delta">${tr('{x} {n}% จากช่วงก่อนหน้า', { x: pct > 0 ? '▲' : '▼', n: fmtNum(Math.abs(pct)) })}</span>`;
}

// การ์ด "ข้อความภาษาอังกฤษของร้าน" (สองภาษา รอบ 2) — ตัวกลางนับของรางวัล/โปรโมชัน/แต้มพิเศษ/สาขา/ระดับ (englishStatus)
// หน้านี้นับชื่อร้าน + นโยบายเพิ่มจากค่าร้าน (นโยบายตั้งต้นอยู่ในไฟล์ร้าน ตัวกลางไม่เห็น) — กฎเดียวกับ mergeBrand ใน app/shop.js
function englishCard(d) {
  if (!englishFeature() || !d.english) return '';
  const c = cfg();
  const legal = c.legal || {};
  const e = { total: d.english.total, done: d.english.done, missing: (d.english.missing || []).slice() };
  const brand = [];
  [['shopName', tr('ชื่อร้าน'), c.name, c.nameEn], ['policy', tr('นโยบายความเป็นส่วนตัว'), legal.privacyText, legal.privacyTextEn]].forEach(([kind, name, th, en]) => {
    if (!HAS_THAI.test(String(th || ''))) return;
    e.total += 1;
    if (String(en || '').trim()) e.done += 1; else brand.push({ kind, id: '', name, fields: [] });
  });
  e.missing = brand.concat(e.missing);
  const pct = e.total ? Math.round(e.done / e.total * 100) : 100;
  const SHOW = 12;
  return `
    <section class="card adm-card en-card">
      <div class="card-head"><h2>${tr('<b class="en-tag">EN</b> ข้อความภาษาอังกฤษ')}</h2></div>
      <p class="en-count">${tr('กรอกแล้ว <b>{n}</b> จาก {n2} รายการ', { n: fmtNum(e.done), n2: fmtNum(e.total) })}</p>
      <div class="tier-bar"><i style="width:${pct}%"></i></div>
      ${e.missing.length ? `
      <details class="en-missing"${e.missing.length <= 5 ? ' open' : ''}>
        <summary>${tr('ดูที่ยังขาด ({n})', { n: fmtNum(e.missing.length) })}</summary>
        <ul>${e.missing.slice(0, SHOW).map(m => `<li><button type="button" class="link" data-act="en-go" data-kind="${esc(m.kind)}" data-id="${esc(m.id)}">${esc(tr(EN_KIND[m.kind] || ''))}: ${esc(m.kind === 'tierIntro' ? tr(m.name) : m.name)}</button>${m.fields.length ? ` <span class="muted small">${tr('ยังไม่มี {x}', { x: esc(m.fields.map(f => tr(f + '@@ช่อง')).join(', ')) })}</span>` : ''}</li>`).join('')}
          ${e.missing.length > SHOW ? `<li class="muted small">${tr('และอีก {n} รายการ', { n: fmtNum(e.missing.length - SHOW) })}</li>` : ''}</ul>
      </details>` : `<p class="small">${icon('check', 14)} ${e.total ? tr('ครบแล้ว ลูกค้าที่เลือกภาษาอังกฤษเห็นข้อความของร้านเป็นภาษาอังกฤษทั้งหมด') : tr('ยังไม่มีข้อความภาษาไทยที่ต้องแปล')}</p>`}
      <p class="muted small">${tr('นับเฉพาะรายการที่ลูกค้าเห็นอยู่ และข้อความที่มีภาษาไทย (ชื่อที่เป็นภาษาอังกฤษอยู่แล้วไม่ต้องแปล) · ช่องที่ยังว่าง ลูกค้าที่เลือกภาษาอังกฤษเห็นภาษาไทยแทน')}</p>
    </section>`;
}

function renderOverview(d) {
  const c = d.current;
  const p = d.previous;
  const one = !!d.branch; // ดูสาขาเดียว
  const tiles = [
    one
      ? { label: tr('สมาชิกที่สมัครสาขานี้'), value: fmtNum(d.totals.branchMembers), sub: `${tr('ทั้งร้าน {n} คน', { n: fmtNum(d.totals.members) })}` }
      : { label: tr('สมาชิกทั้งหมด'), value: fmtNum(d.totals.members), sub: `${tr('{u}คงค้างในระบบ {n}', { u: esc(unit()), n: fmtNum(d.totals.pointsOutstanding) })}` },
    { label: tr('สมาชิกใหม่'), value: fmtNum(c.newMembers), sub: delta(c.newMembers, p.newMembers) },
    { label: tr('ลูกค้าที่มาซื้อ'), value: fmtNum(c.buyers), sub: delta(c.buyers, p.buyers) || tr('คน (ไม่นับซ้ำ)') },
    { label: tr('ยอดซื้อรวม'), value: '฿' + fmtMoney(c.sales), sub: delta(c.sales, p.sales) },
    { label: tr('จำนวนบิล'), value: fmtNum(c.bills), sub: c.bills ? `${tr('เฉลี่ย ฿{n} ต่อบิล', { n: fmtMoney(Math.round(c.sales / c.bills)) })}` : delta(c.bills, p.bills) },
    { label: `${tr('{u}ที่แจก', { u: unit() })}`, value: fmtNum(c.pointsIssued), sub: delta(c.pointsIssued, p.pointsIssued) },
    { label: `${tr('{u}ที่ถูกแลก', { u: unit() })}`, value: fmtNum(c.pointsRedeemed), sub: delta(c.pointsRedeemed, p.pointsRedeemed) },
    { label: one ? tr('คูปองที่ใช้ที่สาขานี้') : tr('คูปองที่ใช้ที่ร้าน'), value: fmtNum(c.couponsUsed), sub: delta(c.couponsUsed, p.couponsUsed) || tr('พนักงานสแกนแล้ว') }
  ];
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('ภาพรวม'), tr('ตัวเลขของช่วงที่เลือก เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน') + branchNote(), `<button class="btn btn-sm" data-act="refresh">${icon('refresh', 16)} ${tr('รีเฟรช')}</button>`)}
    ${rangeBar()}
    <div class="kpis">${tiles.map(t => `
      <div class="kpi"><div class="kpi-label">${esc(t.label)}</div><div class="kpi-value">${t.value}</div><div class="kpi-sub">${t.sub || ''}</div></div>`).join('')}
    </div>
    ${englishCard(d)}
    ${tierFeature() && (d.tiers || []).length ? `
    <section class="card adm-card">
      <div class="card-head"><h2>${tr('สมาชิกแต่ละระดับ')}</h2><a class="link" href="#tiers">${tr('ตั้งค่าระดับ')} ${icon('right', 14)}</a></div>
      <div class="tier-counts">${d.tiers.map(t => `<a class="tier-count" href="#members" data-act="tier-filter" data-id="${esc(t.id)}">${tierDot(t.color)}<b>${esc(t.name)}</b><span>${tr('{n} คน', { n: fmtNum(t.count) })}</span></a>`).join('')}</div>
    </section>` : ''}
    <section class="card adm-card">
      <div class="card-head"><h2>${tr('ยอดซื้อ{x}', { x: d.period.bucket === 'month' ? tr('รายเดือน') : tr('รายวัน') })}</h2><span class="muted small">${tr('แตะหรือชี้ที่แท่งเพื่อดูตัวเลข')}</span></div>
      ${chartHtml(d)}
    </section>
    ${compareHtml(d)}
    <div class="adm-grid3">
      <section class="card adm-card">
        <div class="card-head"><h2>${one ? tr('ของรางวัลที่ใช้ที่สาขานี้') : tr('ของรางวัลยอดนิยม')}</h2></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>${tr('ของรางวัล')}</th>${one ? '' : `<th class="num">${tr('แลก')}</th>`}<th class="num">${tr('ใช้แล้ว')}</th></tr></thead>
          <tbody>${d.topRewards.length ? d.topRewards.map(r => `
            <tr><td>${esc(r.name)}</td>${one ? '' : `<td class="num">${fmtNum(r.issued)}</td>`}<td class="num">${fmtNum(r.used)}</td></tr>`).join('') : emptyRow(3, one ? tr('ยังไม่มีคูปองที่ใช้ที่สาขานี้ในช่วงนี้') : tr('ยังไม่มีการแลกในช่วงนี้'))}
          </tbody></table></div>
      </section>
      <section class="card adm-card">
        <div class="card-head"><h2>${tr('ลูกค้าซื้อมากสุด')}</h2></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>${tr('สมาชิก')}</th><th class="num">${tr('บิล')}</th><th class="num">${tr('ยอดซื้อ')}</th></tr></thead>
          <tbody>${d.topMembers.length ? d.topMembers.map(m => `
            <tr class="row-link" data-act="member" data-id="${esc(m.memberId)}"><td>${memberLink(m.memberId, m.name)}</td><td class="num">${fmtNum(m.bills)}</td><td class="num">฿${fmtMoney(m.sales)}</td></tr>`).join('') : emptyRow(3, tr('ยังไม่มียอดซื้อในช่วงนี้'))}
          </tbody></table></div>
      </section>
      <section class="card adm-card">
        <div class="card-head"><h2>${tr('ตามพนักงาน')}</h2></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>${tr('พนักงาน')}</th><th class="num">${tr('บิล')}</th><th class="num">${tr('ยอดซื้อ')}</th><th class="num">${tr('คูปอง')}</th></tr></thead>
          <tbody>${d.byStaff.length ? d.byStaff.map(s => `
            <tr><td>${esc(s.staff)}</td><td class="num">${fmtNum(s.bills)}</td><td class="num">฿${fmtMoney(s.sales)}</td><td class="num">${fmtNum(s.couponsUsed)}</td></tr>`).join('') : emptyRow(4, tr('ยังไม่มีรายการในช่วงนี้'))}
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
      <div class="card-head pad"><h2>${icon('pin', 18)} ${tr('เทียบสาขา')}</h2><span class="muted small">${tr('กดชื่อสาขาเพื่อดูเฉพาะสาขานั้น')}</span></div>
      <div class="tbl-wrap"><table class="tbl compare">
        <thead><tr><th>${tr('สาขา')}</th><th class="num">${tr('ยอดซื้อ')}</th><th class="share-col">${tr('สัดส่วน')}</th><th class="num">${tr('บิล')}</th><th class="num">${tr('ลูกค้า')}</th><th class="num">${tr('{u}ที่แจก', { u: esc(unit()) })}</th><th class="num">${tr('คูปองที่ใช้')}</th><th class="num">${tr('สมาชิกใหม่')}</th></tr></thead>
        <tbody>${rows.map(r => {
          const other = r.id === 'OTHER';
          const pct = total ? Math.round((r.sales / total) * 100) : 0;
          return `
          <tr class="${other ? 'muted-row' : 'row-link'}" ${other ? '' : `data-act="branch-filter" data-id="${esc(r.id)}"`}>
            <td class="strong">${other ? tr('ออนไลน์ / หลังบ้าน / ไม่ระบุ') : `<a href="#overview">${esc(r.name)}</a>${r.status === 'ACTIVE' ? '' : ` <span class="chip">${tr('ปิดแล้ว')}</span>`}`}</td>
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
      ${rows.some(r => r.id === 'OTHER') ? `<p class="muted small pad">${tr('แถวสุดท้ายคือรายการก่อนเพิ่มสาขา ลูกค้าที่สมัครเองโดยไม่ได้สแกน QR สาขา และการปรับแต้มจากหลังบ้าน')}</p>` : ''}
    </section>`;
}

// ค่าบนสุดของแกนให้เป็นเลขกลมๆ (1, 2, 5 × 10ⁿ) อ่านง่ายกว่าค่าสูงสุดจริง
function niceMax(v) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(n => n >= v);
}

function shortBaht(n) {
  if (n >= 1000000) return '฿' + (n / 1000000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M';
  if (n >= 10000) return '฿' + (n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'K';
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
  if (!top) return `<div class="chart-empty muted">${tr('ยังไม่มียอดซื้อในช่วงนี้')}</div>`;
  return `
    <div class="chart">
      <div class="chart-plot" id="chart-plot">
        ${[1, 0.5].map(f => `<div class="chart-grid" style="bottom:${f * 100}%"><span>${shortBaht(top * f)}</span></div>`).join('')}
        <div class="bars">${s.map((b, i) => `
          <button type="button" class="bar-col" data-i="${i}" aria-label="${tr('{key}: ยอดซื้อ {n} บาท {n2} บิล', { key: esc(label(b.key)), n: fmtMoney(b.sales), n2: fmtNum(b.bills) })}">
            <i class="${b.sales > 0 ? 'has' : ''}" style="height:${((b.sales / top) * 100).toFixed(2)}%"></i>
          </button>`).join('')}
        </div>
        <div class="chart-tip" id="chart-tip" hidden></div>
      </div>
      <div class="chart-x">${s.map((b, i) => `<span>${i % every === 0 ? esc(label(b.key)) : ''}</span>`).join('')}</div>
    </div>
    <details class="chart-table">
      <summary>${tr('ดูเป็นตาราง')}</summary>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${month ? tr('เดือน') : tr('วันที่')}</th><th class="num">${tr('ยอดซื้อ')}</th><th class="num">${tr('บิล')}</th><th class="num">${tr('สมาชิกใหม่')}</th></tr></thead>
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
      <div>${tr('ยอดซื้อ ฿{n}', { n: fmtMoney(b.sales) })}</div><div>${tr('{n} บิล · สมาชิกใหม่ {n2}', { n: fmtNum(b.bills), n2: fmtNum(b.newMembers) })}</div>`;
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
  fetchView('adminMembers', { q: m.q, sort: m.sort, status: m.status, page: m.page, birthMonth: m.birth === 'this', tier: m.tier, ...branchData() }, renderMembers);
}

function renderMembers(r) {
  const m = S.members;
  // ระดับสมาชิก: เฉพาะร้านที่เปิดแพ็กเกจ + ระบบส่งรายชื่อระดับมา
  const tiersShown = tierFeature() && Array.isArray(r.tiers) && r.tiers.length > 1;
  const tierOf = id => (r.tiers || []).find(t => t.id === id) || {};
  const opt = (value, label, cur) => `<option value="${value}" ${cur === value ? 'selected' : ''}>${label}</option>`;
  const owner = isOwner();
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('สมาชิก'), `${tr('{n} คน{x}{x2}', { n: fmtNum(r.total), x: m.q || m.status || m.birth ? tr(' (ตามที่ค้นหา)') : '', x2: S.branch ? ` ${tr('· สมัครที่{x}', { x: branchNote() })}` : '' })}`, exportBtn('members'))}
    <form class="filters" data-form="members" autocomplete="off">
      ${branchSelect()}
      <div class="search-box">${icon('search', 18)}<input name="q" value="${esc(m.q)}" placeholder="${owner ? tr('ค้นชื่อ / รหัสสมาชิก / เบอร์โทร') : tr('ค้นชื่อ / รหัสสมาชิก / เบอร์โทรเต็ม')}" enterkeyhint="search"></div>
      <select name="sort" aria-label="${tr('เรียงตาม')}">
        ${opt('joined', tr('สมัครล่าสุด'), m.sort)}${opt('lastVisit', tr('มาล่าสุด'), m.sort)}${opt('points', `${tr('{u}มากสุด', { u: esc(unit()) })}`, m.sort)}${opt('spend', tr('ยอดซื้อมากสุด'), m.sort)}${opt('name', tr('ชื่อ ก–ฮ'), m.sort)}
      </select>
      <select name="status" aria-label="${tr('สถานะ')}">
        ${opt('', tr('ทุกสถานะ'), m.status)}${opt('ACTIVE', tr('ใช้งานได้'), m.status)}${opt('BLOCKED', tr('ถูกระงับ'), m.status)}
      </select>
      ${owner ? `<select name="birth" aria-label="${tr('เดือนเกิด')}">${opt('', tr('ทุกเดือนเกิด'), m.birth)}${opt('this', tr('🎂 เกิดเดือนนี้'), m.birth)}</select>` : ''}
      ${tiersShown ? `<select name="tier" aria-label="${tr('ระดับ')}">${opt('', tr('ทุกระดับ'), m.tier)}${r.tiers.map(t => opt(esc(t.id), esc(t.name), m.tier)).join('')}</select>` : ''}
      <button class="btn btn-sm btn-primary" type="submit">${tr('ค้นหา')}</button>
    </form>
    ${owner ? '' : `<p class="muted small adm-note">${tr('ผู้จัดการเห็นเบอร์โทรแค่ 4 ตัวท้าย (เจ้าของร้านเห็นเต็ม)')}</p>`}
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${tr('ชื่อ')}</th><th>${tr('รหัสสมาชิก')}</th>${tiersShown ? `<th>${tr('ระดับ')}</th>` : ''}<th>${tr('เบอร์โทร')}</th><th class="num">${esc(unit())}</th><th class="num">${tr('ยอดซื้อรวม')}</th><th class="num">${tr('ครั้งที่มา')}</th><th>${tr('สมัครเมื่อ')}</th>${hasBranches() ? `<th>${tr('สมัครที่')}</th>` : ''}<th>${tr('มาล่าสุด')}</th><th>${tr('สถานะ')}</th></tr></thead>
        <tbody>${r.items.length ? r.items.map(x => `
          <tr class="row-link" data-act="member" data-id="${esc(x.memberId)}">
            <td class="strong">${memberLink(x.memberId, x.name)}</td>
            <td class="mono">${esc(x.memberId)}</td>
            ${tiersShown ? `<td class="nowrap">${tierChip(x.tier, tierOf(x.tierId).color)}</td>` : ''}
            <td class="nowrap">${esc(fmtPhone(x.phone) || x.phoneMasked || '-')}</td>
            <td class="num">${fmtNum(x.points)}</td>
            <td class="num">฿${fmtMoney(x.totalSpend)}</td>
            <td class="num">${fmtNum(x.visitCount)}</td>
            <td class="nowrap">${fmtDate(x.joinedAt)}</td>
            ${hasBranches() ? `<td class="nowrap">${esc(branchName(x.joinedBranch))}</td>` : ''}
            <td class="nowrap">${x.lastVisitAt ? fmtDate(x.lastVisitAt) : '-'}</td>
            <td>${x.status === 'ACTIVE' ? statusChip('active', tr('ใช้งานได้')) : statusChip('blocked', tr('ถูกระงับ'))}</td>
          </tr>`).join('') : emptyRow(11, m.q || S.branch || m.tier ? tr('ไม่พบสมาชิกที่ค้นหา') : tr('ยังไม่มีสมาชิก'))}
        </tbody></table></div>
    </section>
    ${pager(r, 'members')}`;
}

/* =====================================================
 * ส่งข้อความตามกลุ่ม — รอบ 1: คัดกลุ่มลูกค้า + ดูจำนวนคน (รอบ 2: เขียนข้อความ + ส่งผ่าน LINE OA ของร้าน)
 * ตัวกลางกรองคนที่ส่งได้ให้เอง (ยินยอมรับข่าวสาร + สมัครผ่าน LINE + ไม่ถูกระงับ) และไม่ส่ง LINE ID ของลูกค้ามาหน้าเว็บ
 * ===================================================== */

function loadBroadcast() {
  // เปิดลิงก์ #broadcast ตรงๆ ครั้งแรก: ถามว่าใครเข้าก่อน — ผู้จัดการจะได้กลับไปหน้าภาพรวม ไม่ใช่หน้า "ไม่มีสิทธิ์เข้าหลังบ้าน"
  if (!S.me) return fetchView('adminMe', {}, () => route());
  if (!isOwner() || !broadcastFeature()) { location.hash = '#overview'; return; }
  fetchView('adminAudience', { filter: S.aud.filter }, renderBroadcast);
}

function renderBroadcast(r) {
  const f = S.aud.filter;
  const val = k => esc(f[k] == null ? '' : String(f[k]));
  const tiers = tierFeature() && Array.isArray(r.tiers) && r.tiers.length > 1 ? r.tiers : [];
  const thisMonth = Number(todayKey().slice(5, 7));
  const opt = (value, label, cur) => `<option value="${value}" ${String(cur || '') === String(value) ? 'selected' : ''}>${label}</option>`;
  const picks = (name, list, chosen) => `<div class="tog-picks">${list.map(x => `
    <label><input type="checkbox" name="${name}" value="${esc(x.id)}" ${(chosen || []).includes(x.id) ? 'checked' : ''}><span>${x.dot || ''}${esc(x.name)}</span></label>`).join('')}</div>`;
  const range = (key, label) => `
    <div class="field"><span>${label}</span>
      <div class="aud-range"><input name="${key}Min" value="${val(key + 'Min')}" inputmode="numeric" placeholder="${tr('ตั้งแต่')}" aria-label="${tr('{label} ตั้งแต่', { label })}">
        <span class="muted">–</span><input name="${key}Max" value="${val(key + 'Max')}" inputmode="numeric" placeholder="${tr('ถึง')}" aria-label="${tr('{label} ถึง', { label })}"></div></div>`;
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('ส่งข้อความ'), tr('เลือกกลุ่มลูกค้า แล้วส่งข้อความหาเฉพาะกลุ่มนั้นผ่าน LINE OA ของร้าน'))}
    <div class="aud-layout">
      <section class="card adm-card">
        <div class="card-head"><h2>${tr('1. เลือกกลุ่มลูกค้า')}</h2></div>
        <form class="form" data-form="audience" autocomplete="off">
          <p class="muted small">${tr('ใส่ได้หลายข้อ ลูกค้าต้องตรงทุกข้อ · เว้นว่าง = ไม่กรองข้อนั้น')}</p>
          ${tiers.length ? `<div class="field"><span>${tr('ระดับสมาชิก')} <small>${tr('(ไม่เลือก = ทุกระดับ)')}</small></span>
            ${picks('tiers', tiers.map(t => ({ id: t.id, name: t.name, dot: tierDot(t.color) })), f.tiers)}</div>` : ''}
          ${hasBranches() ? `<div class="field"><span>${tr('สาขาที่สมัคร')} <small>${tr('(ไม่เลือก = ทุกสาขา)')}</small></span>
            ${picks('branches', S.branches.map(b => ({ id: b.id, name: b.name + (b.status === 'ACTIVE' ? '' : tr(' (ปิดแล้ว)')) })).concat([{ id: 'ONLINE', name: tr('ออนไลน์') }]), f.branches)}</div>` : ''}
          <label class="field"><span>${tr('เดือนเกิด')}</span>
            <select name="birthMonth" class="select">${opt('', tr('ทุกเดือน'), f.birthMonth)}${monthNames().map((m, i) => opt(i + 1, m + (i + 1 === thisMonth ? tr(' (เดือนนี้)') : ''), f.birthMonth)).join('')}</select></label>
          ${range('points', `${tr('{u}คงเหลือ', { u: esc(unit()) })}`)}
          ${range('spend', tr('ยอดซื้อรวม (บาท)'))}
          ${range('visits', tr('จำนวนครั้งที่มาซื้อ'))}
          <div class="field"><span>${tr('มาซื้อครั้งล่าสุด')}</span>
            <div class="aud-days">
              <select name="lastVisit" class="select" aria-label="${tr('มาซื้อครั้งล่าสุด')}">${opt('', tr('ไม่กำหนด'), f.lastVisit)}${opt('within', tr('มาภายใน'), f.lastVisit)}${opt('over', tr('ไม่ได้มาเกิน'), f.lastVisit)}</select>
              <input name="lastVisitDays" value="${val('lastVisitDays')}" inputmode="numeric" placeholder="${tr('จำนวน')}" aria-label="${tr('จำนวนวัน')}"><span class="muted">${tr('วัน')}</span>
            </div>
            <small>${tr('"ไม่ได้มาเกิน" รวมคนที่ยังไม่เคยซื้อ (นับจากวันสมัคร) — ใช้ชวนลูกค้าที่หายไปกลับมา')}</small></div>
          <div class="field"><span>${tr('สมัครสมาชิกภายใน')}</span>
            <div class="aud-days aud-days-1"><input name="joinedDays" value="${val('joinedDays')}" inputmode="numeric" placeholder="${tr('เช่น 30')}" aria-label="${tr('สมัครภายในกี่วัน')}"><span class="muted">${tr('วัน')}</span></div></div>
          <div class="notice">${icon('shield', 18)}<span>${tr('ระบบเลือกให้เฉพาะลูกค้าที่<b>ยินยอมรับข่าวสาร</b> สมัครผ่าน LINE และไม่ถูกระงับ (ตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล)')}</span></div>
          <div class="aud-actions">
            <button class="btn" type="button" data-act="aud-clear">${tr('ล้างเงื่อนไข')}</button>
            <button class="btn btn-primary" type="submit">${icon('users', 18)} ${tr('ดูจำนวนคน')}</button>
          </div>
        </form>
      </section>
      <div class="aud-side">
        <section class="card adm-card aud-result" id="aud-result">${audResultHtml(r)}</section>
        <section class="card adm-card" id="bc-send">${sendCardHtml()}</section>
      </div>
    </div>
    <section class="card adm-card" id="bc-history">${historyHtml()}</section>`;
  S.aud.dirty = false;
  setAudCount(r);
  updateSendState();
  loadBroadcastInfo();
}

function audResultHtml(r) {
  const ex = r.excluded || {};
  const cut = [ex.noConsent ? `${tr('ไม่ยินยอมรับข่าวสาร {n}', { n: fmtNum(ex.noConsent) })}` : '', ex.blocked ? `${tr('ถูกระงับ {n}', { n: fmtNum(ex.blocked) })}` : '',
    ex.noLine ? `${tr('ไม่ได้สมัครผ่าน LINE {n}', { n: fmtNum(ex.noLine) })}` : ''].filter(Boolean);
  const tiers = tierFeature() && Array.isArray(r.tiers) && r.tiers.length > 1 ? r.tiers : [];
  const color = id => (tiers.find(t => t.id === id) || {}).color;
  return `
    <div class="card-head"><h2>${tr('กลุ่มที่เลือก')}</h2></div>
    <div class="aud-count"><span>${tr('ส่งได้')}</span><b>${fmtNum(r.sendable)}</b><span>${tr('คน')}</span></div>
    <p class="muted small">${tr('ตรงเงื่อนไข {n} คน{n2}', { n: fmtNum(r.matched), n2: cut.length ? ` ${tr('· ไม่นับ: {x}', { x: cut.join(' · ') })}` : '' })}</p>
    ${reachHtml(r)}
    ${r.items.length ? `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${tr('ชื่อ')}</th>${tiers.length ? `<th>${tr('ระดับ')}</th>` : ''}<th class="num">${esc(unit())}</th><th class="num">${tr('ยอดซื้อรวม')}</th><th class="num">${tr('ครั้ง')}</th><th>${tr('มาล่าสุด')}</th></tr></thead>
        <tbody>${r.items.map(x => `
          <tr class="row-link" data-act="member" data-id="${esc(x.memberId)}">
            <td class="strong">${memberLink(x.memberId, x.name)}</td>
            ${tiers.length ? `<td class="nowrap">${tierChip(x.tier, color(x.tierId))}</td>` : ''}
            <td class="num">${fmtNum(x.points)}</td>
            <td class="num">฿${fmtMoney(x.totalSpend)}</td>
            <td class="num">${fmtNum(x.visitCount)}</td>
            <td class="nowrap">${x.lastVisitAt ? fmtDate(x.lastVisitAt) : '-'}</td>
          </tr>`).join('')}
        </tbody></table></div>
      <p class="muted small">${r.sendable > r.items.length ? `${tr('ตัวอย่าง {n} คนที่สมัครล่าสุด จากทั้งหมด {n2} คน', { n: fmtNum(r.items.length), n2: fmtNum(r.sendable) })}` : `${tr('แสดงครบทั้ง {n} คน', { n: fmtNum(r.items.length) })}`}</p>`
    : `<div class="notice">${icon('alert', 18)}<span>${tr('ไม่มีลูกค้าที่ส่งได้ตามเงื่อนไขนี้ ลองลดเงื่อนไขลง')}</span></div>`}`;
}

// จำนวนของกลุ่มล่าสุด (ทุกที่ที่ได้ผลคัดกลุ่มต้องผ่านตรงนี้ — ไม่งั้นหน้ายืนยันใช้ตัวเลขของกลุ่มก่อนหน้า)
// โควตาที่ใช้ = คนที่อาจได้รับ (ไม่นับคนที่รู้แน่ว่าไม่เป็นเพื่อน) — ตรงกับที่ตัวกลางตรวจตอนส่ง
function setAudCount(r) {
  S.bc.count = r.sendable;
  S.bc.need = r.reach ? r.sendable - r.reach.notFriend : r.sendable;
}

// ในคนที่ส่งได้: กี่คนได้รับจริง (เป็นเพื่อน LINE OA) — สถานะจดตอนลูกค้าเปิดบัตร คนที่ยังไม่เคยเปิดหลังเริ่มจด = ยังไม่รู้
// LINE ข้ามคนที่ไม่เป็นเพื่อน/บล็อกเอง (ไม่เสียโควตา) ระบบจึงยังส่งให้ทุกคนที่ส่งได้ เผื่อเพิ่งเพิ่มเพื่อน
function reachHtml(r) {
  const x = r.reach;
  if (!x || !r.sendable) return '';
  const parts = [`${tr('<b>ได้รับจริง {n} คน</b> (เป็นเพื่อน LINE ของร้าน)', { n: fmtNum(x.friend) })}`];
  if (x.notFriend) parts.push(`${tr('ยังไม่เป็นเพื่อนหรือบล็อก {n} คน — ไม่ได้รับ ไม่เสียโควตา', { n: fmtNum(x.notFriend) })}`);
  if (x.unknown) parts.push(`${tr('ยังไม่รู้สถานะ {n} คน (ยังไม่ได้เปิดบัตรสมาชิกตั้งแต่เริ่มนับ)', { n: fmtNum(x.unknown) })}`);
  return `<p class="aud-reach small">${parts.join('<br>')}</p>`;
}

// อ่านฟอร์ม + ตรวจเบื้องต้น (ตัวกลางตรวจซ้ำเสมอ) → null = ผิด (แจ้งแล้ว)
function readAudience(form) {
  const f = form.elements;
  const v = name => (f[name] ? String(f[name].value).replace(/,/g, '').trim() : '');
  const pick = name => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(x => x.value);
  const filter = {
    tiers: pick('tiers'), branches: pick('branches'), birthMonth: v('birthMonth'),
    pointsMin: v('pointsMin'), pointsMax: v('pointsMax'), spendMin: v('spendMin'), spendMax: v('spendMax'),
    visitsMin: v('visitsMin'), visitsMax: v('visitsMax'), lastVisit: v('lastVisit'), lastVisitDays: v('lastVisitDays'), joinedDays: v('joinedDays')
  };
  const pairs = [['points', `${tr('{u}คงเหลือ', { u: unit() })}`], ['spend', tr('ยอดซื้อรวม')], ['visits', tr('จำนวนครั้งที่มาซื้อ')]];
  for (const [k, label] of pairs) {
    const lo = filter[k + 'Min'], hi = filter[k + 'Max'];
    if ((lo && !/^\d+$/.test(lo)) || (hi && !/^\d+$/.test(hi))) { toast(`${tr('{label}: ใส่เป็นตัวเลขจำนวนเต็ม', { label })}`, 'err'); return null; }
    if (lo && hi && Number(lo) > Number(hi)) { toast(`${tr('{label}: ค่าเริ่มต้องไม่มากกว่าค่าสิ้นสุด', { label })}`, 'err'); return null; }
  }
  for (const [k, label] of [['lastVisitDays', tr('มาซื้อครั้งล่าสุด')], ['joinedDays', tr('สมัครสมาชิกภายใน')]]) {
    if (filter[k] && !(/^\d+$/.test(filter[k]) && Number(filter[k]) >= 1)) { toast(`${tr('{label}: ใส่จำนวนวันตั้งแต่ 1 ขึ้นไป', { label })}`, 'err'); return null; }
  }
  if (filter.lastVisit && !filter.lastVisitDays) { toast(tr('มาซื้อครั้งล่าสุด: ใส่จำนวนวันด้วย'), 'err'); return null; }
  if (!filter.lastVisit) filter.lastVisitDays = '';
  return filter;
}

// กด "ดูจำนวนคน": อัปเดตเฉพาะกล่องผล (ฟอร์มไม่ถูกวาดใหม่ — ค่าที่พิมพ์ไว้ไม่หาย แม้ตัวกลางตอบว่าเงื่อนไขผิด)
async function submitAudience(form) {
  const filter = readAudience(form);
  if (!filter) return;
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await S.api.call('adminAudience', { filter });
    S.aud.filter = filter;
    S.aud.dirty = false;
    setAudCount(r);
    updateSendState();
    const box = document.getElementById('aud-result');
    if (box) {
      box.innerHTML = audResultHtml(r);
      // บนมือถือกล่องผลอยู่ใต้ฟอร์ม → เลื่อนให้เห็นผลทันที
      if (window.matchMedia('(max-width: 900px)').matches) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(btn, false);
  }
}

/* ---------- 2. เขียนข้อความและส่ง (ผ่าน LINE OA ของร้าน) + ประวัติการส่ง ---------- */
const BC_MAX = 2000;
const BC_STATUS = { DONE: ['ส่งครบ', 'active'], PARTIAL: ['ส่งไม่ครบ', 'pending'], FAILED: ['ไม่สำเร็จ', 'blocked'], SENDING: ['กำลังส่ง', 'pending'], STALLED: ['หยุดกลางทาง', 'pending'] };
const BC_ERROR = { OA_LIMIT: 'เกินโควตา LINE OA หรือส่งถี่เกินไป', OA_TOKEN: 'การเชื่อม LINE OA มีปัญหา', OA_DOWN: 'ติดต่อ LINE ไม่ได้ชั่วคราว', OA_REJECTED: 'LINE ไม่รับข้อความนี้', TIME: 'ใช้เวลานานเกิน' };

// สถานะ OA + ประวัติ: ทำเบื้องหลัง (ไม่บังจอ) — เลือกกลุ่มได้เลยระหว่างรอ
async function loadBroadcastInfo() {
  try {
    const r = await S.api.call('adminBroadcastInfo', {});
    S.bc.info = r;
  } catch (e) {
    S.bc.info = { connected: false, error: e.message, history: (S.bc.info && S.bc.info.history) || [] };
  }
  const card = document.getElementById('bc-send');
  if (!card) return; // ผู้ใช้เปลี่ยนหน้าไปแล้ว
  card.innerHTML = sendCardHtml();
  document.getElementById('bc-history').innerHTML = historyHtml();
  updateSendState();
}

function sendCardHtml() {
  const info = S.bc.info;
  const head = `<div class="card-head"><h2>${tr('2. เขียนข้อความและส่ง')}</h2></div>`;
  if (!info) return head + `<p class="muted small"><span class="spin spin-dark"></span> ${tr('กำลังเช็กการเชื่อม LINE OA...')}</p>`;
  if (!info.connected) {
    const why = info.error || info.problemText;
    return head + `<div class="notice">${icon('lock', 18)}<span>${why ? esc(why) : tr('ใช้ได้เมื่อเชื่อม LINE OA ของร้านกับระบบแล้ว — ติดต่อผู้ดูแลระบบ')}</span></div>
      ${why ? `<button type="button" class="link" data-act="bc-reload">${icon('refresh', 14)} ${tr('ลองใหม่')}</button>` : ''}`;
  }
  const oa = info.oa || {};
  const q = info.quota || {};
  const d = S.bc.draft;
  return head + `
    <div class="bc-oa">
      <span class="bc-av">${oa.picture ? `<img src="${esc(oa.picture)}" alt="" referrerpolicy="no-referrer">` : icon('store', 18)}</span>
      <div class="grow"><b>${esc(oa.name || tr('LINE OA ของร้าน'))}</b> <span class="muted small">${esc(oa.basicId || '')}</span></div>
      <span class="chip">${q.limited ? `${tr('โควตาเดือนนี้เหลือ {n} / {n2}', { n: fmtNum(q.remaining), n2: fmtNum(q.limit) })}` : tr('โควตาไม่จำกัด')}</span>
    </div>
    ${info.ownerIsFriend ? '' : `<div class="notice">${icon('alert', 18)}<span>${tr('บัญชี LINE ของคุณยังไม่ได้เพิ่ม <b>{x}</b> เป็นเพื่อน จึงส่งทดสอบหาตัวเองไม่ได้ (เพิ่มแล้วยังขึ้นข้อความนี้ แจ้งผู้ดูแลระบบ)', { x: esc(oa.name || tr('OA ของร้าน')) })}</span></div>`}
    <form class="form" data-form="broadcast" autocomplete="off">
      <label class="field"><span>${tr('ข้อความ')}</span>
        <textarea name="text" rows="5" maxlength="${BC_MAX}" placeholder="${tr('เช่น สวัสดีค่ะ สมาชิกระดับ Gold รับส่วนลด 20% ทุกเมนู ถึงสิ้นเดือนนี้')}">${esc(d.text)}</textarea>
        <small class="bc-counter" id="bc-counter">${fmtNum([...d.text].length)} / ${fmtNum(BC_MAX)}</small></label>
      <div class="field"><span>${tr('รูป')} <small>${tr('(ไม่บังคับ · ขึ้นเต็มความกว้างแชตแบบริชเมสเสจ)')}</small></span>
        <div class="img-upload">
          <label class="btn btn-sm upload-btn">${icon('upload', 16)} ${tr('อัปโหลดรูป')}<input type="file" accept="image/jpeg,image/png,image/*" data-upload="image" hidden></label>
          <button type="button" class="link" data-act="image-clear" data-id="image">${tr('ลบรูป')}</button>
        </div>
        <small class="hint img-size">${tr('ขนาดแนะนำ <b>1040 × 1040 px</b> (สี่เหลี่ยมจัตุรัส) · ใช้ได้ตั้งแต่แนวนอน 2:1 ถึงแนวตั้ง 2:3 · ระบบไม่ตัดรูปให้')}</small>
        <input type="hidden" name="image" value="${esc(d.image)}"><input type="hidden" name="imageHeight" value="${esc(d.imageHeight)}"></div>
      <!-- ริชเมสเสจต้องมีจุดแตะ (LINE บังคับ) และลูกค้าแตะเพื่อขยายรูปไม่ได้ → ให้ร้านเลือกว่าแตะแล้วไปไหน -->
      <label class="field" id="bc-link-field" ${d.image ? '' : 'hidden'}><span>${tr('แตะรูปแล้วเปิด')} <small>${tr('(เว้นว่าง = บัตรสมาชิกของร้าน)')}</small></span>
        <input name="link" type="url" inputmode="url" maxlength="1000" placeholder="https://..." value="${esc(d.link)}"></label>
      <div class="field"><span>${tr('ตัวอย่างในแชต LINE')}</span><div class="bc-preview" id="bc-preview">${bcPreviewHtml()}</div></div>
      <p class="muted small">${tr('ลูกค้าที่ยังไม่ได้เพิ่ม OA เป็นเพื่อน หรือบล็อก OA ไว้ จะไม่ได้รับข้อความ')}</p>
      <div class="aud-actions">
        <button type="button" class="btn" data-act="bc-test" ${info.ownerIsFriend ? '' : 'disabled'}>${icon('user', 16)} ${tr('ส่งทดสอบหาตัวเอง')}</button>
        <button type="button" class="btn btn-primary" data-act="bc-send" id="bc-send-btn">${icon('send', 16)} ${tr('ส่ง')}</button>
      </div>
    </form>`;
}

function bcPreviewHtml(draft = S.bc.draft) {
  const oa = (S.bc.info && S.bc.info.oa) || {};
  if (!draft.text && !draft.image) return `<p class="muted small">${tr('พิมพ์ข้อความหรือใส่รูป แล้วตัวอย่างจะขึ้นที่นี่')}</p>`;
  // ริชเมสเสจกว้างกว่ากล่องข้อความในแชตจริง → กล่องตัวอย่างกว้างขึ้นเมื่อมีรูป / จองที่ตามสัดส่วนไว้ก่อนรูปโหลดเสร็จ (ตัวอย่างไม่กระตุก)
  const h = Math.round(Number(draft.imageHeight)) || 1040;
  return `
    <div class="lp">
      <span class="bc-av bc-av-sm">${oa.picture ? `<img src="${esc(oa.picture)}" alt="" referrerpolicy="no-referrer">` : icon('store', 14)}</span>
      <div class="lp-body${draft.image ? ' lp-wide' : ''}">
        <div class="lp-name">${esc(oa.name || cfg().name)}</div>
        ${draft.image ? `<div class="lp-rich" style="aspect-ratio: 1040 / ${h}"><img src="${esc(draft.image)}/700" alt=""></div>` : ''}
        ${draft.text ? `<div class="lp-bubble">${esc(draft.text)}</div>` : ''}
      </div>
    </div>`;
}

function onDraftInput(form) {
  const el = form.elements;
  S.bc.draft = { text: el.text.value, image: el.image.value, imageHeight: el.image.value ? el.imageHeight.value : '', link: el.link.value };
  const linkField = document.getElementById('bc-link-field');
  if (linkField) linkField.hidden = !S.bc.draft.image; // ไม่มีรูป = ไม่มีอะไรให้แตะ
  const counter = document.getElementById('bc-counter');
  if (counter) counter.textContent = `${fmtNum([...S.bc.draft.text].length)} / ${fmtNum(BC_MAX)}`;
  const box = document.getElementById('bc-preview');
  if (box) box.innerHTML = bcPreviewHtml();
  updateSendState();
}

// แก้เงื่อนไขแล้วยังไม่กด "ดูจำนวนคน" → ห้ามส่ง (กันส่งผิดกลุ่ม: จำนวนที่เห็นต้องเป็นกลุ่มที่จะส่งจริง)
function markAudDirty() {
  if (S.aud.dirty) return;
  S.aud.dirty = true;
  updateSendState();
}

function updateSendState() {
  const btn = document.getElementById('bc-send-btn');
  if (!btn || btn.querySelector('.spin')) return;
  const d = S.bc.draft;
  const n = S.bc.count || 0;
  const label = S.aud.dirty ? tr('กด "ดูจำนวนคน" ก่อนส่ง') : !n ? tr('ไม่มีลูกค้าในกลุ่มนี้') : `${tr('ส่งให้ {n} คน', { n: fmtNum(n) })}`;
  btn.innerHTML = `${icon('send', 16)} ${esc(label)}`;
  btn.disabled = S.aud.dirty || !n || (!d.text.trim() && !d.image);
}

function readDraft() {
  const src = S.bc.draft;
  const d = { text: src.text.trim(), image: src.image };
  if (!d.text && !d.image) { toast(tr('พิมพ์ข้อความหรือใส่รูปก่อน'), 'err'); return null; }
  if ([...d.text].length > BC_MAX) { toast(`${tr('ข้อความยาวได้ไม่เกิน {n} ตัวอักษร', { n: fmtNum(BC_MAX) })}`, 'err'); return null; }
  if (d.image) {
    d.imageHeight = Number(src.imageHeight);
    d.link = src.link.trim();
    // ตัวกลางตรวจซ้ำอยู่แล้ว — ที่นี่บอกก่อนกดส่ง ไม่ต้องรอคำตอบ
    if (d.link && !/^https:\/\/\S+$/i.test(d.link)) { toast(tr('ลิงก์เมื่อแตะรูปต้องขึ้นต้นด้วย https:// (เว้นว่าง = เปิดบัตรสมาชิกของร้าน)'), 'err'); return null; }
  }
  return d;
}

async function bcTest(btn) {
  const draft = readDraft();
  if (!draft) return;
  setBusy(btn, true, tr('กำลังส่ง...'));
  try {
    await withRequestId('bctest|' + JSON.stringify(draft), rid => S.api.call('adminBroadcastTest', { draft, requestId: rid }));
    toast(tr('ส่งทดสอบแล้ว เปิดแชต LINE ของคุณดูได้เลย'), 'ok');
    loadBroadcastInfo(); // โควตาลดไป 1
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(btn, false);
  }
}

function confirmBroadcast() {
  const draft = readDraft();
  if (!draft) return;
  if (S.aud.dirty) return toast(tr('กด "ดูจำนวนคน" ก่อน เพื่อยืนยันกลุ่มที่จะส่ง'), 'err');
  const n = S.bc.count || 0;
  if (!n) return toast(tr('ไม่มีลูกค้าที่ส่งได้ในกลุ่มนี้'), 'err');
  const q = (S.bc.info && S.bc.info.quota) || {};
  const need = S.bc.need == null ? n : S.bc.need;
  const short = q.limited && q.remaining < need;
  S.bc.pending = { draft, filter: S.aud.filter, expect: n };
  openModal(`
    <div class="modal-head"><h2>${tr('ยืนยันส่งข้อความ')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <div class="form">
      <div class="aud-count"><span>${tr('ส่งให้')}</span><b>${fmtNum(n)}</b><span>${tr('คน')}</span></div>
      ${q.limited ? `<p class="small ${short ? 'text-danger' : 'muted'}">${tr('โควตาข้อความเดือนนี้ของ LINE OA เหลือ {n} ข้อความ{n2}', { n: fmtNum(q.remaining), n2: short ? ` ${tr('ไม่พอส่ง {n} คน — ลดกลุ่มลง หรือเพิ่มแพ็กเกจ LINE OA', { n: fmtNum(need) })}` : ` ${tr('(ครั้งนี้ใช้ไม่เกิน {n})', { n: fmtNum(need) })}` })}</p>` : ''}
      <div class="bc-preview">${bcPreviewHtml(draft)}</div>
      <div class="notice">${icon('alert', 18)}<span>${tr('ส่งแล้ว<b>ยกเลิกหรือแก้ไขไม่ได้</b> ตรวจข้อความและกลุ่มลูกค้าให้เรียบร้อยก่อน')}</span></div>
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn btn-primary" type="button" data-act="bc-send-confirm" ${short ? 'disabled' : ''}>${icon('send', 16)} ${tr('ส่งเลย {n} คน', { n: fmtNum(n) })}</button>
      </div>
    </div>`);
}

async function doBroadcast(btn) {
  const p = S.bc.pending;
  if (!p) return;
  setBusy(btn, true, tr('กำลังส่ง...'));
  try {
    // รหัสคำขอเดิมถ้าเน็ตหลุดแล้วกดใหม่ → ตัวกลางคืนการส่งเดิม ลูกค้าไม่ได้ซ้ำ
    const r = await withRequestId('bcsend|' + JSON.stringify(p), rid => S.api.call('adminBroadcastSend', { ...p, requestId: rid }));
    closeModal();
    S.bc.pending = null;
    const b = r.broadcast;
    if (b.status === 'DONE') {
      toast(`${tr('ส่งแล้ว {n} คน', { n: fmtNum(b.sent) })}`, 'ok');
      S.bc.draft = BC_EMPTY(); // ล้างข้อความ กันเผลอกดส่งซ้ำ
    } else {
      toast(`${tr('ส่งได้ {n} จาก {n2} คน — กด "ส่งต่อ" ในประวัติการส่ง', { n: fmtNum(b.sent), n2: fmtNum(b.total) })}`, 'err');
    }
    S.bc.info = null;
    document.getElementById('bc-send').innerHTML = sendCardHtml();
    loadBroadcastInfo();
  } catch (e) {
    toast(e.message, 'err');
    if (e.code === 'AUDIENCE_CHANGED') { closeModal(); markAudDirty(); }
  } finally {
    setBusy(btn, false);
  }
}

async function bcResume(id, btn) {
  setBusy(btn, true, tr('กำลังส่ง...'));
  try {
    const r = await S.api.call('adminBroadcastResume', { id });
    const b = r.broadcast;
    toast(b.status === 'DONE' ? `${tr('ส่งครบแล้ว {n} คน', { n: fmtNum(b.sent) })}` : `${tr('ส่งได้ {n} จาก {n2} คน', { n: fmtNum(b.sent), n2: fmtNum(b.total) })}`, b.status === 'DONE' ? 'ok' : 'err');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    setBusy(btn, false);
    loadBroadcastInfo();
  }
}

function historyHtml() {
  const items = (S.bc.info && S.bc.info.history) || [];
  return `
    <div class="card-head"><h2>${tr('ประวัติการส่ง')}</h2></div>
    ${!S.bc.info ? `<p class="muted small">${tr('กำลังโหลด...')}</p>` : !items.length ? `<p class="muted small">${tr('ยังไม่เคยส่งข้อความ')}</p>` : `
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${tr('วันเวลา')}</th><th>${tr('ข้อความ')}</th><th class="num">${tr('ส่งแล้ว')}</th><th>${tr('สถานะ')}</th><th></th></tr></thead>
      <tbody>${items.map(x => {
        const [label, cls] = (BC_STATUS[x.status] || [x.status, 'inactive']).map((v, i) => (i === 0 ? tr(v) : v));
        return `
        <tr>
          <td class="nowrap">${fmtDateTime(x.createdAt)}<div class="muted small">${esc(x.by)}</div></td>
          <td class="bc-text">${x.image ? `${icon('upload', 14)} ${tr('รูป ·')} ` : ''}${esc(x.text || '')}</td>
          <td class="num nowrap">${fmtNum(x.sent)} / ${fmtNum(x.total)}</td>
          <td>${statusChip(cls, label)}${x.error && BC_ERROR[x.error] ? `<div class="muted small">${esc(tr(BC_ERROR[x.error]))}</div>` : ''}</td>
          <td>${x.canResume ? `<button type="button" class="btn btn-sm" data-act="bc-resume" data-id="${esc(x.id)}">${icon('refresh', 14)} ${tr('ส่งต่อ')}</button>` : ''}</td>
        </tr>`;
      }).join('')}
      </tbody></table></div>
    <p class="muted small">${tr('"ส่งต่อ" = ส่งเฉพาะคนที่ยังไม่ได้รับ ไม่ส่งซ้ำคนที่ได้ไปแล้ว')}</p>`}`;
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
  S.memberTiers = r.tiers || [];
  const owner = isOwner();
  const deleted = m.deleted === true; // ลบบัญชีแล้ว (PDPA): เหลือแต่ประวัติแบบไม่มีชื่อ — แก้/ระงับ/ปรับแต้มไม่ได้
  document.getElementById('view').innerHTML = `
    <a class="back-link" href="#members">${icon('left', 16)} ${tr('รายชื่อสมาชิก')}</a>
    <section class="card adm-card member-head">
      <div class="avatar">${m.picture ? `<img src="${esc(m.picture)}" alt="" referrerpolicy="no-referrer">` : icon('user', 26)}</div>
      <div class="grow">
        <div class="m-name">${esc(m.name)}</div>
        <div class="m-sub mono">${esc(m.memberId)}</div>
      </div>
      ${deleted ? statusChip('blocked', tr('ลบบัญชีแล้ว')) : m.status === 'ACTIVE' ? statusChip('active', tr('ใช้งานได้')) : statusChip('blocked', tr('ถูกระงับ'))}
    </section>
    <div class="kpis kpis-3">
      <div class="kpi"><div class="kpi-label">${tr('{u}คงเหลือ', { u: esc(unit()) })}</div><div class="kpi-value">${fmtNum(m.points)}</div></div>
      <div class="kpi"><div class="kpi-label">${tr('ยอดซื้อรวม')}</div><div class="kpi-value">฿${fmtMoney(m.totalSpend)}</div></div>
      <div class="kpi"><div class="kpi-label">${tr('จำนวนครั้งที่มา')}</div><div class="kpi-value">${fmtNum(m.visitCount)}</div></div>
    </div>
    ${deleted ? `<p class="notice">${icon('shield', 18)}<span>${tr('ลบบัญชีสมาชิกแล้วเมื่อ {date} — ชื่อ เบอร์ วันเกิด และบัญชี LINE ถูกลบตามคำขอ เหลือเฉพาะประวัติยอดซื้อแบบไม่มีชื่อ', { date: fmtDateTime(m.deletedAt) })}</span></p>` : memberTierHtml(m, owner)}
    ${deleted ? '' : `<div class="adm-grid2">
      <section class="card adm-card">
        <div class="card-head"><h2>${tr('ข้อมูลสมาชิก')}</h2></div>
        <dl class="kv">
          ${m.firstName ? `<dt>${tr('ชื่อ')}</dt><dd>${esc(m.firstName)}</dd><dt>${tr('นามสกุล')}</dt><dd>${esc(m.lastName || '-')}</dd>` : ''}
          <dt>${tr('เบอร์โทร')}</dt><dd>${esc(fmtPhone(m.phone) || m.phoneMasked || '-')}</dd>
          ${owner ? `<dt>${tr('วันเกิด')}</dt><dd>${m.birthDate ? fmtDate(m.birthDate + 'T00:00:00+07:00') : '-'}${m.birthSelfEdits ? ` <span class="muted small">${tr('(ลูกค้าแก้เองครบแล้ว)')}</span>` : ''}</dd>` : ''}
          <dt>${tr('สมัครเมื่อ')}</dt><dd>${fmtDateTime(m.joinedAt)}</dd>
          ${hasBranches() ? `<dt>${tr('สมัครที่สาขา')}</dt><dd>${esc(branchName(m.joinedBranch))}</dd>
          <dt>${tr('มาบ่อยที่สุด')}</dt><dd>${m.topBranch ? `${esc(branchName(m.topBranch))} <span class="muted small">${tr('({n} บิลล่าสุด)', { n: fmtNum(m.topBranchVisits) })}</span>` : '-'}</dd>` : ''}
          <dt>${tr('มาล่าสุด')}</dt><dd>${m.lastVisitAt ? fmtDateTime(m.lastVisitAt) : '-'}</dd>
          <dt>${tr('ยอมรับนโยบาย')}</dt><dd>${m.consentAt ? `${tr('ฉบับที่ {x} · {date}', { x: esc(m.consentVersion || '-'), date: fmtDate(m.consentAt) })}` : '-'}</dd>
          <dt>${tr('รับข่าวสาร')}</dt><dd>${m.marketingConsent ? tr('ยินยอม') : tr('ไม่ยินยอม')}</dd>
          <dt>${tr('บัญชี LINE')}</dt><dd>${m.lineLinked ? tr('เชื่อมแล้ว') : tr('ยังไม่เชื่อม')}</dd>
          ${m.note ? `<dt>${tr('หมายเหตุ')}</dt><dd>${esc(m.note)}</dd>` : ''}
        </dl>
        <div class="member-status-row">
          ${owner ? `<button class="btn btn-sm" data-act="member-edit">${icon('edit', 16)} ${tr('แก้ไขข้อมูล')}</button>` : ''}
          ${m.status === 'ACTIVE'
            ? `<button class="btn btn-sm btn-danger-outline" data-act="member-status">${icon('shield', 16)} ${tr('ระงับสมาชิก')}</button>`
            : `<button class="btn btn-sm btn-primary" data-act="member-status">${icon('check', 16)} ${tr('เปิดใช้อีกครั้ง')}</button>`}
          ${owner && r.canDelete ? `<button class="btn btn-sm btn-danger-outline" data-act="member-delete">${icon('x', 16)} ${tr('ลบข้อมูลสมาชิก')}</button>` : ''}
        </div>
        ${owner ? '' : `<p class="muted small">${tr('ผู้จัดการไม่เห็นเบอร์เต็มและวันเกิด (เจ้าของร้านเห็น)')}</p>`}
      </section>
      <section class="card adm-card">
        <div class="card-head"><h2>${icon('coins', 18)} ${tr('ปรับ{u}', { u: esc(unit()) })}</h2></div>
        <form class="form" data-form="adjust" autocomplete="off">
          <label class="field"><span>${tr('จำนวน (+ เพิ่ม / − ลด)')}</span><input name="points" inputmode="numeric" placeholder="${tr('เช่น 50 หรือ -20')}"></label>
          <label class="field"><span>${tr('เหตุผล <em>*</em>')}</span><input name="reason" maxlength="150" placeholder="${tr('เช่น แก้ยอดที่บันทึกผิด')}"></label>
          <button class="btn btn-primary" type="submit">${tr('ปรับ{u}', { u: esc(unit()) })}</button>
          <p class="muted small">${tr('ทุกการปรับจะบันทึกชื่อคุณและเหตุผลไว้ในประวัติ')}</p>
        </form>
      </section>
    </div>`}
    <section class="card adm-card flush">
      <div class="card-head pad"><h2>${tr('ประวัติ{u}', { u: esc(unit()) })}</h2><span class="muted small">${tr('{n} รายการล่าสุด', { n: fmtNum(r.history.length) })}</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${tr('วันเวลา')}</th><th>${tr('ประเภท')}</th><th>${tr('รายละเอียด')}</th><th class="num">${tr('ยอดซื้อ')}</th><th class="num">${esc(unit())}</th><th class="num">${tr('คงเหลือ')}</th><th>${tr('พนักงาน')}</th>${hasBranches() ? `<th>${tr('สาขา')}</th>` : ''}</tr></thead>
        <tbody>${r.history.length ? r.history.map(t => `
          <tr>
            <td class="nowrap">${fmtDateTime(t.date)}</td>
            <td class="nowrap">${esc(tr(TX_LABEL[t.type] || t.type))}</td>
            <td>${esc(txDetail(t))}</td>
            <td class="num">${t.type === 'EARN' ? '฿' + fmtMoney(t.amount) : ''}</td>
            <td class="num tx-points ${ptsClass(t.points)}">${signed(t.points)}</td>
            <td class="num">${fmtNum(t.balance)}</td>
            <td>${esc(staffLabel(t.staff))}</td>
            ${hasBranches() ? `<td class="nowrap">${esc(t.type === 'REDEEM' || t.type === 'WELCOME' || t.type === 'CONSENT' ? '-' : branchName(t.branch))}</td>` : ''}
          </tr>`).join('') : emptyRow(8, tr('ยังไม่มีรายการ'))}
        </tbody></table></div>
    </section>
    ${(m.profileLog || []).length ? `
    <section class="card adm-card flush">
      <div class="card-head pad"><h2>${tr('ประวัติการแก้ข้อมูล')}</h2><span class="muted small">${tr('จดเฉพาะช่องที่แก้ ไม่เก็บค่าเดิม')}</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${tr('วันเวลา')}</th><th>${tr('แก้ช่อง')}</th><th>${tr('โดย')}</th></tr></thead>
        <tbody>${m.profileLog.map(l => `
          <tr><td class="nowrap">${fmtDateTime(l.date)}</td><td>${esc(l.changed)}</td><td>${esc(l.by)}</td></tr>`).join('')}
        </tbody></table></div>
    </section>` : ''}
    <section class="card adm-card flush">
      <div class="card-head pad"><h2>${tr('คูปอง')}</h2><span class="muted small">${tr('{n} ใบ', { n: fmtNum(r.coupons.length) })}</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${tr('ของรางวัล')}</th><th>${tr('รหัสคูปอง')}</th><th>${tr('สถานะ')}</th><th>${tr('แลกเมื่อ')}</th><th>${tr('ใช้ได้ถึง')}</th><th>${tr('ใช้เมื่อ')}</th></tr></thead>
        <tbody>${r.coupons.length ? r.coupons.map(c => `
          <tr>
            <td>${esc(c.name)}</td>
            <td class="mono">${esc(c.code)}</td>
            <td>${statusChip(c.status, tr(COUPON_LABEL[c.status] || c.status))}</td>
            <td class="nowrap">${fmtDateTime(c.issuedAt)}</td>
            <td class="nowrap">${fmtDate(c.expiresAt)}</td>
            <td class="nowrap">${c.usedAt ? fmtDateTime(c.usedAt) + (c.usedBy ? ' · ' + esc(c.usedBy) : '') + (hasBranches() && c.usedBranch ? ' · ' + esc(branchName(c.usedBranch)) : '') : '-'}</td>
          </tr>`).join('') : emptyRow(6, tr('ยังไม่เคยแลกรางวัล'))}
        </tbody></table></div>
    </section>`;
}

function onAdjustSubmit(form) {
  const m = S.member;
  if (!m) return;
  const points = Number(String(form.points.value).replace(/[,\s]/g, '').replace('−', '-'));
  const reason = form.reason.value.trim();
  if (!Number.isInteger(points) || points === 0) return toast(tr('ใส่จำนวนเป็นจำนวนเต็ม เช่น 50 หรือ -20'), 'err');
  if (reason.length < 3) return toast(tr('กรุณาใส่เหตุผล'), 'err');
  if (m.points + points < 0) return toast(`${tr('ลดได้ไม่เกิน {n} {u}', { n: fmtNum(m.points), u: unit() })}`, 'err');
  S.pendingAdjust = { memberId: m.memberId, points, reason };
  openModal(`
    <div class="modal-head"><h2>${tr('ยืนยันปรับ{u}', { u: esc(unit()) })}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <div class="confirm-cost"><b>${signed(points)}</b><span>${esc(unit())} · ${esc(m.name)}</span>
      <div class="muted">${tr('คงเหลือ {n} → {n2}', { n: fmtNum(m.points), n2: fmtNum(m.points + points) })}</div></div>
    <p class="muted">${tr('เหตุผล: {reason}', { reason: esc(reason) })}</p>
    <div class="modal-actions">
      <button class="btn" data-act="close">${tr('ยกเลิก')}</button>
      <button class="btn btn-primary" data-act="adjust-confirm">${tr('ยืนยัน')}</button>
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
    toast(r.duplicate ? tr('รายการนี้บันทึกไปแล้ว (ระบบไม่บันทึกซ้ำ)') : `${tr('ปรับแล้ว · คงเหลือ {n} {u}', { n: fmtNum(r.balance), u: unit() })}`, 'ok');
    loadMember(p.memberId);
  } catch (e) {
    setBusy(btn, false);
    toast(e.code === 'NETWORK' ? e.message + tr(' (กดยืนยันอีกครั้งได้ ระบบจะไม่บันทึกซ้ำ)') : e.message, 'err');
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
    <div class="modal-head"><h2>${tr('แก้ไขข้อมูลสมาชิก')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <p class="muted small mono">${esc(m.memberId)}</p>
    <form class="form" data-form="member-edit" autocomplete="off">
      <div class="form-grid">
        <label class="field"><span>${tr('ชื่อ <em>*</em>')}</span><input name="firstName" value="${esc(m.firstName || m.name)}" maxlength="40"></label>
        <label class="field"><span>${tr('นามสกุล <em>*</em>')}</span><input name="lastName" value="${esc(m.firstName ? m.lastName : '')}" maxlength="40"></label>
        <label class="field"><span>${tr('เบอร์มือถือ <em>*</em>')}</span><input name="phone" value="${esc(m.phone || '')}" inputmode="numeric" maxlength="10" placeholder="08xxxxxxxx"></label>
        <label class="field"><span>${tr('วันเกิด <em>*</em>')}</span><input type="date" name="birthDate" value="${esc(m.birthDate || '')}" max="${todayKey()}"></label>
      </div>
      <p class="muted small">${tr('ทุกการแก้จะจดไว้ในประวัติ (ช่องที่แก้ + ชื่อคุณ) · การรับข่าวสารลูกค้าต้องเปิด-ปิดเองในหน้าข้อมูลของฉัน')}</p>
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn btn-primary" type="submit">${tr('บันทึก')}</button>
      </div>
    </form>`);
}

async function saveMemberEdit(form) {
  const m = S.member;
  const v = formValues(form, ['firstName', 'lastName', 'phone', 'birthDate']);
  v.phone = v.phone.replace(/\D/g, '');
  if (!v.firstName || !v.lastName) return toast(tr('กรุณากรอกชื่อและนามสกุล'), 'err');
  if (!/^0[689]\d{8}$/.test(v.phone)) return toast(tr('กรุณากรอกเบอร์มือถือ 10 หลัก'), 'err');
  if (!v.birthDate) return toast(tr('กรุณาเลือกวันเกิด'), 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await S.api.call('adminMemberUpdate', { memberId: m.memberId, ...v });
    closeModal();
    toast(r.changed ? tr('บันทึกข้อมูลสมาชิกแล้ว') : tr('ข้อมูลเหมือนเดิม ไม่มีอะไรเปลี่ยน'), 'ok');
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
    <div class="modal-head"><h2>${blocking ? tr('ระงับสมาชิก') : tr('เปิดใช้สมาชิกอีกครั้ง')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <p><b>${esc(m.name)}</b> <span class="muted mono">${esc(m.memberId)}</span></p>
    <form class="form" data-form="member-status" autocomplete="off">
      ${blocking ? `
        <p class="notice">${icon('alert', 18)}<span>${tr('ระงับแล้ว ลูกค้าจะสะสม{u} แลกรางวัล และใช้คูปองไม่ได้ จนกว่าจะเปิดใช้อีกครั้ง ({u2}ที่มีอยู่ไม่หาย)', { u: esc(unit()), u2: esc(unit()) })}</span></p>
        <label class="field"><span>${tr('เหตุผล <em>*</em>')}</span><input name="reason" maxlength="150" placeholder="${tr('เช่น ใช้บัญชีร่วมกันหลายคน')}"></label>`
        : `<label class="field"><span>${tr('หมายเหตุ')} <small>${tr('(ไม่บังคับ)')}</small></span><input name="reason" maxlength="150"></label>`}
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn ${blocking ? 'btn-danger' : 'btn-primary'}" type="submit">${blocking ? tr('ระงับ') : tr('เปิดใช้')}</button>
      </div>
    </form>`);
}

/* =====================================================
 * ลบข้อมูลสมาชิก (PDPA ขั้นที่ 2 — เจ้าของร้านเท่านั้น สำหรับลูกค้าที่มาขอที่ร้าน/โทรมาขอ)
 * ===================================================== */
function openMemberDelete() {
  const m = S.member;
  if (!m || !isOwner()) return;
  openModal(`
    <div class="modal-head"><h2>${tr('ลบข้อมูลสมาชิก')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <p><b>${esc(m.name)}</b> <span class="muted mono">${esc(m.memberId)}</span></p>
    <form class="form" data-form="member-delete" autocomplete="off">
      <p class="notice notice-danger">${icon('alert', 18)}<span>${tr('ลบแล้วกู้คืนไม่ได้: ชื่อ เบอร์ วันเกิด และบัญชี LINE จะถูกลบ {u}คงเหลือ {n} เป็น 0 และคูปองที่ยังไม่ใช้ถูกยกเลิก ประวัติยอดซื้อเหลือแบบไม่มีชื่อ', { u: esc(unit()), n: fmtNum(m.points) })}</span></p>
      <label class="field"><span>${tr('เหตุผล <em>*</em>')}</span><input name="reason" maxlength="150" placeholder="${tr('เช่น ลูกค้าขอลบที่หน้าร้าน')}">
        <small class="hint">${tr('ห้ามใส่ชื่อหรือเบอร์ลูกค้า (เหตุผลถูกเก็บไว้ในประวัติ)')}</small></label>
      <label class="field"><span>${tr('พิมพ์คำว่า <b>ลบ</b> เพื่อยืนยัน <em>*</em>')}</span><input name="confirm" maxlength="10"></label>
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn btn-danger" type="submit">${tr('ลบข้อมูล')}</button>
      </div>
    </form>`);
}

async function saveMemberDelete(form) {
  const m = S.member;
  const reason = form.elements.reason.value.trim();
  if (reason.length < 3) return toast(tr('กรุณาใส่เหตุผลที่ลบ'), 'err');
  const word = form.elements.confirm.value.trim();
  if (word !== 'ลบ' && !(isEn() && word.toUpperCase() === 'DELETE')) return toast(tr('กรุณาพิมพ์คำว่า "ลบ" เพื่อยืนยัน'), 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    await withRequestId('mdel|' + m.memberId, rid => S.api.call('adminMemberDelete', { memberId: m.memberId, reason, confirm: 'ลบ', requestId: rid }));
    closeModal();
    toast(tr('ลบข้อมูลสมาชิกแล้ว'), 'ok');
    resetPages();
    window.location.hash = 'members';
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

async function saveMemberStatus(form) {
  const m = S.member;
  const blocking = m.status === 'ACTIVE';
  const reason = form.elements.reason.value.trim();
  if (blocking && reason.length < 3) return toast(tr('กรุณาใส่เหตุผลที่ระงับ'), 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    await S.api.call('adminMemberStatus', { memberId: m.memberId, status: blocking ? 'BLOCKED' : 'ACTIVE', reason });
    closeModal();
    toast(blocking ? tr('ระงับสมาชิกแล้ว') : tr('เปิดใช้สมาชิกแล้ว'), 'ok');
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
  tier: { w: 1200, h: 500, ratio: 12 / 5, shape: 'แนวนอนยาว', tip: 'รูปบัตรของระดับ วางของสำคัญไว้กลางภาพ ขอบอาจถูกตัดเล็กน้อย' },
  promo: { w: 1200, h: 500, ratio: 335 / 150, shape: 'แนวนอนยาว', tip: 'วางของสำคัญไว้กลาง-ขวา ด้านซ้ายมีข้อความโปรโมชันทับ ขอบบน-ล่างอาจถูกตัด' },
  reward: { w: 1200, h: 800, ratio: 173 / 118, shape: 'แนวนอน', tip: 'วางของสำคัญไว้กลางภาพ ขอบอาจถูกตัดเล็กน้อย' },
  logo: { w: 500, h: 500, ratio: 1, shape: 'สี่เหลี่ยมจัตุรัส', tip: 'โลโก้อยู่กลางภาพ เว้นขอบนิดหน่อย' }
};
// รูปที่ถูกตัดออกเกินเท่านี้ → เตือน (เช่น รูปแนวตั้งในแบนเนอร์ ถูกตัดเกินครึ่ง) แค่เตือน ยังบันทึกได้
const CROP_WARN = 0.4;

function previewHtml(url, kind = 'reward') {
  const src = driveImage(url);
  if (!src) return `<span class="muted small">${tr('ยังไม่มีรูป')}</span>`;
  if (!/^https:\/\/[^\s"'<>]+$/i.test(src)) return `<span class="form-error small">${tr('ลิงก์ต้องขึ้นต้นด้วย https://')}</span>`;
  // กรอบทรงเดียวกับที่ลูกค้าเห็น → เจ้าของร้านรู้ทันทีว่ารูปถูกตัดตรงไหน
  return `<div class="img-frame img-frame-${esc(kind)}"><img src="${esc(src)}" alt="" referrerpolicy="no-referrer" data-kind="${esc(kind)}"></div>
    <span class="muted small img-note">${tr('ตัวอย่างนี้ตัดขอบแบบเดียวกับหน้าลูกค้า · ถ้าไม่เห็นรูป ลองอัปโหลดใหม่ หรือใช้ลิงก์รูปอื่น')}</span>
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
  const shape = r < 0.9 ? tr('แนวตั้ง') : r > 1.1 ? tr('แนวนอน') : tr('จัตุรัส');
  warn.hidden = cut < CROP_WARN;
  warn.textContent = warn.hidden ? '' : `${tr('⚠️ รูปนี้เป็น{shape} ({naturalWidth} × {naturalHeight} px) จะถูกตัดออกประมาณ {n}% ดูกรอบตัวอย่างด้านบน — แนะนำ {w} × {h} px ({shape2}) · ใช้รูปนี้ต่อก็ได้', { shape, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, n: Math.round(cut * 100), w: spec.w, h: spec.h, shape2: spec.shape })}`;
}, true);

const imageHint = 'วางลิงก์รูปที่ขึ้นต้นด้วย https://';

function periodText(start, end) {
  const d = k => fmtDayLong.format(keyDate(k));
  if (start && end) return `${d(start)} – ${d(end)}`;
  if (start) return `${tr('ตั้งแต่ {start}', { start: d(start) })}`;
  if (end) return `${tr('ถึง {end}', { end: d(end) })}`;
  return tr('ไม่จำกัด');
}

function stateChip(state) {
  return statusChip(state === 'ACTIVE' ? 'active' : `state-${state.toLowerCase()}`, tr(STATE_LABEL[state] || state));
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
  S.tierList = tierFeature() ? r.tiers || [] : [];
  S.canDelete.reward = !!r.canDelete;
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('ของรางวัล'), `${tr('ลูกค้าเห็นอยู่ {n} จาก {n2} รายการ', { n: fmtNum(r.items.filter(x => x.state === 'ACTIVE').length), n2: fmtNum(r.items.length) })}`,
      `<button class="btn btn-sm btn-primary" data-act="reward-edit" data-id="">${tr('+ เพิ่มของรางวัล')}</button>`)}
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th></th><th>${tr('ของรางวัล')}</th><th class="num">${tr('ใช้{u}', { u: esc(unit()) })}</th><th class="num">${tr('แลกแล้ว / ทั้งหมด')}</th><th class="num">${tr('ต่อคน')}</th><th>${tr('ช่วงเวลา')}</th><th>${tr('สถานะ')}</th><th></th></tr></thead>
        <tbody>${r.items.length ? r.items.map(x => `
          <tr>
            <td class="thumb-cell">${thumb(x.imageUrl)}</td>
            <td><b>${esc(x.name)}</b>${x.type === 'BIRTHDAY' ? ` <span class="chip chip-bday">${tr('🎂 ของขวัญวันเกิด')}</span>` : ''}${minTierChip(x)}${enChip(x, REWARD_EN)}${x.description ? `<div class="m-sub">${esc(x.description)}</div>` : ''}<div class="m-sub mono">${esc(x.id)}</div></td>
            <td class="num">${x.points ? fmtNum(x.points) : tr('ฟรี')}</td>
            <td class="num">${fmtNum(x.issued)} / ${x.quota ? fmtNum(x.quota) : tr('ไม่จำกัด')}</td>
            <td class="num">${x.limitPerMember ? fmtNum(x.limitPerMember) : '-'}</td>
            <td class="nowrap">${esc(periodText(x.startDate, x.endDate))}</td>
            <td>${stateChip(x.state)}</td>
            <td class="actions"><button class="btn btn-sm" data-act="reward-edit" data-id="${esc(x.id)}">${icon('edit', 16)} ${tr('แก้ไข')}</button></td>
          </tr>`).join('') : emptyRow(8, tr('ยังไม่มีของรางวัล กด "เพิ่มของรางวัล" ได้เลย'))}
        </tbody></table></div>
    </section>
    <p class="muted small">${S.canDelete.reward
      ? tr('ของรางวัลที่ไม่ใช้แล้ว กดแก้ไข → ลบ (คูปองที่ลูกค้าแลกไปแล้วยังใช้ที่ร้านได้ตามปกติ) · ถ้าแค่พักไว้ชั่วคราว เลือก "ปิด" แทน')
      : tr('ของรางวัลที่ไม่ใช้แล้วให้กดแก้ไขแล้วเลือก "ปิด" (ไม่ลบ เพราะคูปองที่ลูกค้าแลกไปแล้วยังอ้างถึงอยู่)')}</p>`;
  openPending('reward', openRewardEdit);
}

function openRewardEdit(id) {
  const x = id ? S.rewards.find(r => r.id === id) : null;
  if (id && !x) return;
  const v = x || { name: '', description: '', points: '', image: '', validDays: '', quota: '', limitPerMember: '', startDate: '', endDate: '', sort: '', status: 'ACTIVE', issued: 0, type: '' };
  const bday = v.type === 'BIRTHDAY';
  openModal(`
    <div class="modal-head"><h2>${x ? tr('แก้ไขของรางวัล') : tr('เพิ่มของรางวัล')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <form class="form" data-form="reward" data-id="${esc(x ? x.id : '')}" autocomplete="off">
      <label class="field"><span>${tr('ชื่อของรางวัล <em>*</em>')}</span><input name="name" value="${esc(v.name)}" maxlength="80" placeholder="${tr('เช่น เครื่องดื่มฟรี 1 แก้ว')}"></label>
      ${enField(tr('ชื่อของรางวัล'), 'nameEn', v.nameEn, 80)}
      <label class="field"><span>${tr('รายละเอียด')} <small>${tr('(ไม่บังคับ)')}</small></span><textarea name="description" maxlength="300" rows="2" placeholder="${tr('เช่น เลือกเครื่องดื่มเย็นที่ร่วมรายการ')}">${esc(v.description)}</textarea></label>
      ${enField(tr('รายละเอียด'), 'descriptionEn', v.descriptionEn, 300, { rows: 2 })}
      <div class="field"><span>${tr('ประเภท')}</span>
        <div class="pick-row">
          <label class="pick"><input type="radio" name="type" value="" ${bday ? '' : 'checked'}><span>${tr('แลกด้วย{u}', { u: esc(unit()) })}</span></label>
          <label class="pick"><input type="radio" name="type" value="BIRTHDAY" ${bday ? 'checked' : ''}><span>${tr('🎂 ของขวัญวันเกิด')}</span></label>
        </div>
        <small class="hint" id="bday-hint" ${bday ? '' : 'hidden'}>${tr('ลูกค้าเห็นและกดรับได้เฉพาะเดือนเกิด ปีละ 1 ครั้ง · ต้องเป็นสมาชิกอย่างน้อย 30 วัน · ระบบตรวจเดือนเกิดให้ พนักงานแค่สแกนคูปอง')}</small></div>
      <div class="form-grid">
        <label class="field"><span>${tr('ใช้กี่{u}แลก', { u: esc(unit()) })} <em id="points-req" ${bday ? 'hidden' : ''}>*</em></span><input name="points" value="${esc(bday && !v.points ? '' : v.points)}" inputmode="numeric" placeholder="${bday ? tr('ว่าง = ฟรี') : tr('เช่น 80')}"></label>
        <label class="field"><span>${tr('คูปองใช้ได้กี่วัน')}</span><input name="validDays" value="${esc(v.validDays)}" inputmode="numeric" placeholder="${bday ? tr('ว่าง = ถึงสิ้นเดือนเกิด') : `${tr('ว่าง = {n} วัน (ค่าร้าน)', { n: fmtNum(S.couponDays) })}`}"></label>
        <label class="field"><span>${tr('วันเริ่ม')}</span><input type="date" name="startDate" value="${esc(v.startDate)}"></label>
        <label class="field"><span>${tr('วันสิ้นสุด')}</span><input type="date" name="endDate" value="${esc(v.endDate)}"></label>
        <label class="field"><span>${tr('จำนวนทั้งหมด')}</span><input name="quota" value="${esc(v.quota)}" inputmode="numeric" placeholder="${tr('ว่าง = ไม่จำกัด')}">${x ? `<small>${tr('แลกไปแล้ว {n}', { n: fmtNum(x.issued) })}</small>` : ''}
          <small class="hint" id="quota-hint" ${bday ? '' : 'hidden'}>${tr('ว่าง = แจกทุกคนที่เกิดเดือนนั้น (แนะนำ) · ครบจำนวนแล้วลูกค้าคนอื่นจะไม่เห็นการ์ด')}</small></label>
        ${/* ของขวัญวันเกิดจำกัดปีละครั้งต่อคนอยู่แล้ว ช่องนี้ไม่มีผล → ซ่อน กันเจ้าของร้านสับสน */ ''}
        <label class="field" id="limit-field" ${bday ? 'hidden' : ''}><span>${tr('จำกัดต่อคน')}</span><input name="limitPerMember" value="${esc(v.limitPerMember)}" inputmode="numeric" placeholder="${tr('ว่าง = ไม่จำกัด')}"></label>
      </div>
      ${tierSelect(v.minTierId, tr('แลกได้'))}
      ${imageField(v.image, 'reward-preview')}
      <div class="form-grid">
        <label class="field"><span>${tr('ลำดับที่แสดง')}</span><input name="sort" value="${esc(v.sort)}" inputmode="numeric" placeholder="${tr('เลขน้อยขึ้นก่อน')}"></label>
        ${statusField(v.status, tr('เปิดให้ลูกค้าแลก'))}
      </div>
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn btn-primary" type="submit">${tr('บันทึก')}</button>
      </div>
      ${deleteButton('reward', x)}
    </form>`);
}

// kind = promo / reward / logo → ขนาดแนะนำ + ทรงกรอบตัวอย่าง (IMAGE_SPECS)
function imageField(value, previewId, name = 'image', label = tr('รูป'), disabled = false, kind = 'reward') {
  const spec = IMAGE_SPECS[kind] || IMAGE_SPECS.reward;
  return `
    <div class="field"><span>${esc(label)} <small>${tr('(ไม่บังคับ)')}</small></span>
      ${disabled ? '' : `<div class="img-upload">
        <label class="btn btn-sm upload-btn">${icon('upload', 16)} ${tr('อัปโหลดรูป')}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/*" data-upload="${name}" hidden></label>
        <button type="button" class="link" data-act="image-clear" data-id="${name}">${tr('ลบรูป')}</button>
      </div>
      <small class="hint img-size">${tr('ขนาดแนะนำ <b>{w} × {h} px</b> ({shape}) · {tip}', { w: spec.w, h: spec.h, shape: esc(tr(spec.shape)), tip: esc(tr(spec.tip)) })}</small>`}
      <!-- ลิงก์ของรูปที่อัปโหลดไม่ต้องโชว์ (เจ้าของร้านไม่ต้องรู้ว่ารูปเก็บที่ไหน) — ซ่อนไว้ในหัวข้อพับได้ ใช้เมื่ออยากใช้รูปจากเว็บอื่น -->
      <details class="img-link">
        <summary>${tr('ใช้ลิงก์รูปจากเว็บอื่นแทน')}</summary>
        <input name="${name}" value="${esc(value)}" placeholder="https://..." data-preview="${previewId}" aria-label="${tr('ลิงก์รูป')}" ${disabled ? 'disabled' : ''}>
        <small>${esc(tr(imageHint))}</small>
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
  if (form.dataset.form === 'broadcast') return uploadRichImage(file, form);
  showLoading(tr('กำลังเตรียมรูป...'));
  try {
    const { blob, mime } = await shrinkImage(file);
    const data = await blobToBase64(blob);
    const kind = { promo: 'promo', brand: 'logo', tiers: 'tier' }[form.dataset.form] || 'reward';
    const r = await S.api.call('adminUploadImage', { data, mime, kind });
    const target = form.elements[input.dataset.upload || 'image'];
    target.value = r.url;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    toast(tr('อัปโหลดรูปแล้ว กดบันทึกเพื่อใช้รูปนี้'), 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideLoading();
  }
}

/* ---------- รูปริชเมสเสจ (ข้อความตามกลุ่ม): LINE ต้องการรูป 5 ความกว้าง เลือกขนาดตามเครื่องลูกค้าเอง ----------
 * ย่อในเครื่องให้ครบ 5 ขนาด (เป็น JPG พื้นขาว) แล้วส่งไปพร้อมกันคำขอเดียว — ไม่ตัดรูป: สัดส่วนเกินช่วงให้เปลี่ยนรูปเอง
 * ต้องตรงกับ RICH_WIDTHS / RICH_MIN_H / RICH_MAX_H ใน api/_lib/broadcast.js */
const RICH_WIDTHS = [1040, 700, 460, 300, 240];
const RICH_FILE = 1024 * 1024;

async function uploadRichImage(file, form) {
  showLoading(tr('กำลังเตรียมรูป...'));
  try {
    const { images } = await richSizes(file);
    const r = await S.api.call('adminUploadRichImage', { images });
    form.elements.imageHeight.value = r.height;
    form.elements.image.value = r.image;
    form.elements.image.dispatchEvent(new Event('input', { bubbles: true }));
    toast(tr('ใส่รูปแล้ว'), 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    hideLoading();
  }
}

async function richSizes(file) {
  if (file.size > 30 * 1024 * 1024) throw new Error(tr('ไฟล์ใหญ่เกินไป (เกิน 30MB)'));
  let img;
  try {
    img = await decodeImage(file);
  } catch (e) {
    throw new Error(tr('เปิดไฟล์รูปนี้ไม่ได้ (เช่นไฟล์ HEIC จาก iPhone ที่โอนมาไว้ในคอม) กรุณาใช้รูป JPG หรือ PNG'));
  }
  const H = Math.round(1040 * img.height / img.width);
  try {
    if (H < 520 || H > 1560) {
      throw new Error(`${tr('รูปนี้ ({n} × {n2} px) {x} — ใช้รูปตั้งแต่แนวนอน 2:1 ถึงแนวตั้ง 2:3 (แนะนำ 1040 × 1040 px)', { n: fmtNum(img.width), n2: fmtNum(img.height), x: H < 520 ? tr('กว้างเกินไป') : tr('สูงเกินไป') })}`);
    }
    const images = {};
    let src = img;
    // ย่อทีละขั้นจากขนาดก่อนหน้า (1040 → 700 → …) รูปเล็กคมกว่าย่อจากรูปต้นฉบับใหญ่ทีเดียว
    for (const w of RICH_WIDTHS) {
      const h = Math.round(w * H / 1040);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // JPG ไม่มีพื้นใส → รูป PNG พื้นใสได้พื้นขาวแทนดำ
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      let blob = null;
      for (const q of [0.88, 0.75, 0.6]) {
        blob = await canvasBlob(canvas, 'image/jpeg', q);
        if (blob.size <= RICH_FILE) break;
      }
      if (blob.size > RICH_FILE) throw new Error(tr('รูปใหญ่เกิน 1MB แม้ย่อแล้ว ลองใช้รูปอื่น'));
      images[w] = await blobToBase64(blob);
      src = canvas;
    }
    return { images, height: H };
  } finally {
    if (img.close) img.close();
  }
}

async function shrinkImage(file, limit = MAX_UPLOAD) {
  if (file.size > 30 * 1024 * 1024) throw new Error(tr('ไฟล์ใหญ่เกินไป (เกิน 30MB)'));
  let img;
  try {
    img = await decodeImage(file);
  } catch (e) {
    throw new Error(tr('เปิดไฟล์รูปนี้ไม่ได้ (เช่นไฟล์ HEIC จาก iPhone ที่โอนมาไว้ในคอม) กรุณาใช้รูป JPG หรือ PNG'));
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
  if (blob.size > limit) {
    mime = 'image/jpeg';
    draw(true);
    blob = await canvasBlob(canvas, mime, 0.7);
  }
  if (img.close) img.close();
  if (blob.size > limit) throw new Error(tr('รูปใหญ่เกิน {n}MB แม้ย่อแล้ว ลองใช้รูปอื่น', { n: Math.round(limit / 1024 / 1024) }));
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
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error(tr('แปลงรูปไม่สำเร็จ')))), mime, quality));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error(tr('อ่านไฟล์รูปไม่สำเร็จ')));
    reader.readAsDataURL(blob);
  });
}

function statusField(value, onLabel) {
  return `<label class="field"><span>${tr('สถานะ')}</span>
    <select name="status" class="select">
      <option value="ACTIVE" ${value === 'ACTIVE' ? 'selected' : ''}>${esc(onLabel)}</option>
      <option value="INACTIVE" ${value !== 'ACTIVE' ? 'selected' : ''}>${tr('ปิด (ลูกค้าไม่เห็น)')}</option>
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
  form.elements.points.placeholder = bday ? tr('ว่าง = ฟรี') : tr('เช่น 80');
  form.elements.validDays.placeholder = bday ? tr('ว่าง = ถึงสิ้นเดือนเกิด') : `${tr('ว่าง = {n} วัน (ค่าร้าน)', { n: fmtNum(S.couponDays) })}`;
}

async function saveReward(form) {
  const reward = formValues(form, ['name', 'description', 'points', 'image', 'validDays', 'quota', 'limitPerMember', 'startDate', 'endDate', 'sort', 'status']);
  reward.id = form.dataset.id;
  reward.type = form.elements.type.value;
  Object.assign(reward, enValues(form, ['nameEn', 'descriptionEn']));
  if (form.elements.minTierId) reward.minTierId = form.elements.minTierId.value;
  if (reward.type === 'BIRTHDAY') reward.limitPerMember = ''; // ช่องถูกซ่อน ไม่ส่งค่าเก่าที่ค้างอยู่
  if (!reward.name) return toast(tr('กรุณากรอกชื่อของรางวัล'), 'err');
  if (!reward.points && reward.type !== 'BIRTHDAY') return toast(`${tr('กรุณากรอกจำนวน{u}ที่ใช้แลก', { u: unit() })}`, 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await withRequestId('reward|' + JSON.stringify(reward), rid => S.api.call('adminRewardSave', { reward, requestId: rid }));
    closeModal();
    toast(`${tr('{x} "{name}" แล้ว · {x2}', { x: r.created ? tr('เพิ่ม') : tr('บันทึก'), name: r.reward.name, x2: tr(STATE_LABEL[r.reward.state] || '') })}`, 'ok');
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
  S.tierList = tierFeature() ? r.tiers || [] : [];
  S.canDelete.promo = !!r.canDelete;
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('โปรโมชัน'), `${tr('แบนเนอร์หน้าแรกของลูกค้า · แสดงอยู่ {n} จาก {n2} รายการ', { n: fmtNum(r.items.filter(x => x.state === 'ACTIVE').length), n2: fmtNum(r.items.length) })}`,
      `<button class="btn btn-sm btn-primary" data-act="promo-edit" data-id="">${tr('+ เพิ่มโปรโมชัน')}</button>`)}
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th></th><th>${tr('โปรโมชัน')}</th><th>${tr('ป้าย')}</th><th>${tr('ลิงก์')}</th><th>${tr('ช่วงเวลา')}</th><th>${tr('สถานะ')}</th><th></th></tr></thead>
        <tbody>${r.items.length ? r.items.map(x => `
          <tr>
            <td class="thumb-cell">${thumb(x.imageUrl, true)}</td>
            <td><b>${esc(x.title)}</b>${minTierChip(x)}${enChip(x, PROMO_EN)}${x.subtitle ? `<div class="m-sub">${esc(x.subtitle)}</div>` : ''}</td>
            <td>${x.tag ? `<span class="chip">${esc(x.tag)}</span>` : '-'}</td>
            <td class="link-cell">${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.link.replace(/^https:\/\//, ''))}</a>` : '-'}</td>
            <td class="nowrap">${esc(periodText(x.startDate, x.endDate))}</td>
            <td>${stateChip(x.state)}</td>
            <td class="actions"><button class="btn btn-sm" data-act="promo-edit" data-id="${esc(x.id)}">${icon('edit', 16)} ${tr('แก้ไข')}</button></td>
          </tr>`).join('') : emptyRow(7, tr('ยังไม่มีโปรโมชัน'))}
        </tbody></table></div>
    </section>`;
  openPending('promo', openPromoEdit);
}

function openPromoEdit(id) {
  const x = id ? S.promos.find(r => r.id === id) : null;
  if (id && !x) return;
  const v = x || { title: '', subtitle: '', tag: '', image: '', link: '', startDate: '', endDate: '', sort: '', status: 'ACTIVE' };
  openModal(`
    <div class="modal-head"><h2>${x ? tr('แก้ไขโปรโมชัน') : tr('เพิ่มโปรโมชัน')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <form class="form" data-form="promo" data-id="${esc(x ? x.id : '')}" autocomplete="off">
      <label class="field"><span>${tr('หัวข้อ <em>*</em>')}</span><input name="title" value="${esc(v.title)}" maxlength="80" placeholder="${tr('เช่น แต้ม x2 ทุกวันพุธ')}"></label>
      ${enField(tr('หัวข้อ'), 'titleEn', v.titleEn, 80)}
      <label class="field"><span>${tr('ข้อความรอง')} <small>${tr('(ไม่บังคับ)')}</small></span><input name="subtitle" value="${esc(v.subtitle)}" maxlength="150"></label>
      ${enField(tr('ข้อความรอง'), 'subtitleEn', v.subtitleEn, 150)}
      <label class="field"><span>${tr('ป้ายเล็ก')} <small>${tr('(ไม่บังคับ)')}</small></span><input name="tag" value="${esc(v.tag)}" maxlength="30" placeholder="${tr('เช่น โปรประจำเดือน')}"></label>
      ${enField(tr('ป้ายเล็ก'), 'tagEn', v.tagEn, 30)}
      <div class="form-grid">
        <label class="field"><span>${tr('ลิงก์เมื่อกด')} <small>${tr('(ไม่บังคับ)')}</small></span><input name="link" value="${esc(v.link)}" placeholder="https://..."></label>
        <label class="field"><span>${tr('วันเริ่ม')}</span><input type="date" name="startDate" value="${esc(v.startDate)}"></label>
        <label class="field"><span>${tr('วันสิ้นสุด')}</span><input type="date" name="endDate" value="${esc(v.endDate)}"></label>
      </div>
      ${tierSelect(v.minTierId, tr('เห็นสิทธิ์'))}
      ${imageField(v.image, 'promo-preview', 'image', tr('รูป'), false, 'promo')}
      <div class="form-grid">
        <label class="field"><span>${tr('ลำดับที่แสดง')}</span><input name="sort" value="${esc(v.sort)}" inputmode="numeric" placeholder="${tr('เลขน้อยขึ้นก่อน')}"></label>
        ${statusField(v.status, tr('แสดงให้ลูกค้าเห็น'))}
      </div>
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn btn-primary" type="submit">${tr('บันทึก')}</button>
      </div>
      ${deleteButton('promo', x)}
    </form>`);
}

async function savePromo(form) {
  const promo = formValues(form, ['title', 'subtitle', 'tag', 'image', 'link', 'startDate', 'endDate', 'sort', 'status']);
  promo.id = form.dataset.id;
  Object.assign(promo, enValues(form, ['titleEn', 'subtitleEn', 'tagEn']));
  if (form.elements.minTierId) promo.minTierId = form.elements.minTierId.value;
  if (!promo.title) return toast(tr('กรุณากรอกหัวข้อ'), 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await withRequestId('promo|' + JSON.stringify(promo), rid => S.api.call('adminPromoSave', { promo, requestId: rid }));
    closeModal();
    toast(`${tr('{x} "{title}" แล้ว · {x2}', { x: r.created ? tr('เพิ่ม') : tr('บันทึก'), title: r.promo.title, x2: tr(STATE_LABEL[r.promo.state] || '') })}`, 'ok');
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

const daysHtml = on => `<div class="days">${DAYS.map(([k, t]) => `<span class="${on.includes(k) ? 'on' : ''}" title="${tr(t + '@@วัน')}">${tr(t + '@@วัน')}</span>`).join('')}</div>`;

function renderRules(r) {
  S.rules = r.items;
  S.tierList = tierFeature() ? r.tiers || [] : [];
  S.canDelete.rule = !!r.canDelete;
  const owner = isOwner();
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('แต้มพิเศษ'), tr('กติกาให้แต้มเพิ่ม ระบบคิดให้เองตอนพนักงานบันทึกยอด · ตรงหลายกติกาพร้อมกัน ใช้อันที่ให้แต้มมากสุดอันเดียว'),
      owner ? `<button class="btn btn-sm btn-primary" data-act="rule-edit" data-id="">${tr('+ เพิ่มกติกา')}</button>` : '')}
    <section class="card adm-card flush"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${tr('กติกา')}</th><th>${tr('ได้แต้ม')}</th><th>${tr('วัน')}</th><th>${tr('ช่วงวันที่')}</th>${hasBranches() ? `<th>${tr('สาขา')}</th>` : ''}<th class="num">${tr('ยอดขั้นต่ำ')}</th><th>${tr('สถานะ')}</th><th></th></tr></thead>
      <tbody>${r.items.length ? r.items.map(x => `
        <tr>
          <td><b>${esc(x.name)}</b>${minTierChip(x)}${x.showBadge ? `<div class="m-sub">${tr('แสดงป้ายที่หน้าลูกค้า')}</div>` : ''}</td>
          <td><span class="mult">×${x.multiplier}</span></td>
          <td>${daysHtml(x.days)}</td>
          <td class="nowrap">${esc(periodText(x.startDate, x.endDate))}</td>
          ${hasBranches() ? `<td>${x.branch ? esc(branchName(x.branch)) : tr('ทุกสาขา')}</td>` : ''}
          <td class="num">${x.minAmount ? '฿' + fmtMoney(x.minAmount) : '-'}</td>
          <td>${statusChip(...(RULE_STATE[x.state] || ['inactive', x.state]).map((v, i) => (i === 1 ? tr(v) : v)))}</td>
          <td class="actions">${owner ? `<button class="btn btn-sm" data-act="rule-edit" data-id="${esc(x.id)}">${icon('edit', 16)} ${tr('แก้ไข')}</button>` : ''}</td>
        </tr>`).join('') : emptyRow(8, owner ? tr('ยังไม่มีกติกา กด "เพิ่มกติกา" เช่น แต้ม x2 ทุกวันพุธ') : tr('ยังไม่มีกติกา'))}
      </tbody></table></div></section>
    <p class="muted small">${tr('ตัวอย่าง: บิลที่ปกติได้ 20 {u} วันที่มีกติกา ×2 จะได้ 40 (คูณจาก{u2}ปกติแล้วปัดเศษลง) · กติกาที่ไม่ใช้แล้ว กดแก้ไข{x}{x2}', { u: esc(unit()), u2: esc(unit()), x: S.canDelete.rule ? tr(' → ลบ (แต้มที่ลูกค้าได้ไปแล้วไม่เปลี่ยน)') : tr('แล้วเลือก "ปิด"'), x2: owner ? '' : tr(' · เจ้าของร้านเป็นคนตั้งกติกา') })}</p>`;
  openPending('rule', openRuleEdit);
}

function openRuleEdit(id) {
  if (!isOwner()) return;
  const x = id ? S.rules.find(r => r.id === id) : null;
  if (id && !x) return;
  // กติกาใหม่ยังไม่เลือกวัน ให้เจ้าของร้านเลือกเอง (ผู้ใช้ขอ 4 พ.ย. 2569 — กันเผลอได้แต้มพิเศษทุกวัน)
  const v = x || { name: '', multiplier: 2, days: [], startDate: '', endDate: '', branch: '', minAmount: '', showBadge: true, status: 'ACTIVE' };
  openModal(`
    <div class="modal-head"><h2>${x ? tr('แก้ไขกติกาแต้มพิเศษ') : tr('เพิ่มกติกาแต้มพิเศษ')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <form class="form" data-form="rule" data-id="${esc(x ? x.id : '')}" autocomplete="off">
      <label class="field"><span>${tr('ชื่อกติกา <em>*</em>')} <small>${tr('(ลูกค้าเห็นในประวัติ{u})', { u: esc(unit()) })}</small></span><input name="name" value="${esc(v.name)}" maxlength="60" placeholder="${tr('เช่น แต้ม x2 ทุกวันพุธ')}"></label>
      ${enField(tr('ชื่อกติกา'), 'nameEn', v.nameEn, 60, { hint: tr('(ลูกค้าเห็นในป้ายแต้มพิเศษ)') })}
      <div class="field"><span>${tr('ได้{u}กี่เท่า', { u: esc(unit()) })}</span>
        <div class="pick-row">${MULTS.map(m => `<label class="pick"><input type="radio" name="multiplier" value="${m}" ${Number(v.multiplier) === m ? 'checked' : ''}><span>×${m}</span></label>`).join('')}</div></div>
      <div class="field"><span>${tr('วันที่มีผล')}</span>
        <div class="day-picks">${DAYS.map(([k, t]) => `<label><input type="checkbox" name="days" value="${k}" ${v.days.includes(k) ? 'checked' : ''}><span>${tr(t + '@@วัน')}</span></label>`).join('')}</div></div>
      <div class="form-grid">
        <label class="field"><span>${tr('วันเริ่ม')}</span><input type="date" name="startDate" value="${esc(v.startDate)}"></label>
        <label class="field"><span>${tr('วันสิ้นสุด')}</span><input type="date" name="endDate" value="${esc(v.endDate)}"></label>
        <label class="field"><span>${tr('ยอดขั้นต่ำต่อบิล (บาท)')}</span><input name="minAmount" value="${esc(v.minAmount || '')}" inputmode="decimal" placeholder="${tr('ว่าง = ทุกบิล')}"></label>
        ${hasBranches() ? `<label class="field"><span>${tr('สาขา')}</span><select name="branch" class="select"><option value="">${tr('ทุกสาขา')}</option>${S.branches.filter(b => b.status === 'ACTIVE' || b.id === v.branch).map(b => `<option value="${esc(b.id)}" ${b.id === v.branch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>` : ''}
      </div>
      ${tierSelect(v.minTierId, tr('ได้แต้มพิเศษ'))}
      <label class="check"><input type="checkbox" name="showBadge" ${v.showBadge ? 'checked' : ''}><span>${tr('แสดงป้าย "วันนี้ …" ที่หน้าลูกค้า เฉพาะวันที่มีผล')}</span></label>
      ${statusField(v.status, tr('เปิดใช้'))}
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn btn-primary" type="submit">${tr('บันทึก')}</button>
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
    branch: f.branch ? f.branch.value : '', showBadge: f.showBadge.checked, status: f.status.value,
    ...enValues(form, ['nameEn'])
  };
  if (f.minTierId) rule.minTierId = f.minTierId.value;
  if (!rule.name) return toast(tr('กรุณากรอกชื่อกติกา'), 'err');
  if (!rule.days.length) return toast(tr('เลือกวันที่มีผลอย่างน้อย 1 วัน'), 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await withRequestId('rule|' + JSON.stringify(rule), rid => S.api.call('adminRuleSave', { rule, requestId: rid }));
    closeModal();
    toast(`${tr('{x} "{name}" แล้ว · {x2}', { x: r.created ? tr('เพิ่ม') : tr('บันทึก'), name: r.rule.name, x2: tr((RULE_STATE[r.rule.state] || [])[1] || '') })}`, 'ok');
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
  reward: { action: 'adminRewardDelete', label: 'ของรางวัล@@รายการ', list: () => S.rewards, name: x => x.name, after: 'คูปองที่ลูกค้าแลกไปแล้วยังใช้ที่ร้านได้ตามปกติ', reload: () => loadRewards() },
  promo: { action: 'adminPromoDelete', label: 'โปรโมชัน@@รายการ', list: () => S.promos, name: x => x.title, after: 'ลูกค้าจะไม่เห็นแบนเนอร์นี้อีก', reload: () => loadPromos() },
  rule: { action: 'adminRuleDelete', label: 'กติกาแต้มพิเศษ@@รายการ', list: () => S.rules, name: x => x.name, after: 'บิลถัดไปจะไม่ได้แต้มพิเศษจากกติกานี้ · แต้มที่ลูกค้าได้ไปแล้วไม่เปลี่ยน', reload: () => loadRules() }
};

function deleteButton(kind, x) {
  if (!x || !S.canDelete[kind]) return '';
  return `<div class="modal-delete"><button type="button" class="link link-danger" data-act="item-delete" data-kind="${kind}" data-id="${esc(x.id)}">${icon('x', 14)} ${tr('ลบ{label}นี้', { label: esc(tr(DELETE_KIND[kind].label)) })}</button></div>`;
}

function confirmDelete(kind, id) {
  const k = DELETE_KIND[kind];
  const x = k && (k.list() || []).find(r => r.id === id);
  if (!x) return;
  openModal(`
    <div class="modal-head"><h2>${tr('ลบ{label}?', { label: esc(tr(k.label)) })}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <p><b>${esc(k.name(x))}</b></p>
    <ul class="muted small">
      <li>${tr('หายจากหลังบ้านและหน้าลูกค้าทันที')}</li>
      <li>${esc(tr(k.after))}</li>
      <li>${tr('ลบแล้วกู้คืนเองไม่ได้ (ถ้าแค่พักไว้ ให้กดแก้ไขแล้วเลือก "ปิด" แทน)')}</li>
    </ul>
    <div class="modal-actions">
      <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
      <button class="btn btn-danger" type="button" data-act="item-delete-confirm" data-kind="${kind}" data-id="${esc(id)}">${tr('ลบ')}</button>
    </div>`);
}

async function doDelete(kind, id, btn) {
  const k = DELETE_KIND[kind];
  if (!k) return;
  setBusy(btn, true);
  try {
    const r = await withRequestId('delete|' + kind + '|' + id, rid => S.api.call(k.action, { id, requestId: rid }));
    closeModal();
    toast(`${tr('ลบ "{name}" แล้ว', { name: r.name })}`, 'ok');
    k.reload();
  } catch (e) {
    setBusy(btn, false);
    toast(e.message, 'err');
  }
}

/* =====================================================
 * ระดับสมาชิก (ขั้น 4 — มีเฉพาะระบบใหม่ + ร้านที่เปิดแพ็กเกจ features.tiers)
 * ระดับคิดจากแต้มจากการซื้อ 12 เดือนล่าสุด (7 พ.ย. 2569) / ขึ้นทันที / คงระดับ 12 เดือน แล้วลดทีละ 1 ถ้าแต้มไม่ถึง
 * แต่ละระดับมีรูปบัตร (ไม่บังคับ) + สิทธิพิเศษที่ร้านเขียนเอง → แสดงในหน้าสิทธิ์สมาชิกของลูกค้า
 * เจ้าของร้านตั้งได้ ผู้จัดการดูอย่างเดียว (หลังบ้านตรวจซ้ำ)
 * ===================================================== */
// ป้าย "ระดับ X ขึ้นไป" ในตารางของรางวัล / โปรโมชัน / แต้มพิเศษ
function minTierChip(x) {
  if (!x.minTierName) return '';
  const t = (S.tierList || []).find(t => t.id === x.minTierId) || {};
  return ` <span class="chip chip-tier">${tr('{color}{minTierName} ขึ้นไป', { color: tierDot(t.color), minTierName: esc(x.minTierName) })}</span>`;
}

// ช่องเลือกระดับขั้นต่ำในฟอร์ม — ร้านที่ไม่ได้ใช้ระดับไม่มีช่องนี้ (บันทึกแล้วจึงไม่ส่ง minTierId = ไม่แก้ค่าเดิม)
function tierSelect(cur, verb) {
  const list = S.tierList || [];
  if (list.length < 2) return '';
  return `<label class="field"><span>${tr('สมาชิกที่{verb}', { verb: esc(verb) })}</span>
    <select name="minTierId" class="select">
      <option value="">${tr('ทุกระดับ')}</option>
      ${list.slice(1).map(t => `<option value="${esc(t.id)}" ${t.id === cur ? 'selected' : ''}>${tr('ระดับ {name} ขึ้นไป', { name: esc(t.name) })}</option>`).join('')}
    </select>
    <small class="muted">${tr('ลูกค้าที่ระดับไม่ถึง จะเห็นแต่ใช้สิทธิ์ไม่ได้ (มีป้ายบอกว่าต้องถึงระดับไหน)')}</small></label>`;
}

function loadTierPage() {
  fetchView('adminTiers', {}, renderTierPage);
}

const bahtFor = pts => (S.tierPage && Number(pts) > 0 ? `${tr('≈ ยอดซื้อ ฿{n}', { n: fmtMoney(Number(pts) * S.tierPage.pointRate) })}` : '');
// ตัวอย่างบัตรแบบที่ลูกค้าเห็นเมื่อไม่ใส่รูป (วาดจากสีของระดับ)
const autoBanner = t => (t.image ? '' : `<small class="muted">${tr('ไม่ใส่รูป ลูกค้าจะเห็นบัตรแบบนี้')}</small>
  ${tierBanner({ name: t.name || tr('ชื่อระดับ'), color: t.color, multiplier: Number(t.multiplier) || 1 }, { logo: logoHtml(), shopName: cfg().name, unit: unit() })}`);

function renderTierPage(r) {
  S.tierPage = r;
  S.tierDraft = r.enabled ? r.items.map(t => ({ ...t, benefits: (t.benefits || []).join('\n'), benefitsEn: (t.benefitsEn || []).join('\n') })) : null;
  S.tierIntroDraft = r.intro || '';
  S.tierIntroEnDraft = r.introEn || '';
  const owner = isOwner();
  const u = esc(unit());
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('ระดับสมาชิก'), `${tr('ระดับคิดจาก{u}ที่ได้จากการซื้อ {n} เดือนล่าสุด · ถึงเกณฑ์ขึ้นทันที แล้วคงระดับ {n2} เดือน · ครบกำหนดแล้วไม่ถึง ลดลง 1 ระดับ', { u, n: fmtNum(r.keepMonths), n2: fmtNum(r.keepMonths) })}`,
      owner && r.enabled ? `<button class="btn btn-sm btn-danger-outline" data-act="tiers-off">${tr('ปิดใช้ระดับสมาชิก')}</button>` : '')}
    <div id="tier-edit">${tierEditHtml()}</div>
    <section class="card adm-card">
      <div class="card-head"><h2>${tr('กติกา')}</h2></div>
      <ul class="muted small tier-rules">
        <li>${tr('นับเฉพาะ{u}ปกติจากบิลซื้อ (ตอนนี้ {n} บาท = 1 {u2}) — ไม่นับ{u3}พิเศษ ตัวคูณของระดับ {u4}ต้อนรับ และ{u5}ที่ร้านปรับให้ · ลูกค้าแลกของรางวัลแล้วไม่ลด', { u, n: fmtMoney(r.pointRate), u2: u, u3: u, u4: u, u5: u })}</li>
        <li>${tr('เปลี่ยนอัตรา{u}ภายหลัง: บิลเก่านับตามอัตราเดิม บิลใหม่นับตามอัตราใหม่', { u })}</li>
        <li>${tr('สมาชิกทุกคนอย่างน้อยอยู่ระดับแรก (เริ่มที่ 0 {u}) ระดับแรกไม่มีวันหมดอายุ', { u })}</li>
        <li>${tr('ตัวคูณ{u}ของระดับ ไม่ซ้อนกับ{u2}พิเศษ ระบบใช้ตัวที่ให้มากกว่า', { u, u2: u })}</li>
        <li>${tr('ของรางวัล / โปรโมชัน / {u}พิเศษ ตั้ง "ระดับ X ขึ้นไป" ได้ในหน้าแก้ไขของแต่ละรายการ (หน้าสิทธิ์สมาชิกของลูกค้าแสดงให้เอง)', { u })}</li>
        <li>${tr('ของขวัญวันเกิด: ลูกค้าได้ชิ้นของระดับสูงสุดที่ตัวเองถึง')}</li>
        <li>${tr('เพิ่มเกณฑ์: สมาชิกเดิมไม่ลดทันที คงระดับจนครบกำหนด · ลดเกณฑ์: คนที่ถึงแล้วขึ้นทันที')}</li>
      </ul>
    </section>`;
  // มาจากการ์ดภาษาอังกฤษในหน้าภาพรวม → ไปที่ช่องภาษาอังกฤษของระดับนั้น
  openPending(['tier', 'tierIntro'], (id, kind) => focusField(kind === 'tierIntro' ? '[name="introEn"]' : `.tier-edit[data-tid="${id}"] [name="nameEn"]`));
}

// ส่วนตั้งระดับ: ยังไม่เปิดใช้ → ปุ่มเริ่ม / เจ้าของร้าน → ฟอร์มแก้ / ผู้จัดการ → ตาราง
function tierEditHtml() {
  const r = S.tierPage;
  const owner = isOwner();
  const d = S.tierDraft;
  const u = esc(unit());
  if (!d) {
    return `<section class="card adm-card tier-intro">
      <h2>${tr('ร้านยังไม่ได้เปิดใช้ระดับสมาชิก')}</h2>
      <p class="muted">${tr('แบ่งลูกค้าเป็น {n}–{n2} ระดับตาม{u}ที่สะสมจากการซื้อ เช่น Member / Silver / Gold ให้ลูกค้าประจำได้{u2}มากขึ้นและสิทธิ์พิเศษ', { n: fmtNum(r.minTiers), n2: fmtNum(r.maxTiers), u, u2: u })}</p>
      ${owner ? `<button class="btn btn-primary" data-act="tier-add" data-id="start">${tr('เริ่มตั้งระดับสมาชิก')}</button>` : `<p class="muted small">${tr('เจ้าของร้านเป็นคนตั้งระดับ')}</p>`}
    </section>`;
  }
  if (!owner) {
    return `<section class="card adm-card flush"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${tr('ระดับ')}</th><th class="num">${tr('{u}จากการซื้อ {n} เดือน ตั้งแต่', { u, n: fmtNum(r.keepMonths) })}</th><th>${tr('ได้{u}', { u })}</th><th>${tr('สิทธิพิเศษเพิ่มเติม')}</th><th class="num">${tr('สมาชิก')}</th></tr></thead>
      <tbody>${d.map(t => `<tr>
        <td><b>${tierDot(t.color)}${esc(t.name)}</b>${englishFeature() && t.nameEn ? `<div class="m-sub">${esc(t.nameEn)}</div>` : ''}</td>
        <td class="num">${fmtNum(t.minPoints)} ${u}${t.minPoints ? `<div class="m-sub">${esc(bahtFor(t.minPoints))}</div>` : ''}</td>
        <td>${t.multiplier > 1 ? `<span class="mult">×${t.multiplier}</span>` : tr('ปกติ')}</td>
        <td class="small">${t.benefits ? esc(t.benefits).replace(/\n/g, '<br>') : '-'}</td>
        <td class="num"><a class="link" href="#members" data-act="tier-filter" data-id="${esc(t.id)}">${tr('{n} คน', { n: fmtNum(t.members) })}</a></td>
      </tr>`).join('')}</tbody></table></div></section>
      <p class="muted small">${tr('เจ้าของร้านเป็นคนตั้งระดับ')}</p>`;
  }
  return `<section class="card adm-card">
    <form class="form" data-form="tiers" autocomplete="off">
      <label class="field"><span>${tr('ข้อความหัวหน้าสิทธิ์สมาชิก')} <small>${tr('(ใช้ทั้งร้าน · ว่าง = ใช้ข้อความตั้งต้น)')}</small></span>
        <textarea name="intro" rows="2" maxlength="200" placeholder="สมัครสมาชิกฟรี สะสม${esc((cfg().texts && cfg().texts.pointUnit) || 'แต้ม')}ทุกบิล&#10;ยิ่งสะสมมาก ยิ่งได้สิทธิ์มาก">${esc(S.tierIntroDraft)}</textarea></label>
      ${enField(tr('ข้อความหัวหน้าสิทธิ์สมาชิก'), 'introEn', S.tierIntroEnDraft, 200, { rows: 2, placeholder: tr('ว่าง = ใช้ข้อความภาษาไทยของร้าน (ถ้าไม่ได้เขียน = ข้อความตั้งต้นภาษาอังกฤษ)') })}
      <div class="tier-edit-list">${d.map((t, i) => `
        <div class="tier-edit" data-row="${i}" data-tid="${esc(t.id || '')}">
          <div class="tier-edit-main">
            <label class="field tier-f-color"><span>${tr('สี')}</span><input type="color" name="color" value="${esc(HEX.test(t.color || '') ? t.color : '#9CA3AF')}"></label>
            <label class="field tier-f-name"><span>${tr('ชื่อระดับ')}</span><input name="name" value="${esc(t.name)}" maxlength="30" placeholder="${tr('เช่น Gold')}"></label>
            <label class="field tier-f-spend"><span>${tr('{u}จากการซื้อ {n} เดือน ตั้งแต่', { u, n: fmtNum(r.keepMonths) })}</span>
              ${i === 0 ? `<input name="minPoints" value="0" readonly title="${tr('ระดับแรกเริ่มที่ 0 {u}เสมอ', { u })}">` : `<input name="minPoints" value="${esc(t.minPoints === '' ? '' : String(t.minPoints))}" inputmode="numeric" placeholder="${tr('เช่น 250')}">`}
              <small class="muted tier-baht">${esc(i === 0 ? tr('สมาชิกทุกคน') : bahtFor(t.minPoints))}</small></label>
            <label class="field tier-f-mult"><span>${tr('ได้{u}', { u })}</span><select name="multiplier" class="select">${r.multipliers.map(m => `<option value="${m}" ${Number(t.multiplier) === m ? 'selected' : ''}>${m === 1 ? tr('ปกติ') : '×' + m}</option>`).join('')}</select></label>
            <div class="tier-f-end">
              ${t.id ? `<a class="link small" href="#members" data-act="tier-filter" data-id="${esc(t.id)}">${tr('{n} คน', { n: fmtNum(t.members || 0) })}</a>` : `<span class="muted small">${tr('ใหม่')}</span>`}
              ${i > 0 && d.length > r.minTiers ? `<button type="button" class="icon-btn" data-act="tier-remove" data-id="${i}" aria-label="${tr('เอาระดับนี้ออก')}">${icon('x', 16)}</button>` : ''}
            </div>
          </div>
          <details class="tier-more" open>
            <summary>${tr('รูปบัตร{x} (หน้าสิทธิ์สมาชิกของลูกค้า)', { x: englishFeature() ? tr(' สิทธิพิเศษ และภาษาอังกฤษ') : tr(' และสิทธิพิเศษ') })}</summary>
            <div class="tier-more-grid">
              <div class="tier-card-col">
                <div class="tier-auto">${autoBanner(t)}</div>
                ${imageField(t.image || '', 'tier-img-' + i, 'image-' + i, tr('รูปบัตร'), false, 'tier')}
              </div>
              <div class="tier-text-col">
              ${enField(tr('ชื่อระดับ'), 'nameEn', t.nameEn, 30, { placeholder: tr('ว่าง = ใช้ชื่อไทย (ชื่อที่เป็นภาษาอังกฤษอยู่แล้ว ไม่ต้องกรอก)') })}
              <label class="field"><span>${tr('สิทธิพิเศษเพิ่มเติม')} <small>${tr('(บรรทัดละ 1 ข้อ ไม่เกิน {n} ข้อ — ตัวคูณ{u} ของรางวัล และโปรโมชันเฉพาะระดับ ระบบใส่ให้เอง)', { n: fmtNum(r.maxBenefits || 8), u })}</small></span>
                <textarea name="benefits" rows="5" placeholder="${tr('เช่น คูปองส่วนลดวันเกิด 15%&#10;สิทธิ์ทดลองเมนูใหม่ก่อนใคร')}">${esc(t.benefits || '')}</textarea></label>
              ${enField(tr('สิทธิพิเศษเพิ่มเติม'), 'benefitsEn', t.benefitsEn, 1000, { rows: 5, hint: tr('(บรรทัดละ 1 ข้อ)'), placeholder: tr('ว่าง = ลูกค้าที่เลือกภาษาอังกฤษเห็นสิทธิพิเศษภาษาไทย') })}
              </div>
            </div>
          </details>
        </div>`).join('')}
      </div>
      ${d.length < r.maxTiers ? `<button type="button" class="btn btn-sm" data-act="tier-add">${tr('+ เพิ่มระดับ')}</button>` : `<p class="muted small">${tr('ตั้งได้สูงสุด {n} ระดับ', { n: fmtNum(r.maxTiers) })}</p>`}
      <div class="modal-actions">
        <button type="button" class="btn" data-act="refresh">${r.enabled ? tr('ยกเลิกที่แก้') : tr('ยกเลิก')}</button>
        <button class="btn btn-primary" type="submit">${r.enabled ? tr('บันทึก') : tr('เปิดใช้ระดับสมาชิก')}</button>
      </div>
    </form>
  </section>`;
}

// อ่านค่าที่พิมพ์ไว้ก่อนเพิ่ม/ลบแถว (ไม่งั้นที่พิมพ์ไว้หาย)
function readTierRow(row) {
  const val = sel => { const el = row.querySelector(sel); return el ? el.value : ''; };
  const o = { name: val('[name="name"]').trim(), minPoints: val('[name="minPoints"]').replace(/[,\s]/g, ''), multiplier: Number(val('[name="multiplier"]')),
    color: val('[name="color"]').toUpperCase(), image: val('[name^="image-"]').trim(), benefits: val('[name="benefits"]') };
  // ช่องภาษาอังกฤษมีเฉพาะร้านที่เปิดภาษาอังกฤษ (ไม่มีช่อง = ไม่แตะค่าเดิมใน draft)
  if (row.querySelector('[name="nameEn"]')) Object.assign(o, { nameEn: val('[name="nameEn"]').trim(), benefitsEn: val('[name="benefitsEn"]') });
  return o;
}

function readTierForm() {
  const form = document.querySelector('[data-form="tiers"]');
  if (!form || !S.tierDraft) return;
  S.tierIntroDraft = form.elements.intro ? form.elements.intro.value : S.tierIntroDraft;
  if (form.elements.introEn) S.tierIntroEnDraft = form.elements.introEn.value;
  form.querySelectorAll('.tier-edit').forEach(row => {
    const t = S.tierDraft[Number(row.dataset.row)];
    if (t) Object.assign(t, readTierRow(row));
  });
}

// พิมพ์ในฟอร์มระดับ → อัปเดตตัวอย่างบัตร + ยอดซื้อโดยประมาณ ทันที
function onTierInput(el) {
  const row = el.closest('.tier-edit');
  if (!row) return;
  const t = readTierRow(row);
  const auto = row.querySelector('.tier-auto');
  if (auto && !el.matches('[name="benefits"], [name="benefitsEn"], [name="nameEn"]')) auto.innerHTML = autoBanner(t);
  const baht = row.querySelector('.tier-baht');
  if (baht && el.matches('[name="minPoints"]')) baht.textContent = bahtFor(t.minPoints);
}

function redrawTierEdit() {
  const box = document.getElementById('tier-edit');
  if (box) box.innerHTML = tierEditHtml();
}

function tierAdd() {
  if (!isOwner() || !S.tierPage) return;
  if (!S.tierDraft) {
    // เริ่มครั้งแรก: ใส่ตัวอย่าง 3 ระดับให้แก้ต่อ (ยังไม่บันทึกจนกดปุ่ม)
    S.tierDraft = tierDefaults(S.tierPage.pointRate);
    return redrawTierEdit();
  }
  readTierForm();
  if (S.tierDraft.length >= S.tierPage.maxTiers) return;
  const last = S.tierDraft[S.tierDraft.length - 1];
  S.tierDraft.push({ id: '', name: '', minPoints: '', multiplier: Math.min(3, Number(last.multiplier) || 1), color: '#6B7280', image: '', benefits: '', members: 0, nameEn: '', benefitsEn: '' });
  redrawTierEdit();
}

function tierRemove(i) {
  if (!S.tierDraft || i <= 0) return;
  readTierForm();
  S.tierDraft.splice(i, 1);
  redrawTierEdit();
}

// ตรวจก่อนส่ง (หลังบ้านตรวจซ้ำทุกข้อ) แล้วสรุปผลให้ยืนยัน
function confirmTiers(form) {
  readTierForm();
  const d = S.tierDraft || [];
  const r = S.tierPage;
  const u = esc(unit());
  for (const t of d) {
    if (!t.name) return toast(tr('กรุณาใส่ชื่อทุกระดับ'), 'err');
    if (!/^\d+$/.test(String(t.minPoints))) return toast(`${tr('ใส่{u}ของระดับ "{name}" เป็นจำนวนเต็ม', { u: unit(), name: t.name })}`, 'err');
    if (String(t.benefits || '').split('\n').filter(x => x.trim()).length > (r.maxBenefits || 8)) return toast(`${tr('สิทธิพิเศษของระดับ "{name}" ใส่ได้ไม่เกิน {x} ข้อ', { name: t.name, x: r.maxBenefits || 8 })}`, 'err');
    if (String(t.benefitsEn || '').split('\n').filter(x => x.trim()).length > (r.maxBenefits || 8)) return toast(`${tr('สิทธิพิเศษภาษาอังกฤษของระดับ "{name}" ใส่ได้ไม่เกิน {x} ข้อ', { name: t.name, x: r.maxBenefits || 8 })}`, 'err');
  }
  const en = englishFeature();
  const rows = d.map(t => ({ id: t.id || '', name: t.name, minPoints: Number(t.minPoints), multiplier: Number(t.multiplier), color: t.color,
    image: t.image || '', benefits: t.benefits || '', ...(en ? { nameEn: t.nameEn || '', benefitsEn: t.benefitsEn || '' } : {}) })).sort((a, b) => a.minPoints - b.minPoints);
  if (rows[0].minPoints !== 0) return toast(`${tr('ระดับแรกต้องเริ่มที่ 0 {u}', { u: unit() })}`, 'err');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].minPoints === rows[i - 1].minPoints) return toast(`${tr('แต่ละระดับต้องใช้{u}ไม่ซ้ำกัน', { u: unit() })}`, 'err');
  }
  if (new Set(rows.map(t => t.name.toLowerCase())).size !== rows.length) return toast(tr('ชื่อระดับซ้ำกัน'), 'err');
  S.pendingTiers = rows;
  S.pendingIntro = S.tierIntroDraft;
  S.pendingIntroEn = en ? S.tierIntroEnDraft : null;
  const removed = r.enabled ? r.items.filter(t => !rows.some(x => x.id === t.id)) : [];
  openModal(`
    <div class="modal-head"><h2>${r.enabled ? tr('บันทึกระดับสมาชิก') : tr('เปิดใช้ระดับสมาชิก')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <div class="tier-summary">${rows.map(t => `<div>${tierDot(t.color)}<b>${esc(t.name)}</b> <span class="muted">${tr('ตั้งแต่ {n} {u}{x}{x2}', { n: fmtNum(t.minPoints), u, x: t.minPoints ? ` (${esc(bahtFor(t.minPoints))})` : '', x2: t.multiplier > 1 ? ` · ${u} ×${t.multiplier}` : '' })}</span></div>`).join('')}</div>
    <ul class="muted small">
      ${r.enabled ? '' : `<li>${tr('ระบบจัดระดับสมาชิกทุกคนตาม{u}จากการซื้อ {n} เดือนล่าสุดทันที', { u, n: fmtNum(r.keepMonths) })}</li>`}
      ${removed.map(t => `<li>${tr('เอาระดับ "{name}" ออก: สมาชิก {n} คนย้ายไประดับที่ใกล้ที่สุดซึ่งไม่สูงกว่าเดิม', { name: esc(t.name), n: fmtNum(t.members) })}</li>`).join('')}
      <li>${tr('ลูกค้าเห็นระดับในบัตรสมาชิก และหน้าสิทธิ์สมาชิกทันที')}</li>
    </ul>
    <div class="modal-actions">
      <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
      <button class="btn btn-primary" type="button" data-act="tiers-save-confirm">${tr('ยืนยัน')}</button>
    </div>`);
}

function confirmTiersOff() {
  if (!isOwner()) return;
  openModal(`
    <div class="modal-head"><h2>${tr('ปิดใช้ระดับสมาชิก?')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <ul class="muted small">
      <li>${tr('ลูกค้าไม่เห็นระดับในบัตรอีก และไม่ได้ตัวคูณ{u}ของระดับ', { u: esc(unit()) })}</li>
      <li>${tr('ของรางวัล / โปรโมชัน / แต้มพิเศษ ที่ตั้งระดับไว้ กลับเป็นใช้ได้ทุกคน')}</li>
      <li>${tr('{u} คูปอง และประวัติเดิมไม่หาย · เปิดใช้ใหม่ภายหลังได้ (ระบบจัดระดับใหม่จาก{u2}ที่สะสม)', { u: esc(unit()), u2: esc(unit()) })}</li>
    </ul>
    <div class="modal-actions">
      <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
      <button class="btn btn-danger" type="button" data-act="tiers-off-confirm">${tr('ปิดใช้')}</button>
    </div>`);
}

async function doSaveTiers(btn, off) {
  const tiers = off ? [] : S.pendingTiers;
  if (!tiers) return;
  setBusy(btn, true);
  try {
    const body = { tiers, intro: S.pendingIntro || '' };
    if (S.pendingIntroEn != null) body.introEn = S.pendingIntroEn; // ไม่ส่ง = ไม่แก้ (ร้านที่ไม่เปิดภาษาอังกฤษ)
    const r = await S.api.call('adminTiersSave', off ? { tiers } : body);
    closeModal();
    S.pendingTiers = null;
    toast(off ? tr('ปิดใช้ระดับสมาชิกแล้ว') : tr('บันทึกระดับสมาชิกแล้ว'), 'ok');
    renderTierPage(r);
  } catch (e) {
    setBusy(btn, false);
    // เน็ตหลุดกลางทาง: อาจบันทึกไปแล้ว → โหลดค่าล่าสุดมาให้ดูก่อน (กันกดซ้ำแล้วได้ระดับใหม่ซ้อน)
    if (e.code === 'NETWORK') { closeModal(); toast(e.message + tr(' — โหลดค่าล่าสุดให้แล้ว ตรวจดูก่อนกดบันทึกอีกครั้ง'), 'err'); loadTierPage(); return; }
    toast(e.message, 'err');
  }
}

// การ์ดระดับในหน้าสมาชิกรายคน: ระดับตอนนี้ + ยอด 12 เดือน + ระดับถัดไป + ประวัติ
function memberTierHtml(m, owner) {
  const ti = m.tierInfo;
  if (!tierFeature() || !ti) return '';
  const tiers = S.memberTiers || [];
  const name = id => { const t = tiers.find(t => t.id === id); return t ? t.name : ''; };
  const pct = ti.next && ti.next.minPoints > 0 ? Math.min(100, Math.round(ti.points12m / ti.next.minPoints * 100)) : 100;
  const u = esc(unit());
  const hist = m.tierHistory || [];
  return `
    <section class="card adm-card">
      <div class="card-head"><h2>${tr('ระดับสมาชิก')}</h2>${owner ? `<button class="btn btn-sm" data-act="member-tier">${icon('edit', 16)} ${tr('เปลี่ยนระดับ')}</button>` : ''}</div>
      <div class="tier-now">
        ${tierChip(ti.name, ti.color)}
        ${ti.multiplier > 1 ? `<span class="muted small">${tr('ได้{u} ×{multiplier}', { u: esc(unit()), multiplier: ti.multiplier })}</span>` : ''}
        <span class="muted small">${ti.until ? `${tr('คงระดับถึง {date}', { date: fmtDate(ti.until + 'T00:00:00+07:00') })}` : tr('ระดับแรก ไม่มีวันหมดอายุ')}</span>
      </div>
      <p class="small">${tr('{u}จากการซื้อ 12 เดือนล่าสุด <b>{n} {u2}</b>{n2}', { u, n: fmtNum(ti.points12m), u2: u, n2: ti.next ? ` ${tr('· อีก {n} {u} ถึงระดับ {name}', { n: fmtNum(ti.next.remaining), u, name: esc(ti.next.name) })}` : tr(' · ระดับสูงสุดแล้ว') })}</p>
      ${ti.next ? `<div class="tier-bar"><i style="width:${pct}%"></i></div>` : ''}
      ${hist.length ? `
      <div class="tbl-wrap tier-hist"><table class="tbl">
        <thead><tr><th>${tr('วันเวลา')}</th><th>${tr('เปลี่ยน')}</th><th>${tr('เหตุ')}</th><th class="num">${tr('{u} 12 เดือน', { u })}</th><th>${tr('โดย')}</th></tr></thead>
        <tbody>${hist.map(h => `<tr>
          <td class="nowrap">${fmtDateTime(h.date)}</td>
          <td class="nowrap">${h.from ? esc(h.fromName || name(h.from) || tr('ระดับเดิม')) + ' → ' : ''}${esc(h.toName || name(h.to) || tr('ระดับเดิม'))}</td>
          <td class="nowrap">${esc(tr(TIER_REASON[h.reason] || h.reason))}</td>
          <td class="num">${h.points12m != null ? fmtNum(h.points12m) : h.spend12m != null ? '฿' + fmtMoney(h.spend12m) : '-'}</td>
          <td>${esc(h.by)}</td>
        </tr>`).join('')}</tbody></table></div>` : ''}
    </section>`;
}

function openMemberTier() {
  const m = S.member;
  if (!m || !isOwner() || !m.tierInfo) return;
  openModal(`
    <div class="modal-head"><h2>${tr('เปลี่ยนระดับสมาชิก')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <p><b>${esc(m.name)}</b> <span class="muted mono">${esc(m.memberId)}</span></p>
    <form class="form" data-form="member-tier" autocomplete="off">
      <label class="field"><span>${tr('ระดับ')}</span><select name="tierId" class="select">${(S.memberTiers || []).map(t => `<option value="${esc(t.id)}" ${t.id === m.tierInfo.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="field"><span>${tr('เหตุผล <em>*</em>')}</span><input name="reason" maxlength="150" placeholder="${tr('เช่น ลูกค้า VIP ของร้าน')}"></label>
      <p class="muted small">${tr('คงระดับนี้ 12 เดือนนับจากวันนี้ (ระดับแรกไม่มีวันหมดอายุ) แล้วเป็นไปตามยอดซื้อตามปกติ · บันทึกชื่อคุณและเหตุผลไว้ในประวัติ')}</p>
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn btn-primary" type="submit">${tr('บันทึก')}</button>
      </div>
    </form>`);
}

async function saveMemberTier(form) {
  const m = S.member;
  const tierId = form.elements.tierId.value;
  const reason = form.elements.reason.value.trim();
  if (reason.length < 3) return toast(tr('กรุณาใส่เหตุผล'), 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    await S.api.call('adminMemberTier', { memberId: m.memberId, tierId, reason });
    closeModal();
    toast(tr('เปลี่ยนระดับแล้ว'), 'ok');
    loadMember(m.memberId);
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
// ภาษาอังกฤษ (ร้านที่เปิดภาษาอังกฤษเท่านั้น — ร้านอื่นไม่มีช่อง ไม่ส่ง = ไม่แก้)
const BRAND_EN_KEYS = ['SHOP_NAME_EN', 'TEXT_POINT_UNIT_EN', 'TEXT_GREETING_EN', 'TEXT_REGISTER_TITLE_EN', 'TEXT_REGISTER_SUBTITLE_EN', 'PRIVACY_TEXT_EN'];
const brandKeys = () => BRAND_KEYS.concat(englishFeature() ? BRAND_EN_KEYS : []);
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
  // ข้อความหน้าจอ: ว่าง = ลูกค้าเห็นข้อความตั้งต้นภาษาอังกฤษของระบบ (ไม่ใช่ภาษาไทย) → placeholder บอกข้อความนั้น
  const enName = (base.nameEn || (HAS_THAI.test(base.name || '') ? '' : base.name)) || tr('ชื่อร้าน');
  const textEn = (name, label, sysDefault, max) => enField(label, name, v[name], max, { placeholder: tr('ว่าง = ') + sysDefault, disabled: !owner });
  const policyEnHint = v.PRIVACY_TEXT && !v.PRIVACY_TEXT_EN
    ? `<small class="warn-text">${tr('ร้านแก้ฉบับไทยเองแล้ว แต่ยังไม่มีฉบับภาษาอังกฤษ — ลูกค้าที่เลือกภาษาอังกฤษจะเห็นฉบับไทย')}</small>`
    : '';
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('หน้าตาร้าน'), owner ? tr('แก้แล้วลูกค้าเห็นทันที · ช่องที่เว้นว่างใช้ค่าตั้งต้นของร้าน') : tr('ผู้จัดการดูได้อย่างเดียว เจ้าของร้านเป็นคนแก้'))}
    <div class="brand-layout">
      <form class="card adm-card form brand-form" data-form="brand" autocomplete="off">
        <h2 class="form-section">${tr('ชื่อและโลโก้')}</h2>
        ${text('SHOP_NAME', tr('ชื่อร้าน'), base.name || '', 60)}
        ${enField(tr('ชื่อร้าน'), 'SHOP_NAME_EN', v.SHOP_NAME_EN, 60, { placeholder: base.nameEn || tr('ว่าง = ใช้ชื่อร้านภาษาไทย (ชื่อที่เป็นภาษาอังกฤษอยู่แล้ว ไม่ต้องกรอก)'), disabled: !owner })}
        ${imageField(v.LOGO_URL, 'logo-preview', 'LOGO_URL', tr('โลโก้ (รูปสี่เหลี่ยมจัตุรัส)'), !owner, 'logo')}
        <h2 class="form-section">${tr('สไตล์และสี')}</h2>
        <label class="field"><span>${tr('สไตล์')}</span>
          <select name="THEME" class="select" ${dis}>
            <option value="">${tr('ค่าตั้งต้นของร้าน ({x})', { x: esc(tr(THEME_LABEL[base.theme] || base.theme || 'หรู โทนเข้ม')) })}</option>
            ${Object.keys(THEME_LABEL).map(k => `<option value="${k}" ${v.THEME === k ? 'selected' : ''}>${tr(THEME_LABEL[k])}</option>`).join('')}
          </select></label>
        <div class="color-list">${BRAND_COLORS.map(([k, label, hint, slot]) => `
          <div class="color-row">
            <span class="color-label">${esc(tr(label))}<small>${esc(tr(hint))}</small></span>
            <span class="color-input">
              <input type="color" data-color="${k}" value="${esc(HEX.test(v[k]) ? v[k] : defaultColor(slot, theme))}" aria-label="${tr('เลือก{label}', { label: esc(tr(label)) })}" ${dis}>
              <input name="${k}" class="hex" value="${esc(v[k])}" maxlength="7" placeholder="${tr('ค่าเดิม')}" aria-label="${tr('รหัส{label}', { label: esc(tr(label)) })}" ${dis}>
              ${owner ? `<button type="button" class="link" data-act="color-reset" data-id="${k}">${tr('ค่าเดิม')}</button>` : ''}
            </span>
          </div>`).join('')}
        </div>
        <h2 class="form-section">${tr('ข้อความ')}</h2>
        <div class="form-grid">
          ${text('TEXT_POINT_UNIT', tr('คำเรียกแต้ม'), (base.texts && base.texts.pointUnit) || 'แต้ม', 20)}
          ${text('TEXT_GREETING', tr('ข้อความทักทายหน้าแรก'), (base.texts && base.texts.greeting) || 'สวัสดี', 60)}
          ${textEn('TEXT_POINT_UNIT_EN', tr('คำเรียกแต้ม'), tr('points (ใส่แบบพหูพจน์ เช่น stars)'), 20)}
          ${textEn('TEXT_GREETING_EN', tr('ข้อความทักทายหน้าแรก'), EN_TEXT['สวัสดี'], 60)}
        </div>
        ${text('TEXT_REGISTER_TITLE', tr('หัวข้อหน้าสมัครสมาชิก'), (base.texts && base.texts.registerTitle) || 'สมัครสมาชิก ' + (base.name || ''), 80)}
        ${textEn('TEXT_REGISTER_TITLE_EN', tr('หัวข้อหน้าสมัครสมาชิก'), EN_TEXT['สมัครสมาชิก {shop}'].replace('{shop}', enName), 80)}
        ${text('TEXT_REGISTER_SUBTITLE', tr('คำอธิบายหน้าสมัครสมาชิก'), (base.texts && base.texts.registerSubtitle) || 'สะสมแต้มทุกครั้งที่ซื้อ แลกของรางวัลและสิทธิพิเศษ', 150)}
        ${textEn('TEXT_REGISTER_SUBTITLE_EN', tr('คำอธิบายหน้าสมัครสมาชิก'), EN_TEXT['สะสม{u}ทุกครั้งที่ซื้อ แลกของรางวัลและสิทธิพิเศษ'].replace('{u}', 'points'), 150)}
        <h2 class="form-section">${tr('นโยบายความเป็นส่วนตัว')}</h2>
        <label class="field"><span>${tr('ข้อความที่ลูกค้าอ่านตอนสมัคร')} <small>${tr('ตอนนี้เป็นฉบับที่ {consentVersion}', { consentVersion: esc(r.consentVersion) })}</small></span>
          <textarea name="PRIVACY_TEXT" rows="9" maxlength="3000" placeholder="${esc((base.legal && base.legal.privacyText) || '')}" ${dis}>${esc(v.PRIVACY_TEXT)}</textarea>
          ${r.policyAccepted
            // ระบบใหม่ (PDPA ขั้นที่ 2): ลูกค้าเดิมต้องกดยอมรับฉบับใหม่ก่อนใช้บัตร + บอกว่ายอมรับแล้วกี่คน
            ? `<small>${tr('แก้แล้วจะเป็นฉบับที่ {next} อัตโนมัติ — ลูกค้าเดิมจะถูกขอให้กดยอมรับฉบับใหม่ตอนเปิดบัตรครั้งถัดไป (แลกของรางวัลไม่ได้จนกว่าจะยอมรับ / พนักงานยังบันทึกยอดให้ได้) · ว่าง = ใช้ข้อความตั้งต้นของร้าน', { next })}</small>
               <small class="policy-count">${tr('ยอมรับฉบับที่ {consentVersion} แล้ว <b>{n}</b> จาก {n2} คน', { consentVersion: esc(r.consentVersion), n: fmtNum(r.policyAccepted.accepted), n2: fmtNum(r.policyAccepted.total) })}</small>`
            : `<small>${tr('แก้แล้วจะเป็นฉบับที่ {next} อัตโนมัติ — ลูกค้าที่สมัครหลังจากนี้ยอมรับฉบับใหม่ ส่วนลูกค้าเก่ายังบันทึกเป็นฉบับเดิม (ตามที่ PDPA ต้องการ) · ว่าง = ใช้ข้อความตั้งต้นของร้าน', { next })}</small>`}</label>
        ${enField(tr('นโยบายความเป็นส่วนตัว (ฉบับแปล)'), 'PRIVACY_TEXT_EN', v.PRIVACY_TEXT_EN, 3000, {
          rows: 9, disabled: !owner,
          placeholder: v.PRIVACY_TEXT ? tr('ว่าง = ลูกค้าที่เลือกภาษาอังกฤษเห็นฉบับไทย') : ((base.legal && base.legal.privacyTextEn) || tr('ว่าง = ลูกค้าที่เลือกภาษาอังกฤษเห็นฉบับไทย')),
          hint: tr('— แก้ฉบับอังกฤษไม่ขึ้นฉบับใหม่ ลูกค้าไม่ต้องกดยอมรับใหม่ (ลูกค้าเห็นหมายเหตุว่าฉบับไทยใช้บังคับ)')
        }).replace('</label>', policyEnHint + '</label>')}
        ${owner ? `<div class="form-actions"><button class="btn btn-primary" type="submit">${tr('บันทึกหน้าตาร้าน')}</button></div>` : ''}
      </form>
      <aside class="brand-side">
        <div class="muted small">${tr('ตัวอย่างหน้าจอลูกค้า (เปลี่ยนตามที่แก้ทันที)')}</div>
        ${englishFeature() ? `<div class="lang-switch pv-lang" role="group" aria-label="${tr('ภาษาของตัวอย่าง')}">${['th', 'en'].map(l => `<button type="button" data-act="brand-lang" data-id="${l}" aria-pressed="${(S.previewLang || 'th') === l}">${l.toUpperCase()}</button>`).join('')}</div>` : ''}
        <div id="brand-preview"></div>
      </aside>
    </div>`;
  updateBrandPreview();
  openPending(['shopName', 'policy'], (id, kind) => focusField(kind === 'policy' ? '[name="PRIVACY_TEXT_EN"]' : '[name="SHOP_NAME_EN"]'));
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
    privacyText: val('PRIVACY_TEXT'),
    // ภาษาอังกฤษ (มีช่องเฉพาะร้านที่เปิด) — ใช้วาดตัวอย่างแบบ EN
    ...(f.SHOP_NAME_EN ? {
      nameEn: val('SHOP_NAME_EN'),
      textsEn: { pointUnit: val('TEXT_POINT_UNIT_EN'), greeting: val('TEXT_GREETING_EN'), registerTitle: val('TEXT_REGISTER_TITLE_EN'), registerSubtitle: val('TEXT_REGISTER_SUBTITLE_EN') },
      privacyTextEn: val('PRIVACY_TEXT_EN')
    } : {})
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
  // ตัวอย่างแบบ EN: ใช้ข้อความภาษาอังกฤษของร้าน ไม่มี = ข้อความตั้งต้นของระบบ (เหมือนหน้าลูกค้าจริง — app/customer.js)
  const en = englishFeature() && S.previewLang === 'en';
  document.querySelectorAll('.pv-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === (en ? 'en' : 'th'))));
  const tx = k => (en ? c.textsEn && c.textsEn[k] : c.texts && c.texts[k]);
  // ข้อความในตัวอย่าง = สิ่งที่ลูกค้าเห็น → ไทยคงเป็นไทยแม้หลังบ้านเป็นอังกฤษ (ไม่ผ่าน tr) / อังกฤษใช้คำแปลของหน้าลูกค้า
  const L = (th, key) => (en ? EN_TEXT[key || th] || th : th);
  const unitText = tx('pointUnit') || (en ? 'points' : 'แต้ม');
  const name = (en && c.nameEn) || c.name || '';
  const logo = c.logo ? S.shop.asset(c.logo) : '';
  box.innerHTML = `
    <div class="pv" style="${Object.entries(vars).map(([n, x]) => `${n}:${esc(x)}`).join(';')}" lang="${en ? 'en' : 'th'}">
      <div class="pv-head">
        ${logo ? `<img class="pv-logo" src="${esc(logo)}" alt="" referrerpolicy="no-referrer">` : `<div class="pv-logo pv-logo-text">${esc(c.logoText || (c.name || '?').slice(0, 1))}</div>`}
        <div><div class="pv-hello">${esc(tx('greeting') || L('สวัสดี'))}</div><div class="pv-name">${en ? 'Sample Customer' : 'ลูกค้าตัวอย่าง'}</div></div>
      </div>
      <div class="pv-card">
        <div class="pv-card-top"><span>${esc(L('บัตรสมาชิก'))}</span><b>${esc(name)}</b></div>
        <div class="pv-points">1,250 <small>${esc(unitText)}</small></div>
      </div>
      <div class="pv-body">
        <span class="pv-chip">${en ? 'New' : 'โปรใหม่'}</span>
        <div class="pv-btn">${esc(L('แลกของรางวัล', 'แลกของรางวัล@@ปุ่ม'))}</div>
        <div class="pv-reg"><b>${esc(tx('registerTitle') || (en ? EN_TEXT['สมัครสมาชิก {shop}'].replace('{shop}', name) : 'สมัครสมาชิก ' + name))}</b><span>${esc(tx('registerSubtitle') || (en ? EN_TEXT['สะสม{u}ทุกครั้งที่ซื้อ แลกของรางวัลและสิทธิพิเศษ'].replace('{u}', unitText) : 'สะสม' + unitText + 'ทุกครั้งที่ซื้อ'))}</span></div>
      </div>
    </div>`;
}

function saveBrand(form) {
  if (!isOwner()) return;
  const values = {};
  brandKeys().forEach(k => { if (form.elements[k]) values[k] = form.elements[k].value.trim(); });
  const badColor = BRAND_COLORS.find(([k]) => values[k] && !HEX.test(values[k]));
  if (badColor) return toast(`${tr('{x} ต้องเป็นรหัสสีแบบ #RRGGBB หรือเว้นว่าง', { x: badColor[1] })}`, 'err');
  const changed = Object.keys(values).filter(k => values[k] !== String(S.brandValues[k] || '').trim());
  if (!changed.length) return toast(tr('ยังไม่ได้เปลี่ยนค่าใด'), '');
  S.pendingBrand = values;
  if (!changed.includes('PRIVACY_TEXT')) return doSaveBrand(values, form.querySelector('button[type="submit"]'));
  const next = (parseInt(S.consentVersion, 10) || 1) + 1;
  openModal(`
    <div class="modal-head"><h2>${tr('ยืนยันแก้นโยบายความเป็นส่วนตัว')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <p class="notice">${icon('shield', 18)}<span>${tr('นโยบายจะเปลี่ยนเป็น <b>ฉบับที่ {next}</b> ลูกค้าที่สมัครหลังจากนี้ยอมรับฉบับใหม่ ส่วนลูกค้าเก่ายังบันทึกเป็นฉบับเดิม ถ้าเป็นการเปลี่ยนสาระสำคัญ ควรแจ้งลูกค้าเก่าด้วย', { next })}</span></p>
    ${englishFeature() && !changed.includes('PRIVACY_TEXT_EN') ? `<p class="notice notice-warn">${icon('alert', 18)}<span>${values.PRIVACY_TEXT_EN
      ? tr('ฉบับภาษาอังกฤษยังเป็นข้อความเดิม — แก้ให้ตรงกับฉบับไทยด้วย (ลูกค้าที่เลือกภาษาอังกฤษอ่านฉบับนี้)')
      : tr('ยังไม่มีฉบับภาษาอังกฤษที่ตรงกับฉบับไทยนี้ — ลูกค้าที่เลือกภาษาอังกฤษจะเห็นฉบับไทย')}</span></p>` : ''}
    <div class="modal-actions">
      <button class="btn" data-act="close">${tr('ยกเลิก')}</button>
      <button class="btn btn-primary" data-act="brand-confirm">${tr('บันทึก')}</button>
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
    const policy = r.consentVersion !== prevVersion ? ` ${tr('· นโยบายเป็นฉบับที่ {consentVersion}', { consentVersion: r.consentVersion })}` : '';
    toast(r.changed ? `${tr('บันทึกแล้ว ลูกค้าเห็นหน้าตาใหม่ทันที{policy}', { policy })}` : tr('ค่าเหมือนเดิม ไม่มีอะไรเปลี่ยน'), 'ok');
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
  HISTORY_LIMIT: { label: 'จำนวนประวัติที่ลูกค้าเห็น', suffix: 'รายการ' },
  // ส่งข้อความรอบ 3 (ระบบใหม่เท่านั้น — ระบบเดิมไม่ส่งค่าเหล่านี้มา จึงไม่แสดง)
  REQUIRE_OA_FRIEND: { label: 'ต้องเพิ่มเพื่อน LINE ของร้านก่อนสมัครสมาชิก', type: 'bool', hint: 'ส่งข้อความถึงสมาชิกได้แทบทุกคน · ใช้ได้เมื่อเชื่อม LINE OA แล้ว', broadcast: true },
  CONSENT_PRETICKED: { label: 'ติ๊กช่อง "รับข่าวสาร" ไว้ให้ในหน้าสมัคร', type: 'bool', hint: 'ลูกค้าเอาติ๊กออกได้ และยกเลิกทีหลังได้ที่ "แก้ไขข้อมูล"' },
  CONSENT_BONUS_POINTS: { label: 'แต้มเมื่อยินยอมรับข่าวสาร', suffix: 'แต้ม', hint: 'ได้ครั้งเดียวต่อคน · 0 = ไม่ให้' }
};
const ON_OFF = { ON: 'เปิด@@สวิตช์', OFF: 'ปิด@@สวิตช์' }; // @@ = คำแปลเฉพาะที่ (On/Off) ภาษาไทยตัดทิ้ง
// ค่าที่หน้านี้แสดง: เฉพาะที่ตัวกลางส่งมา (ระบบเดิมไม่มีค่าใหม่) + ค่าที่เกี่ยวกับ LINE OA เฉพาะร้านที่มีแพ็กเกจส่งข้อความ
const settingKeys = () => Object.keys(SETTING_UI).filter(k => (S.settingsItems || []).some(x => x.key === k) && (!SETTING_UI[k].broadcast || broadcastFeature()));
const settingText = (k, v) => (SETTING_UI[k].type === 'bool' ? tr(ON_OFF[v] || v) : v);
// ชื่อค่าร้าน: ภาษาไทยแทน "แต้ม" ด้วยคำเรียกแต้มของร้าน / ภาษาอังกฤษใช้ {u} ในคำแปล
const settingLabel = k => (isEn() ? tr(SETTING_UI[k].label, { u: unit(), u1: unitOne() }) : SETTING_UI[k].label.replace('แต้ม', unit()));
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
  const unitOf = s => (s === 'แต้ม' ? unit() : tr(s)); // หน่วยอื่น (บาท วัน รายการ) แปลตามภาษา
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('ตั้งค่าร้าน'), owner ? tr('แก้แล้วมีผลกับรายการถัดไปทันที') : tr('ผู้จัดการดูได้อย่างเดียว เจ้าของร้านเป็นคนแก้'))}
    <section class="card adm-card">
      <form class="form settings-form" data-form="settings" autocomplete="off">
        ${settingKeys().map(k => `
          <label class="setting-row">
            <span class="setting-label">${esc(settingLabel(k))}${SETTING_UI[k].hint ? `<small>${esc(tr(SETTING_UI[k].hint))}</small>` : ''}</span>
            <span class="setting-input">${SETTING_UI[k].type === 'bool'
              ? `<select name="${k}" class="select" ${owner ? '' : 'disabled'}>${Object.keys(ON_OFF).map(v => `<option value="${v}" ${get(k) === v ? 'selected' : ''}>${tr(ON_OFF[v])}</option>`).join('')}</select>`
              : `<input name="${k}" value="${esc(get(k))}" inputmode="decimal" ${owner ? '' : 'disabled'}><span class="muted">${esc(unitOf(SETTING_UI[k].suffix))}</span>`}</span>
          </label>`).join('')}
        ${owner ? `<div><button class="btn btn-primary" type="submit">${tr('บันทึกการตั้งค่า')}</button></div>` : ''}
      </form>
    </section>
    <section class="card adm-card">
      <div class="card-head"><h2>${tr('ค่าระบบ')}</h2></div>
      <dl class="kv">${Object.keys(READONLY_UI).map(k => `<dt>${esc(tr(READONLY_UI[k]))}</dt><dd class="mono">${esc(get(k) || '-')}</dd>`).join('')}</dl>
      <p class="muted small">${tr('ค่าเหล่านี้เปลี่ยนแล้วกระทบการเข้าสู่ระบบหรือรหัสสมาชิก จึงไม่เปิดให้แก้ที่นี่ ถ้าต้องเปลี่ยนให้ติดต่อผู้ดูแลระบบ · ชื่อร้าน โลโก้ สี และนโยบาย แก้ได้ที่เมนู "หน้าตาร้าน"')}</p>
    </section>`;
}

function confirmSettings(form) {
  if (!isOwner()) return;
  const changes = [];
  settingKeys().forEach(k => {
    const before = (S.settingsItems.find(x => x.key === k) || {}).value || '';
    const after = form.elements[k].value.replace(/,/g, '').trim();
    if (after !== before) changes.push({ key: k, before, after });
  });
  if (!changes.length) return toast(tr('ยังไม่ได้เปลี่ยนค่าใด'), '');
  S.pendingSettings = Object.fromEntries(changes.map(c => [c.key, c.after]));
  openModal(`
    <div class="modal-head"><h2>${tr('ยืนยันการตั้งค่า')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <dl class="kv">${changes.map(c => `<dt>${esc(settingLabel(c.key))}</dt><dd>${esc(settingText(c.key, c.before) || '-')} → <b>${esc(settingText(c.key, c.after) || '-')}</b></dd>`).join('')}</dl>
    <p class="notice">${icon('alert', 18)}<span>${tr('มีผลกับรายการถัดไปทันที {u}ที่ลูกค้าได้ไปแล้วไม่เปลี่ยน', { u: esc(unit()) })}</span></p>
    <div class="modal-actions">
      <button class="btn" data-act="close">${tr('ยกเลิก')}</button>
      <button class="btn btn-primary" data-act="settings-confirm">${tr('บันทึก')}</button>
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
    toast(r.changed ? tr('บันทึกการตั้งค่าแล้ว') : tr('ค่าเหมือนเดิม ไม่มีอะไรเปลี่ยน'), 'ok');
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
    ${pageHead(tr('รายการแต้ม'), tr('ทุกรายการที่ได้หรือใช้แต้ม เรียงจากใหม่ไปเก่า') + branchNote(), exportBtn('transactions'))}
    ${rangeBar()}
    <form class="filters" data-form="tx" autocomplete="off">
      <select name="type" aria-label="${tr('ประเภท')}">
        ${opt('', tr('ทุกประเภท'), t.type)}${Object.keys(TX_LABEL).map(k => opt(k, tr(TX_LABEL[k]), t.type)).join('')}
      </select>
      <select name="staff" aria-label="${tr('พนักงาน')}">
        ${opt('', tr('พนักงานทุกคน'), t.staff)}${staffList.map(n => opt(n, staffLabel(n), t.staff)).join('')}
      </select>
      <div class="search-box">${icon('search', 18)}<input name="q" value="${esc(t.q)}" placeholder="${tr('ชื่อหรือรหัสสมาชิก')}" enterkeyhint="search"></div>
      <button class="btn btn-sm btn-primary" type="submit">${tr('ค้นหา')}</button>
    </form>
    <div class="sum-row">
      <span class="chip">${tr('{n} รายการ', { n: fmtNum(s.count) })}</span>
      <span class="chip">${tr('ยอดซื้อ ฿{n}', { n: fmtMoney(s.sales) })}</span>
      <span class="chip">${tr('ได้ +{n} {u}', { n: fmtNum(s.pointsPlus), u: esc(unit()) })}</span>
      <span class="chip">${tr('ใช้ −{n} {u}', { n: fmtNum(s.pointsMinus), u: esc(unit()) })}</span>
    </div>
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${tr('วันเวลา')}</th><th>${tr('สมาชิก')}</th><th>${tr('ประเภท')}</th><th>${tr('รายละเอียด')}</th><th class="num">${tr('ยอดซื้อ')}</th><th class="num">${esc(unit())}</th><th class="num">${tr('คงเหลือ')}</th><th>${tr('พนักงาน')}</th>${hasBranches() ? `<th>${tr('สาขา')}</th>` : ''}</tr></thead>
        <tbody>${r.items.length ? r.items.map(x => `
          <tr class="row-link" data-act="member" data-id="${esc(x.memberId)}">
            <td class="nowrap">${fmtDateTime(x.date)}</td>
            <td>${memberLink(x.memberId, x.memberName)}<div class="m-sub mono">${esc(x.memberId)}</div></td>
            <td class="nowrap">${esc(tr(TX_LABEL[x.type] || x.type))}</td>
            <td>${esc(txDetail(x))}</td>
            <td class="num">${x.type === 'EARN' ? '฿' + fmtMoney(x.amount) : ''}</td>
            <td class="num tx-points ${ptsClass(x.points)}">${signed(x.points)}</td>
            <td class="num">${fmtNum(x.balance)}</td>
            <td>${esc(staffLabel(x.staff))}</td>
            ${hasBranches() ? `<td class="nowrap">${esc(x.type === 'REDEEM' || x.type === 'WELCOME' || x.type === 'CONSENT' ? '-' : branchName(x.branch))}</td>` : ''}
          </tr>`).join('') : emptyRow(9, tr('ไม่มีรายการในช่วงนี้'))}
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
  const tabs = [['', tr('ทั้งหมด'), r.all], ['ACTIVE', tr('ใช้ได้'), r.counts.ACTIVE], ['USED', tr('ใช้แล้ว'), r.counts.USED], ['EXPIRED', tr('หมดอายุ'), r.counts.EXPIRED]];
  if (r.counts.CANCELLED) tabs.push(['CANCELLED', tr('ยกเลิก'), r.counts.CANCELLED]);
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('คูปอง'), S.branch ? `${tr('คูปองที่ถูกใช้ที่{x} (ลูกค้าแลกในช่วงที่เลือก)', { x: branchNote() })}` : tr('คูปองที่ลูกค้าแลกในช่วงที่เลือก และสถานะตอนนี้'))}
    ${rangeBar()}
    <div class="chips-scroll status-tabs">${tabs.map(([id, label, n]) => `
      <button type="button" class="chip-btn ${cur === id ? 'active' : ''}" data-act="coupon-status" data-id="${id}">${label} (${fmtNum(n)})</button>`).join('')}
    </div>
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${tr('แลกเมื่อ')}</th><th>${tr('ของรางวัล')}</th><th>${tr('รหัสคูปอง')}</th><th>${tr('สมาชิก')}</th><th class="num">${tr('ใช้{u}', { u: esc(unit()) })}</th><th>${tr('สถานะ')}</th><th>${tr('ใช้ได้ถึง')}</th><th>${tr('ใช้เมื่อ · โดย')}</th>${hasBranches() ? `<th>${tr('ใช้ที่สาขา')}</th>` : ''}</tr></thead>
        <tbody>${r.items.length ? r.items.map(c => `
          <tr class="row-link" data-act="member" data-id="${esc(c.memberId)}">
            <td class="nowrap">${fmtDateTime(c.issuedAt)}</td>
            <td>${esc(c.name)}</td>
            <td class="mono">${esc(c.code)}</td>
            <td>${memberLink(c.memberId, c.memberName)}</td>
            <td class="num">${fmtNum(c.pointsUsed)}</td>
            <td>${statusChip(c.status, tr(COUPON_LABEL[c.status] || c.status))}</td>
            <td class="nowrap">${fmtDate(c.expiresAt)}</td>
            <td class="nowrap">${c.usedAt ? fmtDateTime(c.usedAt) + (c.usedBy ? ' · ' + esc(c.usedBy) : '') : '-'}</td>
            ${hasBranches() ? `<td class="nowrap">${c.usedAt ? esc(branchName(c.usedBranch)) : '-'}</td>` : ''}
          </tr>`).join('') : emptyRow(9, tr('ไม่มีคูปองในช่วงนี้'))}
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
const staffBranchText = s => (allBranches(s) ? tr('ทุกสาขา') : s.branches.map(branchName).join(', '));

function renderStaff(r) {
  S.staffItems = r.items;
  const link = `https://liff.line.me/${cfg().liffId}/staff`;
  const pending = r.items.filter(s => s.status === 'PENDING').length;
  // เลือกสาขา → แสดงคนที่ทำงานสาขานั้นได้ (รวมคนที่อยู่ทุกสาขา) / คนรออนุมัติยังไม่มีสาขา จึงแสดงเสมอ
  const items = S.branch ? r.items.filter(s => s.status === 'PENDING' || allBranches(s) || s.branches.includes(S.branch)) : r.items;
  const withBranch = hasBranches();
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('พนักงาน'), (pending ? `${tr('<b>{n} คนรออนุมัติ</b>', { n: fmtNum(pending) })}` : `${tr('{n} คน', { n: fmtNum(items.length) })}`) + branchNote())}
    ${withBranch ? `<div class="filters">${branchSelect()}</div>` : ''}
    <section class="card adm-card invite">
      <div class="grow">
        ${tr('<b>เพิ่มพนักงานใหม่</b>')}
        <p class="muted small">${tr('ส่งลิงก์นี้ให้พนักงานทาง LINE ส่วนตัว เมื่อเปิดแล้วชื่อจะขึ้นในรายการด้านล่างให้กดอนุมัติ')}</p>
        <code>${esc(link)}</code>
      </div>
      <button class="btn btn-sm" data-act="copy" data-text="${esc(link)}">${icon('copy', 16)} ${tr('คัดลอกลิงก์')}</button>
    </section>
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${tr('ชื่อ')}</th><th>${tr('บทบาท')}</th>${withBranch ? `<th>${tr('สาขา')}</th>` : ''}<th>${tr('สถานะ')}</th><th>${tr('ขอสิทธิ์เมื่อ')}</th><th></th></tr></thead>
        <tbody>${items.length ? items.map(s => `
          <tr>
            <td class="strong">${esc(s.name || '-')}${s.isMe ? ` <span class="chip">${tr('คุณ')}</span>` : ''}</td>
            <td>${esc(tr(ROLE_LABEL[s.role] || s.role))}</td>
            ${withBranch ? `<td>${s.status === 'PENDING' ? '-' : esc(staffBranchText(s))}</td>` : ''}
            <td>${statusChip(s.status, tr(STAFF_STATUS_LABEL[s.status] || s.status))}</td>
            <td class="nowrap">${s.requestedAt ? fmtDateTime(s.requestedAt) : '-'}</td>
            <td class="actions">${canEdit(s)
              ? (s.status === 'PENDING'
                ? `<button class="btn btn-sm btn-primary" data-act="staff-edit" data-id="${esc(s.userId)}">${icon('check', 16)} ${tr('อนุมัติ')}</button>`
                : `<button class="btn btn-sm" data-act="staff-edit" data-id="${esc(s.userId)}">${icon('edit', 16)} ${tr('แก้ไข')}</button>`)
              : ''}</td>
          </tr>`).join('') : emptyRow(6, tr('ยังไม่มีพนักงาน'))}
        </tbody></table></div>
    </section>
    <section class="card adm-card">
      <div class="card-head"><h2>${tr('แต่ละบทบาททำอะไรได้')}</h2></div>
      <dl class="kv roles">
        <dt>${tr('แคชเชียร์')}</dt><dd>${tr('บันทึกยอดซื้อ ใช้คูปอง (เห็นเบอร์ลูกค้าแค่ 4 ตัวท้าย)')}</dd>
        <dt>${tr('ผู้จัดการ')}</dt><dd>${tr('ทำได้เหมือนแคชเชียร์ + ปรับแต้ม + ดูหลังบ้าน + อนุมัติแคชเชียร์')}</dd>
        <dt>${tr('เจ้าของร้าน')}</dt><dd>${tr('ทำได้ทุกอย่าง + เห็นเบอร์และวันเกิดลูกค้า + ส่งออกไฟล์ + ตั้งผู้จัดการ')}</dd>
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
    <div class="modal-head"><h2>${approving ? tr('อนุมัติพนักงาน') : tr('แก้ไขพนักงาน')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <form class="form" data-form="staff-edit" data-id="${esc(s.userId)}" autocomplete="off">
      <label class="field"><span>${tr('ชื่อที่แสดงในรายการ')}</span><input name="name" value="${esc(s.name)}" maxlength="60"></label>
      <label class="field"><span>${tr('บทบาท')}</span>
        <select name="role" class="select">${roles.map(r => `<option value="${r}" ${r === s.role ? 'selected' : ''}>${tr(ROLE_LABEL[r])}</option>`).join('')}</select></label>
      <label class="field"><span>${tr('สถานะ')}</span>
        <select name="status" class="select">${['ACTIVE', 'DISABLED', 'PENDING'].map(v => `<option value="${v}" ${v === status ? 'selected' : ''}>${tr(STAFF_STATUS_LABEL[v])}</option>`).join('')}</select></label>
      ${hasBranches() ? staffBranchField(s, approving) : ''}
      ${isOwner() ? '' : `<p class="muted small">${tr('ผู้จัดการแก้ได้เฉพาะแคชเชียร์ ถ้าต้องการตั้งผู้จัดการ ให้เจ้าของร้านทำ')}</p>`}
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn btn-primary" type="submit">${approving ? tr('อนุมัติ') : tr('บันทึก')}</button>
      </div>
    </form>`);
}

// เลือกสาขาที่พนักงานทำงานได้ (ติ๊ก "ทุกสาขา" = ไม่จำกัด รวมสาขาที่เพิ่มในอนาคต)
// อนุมัติคนใหม่: ยังไม่ติ๊กอะไร ให้เจ้าของร้านเลือกเองว่าคนนี้อยู่สาขาไหน (ไม่ปล่อยเป็นทุกสาขาโดยไม่ตั้งใจ)
function staffBranchField(s, approving) {
  const all = !approving && (!s.branches || s.branches.includes('ALL'));
  const open = S.branches.filter(b => b.status === 'ACTIVE' || (s.branches || []).includes(b.id));
  return `
    <fieldset class="field branch-field"><legend>${tr('สาขาที่ทำงานได้')}</legend>
      <label class="check"><input type="checkbox" name="branchAll" data-branch-all ${all ? 'checked' : ''}><span>${tr('<b>ทุกสาขา</b> (รวมสาขาที่เพิ่มทีหลัง)')}</span></label>
      <div class="branch-checks">${open.map(b => `
        <label class="check"><input type="checkbox" name="branch" value="${esc(b.id)}" ${!all && !approving && s.branches.includes(b.id) ? 'checked' : ''} ${all ? 'disabled' : ''}><span>${esc(b.name)}${b.status === 'ACTIVE' ? '' : tr(' (ปิดแล้ว)')}</span></label>`).join('')}
      </div>
      <small>${tr('เจ้าของร้านใช้ได้ทุกสาขาเสมอ / พนักงานหลายสาขาจะเลือกสาขาตอนเปิดหน้าพนักงาน')}</small>
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
  if (branches && !branches.length) return toast(tr('เลือกอย่างน้อย 1 สาขา หรือติ๊ก "ทุกสาขา"'), 'err');
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await S.api.call('adminStaffUpdate', {
      userId: form.dataset.id, name: form.elements.name.value.trim(),
      role: form.elements.role.value, status: form.elements.status.value, branches
    });
    closeModal();
    toast(`${tr('บันทึกแล้ว · {name} เป็น{x} ({x2})', { name: r.staff.name, x: tr(ROLE_LABEL[r.staff.role]), x2: tr(STAFF_STATUS_LABEL[r.staff.status]) })}`, 'ok');
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
  const quota = limit === Infinity ? '' : ` ${tr('· แพ็กเกจของร้านเปิดได้ {n} สาขา', { n: fmtNum(limit) })}`;
  document.getElementById('view').innerHTML = `
    ${pageHead(tr('สาขา'), (r.items.length ? `${tr('เปิดอยู่ {n} จาก {n2} สาขา', { n: fmtNum(open), n2: fmtNum(r.items.length) })}` : tr('ร้านนี้ยังไม่ได้เพิ่มสาขา')) + quota,
      owner ? `<button class="btn btn-sm btn-primary" data-act="branch-edit" data-id="">${tr('+ เพิ่มสาขา')}</button>` : '')}
    ${r.items.length ? `
    <section class="card adm-card flush">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${tr('สาขา')}</th><th class="num">${tr('พนักงาน')}</th><th class="num">${tr('สมาชิกที่สมัคร')}</th><th>${tr('สถานะ')}</th><th></th></tr></thead>
        <tbody>${r.items.map(b => `
          <tr>
            <td><b>${esc(b.name)}</b><div class="m-sub mono">${esc(b.id)}</div></td>
            <td class="num">${fmtNum(b.staff)}</td>
            <td class="num">${fmtNum(b.members)}</td>
            <td>${b.status === 'ACTIVE' ? statusChip('active', tr('เปิดอยู่')) : statusChip('inactive', tr('ปิดแล้ว'))}</td>
            <td class="actions">
              ${b.status === 'ACTIVE' ? `<button class="btn btn-sm" data-act="branch-qr" data-id="${esc(b.id)}">${icon('qr', 16)} ${tr('QR สมัคร')}</button>` : ''}
              ${owner ? `<button class="btn btn-sm" data-act="branch-edit" data-id="${esc(b.id)}">${icon('edit', 16)} ${tr('แก้ไข')}</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody></table></div>
    </section>
    <p class="muted small">${tr('สมัครออนไลน์ (ไม่ได้สแกน QR ของสาขา) {n} คน · สาขาที่ไม่ใช้แล้วให้กดแก้ไขแล้วเลือก "ปิดสาขา" (ไม่ลบ เพราะรายการเก่ายังอ้างถึงอยู่)', { n: fmtNum(r.online) })}</p>` : `
    <section class="card adm-card empty-branches">
      <div class="state-icon">${icon('pin', 36)}</div>
      <h2>${tr('ร้านมีหลายสาขาใช่ไหม')}</h2>
      <p class="muted">${tr('เพิ่มสาขาแล้วจะดูยอดซื้อ สมาชิกใหม่ และคูปองแยกตามสาขาได้ พนักงานจะเลือกสาขาตอนเปิดหน้าพนักงาน และแต่ละสาขามี QR สมัครสมาชิกของตัวเอง')}</p>
      <p class="muted small">${tr('ร้านที่มีสาขาเดียวไม่ต้องเพิ่ม ระบบทำงานเหมือนเดิมทุกอย่าง · {u}ใช้ร่วมกันทุกสาขา', { u: esc(unit()) })}</p>
      ${owner ? `<button class="btn btn-primary" data-act="branch-edit" data-id="">${tr('+ เพิ่มสาขาแรก')}</button>` : `<p class="muted small">${tr('เจ้าของร้านเป็นคนเพิ่มสาขา')}</p>`}
    </section>`}
    <section class="card adm-card">
      <div class="card-head"><h2>${tr('ระบบรู้ได้อย่างไรว่าเกิดที่สาขาไหน')}</h2></div>
      <dl class="kv roles">
        <dt>${tr('ยอดซื้อ / ใช้คูปอง')}</dt><dd>${tr('สาขาที่พนักงานเลือกไว้ในหน้าพนักงาน (ตั้งว่าใครอยู่สาขาไหนได้ที่เมนูพนักงาน)')}</dd>
        <dt>${tr('สมาชิกใหม่')}</dt><dd>${tr('สาขาของ QR ที่ลูกค้าสแกนสมัคร (สมัครเองโดยไม่สแกน = ออนไลน์)')}</dd>
        <dt>${esc(unit())}</dt><dd>${tr('ใช้ร่วมกันทุกสาขา สะสมที่สาขาหนึ่ง แลกที่อีกสาขาได้')}</dd>
      </dl>
    </section>`;
  openPending('branch', openBranchEdit);
}

// เพดานตามแพ็กเกจนับเฉพาะสาขาที่เปิดอยู่ (ปิดสาขาเก่าแล้วเปิดสาขาใหม่แทนได้)
function overBranchLimit(adding) {
  const open = (S.branchItems || []).filter(x => x.status === 'ACTIVE').length;
  if (!adding || open < branchLimit()) return false;
  openModal(`
    <div class="modal-head"><h2>${tr('สาขาครบตามแพ็กเกจแล้ว')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <p>${tr('แพ็กเกจของร้านเปิดสาขาพร้อมกันได้ <b>{n} สาขา</b> (เปิดอยู่ {n2})', { n: fmtNum(branchLimit()), n2: fmtNum(open) })}</p>
    <p class="muted">${tr('ต้องการเพิ่มสาขา ติดต่อผู้ดูแลระบบเพื่ออัปเกรดแพ็กเกจ หรือปิดสาขาที่ไม่ใช้แล้วก่อน')}</p>
    <div class="modal-actions"><button class="btn btn-primary" data-act="close">${tr('ตกลง')}</button></div>`);
  return true;
}

function openBranchEdit(id) {
  if (!isOwner() || !branchFeature()) return;
  const b = id ? (S.branchItems || []).find(x => x.id === id) : null;
  if (id && !b) return;
  if (overBranchLimit(!b)) return;
  openModal(`
    <div class="modal-head"><h2>${b ? tr('แก้ไขสาขา') : tr('เพิ่มสาขา')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <form class="form" data-form="branch" data-id="${esc(b ? b.id : '')}" autocomplete="off">
      <label class="field"><span>${tr('ชื่อสาขา <em>*</em>')}</span><input name="name" value="${esc(b ? b.name : '')}" maxlength="40" placeholder="${tr('เช่น สาขาสยาม')}"></label>
      ${enField(tr('ชื่อสาขา'), 'nameEn', b ? b.nameEn : '', 40, { hint: tr('(ลูกค้าเห็นในเงื่อนไขแต้มพิเศษ "เฉพาะสาขา…")') })}
      <div class="form-grid">
        <label class="field"><span>${tr('ลำดับที่แสดง')}</span><input name="sort" value="${esc(b ? b.sort : '')}" inputmode="numeric" placeholder="${tr('เลขน้อยขึ้นก่อน')}"></label>
        <label class="field"><span>${tr('สถานะ')}</span>
          <select name="status" class="select">
            <option value="ACTIVE" ${!b || b.status === 'ACTIVE' ? 'selected' : ''}>${tr('เปิดอยู่')}</option>
            <option value="INACTIVE" ${b && b.status !== 'ACTIVE' ? 'selected' : ''}>${tr('ปิดสาขา')}</option>
          </select></label>
      </div>
      ${b ? `<p class="muted small">${tr('ปิดสาขาแล้ว พนักงานจะบันทึกให้สาขานี้ไม่ได้ และ QR สมัครของสาขานี้จะนับเป็นสมัครออนไลน์ (ข้อมูลเก่ายังอยู่ครบ)')}</p>` : ''}
      <div class="modal-actions">
        <button class="btn" type="button" data-act="close">${tr('ยกเลิก')}</button>
        <button class="btn btn-primary" type="submit">${tr('บันทึก')}</button>
      </div>
    </form>`);
}

async function saveBranch(form) {
  const branch = formValues(form, ['name', 'sort', 'status']);
  branch.id = form.dataset.id;
  Object.assign(branch, enValues(form, ['nameEn']));
  if (!branch.name) return toast(tr('กรุณากรอกชื่อสาขา'), 'err');
  // เปิดสาขาที่ปิดไปแล้วกลับมา ก็นับเป็นสาขาที่เปิดเพิ่ม
  const before = branch.id ? (S.branchItems || []).find(x => x.id === branch.id) : null;
  if (branch.status === 'ACTIVE' && before && before.status !== 'ACTIVE') {
    const open = S.branchItems.filter(x => x.status === 'ACTIVE').length;
    if (open >= branchLimit()) return toast(`${tr('แพ็กเกจของร้านเปิดได้ {n} สาขา ปิดสาขาอื่นก่อน หรือติดต่อผู้ดูแลระบบเพื่ออัปเกรด', { n: fmtNum(branchLimit()) })}`, 'err');
  }
  const btn = form.querySelector('button[type="submit"]');
  setBusy(btn, true);
  try {
    const r = await withRequestId('branch|' + JSON.stringify(branch), rid => S.api.call('adminBranchSave', { branch, requestId: rid }));
    S.branches = r.items;
    closeModal();
    toast(`${tr('{x} "{name}" แล้ว{x2}', { x: r.created ? tr('เพิ่ม') : tr('บันทึก'), name: r.branch.name, x2: r.created ? tr(' · ตั้งสาขาให้พนักงานได้ที่เมนูพนักงาน') : '' })}`, 'ok');
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
  showLoading(tr('กำลังสร้าง QR...'));
  try {
    await loadScript(QR_JS);
  } catch (e) {
    return toast(tr('สร้าง QR ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'), 'err');
  } finally {
    hideLoading();
  }
  openModal(`
    <div class="modal-head"><h2>${tr('QR สมัครสมาชิก · {name}', { name: esc(b.name) })}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <div class="qr-box branch-qr">${qrSvg(link)}</div>
    <p class="muted small center">${tr('พิมพ์ติดที่เคาน์เตอร์ของสาขานี้ ลูกค้าที่สแกนแล้วสมัครจะนับเป็นสมาชิกของ{name}', { name: esc(b.name) })}</p>
    <div class="copy-row"><code>${esc(link)}</code><button class="btn btn-sm" data-act="copy" data-text="${esc(link)}">${icon('copy', 16)} ${tr('คัดลอก')}</button></div>
    <div class="modal-actions">
      <button class="btn" data-act="close">${tr('ปิด')}</button>
      <button class="btn btn-primary" data-act="branch-qr-save" data-id="${esc(id)}">${icon('download', 16)} ${tr('บันทึกเป็นรูป')}</button>
    </div>`);
}

// รูปสำหรับพิมพ์: ชื่อร้าน + ชื่อสาขา + QR + คำอธิบาย (วาดลง canvas เอง ตัวหนังสือไม่เพี้ยนตามขนาดจอ)
async function saveBranchQr(id, btn) {
  const b = S.branches.find(x => x.id === id);
  if (!b) return;
  setBusy(btn, true, tr('กำลังสร้างรูป...'));
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
    x.font = `700 44px ${font}`; x.fillText(tr('สแกนเพื่อสมัครสมาชิก'), W / 2, 1100, W - 80);
    x.fillStyle = '#666666'; x.font = `400 32px ${font}`; x.fillText(`${tr('สะสม{u}ทุกครั้งที่ซื้อ', { u: unit() })}`, W / 2, 1160, W - 80);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tr('QR-สมัครสมาชิก-{name}.png', { name: b.name })}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(tr('บันทึกรูป QR แล้ว'), 'ok');
  } catch (e) {
    toast(tr('บันทึกรูปไม่สำเร็จ ลองแคปหน้าจอ QR แทนได้'), 'err');
  } finally {
    setBusy(btn, false);
  }
}

/* =====================================================
 * ส่งออกไฟล์ (เฉพาะเจ้าของร้าน) — สร้าง CSV ในเครื่อง เปิดด้วย Excel / Google Sheets ได้
 * ===================================================== */
function confirmExport(kind) {
  if (!isOwner()) return;
  const what = kind === 'members' ? tr('รายชื่อสมาชิกทั้งหมด') : `${tr('รายการแต้ม {x}', { x: rangeText() })}`;
  openModal(`
    <div class="modal-head"><h2>${tr('ส่งออกไฟล์')}</h2><button class="icon-btn" data-act="close" aria-label="${tr('ปิด')}">${icon('x')}</button></div>
    <p><b>${esc(what)}</b></p>
    <p class="notice">${icon('shield', 18)}<span>${tr('ไฟล์นี้มีข้อมูลส่วนตัวของลูกค้า (ชื่อ เบอร์โทร วันเกิด) เก็บไว้ในเครื่องที่ปลอดภัย และอย่าส่งต่อให้คนนอก ตามกฎหมาย PDPA')}</span></p>
    <div class="modal-actions">
      <button class="btn" data-act="close">${tr('ยกเลิก')}</button>
      <button class="btn btn-primary" data-act="export-confirm" data-id="${esc(kind)}">${icon('download', 16)} ${tr('ดาวน์โหลด')}</button>
    </div>`);
}

async function doExport(kind, btn) {
  setBusy(btn, true, tr('กำลังเตรียมไฟล์...'));
  try {
    const r = await S.api.call('adminExport', kind === 'transactions' ? { kind, ...rangeData() } : { kind });
    const name = kind === 'members' ? tr('สมาชิก') : `${tr('รายการแต้ม-{from}-ถึง-{to}', { from: S.range.from, to: S.range.to })}`;
    downloadCsv(`${S.shop.id}-${name}-${todayKey()}.csv`, [r.columns, ...r.rows]);
    closeModal();
    toast(`${tr('ส่งออก {n} แถวแล้ว', { n: fmtNum(r.rows.length) })}`, 'ok');
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
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(tr('คัดลอกแล้ว'), 'ok'), () => toast(text));
  else toast(text);
}
