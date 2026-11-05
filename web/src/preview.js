'use strict';

const $ = (id) => document.getElementById(id);

const app = {
  mode: 'single',
  file: null,
  dark: false,
  ctrl: new Map(),
  opts: { zoom: 'fit', screen: 'design', hidden: false, outlines: false, empty: true, plainGraphs: false },
  seq: 0,
  views: [],
  selectedId: null,
  missing: new Set(),
  diff: null,
};

const P = { pkgs: new Map(), byName: new Map(), design: [1920, 1080], devices: [], textColor: '#000000', fontFamily: null, loaded: null };
const textCache = new Map();
const imageCache = new Map();
const compCache = new Map();
const imgDone = new Map();
const compDone = new Map();

const MAX_DEPTH = 14;
const EXT_WITH_TITLE = new Set(['Button', 'Label', 'ComboBox', 'ProgressBar', 'Slider']);
const FONT_STACK = '"Noto Serif","Noto Serif KR","Malgun Gothic",serif';

// ------------------------------------------------------------------ host bridge

function request(obj) {
  const host = window.FguiHost;
  if (!host) return Promise.reject(new Error('host not ready'));
  return host.request(JSON.stringify(obj));
}

function readText(path) {
  let p = textCache.get(path);
  if (!p) {
    p = request({ op: 'read', path, enc: 'text' });
    textCache.set(path, p);
  }
  return p;
}

const SLICE = 512 * 1024;

// Binary files come over in slices: the response is "<total size>:<base64 of the slice>".
async function readBinary(path) {
  const parts = [];
  let offset = 0, total = 1, size = 0;
  while (offset < total) {
    const resp = await request({ op: 'read', path, enc: 'base64', offset: String(offset), length: String(SLICE) });
    const colon = resp.indexOf(':');
    total = parseInt(resp.slice(0, colon), 10);
    const bin = atob(resp.slice(colon + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    parts.push(bytes);
    size += bytes.length;
    offset += bytes.length;
    if (!bytes.length) break;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function readImage(path) {
  let p = imageCache.get(path);
  if (!p) {
    p = readBinary(path).then((bytes) => new Promise((resolve) => {
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }));
      const img = new Image();
      img.onload = () => { imgDone.set(path, img); resolve(img); };
      img.onerror = () => { imgDone.set(path, null); resolve(null); };
      img.src = url;
    }), () => { imgDone.set(path, null); return null; });
    imageCache.set(path, p);
  }
  return p;
}

function loadComp(path) {
  let p = compCache.get(path);
  if (!p) {
    p = readText(path).then((t) => parseComp(t, path)).then(
      (def) => { compDone.set(path, def); return def; },
      (e) => { compDone.set(path, e instanceof Error ? e : new Error(String(e))); return null; });
    compCache.set(path, p);
  }
  return p;
}

// ------------------------------------------------------------------ project index

async function loadProject() {
  const idx = JSON.parse(await request({ op: 'index' }));
  for (const p of idx.packages) {
    const doc = new DOMParser().parseFromString(p.xml, 'application/xml');
    const root = doc.documentElement;
    const pkg = { id: root.getAttribute('id'), name: p.folder, res: new Map(), byFile: new Map(), byName: new Map() };
    const resources = root.getElementsByTagName('resources')[0];
    if (resources) {
      for (const r of resources.children) {
        const id = r.getAttribute('id');
        if (!id) continue;
        const path = r.getAttribute('path') || '/';
        const name = r.getAttribute('name') || '';
        const res = {
          id, pkg, tag: r.tagName, name, file: p.folder + path + name,
          scale9: r.getAttribute('scale') === '9grid' ? nums(r.getAttribute('scale9grid')) : null,
          tile: r.getAttribute('scale') === 'tile',
        };
        pkg.res.set(id, res);
        pkg.byFile.set((path + name).replace(/^\//, ''), res);
        pkg.byName.set(name.replace(/\.[^.]+$/, ''), res);
      }
    }
    P.pkgs.set(pkg.id, pkg);
    P.byName.set(pkg.name, pkg);
  }
  try {
    const ad = idx.adaptation ? JSON.parse(idx.adaptation) : null;
    if (ad) {
      P.design = [ad.designResolutionX || 1920, ad.designResolutionY || 1080];
      P.devices = (ad.devices || []).filter((d) => d.resolutionX && d.resolutionY);
    }
  } catch (e) { /* optional */ }
  try {
    const common = idx.common ? JSON.parse(idx.common) : null;
    if (common) {
      if (common.textColor) P.textColor = common.textColor;
      const fontRes = resolveUrl(common.font);
      if (fontRes) {
        const buf = await readBinary(fontRes.file);
        const face = new FontFace('FguiDefault', buf.buffer);
        await face.load();
        document.fonts.add(face);
        P.fontFamily = 'FguiDefault';
      }
    }
  } catch (e) { console.warn('default font', e); }
}

function resolveUrl(url) {
  if (!url || !url.startsWith('ui://')) return null;
  const s = url.slice(5);
  const slash = s.indexOf('/');
  if (slash >= 0) {
    const pkg = P.byName.get(s.slice(0, slash));
    return pkg ? pkg.byName.get(s.slice(slash + 1)) || null : null;
  }
  const pkg = P.pkgs.get(s.slice(0, 8));
  return pkg ? pkg.res.get(s.slice(8)) || null : null;
}

function resolveSrc(el, ctxPkg) {
  const pid = el.getAttribute('pkg');
  const pkg = pid ? P.pkgs.get(pid) : ctxPkg;
  if (!pkg) return null;
  const src = el.getAttribute('src');
  let res = src ? pkg.res.get(src) : null;
  if (!res) {
    const fn = el.getAttribute('fileName');
    if (fn) res = pkg.byFile.get(fn) || null;
  }
  return res;
}

// ------------------------------------------------------------------ parsing

function parseComp(text, path) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror')[0];
  if (perr) throw new Error('XML error in ' + path + ': ' + perr.textContent.replace(/\s+/g, ' ').trim().slice(0, 300));
  const root = doc.documentElement;
  if (root.tagName !== 'component') throw new Error(path + ' is not a FairyGUI component (root element <' + root.tagName + '>)');
  const def = {
    path, root,
    size: nums(root.getAttribute('size'), [100, 100]),
    ext: root.getAttribute('extention') || '',
    controllers: [],
    children: [],
    rootRels: [],
    extNode: null,
  };
  for (const c of root.children) {
    if (c.tagName === 'controller') def.controllers.push(parseController(c));
    else if (c.tagName === 'displayList') def.children = [...c.children];
    else if (c.tagName === 'relation') {
      const pairs = (c.getAttribute('sidePair') || '').split(',').filter(Boolean);
      if (pairs.length && c.getAttribute('target')) def.rootRels.push({ target: c.getAttribute('target'), pairs });
    } else if (def.ext && c.tagName === def.ext) def.extNode = c;
  }
  return def;
}

function parseController(c) {
  const parts = (c.getAttribute('pages') || '').split(',');
  const pages = [];
  for (let i = 0; i < parts.length; i += 2) pages.push({ id: parts[i], name: parts[i + 1] || '' });
  const actions = [];
  for (const a of c.children) {
    if (a.tagName !== 'action') continue;
    actions.push({
      type: a.getAttribute('type') || 'change_page',
      fromPage: a.getAttribute('fromPage') || '',
      toPage: a.getAttribute('toPage') || '',
      objectId: a.getAttribute('objectId') || '',
      controller: a.getAttribute('controller') || '',
      targetPage: a.getAttribute('targetPage') || '',
    });
  }
  let selected = parseInt(c.getAttribute('selected') || '0', 10) || 0;
  // A "specific" home page replaces the saved selection when the component is created.
  if (c.getAttribute('homePageType') === 'specific') {
    const home = pages.findIndex((p) => p.id === c.getAttribute('homePage'));
    if (home >= 0) selected = home;
  }
  return { name: c.getAttribute('name') || '', pages, selected, actions };
}

function nums(s, dflt) {
  if (s === null || s === undefined || s === '') return dflt ? dflt.slice() : null;
  return s.split(',').map((v) => parseFloat(v));
}

function attrNum(el, name, dflt) {
  const v = el.getAttribute(name);
  if (v === null || v === '') return dflt;
  const n = parseFloat(v);
  return isNaN(n) ? dflt : n;
}

// ------------------------------------------------------------------ preload

async function preload(def, pkg, depth, seen) {
  if (!def || depth > MAX_DEPTH || seen.has(def.path + '@' + depth)) return;
  seen.add(def.path + '@' + depth);
  const jobs = [];
  const visit = (res) => {
    if (!res) return;
    if (res.tag === 'image') jobs.push(readImage(res.file));
    else if (res.tag === 'component') jobs.push(loadComp(res.file).then((d) => preload(d, res.pkg, depth + 1, seen)));
  };
  const walk = (el) => {
    if (el.hasAttribute('src')) visit(resolveSrc(el, pkg));
    for (const a of el.attributes) {
      if (a.value.indexOf('ui://') < 0) continue;
      const m = a.value.match(/ui:\/\/[A-Za-z0-9_\/.-]+/g);
      if (m) for (const u of m) visit(resolveUrl(u));
    }
    for (const c of el.children) walk(c);
  };
  walk(def.root);
  await Promise.all(jobs);
}

// ------------------------------------------------------------------ controllers and gears

function childByTag(el, tag) {
  for (const c of el.children) if (c.tagName === tag) return c;
  return null;
}

/** spec is {id}, {index} or {name}; returns a page id of controller c, or undefined. */
function resolveSpec(c, spec) {
  if (!spec) return undefined;
  if (spec.id !== undefined) return c.pages.some((p) => p.id === spec.id) ? spec.id : undefined;
  if (spec.index !== undefined) return c.pages[spec.index] ? c.pages[spec.index].id : undefined;
  if (spec.name !== undefined) { const p = c.pages.find((x) => x.name === spec.name); return p ? p.id : undefined; }
  return undefined;
}

function controllerState(def, inst) {
  const state = new Map();
  for (const c of def.controllers) {
    let page;
    if (inst.isRoot && app.ctrl.has(c.name)) page = app.ctrl.get(c.name);
    else if (inst.ctrl && inst.ctrl.has(c.name)) page = resolveSpec(c, inst.ctrl.get(c.name));
    if (page === undefined && def.ext === 'Button' && c.name === 'button') {
      let sel = inst.over.selected;
      if (sel === undefined && def.extNode) sel = def.extNode.getAttribute('checked') === 'true';
      if (sel) { const p = c.pages.find((x) => x.name === 'down'); if (p) page = p.id; }
    }
    if (page === undefined) page = (c.pages[c.selected] || c.pages[0] || { id: '' }).id;
    state.set(c.name, page);
  }
  return state;
}

/**
 * Runs "change_page" controller actions for the current pages, as FairyGUI does when a page is selected.
 * Actions on the component itself update state; actions on children are returned per child id.
 */
function runActions(def, state, inst) {
  const forChildren = new Map();
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const c of def.controllers) {
      const page = state.get(c.name);
      const idx = c.pages.findIndex((p) => p.id === page);
      for (const a of c.actions) {
        if (a.type !== 'change_page' || a.fromPage) continue;
        if (a.toPage && !a.toPage.split(',').includes(page)) continue;
        const spec = a.targetPage === '~1' ? { index: idx } : a.targetPage === '~2' ? { name: (c.pages[idx] || {}).name } : { id: a.targetPage };
        if (!a.objectId) {
          const tc = def.controllers.find((x) => x.name === a.controller);
          if (!tc || (inst.isRoot && app.ctrl.has(tc.name))) continue;
          const r = resolveSpec(tc, spec);
          if (r !== undefined && state.get(tc.name) !== r) { state.set(tc.name, r); changed = true; }
        } else {
          let m = forChildren.get(a.objectId);
          if (!m) forChildren.set(a.objectId, (m = new Map()));
          m.set(a.controller, spec);
        }
      }
    }
    if (!changed) break;
  }
  return forChildren;
}

