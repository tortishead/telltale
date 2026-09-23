/* ---------------- one surface, three dumps ---------------- */

/* A window on screen is described three times over, by three services that
   never compare notes. `dumpsys window` says where the policy put it and
   whether it believes it is showing. SurfaceFlinger says what was actually
   composited — the alpha it was drawn at, where the layer really is, what it
   is stacked against. `dumpsys input` says what the dispatcher will hit-test,
   in its own z order, with its own idea of the frame.

   Nearly every "why is my window not there" bug is one of those three
   disagreeing with another, and reading it meant opening three tabs and
   holding a rect in your head. This puts them in one table and says where they
   differ.

   Which readers those are is not known here: a reader says `surface: true` in
   its TOOLS entry, the way it says what its nodes are called and how they are
   laid out. What is known is that their nodes are named the same thing, and
   that the three services spell that name differently — a layer carries its
   layer id on the end, an input window its handle on the front. */

const surfaceName = (node) => String((node && node.title) || '')
  .replace(/#\d+\s*$/, '')
  .replace(/^[0-9a-f]{6,16}\s+/, '')
  .trim();

const surfaceKey = (node) => surfaceName(node).toLowerCase();

/* One reading per reader, of one display, off the desk. A workspace holds a
   bugreport read sixteen ways as readily as three dumps pasted one at a time,
   and as readily as two bugreports — which is what a before-and-after desk is.
   So a reader's reading is taken from the same file as the thing being read
   where there is one, and otherwise only where that reader was read once: a
   window from yesterday is never diffed against a layer from today, and three
   files pasted separately still come out as three columns. */
function surfaceSides(displayId, self){
  const byTool = new Map();
  for(const doc of S.docs){
    for(const entry of doc.found){
      if(!entry.tool.surface) continue;
      const display = entry.scene.displays.find(d => d.id === displayId);
      if(!display) continue;
      if(!byTool.has(entry.tool.id)) byTool.set(entry.tool.id, []);
      byTool.get(entry.tool.id).push({ doc, entry, display });
    }
  }
  const out = [];
  for(const group of byTool.values()){
    const same = self && group.find(s => s.doc.label === self.label && s.doc.from === self.from);
    if(same) out.push(same);
    else if(group.length === 1) out.push(group[0]);
  }
  /* Left to right in the order the readers are registered, which is the order
     the tabs are in and the order the stack is described in: laid out, then
     composited, then hit-tested. */
  const at = (side) => TOOLS.findIndex(t => t.id === side.entry.tool.id);
  return out.sort((a, b) => at(a) - at(b));
}

/* What each side calls the same name. The first match wins where a dump holds
   two windows of one name, and the rest are counted so the table can say the
   reading is of one of several. */
function surfaceRow(sides, key){
  return sides.map(side => {
    const hits = side.display.nodes.filter(n => surfaceKey(n) === key);
    return { ...side, node: hits[0] || null, also: Math.max(0, hits.length - 1) };
  });
}

/* ---- what the three of them say, and where they differ ---- */

const surfRect = (r) => r ? `[${r.l},${r.t}][${r.r},${r.b}]` : null;
const surfSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const surfAlpha = (a) => a === null || a === undefined ? null : +(+a).toFixed(2);

/* The fields the three of them are supposed to agree about, and how each one
   is read off a node. A reader that does not state one leaves the cell empty
   rather than claiming a default: `dumpsys window` prints no alpha, and that
   is not the same as an alpha of 1. */
const SURFACE_FIELDS = [
  { key:'frame', label:'frame', read:(n) => surfRect(n.frame), diff:true },
  { key:'visible', label:'visible', read:(n) => n.visible === null || n.visible === undefined
      ? null : !!n.visible, diff:true, show:(v) => v ? 'yes' : 'no' },
  { key:'alpha', label:'alpha', read:(n) => surfAlpha(n.alpha) },
  { key:'z', label:'z order', read:(n) => n.zRank === undefined ? null
      : `${n.zRank + 1} of ${n.zCount}`, show:(v) => v },
  { key:'touchable', label:'takes touches', read:(n) => n.touchable === null
      || n.touchable === undefined ? null : !!n.touchable, show:(v) => v ? 'yes' : 'no' },
  { key:'uid', label:'uid', read:(n) => n.uid === null || n.uid === undefined
      ? (n.ownerUid === null || n.ownerUid === undefined ? null : +n.ownerUid) : +n.uid },
  { key:'pid', label:'pid', read:(n) => n.pid === null || n.pid === undefined
      ? (n.ownerPid === null || n.ownerPid === undefined ? null : +n.ownerPid) : +n.pid },
];

/* A field disagrees when two readers that both stated it stated different
   things. A reader that said nothing is not a disagreement: most of these are
   printed by one service and not another. */
function surfaceDiffers(row, field){
  const said = row.map(r => r.node && field.read(r.node)).filter(v => v !== null && v !== undefined);
  return said.length > 1 && said.some(v => !surfSame(v, said[0]));
}

/* Where the stacking disagrees. Only windows more than one reader knows about
   are compared, and only against the one being read: what matters is what is
   in front of this window, and the services do not agree on it. Rank 0 is the
   front, so a smaller rank is above. One line per window that moved, naming
   which readers put it which side — not one line per pair of readers, which
   said the same thing three times. */
function surfaceFlips(row, key){
  const sides = row.filter(r => r.node);
  if(sides.length < 2) return [];
  const ranks = sides.map(r => {
    const m = new Map();
    for(const n of r.display.nodes){
      const k = surfaceKey(n);
      if(!m.has(k)) m.set(k, { rank:n.zRank, title:surfaceName(n) });
    }
    return m;
  });

  const names = new Set();
  for(const m of ranks) for(const k of m.keys()) names.add(k);

  const out = [];
  for(const other of names){
    if(other === key) continue;
    const says = [];
    ranks.forEach((m, i) => {
      if(!m.has(other) || !m.has(key)) return;
      says.push({ tool:sides[i].entry.tool.name, title:m.get(other).title,
                  above:m.get(other).rank < m.get(key).rank });
    });
    const above = says.filter(s => s.above), below = says.filter(s => !s.above);
    if(!above.length || !below.length) continue;
    out.push({ title:says[0].title, above:above.map(s => s.tool), below:below.map(s => s.tool) });
  }
  return out;
}

/* A list of readers, said the way a sentence says it. */
const surfList = (names) => names.length < 2 ? names[0]
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/* The findings: what a disagreement means, said once, in the words of the
   service that said it. Everything here is read off the table above rather
   than out of the dumps again, so a reading that is missing says nothing. */
const SURFACE_DIM = 0.05;    // an alpha below this is invisible to the eye

function surfaceFindings(row, key){
  const out = [];
  const said = (field) => row.filter(r => r.node)
    .map(r => ({ tool:r.entry.tool.name, value:field.read(r.node) }))
    .filter(v => v.value !== null && v.value !== undefined);

  const visible = said(SURFACE_FIELDS.find(f => f.key === 'visible'));
  const shows = visible.filter(v => v.value), hides = visible.filter(v => !v.value);
  if(shows.length && hides.length){
    out.push([`${shows.map(v => v.tool).join(' and ')} says it is showing`,
      `${hides.map(v => v.tool).join(' and ')} says it is not. Whichever is stale, `
      + `what is on the panel is what SurfaceFlinger composited and what takes a `
      + `touch is what the dispatcher holds.`]);
  }

  for(const r of row){
    const a = r.node && surfAlpha(r.node.alpha);
    if(a === null || a === undefined || a > SURFACE_DIM) continue;
    if(!shows.length) continue;
    out.push([`${r.entry.tool.name} drew it at alpha ${a}`,
      a === 0 ? 'Nothing of it reached the panel, whatever the other dumps say about it.'
              : 'It is on the panel and invisible, which is what an overlay that takes '
                + 'touches without being seen looks like.']);
  }

  /* The readers that agree about the rect are one voice, so the finding names
     the rects rather than the readers: two of them saying the same thing and a
     third saying something else is the whole shape of this bug. */
  const rects = new Map();
  for(const r of row){
    if(!r.node || !r.node.frame) continue;
    const at = surfRect(r.node.frame);
    if(!rects.has(at)) rects.set(at, []);
    rects.get(at).push(r.entry.tool.name);
  }
  if(rects.size > 1){
    out.push(['The frames disagree',
      [...rects].map(([at, tools]) =>
        `${esc(surfList(tools))} ${tools.length > 1 ? 'have' : 'has'} it at <code>${esc(at)}</code>`)
        .join('; ')
      + '. A touch is hit-tested against the rect the dispatcher holds, so where that '
      + 'differs from where the layer was drawn the window takes touches somewhere '
      + 'other than where it is.']);
  }

  for(const flip of surfaceFlips(row, key)){
    out.push([`<code>${esc(flip.title)}</code> is stacked either side of it`,
      `${esc(surfList(flip.above))} ${flip.above.length > 1 ? 'have' : 'has'} it above this `
      + `${esc(S.tool && S.tool.noun || 'window')}; ${esc(surfList(flip.below))} `
      + `${flip.below.length > 1 ? 'have' : 'has'} it below.`]);
  }

  return out;
}

/* ---- the card ---- */

function surfaceCard(node, display){
  if(!S.tool || !S.tool.surface || !display) return '';
  const key = surfaceKey(node);
  if(!key) return '';

  const row = surfaceRow(surfaceSides(display.id, currentDoc()), key);
  const found = row.filter(r => r.node);
  /* One reading of one window is the tab you are already looking at. */
  if(found.length < 2) return '';

  /* A column off a different file than the one being read says so: on a desk
     holding one bugreport it never fires, and on one holding three pasted
     dumps it is the only thing saying which is which. */
  const open = currentDoc();
  const head = row.map(r => `<th>${esc(r.entry.tool.name)}${
    r.also ? ` <span class="surf-also">+${r.also}</span>` : ''}${
    open && r.doc.label !== open.label
      ? `<span class="surf-also"><br>${esc(elide(r.doc.label, 20))}</span>` : ''}</th>`).join('');

  const body = SURFACE_FIELDS.map(field => {
    const cells = row.map(r => {
      const v = r.node ? field.read(r.node) : null;
      if(v === null || v === undefined) return '<td class="surf-none">—</td>';
      const text = field.show ? field.show(v) : v;
      return `<td>${esc(String(text))}</td>`;
    }).join('');
    const off = field.diff && surfaceDiffers(row, field);
    return `<tr class="${off ? 'surf-off' : ''}"><th>${esc(field.label)}${
      off ? ' <span class="surf-mark">≠</span>' : ''}</th>${cells}</tr>`;
  }).join('');

  const missing = row.filter(r => !r.node).map(r =>
    `<p class="surf-gone">No ${esc(r.entry.tool.noun || 'row')} of this name in ${
      esc(r.entry.tool.name)}. A service that renames what it is holding — the
      dispatcher and the compositor both do — looks the same from here as one
      that never had it.</p>`).join('');

  const findings = surfaceFindings(row, key).map(([title, why]) =>
    `<div class="finding"><b>${title}</b><p>${why}</p></div>`).join('');

  return foldGroup('surface', `The same ${esc(S.tool.noun || 'window')} elsewhere`,
    `<div class="doc-scroll"><table class="doc-table surf">
     <thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
     ${missing}${findings}`);
}
