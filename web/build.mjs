import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'main', 'resources', 'fguipreview', 'preview.html');

const result = await build({
  entryPoints: [join(here, 'src', 'preview.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'chrome120',
  legalComments: 'none',
  write: false,
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = readFileSync(join(here, 'src', 'preview.html'), 'utf8');
const html = template.replace('<!--SCRIPT-->', () => '<script>' + js + '</script>');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log('wrote ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');