function gearValue(g, state) {
  if (!g) return null;
  const page = state.get(g.getAttribute('controller'));
  if (page === undefined) return null;
  const pages = (g.getAttribute('pages') || '').split(',');
  const values = (g.getAttribute('values') || '').split('|');
  const i = pages.indexOf(page);
  if (i >= 0 && i < values.length) return values[i];
  const d = g.getAttribute('default');
  return d !== null ? d : null;
}

function gearDisplayOk(g, state) {
  if (!g) return null;
  const page = state.get(g.getAttribute('controller'));
  if (page === undefined) return true;
  return (g.getAttribute('pages') || '').split(',').includes(page);
}

// ------------------------------------------------------------------ relations (mirrors FairyGUI's GObject / RelationItem)

const H_SIDES = new Set(['left', 'center', 'right', 'leftext', 'rightext', 'width']);

function parseDefs(pairs) {
  const out = [];
  for (const sp of pairs) {
    let [a, b] = sp.split('-');
    if (!a) continue;
    let pct = false;
    if (b && b.endsWith('%')) { pct = true; b = b.slice(0, -1); }
    if (!b) b = a;
    out.push({ type: a + '-' + b, pct, axis: H_SIDES.has(a) ? 0 : 1 });
  }
  return out;
}

class Obj {
  constructor(x, y, w, h, px, py, anchor) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.px = px; this.py = py; this.anchor = anchor;
    this.posL = []; this.sizeL = []; this.items = [];
    this.handling = null; this.group = null;
    this.isGroup = false; this.members = null; this.updating = 0;
  }
  get xMin() { return this.anchor ? this.x - this.w * this.px : this.x; }
  set xMin(v) { this.setXY(this.anchor ? v + this.w * this.px : v, this.y); }
  get yMin() { return this.anchor ? this.y - this.h * this.py : this.y; }
  set yMin(v) { this.setXY(this.x, this.anchor ? v + this.h * this.py : v); }
  setXY(x, y) {
    if (x === this.x && y === this.y) return;
    const dx = x - this.x, dy = y - this.y;
    this.x = x;
    this.y = y;
    if (this.isGroup && !(this.updating & 1)) {
      this.updating |= 1;
      for (const m of this.members) m.setXY(m.x + dx, m.y + dy);
      this.updating &= ~1;
    }
    for (const f of this.posL.slice()) f();
  }
  setSize(w, h, ignorePivot) {
    w = Math.max(0, w);
    h = Math.max(0, h);
    if (w === this.w && h === this.h) return;
    const dw = w - this.w, dh = h - this.h;
    this.w = w;
    this.h = h;
    if ((this.px || this.py) && !this.anchor && !ignorePivot) this.setXY(this.x - this.px * dw, this.y - this.py * dh);
    for (const it of this.items) it.selfSize(dw, dh, this.anchor || !ignorePivot);
    for (const f of this.sizeL.slice()) f();
  }
  setWidth(v) { this.setSize(v, this.h, false); }
  setHeight(v) { this.setSize(this.w, v, false); }
}

class Rel {
  constructor(owner, target, defs, targetIsParent, ownerIsParent) {
    this.owner = owner; this.target = target; this.defs = defs;
    this.targetIsParent = targetIsParent; this.ownerIsParent = ownerIsParent;
    this.tx = target.x; this.ty = target.y; this.tw = target.w; this.th = target.h;
    // A component following its own child is evaluated against the design sizes, as FairyGUI does while constructing.
    this.srcW = owner.w; this.srcH = owner.h; this.initW = target.w; this.initH = target.h;
    target.sizeL.push(() => this.onTargetSize());
    if (!targetIsParent) target.posL.push(() => this.onTargetXY());
    owner.items.push(this);
  }
  blocked() { return this.owner.handling !== null || (this.owner.group && this.owner.group.updating); }
  onTargetXY() {
    if (this.blocked()) { this.tx = this.target.x; this.ty = this.target.y; return; }
    this.owner.handling = this.target;
    const dx = this.target.x - this.tx, dy = this.target.y - this.ty;
    for (const d of this.defs) this.applyXY(d, dx, dy);
    this.tx = this.target.x; this.ty = this.target.y;
    this.owner.handling = null;
  }
  onTargetSize() {
    if (this.blocked()) { this.tw = this.target.w; this.th = this.target.h; return; }
    this.owner.handling = this.target;
    for (const d of this.defs) this.applySize(d);
    this.tw = this.target.w; this.th = this.target.h;
    this.owner.handling = null;
  }
  applyXY(d, dx, dy) {
    const o = this.owner;
    let t;
    switch (d.type) {
      case 'left-left': case 'left-center': case 'left-right': case 'center-center':
      case 'right-left': case 'right-center': case 'right-right':
        o.setXY(o.x + dx, o.y); break;
      case 'top-top': case 'top-middle': case 'top-bottom': case 'middle-middle':
      case 'bottom-top': case 'bottom-middle': case 'bottom-bottom':
        o.setXY(o.x, o.y + dy); break;
      case 'leftext-left': case 'leftext-right':
        if (!this.ownerIsParent) { t = o.xMin; o.setWidth(o.w - dx); o.xMin = t + dx; } else o.setWidth(o.w - dx);
        break;
      case 'rightext-left': case 'rightext-right':
        if (!this.ownerIsParent) { t = o.xMin; o.setWidth(o.w + dx); o.xMin = t; } else o.setWidth(o.w + dx);
        break;
      case 'topext-top': case 'topext-bottom':
        if (!this.ownerIsParent) { t = o.yMin; o.setHeight(o.h - dy); o.yMin = t + dy; } else o.setHeight(o.h - dy);
        break;
      case 'bottomext-top': case 'bottomext-bottom':
        if (!this.ownerIsParent) { t = o.yMin; o.setHeight(o.h + dy); o.yMin = t; } else o.setHeight(o.h + dy);
        break;
      default: break;
    }
  }
  applySize(d) {
    const o = this.owner, tg = this.target;
    let pos = 0, pivot = 0, delta;
    if (d.axis === 0) {
      if (!this.targetIsParent) { pos = tg.x; if (tg.anchor) pivot = tg.px; }
      delta = d.pct ? (this.tw ? tg.w / this.tw : 0) : tg.w - this.tw;
    } else {
      if (!this.targetIsParent) { pos = tg.y; if (tg.anchor) pivot = tg.py; }
      delta = d.pct ? (this.th ? tg.h / this.th : 0) : tg.h - this.th;
    }
    let v, t;
    switch (d.type) {
      case 'left-left':
        if (d.pct) o.xMin = pos + (o.xMin - pos) * delta; else if (pivot) o.setXY(o.x - delta * pivot, o.y);
        break;
      case 'left-center':
        if (d.pct) o.xMin = pos + (o.xMin - pos) * delta; else o.setXY(o.x + delta * (0.5 - pivot), o.y);
        break;
      case 'left-right':
        if (d.pct) o.xMin = pos + (o.xMin - pos) * delta; else o.setXY(o.x + delta * (1 - pivot), o.y);
        break;
      case 'center-center':
        if (d.pct) o.xMin = pos + (o.xMin + o.w * 0.5 - pos) * delta - o.w * 0.5; else o.setXY(o.x + delta * (0.5 - pivot), o.y);
        break;
      case 'right-left':
        if (d.pct) o.xMin = pos + (o.xMin + o.w - pos) * delta - o.w; else if (pivot) o.setXY(o.x - delta * pivot, o.y);
        break;
      case 'right-center':
        if (d.pct) o.xMin = pos + (o.xMin + o.w - pos) * delta - o.w; else o.setXY(o.x + delta * (0.5 - pivot), o.y);
        break;
      case 'right-right':
        if (d.pct) o.xMin = pos + (o.xMin + o.w - pos) * delta - o.w; else o.setXY(o.x + delta * (1 - pivot), o.y);
        break;
      case 'top-top':
        if (d.pct) o.yMin = pos + (o.yMin - pos) * delta; else if (pivot) o.setXY(o.x, o.y - delta * pivot);
        break;
      case 'top-middle':
        if (d.pct) o.yMin = pos + (o.yMin - pos) * delta; else o.setXY(o.x, o.y + delta * (0.5 - pivot));
        break;
      case 'top-bottom':
        if (d.pct) o.yMin = pos + (o.yMin - pos) * delta; else o.setXY(o.x, o.y + delta * (1 - pivot));
        break;
      case 'middle-middle':
        if (d.pct) o.yMin = pos + (o.yMin + o.h * 0.5 - pos) * delta - o.h * 0.5; else o.setXY(o.x, o.y + delta * (0.5 - pivot));
        break;
      case 'bottom-top':
        if (d.pct) o.yMin = pos + (o.yMin + o.h - pos) * delta - o.h; else if (pivot) o.setXY(o.x, o.y - delta * pivot);
        break;
      case 'bottom-middle':
        if (d.pct) o.yMin = pos + (o.yMin + o.h - pos) * delta - o.h; else o.setXY(o.x, o.y + delta * (0.5 - pivot));
        break;
      case 'bottom-bottom':
        if (d.pct) o.yMin = pos + (o.yMin + o.h - pos) * delta - o.h; else o.setXY(o.x, o.y + delta * (1 - pivot));
        break;
      case 'width-width':
        v = this.ownerIsParent ? this.srcW - this.initW : o.w - this.tw;
        if (d.pct) v *= delta;
        if (this.targetIsParent) {
          if (o.anchor) { t = o.xMin; o.setSize(tg.w + v, o.h, true); o.xMin = t; } else o.setSize(tg.w + v, o.h, true);
        } else o.setWidth(tg.w + v);
        break;
      case 'height-height':
        v = this.ownerIsParent ? this.srcH - this.initH : o.h - this.th;
        if (d.pct) v *= delta;
        if (this.targetIsParent) {
          if (o.anchor) { t = o.yMin; o.setSize(o.w, tg.h + v, true); o.yMin = t; } else o.setSize(o.w, tg.h + v, true);
        } else o.setHeight(tg.h + v);
        break;
      case 'leftext-left':
        t = o.xMin; v = d.pct ? pos + (t - pos) * delta - t : -delta * pivot;
        o.setWidth(o.w - v); o.xMin = t + v;
        break;
      case 'leftext-right':
        t = o.xMin; v = d.pct ? pos + (t - pos) * delta - t : delta * (1 - pivot);
        o.setWidth(o.w - v); o.xMin = t + v;
        break;
      case 'rightext-left':
        t = o.xMin; v = d.pct ? pos + (t + o.w - pos) * delta - (t + o.w) : -delta * pivot;
        o.setWidth(o.w + v); o.xMin = t;
        break;
      case 'rightext-right':
        t = o.xMin;
        if (this.ownerIsParent) o.setWidth(d.pct ? pos + (o.w - pos) * delta : this.srcW + (tg.w - this.initW) * (1 - pivot));
        else { v = d.pct ? pos + (t + o.w - pos) * delta - (t + o.w) : delta * (1 - pivot); o.setWidth(o.w + v); o.xMin = t; }
        break;
      case 'topext-top':
        t = o.yMin; v = d.pct ? pos + (t - pos) * delta - t : -delta * pivot;
        o.setHeight(o.h - v); o.yMin = t + v;
        break;
      case 'topext-bottom':
        t = o.yMin; v = d.pct ? pos + (t - pos) * delta - t : delta * (1 - pivot);
        o.setHeight(o.h - v); o.yMin = t + v;
        break;
      case 'bottomext-top':
        t = o.yMin; v = d.pct ? pos + (t + o.h - pos) * delta - (t + o.h) : -delta * pivot;
        o.setHeight(o.h + v); o.yMin = t;
        break;
      case 'bottomext-bottom':
        t = o.yMin;
        if (this.ownerIsParent) o.setHeight(d.pct ? pos + (o.h - pos) * delta : this.srcH + (tg.h - this.initH) * (1 - pivot));
        else { v = d.pct ? pos + (t + o.h - pos) * delta - (t + o.h) : delta * (1 - pivot); o.setHeight(o.h + v); o.yMin = t; }
        break;
      default: break;
    }
  }
  // When the owner itself is resized, centre/right/middle/bottom relations keep that edge where it was.
  selfSize(dw, dh, applyPivot) {
    const o = this.owner;
    for (const d of this.defs) {
      switch (d.type) {
        case 'center-center': o.setXY(o.x - (0.5 - (applyPivot ? o.px : 0)) * dw, o.y); break;
        case 'right-center': case 'right-left': case 'right-right': o.setXY(o.x - (1 - (applyPivot ? o.px : 0)) * dw, o.y); break;
        case 'middle-middle': o.setXY(o.x, o.y - (0.5 - (applyPivot ? o.py : 0)) * dh); break;
        case 'bottom-middle': case 'bottom-top': case 'bottom-bottom': o.setXY(o.x, o.y - (1 - (applyPivot ? o.py : 0)) * dh); break;
        default: break;
      }
    }
  }
}

