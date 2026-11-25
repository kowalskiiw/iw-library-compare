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

function diffComponent(id, a, b) {
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

  // 1) Variants matched by node id. The property order inside a variant name
  //    ("Type=Text, State=Default") is stable, so equal-length names are paired
  //    by position: a different key = property rename, a different value = value rename.
  for (const [vid, bv] of bvs) {
    const av = avs.get(vid);
    if (!av) { d.variantsAdded++; continue; }
    common++;
    if (av[2] !== bv[2]) changedVisual++;
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

function diffComponents(L, B) {
  const added = [], removed = [], changed = [];
  for (const [id, b] of Object.entries(B)) {
    const a = L[id];
    if (!a) { added.push({ id, name: b.n, page: b.pg }); continue; }
    const d = diffComponent(id, a, b);
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
  const components = diffComponents(library.components || {}, branch.components || {});
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
