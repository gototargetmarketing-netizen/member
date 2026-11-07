// ค่าของร้าน (เดิม: ชีต Settings) — อ่านจากตาราง shops แถวเดียว
// แปลงให้ได้รูปเดียวกับ cfg_() และ publicBrand_() ใน code.gs → หน้าเว็บไม่ต้องรู้ว่าหลังบ้านเปลี่ยน
const { toNum, safeUrl, driveImage, cleanLongText } = require('./util');

// ::float8 = ให้ตัวเลขทศนิยมออกมาเป็น number ทั้งใน pg และ PGlite (ไม่งั้น pg คืนเป็นข้อความ)
const SHOP_SQL = `
select id, name, liff_id, member_prefix, point_rate_baht::float8 as point_rate_baht, welcome_points,
       max_purchase::float8 as max_purchase, confirm_purchase_over::float8 as confirm_purchase_over,
       coupon_days, history_limit, consent_version, brand, status, tier_intro
from shops where id = $1`;

// ร้านที่ติดตั้งก่อนมีหน้าตาร้านในหลังบ้าน ใช้คำนี้เป็นชื่อตั้งต้น → ถือว่า "ยังไม่ได้ตั้ง"
const LEGACY_SHOP_NAME = 'ร้านของฉัน';
const THEMES = ['luxury', 'minimal'];

const posNum = (v, fallback) => { const n = Number(v); return isFinite(n) && n > 0 ? n : fallback; };

// ค่าผิดรูปแบบใช้ค่าเริ่มต้นแทน (ระบบไม่ล่มเพราะค่าร้านผิด) — เหมือน cfg_() ใน code.gs
function cfg(shop) {
  const prefix = String(shop.member_prefix || '').toUpperCase();
  return {
    shopName: shop.name || LEGACY_SHOP_NAME,
    memberPrefix: /^[A-Z]{1,4}$/.test(prefix) && prefix !== 'CP' && prefix !== 'TX' ? prefix : 'M',
    pointRate: posNum(shop.point_rate_baht, 20),
    maxPurchase: posNum(shop.max_purchase, 20000),
    confirmOver: posNum(shop.confirm_purchase_over, 3000),
    welcomePoints: Math.max(0, Math.floor(toNum(shop.welcome_points))),
    couponDays: Math.max(1, Math.floor(posNum(shop.coupon_days, 30))),
    consentVersion: String(shop.consent_version || '1'),
    historyLimit: Math.min(200, Math.max(10, Math.floor(posNum(shop.history_limit, 50))))
  };
}

// หน้าตาร้านที่หน้าเว็บใช้แสดง (ตรวจรูปแบบอีกชั้น ไม่เชื่อค่าที่เก็บไว้)
function publicBrand(shop) {
  const b = shop.brand && typeof shop.brand === 'object' ? shop.brand : {};
  const colors = b.colors || {};
  const texts = b.texts || {};
  const color = (v) => (/^#[0-9A-Fa-f]{6}$/.test(String(v || '')) ? String(v).toUpperCase() : '');
  const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);
  const name = text(shop.name, 60);
  const theme = String(b.theme || '').trim();
  return {
    name: name === LEGACY_SHOP_NAME ? '' : name,
    logo: safeUrl(driveImage(b.logo)),
    theme: THEMES.indexOf(theme) >= 0 ? theme : '',
    colors: { primary: color(colors.primary), button: color(colors.button), accent: color(colors.accent), card: color(colors.card) },
    texts: {
      pointUnit: text(texts.pointUnit, 20),
      greeting: text(texts.greeting, 60),
      registerTitle: text(texts.registerTitle, 80),
      registerSubtitle: text(texts.registerSubtitle, 150)
    },
    privacyText: cleanLongText(b.privacyText, 3000),
    consentVersion: String(shop.consent_version || '1')
  };
}

module.exports = { SHOP_SQL, cfg, publicBrand, LEGACY_SHOP_NAME, THEMES };
