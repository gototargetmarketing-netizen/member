// ส่งข้อความตามกลุ่ม (ผู้ใช้เลือกแบบ ข 12 พ.ย. 2569 — ร้านส่งข้อความหาลูกค้าผ่าน LINE OA ของร้านได้จากหลังบ้าน)
// รอบ 1: คัดกลุ่มลูกค้า → นับจำนวน + ตัวอย่างรายชื่อ (adminAudience)
// รอบ 2: ดูสถานะ OA + ประวัติ / ส่งทดสอบหาตัวเอง / ส่งจริง / ส่งต่อส่วนที่ค้าง (ต้องมีรหัส OA ของร้านใน Vercel — ดู lineoa.js)
//   รูปส่งเป็นริชเมสเสจ (imagemap) เต็มความกว้างแชต — อัปโหลดด้วย adminUploadRichImage (12 พ.ย. 2569 / API 0.9.0)
// รอบ 3: สถานะเพื่อน OA (จดตอนลูกค้าเปิดบัตร — oafriend.js) → แยกจำนวน "ได้รับจริง" / บังคับเพิ่มเพื่อนก่อนสมัคร (customer.js)
//
// หลัก:
// - ส่งได้เฉพาะลูกค้าที่ "ยินยอมรับข่าวสาร" + ไม่ถูกระงับ + สมัครผ่าน LINE — กรองที่นี่เสมอ หน้าเว็บปิดไม่ได้ (PDPA)
// - LINE ID ของลูกค้าไม่ออกจากตัวกลาง (ตัวอย่างรายชื่อไม่มี LINE ID / เบอร์) — รอบ 2 ตัวกลางส่งเอง
// - เงื่อนไขทุกข้อต้องตรงพร้อมกัน (และ) / ช่องที่เว้นว่าง = ไม่กรองข้อนั้น
'use strict';
const { userError } = require('./errors');
const U = require('./util');
const T = require('./tiers');
const { retryKey } = require('./lineoa');

const PREVIEW = 20;
const MAX_DAYS = 3650; // 10 ปี
const MAX_IDS = 50;    // ระดับ/สาขาที่เลือกได้ต่อครั้ง (ร้านมีระดับไม่เกิน 5 สาขาไม่เกิน 50)

// ส่งได้ = 3 เงื่อนไขนี้ครบ (ใช้ทั้งตอนนับ และรอบ 2 ตอนส่งจริง)
const SENDABLE_SQL = `status = 'ACTIVE' and marketing_consent and line_user_id is not null`;

const blank = (v) => String(v == null ? '' : v).replace(/,/g, '').trim() === '';
function num(v, max, label) {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!isFinite(n) || Math.floor(n) !== n || n < 0 || n > max) throw userError(label + 'ต้องเป็นจำนวนเต็ม 0–' + U.fmtNum(max), 'BAD_INPUT');
  return n;
}
function days(v, label) {
  if (blank(v)) return null;
  const n = num(v, MAX_DAYS, label);
  if (n < 1) throw userError(label + 'ต้องเป็น 1–' + U.fmtNum(MAX_DAYS) + ' วัน', 'BAD_INPUT');
  return n;
}
// ตั้งแต่ … ถึง … (เว้นว่างข้างใดข้างหนึ่งได้)
function range(f, key, max, label) {
  const lo = num(f[key + 'Min'], max, label);
  const hi = num(f[key + 'Max'], max, label);
  if (lo != null && hi != null && lo > hi) throw userError(label + ': ค่าเริ่มต้องไม่มากกว่าค่าสิ้นสุด', 'BAD_INPUT');
  return [lo, hi];
}
function idList(v, re, label) {
  if (v == null || v === '') return [];
  if (!Array.isArray(v) || v.length > MAX_IDS) throw userError(label + 'ไม่ถูกต้อง', 'BAD_INPUT');
  return [...new Set(v.map((x) => U.upper(x)))].map((x) => {
    if (!re.test(x)) throw userError(label + 'ไม่ถูกต้อง', 'BAD_INPUT');
    return x;
  });
}