// ------------------------------------------------------------------ layout

function makeNode(el, pkg, state, inst, def) {
  const tag = el.tagName;
  const n = {
    el, tag,
    id: el.getAttribute('id') || '',
    name: el.getAttribute('name') || '',
    group: el.getAttribute('group') || '',
    rels: [],
    res: null,
    sub: null,
  };
  if (tag === 'image' || tag === 'component' || tag === 'movieclip') n.res = resolveSrc(el, pkg);
  if (tag === 'component' && n.res) {
    const d = compDone.get(n.res.file);
    n.sub = d instanceof Error ? null : d || null;
    n.subError = d instanceof Error ? d : null;
  }

  const [x, y] = nums(el.getAttribute('xy'), [0, 0]);
  let size = nums(el.getAttribute('size'), null);
  if (!size) {
    if (tag === 'image' && n.res) {
      const img = imgDone.get(n.res.file);
      size = img ? [img.naturalWidth, img.naturalHeight] : [100, 100];
    } else if (n.sub) size = n.sub.size.slice();
    else size = [100, 30];
  }
  n.xy = [x, y];
  n.size = size;
  n.pivot = nums(el.getAttribute('pivot'), [0, 0]);
  n.anchor = el.getAttribute('anchor') === 'true';
  n.scale = nums(el.getAttribute('scale'), [1, 1]);

  const gXY = childByTag(el, 'gearXY');
  const gxy = gearValue(gXY, state);
  n.gxy = gxy ? nums(gxy) : null;
  const gSize = childByTag(el, 'gearSize');
  const gsize = gearValue(gSize, state);
  n.gsize = gsize ? nums(gsize) : null;
  n.gsizeIgnorePivot = !!(gXY && gSize && gXY.getAttribute('controller') === gSize.getAttribute('controller'));
  if (n.gsize && n.gsize.length >= 4 && !isNaN(n.gsize[2])) n.scale = [n.gsize[2], n.gsize[3]];

  n.alpha = attrNum(el, 'alpha', 1);
  n.rotation = attrNum(el, 'rotation', 0);
  n.grayed = el.getAttribute('grayed') === 'true';
  const look = gearValue(childByTag(el, 'gearLook'), state);
  if (look) {
    const v = look.split(',');
    if (v[0] !== undefined && v[0] !== '') n.alpha = parseFloat(v[0]);
    if (v[1] !== undefined && v[1] !== '') n.rotation = parseFloat(v[1]);
    if (v[2] !== undefined) n.grayed = v[2] === '1' || v[2] === 'true';
  }
  n.skew = nums(el.getAttribute('skew'), [0, 0]);

  const vis = el.getAttribute('visible') !== 'false';
  const d1 = gearDisplayOk(childByTag(el, 'gearDisplay'), state);
  const g2 = childByTag(el, 'gearDisplay2');
  const d2 = gearDisplayOk(g2, state);
  let disp = d1 === null ? true : d1;
  if (d2 !== null) disp = g2.getAttribute('condition') === '1' ? (d1 === null ? d2 : disp || d2) : disp && d2;
  n.visible = vis && disp;

  n.gearColor = gearValue(childByTag(el, 'gearColor'), state);
  n.gearIcon = gearValue(childByTag(el, 'gearIcon'), state);
  n.gearText = gearValue(childByTag(el, 'gearText'), state);
  n.gearFontSize = gearValue(childByTag(el, 'gearFontSize'), state);

  for (const c of el.children) {
    if (c.tagName !== 'relation') continue;
    const pairs = (c.getAttribute('sidePair') || '').split(',').filter(Boolean);
    if (pairs.length) n.rels.push({ target: c.getAttribute('target') || '', pairs });
  }

  if (EXT_WITH_TITLE.has(def.ext)) {
    if (n.name === 'title') {
      if (inst.over.title !== undefined) n.textOverride = inst.over.title;
      if (inst.over.titleColor !== undefined) n.colorOverride = inst.over.titleColor;
      if (inst.over.titleFontSize !== undefined) n.fontSizeOverride = inst.over.titleFontSize;
    }
    if (n.name === 'icon' && inst.over.icon !== undefined) n.iconOverride = inst.over.icon;
  }
  n.props = [];
  for (const p of inst.over.props || []) {
    if (p.path[0] !== n.name) continue;
    if (p.path.length > 1) n.props.push({ path: p.path.slice(1), id: p.id, value: p.value });
    else applyProp(n, p.id, p.value);
  }
  return n;
}

function applyProp(n, id, value) {
  switch (id) {
    case 0: n.textOverride = value; break;
    case 1: n.iconOverride = value; break;
    case 2: n.colorOverride = value; break;
    case 3: n.strokeColorOverride = value; break;
    case 8: n.fontSizeOverride = parseFloat(value); break;
    case 9: n.selectedOverride = value === 'true' || value === '1'; break;
    default: break;
  }
}

function instanceOf(el) {
  const over = { props: [] };
  for (const c of el.children) {
    const t = c.tagName;
    if (t === 'Button' || t === 'Label' || t === 'ComboBox') {
      if (c.hasAttribute('title')) over.title = c.getAttribute('title');
      if (c.hasAttribute('titleColor')) over.titleColor = c.getAttribute('titleColor');
      if (c.hasAttribute('titleFontSize')) over.titleFontSize = parseFloat(c.getAttribute('titleFontSize'));
      if (c.hasAttribute('icon')) over.icon = c.getAttribute('icon');
      if (c.hasAttribute('checked')) over.selected = c.getAttribute('checked') === 'true';
    } else if (t === 'ProgressBar' || t === 'Slider') {
      if (c.hasAttribute('value')) over.value = parseFloat(c.getAttribute('value'));
      if (c.hasAttribute('max')) over.max = parseFloat(c.getAttribute('max'));
    } else if (t === 'property') {
      over.props.push({ path: (c.getAttribute('target') || '').split('.'), id: parseInt(c.getAttribute('propertyId') || '-1', 10), value: c.getAttribute('value') || '' });
    }
  }
  return over;
}

