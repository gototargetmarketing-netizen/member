// จำลองบริการของ Google Apps Script เท่าที่ code.gs ใช้ เพื่อรันทดสอบด้วย Node
const vm = require('vm');
const fs = require('fs');
const crypto = require('crypto');

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.data = [];
    this.formats = {};
    this.maxRows = 1000;
    this.validations = 0;
  }
  key(r, c) { return r + ',' + c; }
  get(r, c) { const row = this.data[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined || v === null ? '' : v; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    const fmt = this.formats[this.key(r, c)];
    if (typeof v === 'string') {
      if (v.startsWith("'")) v = v.slice(1);                       // ' นำหน้า = บังคับเป็นข้อความ
      else if (fmt !== '@' && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v);  // ชีตแปลงตัวเลขเองถ้าไม่ใช่ข้อความ
      else if (/^[=+\-@]/.test(v) && v.length > 1) v = { FORMULA: v };  // ชีตจะตีความเป็นสูตร (อันตราย)
    }
    row[c - 1] = v;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length; r >= 1; r--) {
      if ((this.data[r - 1] || []).some(v => v !== '' && v !== null && v !== undefined)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach(row => { for (let c = row.length; c >= 1; c--) { if (row[c - 1] !== '' && row[c - 1] != null) { m = Math.max(m, c); break; } } });
    return m;
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { this.maxRows += n; this.inserted = (this.inserted || 0) + n; }
  setFrozenRows() {}
  getRange(r, c, nr = 1, nc = 1) {
    if (!(r >= 1 && c >= 1 && nr >= 1 && nc >= 1)) throw new Error(`bad range ${r},${c},${nr},${nc} on ${this.name}`);
    if (r + nr - 1 > this.maxRows) throw new Error(`Range outside sheet dimensions (${this.name} row ${r + nr - 1} > ${this.maxRows})`);
    return new FakeRange(this, r, c, nr, nc);
  }
}

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getRow() { return this.r; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j)); out.push(row); }
    return out;
  }
  getValue() { return this.sheet.get(this.r, this.c); }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some(v => v.length !== this.nc)) throw new Error(`setValues size mismatch on ${this.sheet.name}`);
    vals.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  setNumberFormat(f) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.formats[this.sheet.key(this.r + i, this.c + j)] = f; return this; }
  setNumberFormats(fs2) {
    if (fs2.length !== this.nr || fs2.some(v => v.length !== this.nc)) throw new Error('setNumberFormats size mismatch');
    fs2.forEach((row, i) => row.forEach((f, j) => { this.sheet.formats[this.sheet.key(this.r + i, this.c + j)] = f; }));
    return this;
  }
  setFontWeight() { return this; }
  setDataValidation() { this.sheet.validations++; return this; }
  createTextFinder(text) {
    const range = this; let entire = false, mcase = false;
    const match = v => {
      let s = v instanceof Date ? v.toString() : String(v); let t = String(text);
      if (!mcase) { s = s.toLowerCase(); t = t.toLowerCase(); }
      return entire ? s === t : s.includes(t);
    };
    const all = () => {
      const out = [];
      for (let i = 0; i < range.nr; i++) for (let j = 0; j < range.nc; j++) {
        if (match(range.sheet.get(range.r + i, range.c + j))) out.push(new FakeRange(range.sheet, range.r + i, range.c + j, 1, 1));
      }
      return out;
    };
    const finder = {
      matchEntireCell(b) { entire = b; return finder; },
      matchCase(b) { mcase = b; return finder; },
      findNext() { return all()[0] || null; },
      findAll() { return all(); }
    };
    return finder;
  }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new FakeSheet(n); return this.sheets[n]; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/FAKE'; }
}

function formatDate(d, tz, fmt) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});
  if (fmt === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
  if (fmt === 'd/M/yyyy HH:mm') return `${Number(parts.day)}/${Number(parts.month)}/${parts.year} ${parts.hour}:${parts.minute}`;
  throw new Error('formatDate stub: unsupported ' + fmt);
}