// เงื่อนไขจากหน้าเว็บ → ค่าที่ตรวจแล้ว (ผิด = แจ้งผู้ใช้ ไม่เดาแทน)
function cleanFilter(raw, tiers, now) {
  const f = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // ระดับ: ต้องเป็นระดับที่ร้านนี้มีอยู่จริง (ร้านปิดใช้ระดับ → ไม่สนช่องนี้)
  const tierIds = T.tiersOn(tiers) ? idList(f.tiers, /^T\d{1,3}$/, 'ระดับ') : [];
  if (tierIds.some((id) => !T.tierById(tiers, id))) throw userError('ระดับที่เลือกไม่มีแล้ว กรุณาโหลดหน้าใหม่', 'BAD_TIER');
  // สาขาที่สมัคร: ตรวจแค่รูปแบบ (รหัสที่ไม่มีจริงก็แค่ไม่เจอใคร — แบบเดียวกับตัวกรองสาขาในหน้ารายชื่อ)
  const branches = idList(f.branches, /^[A-Z0-9]{1,12}$/, 'สาขา');
  const month = blank(f.birthMonth) ? 0 : num(f.birthMonth, 12, 'เดือนเกิด');
  if (month === 0 && !blank(f.birthMonth)) throw userError('เดือนเกิดไม่ถูกต้อง', 'BAD_INPUT');
  const [pointsMin, pointsMax] = range(f, 'points', 1e9, 'แต้มคงเหลือ');
  const [spendMin, spendMax] = range(f, 'spend', 1e10, 'ยอดซื้อรวม');
  const [visitsMin, visitsMax] = range(f, 'visits', 1e7, 'จำนวนครั้งที่มา');
  const ago = (n) => (n == null ? null : new Date(now.getTime() - n * U.DAY_MS));
  // มาซื้อครั้งล่าสุด: within = มาภายใน N วัน / over = ไม่ได้มาเกิน N วัน (ยังไม่เคยซื้อ นับจากวันสมัคร — ไว้ดึงลูกค้าที่หายไปกลับมา)
  const mode = String(f.lastVisit || '');
  if (['', 'within', 'over'].indexOf(mode) < 0) throw userError('เงื่อนไขมาซื้อครั้งล่าสุดไม่ถูกต้อง', 'BAD_INPUT');
  const lastDays = mode ? days(f.lastVisitDays, 'จำนวนวันที่มาซื้อครั้งล่าสุด') : null;
  if (mode && lastDays == null) throw userError('กรุณาใส่จำนวนวัน (มาซื้อครั้งล่าสุด)', 'BAD_INPUT');
  return {
    tierIds, branches, month, pointsMin, pointsMax, spendMin, spendMax, visitsMin, visitsMax,
    visitedSince: mode === 'within' ? ago(lastDays) : null,
    quietSince: mode === 'over' ? ago(lastDays) : null,
    joinedSince: ago(days(f.joinedDays, 'สมัครภายใน'))
  };
}

// เงื่อนไข SQL ชุดเดียว (ค่าว่าง/null = ไม่กรองข้อนั้น) — ไม่ต่อข้อความ SQL จากค่าที่ส่งมา
const WHERE = `shop_id = $1
  and (cardinality($2::text[]) = 0 or tier_id = any($2::text[]))
  and (cardinality($3::text[]) = 0 or joined_branch = any($3::text[]))
  and ($4::int = 0 or extract(month from birth_date) = $4::int)
  and ($5::int is null or points >= $5::int) and ($6::int is null or points <= $6::int)
  and ($7::numeric is null or total_spend >= $7::numeric) and ($8::numeric is null or total_spend <= $8::numeric)
  and ($9::int is null or visit_count >= $9::int) and ($10::int is null or visit_count <= $10::int)
  and ($11::timestamptz is null or last_visit_at >= $11::timestamptz)
  and ($12::timestamptz is null or coalesce(last_visit_at, joined_at) < $12::timestamptz)
  and ($13::timestamptz is null or joined_at >= $13::timestamptz)`;
const whereArgs = (shopId, c) => [shopId, c.tierIds, c.branches, c.month, c.pointsMin, c.pointsMax, c.spendMin, c.spendMax,
  c.visitsMin, c.visitsMax, c.visitedSince, c.quietSince, c.joinedSince];

// ---------- คำสั่ง: นับกลุ่ม + ตัวอย่างรายชื่อ (เจ้าของร้านเท่านั้น — ตรวจใน router) ----------
// เงื่อนไขจากหน้าเว็บ → ค่าที่ใช้ค้น (ตอนนับ กับตอนส่งจริง ใช้ชุดเดียวกัน จำนวนคนจึงตรงกัน)
async function prepare(ctx, filter) {
  const tiers = await T.loadTiers(ctx.db, ctx.shop.id);
  const on = T.tiersOn(tiers);
  if (on) await T.syncDue(ctx.db, ctx.shop.id, tiers, ctx.now); // ระดับที่ครบกำหนดลดก่อนกรอง
  const c = cleanFilter(filter, tiers, ctx.now);
  return { tiers, on, c, args: whereArgs(ctx.shop.id, c) };
}