function ctrlPairs(s) {
  const m = new Map();
  if (!s) return m;
  const parts = s.split(',');
  for (let i = 0; i + 1 < parts.length; i += 2) m.set(parts[i], { id: parts[i + 1] });
  return m;
}

function childInst(n, w, h, L) {
  const own = instanceOf(n.el);
  if (n.textOverride !== undefined) own.title = n.textOverride;
  if (n.iconOverride !== undefined) own.icon = n.iconOverride;
  if (n.colorOverride !== undefined) own.titleColor = n.colorOverride;
  if (n.fontSizeOverride !== undefined) own.titleFontSize = n.fontSizeOverride;
  if (n.selectedOverride !== undefined) own.selected = n.selectedOverride;
  if (n.gearText !== null && n.gearText !== undefined && own.title === undefined) own.title = n.gearText;
  if (n.gearIcon !== null && n.gearIcon !== undefined && own.icon === undefined) own.icon = n.gearIcon;
  // Gears on a Label/Button instance drive its title, and they run after the instance's own settings.
  if (n.gearFontSize !== null && n.gearFontSize !== undefined && !isNaN(parseFloat(n.gearFontSize))) own.titleFontSize = parseFloat(n.gearFontSize);
  if (n.gearColor) own.titleColor = n.gearColor.split(',')[0];
  own.props = own.props.concat(n.props);
  const ctrl = ctrlPairs(n.el.getAttribute('controller'));
  const fromActions = L && L.childCtrl.get(n.id);
  if (fromActions) for (const [k, v] of fromActions) ctrl.set(k, v);
  return { w, h, ctrl, over: own };
}

/** Lays out one component: gears, the instance size, text auto-size and FairyGUI's relation events. */
function layoutComp(def, pkg, inst, depth) {
  const state = controllerState(def, inst);
  const childCtrl = runActions(def, state, inst);
  const nodes = [];
  const byId = new Map();
  for (const el of def.children) {
    const n = makeNode(el, pkg, state, inst, def);
    nodes.push(n);
    if (n.id) byId.set(n.id, n);
  }
  const L = { def, nodes, byId, state, childCtrl, w: def.size[0], h: def.size[1] };

  let progress = null;
  if (def.ext === 'ProgressBar' || def.ext === 'Slider') {
    const ext = def.extNode;
    const max = inst.over.max !== undefined ? inst.over.max : ext ? attrNum(ext, 'max', 100) : 100;
    const value = inst.over.value !== undefined ? inst.over.value : ext ? attrNum(ext, 'value', 50) : 50;
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const titleType = ext ? ext.getAttribute('titleType') || 'percent' : 'percent';
    progress = { pct };
    const title = nodes.find((n) => n.name === 'title' && (n.tag === 'text' || n.tag === 'richtext'));
    if (title && inst.over.title === undefined) {
      title.textOverride = titleType === 'valueAndmax' ? value + '/' + max : titleType === 'value' ? String(value) : titleType === 'max' ? String(max) : Math.round(pct * 100) + '%';
    }
  }

  const root = new Obj(0, 0, def.size[0], def.size[1], 0, 0, false);
  for (const n of nodes) n.o = new Obj(n.xy[0], n.xy[1], n.size[0], n.size[1], n.pivot[0], n.pivot[1], n.anchor);
  for (const n of nodes) if (n.tag === 'group') { n.o.isGroup = true; n.o.members = []; }
  for (const n of nodes) {
    if (!n.group) continue;
    const g = byId.get(n.group);
    if (g && g.o.isGroup && g !== n) { n.o.group = g.o; g.o.members.push(n.o); }
  }
  for (const r of def.rootRels) {
    const t = byId.get(r.target);
    if (t) new Rel(root, t.o, parseDefs(r.pairs), false, true);
  }
  for (const n of nodes) {
    for (const r of n.rels) {
      const target = r.target ? (byId.get(r.target) || {}).o : root;
      if (!target || target === n.o) continue;
      new Rel(n.o, target, parseDefs(r.pairs), !r.target, false);
    }
  }

  for (const n of nodes) {
    if (n.gxy) n.o.setXY(isNaN(n.gxy[0]) ? n.o.x : n.gxy[0], isNaN(n.gxy[1]) ? n.o.y : n.gxy[1]);
    if (n.gsize) n.o.setSize(isNaN(n.gsize[0]) ? n.o.w : n.gsize[0], isNaN(n.gsize[1]) ? n.o.h : n.gsize[1], n.gsizeIgnorePivot);
  }

  root.setSize(inst.w, inst.h, true);

  for (const n of nodes) {
    if ((n.tag === 'text' || n.tag === 'richtext') && textAutoSize(n.el) === 'both') {
      const [tw, th] = measureText(textProps(n));
      n.o.setSize(tw, th, false);
    }
  }
  if (depth < MAX_DEPTH) {
    for (const n of nodes) {
      if (n.tag !== 'component' || !n.sub || !n.sub.rootRels.length) continue;
      const sub = layoutComp(n.sub, n.res.pkg, childInst(n, n.o.w, n.o.h, L), depth + 1);
      if (Math.abs(sub.w - n.o.w) > 0.01 || Math.abs(sub.h - n.o.h) > 0.01) n.o.setSize(sub.w, sub.h, false);
    }
  }
  if (progress) {
    const bar = nodes.find((n) => n.name === 'bar');
    if (bar) bar.o.setWidth(Math.round(bar.o.w * progress.pct));
    const barV = nodes.find((n) => n.name === 'bar_v');
    if (barV) barV.o.setHeight(Math.round(barV.o.h * progress.pct));
  }

  for (const n of nodes) n.g = { x: n.o.xMin, y: n.o.yMin, w: n.o.w, h: n.o.h };
  L.w = root.w;
  L.h = root.h;
  return L;
}

// ------------------------------------------------------------------ rendering

function renderComp(def, pkg, inst, ctx) {
  const L = layoutComp(def, pkg, inst, ctx.depth);
  return buildComp(L, pkg, inst, ctx);
}

function buildComp(L, pkg, inst, ctx) {
  const def = L.def;
  const box = document.createElement('div');
  box.className = 'fg';
  box.style.width = L.w + 'px';
  box.style.height = L.h + 'px';
  const root = def.root;
  const ov = root.getAttribute('overflow');
  if (ov === 'hidden' || ov === 'scroll') box.style.overflow = 'hidden';
  if (root.getAttribute('bgColorEnabled') === 'true' && root.getAttribute('bgColor')) box.style.background = color(root.getAttribute('bgColor'));

  const groupVisible = (n, guard) => {
    if (!n.group || guard > 20) return true;
    const gr = L.byId.get(n.group);
    if (!gr) return true;
    return gr.visible && groupVisible(gr, guard + 1);
  };
  const maskId = root.getAttribute('mask');
  const maskNode = maskId ? L.byId.get(maskId) || null : null;

  for (const n of L.nodes) {
    if (n.tag === 'group' || n === maskNode) continue;
    const visible = n.visible && groupVisible(n, 0);
    if (!visible && !app.opts.hidden) continue;
    const el = buildNode(n, pkg, L, ctx);
    if (!el) continue;
    if (!visible) el.classList.add('fg-ghost');
    box.appendChild(el);
  }
  if (maskNode && maskNode.g) {
    const m = maskNode.g;
    box.style.clipPath = 'inset(' + m.y + 'px ' + (L.w - m.x - m.w) + 'px ' + (L.h - m.y - m.h) + 'px ' + m.x + 'px)';
  }
  return box;
}

function buildNode(n, pkg, L, ctx) {
  const g = n.g;
  const def = L.def;
  const wrap = document.createElement('div');
  wrap.className = 'fg';
  wrap.style.left = g.x + 'px';
  wrap.style.top = g.y + 'px';
  wrap.style.width = Math.max(0, g.w) + 'px';
  wrap.style.height = Math.max(0, g.h) + 'px';
  const tf = [];
  if (n.rotation) tf.push('rotate(' + n.rotation + 'deg)');
  if (n.skew[0] || n.skew[1]) tf.push('skew(' + n.skew[0] + 'deg,' + n.skew[1] + 'deg)');
  if (n.scale[0] !== 1 || n.scale[1] !== 1) tf.push('scale(' + n.scale[0] + ',' + n.scale[1] + ')');
  if (tf.length) {
    wrap.style.transform = tf.join(' ');
    wrap.style.transformOrigin = n.pivot[0] * 100 + '% ' + n.pivot[1] * 100 + '%';
  }
  if (n.alpha !== 1) wrap.style.opacity = String(Math.max(0, Math.min(1, n.alpha)));
  if (n.grayed) wrap.style.filter = 'grayscale(1)';
  const blend = n.el.getAttribute('blend');
  if (blend === 'add') wrap.style.mixBlendMode = 'plus-lighter';
  else if (blend === 'multiply' || blend === 'screen') wrap.style.mixBlendMode = blend;

  const meta = { id: n.id, name: n.name, tag: n.tag, file: def.path, depth: ctx.depth, top: ctx.depth === 0 ? n.id : ctx.top, chain: ctx.chain.concat(n.name || n.id), res: n.res ? n.res.file : null };
  wrap.__fg = meta;
  if (ctx.depth === 0 && n.id) {
    ctx.view.topEls.set(n.id, wrap);
    const st = app.diff && app.diff.get(n.id);
    if (st && (st !== 'added' || ctx.view.side === 1) && (st !== 'removed' || ctx.view.side === 0)) wrap.classList.add('fg-diff-' + st);
  }

  const childCtx = { depth: ctx.depth + 1, top: meta.top, chain: meta.chain, view: ctx.view };
  const w = Math.max(0, g.w), h = Math.max(0, g.h);

  switch (n.tag) {
    case 'image': {
      if (!n.res) { placeholder(wrap, 'missing image', n); break; }
      const img = imgDone.get(n.res.file);
      if (!img) { placeholder(wrap, 'missing ' + n.res.name, n); app.missing.add(n.res.file); break; }
      const tint = n.colorOverride || (n.gearColor ? n.gearColor.split(',')[0] : null) || n.el.getAttribute('color');
      const fillMethod = n.el.getAttribute('fillMethod');
      const c = drawToCanvas(img, n.res, w, h, 0, 0, w, h, tint, fillMethod ? { method: fillMethod, amount: attrNum(n.el, 'fillAmount', 100) / 100, origin: attrNum(n.el, 'fillOrigin', 0) } : null, ctx.view);
      const flip = n.el.getAttribute('flip');
      if (flip) c.style.transform = flip === 'hz' ? 'scaleX(-1)' : flip === 'vt' ? 'scaleY(-1)' : 'scale(-1,-1)';
      wrap.appendChild(c);
      break;
    }
    case 'component': {
      if (!n.res || !n.sub) {
        const why = n.subError ? n.subError.message : n.res ? 'missing ' + n.res.name : 'missing component';
        if (n.res) app.missing.add(n.res.file);
        placeholder(wrap, why, n);
        break;
      }
      if (ctx.depth >= MAX_DEPTH) { placeholder(wrap, 'nesting too deep', n); break; }
      wrap.appendChild(renderComp(n.sub, n.res.pkg, childInst(n, w, h, L), childCtx));
      break;
    }
    case 'text':
    case 'richtext':
      wrap.appendChild(makeText(n, w, h));
      if (textAutoSize(n.el) === 'height') wrap.style.height = 'auto';
      break;
    case 'graph':
      makeGraph(wrap, n);
      break;
    case 'loader':
      makeLoader(wrap, n, w, h, childCtx);
      break;
    case 'list':
      makeList(wrap, n, w, h, childCtx);
      break;
    case 'movieclip':
      placeholder(wrap, 'movieclip ' + (n.res ? n.res.name : ''), n, true);
      break;
    case 'loader3D':
      placeholder(wrap, 'Spine/3D: ' + (n.el.getAttribute('skin') || '') + ' ' + (n.el.getAttribute('animation') || ''), n, true);
      break;
    default:
      placeholder(wrap, '<' + n.tag + '>', n, true);
  }
  return wrap;
}

