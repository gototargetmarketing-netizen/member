// งานเกี่ยวกับสมาชิกที่หลายคำสั่งใช้ร่วมกัน (ลูกค้า / พนักงาน / หลังบ้าน)
const crypto = require('crypto');
const { userError } = require('./errors');
const U = require('./util');
const { MEMBER_COLS, BIRTH_SELF_EDITS, BRANCH_ONLINE } = require('./views');

const PROFILE_LABEL = { name: 'ชื่อ-นามสกุล', phone: 'เบอร์โทร', birth: 'วันเกิด', marketing: 'รับข่าวสาร' };

// lock = true: จองแถวสมาชิกไว้จนจบรายการ (คำขออื่นของคนเดียวกันต้องรอ — แทน LockService ที่ล็อกทั้งร้าน)
// ลำดับการจอง: สมาชิกก่อน แล้วค่อยของรางวัล/คูปอง เสมอ (จองสลับลำดับกันจะค้างรอกันเอง)
async function memberByLine(q, shopId, userId, lock) {
  const r = await q.query(`select ${MEMBER_COLS} from members where shop_id = $1 and line_user_id = $2` + (lock ? ' for update' : ''), [shopId, userId]);
  return r.rows[0] || null;
}

// ลบบัญชีแล้ว = ไม่พบ (พนักงานบันทึกยอด/ใช้คูปอง/ปรับแต้ม และหลังบ้านแก้ข้อมูล/ระงับ/เปลี่ยนระดับ ให้ไม่ได้)
// withDeleted = true เฉพาะที่ต้องเห็นแถวที่ลบแล้วจริงๆ (หน้าสมาชิกในหลังบ้าน / คำสั่งลบบัญชีตอบว่าลบไปแล้ว)
async function memberById(q, shopId, id, lock, withDeleted) {
  const r = await q.query(`select ${MEMBER_COLS} from members where shop_id = $1 and id = $2` + (withDeleted ? '' : ` and status <> 'DELETED'`) +
    (lock ? ' for update' : ''), [shopId, id]);
  return r.rows[0] || null;
}

function assertActiveMember(m) {
  const st = U.upper(m.status || 'ACTIVE');
  if (st === STATUS_DELETED) throw userError('ไม่พบสมาชิก', 'NOT_FOUND'); // ลบบัญชีแล้ว = เหมือนไม่เคยมี (ไม่บอกว่าเคยเป็นสมาชิก)
  if (st !== 'ACTIVE') throw userError('บัญชีสมาชิกนี้ถูกระงับ กรุณาติดต่อร้าน', 'MEMBER_BLOCKED');
}

// ---------- นโยบายความเป็นส่วนตัว (PDPA ขั้นที่ 2 — ผู้ใช้ตกลง 14 พ.ย. 2569) ----------
// ร้านแก้นโยบาย → ฉบับที่เพิ่มขึ้น (adminBrandSave) → ลูกค้าที่ยอมรับฉบับเก่าต้องกดยอมรับใหม่ก่อนแลกของ/รับของขวัญ
// ไม่กัน: แก้ข้อมูล / ปิดรับข่าวสาร (ถอนความยินยอมได้เสมอ) / ลบบัญชี / พนักงานบันทึกยอดให้ที่เคาน์เตอร์
const policyVersion = (shop) => Math.max(1, parseInt(shop && shop.consent_version, 10) || 1);
const needsPolicy = (m, shop) => !!m && (parseInt(m.consent_version, 10) || 0) < policyVersion(shop);
function assertPolicy(m, shop) {
  if (needsPolicy(m, shop)) throw userError('ร้านปรับปรุงนโยบายความเป็นส่วนตัว กรุณากดยอมรับก่อนใช้บัตรสมาชิก', 'POLICY_NEEDED');
}

// ---------- ลบบัญชีสมาชิก (PDPA: สิทธิ์ขอลบข้อมูล) ----------
const STATUS_DELETED = 'DELETED';
const DELETED_NAME = 'สมาชิกที่ลบแล้ว'; // ชื่อที่หลังบ้าน/พนักงานเห็นแทน ในประวัติยอดซื้อเดิม

// "รหัสแปลง" ของ LINE ID: sha256 ย้อนกลับไม่ได้ (LINE ID สุ่ม 128 บิต เดาไล่ไม่ได้) — ใส่ชื่อร้านนำหน้า
// → ร้านอื่นเทียบไม่ได้ / ใช้แค่ตอบว่า "LINE นี้เคยได้แต้มรับข่าวสารแล้ว" ตอนสมัครใหม่ (ผู้ใช้เลือกแบบ ก)
const lineHash = (shopId, userId) => crypto.createHash('sha256').update(String(shopId) + ':' + String(userId)).digest('hex');