async function adminAudience(p, ctx) {
  const { tiers, on, args } = await prepare(ctx, p.filter);

  // ตรงเงื่อนไขทั้งหมด แยกเหตุผลที่ส่งไม่ได้ (ไล่ตามลำดับ ไม่นับซ้ำ: ไม่ยินยอม → ถูกระงับ → ไม่ได้สมัครผ่าน LINE)
  const n = (await ctx.db.query(`select count(*)::int as matched,
      (count(*) filter (where ${SENDABLE_SQL}))::int as sendable,
      (count(*) filter (where not marketing_consent))::int as no_consent,
      (count(*) filter (where marketing_consent and status <> 'ACTIVE'))::int as blocked,
      (count(*) filter (where marketing_consent and status = 'ACTIVE' and line_user_id is null))::int as no_line,
      (count(*) filter (where ${SENDABLE_SQL} and oa_friend))::int as friend_yes,
      (count(*) filter (where ${SENDABLE_SQL} and oa_friend = false))::int as friend_no
    from members where ${WHERE}`, args)).rows[0];

  // ตัวอย่าง: คนที่ส่งได้ สมัครล่าสุดก่อน — ไม่มี LINE ID / เบอร์ / วันเกิด (ดูได้ในหน้าสมาชิกอยู่แล้ว)
  const rows = (await ctx.db.query(`select id, name, tier_id, points, total_spend::float8 as total_spend, visit_count, last_visit_at, joined_at, joined_branch
    from members where ${WHERE} and ${SENDABLE_SQL} order by joined_at desc, id limit ${PREVIEW}`, args)).rows;
  const tierName = (id) => { const t = on && T.tierById(tiers, id); return t ? t.name : ''; };
  const out = {
    matched: n.matched,
    sendable: n.sendable,
    excluded: { noConsent: n.no_consent, blocked: n.blocked, noLine: n.no_line },
    // ในคนที่ส่งได้: เป็นเพื่อน OA (ได้รับจริง) / ยังไม่เป็นเพื่อนหรือบล็อก (LINE ข้ามให้ ไม่เสียโควตา) / ยังไม่รู้ (ยังไม่ได้เปิดบัตรตั้งแต่เริ่มจด)
    // ส่งให้ทุกคนที่ส่งได้เสมอ — สถานะที่จดอาจเก่า (เพิ่มเพื่อนแล้วแต่ยังไม่ได้เปิดบัตร) LINE ตัดสินเองตอนส่ง
    reach: { friend: n.friend_yes, notFriend: n.friend_no, unknown: n.sendable - n.friend_yes - n.friend_no },
    items: rows.map((m) => ({
      memberId: String(m.id), name: String(m.name || ''), tierId: on ? String(m.tier_id || '') : '', tier: tierName(m.tier_id),
      points: U.toInt(m.points), totalSpend: U.toNum(m.total_spend), visitCount: U.toInt(m.visit_count),
      lastVisitAt: U.iso(m.last_visit_at), joinedAt: U.iso(m.joined_at), joinedBranch: U.upper(m.joined_branch)
    })),
    previewLimit: PREVIEW
  };
  if (on) out.tiers = T.publicTiers(tiers); // ตัวเลือกระดับในหน้าเว็บ
  return out;
}

// ===================== รอบ 2: ส่งข้อความ =====================
const BATCH = 500;              // LINE ส่งแบบหลายคนได้ครั้งละไม่เกิน 500 คน
const MAX_TEXT = 2000;          // LINE รับได้ 5,000 ตัว — จำกัดให้สั้นกว่า อ่านง่ายบนมือถือ
const TIME_BUDGET_MS = 40000;   // ส่งไม่ทันในเวลานี้ = หยุดไว้ก่อน ให้กด "ส่งต่อ" (Vercel ตัดคำขอที่นานเกิน)
const STALE_SEC = 90;           // สถานะ "กำลังส่ง" ที่ไม่ขยับนานเท่านี้ = เครื่องหยุดกลางทาง → ส่งต่อได้
const HISTORY = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getOa = (ctx) => (ctx.deps && typeof ctx.deps.oa === 'function' ? ctx.deps.oa(ctx.shop.id) : null);
function needOa(ctx) {
  const oa = getOa(ctx);
  if (!oa) throw userError('ร้านยังไม่ได้เชื่อม LINE OA กับระบบ กรุณาติดต่อผู้ดูแลระบบ', 'OA_NOT_CONNECTED');
  return oa;
}

// LINE ตอบผิดพลาด → ข้อความถึงเจ้าของร้าน (รายละเอียดจริงอยู่ใน log)
function oaProblem(e) {
  const st = e && e.status;
  if (st === 401 || st === 403) return { code: 'OA_TOKEN', msg: 'การเชื่อม LINE OA ของร้านใช้ไม่ได้ (รหัสหมดอายุหรือถูกเปลี่ยน) กรุณาติดต่อผู้ดูแลระบบ' };
  if (st === 429) return { code: 'OA_LIMIT', msg: 'LINE OA ของร้านส่งเกินโควตาเดือนนี้ หรือส่งถี่เกินไป ลองใหม่ภายหลัง หรือเพิ่มแพ็กเกจ LINE OA' };
  if (st === 400) return { code: 'OA_REJECTED', msg: 'LINE ไม่รับข้อความนี้ ลองตรวจรูปและข้อความอีกครั้ง' };
  return { code: 'OA_DOWN', msg: 'ติดต่อ LINE ไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้ง' };
}
function oaFail(ctx, e, what) {
  console.error('LINE OA ร้าน ' + ctx.shop.id + ' (' + what + '): ' + (e && e.message ? e.message : e));
  const pr = oaProblem(e);
  return userError(pr.msg, pr.code);
}