function placeholder(wrap, text, n, soft) {
  const d = document.createElement('div');
  d.className = 'fg fg-ph';
  d.style.width = '100%';
  d.style.height = '100%';
  if (soft) { d.style.color = 'var(--muted)'; d.style.outlineColor = 'var(--muted)'; d.style.background = 'transparent'; }
  d.textContent = text;
  d.title = (n.name || n.id) + ': ' + text;
  wrap.appendChild(d);
}

// ------------------------------------------------------------------ images

function canvasScale(view) {
  const z = (view && view.zoomValue) || 1;
  return (window.devicePixelRatio || 1) * Math.min(Math.max(z, 1), 3);
}

function drawToCanvas(img, res, boxW, boxH, dx, dy, dw, dh, tint, fill, view) {
  const s = canvasScale(view);
  const cw = Math.max(1, Math.min(4096, Math.ceil(boxW * s)));
  const ch = Math.max(1, Math.min(4096, Math.ceil(boxH * s)));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  c.style.width = boxW + 'px';
  c.style.height = boxH + 'px';
  c.style.position = 'absolute';
  c.style.left = '0';
  c.style.top = '0';
  if (dw <= 0 || dh <= 0) return c;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.scale(cw / (boxW || 1), ch / (boxH || 1));
  if (fill) clipFill(ctx, fill, dx, dy, dw, dh);
  ctx.imageSmoothingQuality = 'high';
  if (res && res.scale9) draw9(ctx, img, res.scale9, dx, dy, dw, dh);
  else if (res && res.tile) {
    ctx.translate(dx, dy);
    ctx.fillStyle = ctx.createPattern(img, 'repeat');
    ctx.fillRect(0, 0, dw, dh);
  } else ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
  if (tint && !/^f{6}$/i.test(tint.replace('#', '').slice(-6))) applyTint(c, tint);
  return c;
}

function clipFill(ctx, fill, x, y, w, h) {
  const a = Math.max(0, Math.min(1, fill.amount));
  ctx.beginPath();
  if (fill.method === 'hz') {
    const fw = w * a;
    ctx.rect(fill.origin === 1 ? x + w - fw : x, y, fw, h);
  } else if (fill.method === 'vt') {
    const fh = h * a;
    ctx.rect(x, fill.origin === 1 ? y : y + h - fh, w, fh);
  } else {
    const cx = x + w / 2, cy = y + h / 2, r = Math.hypot(w, h);
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a);
    ctx.closePath();
  }
  ctx.clip();
}

function draw9(ctx, img, grid, x, y, w, h) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const [gx, gy, gw, gh] = grid;
  let l = gx, t = gy, r = iw - gx - gw, b = ih - gy - gh;
  const L = l, T = t, R = r, B = b;
  if (l + r > w && l + r > 0) { const k = w / (l + r); l *= k; r *= k; }
  if (t + b > h && t + b > 0) { const k = h / (t + b); t *= k; b *= k; }
  const sxs = [0, L, iw - R, iw], sys = [0, T, ih - B, ih];
  const dxs = [x, x + l, x + w - r, x + w], dys = [y, y + t, y + h - b, y + h];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const sw = sxs[i + 1] - sxs[i], sh = sys[j + 1] - sys[j];
      const dw = dxs[i + 1] - dxs[i], dh = dys[j + 1] - dys[j];
      if (sw > 0 && sh > 0 && dw > 0 && dh > 0) ctx.drawImage(img, sxs[i], sys[j], sw, sh, dxs[i], dys[j], dw + 0.02, dh + 0.02);
    }
  }
}

function applyTint(c, tint) {
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  copy.getContext('2d').drawImage(c, 0, 0);
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color(tint);
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(copy, 0, 0);
  ctx.restore();
}

function color(s) {
  if (!s) return 'transparent';
  const h = s.trim().replace('#', '');
  if (h.length === 8) {
    const a = parseInt(h.slice(0, 2), 16) / 255;
    const r = parseInt(h.slice(2, 4), 16), g = parseInt(h.slice(4, 6), 16), b = parseInt(h.slice(6, 8), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
  }
  if (h.length === 6) return '#' + h;
  return s;
}

// ------------------------------------------------------------------ text

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function ubbToHtml(s) {
  return esc(s)
    .replace(/\[color=(#?[0-9a-fA-F]{3,8})\]/gi, '<span style="color:$1">').replace(/\[\/color\]/gi, '</span>')
    .replace(/\[size=(\d+)\]/gi, '<span style="font-size:$1px">').replace(/\[\/size\]/gi, '</span>')
    .replace(/\[(\/?)(b|i|u)\]/gi, '<$1$2>')
    .replace(/\[url(=[^\]]*)?\]/gi, '<u>').replace(/\[\/url\]/gi, '</u>')
    .replace(/\[img\][^[]*\[\/img\]/gi, '▣')
    .replace(/\[font=[^\]]*\]|\[\/font\]/gi, '');
}

// FairyGUI omits autoSize when it is the default, which is "both".
function textAutoSize(el) {
  return el.getAttribute('autoSize') || 'both';
}

function textProps(n) {
  const el = n.el;
  let text = n.textOverride !== undefined ? n.textOverride : n.gearText !== null && n.gearText !== undefined ? n.gearText : el.getAttribute('text') || '';
  let isPrompt = false;
  if (!text && el.getAttribute('input') === 'true' && el.getAttribute('prompt')) { text = el.getAttribute('prompt'); isPrompt = true; }
  if (el.getAttribute('vars') === 'true') text = text.replace(/\{(\w+)=([^}]*)\}/g, '$2');
  const gc = n.gearColor ? n.gearColor.split(',') : [];
  return {
    text, isPrompt,
    ubb: el.getAttribute('ubb') === 'true' || n.tag === 'richtext',
    color: n.colorOverride || gc[0] || el.getAttribute('color') || P.textColor,
    strokeColor: n.strokeColorOverride || gc[1] || el.getAttribute('strokeColor'),
    strokeSize: attrNum(el, 'strokeSize', 0),
    fontSize: n.fontSizeOverride || (n.gearFontSize ? parseFloat(n.gearFontSize) : 0) || attrNum(el, 'fontSize', 12),
    align: el.getAttribute('align') || 'left',
    vAlign: el.getAttribute('vAlign') || 'top',
    autoSize: textAutoSize(el),
    singleLine: el.getAttribute('singleLine') === 'true',
    bold: el.getAttribute('bold') === 'true',
    italic: el.getAttribute('italic') === 'true',
    underline: el.getAttribute('underline') === 'true',
    letterSpacing: attrNum(el, 'letterSpacing', 0),
    leading: attrNum(el, 'leading', 3),
  };
}

function fontFamily() {
  return (P.fontFamily ? P.fontFamily + ',' : '') + FONT_STACK;
}

function lineHeight(t) {
  return Math.round(t.fontSize * 1.2 + t.leading - 3);
}

let measureCtx = null;

// Size of an auto-sized ("both") text field: widest line plus FairyGUI's 2px gutter on each side.
function measureText(t) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  const plain = t.ubb ? t.text.replace(/\[[^\]]*\]/g, '') : t.text;
  const lines = plain.split('\n');
  ctx.font = (t.italic ? 'italic ' : '') + (t.bold ? '700 ' : '') + t.fontSize + 'px ' + fontFamily();
  let w = 0;
  for (const line of lines) w = Math.max(w, ctx.measureText(line).width + t.letterSpacing * Math.max(0, line.length - 1));
  return [Math.ceil(w) + 4, lines.length * lineHeight(t) + 4];
}

