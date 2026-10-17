#!/usr/bin/env python3
"""Headless test runner: serves /home/claude/aegis over HTTP, opens a page, collects console output,
optionally runs JS steps and takes screenshots.
Usage: python3 run.py <path-relative-to-aegis> [--wait ms] [--shot out.png] [--eval JS] [--size WxH] [--script steps.json]"""
import sys, json, threading, argparse, os, time, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT = '/home/claude/aegis'
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve(port):
    h = functools.partial(Q, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', port), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('page'); ap.add_argument('--wait', type=int, default=3000)
    ap.add_argument('--shot', default=None); ap.add_argument('--eval', action='append', default=[])
    ap.add_argument('--size', default='1280x720'); ap.add_argument('--script', default=None)
    ap.add_argument('--port', type=int, default=8765); ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args()
    serve(a.port)
    w, h = map(int, a.size.split('x'))
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page(viewport={'width': w, 'height': h})
        logs = []
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[PAGEERROR] {e}'))
        # route CDN three.js to local copy (for the bundled build)
        def route_cdn(route):
            url = route.request.url
            i = url.find('/build/') if '/build/' in url else url.find('/examples/')
            local = ROOT + '/node_modules/three' + url[i:]
            if os.path.exists(local):
                route.fulfill(path=local, content_type='application/javascript')
            else:
                route.abort()
        pg.route('https://cdn.jsdelivr.net/npm/three@*/**', route_cdn)
        pg.goto(f'http://127.0.0.1:{a.port}/{a.page}')
        pg.wait_for_timeout(a.wait)
        steps = []
        if a.script:
            steps = json.load(open(a.script))
        for e in a.eval:
            steps.append({'eval': e})
        if a.shot and not any('shot' in s for s in steps):
            steps.append({'shot': a.shot})
        for s in steps:
            if 'eval' in s:
                try:
                    r = pg.evaluate(s['eval'])
                    if r is not None: logs.append('[eval] ' + (json.dumps(r) if not isinstance(r, str) else r)[:4000])
                except Exception as ex:
                    logs.append(f'[evalerror] {ex}')
            if 'key' in s:
                pg.keyboard.press(s['key'])
            if 'down' in s:
                pg.keyboard.down(s['down'])
            if 'up' in s:
                pg.keyboard.up(s['up'])
            if 'click' in s:
                pg.mouse.click(*s['click'])
            if 'wait' in s:
                pg.wait_for_timeout(s['wait'])
            if 'shot' in s:
                pg.screenshot(path=s['shot'])
                logs.append(f'[shot] {s["shot"]}')
        b.close()
    out = '\n'.join(logs)
    print(out[-20000:] if not a.quiet else '\n'.join(l for l in logs if 'error' in l.lower() or 'shot' in l or 'eval' in l)[-20000:])
main()