// ---------- รูปแบบริชเมสเสจ (ผู้ใช้ขอ 12 พ.ย. 2569: รูปเต็มความกว้างแชต แทนรูปย่อของข้อความรูปธรรมดา) ----------
// LINE เรียกว่า imagemap: ต้องมีรูป 5 ขนาดที่ <ลิงก์ฐาน>/<ความกว้าง> (ห้ามมีนามสกุลไฟล์) LINE เลือกขนาดตามเครื่องลูกค้าเอง
// + ต้องมี "แตะแล้วไปไหน" อย่างน้อย 1 จุด → ทั้งรูปเป็นจุดเดียว เปิดลิงก์ที่ร้านใส่ (ว่าง = บัตรสมาชิกของร้าน)
const RICH_WIDTHS = [1040, 700, 460, 300, 240];
const RICH_MIN_H = 520;                 // แนวนอนสุด 2:1
const RICH_MAX_H = 1560;                // แนวตั้งสุด 2:3 (ยาวกว่านี้ลูกค้าต้องเลื่อนจอดูรูปเดียว)
const RICH_FILE_BYTES = 1024 * 1024;    // ต่อไฟล์ (LINE รับ 10MB แต่ไฟล์เล็ก = ลูกค้าเปิดเร็ว เปลืองเน็ตน้อย)
const RICH_PATH = /\/rich-\d{4}-\d{2}-\d{2}-[A-Z0-9]{6}$/;
const ALT_MAX = 100;                    // ข้อความแจ้งเตือนบนจอล็อก (LINE รับ 1,500 แต่จอแสดงได้ไม่กี่บรรทัด)

