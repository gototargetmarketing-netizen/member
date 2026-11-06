// ที่เก็บรูปของรางวัล / โปรโมชัน / โลโก้ (เดิม: Google Drive ของบัญชีเจ้าของ Apps Script)
// ใช้ Supabase Storage ผ่าน REST ตรงๆ (ไม่ต้องลงโปรแกรมเสริม) — ถังรูปชื่อ "images" เปิดให้ทุกคนดูรูปได้ (ลูกค้าต้องเห็นรูปโดยไม่ล็อกอิน)
//
// ต้องตั้ง 2 ค่าใน Vercel: SUPABASE_URL (ไม่ลับ เช่น https://xxxx.supabase.co) และ SUPABASE_SECRET_KEY (ลับ — กุญแจ secret / service_role)
// ยังไม่มีถัง → สร้างให้เองครั้งแรก (จำกัดเฉพาะรูป 2MB)
const BUCKET = 'images';
const TIMEOUT_MS = 15000;

class StorageNotConfigured extends Error {}

function createStorage({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY, fetch = globalThis.fetch } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const headers = (extra) => Object.assign({ apikey: key, Authorization: 'Bearer ' + key }, extra);

  async function createBucket() {
    const res = await fetch(base + '/storage/v1/bucket', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 2 * 1024 * 1024,
        allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    // 409 = มีคนสร้างไปพร้อมกันแล้ว ถือว่าใช้ได้
    if (!res.ok && res.status !== 409) throw new Error('สร้างถังรูปไม่สำเร็จ (' + res.status + '): ' + (await res.text()).slice(0, 200));
  }

  // คืนลิงก์สาธารณะของรูป
  async function upload(path, bytes, mime) {
    if (!/^https:\/\//.test(base) || !key) {
      throw new StorageNotConfigured('ยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SECRET_KEY ใน Vercel (Settings → Environment Variables)');
    }
    const put = () => fetch(base + '/storage/v1/object/' + BUCKET + '/' + path, {
      method: 'POST',
      // ชื่อไฟล์ไม่ซ้ำเสมอ (มีรหัสสุ่ม) → ให้เบราว์เซอร์/ CDN จำรูปไว้ได้นาน
      headers: headers({ 'Content-Type': mime, 'cache-control': 'max-age=31536000', 'x-upsert': 'false' }),
      body: bytes,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    let res = await put();
    if (res.status === 404 || res.status === 400) {
      const text = await res.text();
      if (!/bucket/i.test(text)) throw new Error('อัปโหลดรูปไม่สำเร็จ (' + res.status + '): ' + text.slice(0, 200));
      await createBucket(); // ครั้งแรกของโปรเจค: ยังไม่มีถังรูป
      res = await put();
    }
    if (!res.ok) throw new Error('อัปโหลดรูปไม่สำเร็จ (' + res.status + '): ' + (await res.text()).slice(0, 200));
    return base + '/storage/v1/object/public/' + BUCKET + '/' + path;
  }

  return { upload };
}

module.exports = { createStorage, StorageNotConfigured, BUCKET };