// LINE นี้เคยได้แต้มรับข่าวสารในบัญชีที่ลบไปแล้วไหม
async function bonusUsedBefore(q, shopId, userId) {
  const r = await q.query(`select 1 from members where shop_id = $1 and line_hash = $2 and consent_bonus_at is not null limit 1`,
    [shopId, lineHash(shopId, userId)]);
  return r.rows.length > 0;
}

// ลบบัญชี: m ต้องจองแถวไว้แล้ว (lock) และอยู่ในรายการเดียวกัน (สำเร็จทั้งหมด หรือไม่ลบเลย)
// ฐานข้อมูลตรวจซ้ำอีกชั้น (members_deleted_wiped_check ใน 008) — ลืมล้างช่องไหน = บันทึกไม่ผ่านทั้งก้อน
// opt = { by: ชื่อผู้ลบที่จดในประวัติ, log: ข้อความในประวัติแก้ข้อมูล (ห้ามมีข้อมูลส่วนตัว) }
async function deleteMember(q, shopId, m, opt, now) {
  const points = U.toInt(m.points);
  // แต้มคงเหลือ → 0 จดเป็นรายการ DELETE (ยอดในประวัติต่อกัน → db/check_points.sql ไม่ฟ้อง / ไม่ปนกับ "ปรับแต้ม" ของพนักงาน)
  if (points > 0) {
    await q.query(`insert into transactions (shop_id, id, created_at, member_id, type, amount, points, balance_after, detail, staff)
                   values ($1, $2, $3, $4, 'DELETE', 0, $5, 0, 'ลบบัญชีสมาชิก', $6)`, [shopId, newTxId(), now, m.id, -points, opt.by]);
  }
  // คูปองที่ยังไม่ใช้ → ยกเลิก (ใช้แล้ว / หมดอายุ เก็บไว้เป็นประวัติ)
  const cancelled = (await q.query(`update coupons set status = 'CANCELLED' where shop_id = $1 and member_id = $2 and status = 'ACTIVE' returning code`,
    [shopId, m.id])).rows.length;
  const hash = m.line_user_id ? lineHash(shopId, m.line_user_id) : null;
  await q.query(`update members set status = 'DELETED', deleted_at = $3, line_hash = $4,
      line_user_id = null, name = '', first_name = '', last_name = '', phone = null, birth_date = null, picture = '', note = '',
      points = 0, marketing_consent = false, oa_friend = null, oa_friend_at = null
    where shop_id = $1 and id = $2`, [shopId, m.id, now, hash]);
  // คำตอบที่จำไว้กันกดซ้ำ (request_log) มีชื่อ/เบอร์อยู่ในคำตอบ → ลบ: คำขอของลูกค้าเอง + คำขอของพนักงานที่ตอบเรื่องสมาชิกคนนี้
  // (เทียบรหัสสมาชิกแบบมีเครื่องหมายคำพูด = ตรงทั้งรหัส ไม่ติดรหัสที่ยาวกว่า)
  await q.query(`delete from request_log where shop_id = $1 and (user_id = $2 or position($3 in result::text) > 0)`,
    [shopId, String(m.line_user_id || ''), JSON.stringify(String(m.id))]);
  await q.query('insert into profile_log (shop_id, created_at, member_id, changed, by_name) values ($1, $2, $3, $4, $5)',
    [shopId, now, m.id, String(opt.log).slice(0, 250), opt.by]);
  return { points, cancelled };
}

// ---------- รหัสใหม่ (สุ่ม + ให้ฐานข้อมูลยืนยันว่าไม่ซ้ำ) ----------
const newTxId = () => 'TX-' + U.randomCode(10);

// เพิ่มแถวด้วยรหัสสุ่ม ถ้าบังเอิญซ้ำ (โอกาสน้อยมาก) สุ่มใหม่ — sql ต้องมี "on conflict (...) do nothing returning ..."
async function insertWithNewId(q, makeId, sql, paramsFor) {
  for (let i = 0; i < 10; i++) {
    const id = makeId();
    const r = await q.query(sql, paramsFor(id));
    if (r.rows[0]) return r.rows[0];
  }
  throw new Error('สร้างรหัสใหม่ไม่สำเร็จ');
}

// ---------- สาขา ----------
async function activeBranches(q, shopId) {
  const r = await q.query(`select id from branches where shop_id = $1 and status = 'ACTIVE'`, [shopId]);
  return r.rows.map((b) => U.upper(b.id));
}

