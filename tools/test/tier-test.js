// ทดสอบระดับสมาชิก (ขั้น 4) บนฐานข้อมูลจำลอง + นาฬิกาจำลอง (เลื่อนเวลาไปดูการลดระดับได้)
// ระดับนับจาก "แต้มจากการซื้อ" 12 เดือน (7 พ.ย. 2569) — ร้านทดสอบ 20 บาท = 1 แต้ม: Silver 250 แต้ม (≈ ฿5,000) / Gold 1,000 แต้ม (≈ ฿20,000)
// ระบบเดิมไม่มีระดับ จึงเทียบคู่ไม่ได้ → ตรวจกติกาที่ผู้ใช้ตกลงไว้ทีละข้อแทน
// รัน: node tools/test/tier-test.js
const path = require('path');
const crypto = require('crypto');
const { createTestDb } = require('./pglite-db');
const ROOT = path.join(__dirname, '..', '..');
const { createApp } = require(path.join(ROOT, 'api', '_lib', 'router.js'));
const U = require(path.join(ROOT, 'api', '_lib', 'util.js'));
const T = require(path.join(ROOT, 'api', '_lib', 'tiers.js'));

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')); } };
const MONTH = 30.5 * U.DAY_MS;

(async () => {
  const db = await createTestDb({ withDemo: false });
  const SHOP = 'tier1';
  await db.query(`insert into shops (id, name, member_prefix, welcome_points) values ($1, 'ร้านทดสอบระดับ', 'TR', 0)`, [SHOP]);
  await db.query(`insert into staff (shop_id, line_user_id, name, role, status) values
    ($1, 'O', 'เจ้าของ', 'OWNER', 'ACTIVE'), ($1, 'A', 'ผู้จัดการ', 'ADMIN', 'ACTIVE'), ($1, 'C', 'แคชเชียร์', 'CASHIER', 'ACTIVE')`, [SHOP]);
  let clock = Date.parse('2026-03-10T05:00:00Z'); // 10 มี.ค. 2569 เวลาไทยบ่าย
  // นาฬิกาเดินทีละ 1 วินาทีทุกคำสั่ง (เหมือนของจริงที่รายการเกิดคนละเวลา) + เลื่อนข้ามเดือนได้
  const app = createApp({ db: () => db, verifier: {}, allowTestTokens: true, region: 'test', now: () => (clock += 1000) });
  const log = console.log;
  console.log = (...a) => { if (/^ {2}[✓✗]|^\n?\[/.test(String(a[0]))) log(...a); }; // ซ่อนบันทึกของระบบ
  const call = (user, action, body) => app.handle(Object.assign({ shop: SHOP, idToken: `TEST:${user}:${user}`, action, requestId: crypto.randomUUID() }, body || {}));
  const reg = (user, phone, birth) => call(user, 'register', { consentPrivacy: true, firstName: 'ลูกค้า', lastName: 'ทดสอบ', birthDate: birth || '1990-01-15', phone });
  const buy = (memberId, amount) => call('C', 'addPurchase', { memberId, amount });
  const ids = {};
  const tierOf = async (u) => (await db.query(`select tier_id, to_char(tier_until, 'YYYY-MM-DD') as until from members where shop_id = $1 and id = $2`, [SHOP, ids[u]])).rows[0];

  try {
    console.log('\n[1] ร้านที่ยังไม่เปิดใช้ระดับ → เหมือนเดิมทุกอย่าง');
    let r = await reg('U1', '0811111111');
    ids.U1 = r.member.memberId;
    ids.U2 = (await reg('U2', '0822222222')).member.memberId;
    ok(r.ok && r.member.tier === '' && !('tierInfo' in r.member), 'สมัคร: ไม่มีระดับ');
    r = await call('U1', 'bootstrap');
    ok(r.ok && !('tiers' in r) && r.member.tier === '' && !('locked' in (r.rewards[0] || {})), 'หน้าลูกค้า: ไม่มีข้อมูลระดับ', r);
    r = await call('O', 'adminTiers');
    ok(r.ok && r.enabled === false && r.items.length === 0, 'หลังบ้าน: ยังไม่เปิดใช้ระดับ');
    await buy(ids.U1, 6000);
    r = await buy(ids.U1, 1000);
    ok(r.ok && r.pointsAdded === 50 && !('tierUp' in r) && !('tierId' in r.member), 'บันทึกยอด: แต้มปกติ ไม่มีข้อมูลระดับ', r);

    console.log('\n[2] ตั้งระดับ: ตรวจข้อมูล');
    const t3 = [{ name: 'Member', minPoints: 0, multiplier: 1 }, { name: 'Silver', minPoints: 250, multiplier: 1.5, color: '#c0c0c0' }, { name: 'Gold', minPoints: '1,000', multiplier: 2, color: '#D4AF37' }];
    const bad = async (label, tiers, code, user) => { const x = await call(user || 'O', 'adminTiersSave', { tiers }); ok(!x.ok && x.code === code, label + ' → ' + code, x); };
    await bad('ผู้จัดการตั้งไม่ได้', t3, 'NO_ROLE', 'A');
    await bad('ระดับเดียว', [t3[0]], 'BAD_INPUT');
    await bad('6 ระดับ', [0, 1, 2, 3, 4, 5].map((i) => ({ name: 'L' + i, minPoints: i * 100 })), 'BAD_INPUT');
    await bad('ระดับแรกไม่ใช่ 0 แต้ม', [{ name: 'A', minPoints: 100 }, { name: 'B', minPoints: 200 }], 'BAD_INPUT');
    await bad('ยอดซ้ำ', [{ name: 'A', minPoints: 0 }, { name: 'B', minPoints: 0 }], 'BAD_INPUT');
    await bad('ชื่อซ้ำ', [{ name: 'Gold', minPoints: 0 }, { name: 'gold', minPoints: 10 }], 'BAD_INPUT');
    await bad('ตัวคูณ ×5', [{ name: 'A', minPoints: 0 }, { name: 'B', minPoints: 10, multiplier: 5 }], 'BAD_INPUT');
    await bad('สีผิดรูปแบบ', [{ name: 'A', minPoints: 0 }, { name: 'B', minPoints: 10, color: 'red' }], 'BAD_INPUT');
    await bad('ไม่มีชื่อ', [{ name: '', minPoints: 0 }, { name: 'B', minPoints: 10 }], 'BAD_INPUT');
    await bad('แต้มมีทศนิยม', [{ name: 'A', minPoints: 0 }, { name: 'B', minPoints: 10.5 }], 'BAD_INPUT');
    await bad('สิทธิพิเศษเกิน 8 ข้อ', [{ name: 'A', minPoints: 0 }, { name: 'B', minPoints: 10, benefits: 'ก\nข\nค\nง\nจ\nฉ\nช\nซ\nฌ' }], 'BAD_INPUT');
    await bad('รูปบัตรไม่ใช่ https', [{ name: 'A', minPoints: 0 }, { name: 'B', minPoints: 10, image: 'http://x.com/a.png' }], 'BAD_IMAGE');

    console.log('\n[3] เปิดใช้ระดับ → จัดระดับสมาชิกเดิมตามแต้มจากการซื้อ 12 เดือน');
    r = await call('O', 'adminTiersSave', { tiers: t3 });
    ok(r.ok && r.enabled && r.items.map((x) => x.id + ':' + x.name + ':' + x.minPoints + ':' + x.multiplier + ':' + x.color).join(',') ===
      'T1:Member:0:1:,T2:Silver:250:1.5:#C0C0C0,T3:Gold:1000:2:#D4AF37', 'บันทึก 3 ระดับ (รหัส T1–T3 / สีตัวใหญ่)', r.items);
    ok(r.items[1].members === 1 && r.items[0].members === 1 && r.pointRate === 20, 'U1 (ซื้อ 7,000 = 350 แต้ม) → Silver / U2 → Member', r.items);
    ok((await tierOf('U1')).until === '2027-03-10' && (await tierOf('U2')).until === null, 'Silver คงถึง 10 มี.ค. 2570 (12 เดือน) / ระดับแรกไม่มีวันหมดอายุ');
    const h = (await db.query(`select reason, to_tier_id from tier_history where shop_id = $1 and member_id = $2`, [SHOP, ids.U1])).rows;
    ok(h.length === 1 && h[0].reason === 'START' && h[0].to_tier_id === 'T2', 'จดประวัติเริ่มระดับ (START)', h);
    r = await call('U1', 'bootstrap');
    ok(r.member.tier === 'Silver' && r.member.tierInfo.next.name === 'Gold' && r.member.tierInfo.next.remaining === 650 &&
      r.member.tierInfo.points12m === 350 && r.member.tierInfo.next.minPoints === 1000 && r.tiers.length === 3, 'หน้าลูกค้า: ระดับ Silver + อีก 650 แต้มถึง Gold', r.member.tierInfo);
    ids.U3 = (await reg('U3', '0833333333')).member.memberId;
    ok((await tierOf('U3')).tier_id === 'T1', 'สมัครใหม่หลังเปิดระดับ → เริ่มที่ระดับแรก');

    console.log('\n[4] ตัวคูณแต้มของระดับ (ไม่ซ้อนกับแต้มพิเศษ ใช้ตัวที่มากกว่า)');
    r = await buy(ids.U1, 1000);
    ok(r.pointsAdded === 75 && r.basePoints === 50 && r.rule && r.rule.name === 'ระดับ Silver' && r.rule.multiplier === 1.5 && r.member.tierId === 'T2',
      'Silver ×1.5: ยอด 1,000 → 75 แต้ม (บอกว่าได้เพราะระดับ)', r);
    const tx = (await db.query(`select detail, ref from transactions where shop_id = $1 and id = $2`, [SHOP, r.txId])).rows[0];
    ok(/· ระดับ Silver$/.test(tx.detail) && tx.ref === 'T2', 'ประวัติบอก "ระดับ Silver"', tx);
    r = await buy(ids.U3, 1000);
    ok(r.pointsAdded === 50 && r.rule === null, 'Member ×1: ไม่มีตัวคูณ');
    const day = U.dayCode(new Date(clock));
    r = await call('O', 'adminRuleSave', { rule: { name: 'วันนี้ ×2', multiplier: 2, days: [day], status: 'ACTIVE' } });
    r = await buy(ids.U1, 1000);
    ok(r.pointsAdded === 100 && r.rule.name === 'วันนี้ ×2', 'แต้มพิเศษ ×2 มากกว่า Silver ×1.5 → ใช้แต้มพิเศษ (ไม่ซ้อนเป็น ×3)', r);
    const bx = (await db.query(`select points, base_points from transactions where shop_id = $1 and id = $2`, [SHOP, r.txId])).rows[0];
    ok(bx.points === 100 && bx.base_points === 50, 'จดแต้มปกติของบิล (50) แยกจากแต้มที่ได้จริง (100) — นับระดับจากแต้มปกติ', bx);
    r = await call('O', 'adminRuleSave', { rule: { id: 'PR001', name: 'วันนี้ ×2', multiplier: 2, days: [day], status: 'ACTIVE', minTierId: 'T3' } });
    ok(r.ok && r.rule.minTierId === 'T3' && r.rule.minTierName === 'Gold', 'กติกาตั้ง "ตั้งแต่ Gold ขึ้นไป"', r.rule);
    r = await buy(ids.U1, 1000);
    ok(r.pointsAdded === 75 && r.rule.name === 'ระดับ Silver', 'Silver ไม่ได้กติกาของ Gold → ได้ตัวคูณของระดับตัวเอง', r);
    r = await call('C', 'staffMe');
    ok(r.tiers.length === 3 && r.rules.find((x) => x.id === 'PR001').minTierId === 'T3', 'หน้าพนักงาน: ได้ตัวคูณทุกระดับ + ระดับขั้นต่ำของกติกา (ไว้คิดตัวอย่างแต้ม)');
    r = await call('C', 'staffLookup', { query: '0811111111' });
    ok(r.member.tier === 'Silver' && r.member.tierId === 'T2' && r.member.tierMultiplier === 1.5, 'พนักงานค้นลูกค้า: เห็นระดับ + ตัวคูณ', r.member);

    console.log('\n[5] ขึ้นระดับทันทีเมื่อแต้มจากการซื้อ 12 เดือนถึงเกณฑ์ (แต้มพิเศษ/ตัวคูณไม่นับ)');
    r = await buy(ids.U1, 9000);
    ok(r.ok && !r.tierUp, 'แต้มจากการซื้อรวม 950 → ยังไม่ถึง Gold (แต้มที่ได้จริงเกินพันแล้วเพราะตัวคูณ แต่ไม่นับ)');
    r = await buy(ids.U1, 1000);
    ok(r.tierUp && r.tierUp.name === 'Gold' && r.member.tierId === 'T3' && r.pointsAdded === 75, 'ครบ 1,000 แต้ม → ขึ้น Gold ทันที (บิลนี้ยังคิดตัวคูณ Silver)', r);
    ok((await tierOf('U1')).until === '2027-03-10', 'Gold คงถึง 12 เดือนนับจากวันที่ขึ้น');
    r = await buy(ids.U1, 1000);
    ok(r.pointsAdded === 100, 'บิลถัดไป: Gold ×2 (เท่ากับกติกา ×2 ของ Gold → ใช้ชื่อกติกา)', r.rule);

    console.log('\n[6] ของรางวัล / โปรโมชันตามระดับ (แสดงแต่ล็อก)');
    r = await call('O', 'adminRewardSave', { reward: { name: 'ของ Gold', points: 10, status: 'ACTIVE', minTierId: 'T3' } });
    ok(r.ok && r.reward.minTierId === 'T3' && r.reward.minTierName === 'Gold', 'ตั้งของรางวัลเฉพาะ Gold');
    const goldReward = r.reward.id;
    r = await call('O', 'adminRewardSave', { reward: { name: 'x', points: 10, status: 'ACTIVE', minTierId: 'T9' } });
    ok(!r.ok && r.code === 'BAD_TIER', 'ระดับที่ไม่มี → BAD_TIER');
    r = await call('O', 'adminPromoSave', { promo: { title: 'โปร Silver ขึ้นไป', status: 'ACTIVE', minTierId: 'T2' } });
    ok(r.ok && r.promo.minTierName === 'Silver', 'ตั้งโปรโมชันตั้งแต่ Silver');
    r = await call('U3', 'bootstrap');
    const lockedR = r.rewards.find((x) => x.id === goldReward);
    const lockedP = r.promos.find((x) => x.title === 'โปร Silver ขึ้นไป');
    ok(lockedR && lockedR.locked === true && lockedR.minTier.name === 'Gold' && lockedP && lockedP.locked === true, 'Member เห็นของ Gold / โปร Silver แต่ล็อก', { lockedR, lockedP });
    await call('O', 'adjustPoints', { memberId: ids.U3, points: 100, reason: 'ทดสอบ' });
    ok((await call('U3', 'bootstrap')).member.tierInfo.points12m === 50, 'แต้มที่ร้านปรับให้ (+100) ไม่นับระดับ → ยังเป็น 50');
    r = await call('U3', 'redeem', { rewardId: goldReward });
    ok(!r.ok && r.code === 'TIER_LOCKED' && /Gold ขึ้นไป/.test(r.error), 'Member แลกของ Gold ไม่ได้ (ส่งรหัสมาเองก็ไม่ได้)', r);
    r = await call('U1', 'bootstrap');
    ok(r.rewards.find((x) => x.id === goldReward).locked === false && r.promos.find((x) => x.title === 'โปร Silver ขึ้นไป').locked === false, 'Gold เห็นปลดล็อก');
    const before = (await call('U1', 'bootstrap')).member.tierInfo.points12m;
    r = await call('U1', 'redeem', { rewardId: goldReward });
    ok(r.ok, 'Gold แลกได้');
    ok((await call('U1', 'bootstrap')).member.tierInfo.points12m === before && before === 1050, 'แลกของรางวัลแล้ว แต้มนับระดับไม่ลด (1,050)', before);
    r = await call('O', 'adminRewards');
    ok(r.tiers.length === 3 && r.items.find((x) => x.id === goldReward).minTierId === 'T3', 'หลังบ้าน: รายการบอกระดับขั้นต่ำ + รายชื่อระดับไว้ทำตัวเลือก');
    r = await call('O', 'adminRewardSave', { reward: { id: goldReward, name: 'ของ Gold แก้ชื่อ', points: 10, status: 'ACTIVE' } });
    ok(r.reward.minTierId === 'T3', 'แก้ของรางวัลโดยไม่ส่งช่องระดับ (หน้าเว็บรุ่นเก่า) → ระดับขั้นต่ำเดิมไม่หาย');

    console.log('\n[7] ของขวัญวันเกิด: ได้ชิ้นของระดับสูงสุดที่ถึง');
    const month = U.thaiDay(new Date(clock)).slice(5, 7);
    await db.query(`update members set birth_date = $3::date, joined_at = $4 where shop_id = $1 and id = any($2::text[])`,
      [SHOP, [ids.U1, ids.U3], '1990-' + month + '-20', new Date(clock - 60 * U.DAY_MS)]);
    await call('O', 'adminRewardSave', { reward: { name: 'เค้กชิ้นเล็ก', type: 'BIRTHDAY', points: '', status: 'ACTIVE', sort: 1 } });
    await call('O', 'adminRewardSave', { reward: { name: 'เค้กปอนด์ (Gold)', type: 'BIRTHDAY', points: '', status: 'ACTIVE', sort: 2, minTierId: 'T3' } });
    r = await call('U1', 'bootstrap');
    ok(r.birthday && r.birthday.name === 'เค้กปอนด์ (Gold)', 'Gold → เค้กปอนด์', r.birthday);
    r = await call('U3', 'bootstrap');
    ok(r.birthday && r.birthday.name === 'เค้กชิ้นเล็ก', 'Member → เค้กชิ้นเล็ก', r.birthday);
    r = await call('U1', 'claimBirthday');
    ok(r.ok && r.coupon.name === 'เค้กปอนด์ (Gold)', 'Gold กดรับ → ได้เค้กปอนด์');

    console.log('\n[8] เจ้าของร้านตั้งระดับให้เอง + กรอง + ภาพรวม');
    r = await call('O', 'adminMemberTier', { memberId: ids.U2, tierId: 'T3', reason: 'ab' });
    ok(!r.ok && r.code === 'NO_REASON', 'ไม่มีเหตุผล → ไม่ได้');
    r = await call('A', 'adminMemberTier', { memberId: ids.U2, tierId: 'T3', reason: 'ลูกค้า VIP' });
    ok(!r.ok && r.code === 'NO_ROLE', 'ผู้จัดการตั้งไม่ได้');
    r = await call('O', 'adminMemberTier', { memberId: ids.U2, tierId: 'T3', reason: 'ลูกค้า VIP' });
    ok(r.ok && r.member.tier === 'Gold', 'เจ้าของร้านตั้ง U2 เป็น Gold (VIP)');
    r = await call('O', 'adminMember', { memberId: ids.U2 });
    ok(r.member.tierInfo.name === 'Gold' && r.member.tierHistory[0].reason === 'ADMIN' && /ลูกค้า VIP/.test(r.member.tierHistory[0].by), 'สมาชิกรายคน: ระดับ + ประวัติ (ใคร เพราะอะไร)', r.member.tierHistory);
    r = await call('A', 'adminMembers', { tier: 'T3' });
    ok(r.ok && r.total === 2 && r.items.every((x) => x.tierId === 'T3'), 'กรองสมาชิกระดับ Gold → 2 คน', r.items.map((x) => x.tierId));
    r = await call('A', 'adminDashboard', { from: U.thaiDay(new Date(clock - 6 * U.DAY_MS)), to: U.thaiDay(new Date(clock)) });
    ok(r.ok && r.tiers.map((x) => x.name + ':' + x.count).join(',') === 'Member:1,Silver:0,Gold:2', 'ภาพรวม: จำนวนสมาชิกแต่ละระดับ', r.tiers);

    console.log('\n[9] ครบ 12 เดือน: แต้มไม่ถึง → ลดทีละ 1 ระดับ / ถึง → คงต่อ');
    await buy(ids.U3, 5000); // U3 ขึ้น Silver
    ok((await tierOf('U3')).tier_id === 'T2', 'U3 ซื้อรวม 6,000 = 300 แต้ม → Silver');
    clock += 10 * MONTH; // 10 เดือนต่อมา U3 ซื้ออีก (ยอด 12 เดือนก่อนวันครบยังถึง Silver)
    await buy(ids.U3, 5500);
    clock += 3 * MONTH; // รวม 13 เดือน: Gold ของ U1 / U2 ครบกำหนดแล้ว
    r = await call('U1', 'bootstrap');
    ok(r.member.tier === 'Silver', '13 เดือนไม่ได้ซื้อ: U1 Gold → Silver (ลด 1 ระดับ ไม่ตกถึงระดับแรกทีเดียว)', r.member.tierInfo);
    const hd = (await db.query(`select reason, from_tier_id, to_tier_id from tier_history where shop_id = $1 and member_id = $2 order by created_at desc limit 1`, [SHOP, ids.U1])).rows[0];
    ok(hd.reason === 'DOWN' && hd.from_tier_id === 'T3' && hd.to_tier_id === 'T2', 'จดประวัติลดระดับ (DOWN)', hd);
    r = await call('C', 'staffLookup', { query: '0833333333' });
    ok(r.member.tier === 'Silver', 'U3 ซื้อต่อเนื่อง → ครบ 12 เดือนแล้วยังคง Silver (ต่ออีก 12 เดือน)', r.member);
    r = await call('O', 'adminTiers');
    ok(r.items.map((x) => x.members).join(',') === '0,3,0', 'หลังบ้าน: U2 (Gold ที่ตั้งเอง) ก็ลดตามกติกาตอนครบ → Silver 3 คน', r.items);
    r = await buy(ids.U1, 1000);
    ok(r.pointsAdded === 75, 'U1 หลังลดเป็น Silver → ได้ ×1.5 (ไม่ใช่ ×2 ของ Gold เดิม)', r);
    clock += 12 * MONTH; // อีก 12 เดือน: ครบอีกรอบ
    r = await call('U2', 'bootstrap');
    ok(r.member.tier === 'Member' && r.member.tierInfo.until === '', 'ไม่ซื้อเลยอีกปี: U2 Silver → Member (ระดับแรกไม่มีวันหมดอายุ)', r.member.tierInfo);

    console.log('\n[10] แก้ระดับ: ลดเกณฑ์ → ขึ้นทันที / เอาระดับออก / ปิดใช้');
    const cur = (await call('O', 'adminTiers')).items;
    await buy(ids.U1, 1000); // แต้ม 12 เดือนล่าสุดของ U1 = 50 (ยังไม่ถึง Silver 250)
    ok((await tierOf('U1')).tier_id === 'T1', 'U1 ตอนนี้อยู่ Member (ลดมาตามกติกาแล้ว)');
    r = await call('O', 'adminTiersSave', { tiers: [cur[0], Object.assign({}, cur[1], { minPoints: 50 }), cur[2]] });
    ok(r.ok, 'ลดเกณฑ์ Silver เหลือ 50 แต้ม');
    ok((await tierOf('U1')).tier_id === 'T2', 'U1 (50 แต้ม) → Silver ทันที');
    r = await call('O', 'adminTiersSave', { tiers: [cur[0], cur[1]] });
    ok(!r.ok && r.code === 'TIER_IN_USE' && /Gold/.test(r.error), 'เอา Gold ออก ขณะของรางวัล/กติกายังใช้อยู่ → บอกให้แก้ก่อน', r);
    await call('O', 'adminRewardSave', { reward: { id: goldReward, name: 'ของ Gold แก้ชื่อ', points: 10, status: 'ACTIVE', minTierId: 'T2' } });
    await call('O', 'adminRewardDelete', { id: 'R003' });
    await call('O', 'adminRuleDelete', { id: 'PR001' });
    await call('O', 'adminMemberTier', { memberId: ids.U2, tierId: 'T3', reason: 'ทดสอบเอาระดับออก' });
    r = await call('O', 'adminTiersSave', { tiers: [cur[0], cur[1]] });
    ok(r.ok && r.items.length === 2, 'เอา Gold ออกได้ (รายการที่ลบแล้วไม่ขวาง)', r);
    ok((await tierOf('U2')).tier_id === 'T2', 'สมาชิกที่อยู่ Gold → ย้ายไป Silver (ระดับใกล้สุดที่ไม่สูงกว่า)');
    await call('O', 'adminRewardSave', { reward: { id: goldReward, name: 'ของ Gold แก้ชื่อ', points: 10, status: 'ACTIVE', minTierId: '' } });
    await call('O', 'adminPromoSave', { promo: { id: 'P001', title: 'โปร Silver ขึ้นไป', status: 'ACTIVE', minTierId: '' } });
    r = await call('O', 'adminTiersSave', { tiers: [{ name: 'ธรรมดา', minPoints: 0 }, { name: 'VIP', minPoints: 150, multiplier: 3 }] });
    ok(r.ok && r.items.map((x) => x.id).join(',') === 'T4,T5' && r.items.every((x) => x.members >= 0), 'เปลี่ยนระดับทั้งชุดเป็นของใหม่ (รหัสใหม่ไม่ซ้ำของเก่า)', r);
    r = await call('O', 'adminTiersSave', { tiers: [] });
    ok(r.ok && r.enabled === false, 'ปิดใช้ระดับ');
    r = await call('U1', 'bootstrap');
    ok(!('tiers' in r) && r.member.tier === '' && r.rewards.every((x) => !('locked' in x)), 'ปิดแล้ว: หน้าลูกค้ากลับเป็นแบบไม่มีระดับ');
    const left = (await db.query(`select count(*)::int n from rewards where shop_id = $1 and min_tier_id is not null`, [SHOP])).rows[0].n;
    ok(left === 0, 'ของรางวัลที่เคยตั้งระดับ → กลับเป็นทุกคนแลกได้');
    ok((await db.query(`select count(*)::int n from tier_history where shop_id = $1`, [SHOP])).rows[0].n > 5, 'ประวัติระดับเดิมยังอยู่');

    console.log('\n[11] หน้าสิทธิ์สมาชิก: รูปบัตร + สิทธิพิเศษ + ข้อความหัวหน้า / อัตราแต้ม');
    r = await call('O', 'adminTiersSave', { intro: ' สมัครฟรี \n ยิ่งสะสมยิ่งคุ้ม ', tiers: [{ name: 'ธรรมดา', minPoints: 0, benefits: 'สะสมแต้มทุกบิล\n\n' },
      { name: 'VIP', minPoints: 150, multiplier: 3, image: 'https://example.com/vip.png', benefits: [' ส่วนลด 10% ', 'ที่จอดรถ', ''] }] });
    ok(r.ok && r.intro === 'สมัครฟรี\nยิ่งสะสมยิ่งคุ้ม' && r.items[1].image === 'https://example.com/vip.png' &&
      r.items[1].benefits.join('|') === 'ส่วนลด 10%|ที่จอดรถ' && r.items[0].benefits.join('|') === 'สะสมแต้มทุกบิล', 'บันทึกรูปบัตร / สิทธิพิเศษ (ตัดบรรทัดว่าง) / ข้อความหัวหน้า', r);
    r = await call('U1', 'bootstrap');
    ok(r.tierIntro === 'สมัครฟรี\nยิ่งสะสมยิ่งคุ้ม' && r.tiers[1].benefits.length === 2 && r.tiers[1].image === 'https://example.com/vip.png' && r.tiers[1].minPoints === 150,
      'หน้าลูกค้าได้ข้อมูลหน้าสิทธิ์ครบ', { intro: r.tierIntro, tiers: r.tiers });
    r = await call('O', 'adminTiersSave', { tiers: (await call('O', 'adminTiers')).items });
    ok(r.ok && r.intro === 'สมัครฟรี\nยิ่งสะสมยิ่งคุ้ม', 'บันทึกโดยไม่ส่งข้อความหัวหน้า → ข้อความเดิมไม่หาย');
    const p0 = (await call('U1', 'bootstrap')).member.tierInfo.points12m;
    await db.query(`update transactions set base_points = null where shop_id = $1 and member_id = $2 and type = 'EARN'`, [SHOP, ids.U1]);
    ok((await call('U1', 'bootstrap')).member.tierInfo.points12m === p0, 'บิลเก่าที่ไม่มีแต้มปกติจดไว้ → คิดจากอัตราแต้มของร้านแทน (ผลเท่าเดิม)', p0);
    await db.query(`update transactions t set base_points = floor(t.amount / 20) where shop_id = $1 and member_id = $2 and type = 'EARN'`, [SHOP, ids.U1]);
    r = await call('O', 'adminSettingsSave', { values: { POINT_RATE_BAHT: 10 } });
    ok(r.ok && (await call('U1', 'bootstrap')).member.tierInfo.points12m === p0, 'ร้านเปลี่ยนเป็น 10 บาท = 1 แต้ม → แต้มนับระดับของบิลเก่าไม่เปลี่ยน', r);
    r = await buy(ids.U1, 1000);
    ok(r.basePoints === 100 && (await call('U1', 'bootstrap')).member.tierInfo.points12m === p0 + 100, 'บิลใหม่ใช้อัตราใหม่ (1,000 บาท = 100 แต้ม)');

    console.log('\n[12] ตัวช่วย');
    ok(T.addMonths('2026-01-31', 1) === '2026-02-28' && T.addMonths('2028-02-29', 12) === '2029-02-28' && T.addMonths('2026-11-07', 12) === '2027-11-07', 'บวกเดือน: สิ้นเดือน / ปีอธิกสุรทิน');
  } catch (e) {
    fail++;
    log('  ✗ หยุดกลางทาง: ' + (e.stack || e));
  }
  console.log = log;
  console.log(`\nผล: ผ่าน ${pass} / ไม่ผ่าน ${fail}`);
  process.exit(fail ? 1 : 0);
})();
