// ร้านตัวอย่าง: ใช้ทดสอบว่าเปลี่ยนร้านได้ด้วยไฟล์ตั้งค่าอย่างเดียว (โค้ดเหมือนร้านจริงทุกบรรทัด)
// และใช้เป็นแม่แบบตอนเพิ่มร้านใหม่
export default {
  name: 'Demo Café',
  logoText: 'D',
  logo: '',
  // ช่อง LINE "Go To Target Demo" (ผู้ใช้เลือกแบบ A 6 พ.ย. 2569) — LIFF endpoint ชี้ลิงก์ทดสอบสาขา dev
  // (member-git-dev-go-to-target.vercel.app/demo) ถ้าจะใช้ร้าน demo บนเว็บจริง ต้องเปลี่ยน endpoint หรือเพิ่ม LIFF อีกตัว
  liffId: '2012434511-bQt38UpF',
  // ระบบใหม่ (ฐานข้อมูลจริง ขั้น 3): ร้าน demo ใช้ก่อน ร้านคำหวานยังใช้ระบบเดิมจนถึงขั้น 6
  // '/api' = ตัวกลางบนโดเมนเดียวกับหน้าเว็บ (ไม่ต้องตั้งค่าเรียกข้ามเว็บ)
  apiUrl: '/api',
  theme: 'minimal',
  colors: {
    button: '#0EA5E9',
    accent: '#0EA5E9',
    cardFrom: '#38BDF8',
    cardTo: '#0369A1'
  },
  font: { family: 'Prompt', google: 'Prompt:wght@400;500;600;700' },
  texts: {
    greeting: 'สวัสดี',
    pointUnit: 'แต้ม'
  },
  // ร้านเดโม (ใช้เดโมขาย): เปิดทุกแพ็กเกจ — ระดับสมาชิก + หลายสาขา (ไม่ใส่ maxBranches = ไม่จำกัด) + ส่งออก Excel
  features: { tiers: true, branches: true, export: true, broadcast: true },
  legal: {
    privacyUrl: '',
    privacyText: 'ตัวอย่างนโยบายความเป็นส่วนตัว — ร้านจริงต้องใส่ข้อความของตัวเอง'
  }
};