// สาขาที่ลูกค้าสมัคร: มาจาก QR ของสาขา (?branch=) — ร้านไม่มีสาขา = '' / สาขาไม่มีจริงหรือปิดแล้ว = สมัครออนไลน์
function joinedBranch(v, active) {
  if (!active.length) return '';
  const id = U.upper(v);
  return active.indexOf(id) >= 0 ? id : BRANCH_ONLINE;
}

// ---------- แก้ข้อมูลสมาชิก (ลูกค้าแก้เอง / เจ้าของร้านแก้ให้) ----------
// ผู้ใช้ตกลง 4 พ.ย. 2569: ชื่อแก้ได้เสมอ / เบอร์แก้ได้ (ห้ามซ้ำ) / วันเกิดลูกค้าแก้เองได้ 1 ครั้ง (เติมวันเกิดที่ยังว่างไม่นับ)
// รับข่าวสาร ลูกค้าเปิด-ปิดเองเท่านั้น (PDPA: ร้านให้ความยินยอมแทนไม่ได้)
function cleanProfileInput(p, self, now) {
  const firstName = U.cleanNamePart(p.firstName, 'ชื่อ');
  const lastName = U.cleanNamePart(p.lastName, 'นามสกุล');
  const birthDate = U.cleanBirthDate(p.birthDate, now);
  if (!birthDate) throw userError('กรุณาเลือกวันเกิด', 'BAD_BIRTHDATE');
  const out = { firstName, lastName, phone: U.cleanMobile(p.phone), birthDate };
  if (self && typeof p.consentMarketing === 'boolean') out.marketing = p.consentMarketing;
  return out;
}

// เขียนเฉพาะช่องที่เปลี่ยนจริง + จดประวัติ (ไม่เก็บค่าเดิม) — m ต้องจองแถวไว้แล้ว (lock)
async function applyProfile(q, shopId, m, v, opt, now) {
  const fields = {};
  const changed = [];
  const name = v.firstName + ' ' + v.lastName;
  if (name !== String(m.name || '') || v.firstName !== String(m.first_name || '') || v.lastName !== String(m.last_name || '')) {
    fields.name = name; fields.first_name = v.firstName; fields.last_name = v.lastName;
    changed.push(PROFILE_LABEL.name);
  }
  if (v.phone !== String(m.phone || '')) {
    const other = await q.query('select 1 from members where shop_id = $1 and phone = $2 and id <> $3', [shopId, v.phone, m.id]);
    if (other.rows.length) throw userError('เบอร์นี้มีสมาชิกคนอื่นใช้แล้ว ถ้าเป็นเบอร์ของคุณ กรุณาติดต่อร้าน', 'PHONE_TAKEN');
    fields.phone = v.phone;
    changed.push(PROFILE_LABEL.phone);
  }
  const oldBirth = String(m.birth_date || '');
  if (v.birthDate !== oldBirth) {
    const edits = U.toInt(m.birth_date_edits);
    if (opt.self && oldBirth) {
      if (edits >= BIRTH_SELF_EDITS) throw userError('แก้วันเกิดได้ครั้งเดียว ต้องการแก้อีก กรุณาติดต่อร้าน', 'BIRTH_LOCKED');
      fields.birth_date_edits = edits + 1;
    }
    fields.birth_date = v.birthDate;
    changed.push(PROFILE_LABEL.birth);
  }
  if (typeof v.marketing === 'boolean' && v.marketing !== (m.marketing_consent === true)) {
    fields.marketing_consent = v.marketing;
    changed.push(PROFILE_LABEL.marketing);
  }
  if (!changed.length) return changed;

  // ชื่อคอลัมน์มาจากโค้ดเท่านั้น (ไม่ได้มาจากหน้าเว็บ) ค่าทุกตัวส่งแยกเป็นพารามิเตอร์
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => c + ' = $' + (i + 3) + (c === 'birth_date' ? '::date' : ''));
  await q.query(`update members set ${sets.join(', ')} where shop_id = $1 and id = $2`, [shopId, m.id].concat(cols.map((c) => fields[c])));
  await q.query('insert into profile_log (shop_id, created_at, member_id, changed, by_name) values ($1, $2, $3, $4, $5)',
    [shopId, now, m.id, changed.join(', '), opt.by]);
  return changed;
}

module.exports = {
  PROFILE_LABEL, memberByLine, memberById, assertActiveMember, newTxId, insertWithNewId,
  activeBranches, joinedBranch, cleanProfileInput, applyProfile,
  policyVersion, needsPolicy, assertPolicy, STATUS_DELETED, DELETED_NAME, lineHash, bonusUsedBefore, deleteMember
};