// ขนาดรูปจากหัวไฟล์ (JPG / PNG) — ไม่ต้องลงโปรแกรมย่อรูปบน Vercel: หน้าเว็บย่อให้ ที่นี่แค่ตรวจว่าขนาดตรงจริง
function imageSize(b) {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504E47 && b.readUInt32BE(4) === 0x0D0A1A0A && b.toString('latin1', 12, 16) === 'IHDR') {
    return { mime: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.length >= 4 && b[0] === 0xFF && b[1] === 0xD8) {
    // ไล่ส่วนหัวของ JPG หาส่วน SOF (บอกขนาดรูป) — ข้ามส่วนอื่นตามความยาวที่ระบุ
    let i = 2;
    while (i + 9 <= b.length) {
      if (b[i] !== 0xFF) return null;
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { mime: 'image/jpeg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

// ข้อความ + ริชเมสเสจ → ข้อความในรูปแบบของ LINE (รูปก่อน แล้วตามด้วยข้อความ — ส่งครั้งเดียว นับ 1 ข้อความต่อคนในโควตา)
// shop = แถวร้าน (ลิงก์บัตรสมาชิก + ชื่อร้านสำหรับข้อความแจ้งเตือน) / รูปต้องเป็นของร้านนี้ที่อัปโหลดจากหน้านี้ (มีครบ 5 ขนาด)
function cleanDraft(raw, shop) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const text = String(d.text == null ? '' : d.text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{4,}/g, '\n\n\n').trim();
  if ([...text].length > MAX_TEXT) throw userError('ข้อความยาวได้ไม่เกิน ' + U.fmtNum(MAX_TEXT) + ' ตัวอักษร', 'BAD_MESSAGE');
  const image = String(d.image == null ? '' : d.image).trim();
  let height = 0;
  let link = '';
  if (image) {
    let ok = false;
    try {
      const u = new URL(image);
      ok = !!U.safeUrl(image) && !u.search && !u.hash && RICH_PATH.test(u.pathname) && u.pathname.includes('/' + shop.id + '/rich-');
    } catch (e) { ok = false; }
    if (!ok) throw userError('รูปไม่ถูกต้อง กรุณาอัปโหลดรูปจากหน้านี้ใหม่', 'BAD_IMAGE');
    height = Number(d.imageHeight);
    if (!Number.isInteger(height) || height < RICH_MIN_H || height > RICH_MAX_H) throw userError('ขนาดรูปไม่ถูกต้อง กรุณาอัปโหลดรูปจากหน้านี้ใหม่', 'BAD_IMAGE');
    link = String(d.link == null ? '' : d.link).trim();
    if (link) {
      // แปลงอักษรไทยในลิงก์เป็นรูปที่ LINE รับ (LINE ปฏิเสธลิงก์ที่ไม่ได้เข้ารหัส)
      try { const u = new URL(link); link = u.protocol === 'https:' ? u.href : ''; } catch (e) { link = ''; }
      if (!link || !U.safeUrl(link)) throw userError('ลิงก์เมื่อแตะรูปต้องขึ้นต้นด้วย https:// (เว้นว่าง = เปิดบัตรสมาชิกของร้าน)', 'BAD_LINK');
    } else {
      if (!shop.liff_id) throw userError('กรุณาใส่ลิงก์ที่จะเปิดเมื่อลูกค้าแตะรูป', 'BAD_LINK');
      link = 'https://liff.line.me/' + shop.liff_id;
    }
  }
  if (!text && !image) throw userError('กรุณาพิมพ์ข้อความหรือใส่รูปอย่างน้อย 1 อย่าง', 'BAD_MESSAGE');
  const messages = [];
  if (image) {
    // ข้อความแจ้งเตือน = บรรทัดแรกของข้อความที่พิมพ์ / ไม่พิมพ์ = "ข้อความจาก <ร้าน>"
    const first = [...(text.split('\n').find((l) => l.trim()) || '').trim()];
    const alt = first.length ? first.slice(0, ALT_MAX).join('') + (first.length > ALT_MAX ? '…' : '') : 'ข้อความจาก ' + (shop.name || 'ร้าน');
    messages.push({
      type: 'imagemap', baseUrl: image, altText: alt, baseSize: { width: 1040, height },
      actions: [{ type: 'uri', label: 'เปิดลิงก์', linkUri: link, area: { x: 0, y: 0, width: 1040, height } }]
    });
  }
  if (text) messages.push({ type: 'text', text });
  return { text, image, height, link, messages };
}

// ประวัติก่อนมีริชเมสเสจ (ไม่มีช่อง messages) → สร้างข้อความแบบเดิม: รูปธรรมดา + ข้อความ
function legacyMessages(b) {
  const out = [];
  if (b.message_image) out.push({ type: 'image', originalContentUrl: b.message_image, previewImageUrl: b.message_image });
  if (b.message_text) out.push({ type: 'text', text: b.message_text });
  return out;
}

// ---------- คำสั่ง: อัปโหลดรูปริชเมสเสจ (หน้าเว็บย่อเป็น 5 ขนาดมาแล้ว — ส่งมาพร้อมกันในคำขอเดียว) ----------
// เก็บที่ <ร้าน>/rich-<วันที่>-<สุ่ม>/<ความกว้าง> → ลิงก์ฐาน = โฟลเดอร์นั้น (LINE ต่อท้าย /1040 ฯลฯ เอง)
async function adminUploadRichImage(p, ctx) {
  needOa(ctx); // ร้านที่ไม่มีแพ็กเกจส่งข้อความ (ไม่มีรหัส OA) ไม่ต้องอัปรูปชนิดนี้
  const imgs = p.images && typeof p.images === 'object' && !Array.isArray(p.images) ? p.images : {};
  const bad = (msg) => userError(msg || 'ไฟล์รูปไม่ถูกต้อง กรุณาเลือกรูปใหม่', 'BAD_IMAGE');
  const files = RICH_WIDTHS.map((w) => {
    const data = String(imgs[w] || '');
    if (!data || data.length > Math.ceil(RICH_FILE_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw bad(data ? 'รูปใหญ่เกินไป ลองใช้รูปอื่น' : '');
    }
    const bytes = Buffer.from(data, 'base64');
    const size = imageSize(bytes);
    if (!size || size.w !== w || bytes.length > RICH_FILE_BYTES) throw bad(); // LINE รับเฉพาะ JPG / PNG ความกว้างตามนี้พอดี
    return { w, h: size.h, mime: size.mime, bytes };
  });
  const height = files[0].h;
  if (height < RICH_MIN_H || height > RICH_MAX_H) {
    throw bad('สัดส่วนรูปต้องอยู่ระหว่างแนวนอน 2:1 ถึงแนวตั้ง 2:3 (แนะนำ 1040 × 1040 px)');
  }
  // ทุกขนาดต้องสัดส่วนเดียวกับรูปใหญ่ (ปัดเศษได้ 2 px) ไม่งั้นจุดแตะเพี้ยนจากรูปบางเครื่อง
  if (files.some((f) => Math.abs(f.h - Math.round(f.w * height / 1040)) > 2)) throw bad();
  const dir = ctx.shop.id + '/rich-' + U.thaiDay(ctx.now) + '-' + U.randomCode(6);
  let urls;
  try {
    urls = await Promise.all(files.map((f) => ctx.deps.storage().upload(dir + '/' + f.w, f.bytes, f.mime)));
  } catch (e) {
    console.error('อัปโหลดรูปริชเมสเสจไม่สำเร็จ: ' + (e && e.message ? e.message : e));
    throw userError('บันทึกรูปไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้ติดต่อผู้ดูแลระบบ', 'STORAGE_ERROR');
  }
  const base = String(urls[0]).replace(/\/1040$/, '');
  if (!urls.every((u, i) => u === base + '/' + RICH_WIDTHS[i])) throw new Error('ลิงก์รูปริชเมสเสจไม่ตรงรูปแบบ: ' + urls.join(' '));
  console.log('อัปโหลดรูปริชเมสเสจ ' + dir + ' (1040×' + height + ', ' + files.reduce((s, f) => s + f.bytes.length, 0) + ' bytes) โดย ' + ctx.staff.name);
  return { image: base, height };
}

// โควตาข้อความเดือนนี้ของ OA (แพ็กเกจของ LINE OA ร้าน ไม่ใช่ของเรา)
async function quotaOf(oa) {
  const [q, u] = await Promise.all([oa.quota(), oa.consumption()]);
  const used = U.toInt(u && u.totalUsage);
  if (q && q.type === 'limited') {
    const limit = U.toInt(q.value);
    return { limited: true, limit, used, remaining: Math.max(0, limit - used) };
  }
  return { limited: false, limit: null, used, remaining: null };
}

const COLS = `id, created_at, updated_at, finished_at, created_by_name, message_text, message_image, total, sent, status, error`;
function view(b, now) {
  const stalled = b.status === 'SENDING' && now.getTime() - new Date(b.updated_at).getTime() > STALE_SEC * 1000;
  const status = stalled ? 'STALLED' : String(b.status);
  return {
    id: String(b.id), createdAt: U.iso(b.created_at), finishedAt: U.iso(b.finished_at), by: String(b.created_by_name || ''),
    text: String(b.message_text || '').slice(0, 200), image: String(b.message_image || ''),
    total: U.toInt(b.total), sent: U.toInt(b.sent), status, error: String(b.error || ''),
    canResume: status === 'PARTIAL' || status === 'FAILED' || status === 'STALLED'
  };
}
async function history(ctx) {
  return (await ctx.db.query(`select ${COLS} from broadcasts where shop_id = $1 order by created_at desc, id desc limit ${HISTORY}`, [ctx.shop.id]))
    .rows.map((b) => view(b, ctx.now));
}

// ส่งทีละชุด 500 คน ตามลำดับรหัสสมาชิกที่จดไว้ — จดความคืบหน้าทุกชุด (เครื่องหยุดกลางทาง ก็รู้ว่าชุดไหนส่งแล้ว)
// รหัสกันส่งซ้ำของแต่ละชุดคงที่ (ร้าน + รหัสการส่ง + ลำดับชุด) → ส่งชุดเดิมซ้ำ LINE ไม่ส่งให้ลูกค้าซ้ำ
async function runBatches(ctx, oa, b) {
  const t0 = Date.now();
  const shopId = ctx.shop.id;
  const ids = b.recipients || [];
  const n = Math.ceil(ids.length / BATCH);
  const done = new Set((b.batches_done || []).map(Number));
  // ส่งก้อนที่จดไว้ตอนกดส่ง (ทุกชุดได้ข้อความเหมือนกัน แม้ร้านแก้ชื่อ/ลิงก์ระหว่างนั้น) — ประวัติเก่าไม่มีก้อนนี้ สร้างแบบเดิม
  const messages = Array.isArray(b.messages) && b.messages.length ? b.messages : legacyMessages(b);
  let sent = U.toInt(b.sent);
  let error = '';
  for (let i = 0; i < n && !error; i++) {
    if (done.has(i)) continue;
    if (Date.now() - t0 > TIME_BUDGET_MS) { error = 'TIME'; break; }
    // ส่งเฉพาะคนที่ยังส่งได้ตอนนี้ (กด "ส่งต่อ" ทีหลัง อาจมีคนเลิกรับข่าวสาร / ถูกระงับไปแล้ว)
    const to = (await ctx.db.query(`select line_user_id from members where shop_id = $1 and id = any($2::text[]) and ${SENDABLE_SQL} order by id`,
      [shopId, ids.slice(i * BATCH, (i + 1) * BATCH)])).rows.map((r) => r.line_user_id);
    let ok = to.length === 0;
    for (let attempt = 0; attempt < 2 && !ok && !error; attempt++) {
      try {
        await oa.multicast(to, messages, retryKey(['bc', shopId, b.id, i].join(':')));
        ok = true;
      } catch (e) {
        if (e && e.status === 409) { ok = true; break; } // LINE รับชุดนี้ไปแล้ว (ส่งครั้งก่อนแต่ไม่ทันได้คำตอบ)
        const pr = oaProblem(e);
        console.error('ส่งข้อความ ' + b.id + ' ชุดที่ ' + (i + 1) + '/' + n + ' ร้าน ' + shopId + ': ' + (e && e.message ? e.message : e));
        if (pr.code === 'OA_DOWN' && attempt === 0) { await sleep(800); continue; } // LINE ขัดข้องชั่วคราว → ลองอีกครั้ง
        error = pr.code;
      }
    }
    if (ok) {
      sent += to.length;
      done.add(i);
      await ctx.db.query(`update broadcasts set sent = $3, batches_done = $4::int[], updated_at = now() where shop_id = $1 and id = $2`,
        [shopId, b.id, sent, [...done].sort((x, y) => x - y)]);
    }
  }
  const all = done.size === n;
  const status = all ? 'DONE' : sent > 0 ? 'PARTIAL' : 'FAILED';
  const row = (await ctx.db.query(`update broadcasts set status = $3, error = $4, sent = $5, batches_done = $6::int[], updated_at = now(),
      finished_at = case when $3 = 'DONE' then now() else finished_at end where shop_id = $1 and id = $2 returning ${COLS}`,
    [shopId, b.id, status, all ? '' : error || 'TIME', sent, [...done].sort((x, y) => x - y)])).rows[0];
  console.log('ส่งข้อความตามกลุ่ม ' + b.id + ' ร้าน ' + shopId + ': ' + sent + '/' + b.total + ' คน ' + status + (error ? ' (' + error + ')' : '') +
    ' โดย ' + ctx.staff.name + ' (' + ctx.user.userId + ')');
  return row;
}

// จองสิทธิ์ส่งต่อ: ได้เฉพาะเมื่อไม่มีใครกำลังส่งอยู่ (กันกด "ส่งต่อ" สองที่พร้อมกันแล้วชุดเดียวกันถูกส่งพร้อมกัน)
async function claim(ctx, id) {
  return (await ctx.db.query(`update broadcasts set status = 'SENDING', error = '', updated_at = now()
      where shop_id = $1 and id = $2 and status <> 'DONE' and (status <> 'SENDING' or updated_at < now() - interval '${STALE_SEC} seconds')
      returning *`, [ctx.shop.id, id])).rows[0];
}

// ---------- คำสั่ง: สถานะ OA + โควตา + ประวัติ (เปิดหน้าส่งข้อความ) ----------
async function adminBroadcastInfo(p, ctx) {
  const items = await history(ctx);
  const oa = getOa(ctx);
  if (!oa) return { connected: false, history: items };
  try {
    const [info, quota, ownerIsFriend] = await Promise.all([oa.info(), quotaOf(oa),
      oa.profile(ctx.user.userId).then(() => true, (e) => { if (e && e.status === 404) return false; throw e; })]);
    return {
      connected: true,
      oa: { name: String(info.displayName || ''), basicId: String(info.basicId || ''), picture: U.safeUrl(info.pictureUrl) },
      quota, ownerIsFriend, history: items
    };
  } catch (e) {
    console.error('เชื่อม LINE OA ร้าน ' + ctx.shop.id + ' ไม่ได้: ' + (e && e.message ? e.message : e));
    const pr = oaProblem(e);
    return { connected: false, problem: pr.code, problemText: pr.msg, history: items };
  }
}

// ---------- คำสั่ง: ส่งทดสอบหาเจ้าของร้านเอง (ใช้โควตา 1 ข้อความ) ----------
async function adminBroadcastTest(p, ctx) {
  const oa = needOa(ctx);
  const d = cleanDraft(p.draft, ctx.shop);
  const reqId = U.cleanRequestId(p.requestId);
  try {
    await oa.profile(ctx.user.userId);
  } catch (e) {
    // ไม่เป็นเพื่อน → ส่งไม่ถึง (ถ้าเพิ่มเพื่อนแล้วยังขึ้นแบบนี้ = OA อยู่คนละ Provider กับหน้าสมาชิก)
    if (e && e.status === 404) throw userError('บัญชี LINE ของคุณยังไม่ได้เพิ่ม LINE OA ของร้านเป็นเพื่อน เพิ่มเพื่อนก่อนแล้วลองใหม่', 'NOT_FRIEND');
    throw oaFail(ctx, e, 'เช็กเพื่อน');
  }
  try {
    await oa.push(ctx.user.userId, d.messages, retryKey(['test', ctx.shop.id, ctx.user.userId, reqId].join(':')));
  } catch (e) {
    if (!(e && e.status === 409)) throw oaFail(ctx, e, 'ส่งทดสอบ');
  }
  console.log('ส่งทดสอบหาตัวเอง ร้าน ' + ctx.shop.id + ' โดย ' + ctx.staff.name);
  return { sent: true };
}

// ---------- คำสั่ง: ส่งจริง ----------
// expect = จำนวนคนที่เจ้าของร้านเห็นตอนกดยืนยัน — คิดใหม่แล้วไม่ตรง (มีคนสมัคร/เลิกรับข่าวสารระหว่างนั้น) = ไม่ส่ง ให้ตรวจใหม่
async function adminBroadcastSend(p, ctx) {
  const oa = needOa(ctx);
  const shopId = ctx.shop.id;
  const reqId = U.cleanRequestId(p.requestId);
  // กดซ้ำ / ส่งใหม่หลังเน็ตหลุด → ได้การส่งเดิม (ค้างอยู่ก็ส่งต่อให้) ไม่สร้างรอบใหม่
  const prev = (await ctx.db.query('select * from broadcasts where shop_id = $1 and request_id = $2', [shopId, reqId])).rows[0];
  if (prev) return { broadcast: view(await resumeRow(ctx, oa, prev), ctx.now) };

  const d = cleanDraft(p.draft, ctx.shop);
  const { c, args } = await prepare(ctx, p.filter);
  const ids = (await ctx.db.query(`select id from members where ${WHERE} and ${SENDABLE_SQL} order by id`, args)).rows.map((r) => String(r.id));
  if (!ids.length) throw userError('ไม่มีลูกค้าที่ส่งได้ตามเงื่อนไขนี้', 'NO_RECIPIENTS');
  if (Number(p.expect) !== ids.length) {
    throw userError('จำนวนลูกค้าในกลุ่มเปลี่ยนเป็น ' + U.fmtNum(ids.length) + ' คน กรุณากด "ดูจำนวนคน" แล้วตรวจอีกครั้ง', 'AUDIENCE_CHANGED');
  }
  let quota;
  try { quota = await quotaOf(oa); } catch (e) { throw oaFail(ctx, e, 'ดูโควตา'); }
  // โควตาที่ใช้ = คนที่อาจได้รับ (ไม่นับคนที่รู้แน่ว่าไม่เป็นเพื่อน/บล็อก — LINE ไม่ส่งและไม่คิดโควตา)
  const need = (await ctx.db.query(`select count(*)::int as n from members where shop_id = $1 and id = any($2::text[]) and oa_friend is distinct from false`,
    [shopId, ids])).rows[0].n;
  if (quota.limited && quota.remaining < need) {
    throw userError('โควตาข้อความเดือนนี้ของ LINE OA เหลือ ' + U.fmtNum(quota.remaining) + ' ข้อความ ไม่พอส่ง ' + U.fmtNum(need) +
      ' คน ลดกลุ่มลง หรือเพิ่มแพ็กเกจ LINE OA', 'QUOTA_NOT_ENOUGH');
  }
  // เงื่อนไขที่ใช้ (จดไว้ดูย้อนหลัง) — เก็บเฉพาะค่าที่ตรวจแล้ว
  const filter = { tiers: c.tierIds, branches: c.branches, birthMonth: c.month || null, pointsMin: c.pointsMin, pointsMax: c.pointsMax,
    spendMin: c.spendMin, spendMax: c.spendMax, visitsMin: c.visitsMin, visitsMax: c.visitsMax,
    lastVisit: p.filter && p.filter.lastVisit ? String(p.filter.lastVisit) : '', lastVisitDays: c.visitedSince || c.quietSince ? U.toInt(p.filter.lastVisitDays) : null,
    joinedDays: c.joinedSince ? U.toInt(p.filter.joinedDays) : null };
  const row = (await ctx.db.query(`insert into broadcasts (shop_id, id, request_id, created_by, created_by_name, filter, message_text, message_image, messages, recipients, total)
      values ($1, $2, $3, $4, $5, $6::text::jsonb, $7, $8, $9::text::jsonb, $10::text[], $11)
      on conflict (shop_id, request_id) do nothing returning *`,
    [shopId, 'BC-' + U.randomCode(8), reqId, ctx.user.userId, ctx.staff.name || '', JSON.stringify(filter), d.text, d.image, JSON.stringify(d.messages), ids, ids.length])).rows[0];
  if (!row) { // คำขอเดียวกันมาถึงพร้อมกันอีกอัน → ใช้แถวของอันนั้น
    const other = (await ctx.db.query('select * from broadcasts where shop_id = $1 and request_id = $2', [shopId, reqId])).rows[0];
    return { broadcast: view(other, ctx.now) };
  }
  return { broadcast: view(await runBatches(ctx, oa, row), ctx.now) };
}

// ส่งต่อเฉพาะเมื่อค้าง/ไม่ครบ และไม่มีใครกำลังส่งอยู่ — นอกนั้นคืนสถานะเดิม
async function resumeRow(ctx, oa, b) {
  if (b.status === 'DONE') return b;
  const mine = await claim(ctx, b.id);
  return mine ? runBatches(ctx, oa, mine) : b;
}

// ---------- คำสั่ง: ส่งต่อส่วนที่ค้าง (กดจากประวัติการส่ง) ----------
async function adminBroadcastResume(p, ctx) {
  const oa = needOa(ctx);
  const id = U.upper(p.id);
  if (!/^BC-[A-Z0-9]{6,12}$/.test(id)) throw userError('ไม่พบการส่งนี้', 'NOT_FOUND');
  const b = (await ctx.db.query('select * from broadcasts where shop_id = $1 and id = $2', [ctx.shop.id, id])).rows[0];
  if (!b) throw userError('ไม่พบการส่งนี้', 'NOT_FOUND');
  if (b.status === 'DONE') return { broadcast: view(b, ctx.now) };
  const mine = await claim(ctx, id);
  if (!mine) throw userError('การส่งนี้กำลังทำงานอยู่ รอสักครู่แล้วโหลดหน้าใหม่', 'BUSY');
  return { broadcast: view(await runBatches(ctx, oa, mine), ctx.now) };
}

module.exports = {
  adminAudience, adminBroadcastInfo, adminBroadcastTest, adminBroadcastSend, adminBroadcastResume, adminUploadRichImage,
  cleanFilter, cleanDraft, imageSize, SENDABLE_SQL, PREVIEW, BATCH, RICH_WIDTHS
};
