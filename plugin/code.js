// IW Library Compare — main thread.
// Builds a snapshot of the file that is currently open (library or branch) and
// hands it to the UI, which commits it to GitHub. The GitHub Action does the
// diffing, the Confluence page and the changelog entry.
//
// Snapshot schema 1 (everything keyed by Figma ID, so renames are detectable):
//   meta        { kind, fileName, takenAt, branchUrl?, branchKey?, ticket?, title? }
//   pages       { pageId: name }
//   styles      { styleId: { t: paint|text|effect|grid, n: name, d: description, v: readable value } }
//   variables   { varId: { c: collection, n: name, t: type, d: description, v: { mode: value } } }
//   components  { nodeId: { n, d, pg: page, k: set|component,
//                           p: { propKey: { t: type, dv: default, o?: options } },
//                           vs: [[variantId, variantName, appearanceHash]],   // sets
//                           vh: appearanceHash } }                            // standalone

figma.showUI(__html__, { width: 400, height: 680 });

const SETTINGS_KEY = 'iw-library-compare-settings';
const DEFAULTS = { owner: '', repo: '', branch: 'main', githubToken: '' };

const say = (text, ok = null) => figma.ui.postMessage({ type: 'status', text, ok });
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── helpers ──────────────────────────────────────────────────────────────────

const r3 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
const mx = (v) => (typeof v === 'symbol' ? 'mixed' : v);

function hash(str) {
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193);
    h2 = (Math.imul(h2, 33) + c) | 0;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function hex(c, a) {
  const h = '#' + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  return a !== undefined && a < 1 ? `${h} (${Math.round(a * 100)}%)` : h;
}

// ── styles ───────────────────────────────────────────────────────────────────

function paintsValue(paints) {
  const v = paints.filter((p) => p.visible !== false).map((p) => {
    if (p.type === 'SOLID') return hex(p.color, p.opacity);
    if (p.type.indexOf('GRADIENT') === 0) {
      return p.type.toLowerCase().replace('_', ' ') + ' [' + p.gradientStops.map((s) => hex(s.color, s.color.a)).join(' → ') + ']';
    }
    return p.type.toLowerCase();
  });
  return v.join(' + ') || 'none';
}

const unitValue = (x) => (x.unit === 'AUTO' ? 'auto' : r3(x.value) + (x.unit === 'PERCENT' ? '%' : 'px'));

function textValue(s) {
  return `${s.fontName.family} ${s.fontName.style} · ${r3(s.fontSize)}px · lh ${unitValue(s.lineHeight)} · ls ${unitValue(s.letterSpacing)}`;
}

function effectsValue(effects) {
  return effects.map((e) =>
    `${e.type.toLowerCase().replace('_', ' ')} ${r3(e.radius)}` +
    (e.offset ? ` @${r3(e.offset.x)}/${r3(e.offset.y)}` : '') +
    (e.color ? ' ' + hex(e.color, e.color.a) : '')
  ).join(' | ') || 'none';
}

function gridsValue(grids) {
  return grids.map((g) =>
    `${g.pattern.toLowerCase()} count:${g.count === undefined ? '-' : g.count} size:${g.sectionSize === undefined ? '-' : r3(g.sectionSize)} gutter:${g.gutterSize === undefined ? '-' : r3(g.gutterSize)}`
  ).join(' | ') || 'none';
}

async function collectStyles() {
  const out = {};
  for (const s of await figma.getLocalPaintStylesAsync()) out[s.id] = { t: 'paint', n: s.name, d: s.description || '', v: paintsValue(s.paints) };
  for (const s of await figma.getLocalTextStylesAsync()) out[s.id] = { t: 'text', n: s.name, d: s.description || '', v: textValue(s) };
  for (const s of await figma.getLocalEffectStylesAsync()) out[s.id] = { t: 'effect', n: s.name, d: s.description || '', v: effectsValue(s.effects) };
  for (const s of await figma.getLocalGridStylesAsync()) out[s.id] = { t: 'grid', n: s.name, d: s.description || '', v: gridsValue(s.layoutGrids) };
  return out;
}

// ── variables ────────────────────────────────────────────────────────────────

async function collectVariables() {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const names = {};
  const items = [];
  for (const c of cols) {
    for (const id of c.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) continue;
      names[id] = `${c.name} / ${v.name}`;
      items.push({ c, v });
    }
  }
  const fmt = async (x, type) => {
    if (x === undefined) return '';
    if (x && typeof x === 'object' && x.type === 'VARIABLE_ALIAS') {
      if (names[x.id]) return '→ ' + names[x.id];
      const t = await figma.variables.getVariableByIdAsync(x.id);
      return '→ ' + (t ? t.name : x.id);
    }
    if (type === 'COLOR' && x && typeof x === 'object') return hex(x, x.a);
    return String(typeof x === 'number' ? r3(x) : x);
  };
  const out = {};
  for (const { c, v } of items) {
    const vals = {};
    for (const m of c.modes) vals[m.name] = await fmt(v.valuesByMode[m.modeId], v.resolvedType);
    out[v.id] = { c: c.name, n: v.name, t: v.resolvedType, d: v.description || '', v: vals };
  }
  return out;
}

// ── components ───────────────────────────────────────────────────────────────

const NAMELESS = { COMPONENT_SET: 1, COMPONENT: 1, INSTANCE: 1 };

const paintSig = (ps) => (ps === undefined ? '' : typeof ps === 'symbol' ? 'mixed' : JSON.stringify(ps.map((p) => [
  p.type, p.visible, r3(p.opacity),
  p.color ? [r3(p.color.r), r3(p.color.g), r3(p.color.b)] : null,
  p.boundVariables && p.boundVariables.color ? p.boundVariables.color.id : null,
])));

