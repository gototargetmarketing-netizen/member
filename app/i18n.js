// สองภาษา ไทย / อังกฤษ (ผู้ใช้ขอ 19 พ.ย. 2569 — รอบ 1 หน้าลูกค้า)
//
// ใช้ "ข้อความภาษาไทย" เป็นกุญแจของคำแปล เช่น t('แลกของรางวัล')
//   • อ่านโค้ดแล้วเห็นข้อความจริงเลย ไม่ต้องตั้งชื่อกุญแจหลายร้อยชื่อแล้วไปเปิดหาอีกไฟล์
//   • ภาษาไทยไม่ต้องมีพจนานุกรม / คำไหนยังไม่มีคำแปล → แสดงภาษาไทย (tools/test/i18n-test.js ตรวจว่าแปลครบ)
//   • คำไทยเดียวกันแต่ภาษาอังกฤษต่างกันตามที่ใช้ → ต่อท้ายด้วย @@บริบท เช่น t('แลกของรางวัล@@ปุ่ม') = "Redeem"
//     (ภาษาไทยตัด @@... ทิ้งก่อนแสดง)
//   • ช่องแทนค่า {ชื่อ} เช่น t('ใช้ได้ถึง {date}', { date }) — ค่าที่ใส่ต้อง esc() เองถ้าจะเอาไปใส่ใน HTML
//
// เปิดได้เฉพาะร้านที่เปิดสวิตช์ features.english ในไฟล์ร้าน (ผู้ใช้เป็นคนเปิดให้ — ร้านต้องเติมข้อความภาษาอังกฤษของร้านเอง)
// ร้านที่ไม่เปิด = ภาษาไทยเสมอ ไม่มีปุ่มสลับ (เหมือนก่อนมีระบบนี้ทุกอย่าง)
import EN from './i18n-en.js';

const KEY = 'crm_lang';
const SUPPORTED = ['th', 'en'];
let lang = 'th';
let enabled = false;
let chosen = false; // ลูกค้าเลือกเอง (ปุ่ม / ลิงก์ ?lang=) แล้ว → ไม่เปลี่ยนตามภาษาของแอป LINE

export const getLang = () => lang;
export const isEn = () => lang === 'en';
export const langEnabled = () => enabled;

function readSaved() {
  try { const v = localStorage.getItem(KEY); return SUPPORTED.includes(v) ? v : ''; } catch (e) { return ''; }
}

function apply(l) {
  lang = SUPPORTED.includes(l) ? l : 'th';
  document.documentElement.lang = lang;
}

// เรียกหลังโหลดไฟล์ร้าน (ก่อนเชื่อมต่อ LINE): ลิงก์ ?lang=en → ที่ลูกค้าเลือกไว้ในเครื่อง → ไทย
export function initLang(config) {
  enabled = !!(config && config.features && config.features.english === true);
  if (!enabled) { chosen = false; apply('th'); return; }
  const q = new URLSearchParams(window.location.search);
  // เปิดผ่าน liff.line.me ครั้งแรก ค่ายังซ่อนอยู่ใน liff.state
  const inner = q.get('liff.state');
  const fromUrl = q.get('lang') || (inner ? new URLSearchParams(inner.replace(/^[^?]*\?/, '')).get('lang') : '');
  if (SUPPORTED.includes(fromUrl)) { save(fromUrl); return; }
  const saved = readSaved();
  chosen = !!saved;
  apply(saved || 'th');
}

// หลังเชื่อมต่อ LINE: ยังไม่เคยเลือกเอง → ใช้ภาษาของแอป LINE ในเครื่องลูกค้า (ไทย = ไทย / ภาษาอื่น = อังกฤษ)
// ไม่รู้ภาษาของแอป (เช่น ทดสอบในเครื่อง) → ไทยตามเดิม — ไม่ใช้ภาษาของเบราว์เซอร์ เพราะคอมทดสอบมักตั้งเป็นอังกฤษ
export function autoLang(appLang) {
  if (!enabled || chosen || !appLang) return;
  apply(String(appLang).toLowerCase().startsWith('th') ? 'th' : 'en');
}

// ลูกค้ากดปุ่มสลับ → จำไว้ในเครื่อง (ใช้ร่วมกันทุกร้าน: คนที่อ่านไทยไม่ได้ อยากได้อังกฤษทุกร้าน)
export function save(l) {
  if (!SUPPORTED.includes(l)) return;
  chosen = true;
  try { localStorage.setItem(KEY, l); } catch (e) { /* เก็บไม่ได้ ครั้งหน้าก็เลือกใหม่ */ }
  apply(l);
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s);

export function t(th, vars) {
  const key = String(th);
  if (lang === 'en' && Object.prototype.hasOwnProperty.call(EN, key)) return fill(EN[key], vars);
  return fill(key.replace(/@@.*$/, ''), vars);
}

// ปุ่ม TH | EN (ร้านไม่เปิดสวิตช์ = ไม่มีปุ่ม) — หน้าเว็บจับ data-act="lang" แล้วเรียก save() + วาดหน้าใหม่
export function langSwitchHtml(cls = '') {
  if (!enabled) return '';
  return `<div class="lang-switch ${cls}" role="group" aria-label="ภาษา / Language">${SUPPORTED.map(l =>
    `<button type="button" data-act="lang" data-lang="${l}" aria-pressed="${l === lang}" lang="${l}">${l.toUpperCase()}</button>`).join('')}</div>`;
}

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthNames = () => (lang === 'en' ? EN_MONTHS : TH_MONTHS);

// วันที่: ไทย = พ.ศ. (th-TH) / อังกฤษ = ค.ศ. แบบ 19 Nov 2026 (en-GB อ่านง่ายกว่าแบบอเมริกันที่เดือนขึ้นก่อน)
export const dateLocale = () => (lang === 'en' ? 'en-GB' : 'th-TH');
