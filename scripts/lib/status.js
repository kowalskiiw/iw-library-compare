// Merge status of a comparison entry.
//
// An entry is "merged" when everything it touched is now in the library, i.e.
// for every element of the original diff (matched by ID):
//   changed / added  → the library contains it and it equals the branch's version
//   removed          → the library no longer contains it
// Only the elements of the entry are checked, so unrelated library changes
// made in the meantime don't keep an entry "in review".

import { componentChanged } from './diff.js';

export function evaluateStatus(entry, library, branch) {
  const L = library;
  const B = branch;
  const pending = [];
  let total = 0;
  let done = 0;
  const check = (kind, id, name, ok) => {
    total++;
    if (ok) done++; else pending.push({ kind, id, name });
  };

  const sameStyle = (a, b) => Boolean(a && b) && a.n === b.n && (a.d || '') === (b.d || '') && a.v === b.v;
  const sameVar = (a, b) =>
    Boolean(a && b) && a.n === b.n && a.c === b.c && (a.d || '') === (b.d || '') && JSON.stringify(a.v) === JSON.stringify(b.v);

  const LC = L.components || {}, BC = B.components || {};
  for (const c of [...entry.components.changed, ...entry.components.added]) {
    check('component', c.id, c.name, Boolean(LC[c.id] && BC[c.id]) && !componentChanged(c.id, LC[c.id], BC[c.id]));
  }
  for (const c of entry.components.removed) check('component', c.id, c.name, !LC[c.id]);

  const LS = L.styles || {}, BS = B.styles || {};
  for (const s of [...entry.styles.changed, ...entry.styles.added]) check('style', s.id, s.name, sameStyle(LS[s.id], BS[s.id]));
  for (const s of entry.styles.removed) check('style', s.id, s.name, !LS[s.id]);

  const LV = L.variables || {}, BV = B.variables || {};
  for (const v of [...entry.variables.changed, ...entry.variables.added]) check('variable', v.id, v.name, sameVar(LV[v.id], BV[v.id]));
  for (const v of entry.variables.removed) check('variable', v.id, v.name, !LV[v.id]);

  const LP = L.pages || {}, BP = B.pages || {};
  for (const p of [...entry.pages.renamed, ...entry.pages.added]) check('page', p.id, p.name, LP[p.id] !== undefined && LP[p.id] === BP[p.id]);
  for (const p of entry.pages.removed) check('page', p.id, p.name, !(p.id in LP));

  return { done, total, pending };
}

// Sets entry.status ('in-review' | 'merged') and entry.statusInfo.
export function applyStatus(entry, library, branch, previous, now = new Date().toISOString()) {
  const r = evaluateStatus(entry, library, branch);
  const merged = r.total === 0 || r.done === r.total;
  const prevMergedAt = previous && previous.statusInfo && previous.statusInfo.mergedAt;
  entry.status = merged ? 'merged' : 'in-review';
  entry.statusInfo = {
    checkedAt: now,
    librarySnapshotAt: (library.meta || {}).takenAt || null,
    done: r.done,
    total: r.total,
    pendingCount: r.pending.length,
    pending: r.pending.slice(0, 15),
    // null + merged means "nothing to merge: the library already matched the branch"
    mergedAt: merged ? (prevMergedAt || (r.total === 0 ? null : now)) : null,
  };
  return entry;
}
