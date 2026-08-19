#!/usr/bin/env python3
"""VPN-only CORS relay for the Web Research SillyTavern extension.
No credentials are stored: the caller supplies the provider key, which is forwarded
only to the fixed official upstream endpoint for that provider.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os

BIND = os.environ.get('WEB_RESEARCH_BIND', '100.64.0.1')
PORT = int(os.environ.get('WEB_RESEARCH_PORT', '6780'))
MAX_BODY = 1_000_000
ROUTES = {
    '/exa/search': ('https://api.exa.ai/search', 'x-exa-key', 'x-api-key'),
    '/exa/answer': ('https://api.exa.ai/answer', 'x-exa-key', 'x-api-key'),
    '/tavily/crawl': ('https://api.tavily.com/crawl', 'x-tavily-key', 'Authorization'),
    '/tavily/research': ('https://api.tavily.com/research', 'x-tavily-key', 'Authorization'),
}

class Handler(BaseHTTPRequestHandler):
    server_version = 'WebResearchRelay/1.0'
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS, GET')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Exa-Key, X-Tavily-Key')
        self.send_header('Access-Control-Max-Age', '600')
    def send_json(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status); self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        if self.path == '/health': self.send_json(200, {'service':'web-research-relay','status':'ok','routes':sorted(ROUTES)})
        else: self.send_json(404, {'detail':'not found'})
    def do_POST(self):
        route = ROUTES.get(self.path)
        if not route: return self.send_json(404, {'detail':'unsupported route'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 1 or length > MAX_BODY: return self.send_json(413, {'detail':'invalid request body size'})
            body = self.rfile.read(length)
            json.loads(body)
            target, inbound_header, outbound_header = route
            key = self.headers.get(inbound_header, '').strip()
            if not key: return self.send_json(400, {'detail':f'missing {inbound_header}'})
            auth = f'Bearer {key}' if outbound_header == 'Authorization' else key
            req = Request(target, data=body, method='POST', headers={'Content-Type':'application/json', outbound_header:auth, 'User-Agent':'WebResearchSTRelay/1.0'})
            try:
                with urlopen(req, timeout=130) as response:
                    result = response.read(); status = response.status
            except HTTPError as exc:
                result = exc.read(); status = exc.code
            self.send_response(status); self.cors()
            self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Content-Length',str(len(result))); self.end_headers(); self.wfile.write(result)
        except (ValueError, json.JSONDecodeError): self.send_json(400, {'detail':'body must be valid JSON'})
        except URLError as exc: self.send_json(502, {'detail':f'upstream unavailable: {exc.reason}'})
        except Exception as exc: self.send_json(502, {'detail':f'relay error: {exc}'})
    def log_message(self, fmt, *args): print(f'{self.address_string()} {fmt % args}', flush=True)

if __name__ == '__main__':
    print(f'Web Research relay listening on http://{BIND}:{PORT}', flush=True)
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