function makeText(n, w, h) {
  const t = textProps(n);
  const box = document.createElement('div');
  box.className = 'fg fg-text';
  box.style.position = 'relative';
  box.style.width = w + 'px';
  box.style.height = t.autoSize === 'height' ? 'auto' : h + 'px';
  box.style.alignItems = t.vAlign === 'middle' ? 'center' : t.vAlign === 'bottom' ? 'flex-end' : 'flex-start';
  const span = document.createElement('span');
  span.style.textAlign = t.autoSize === 'both' ? 'center' : t.align;
  span.style.fontFamily = fontFamily();
  span.style.fontSize = t.fontSize + 'px';
  span.style.lineHeight = lineHeight(t) + 'px';
  span.style.color = t.isPrompt ? 'rgba(128,128,128,.8)' : color(t.color);
  if (t.bold) span.style.fontWeight = '700';
  if (t.italic) span.style.fontStyle = 'italic';
  if (t.underline) span.style.textDecoration = 'underline';
  if (t.letterSpacing) span.style.letterSpacing = t.letterSpacing + 'px';
  span.style.whiteSpace = t.singleLine || t.autoSize === 'both' ? 'pre' : 'pre-wrap';
  if (t.autoSize === 'ellipsis') { span.style.overflow = 'hidden'; span.style.textOverflow = 'ellipsis'; span.style.whiteSpace = 'pre'; }
  if (t.strokeColor && t.strokeSize > 0) {
    const px = t.strokeSize < 1 ? Math.max(1, t.strokeSize * t.fontSize * 0.25) : t.strokeSize;
    span.style.webkitTextStroke = (px * 2).toFixed(2) + 'px ' + color(t.strokeColor);
    span.style.paintOrder = 'stroke fill';
  }
  const shadowCol = n.el.getAttribute('shadowColor');
  if (shadowCol) {
    const off = nums(n.el.getAttribute('shadowOffset'), [1, 1]);
    span.style.textShadow = off[0] + 'px ' + off[1] + 'px 0 ' + color(shadowCol);
  }
  if (t.ubb) span.innerHTML = ubbToHtml(t.text);
  else span.textContent = t.text;
  if (t.autoSize === 'shrink') box.classList.add('fg-shrink');
  if (t.autoSize === 'shrink' || t.autoSize === 'ellipsis') box.classList.add('fg-clip');
  box.appendChild(span);
  return box;
}

function fitShrinkText(root) {
  for (const box of root.querySelectorAll('.fg-shrink')) {
    const span = box.firstChild;
    let fs = parseFloat(span.style.fontSize) || 12;
    let guard = 0;
    while (guard++ < 40 && fs > 4 && (span.scrollWidth > box.clientWidth + 1 || span.scrollHeight > box.clientHeight + 1)) {
      fs *= 0.92;
      span.style.fontSize = fs.toFixed(2) + 'px';
      span.style.lineHeight = Math.round(fs * 1.2) + 'px';
    }
  }
}

// ------------------------------------------------------------------ graph, loader, list

function makeGraph(wrap, n) {
  const el = n.el;
  const type = el.getAttribute('type');
  if (!type) return;
  const d = document.createElement('div');
  d.className = 'fg';
  d.style.width = '100%';
  d.style.height = '100%';
  d.style.boxSizing = 'border-box';
  const gc = n.colorOverride || (n.gearColor ? n.gearColor.split(',')[0] : null);
  // A graph with no fill color set is usually a hit area or a runtime VFX holder; FairyGUI paints it white.
  if (!gc && !el.hasAttribute('fillColor') && !app.opts.plainGraphs) {
    d.className = 'fg fg-plain-graph';
    if (type === 'eclipse') d.style.borderRadius = '50%';
    wrap.appendChild(d);
    return;
  }
  d.style.background = color(gc || el.getAttribute('fillColor') || '#ffffffff');
  const ls = attrNum(el, 'lineSize', 1);
  if (ls > 0) d.style.border = ls + 'px solid ' + color(el.getAttribute('lineColor') || '#ff000000');
  if (type === 'eclipse') d.style.borderRadius = '50%';
  else if (type === 'rect') {
    const corner = el.getAttribute('corner');
    if (corner) d.style.borderRadius = corner.split(',').map((v) => parseFloat(v) + 'px').join(' ');
  } else {
    placeholder(wrap, type, n, true);
    return;
  }
  wrap.appendChild(d);
}

function makeLoader(wrap, n, w, h, ctx) {
  const el = n.el;
  const url = n.iconOverride !== undefined ? n.iconOverride : n.gearIcon !== null && n.gearIcon !== undefined ? n.gearIcon : el.getAttribute('url') || '';
  if (!url) {
    if (app.opts.empty) wrap.classList.add('fg-empty-loader');
    return;
  }
  const res = resolveUrl(url);
  if (!res) { placeholder(wrap, 'missing ' + url, n); return; }
  let cw, ch, img = null, sub = null;
  if (res.tag === 'image') {
    img = imgDone.get(res.file);
    if (!img) { placeholder(wrap, 'missing ' + res.name, n); app.missing.add(res.file); return; }
    cw = img.naturalWidth;
    ch = img.naturalHeight;
  } else if (res.tag === 'component') {
    sub = compDone.get(res.file);
    if (!sub || sub instanceof Error) { placeholder(wrap, 'missing ' + res.name, n); return; }
    cw = sub.size[0];
    ch = sub.size[1];
  } else {
    placeholder(wrap, res.tag + ' ' + res.name, n, true);
    return;
  }
  const fill = el.getAttribute('fill') || 'none';
  let sw = cw, sh = ch;
  const kx = w / (cw || 1), ky = h / (ch || 1);
  if (fill === 'scale') { const k = Math.min(kx, ky); sw = cw * k; sh = ch * k; }
  else if (fill === 'scaleMatchHeight') { sw = cw * ky; sh = h; }
  else if (fill === 'scaleMatchWidth') { sw = w; sh = ch * kx; }
  else if (fill === 'scaleFree') { sw = w; sh = h; }
  else if (fill === 'scaleNoBorder') { const k = Math.max(kx, ky); sw = cw * k; sh = ch * k; }
  if (el.getAttribute('shrinkOnly') === 'true' && (sw > cw || sh > ch)) { sw = cw; sh = ch; }
  const align = el.getAttribute('align') || 'left';
  const vAlign = el.getAttribute('vAlign') || 'top';
  const ox = align === 'center' ? (w - sw) / 2 : align === 'right' ? w - sw : 0;
  const oy = vAlign === 'middle' ? (h - sh) / 2 : vAlign === 'bottom' ? h - sh : 0;
  if (img) {
    const tint = n.colorOverride || (n.gearColor ? n.gearColor.split(',')[0] : null) || el.getAttribute('color');
    const fillMethod = el.getAttribute('fillMethod');
    const fillOpt = fillMethod ? { method: fillMethod, amount: attrNum(el, 'fillAmount', 100) / 100, origin: attrNum(el, 'fillOrigin', 0) } : null;
    wrap.appendChild(drawToCanvas(img, fill === 'scaleFree' ? res : res.scale9 ? null : res, w, h, ox, oy, sw, sh, tint, fillOpt, ctx.view));
    wrap.__fg.res = res.file;
  } else {
    if (ctx.depth >= MAX_DEPTH) return;
    const inner = renderComp(sub, res.pkg, { w: cw, h: ch, ctrl: new Map(), over: { props: [] } }, ctx);
    inner.style.left = ox + 'px';
    inner.style.top = oy + 'px';
    inner.style.transformOrigin = '0 0';
    inner.style.transform = 'scale(' + sw / (cw || 1) + ',' + sh / (ch || 1) + ')';
    wrap.appendChild(inner);
    wrap.__fg.res = res.file;
  }
}

function makeList(wrap, n, w, h, ctx) {
  const el = n.el;
  const ov = el.getAttribute('overflow');
  if (ov === 'hidden' || ov === 'scroll') wrap.style.overflow = 'hidden';
  const items = [...el.children].filter((c) => c.tagName === 'item').slice(0, 300);
  const defaultItem = el.getAttribute('defaultItem') || '';
  const layout = el.getAttribute('layout') || 'column';
  const lineGap = attrNum(el, 'lineGap', 0), colGap = attrNum(el, 'colGap', 0);
  const perLine = attrNum(el, 'lineItemCount', 0), perLine2 = attrNum(el, 'lineItemCount2', 0);
  const [mt, mb, ml, mr] = nums(el.getAttribute('margin'), [0, 0, 0, 0]);
  const autoItem = el.getAttribute('autoItemSize') !== 'false';
  const viewW = w - ml - mr, viewH = h - mt - mb;
  const content = document.createElement('div');
  content.className = 'fg';
  wrap.appendChild(content);

  const placed = [];
  let x = 0, y = 0, lineSize = 0, inLine = 0;
  let maxX = 0, maxY = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const res = resolveUrl(it.getAttribute('url') || defaultItem);
    const def = res ? compDone.get(res.file) : null;
    let iw = 100, ih = 30;
    if (def && !(def instanceof Error)) { iw = def.size[0]; ih = def.size[1]; }
    if (autoItem) {
      if (layout === 'column') iw = viewW;
      else if (layout === 'row') ih = viewH;
      else if (layout === 'flow_hz' && perLine > 0) iw = (viewW - colGap * (perLine - 1)) / perLine;
      else if (layout === 'flow_vt' && perLine > 0) ih = (viewH - lineGap * (perLine - 1)) / perLine;
      else if (layout === 'pagination') {
        if (perLine > 0) iw = (viewW - colGap * (perLine - 1)) / perLine;
        if (perLine2 > 0) ih = (viewH - lineGap * (perLine2 - 1)) / perLine2;
      }
    }
    if (layout === 'column') {
      placed.push([0, y, iw, ih]);
      y += ih + lineGap;
    } else if (layout === 'row') {
      placed.push([x, 0, iw, ih]);
      x += iw + colGap;
    } else if (layout === 'flow_hz') {
      if (inLine > 0 && ((perLine > 0 && inLine >= perLine) || (perLine === 0 && x + iw > viewW))) { x = 0; y += lineSize + lineGap; lineSize = 0; inLine = 0; }
      placed.push([x, y, iw, ih]);
      x += iw + colGap; lineSize = Math.max(lineSize, ih); inLine++;
    } else if (layout === 'flow_vt') {
      if (inLine > 0 && ((perLine > 0 && inLine >= perLine) || (perLine === 0 && y + ih > viewH))) { y = 0; x += lineSize + colGap; lineSize = 0; inLine = 0; }
      placed.push([x, y, iw, ih]);
      y += ih + lineGap; lineSize = Math.max(lineSize, iw); inLine++;
    } else {
      const cols = perLine > 0 ? perLine : Math.max(1, Math.floor((viewW + colGap) / (iw + colGap)));
      const rows = perLine2 > 0 ? perLine2 : Math.max(1, Math.floor((viewH + lineGap) / (ih + lineGap)));
      const perPage = cols * rows;
      const page = Math.floor(i / perPage);
      const k = i % perPage;
      placed.push([page * viewW + (k % cols) * (iw + colGap), Math.floor(k / cols) * (ih + lineGap), iw, ih]);
    }
    const p = placed[placed.length - 1];
    maxX = Math.max(maxX, p[0] + p[2]);
    maxY = Math.max(maxY, p[1] + p[3]);
  }
  const align = el.getAttribute('align') || 'left', vAlign = el.getAttribute('vAlign') || 'top';
  const offX = layout === 'pagination' ? 0 : maxX < viewW ? (align === 'center' ? (viewW - maxX) / 2 : align === 'right' ? viewW - maxX : 0) : 0;
  const offY = maxY < viewH ? (vAlign === 'middle' ? (viewH - maxY) / 2 : vAlign === 'bottom' ? viewH - maxY : 0) : 0;

  for (let i = 0; i < placed.length; i++) {
    const it = items[i];
    const [px, py, iw, ih] = placed[i];
    const url = it.getAttribute('url') || defaultItem;
    const res = resolveUrl(url);
    const cell = document.createElement('div');
    cell.className = 'fg';
    cell.style.left = ml + offX + px + 'px';
    cell.style.top = mt + offY + py + 'px';
    cell.style.width = iw + 'px';
    cell.style.height = ih + 'px';
    cell.__fg = { id: n.id, name: (n.name || n.id) + '[' + i + ']', tag: 'list item', file: wrap.__fg.file, depth: ctx.depth, top: wrap.__fg.top, chain: ctx.chain.concat('[' + i + ']'), res: res ? res.file : null };
    const def = res ? compDone.get(res.file) : null;
    if (!res || !def || def instanceof Error) {
      placeholder(cell, url ? 'missing item ' + url : 'list item without defaultItem', n);
    } else if (ctx.depth < MAX_DEPTH) {
      const over = { props: [] };
      if (it.hasAttribute('title')) over.title = it.getAttribute('title');
      if (it.hasAttribute('icon')) over.icon = it.getAttribute('icon');
      if (it.hasAttribute('selected')) over.selected = it.getAttribute('selected') === 'true';
      const ctrl = new Map();
      for (const [k, v] of ctrlPairs(it.getAttribute('controllers'))) ctrl.set(k, v);
      cell.appendChild(renderComp(def, res.pkg, { w: iw, h: ih, ctrl, over }, { depth: ctx.depth + 1, top: cell.__fg.top, chain: cell.__fg.chain, view: ctx.view }));
    }
    content.appendChild(cell);
  }
}

