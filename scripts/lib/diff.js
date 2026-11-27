// Compares two snapshots (schema 1, see plugin/code.js) and returns a
// structured diff. Everything is matched by Figma node/style/variable ID, so a
// rename shows up as "changed", not as removed + added.

const SEP = '\u0000';

const parseVariantName = (name) =>
  String(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf('=');
      return i === -1 ? [part, ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
    });

// Non-variant component properties are keyed "Name#12:34" (stable id suffix).
const idOf = (k) => { const i = k.lastIndexOf('#'); return i === -1 ? null : k.slice(i + 1); };
const baseOf = (k) => { const i = k.lastIndexOf('#'); return i === -1 ? k : k.slice(0, i); };

// ── appearance details ───────────────────────────────────────────────────────
// Snapshot schema 2 stores, per variant, one record per layer (see plugin/code.js). When both snapshots
// have them, we can say WHAT changed in a variant, not just that its fingerprint differs.

const F = { ID: 0, PARENT: 1, NAME: 2, TYPE: 3, FILL: 4, STROKE: 5, RADIUS: 6, EFFECT: 7, LAYOUT: 8, SPACING: 9, PADDING: 10, SIZE: 11, TEXT: 12, CONTENT: 13, MISC: 14 };
const NODE_PROPS = [['fill', F.FILL], ['stroke', F.STROKE], ['radius', F.RADIUS], ['effect', F.EFFECT], ['layout', F.LAYOUT],
  ['spacing', F.SPACING], ['padding', F.PADDING], ['size', F.SIZE], ['text', F.TEXT], ['content', F.CONTENT]];
const PROP_ORDER = ['name', 'fill', 'stroke', 'radius', 'effect', 'layout', 'spacing', 'padding', 'size', 'text', 'content',
  'opacity', 'visibility', 'instance'];
const MAX_APPEARANCE_LINES = 40;  // kept per component in the entry
const MAX_NAMES_PER_LINE = 12;    // variant names kept per line

const str = (snap, i) => (snap.strings && snap.strings[i]) || '';
const hasDetails = (snap, nodes) => Array.isArray(nodes) && Array.isArray(snap.strings);

function parseMisc(s) {
  const o = {};
  if (s) s.split(';').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1); });
  return o;
}

function parseNodes(snap, nodes) {
  return nodes.map((r) => ({
    id: r[F.ID], parent: r[F.PARENT], name: str(snap, r[F.NAME]), type: str(snap, r[F.TYPE]),
    p: Object.fromEntries(NODE_PROPS.map(([k, i]) => [k, str(snap, r[i])])),
    misc: parseMisc(str(snap, r[F.MISC])),
  }));
}

