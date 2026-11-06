// งานเกี่ยวกับสมาชิกที่หลายคำสั่งใช้ร่วมกัน (ลูกค้า / พนักงาน / หลังบ้าน)
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

async function memberById(q, shopId, id, lock) {
  const r = await q.query(`select ${MEMBER_COLS} from members where shop_id = $1 and id = $2` + (lock ? ' for update' : ''), [shopId, id]);
  return r.rows[0] || null;
}

function assertActiveMember(m) {
  if (U.upper(m.status || 'ACTIVE') !== 'ACTIVE') throw userError('บัญชีสมาชิกนี้ถูกระงับ กรุณาติดต่อร้าน', 'MEMBER_BLOCKED');
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
  activeBranches, joinedBranch, cleanProfileInput, applyProfile
};