// ------------------------------------------------------------------ views

function createView(side, title) {
  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.innerHTML = '<div class="paneTitle"></div><div class="stage"><div class="sizer"><div class="root"></div></div><div class="box hoverBox"></div><div class="box selBox"></div><div class="peerBox box"></div><div class="loading">Loading…</div></div>';
  $('panes').appendChild(pane);
  const v = {
    side, title, source: null, pane,
    titleEl: pane.querySelector('.paneTitle'),
    stage: pane.querySelector('.stage'),
    sizer: pane.querySelector('.sizer'),
    root: pane.querySelector('.root'),
    hoverBox: pane.querySelector('.hoverBox'),
    selBox: pane.querySelector('.selBox'),
    peerBox: pane.querySelector('.peerBox'),
    loading: pane.querySelector('.loading'),
    topEls: new Map(), rootSize: [0, 0], zoomValue: 1, hoverEl: null, rendered: false, def: null, empty: null,
  };
  v.titleEl.textContent = title || '';
  v.root.addEventListener('mousemove', (e) => onHover(v, metaAt(e.target)));
  v.root.addEventListener('mouseleave', () => onHover(v, null));
  v.root.addEventListener('click', (e) => {
    const el = metaAt(e.target);
    if (!el || !el.__fg.top) return;
    select(el.__fg.top);
    if (app.mode === 'single') request({ op: 'nav', file: app.file, id: el.__fg.top }).catch(() => {});
  });
  v.root.addEventListener('dblclick', (e) => {
    const el = metaAt(e.target);
    if (!el || !el.__fg.res || !/\.xml$/i.test(el.__fg.res)) return;
    request({ op: 'open', file: el.__fg.res }).catch(() => {});
  });
  v.stage.addEventListener('scroll', () => {
    if (app.syncingScroll) return;
    app.syncingScroll = true;
    for (const o of app.views) if (o !== v) { o.stage.scrollLeft = v.stage.scrollLeft; o.stage.scrollTop = v.stage.scrollTop; }
    app.syncingScroll = false;
    refreshBoxes();
  });
  new ResizeObserver(() => { if (app.opts.zoom === 'fit' && app.views.every((x) => x.rendered || x.empty)) { computeZoom(); applyZoom(); } }).observe(v.stage);
  app.views.push(v);
  return v;
}

function showErrors(list) {
  const e = $('errors');
  e.style.display = list.length ? 'block' : 'none';
  e.textContent = list.join('\n');
}

async function render() {
  const seq = ++app.seq;
  if (!P.loaded) return;
  try { await P.loaded; } catch (e) { return; }
  const errors = [];
  const defs = [];
  for (const v of app.views) {
    if (v.source === null || v.source === undefined) { defs.push(null); continue; }
    try {
      defs.push(parseComp(v.source, app.file));
    } catch (e) {
      errors.push((app.views.length > 1 ? v.title + ': ' : '') + e.message + (v.rendered ? '  (showing the last valid version)' : ''));
      defs.push(v.rendered ? v.def : undefined);
    }
  }
  const folder = app.file.split('/')[0];
  const pkg = P.byName.get(folder) || null;
  await Promise.all(defs.map((d) => (d ? preload(d, pkg, 0, new Set()) : null)));
  if (seq !== app.seq) return;

  app.missing = new Set();
  const live = defs.filter(Boolean);
  if (!live.length) {
    showErrors(errors);
    for (const v of app.views) { v.loading.style.display = 'flex'; v.loading.textContent = 'Cannot render this file.'; }
    return;
  }
  app.diff = app.mode === 'diff' ? diffDefs(defs[0], defs[1]) : null;
  buildControllerUi(live);
  buildScreenUi(live[live.length - 1]);
  buildChangesUi(defs);

  for (let i = 0; i < app.views.length; i++) {
    const v = app.views[i];
    const def = defs[i];
    if (def === null) {
      v.empty = true;
      v.root.replaceChildren();
      v.loading.style.display = 'flex';
      v.loading.textContent = v.emptyText || 'No file in this revision';
      continue;
    }
    if (def === undefined) continue;
    v.def = def;
    let [w, h] = def.size;
    const dev = app.opts.screen !== 'design' ? P.devices[parseInt(app.opts.screen, 10)] : null;
    if (dev && def.size[0] === P.design[0] && def.size[1] === P.design[1]) {
      const k = Math.min(dev.resolutionX / P.design[0], dev.resolutionY / P.design[1]);
      w = Math.round(dev.resolutionX / k);
      h = Math.round(dev.resolutionY / k);
    }
    v.topEls = new Map();
    let node, L;
    try {
      L = layoutComp(def, pkg, { w, h, ctrl: new Map(), over: { props: [] }, isRoot: true }, 0);
      v.rootSize = [L.w, L.h];
      if (!v.rendered) computeZoom();
      node = buildComp(L, pkg, { w, h, ctrl: new Map(), over: { props: [] }, isRoot: true }, { depth: 0, top: '', chain: [], view: v });
    } catch (e) {
      console.error(e);
      errors.push('Render failed: ' + (e && e.message ? e.message : e));
      continue;
    }
    node.__fg = { id: '', name: app.file.split('/').pop(), tag: 'component', file: app.file, depth: -1, top: '', chain: [], res: app.file };
    v.root.replaceChildren(node);
    v.root.style.width = L.w + 'px';
    v.root.style.height = L.h + 'px';
    fitShrinkText(v.root);
    v.rendered = true;
    v.loading.style.display = 'none';
  }
  computeZoom();
  applyZoom();
  if (app.missing.size) errors.push('Missing resources (' + app.missing.size + '): ' + [...app.missing].slice(0, 6).join(', ') + (app.missing.size > 6 ? ', …' : ''));
  showErrors(errors);
  refreshBoxes();
  setStatusDefault();
}

function setStatusDefault() {
  const v = app.views[app.views.length - 1];
  const [w, h] = v.rootSize;
  if (app.mode === 'diff') {
    const counts = { added: 0, removed: 0, changed: 0 };
    if (app.diff) for (const s of app.diff.values()) counts[s] = (counts[s] || 0) + 1;
    $('status').innerHTML = '<b>' + esc(app.file) + '</b> · ' + w + '×' + h + ' · <span class="c-added">' + counts.added + ' added</span> · <span class="c-removed">' + counts.removed + ' removed</span> · <span class="c-changed">' + counts.changed + ' changed</span> · nested components and images come from the working copy';
  } else {
    $('status').innerHTML = '<b>' + esc(app.file) + '</b> · ' + w + '×' + h + ' · ' + v.topEls.size + ' elements · click an element to jump to it in the XML, double-click a component to open it';
  }
}

function buildControllerUi(defs) {
  const ctrls = [];
  for (const d of defs) for (const c of d.controllers) if (c.pages.length && !ctrls.some((x) => x.name === c.name)) ctrls.push(c);
  const host = $('controllers');
  const key = ctrls.map((c) => c.name + ':' + c.pages.map((p) => p.id + '=' + p.name).join(',')).join('|');
  const btn = $('btnCtrl');
  btn.style.display = ctrls.length ? '' : 'none';
  btn.textContent = 'Controllers (' + ctrls.length + ')';
  if (host.dataset.key === key) {
    for (const sel of host.querySelectorAll('select')) {
      const c = ctrls.find((x) => x.name === sel.dataset.name);
      if (c) sel.value = app.ctrl.has(c.name) ? app.ctrl.get(c.name) : (c.pages[c.selected] || c.pages[0] || { id: '' }).id;
    }
    return;
  }
  host.dataset.key = key;
  host.replaceChildren();
  for (const c of ctrls) {
    const g = document.createElement('div');
    g.className = 'group';
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = c.name;
    const sel = document.createElement('select');
    sel.dataset.name = c.name;
    for (const p of c.pages) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name ? p.name + ' (' + p.id + ')' : p.id;
      sel.appendChild(o);
    }
    sel.value = app.ctrl.has(c.name) ? app.ctrl.get(c.name) : (c.pages[c.selected] || c.pages[0]).id;
    sel.addEventListener('change', () => { app.ctrl.set(c.name, sel.value); render(); });
    g.append(l, sel);
    host.appendChild(g);
  }
}

