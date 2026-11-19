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
  // ร้านเดโม (ใช้เดโมขาย): เปิดทุกแพ็กเกจ — ระดับสมาชิก + หลายสาขา (ไม่ใส่ maxBranches = ไม่จำกัด) + ส่งออก Excel + ส่งข้อความ + ภาษาอังกฤษ
  features: { tiers: true, branches: true, export: true, broadcast: true, english: true },
  legal: {
    privacyUrl: '',
    // แม่แบบกลางของระบบ (เหมือน POLICY_LINES ใน tools/new-shop.js) — ร้านเดโมใช้โชว์ตอนเสนอขาย
    privacyText: [
      "ร้าน Demo Café (\"ร้าน\") เป็นผู้ดูแลข้อมูลส่วนบุคคลของสมาชิก โดยมีผู้ให้บริการระบบสมาชิกประมวลผลข้อมูลแทนร้านตามคำสั่งของร้านเท่านั้น",
      "",
      "1) ข้อมูลที่เก็บ",
      "• ชื่อ-นามสกุล เบอร์มือถือ วันเกิด",
      "• ข้อมูลบัญชี LINE: รหัสผู้ใช้ ชื่อ และรูปโปรไฟล์",
      "• ประวัติการซื้อ แต้ม คูปอง และสาขาที่ใช้บริการ",
      "• สถานะการเป็นเพื่อน LINE ของร้าน (ถ้าร้านส่งข่าวสารทาง LINE)",
      "",
      "2) ใช้ข้อมูลเพื่อ",
      "• ให้บริการสมาชิก สะสมและแลกแต้ม และให้พนักงานค้นหาบัตรของคุณ",
      "• มอบสิทธิพิเศษ เช่น ของขวัญเดือนเกิด และระดับสมาชิก",
      "• ส่งข่าวสารและโปรโมชัน เฉพาะเมื่อคุณยินยอม",
      "• สรุปยอดขายและปรับปรุงบริการของร้าน",
      "",
      "3) ข่าวสารและโปรโมชัน",
      "ส่งทาง LINE ของร้าน เฉพาะเมื่อคุณยินยอม ช่องยินยอมอาจถูกเลือกไว้ให้ตอนสมัคร คุณเอาเครื่องหมายออกได้ก่อนกดสมัคร และยกเลิกได้ทุกเมื่อที่ \"แก้ไขข้อมูล\" แต้มที่ได้จากการรับข่าวสารได้ครั้งเดียวต่อคน",
      "",
      "4) ผู้ที่เข้าถึงข้อมูล",
      "เจ้าของร้านและพนักงานเฉพาะส่วนที่จำเป็นต่องาน (พนักงานเห็นเบอร์เพียงบางส่วน) และผู้ให้บริการระบบ ร้านไม่ขายหรือส่งต่อข้อมูลของคุณให้ผู้อื่นเพื่อการตลาด",
      "",
      "5) ที่เก็บข้อมูล",
      "เก็บบนระบบคลาวด์ในประเทศสิงคโปร์ และเข้ารหัสระหว่างส่งข้อมูล",
      "",
      "6) ระยะเวลาเก็บ",
      "เก็บตลอดช่วงที่เป็นสมาชิก เมื่อลบบัญชี ร้านจะลบชื่อ เบอร์ วันเกิด รูป และบัญชี LINE ของคุณ เหลือเพียงประวัติยอดซื้อที่ไม่ระบุตัวตน และรหัสที่แปลงจากบัญชี LINE ซึ่งย้อนกลับเป็นบัญชีเดิมไม่ได้ ใช้เพื่อกันการรับแต้มรับข่าวสารซ้ำเท่านั้น",
      "",
      "7) สิทธิ์ของคุณ",
      "• ดูและแก้ข้อมูลได้เองที่ \"แก้ไขข้อมูล\"",
      "• ลบบัญชีได้เองที่ \"แก้ไขข้อมูล\" → \"ลบบัญชีสมาชิก\" (แต้มและคูปองที่เหลือจะหายและกู้คืนไม่ได้)",
      "• ถอนความยินยอมรับข่าวสารได้ทุกเมื่อ",
      "• ขอสำเนาข้อมูล คัดค้าน หรือสอบถามเพิ่มเติม ติดต่อร้านได้ที่หน้าร้านหรือทาง LINE ของร้าน",
      "• ร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลได้",
      "",
      "8) การเปลี่ยนแปลงนโยบาย",
      "เมื่อร้านปรับปรุงนโยบาย ระบบจะแจ้งและขอให้คุณกดยอมรับฉบับใหม่ก่อนใช้บัตรสมาชิกต่อ"
    ].join('\n'),
    // ฉบับภาษาอังกฤษ (เหมือน POLICY_LINES_EN ใน tools/new-shop.js) — ลูกค้าเห็นหมายเหตุว่าฉบับไทยใช้บังคับ
    privacyTextEn: [
      "Demo Café (\"the Shop\") is responsible for members' personal data. The membership system provider processes the data on the Shop's behalf and only on the Shop's instructions.",
      "",
      "1) Data we collect",
      "• First and last name, mobile number and date of birth",
      "• LINE account details: user ID, display name and profile picture",
      "• Purchase history, points, coupons and the branches you visit",
      "• Whether you are a friend of the Shop's LINE account (if the Shop sends news via LINE)",
      "",
      "2) How we use your data",
      "• To provide membership services, let you earn and redeem points, and let staff find your card",
      "• To give you special benefits, such as birthday gifts and membership tiers",
      "• To send news and promotions, only with your consent",
      "• To summarize sales and improve the Shop's services",
      "",
      "3) News and promotions",
      "Sent via the Shop's LINE account, only with your consent. The consent box may be ticked for you when you sign up. You can untick it before signing up and withdraw at any time in \"Edit profile\". Points for receiving news are given only once per person.",
      "",
      "4) Who can access your data",
      "The shop owner and staff, only as needed for their work (staff see only part of your phone number), and the system provider. The Shop does not sell or share your data with others for marketing.",
      "",
      "5) Where your data is stored",
      "On cloud servers in Singapore, encrypted in transit.",
      "",
      "6) How long we keep your data",
      "For as long as you are a member. When you delete your account, the Shop deletes your name, phone number, date of birth, picture and LINE account. Only anonymous purchase history remains, together with a code derived from your LINE account that cannot be turned back into your account. This code is used only to prevent the points for receiving news from being given twice.",
      "",
      "7) Your rights",
      "• View and edit your data yourself in \"Edit profile\"",
      "• Delete your account yourself in \"Edit profile\" → \"Delete membership\" (remaining points and coupons will be lost and cannot be restored)",
      "• Withdraw your consent to receive news at any time",
      "• To request a copy of your data, object, or ask questions, contact the Shop in store or via the Shop's LINE account",
      "• File a complaint with Thailand's Personal Data Protection Committee",
      "",
      "8) Changes to this policy",
      "When the Shop updates this policy, you will be notified and asked to accept the new version before you continue using your membership card."
    ].join('\n')
  }
};