// Appearance fingerprint of one node. Component/instance NAMES are left out on
// purpose (so renames don't count as visual changes); instances contribute the
// id of the component they point to instead of their (mirrored) name.
async function nodeSig(n) {
  const p = [n.type];
  if (n.type === 'INSTANCE') {
    let m = '';
    try { const mc = await n.getMainComponentAsync(); m = mc ? mc.id : ''; } catch (e) { /* ignore */ }
    p.push(m, n.visible, r3(n.opacity), r3(n.width), r3(n.height));
    return p.join('|');
  }
  p.push(NAMELESS[n.type] ? '' : n.name, n.visible, r3(n.opacity));
  if ('fills' in n) p.push(paintSig(n.fills));
  if ('strokes' in n) p.push(paintSig(n.strokes), mx(n.strokeWeight));
  if ('cornerRadius' in n) p.push(mx(n.cornerRadius));
  if ('effects' in n) {
    p.push(JSON.stringify(n.effects.map((e) => [e.type, e.visible, r3(e.radius), r3(e.spread),
      e.offset ? [r3(e.offset.x), r3(e.offset.y)] : null,
      e.color ? [r3(e.color.r), r3(e.color.g), r3(e.color.b), r3(e.color.a)] : null])));
  }
  if ('layoutMode' in n) {
    p.push(n.layoutMode, r3(n.itemSpacing), r3(n.paddingLeft), r3(n.paddingRight), r3(n.paddingTop), r3(n.paddingBottom),
      n.layoutSizingHorizontal, n.layoutSizingVertical, n.primaryAxisAlignItems, n.counterAxisAlignItems);
  }
  p.push(r3(n.width), r3(n.height));
  if (n.type === 'TEXT') {
    p.push(n.characters, mx(n.fontSize), JSON.stringify(mx(n.fontName)), JSON.stringify(mx(n.lineHeight)), mx(n.letterSpacing), mx(n.textStyleId));
  }
  if ('fillStyleId' in n) p.push(mx(n.fillStyleId));
  if ('strokeStyleId' in n) p.push(mx(n.strokeStyleId));
  if ('effectStyleId' in n) p.push(mx(n.effectStyleId));
  if (n.boundVariables) p.push(JSON.stringify(n.boundVariables));
  return p.join('|');
}

async function walkSig(n, acc) {
  acc.push(await nodeSig(n));
  if (n.type !== 'INSTANCE' && 'children' in n) for (const c of n.children) await walkSig(c, acc);
}

async function visualHash(node) {
  const acc = [];
  await walkSig(node, acc);
  return hash(acc.join('\n'));
}

function pageNameOf(n) {
  let p = n;
  while (p && p.type !== 'PAGE') p = p.parent;
  return p ? p.name : '?';
}

function propDefs(node) {
  const out = {};
  const defs = node.componentPropertyDefinitions || {};
  for (const k of Object.keys(defs)) {
    const d = defs[k];
    const e = { t: d.type, dv: typeof d.defaultValue === 'boolean' ? String(d.defaultValue) : d.defaultValue };
    if (d.type === 'VARIANT') e.o = d.variantOptions || [];
    out[k] = e;
  }
  return out;
}

async function collectComponents() {
  const all = figma.root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })
    .filter((n) => !(n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET'));
  const out = {};
  let i = 0;
  for (const n of all) {
    i++;
    if (i % 20 === 0) { say(`Reading components… ${i} / ${all.length}`); await tick(); }
    const entry = { n: n.name, d: n.description || '', pg: pageNameOf(n), k: n.type === 'COMPONENT_SET' ? 'set' : 'component', p: propDefs(n), vs: [] };
    if (n.type === 'COMPONENT_SET') {
      for (const v of n.children) {
        if (v.type !== 'COMPONENT') continue;
        entry.vs.push([v.id, v.name, await visualHash(v)]);
      }
    } else {
      entry.vh = await visualHash(n);
    }
    out[n.id] = entry;
  }
  return out;
}

// ── snapshot ─────────────────────────────────────────────────────────────────

async function buildSnapshot(kind, extraMeta) {
  say('Loading all pages… (large libraries take a moment)');
  await figma.loadAllPagesAsync();
  const pages = {};
  for (const p of figma.root.children) pages[p.id] = p.name;
  say('Reading styles…');
  const styles = await collectStyles();
  say('Reading variables…');
  const variables = await collectVariables();
  const components = await collectComponents();
  return {
    schema: 1,
    meta: Object.assign({ kind, fileName: figma.root.name, takenAt: new Date().toISOString() }, extraMeta || {}),
    pages, styles, variables, components,
  };
}

// ── messages ─────────────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'get-settings') {
      const s = await figma.clientStorage.getAsync(SETTINGS_KEY);
      figma.ui.postMessage({ type: 'settings', settings: Object.assign({}, DEFAULTS, s || {}), fileName: figma.root.name });
    } else if (msg.type === 'save-settings') {
      await figma.clientStorage.setAsync(SETTINGS_KEY, msg.settings);
      say('Settings saved.', true);
    } else if (msg.type === 'build-snapshot') {
      const snapshot = await buildSnapshot(msg.kind, msg.meta);
      const n = (o) => Object.keys(o).length;
      say(`Snapshot ready: ${n(snapshot.components)} components, ${n(snapshot.styles)} styles, ${n(snapshot.variables)} variables.`);
      figma.ui.postMessage({ type: 'snapshot', kind: msg.kind, snapshot });
    }
  } catch (err) {
    figma.ui.postMessage({ type: 'error', text: String((err && err.message) || err) });
  }
};