function buildScreenUi(def) {
  const full = def.size[0] === P.design[0] && def.size[1] === P.design[1] && P.devices.length > 0;
  $('screenGroup').style.display = full ? '' : 'none';
  const sel = $('screen');
  if (!sel.options.length) {
    const o = document.createElement('option');
    o.value = 'design';
    o.textContent = 'Design ' + P.design[0] + '×' + P.design[1];
    sel.appendChild(o);
    P.devices.forEach((d, i) => {
      const op = document.createElement('option');
      op.value = String(i);
      op.textContent = d.name + ' ' + d.resolutionX + '×' + d.resolutionY;
      sel.appendChild(op);
    });
  }
  sel.value = app.opts.screen;
}

// ------------------------------------------------------------------ diff

function diffDefs(a, b) {
  const map = new Map();
  if (!a || !b) {
    const only = a || b;
    if (only) for (const el of only.children) { const id = el.getAttribute('id'); if (id) map.set(id, a ? 'removed' : 'added'); }
    return map;
  }
  const ser = new XMLSerializer();
  const key = (el) => ser.serializeToString(el).replace(/\s+/g, ' ');
  const A = new Map(), B = new Map();
  for (const el of a.children) { const id = el.getAttribute('id'); if (id) A.set(id, el); }
  for (const el of b.children) { const id = el.getAttribute('id'); if (id) B.set(id, el); }
  for (const [id, el] of B) {
    if (!A.has(id)) map.set(id, 'added');
    else if (key(A.get(id)) !== key(el)) map.set(id, 'changed');
  }
  for (const id of A.keys()) if (!B.has(id)) map.set(id, 'removed');
  return map;
}

function rootChanges(a, b) {
  const out = [];
  if (!a || !b) return out;
  if (a.size.join() !== b.size.join()) out.push('size ' + a.size.join('×') + ' → ' + b.size.join('×'));
  const ca = a.controllers.map((c) => c.name + ':' + c.pages.map((p) => p.id + '=' + p.name).join(',')).join('|');
  const cb = b.controllers.map((c) => c.name + ':' + c.pages.map((p) => p.id + '=' + p.name).join(',')).join('|');
  if (ca !== cb) out.push('controllers changed');
  const ser = new XMLSerializer();
  const rest = (d) => [...d.root.children].filter((c) => c.tagName !== 'displayList' && c.tagName !== 'controller').map((c) => ser.serializeToString(c).replace(/\s+/g, ' ')).join('');
  if (rest(a) !== rest(b)) out.push('transitions or component settings changed');
  return out;
}

function buildChangesUi(defs) {
  const bar = $('changesBar');
  if (app.mode !== 'diff') { bar.style.display = 'none'; return; }
  bar.style.display = '';
  bar.replaceChildren();
  const names = new Map();
  for (const d of defs) if (d) for (const el of d.children) { const id = el.getAttribute('id'); if (id && !names.has(id)) names.set(id, el.getAttribute('name') || id); }
  const root = rootChanges(defs[0], defs[1]);
  if (!app.diff.size && !root.length) {
    const s = document.createElement('span');
    s.className = 'lbl';
    s.textContent = 'No differences in the display list.';
    bar.appendChild(s);
    return;
  }
  for (const r of root) {
    const s = document.createElement('span');
    s.className = 'chip c-changed';
    s.textContent = '◆ ' + r;
    bar.appendChild(s);
  }
  for (const [id, st] of app.diff) {
    const b = document.createElement('button');
    b.className = 'chip c-' + st;
    b.textContent = (st === 'added' ? '+ ' : st === 'removed' ? '− ' : '~ ') + names.get(id);
    b.title = id + ' (' + st + ')';
    b.addEventListener('click', () => { select(id); scrollToSelected(); });
    bar.appendChild(b);
  }
}

// ------------------------------------------------------------------ zoom, hover, selection

function computeZoom() {
  let z = Infinity;
  for (const v of app.views) {
    if (!v.rendered) continue;
    const [w, h] = v.rootSize;
    if (app.opts.zoom === 'fit') z = Math.min(z, (v.stage.clientWidth - 48) / (w || 1), (v.stage.clientHeight - 48) / (h || 1));
  }
  const value = app.opts.zoom === 'fit' ? (isFinite(z) ? Math.max(0.05, Math.min(2, z)) : 1) : parseFloat(app.opts.zoom);
  for (const v of app.views) v.zoomValue = value;
}

function applyZoom() {
  for (const v of app.views) {
    const [w, h] = v.rootSize;
    const z = v.zoomValue || 1;
    v.stage.classList.toggle('fit', app.opts.zoom === 'fit');
    v.root.style.transform = 'scale(' + z + ')';
    v.root.style.setProperty('--z', String(z));
    v.sizer.style.width = w * z + 'px';
    v.sizer.style.height = h * z + 'px';
  }
  refreshBoxes();
}

function placeBox(v, box, el) {
  if (!el || !el.isConnected) { box.style.display = 'none'; return; }
  const sr = v.stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  box.style.display = 'block';
  box.style.left = r.left - sr.left + v.stage.scrollLeft + 'px';
  box.style.top = r.top - sr.top + v.stage.scrollTop + 'px';
  box.style.width = r.width + 'px';
  box.style.height = r.height + 'px';
}

function refreshBoxes() {
  for (const v of app.views) {
    placeBox(v, v.selBox, app.selectedId ? v.topEls.get(app.selectedId) : null);
    placeBox(v, v.hoverBox, v.hoverEl);
    const peer = app.views.find((o) => o !== v && o.hoverEl);
    placeBox(v, v.peerBox, peer && peer.hoverEl.__fg.top ? v.topEls.get(peer.hoverEl.__fg.top) : null);
  }
}

function select(id) {
  app.selectedId = id || null;
  refreshBoxes();
}

function scrollToSelected() {
  for (const v of app.views) {
    const el = app.selectedId ? v.topEls.get(app.selectedId) : null;
    if (!el) continue;
    const sr = v.stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.right < sr.left || r.left > sr.right || r.bottom < sr.top || r.top > sr.bottom) el.scrollIntoView({ block: 'center', inline: 'center' });
  }
  refreshBoxes();
}

function metaAt(target) {
  for (let el = target; el && el !== document.body; el = el.parentElement) if (el.__fg && el.__fg.depth >= 0) return el;
  return null;
}

function onHover(v, el) {
  if (el === v.hoverEl) return;
  v.hoverEl = el;
  refreshBoxes();
  if (!el) { setStatusDefault(); return; }
  const m = el.__fg;
  const r = el.style;
  const st = app.diff && m.top ? app.diff.get(m.top) : null;
  $('status').innerHTML = '<b>' + esc(m.chain.join(' › ')) + '</b> · ' + esc(m.tag) + (m.id ? ' · ' + esc(m.id) : '') +
    (st ? ' · <span class="c-' + st + '">' + st + '</span>' : '') +
    ' · ' + parseFloat(r.left || 0).toFixed(0) + ',' + parseFloat(r.top || 0).toFixed(0) + ' ' + parseFloat(r.width || 0).toFixed(0) + '×' + parseFloat(r.height || 0).toFixed(0) +
    (m.res ? ' · ' + esc(m.res) : '') + (m.file !== app.file ? ' · in ' + esc(m.file) : '');
}

// ------------------------------------------------------------------ toolbar

function toggle(id, key, rerender) {
  const b = $(id);
  b.classList.toggle('on', !!app.opts[key]);
  b.addEventListener('click', () => {
    app.opts[key] = !app.opts[key];
    b.classList.toggle('on', app.opts[key]);
    if (key === 'outlines') document.body.classList.toggle('outlines', app.opts.outlines);
    if (rerender) render();
  });
}
toggle('btnHidden', 'hidden', true);
toggle('btnOutlines', 'outlines', false);
toggle('btnEmpty', 'empty', true);
toggle('btnPlainGraphs', 'plainGraphs', true);
$('btnReload').addEventListener('click', () => { clearCaches(null); render(); });
$('btnCtrl').addEventListener('click', () => {
  const hidden = $('ctrlBar').classList.toggle('hidden');
  $('btnCtrl').classList.toggle('on', !hidden);
  if (app.opts.zoom === 'fit') { computeZoom(); applyZoom(); }
});
$('zoom').addEventListener('change', (e) => {
  const before = app.views.length ? app.views[0].zoomValue : 1;
  app.opts.zoom = e.target.value;
  computeZoom();
  const after = app.views.length ? app.views[0].zoomValue : 1;
  if ((after > 1 || before > 1) && Math.abs(after - before) > 0.01) render(); else applyZoom();
});
$('screen').addEventListener('change', (e) => { app.opts.screen = e.target.value; render(); });

function clearCaches(paths) {
  if (!paths) {
    textCache.clear(); imageCache.clear(); compCache.clear(); imgDone.clear(); compDone.clear();
    return;
  }
  for (const p of paths) { textCache.delete(p); imageCache.delete(p); compCache.delete(p); imgDone.delete(p); compDone.delete(p); }
}

function start(o) {
  app.file = o.file;
  app.dark = !!o.dark;
  document.body.classList.toggle('dark', app.dark);
  document.body.classList.toggle('diff', app.mode === 'diff');
  P.loaded = loadProject().catch((e) => { showErrors(['Cannot read the FairyGUI project: ' + (e && e.message ? e.message : e)]); throw e; });
  render();
}

// ------------------------------------------------------------------ public API

window.FguiPreview = {
  init(o) {
    app.mode = 'single';
    const v = createView(0, '');
    v.source = o.source !== undefined ? o.source : null;
    start(o);
  },
  /** o.left / o.right: { title, source (null when the file does not exist on that side), emptyText } */
  initDiff(o) {
    app.mode = 'diff';
    for (const [i, s] of [o.left, o.right].entries()) {
      const v = createView(i, s.title);
      v.source = s.source;
      v.emptyText = s.emptyText;
    }
    start(o);
  },
  setSource(text) {
    app.views[app.views.length - 1].source = text;
    render();
  },
  invalidate(paths) {
    clearCaches(paths && paths.length ? paths : null);
    render();
  },
  highlight(id) {
    select(id);
    if (id) scrollToSelected();
  },
  setDark(d) {
    app.dark = !!d;
    document.body.classList.toggle('dark', app.dark);
  },
};
