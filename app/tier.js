// ภาพบัตรของแต่ละระดับ — ใช้ทั้งหน้าสิทธิ์สมาชิก (ลูกค้า) และตัวอย่างในหลังบ้าน ให้หน้าตาตรงกันเสมอ
// ร้านอัปโหลดรูปเองได้ (ขนาดแนะนำ 1200×500) / ไม่มีรูป = วาดจากสีของระดับ (ร้านที่ไม่มีนักออกแบบก็สวยตั้งแต่วันแรก)
import { textOn, shade } from './shop.js';
import { esc, icon } from './ui.js';

const HEX = /^#[0-9A-Fa-f]{6}$/;

// สีไล่ของบัตร: ไล่ไปทางที่ห่างจากสีตัวอักษร (ตัวอักษรขาว → ไล่เข้มลง / ตัวอักษรเข้ม → เริ่มอ่อนกว่า)
// ตัวอักษรจึงอ่านออกทั้งใบไม่ว่าร้านตั้งสีอะไร / สีผิดรูปแบบ → ใช้สีบัตรสมาชิกของร้าน (CSS)
export function tierPaint(color) {
  if (!HEX.test(color || '')) return '';
  const fg = textOn(color);
  const dark = fg === '#FFFFFF';
  const a = dark ? color : shade(color, 0.3);
  const b = dark ? shade(color, -0.35) : shade(color, -0.08);
  return `background:linear-gradient(135deg,${a},${b});color:${fg}`;
}

// t = { name, color, multiplier, image } / logo = HTML โลโก้ร้าน / unit = คำเรียกแต้มของร้าน
export function tierBanner(t, { logo = '', shopName = '', unit = 'แต้ม' } = {}) {
  if (t.image) {
    return `<div class="tier-banner has-img"><img src="${esc(t.image)}" alt="บัตรระดับ ${esc(t.name)}" loading="lazy" referrerpolicy="no-referrer"></div>`;
  }
  return `<div class="tier-banner" style="${tierPaint(t.color)}">
      <span class="tb-crown">${icon('crown', 120)}</span>
      <span class="tb-top">${logo}<span>${esc(shopName)}</span></span>
      <span class="tb-name">${esc(t.name)}<small>MEMBER</small></span>
      ${t.multiplier > 1 ? `<span class="tb-mult">${esc(unit)} ×${t.multiplier}</span>` : ''}
    </div>`;
}
