// ร้านตัวอย่าง: ใช้ทดสอบว่าเปลี่ยนร้านได้ด้วยไฟล์ตั้งค่าอย่างเดียว (โค้ดเหมือนร้านจริงทุกบรรทัด)
// และใช้เป็นแม่แบบตอนเพิ่มร้านใหม่
export default {
  name: 'Demo Café',
  logoText: 'D',
  logo: '',
  liffId: '',
  apiUrl: '',
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
  features: { tiers: false },
  legal: {
    privacyUrl: '',
    privacyText: 'ตัวอย่างนโยบายความเป็นส่วนตัว — ร้านจริงต้องใส่ข้อความของตัวเอง'
  }
};
