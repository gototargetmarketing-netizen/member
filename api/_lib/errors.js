// ข้อผิดพลาดที่ "ตั้งใจ" ให้ผู้ใช้เห็นข้อความ (เหมือน userError_ ใน code.gs)
// ข้อความห้ามพูดถึงที่เก็บข้อมูล (ฐานข้อมูล / Supabase / Vercel) — ใช้ "ติดต่อผู้ดูแลระบบ" แล้วเขียนวิธีแก้ลง console.error แทน
function userError(message, code) {
  const err = new Error(message);
  err.userMessage = message;
  err.code = code || 'INVALID';
  return err;
}

module.exports = { userError };