function makeDrive(world) {
  const d = world.drive;
  const guard = () => { if (d.noPermission) throw new Error('You do not have permission to call DriveApp.createFolder'); };
  const folderApi = (id) => ({
    getId: () => id,
    getUrl: () => 'https://drive.google.com/drive/folders/' + id,
    getSharingAccess: () => d.folders[id].sharing || 'PRIVATE',
    createFile: (blob) => {
      guard();
      if (d.folders[id].canEdit === false) throw new Error('Access denied: DriveApp.');
      const file = { id: 'FILE' + String(++d.n).padStart(24, '0'), folder: id, name: blob.name, mime: blob.mime, size: blob.bytes.length, sharing: null, trashed: false };
      d.files.push(file);
      return {
        getId: () => file.id,
        // ไฟล์ในโฟลเดอร์ที่แชร์ด้วยลิงก์ → เปิดได้ตามโฟลเดอร์ (เหมือน Google Drive จริง)
        getSharingAccess: () => (file.sharing ? file.sharing.split(':')[0] : d.folders[id].sharing || 'PRIVATE'),
        setSharing: (access, perm) => { if (d.blockSharing) throw new Error('Sharing is restricted by your administrator'); file.sharing = access + ':' + perm; },
        setTrashed: (t) => { file.trashed = t; }
      };
    }
  });
  return {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', ANYONE: 'ANYONE', PRIVATE: 'PRIVATE' },
    Permission: { VIEW: 'VIEW' },
    getFolderById: (id) => { guard(); if (!d.folders[id]) throw new Error('No item with the given ID could be found.'); return folderApi(id); },
    createFolder: (name) => { guard(); const id = 'AUTOFOLDER' + String(++d.n).padStart(20, '0'); d.folders[id] = { name, canEdit: true }; return folderApi(id); }
  };
}

function createWorld() {
  const world = {
    ss: new FakeSpreadsheet(),
    cache: new Map(),
    props: new Map(),
    fetchCalls: 0,
    fetchImpl: () => ({ code: 500, body: '{}' }),
    logs: [],
    // Google Drive จำลอง: folders[id] = { name, canEdit }, files = [{ id, folder, name, mime, size, sharing, trashed }]
    drive: { folders: {}, files: [], blockSharing: false, noPermission: false, n: 0 }
  };
  return world;
}

function makeContext(world) {
  const sandbox = {
    Date,  // ใช้ Date ตัวเดียวกับชีตจำลอง (Apps Script จริงคืนค่า Date ปกติอยู่แล้ว)
    console: { log: (...a) => world.logs.push(a.join(' ')), warn: (...a) => world.logs.push('WARN ' + a.join(' ')), error: (...a) => world.logs.push('ERROR ' + a.join(' ')) },
    Logger: { log: (s) => world.logs.push(String(s)) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => world.ss,
      openById: () => world.ss,
      flush: () => {},
      newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({
      get: k => (world.cache.has(k) ? world.cache.get(k) : null),
      put: (k, v) => { if (String(v).length > 100000) throw new Error('too big'); world.cache.set(k, String(v)); },
      remove: k => world.cache.delete(k),
      removeAll: keys => keys.forEach(k => world.cache.delete(k))
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (world.props.has(k) ? world.props.get(k) : null),
      setProperty: (k, v) => world.props.set(k, String(v)),
      deleteProperty: k => world.props.delete(k)
    }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => Array.from(crypto.createHash('sha256').update(String(text), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate,
      base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')).map(b => (b > 127 ? b - 256 : b)),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name })
    },
    DriveApp: makeDrive(world),
    UrlFetchApp: { fetch: (url, opts) => { world.fetchCalls++; const r = world.fetchImpl(url, opts); return { getResponseCode: () => r.code, getContentText: () => r.body }; } },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s })
    }
  };
  const ctx = vm.createContext(sandbox);
  // ค่าเริ่มต้นคือ code.gs ของโปรเจคนี้ (สองโฟลเดอร์ขึ้นไป)
  const codePath = process.env.CODE_GS || require('path').join(__dirname, '..', '..', 'code.gs');
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx, { filename: 'code.gs' });
  return ctx;
}

// เรียกแต่ละครั้งด้วย context ใหม่ (เหมือน Apps Script ที่เริ่มใหม่ทุกคำขอ) แต่ชีต/แคชยังอยู่
function call(world, body) {
  const ctx = makeContext(world);
  const out = ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } });
  return JSON.parse(out.getContent());
}

function run(world, fnName) {
  const ctx = makeContext(world);
  return ctx[fnName]();
}

// เรียกฟังก์ชันใน code.gs พร้อมค่าที่ส่งเข้าไป (เช่น onEdit(e))
function callFn(world, fnName, arg) {
  const ctx = makeContext(world);
  return ctx[fnName](arg);
}

module.exports = { createWorld, call, run, callFn, FakeSheet };
