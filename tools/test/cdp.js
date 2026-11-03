// ควบคุม Chrome แบบไม่มีหน้าจอผ่าน DevTools Protocol (ไม่ต้องติดตั้งอะไรเพิ่ม)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch({ port = 9333, profile, width = 390, height = 844, dpr = 2, mobile = true, args = [] } = {}) {
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--lang=th-TH', `--window-size=${width},${height}`, ...args, 'about:blank'
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.find(t => t.type === 'page')) break; } catch (e) { /* รอ */ }
    await sleep(200);
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = []; const listeners = {};
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    if (msg.method && listeners[msg.method]) listeners[msg.method].forEach(fn => fn(msg.params));
    if (msg.method === 'Runtime.consoleAPICalled') logs.push(`[console.${msg.params.type}] ` + msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (msg.method === 'Runtime.exceptionThrown') logs.push('[EXCEPTION] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === 'Log.entryAdded') logs.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });

  const api = {
    logs, send,
    on(method, fn) { (listeners[method] = listeners[method] || []).push(fn); },
    async nav(url) { await send('Page.navigate', { url }); await sleep(300); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, timeout = 8000, label = expr) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { try { if (await api.eval(expr)) return true; } catch (e) { /* หน้ากำลังโหลด */ } await sleep(150); }
      throw new Error('timeout รอ: ' + label);
    },
    async click(sel) { await api.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('ไม่พบ ' + ${JSON.stringify(sel)}); el.click(); return true; })()`); await sleep(120); },
    async type(sel, text) { await api.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`); },
    async text(sel = 'body') { return api.eval(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText || ''`); },
    async shot(file, { full = false } = {}) {
      await sleep(250);
      if (full) {
        const h = await api.eval('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)');
        await send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(h, 3000), deviceScaleFactor: dpr, mobile });
        await sleep(250);
      }
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      if (full) await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile });
    },
    async close() { try { ws.close(); } catch (e) {} proc.kill('SIGKILL'); }
  };
  return api;
}

module.exports = { launch, sleep };
