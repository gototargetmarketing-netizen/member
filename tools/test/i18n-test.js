// ตรวจระบบสองภาษา (19 พ.ย. 2569): ข้อความทุกจุดที่เปิดภาษาอังกฤษได้มีคำแปลครบ + ช่องแทนค่าตรงกัน + ตัวกลางแปลข้อความผิดพลาด
// ใช้: node tools/test/i18n-test.js (ไม่ต้องเปิดเซิร์ฟเวอร์ / เบราว์เซอร์)
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label + (extra !== undefined ? '\n      ' + JSON.stringify(extra).slice(0, 600) : '')); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// {U} {u1} = คำเรียกแต้มรูปอื่น ที่ tu / tt ใส่ให้เองพร้อม {u} → นับเป็นช่องเดียวกัน
const holes = (s) => new Set((String(s).match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1)).map((h) => (h === 'U' || h === 'u1' ? 'u' : h)));
const THAI = /[\u0E00-\u0E3E\u0E40-\u0E7F]/; // อักษรไทย ยกเว้น ฿ (U+0E3F ใช้ในภาษาอังกฤษด้วย)

// ข้อความในเครื่องหมายคำพูดเดี่ยว (รองรับ \' ข้างใน) ที่เป็นอาร์กิวเมนต์แรกของฟังก์ชันที่ระบุ
function literalCalls(src, names) {
  const out = [];
  const re = new RegExp(`(?<![\\w.])(?:${names.join('|')})\\('((?:[^'\\\\]|\\\\.)*)'`, 'g');
  let m;
  while ((m = re.exec(src))) out.push(m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n'));
  return out;
}
// ค่าในวัตถุแบบ { KEY: 'ข้อความ', ... } (LOADING_TEXT / TX_LABEL) — ส่งเข้า tt() ทีหลัง
function objectValues(src, name) {
  const m = src.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`));
  return m ? [...m[1].matchAll(/:\s*'([^']*)'/g)].map((x) => x[1]) : [];
}

(async () => {
  const EN = (await import(pathToFileURL(path.join(ROOT, 'app', 'i18n-en.js')).href)).default;

  console.log('\n[1] หน้าลูกค้า: ทุกข้อความมีคำแปล');
  const cust = read('app/customer.js');
  const keys = new Set([
    ...literalCalls(cust, ['tu', 'tt']),
    ...objectValues(cust, 'LOADING_TEXT'),
    ...objectValues(cust, 'TX_LABEL'),
    'กำลังโหลด...', // ค่าตั้งต้นของ loadingText
    (cust.match(/const PHONE_MSG = '([^']*)'/) || [])[1],
    // รายละเอียดประวัติที่ txDetail แปล (ข้อความเดียวกับที่ตัวกลางเขียนลงฐานข้อมูล)
    'แต้มต้อนรับสมาชิกใหม่', 'แต้มรับข่าวสารจากร้าน'
  ]);
  ['app/ui.js', 'app/api.js', 'app/line.js'].forEach((f) => literalCalls(read(f), ['t']).forEach((k) => keys.add(k)));
  literalCalls(read('app/tier.js'), ['tr']).forEach((k) => keys.add(k));
  const missing = [...keys].filter((k) => k && !Object.prototype.hasOwnProperty.call(EN, k));
  ok(keys.size > 200 && missing.length === 0, `ข้อความ ${keys.size} จุด มีคำแปลภาษาอังกฤษครบ`, missing);

  console.log('\n[2] คำแปลถูกรูปแบบ');
  const badHoles = Object.entries(EN).filter(([th, en]) => [...holes(en)].some((h) => !holes(th).has(h)));
  ok(badHoles.length === 0, 'ช่องแทนค่า {..} ในคำแปล มีอยู่ในข้อความภาษาไทยด้วย (ไม่มีช่องที่โค้ดไม่ได้ใส่ค่า)', badHoles);
  const thaiLeft = Object.entries(EN).filter(([, en]) => THAI.test(en));
  ok(thaiLeft.length === 0, 'คำแปลไม่มีอักษรไทยหลงเหลือ', thaiLeft);
  const tags = (s) => (String(s).match(/<\/?b>/g) || []).join('');
  const badTags = Object.entries(EN).filter(([th, en]) => tags(th) !== tags(en));
  ok(badTags.length === 0, 'ตัวหนา <b> ในคำแปลตรงกับภาษาไทย (ไม่มีแท็กเปิดค้าง)', badTags);
  const unused = Object.keys(EN).filter((k) => !keys.has(k) && !/^(แลก \{name\}|ซื้อสินค้า ฿\{amount\}| \(ไม่ถึงเกณฑ์รับแต้ม\))$/.test(k));
  ok(unused.length === 0, 'ไม่มีคำแปลที่ไม่ได้ใช้ (ข้อความในโค้ดเปลี่ยนแล้วคำแปลไม่ตามจะฟ้องที่นี่)', unused);
  // customer.js เรียกผ่าน tu/tt เท่านั้น — หลายฟังก์ชันมีตัวแปรชื่อ t (ข้อมูลระดับ / รายการแต้ม) เรียก t() ตรงๆ จะพังเงียบๆ
  const bare = cust.split('\n').filter((l) => /(?<![\w.])t\('/.test(l) && !/^const (tu|tt) = /.test(l.trim()));
  ok(bare.length === 0, 'customer.js ไม่เรียก t() ตรงๆ (ใช้ tu / tt)', bare);

  console.log('\n[3] ตัวช่วยแปล (app/i18n.js)');
  const store = {};
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  global.document = { documentElement: {} };
  global.window = { location: { search: '' } };
  const I = await import(pathToFileURL(path.join(ROOT, 'app', 'i18n.js')).href);
  I.initLang({ features: {} });
  ok(I.getLang() === 'th' && !I.langEnabled() && I.langSwitchHtml() === '', 'ร้านไม่เปิดสวิตช์ english → ไทยเสมอ ไม่มีปุ่มสลับ');
  store.crm_lang = 'en';
  I.initLang({ features: {} });
  ok(I.getLang() === 'th', 'ร้านไม่เปิด แม้เครื่องเคยเลือกอังกฤษ (ร้านอื่น) → ยังเป็นไทย');
  ok(I.t('แลกของรางวัล@@ปุ่ม') === 'แลกของรางวัล' && I.t('ใช้ได้ถึง {date}', { date: '1 ม.ค.' }) === 'ใช้ได้ถึง 1 ม.ค.', 'ภาษาไทย: ตัด @@บริบท ทิ้ง + ใส่ค่าในช่อง');
  delete store.crm_lang;
  I.initLang({ features: { english: true } });
  I.autoLang('');
  ok(I.getLang() === 'th' && I.langEnabled() && /data-lang="en"/.test(I.langSwitchHtml()), 'ร้านเปิด + ไม่รู้ภาษาของแอป LINE → ไทย (มีปุ่มสลับ)');
  I.autoLang('en-US');
  ok(I.getLang() === 'en' && global.document.documentElement.lang === 'en', 'แอป LINE เป็นภาษาอังกฤษ → อังกฤษ (ตั้ง lang ของหน้าให้ด้วย)');
  I.autoLang('ja');
  ok(I.getLang() === 'en', 'แอป LINE ภาษาอื่น (ญี่ปุ่น) → อังกฤษ');
  ok(I.t('แลกของรางวัล@@ปุ่ม') === 'Redeem' && I.t('แลกของรางวัล') === 'Rewards', 'คำไทยเดียวกัน คนละบริบท → คำอังกฤษต่างกัน');
  ok(I.t('ข้อความที่ยังไม่มีคำแปล') === 'ข้อความที่ยังไม่มีคำแปล', 'ยังไม่มีคำแปล → แสดงภาษาไทย (ไม่ว่างเปล่า)');
  ok(I.monthNames()[0] === 'January' && I.dateLocale() === 'en-GB', 'อังกฤษ: ชื่อเดือนอังกฤษ + วันที่ปี ค.ศ.');
  I.save('th');
  I.autoLang('en-US');
  ok(I.getLang() === 'th' && store.crm_lang === 'th', 'ลูกค้ากดเลือกไทยเอง → จำไว้ ไม่เปลี่ยนตามภาษาของแอป LINE');
  global.window.location.search = '?lang=en';
  I.initLang({ features: { english: true } });
  ok(I.getLang() === 'en' && store.crm_lang === 'en', 'ลิงก์ ?lang=en → อังกฤษ และจำไว้');
  global.window.location.search = '?liff.state=' + encodeURIComponent('/demo?lang=th');
  I.initLang({ features: { english: true } });
  ok(I.getLang() === 'th', 'เปิดผ่าน liff.line.me ครั้งแรก (ค่าอยู่ใน liff.state) → อ่านได้');

  console.log('\n[4] ตัวกลาง: แปลข้อความผิดพลาดที่ลูกค้าเห็น');
  const T = require(path.join(ROOT, 'api', '_lib', 'i18n.js'));
  const files = ['router.js', 'members.js', 'customer.js', 'util.js'];
  const statics = [];
  files.forEach((f) => {
    const src = read('api/_lib/' + f);
    // ข้อความคงที่: userError('...', → ต้องแปลได้ / ข้อความที่ต่อค่า (userError('...' + x) ตรวจด้วยตัวอย่างข้างล่าง
    for (const m of src.matchAll(/userError\('((?:[^'\\]|\\.)*)'\s*,/g)) statics.push(m[1].replace(/\\'/g, "'"));
  });
  statics.push('ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง', 'คำขอไม่ถูกต้อง');
  const untranslated = statics.filter((s) => T.translate(s, 'en') === s);
  ok(statics.length >= 35 && untranslated.length === 0, `ข้อความคงที่ ${statics.length} ข้อความ (ลูกค้า + ส่วนกลาง) แปลได้ครบ`, untranslated);
  const samples = [
    ['แต้มไม่พอ ต้องใช้ 1,200 แต้ม (มีอยู่ 300)', 'Not enough points: this needs 1,200 points (you have 300)'],
    ['ของรางวัลนี้สำหรับสมาชิกระดับ Gold ขึ้นไป', 'This reward is for Gold members and above'],
    ['คุณแลกรางวัลนี้ครบ 2 ครั้งแล้ว', 'You have reached the limit of 2 redemptions for this reward'],
    ['ของขวัญวันเกิดสำหรับสมาชิกที่สมัครครบ 30 วันขึ้นไป', 'The birthday gift is for members who joined at least 30 days ago'],
    ['กรุณากรอกชื่อ', 'Please enter your first name'],
    ['นามสกุลยาวเกิน 40 ตัวอักษร', 'Last name is too long (max 40 characters)'],
    ['ชื่อต้องไม่มีตัวเลข', 'First name cannot contain numbers']
  ];
  const wrong = samples.filter(([th, en]) => T.translate(th, 'en') !== en).map(([th]) => [th, T.translate(th, 'en')]);
  ok(wrong.length === 0, 'ข้อความที่มีตัวเลข/ชื่อแทรก แปลถูก', wrong);
  ok(T.translate('กรุณากรอกหมายเหตุ', 'en') === 'กรุณากรอกหมายเหตุ', 'ชื่อช่องที่ไม่รู้จัก → ไม่แปลทั้งข้อความ (ไม่ให้ไทยปนอังกฤษ)');
  ok(T.translate('ไม่พบสมาชิก', 'th') === 'ไม่พบสมาชิก' && T.translate('ไม่พบสมาชิก', undefined) === 'ไม่พบสมาชิก', 'ไม่ได้ขอภาษาอังกฤษ → ภาษาไทยตามเดิม');
  ok(T.langOf({ lang: 'en' }) === 'en' && T.langOf({ lang: 'fr' }) === 'th' && T.langOf(null) === 'th', 'lang รู้จักแค่ en (ค่าอื่น = ไทย)');
  const enThai = Object.entries(T.EN).filter(([, en]) => THAI.test(en));
  ok(enThai.length === 0, 'คำแปลของตัวกลางไม่มีอักษรไทย', enThai);

  console.log('\n[5] ตัวกลางตอบตามภาษาที่ขอ');
  const { createApp } = require(path.join(ROOT, 'api', '_lib', 'router.js'));
  const app = createApp({ db: () => { throw new Error('ไม่ควรถึงฐานข้อมูล'); }, allowTestTokens: false });
  let r = await app.handle({ action: 'ไม่มีคำสั่งนี้', lang: 'en' });
  ok(!r.ok && r.code === 'UNKNOWN_ACTION' && r.error === 'Unknown request', 'lang: en → ข้อความผิดพลาดภาษาอังกฤษ (รหัสเดิม)', r);
  r = await app.handle({ action: 'ไม่มีคำสั่งนี้' });
  ok(!r.ok && r.error === 'ไม่รู้จักคำสั่งนี้', 'ไม่ส่ง lang → ภาษาไทยเหมือนเดิม (ระบบเดิม / หน้าพนักงาน / หลังบ้าน)', r);

  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
