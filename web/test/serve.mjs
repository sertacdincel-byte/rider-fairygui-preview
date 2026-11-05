// Serves the preview page against a FairyGUI project without the IDE, using the same host API the plugin provides.
// Usage: node web/test/serve.mjs <path to FairyGUI project root (folder with *.fairy)> [port]
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(process.argv[2] || '.');
const assets = join(projectRoot, 'assets');
const port = Number(process.argv[3] || 47912);

function index() {
  const packages = [];
  for (const d of readdirSync(assets)) {
    const px = join(assets, d, 'package.xml');
    if (existsSync(px)) packages.push({ folder: d, xml: readFileSync(px, 'utf8') });
  }
  const opt = (f) => (existsSync(join(projectRoot, 'settings', f)) ? readFileSync(join(projectRoot, 'settings', f), 'utf8') : null);
  return JSON.stringify({ packages, common: opt('Common.json'), adaptation: opt('Adaptation.json') });
}

function handle(req) {
  if (req.op === 'index') return index();
  if (req.op === 'read') {
    const p = resolve(assets, req.path);
    if (!p.startsWith(assets + sep) || !existsSync(p) || !statSync(p).isFile()) throw new Error('not found: ' + req.path);
    const buf = readFileSync(p);
    if (req.enc !== 'base64') return buf.toString('utf8');
    const off = Number(req.offset || 0), len = Number(req.length || buf.length);
    return buf.length + ':' + buf.subarray(off, off + len).toString('base64');
  }
  if (req.op === 'nav' || req.op === 'open') { console.log(req.op, req.file, req.id || ''); return 'ok'; }
  throw new Error('unknown op ' + req.op);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const out = handle(JSON.parse(body));
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(out);
      } catch (e) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end(String(e.message || e));
      }
    });
    return;
  }
  if (url.pathname === '/') {
    const file = url.searchParams.get('file') || '';
    const dark = url.searchParams.get('dark') !== '0';
    const rev = url.searchParams.get('rev');
    const page = readFileSync(join(here, '..', '..', 'src', 'main', 'resources', 'fguipreview', 'preview.html'), 'utf8');
    const host = `window.FguiHost = { request: (json) => fetch('/api', { method: 'POST', body: json }).then(async (r) => { const t = await r.text(); if (!r.ok) throw new Error(t); return t; }) };`;
    let harness;
    if (rev) {
      let old = null;
      try { old = execFileSync('git', ['-C', projectRoot, 'show', rev + ':./assets/' + file], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch (e) { old = null; }
      const cur = existsSync(join(assets, file)) ? readFileSync(join(assets, file), 'utf8') : null;
      harness = `<script>${host}
FguiPreview.initDiff({ file: ${JSON.stringify(file)}, dark: ${dark}, left: { title: ${JSON.stringify(rev)}, source: ${JSON.stringify(old)} }, right: { title: 'Working copy', source: ${JSON.stringify(cur)} } });
</script>`;
    } else {
      harness = `<script>${host}
fetch('/api', { method: 'POST', body: JSON.stringify({ op: 'read', path: ${JSON.stringify(file)}, enc: 'text' }) })
  .then((r) => r.text()).then((source) => FguiPreview.init({ file: ${JSON.stringify(file)}, dark: ${dark}, source }));
</script>`;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page.replace('</body>', () => harness + '</body>'));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port, '127.0.0.1', () => console.log('ready http://127.0.0.1:' + port + '/?file=<Package/path.xml>'));
