#!/usr/bin/env python3
# เว็บทดสอบในเครื่อง — ทำงานเหมือน Vercel (อ่านกฎจาก vercel.json ที่เดียว ไม่ต้องแก้สองที่)
#   /khamwan        → index.html   (หน้าลูกค้า)
#   /khamwan/staff  → staff.html   (หน้าพนักงาน)
#   /khamwan/admin  → admin.html   (หลังบ้านเจ้าของร้าน)
# และบอกเบราว์เซอร์ห้ามจำไฟล์ (แก้ไฟล์แล้วรีเฟรชเห็นทันที)
# ใช้: python3 tools/dev-server.py [พอร์ต]
import http.server
import json
import os
import re
import sys
from urllib.parse import urlsplit, unquote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8002

# ไฟล์/โฟลเดอร์ที่ไม่ขึ้นเว็บจริง (ตรงกับ .vercelignore) — ในเครื่องก็ไม่เปิดให้ดู
BLOCKED = re.compile(r"^/(backups|tools|CRM[^/]*)(/|$)|\.(gs|command|md|py)$", re.I)


def load_rules():
    # แปลงรูปแบบของ Vercel เช่น /:shop([a-z0-9-]+)/staff เป็น regex
    with open(os.path.join(ROOT, "vercel.json"), encoding="utf-8") as f:
        config = json.load(f)
    rules = []
    for r in config.get("rewrites", []):
        pattern = re.sub(r":\w+\(([^)]*)\)", r"(\1)", r["source"])
        rules.append((re.compile("^" + pattern + "/?$"), r["destination"]))
    return rules


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parts = urlsplit(self.path)
        path = unquote(parts.path)
        if BLOCKED.search(path):
            self.send_error(404)
            return
        if not os.path.isfile(os.path.join(ROOT, path.lstrip("/"))):
            for rx, dest in load_rules():
                if rx.match(path):
                    self.path = dest + ("?" + parts.query if parts.query else "")
                    break
        super().do_GET()

    def log_message(self, fmt, *args):
        pass  # ไม่ต้องพิมพ์ทุกคำขอ หน้าจอจะได้ไม่รก


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("", PORT), Handler)
    print(f"เว็บทดสอบ: http://localhost:{PORT}/khamwan  (หน้าพนักงาน: /khamwan/staff  หลังบ้าน: /khamwan/admin)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nปิดเว็บทดสอบแล้ว")
