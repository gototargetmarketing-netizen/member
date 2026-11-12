// LINE OA จำลอง (แทน Messaging API) — ไม่ส่งข้อความจริง แค่จดไว้ให้ชุดทดสอบตรวจ
// ทำตัวเหมือน LINE: โควตาต่อเดือน / ส่งด้วยรหัสกันซ้ำเดิม = 409 ไม่ส่งซ้ำ / ดูโปรไฟล์คนที่ไม่ใช่เพื่อน = 404
// ใช้ใน api-test, two-shops-test และ tools/api-server.js (หน้าเว็บในเครื่อง)
const path = require('path');
const { OaError } = require(path.join(__dirname, '..', '..', 'api', '_lib', 'lineoa.js'));

function createFakeOa({ name = 'OA ทดลอง', basicId = '@demo-oa', limit = 300, friends = null } = {}) {
  const s = {
    name, basicId, limit,            // limit = null → แพ็กเกจไม่จำกัด
    used: 0,
    friends,                         // null = ทุกคนเป็นเพื่อน / Set = เฉพาะคนในชุด
    keys: new Set(),                 // รหัสกันส่งซ้ำที่รับไปแล้ว
    pushes: [], multicasts: [],      // สิ่งที่ "ส่ง" ไปแล้ว
    calls: 0,
    failNext: [],                    // ชุดทดสอบตั้งให้ครั้งถัดไปผิดพลาด เช่น [{ op: 'multicast', status: 429 }]
    failAll: null                    // ทุกคำขอผิดพลาด เช่น 401 (รหัสหมดอายุ)
  };
  const fail = (op) => {
    if (s.failAll) throw new OaError(s.failAll, 'จำลองผิดพลาด');
    const i = s.failNext.findIndex((f) => f.op === op || f.op === '*');
    if (i >= 0) { const f = s.failNext.splice(i, 1)[0]; throw new OaError(f.status, 'จำลองผิดพลาด'); }
  };
  const isFriend = (u) => !s.friends || s.friends.has(u);
  const oa = {
    async info() { s.calls++; fail('info'); return { displayName: s.name, basicId: s.basicId, pictureUrl: 'https://profile.line-scdn.net/oa-test' }; },
    async quota() { s.calls++; fail('quota'); return s.limit == null ? { type: 'none' } : { type: 'limited', value: s.limit }; },
    async consumption() { s.calls++; fail('consumption'); return { totalUsage: s.used }; },
    async profile(u) {
      s.calls++; fail('profile');
      if (!isFriend(u)) throw new OaError(404, 'Not found');
      return { userId: u, displayName: 'เพื่อน ' + u };
    },
    async push(to, messages, key) {
      s.calls++; fail('push');
      if (s.keys.has(key)) throw new OaError(409, 'The retry key is already accepted');
      s.keys.add(key);
      s.pushes.push({ to, messages, key });
      if (isFriend(to)) s.used += 1;
      return {};
    },
    async multicast(to, messages, key) {
      s.calls++; fail('multicast');
      if (!Array.isArray(to) || !to.length || to.length > 500) throw new OaError(400, 'to ต้องมี 1–500 คน');
      if (s.keys.has(key)) throw new OaError(409, 'The retry key is already accepted');
      // เกินโควตา → LINE ไม่ส่งเลยทั้งชุด
      const n = to.filter(isFriend).length;
      if (s.limit != null && s.used + n > s.limit) throw new OaError(429, 'You have reached your monthly limit.');
      s.keys.add(key);
      s.multicasts.push({ to, messages, key });
      s.used += n;
      return {};
    }
  };
  return { oa, state: s };
}

module.exports = { createFakeOa };