// Styles and variables are stored as ids; their names (and, for colors, their values) come from the
// tables of the snapshot being read — so a renamed style is not a change to the layers that use it,
// but a layer that points to a different style is, and both styles are shown with their colors.
function styleLabel(snap, id) {
  const st = (snap.styles || {})[id];
  if (!st) return '(external style)';
  return st.t === 'paint' && st.v && st.v !== 'none' ? `${st.n} (${st.v})` : st.n;
}
function variableLabel(snap, id) {
  const v = (snap.variables || {})[id];
  if (!v) return '(external variable)';
  const first = v.v && Object.values(v.v)[0];
  return `${v.c} / ${v.n}` + (v.t === 'COLOR' && first && /^#[0-9A-Fa-f]{6}/.test(first) ? ` (${first})` : '');
}
function refLabel(snap, tok) {
  if (tok.startsWith('s=')) return styleLabel(snap, tok.slice(2));
  if (tok.startsWith('v=')) return variableLabel(snap, tok.slice(2));
  const m = /^(#[0-9A-Fa-f]{6})@([\d.]+)$/.exec(tok);
  if (m) return `${m[1]} (${Math.round(parseFloat(m[2]) * 100)}%)`;
  return tok;
}
const refs = (snap, s) => s.split('+').map((t) => refLabel(snap, t)).join(' + ');
const compName = (snap, id) => (((snap.components || {})[id] || {}).n) || '(component)';

function valueLabel(prop, raw, snap) {
  if (raw === '' || raw === undefined) return '—';
  switch (prop) {
    case 'fill': case 'effect': return refs(snap, raw);
    case 'stroke': {
      const [paint, w] = raw.split(';w=');
      const p = paint ? refs(snap, paint) : 'none';
      return w ? `${p}, ${w}${w.includes(',') ? ' (top,right,bottom,left)' : 'px'}` : p;
    }
    case 'text': return raw.startsWith('s=') ? refLabel(snap, raw) : raw;
    case 'content': return raw.startsWith('v=') ? refLabel(snap, raw) : `“${raw}”`;
    case 'radius': case 'spacing': case 'padding':
      return raw.split(/([ ,])/).map((t) => (t.startsWith('v=') ? variableLabel(snap, t.slice(2)) : t)).join('');
    default: return raw;
  }
}

function layerPath(list, i, snap) {
  const parts = [];
  for (let k = i; k >= 0 && list[k].parent !== -1; k = list[k].parent) {
    const n = list[k];
    parts.unshift(n.type === 'INSTANCE' ? '↳ ' + compName(snap, n.misc.c) : (n.name || n.type.toLowerCase()));
  }
  return parts.length ? parts.join(' › ') : '(variant)';
}

function miscChanges(an, bn, L, B) {
  const out = [];
  const keys = new Set([...Object.keys(an.misc), ...Object.keys(bn.misc)]);
  for (const k of keys) {
    const x = an.misc[k];
    const y = bn.misc[k];
    if (x === y) continue;
    if (k === 'opacity') out.push({ prop: 'opacity', from: x === undefined ? '100%' : Math.round(parseFloat(x) * 100) + '%', to: y === undefined ? '100%' : Math.round(parseFloat(y) * 100) + '%' });
    else if (k === 'hidden') out.push({ prop: 'visibility', from: x ? 'Hidden' : 'Visible', to: y ? 'Hidden' : 'Visible' });
    else if (k === 'c') out.push({ prop: 'instance', from: x ? compName(L, x) : '—', to: y ? compName(B, y) : '—' });
    else if (k.startsWith('b:')) out.push({ prop: 'binding:' + k.slice(2), from: x ? variableLabel(L, x) : '—', to: y ? variableLabel(B, y) : '—' });
  }
  return out;
}

// All differences between one variant in the library and the same variant in the branch.
// Returns null when the layers can't be matched up (most ids differ), so we don't print noise.
function diffVariantDetails(aRaw, bRaw, L, B) {
  const A = parseNodes(L, aRaw);
  const Bn = parseNodes(B, bRaw);
  const aIdx = new Map(A.map((n, i) => [n.id, i]));
  const bIdx = new Map(Bn.map((n, i) => [n.id, i]));
  let matched = 0;
  const changes = [];

  Bn.forEach((bn, bi) => {
    const ai = aIdx.get(bn.id);
    if (ai === undefined) return;
    matched++;
    const an = A[ai];
    const layer = layerPath(Bn, bi, B);
    if (bn.parent !== -1 && bn.type !== 'INSTANCE' && an.name !== bn.name) changes.push({ layer, prop: 'name', from: an.name || '—', to: bn.name || '—' });
    for (const [prop] of NODE_PROPS) {
      if (an.p[prop] !== bn.p[prop]) {
        let from = valueLabel(prop, an.p[prop], L);
        const to = valueLabel(prop, bn.p[prop], B);
        if (from === to) from = `${from} (other)`;   // two different styles with the same name and value
        changes.push({ layer, prop, from, to });
      }
    }
    miscChanges(an, bn, L, B).forEach((m) => changes.push({ layer, ...m }));
  });

  const total = Math.max(A.length, Bn.length);
  if (total > 4 && (total - matched) / total > 0.5) return null;

  // Layers added / removed — only the topmost of an added or removed subtree
  Bn.forEach((bn, bi) => {
    if (aIdx.has(bn.id) || bn.parent === -1) return;
    if (!aIdx.has(Bn[bn.parent].id)) return;
    changes.push({ layer: layerPath(Bn, bi, B), prop: 'layer-added', from: '', to: bn.type.toLowerCase() });
  });
  A.forEach((an, ai) => {
    if (bIdx.has(an.id) || an.parent === -1) return;
    if (!bIdx.has(A[an.parent].id)) return;
    changes.push({ layer: layerPath(A, ai, L), prop: 'layer-removed', from: an.type.toLowerCase(), to: '' });
  });
  return changes;
}

const shortVariant = (name) => parseVariantName(name).map(([, v]) => v).filter(Boolean).join(' · ') || name;

// Groups the same change across variants: "Fill of Label: A → B in 6 of 10 variants".
function appearanceDetails(pairs, totalVariants, L, B) {
  const groups = new Map();
  let unexplained = 0;
  for (const p of pairs) {
    const ch = diffVariantDetails(p.aNodes, p.bNodes, L, B);
    if (!ch || !ch.length) { unexplained++; continue; }
    for (const c of ch) {
      const key = [c.layer, c.prop, c.from, c.to].join(SEP);
      if (!groups.has(key)) groups.set(key, { layer: c.layer, prop: c.prop, from: c.from, to: c.to, ids: new Set(), names: [] });
      const g = groups.get(key);
      if (!g.ids.has(p.vid)) { g.ids.add(p.vid); g.names.push(shortVariant(p.name)); }
    }
  }
  const order = (p) => { const i = PROP_ORDER.indexOf(p); return i === -1 ? 50 : i; };
  const lines = [...groups.values()]
    .map((g) => ({ layer: g.layer, prop: g.prop, from: g.from, to: g.to, variants: g.ids.size, total: totalVariants, names: g.names.slice(0, MAX_NAMES_PER_LINE) }))
    .sort((x, y) => y.variants - x.variants || order(x.prop) - order(y.prop) || x.layer.localeCompare(y.layer));
  return { lines: lines.slice(0, MAX_APPEARANCE_LINES), more: Math.max(0, lines.length - MAX_APPEARANCE_LINES), unexplained };
}

function diffComponent(id, a, b, ctx) {
  const d = {
    id,
    page: b.pg,
    name: b.n,
    oldName: a.n !== b.n ? a.n : null,
    description: (a.d || '') !== (b.d || '') ? { from: a.d || '', to: b.d || '' } : null,
    moved: a.pg !== b.pg ? { from: a.pg, to: b.pg } : null,
    propRenames: [], valueRenames: [],
    propsAdded: [], propsRemoved: [],
    valuesAdded: [], valuesRemoved: [],
    defaultsChanged: [],
    variantsAdded: 0, variantsRemoved: 0,
    visual: null,
  };

  const A = a.p || {};
  const B = b.p || {};
  const avs = new Map((a.vs || []).map((v) => [v[0], v]));
  const bvs = new Map((b.vs || []).map((v) => [v[0], v]));
  const propRen = new Map();
  const valRen = new Map();
  let common = 0;
  let changedVisual = 0;
  const changedPairs = [];

  // 1) Variants matched by node id. The property order inside a variant name
  //    ("Type=Text, State=Default") is stable, so equal-length names are paired
  //    by position: a different key = property rename, a different value = value rename.
  for (const [vid, bv] of bvs) {
    const av = avs.get(vid);
    if (!av) { d.variantsAdded++; continue; }
    common++;
    if (av[2] !== bv[2]) {
      changedVisual++;
      changedPairs.push({ vid, name: bv[1], aNodes: av[3], bNodes: bv[3] });
    }
    if (av[1] !== bv[1]) {
      const ap = parseVariantName(av[1]);
      const bp = parseVariantName(bv[1]);
      if (ap.length === bp.length) {
        ap.forEach(([ak, avl], i) => {
          const [bk, bvl] = bp[i];
          if (ak !== bk) propRen.set(ak + SEP + bk, { from: ak, to: bk });
          if (avl !== bvl) valRen.set(bk + SEP + avl + SEP + bvl, { property: bk, from: avl, to: bvl });
        });
      }
    }
  }
  for (const vid of avs.keys()) if (!bvs.has(vid)) d.variantsRemoved++;

  if (avs.size || bvs.size) {
    if (changedVisual) d.visual = { changed: changedVisual, total: common };
  } else if (a.vh !== b.vh) {
    d.visual = { changed: 1, total: 1 };
    changedPairs.push({ vid: id, name: b.n, aNodes: a.nd, bNodes: b.nd });
  }

  // What changed inside those variants — only when both snapshots carry layer details.
  if (d.visual && ctx && changedPairs.length && changedPairs.every((p) => hasDetails(ctx.L, p.aNodes) && hasDetails(ctx.B, p.bNodes))) {
    const det = appearanceDetails(changedPairs, d.visual.total, ctx.L, ctx.B);
    d.appearance = det.lines;
    if (det.more) d.appearanceMore = det.more;
    if (det.unexplained) d.appearanceUnexplained = det.unexplained;
    d.appearanceVariants = changedPairs.map((p) => p.name);
  }

  const renameMap = {};
  propRen.forEach((r) => { renameMap[r.from] = r.to; });
  const valMap = {};
  valRen.forEach((v) => { valMap[v.property + SEP + v.from] = v.to; });

  // 2) Non-variant properties: stable id suffix.
  const collect = (defs) => {
    const m = {};
    for (const [k, v] of Object.entries(defs)) if (v.t !== 'VARIANT' && idOf(k)) m[idOf(k)] = { name: baseOf(k), def: v };
    return m;
  };
  const an = collect(A);
  const bn = collect(B);
  for (const [pid, bp] of Object.entries(bn)) {
    const ap = an[pid];
    if (!ap) { d.propsAdded.push(bp.name); continue; }
    if (ap.name !== bp.name) propRen.set(ap.name + SEP + bp.name, { from: ap.name, to: bp.name });
    if (String(ap.def.dv) !== String(bp.def.dv)) {
      d.defaultsChanged.push({ property: bp.name, from: String(ap.def.dv), to: String(bp.def.dv) });
    }
  }
  for (const [pid, ap] of Object.entries(an)) if (!bn[pid]) d.propsRemoved.push(ap.name);

  // 3) Variant properties (no stable id): match by (renamed) name and compare options.
  const aVar = Object.entries(A).filter(([, v]) => v.t === 'VARIANT');
  const bVar = Object.fromEntries(Object.entries(B).filter(([, v]) => v.t === 'VARIANT'));
  const matched = new Set();
  for (const [name, def] of aVar) {
    const nn = renameMap[name] || name;
    const bd = bVar[nn];
    if (!bd) { d.propsRemoved.push(name); continue; }
    matched.add(nn);
    const oldOpts = def.o || [];
    const newOpts = bd.o || [];
    const mapped = oldOpts.map((o) => valMap[nn + SEP + o] ?? o);
    const newSet = new Set(newOpts);
    const oldSet = new Set(mapped);
    newOpts.forEach((o) => { if (!oldSet.has(o)) d.valuesAdded.push({ property: nn, value: o }); });
    mapped.forEach((o, i) => { if (!newSet.has(o)) d.valuesRemoved.push({ property: nn, value: oldOpts[i] }); });
    const oldDefault = valMap[nn + SEP + def.dv] ?? def.dv;
    if (oldDefault !== bd.dv) d.defaultsChanged.push({ property: nn, from: def.dv, to: bd.dv });
  }
  for (const name of Object.keys(bVar)) if (!matched.has(name)) d.propsAdded.push(name);

  d.propRenames = [...propRen.values()];
  d.valueRenames = [...valRen.values()];
  return d;
}

const hasPropertyChange = (d) =>
  d.propRenames.length || d.valueRenames.length || d.propsAdded.length || d.propsRemoved.length ||
  d.valuesAdded.length || d.valuesRemoved.length || d.defaultsChanged.length;

const isChanged = (d) =>
  d.oldName || d.description || d.moved || hasPropertyChange(d) || d.variantsAdded || d.variantsRemoved || d.visual;

// True if component `a` (library) still differs from `b` (branch) in anything we track.
export function componentChanged(id, a, b) {
  return Boolean(isChanged(diffComponent(id, a, b)));
}

function diffComponents(L, B, ctx) {
  const added = [], removed = [], changed = [];
  for (const [id, b] of Object.entries(B)) {
    const a = L[id];
    if (!a) { added.push({ id, name: b.n, page: b.pg }); continue; }
    const d = diffComponent(id, a, b, ctx);
    if (isChanged(d)) changed.push(d);
  }
  for (const [id, a] of Object.entries(L)) if (!B[id]) removed.push({ id, name: a.n, page: a.pg });
  const byName = (x, y) => x.name.localeCompare(y.name);
  return { added: added.sort(byName), removed: removed.sort(byName), changed: changed.sort(byName) };
}

function diffStyles(L, B) {
  const added = [], removed = [], changed = [];
  for (const [id, b] of Object.entries(B)) {
    const a = L[id];
    if (!a) { added.push({ id, type: b.t, name: b.n, value: b.v }); continue; }
    const c = {
      id, type: b.t, name: b.n,
      oldName: a.n !== b.n ? a.n : null,
      description: (a.d || '') !== (b.d || '') ? { from: a.d || '', to: b.d || '' } : null,
      value: a.v !== b.v ? { from: a.v, to: b.v } : null,
    };
    if (c.oldName || c.description || c.value) changed.push(c);
  }
  for (const [id, a] of Object.entries(L)) if (!B[id]) removed.push({ id, type: a.t, name: a.n, value: a.v });
  const byName = (x, y) => x.name.localeCompare(y.name);
  return { added: added.sort(byName), removed: removed.sort(byName), changed: changed.sort(byName) };
}

function diffVariables(L, B) {
  const added = [], removed = [], changed = [];
  for (const [id, b] of Object.entries(B)) {
    const a = L[id];
    if (!a) { added.push({ id, collection: b.c, name: b.n, type: b.t, values: b.v }); continue; }
    const modes = new Set([...Object.keys(a.v || {}), ...Object.keys(b.v || {})]);
    const values = [];
    modes.forEach((m) => {
      const from = (a.v || {})[m];
      const to = (b.v || {})[m];
      if (from !== to) values.push({ mode: m, from: from ?? '—', to: to ?? '—' });
    });
    const c = {
      id, collection: b.c, name: b.n, type: b.t,
      oldName: a.n !== b.n ? a.n : null,
      oldCollection: a.c !== b.c ? a.c : null,
      description: (a.d || '') !== (b.d || '') ? { from: a.d || '', to: b.d || '' } : null,
      values,
    };
    if (c.oldName || c.oldCollection || c.description || values.length) changed.push(c);
  }
  for (const [id, a] of Object.entries(L)) if (!B[id]) removed.push({ id, collection: a.c, name: a.n, type: a.t, values: a.v });
  const byName = (x, y) => (x.collection + x.name).localeCompare(y.collection + y.name);
  return { added: added.sort(byName), removed: removed.sort(byName), changed: changed.sort(byName) };
}

function diffPages(L = {}, B = {}) {
  const added = [], removed = [], renamed = [];
  for (const [id, name] of Object.entries(B)) {
    if (!(id in L)) added.push({ id, name });
    else if (L[id] !== name) renamed.push({ id, name, oldName: L[id] });
  }
  for (const [id, name] of Object.entries(L)) if (!(id in B)) removed.push({ id, name });
  return { added, removed, renamed };
}

export function compareSnapshots(library, branch) {
  const components = diffComponents(library.components || {}, branch.components || {}, { L: library, B: branch });
  const styles = diffStyles(library.styles || {}, branch.styles || {});
  const variables = diffVariables(library.variables || {}, branch.variables || {});
  const pages = diffPages(library.pages, branch.pages);

  const ch = components.changed;
  const cs = {
    library: Object.keys(library.components || {}).length,
    branch: Object.keys(branch.components || {}).length,
    added: components.added.length,
    removed: components.removed.length,
    affected: ch.length,
    renamed: ch.filter((d) => d.oldName).length,
    propertyChanges: ch.filter(hasPropertyChange).length,
    visualChanges: ch.filter((d) => d.visual).length,
    descriptionChanges: ch.filter((d) => d.description).length,
    moved: ch.filter((d) => d.moved).length,
  };
  const sumOf = (obj, lib, br) => ({
    library: Object.keys(lib || {}).length,
    branch: Object.keys(br || {}).length,
    added: obj.added.length,
    removed: obj.removed.length,
    changed: obj.changed.length,
  });
  const ss = sumOf(styles, library.styles, branch.styles);
  ss.valueChanges = styles.changed.filter((s) => s.value).length;
  const vs = sumOf(variables, library.variables, branch.variables);
  vs.valueChanges = variables.changed.filter((v) => v.values.length).length;
  const ps = { added: pages.added.length, removed: pages.removed.length, renamed: pages.renamed.length };

  const namingOnly =
    cs.visualChanges === 0 && cs.added === 0 && cs.removed === 0 && cs.descriptionChanges === 0 &&
    ss.added === 0 && ss.removed === 0 && ss.valueChanges === 0 &&
    vs.added === 0 && vs.removed === 0 && vs.valueChanges === 0 &&
    ps.added === 0 && ps.removed === 0;

  return {
    pages, styles, variables, components,
    summary: { components: cs, styles: ss, variables: vs, pages: ps, namingOnly },
  };
}
