// กันกดซ้ำ / เน็ตหลุดแล้วส่งซ้ำ (เดิม: once_ + CacheService ใน code.gs ซึ่งหายเองใน 6 ชั่วโมง)
// คำขอที่มี requestId เดิม → ได้ผลเดิม ไม่ทำรายการซ้ำ — จำไว้ในตาราง request_log ถาวร
//
// ทำงานเป็นก้อนเดียวกับรายการจริง (สำเร็จพร้อมกัน หรือไม่บันทึกทั้งคู่) → ไม่มีกรณี "ทำแล้วแต่ลืมจด" หรือ "จดแต่ไม่ได้ทำ"
// ถ้าคำขอซ้ำ 2 อันมาถึงพร้อมกัน: อันหลังชนกฎห้ามซ้ำของตาราง → ย้อนกลับ แล้วอ่านผลของอันแรกส่งให้แทน
// ผิดพลาด (เช่น แต้มไม่พอ) ไม่จด → แก้แล้วกดใหม่ด้วยรหัสเดิมได้ (เหมือนของเดิม)
const { cleanRequestId } = require('./util');

const FIND_SQL = 'select result from request_log where shop_id = $1 and user_id = $2 and action = $3 and request_id = $4';
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

async function once(ctx, action, requestId, fn) {
  const reqId = cleanRequestId(requestId);
  const key = [ctx.shop.id, ctx.user.userId, action, reqId];
  const prev = await ctx.db.query(FIND_SQL, key);
  if (prev.rows[0]) return parse(prev.rows[0].result);
  try {
    return await ctx.db.tx(async (q) => {
      const result = await fn(q, reqId);
      // $5::text::jsonb = ส่งเป็นข้อความแล้วให้ฐานข้อมูลแปลงเอง (pg กับ PGlite ส่ง object ไม่เหมือนกัน)
      await q.query('insert into request_log (shop_id, user_id, action, request_id, result) values ($1, $2, $3, $4, $5::text::jsonb)',
        key.concat([JSON.stringify(result)]));
      return result;
    });
  } catch (e) {
    if (e && e.code === '23505') { // ชนกฎห้ามซ้ำ: อาจเป็นคำขอเดียวกันที่ทำเสร็จไปก่อนหน้าเสี้ยววินาที
      const again = await ctx.db.query(FIND_SQL, key);
      if (again.rows[0]) return parse(again.rows[0].result);
    }
    throw e;
  }
}

module.exports = { once };
