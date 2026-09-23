/* ---------------- render: the sheet ---------------- */
/* One guard covers the whole of it: a list tool's sheet, legend and footer are
   out of the grid, and everything that draws is reached from here. */
function drawPlan(){
  if(S.tool.layout === 'list') return;
  if(S.tool.layout === 'doc') return renderDoc();
  /* Two views come with the page; a tool that draws something the plan and
     the stack cannot say brings its own sheet and its own line under it. */
  if(S.tool.sheet) S.tool.sheet();
  else if(S.view === 'depth') renderDepth();
  else renderFlat();
  renderLegend();
  if(S.tool.sheetFoot) $('sheetFoot').innerHTML = S.tool.sheetFoot();
  else renderSheetFoot();
}

/* ---------------- render: the reading pane ---------------- */

/* Where a drawn dump has a sheet, a dump that is a document has whatever
   section is selected, laid out to be read: the section, then everything
   printed inside it. A run of lines written to one shape becomes a table,
   because six hundred properties one to a line is not something anyone reads
   as text, and the rest is left as it was written. */
function renderDoc(){
  const sheet = $('sheet');
  const n = S.data.nodes.find(x => x.hash === S.selected);
  /* Nothing to search until there is something being read. */
  $('docSearch').hidden = !n;
  $('attrFilter').value = S.attrFilter;
  if(!n){
    sheet.innerHTML = `<div class="doc"><p class="doc-empty">Pick ${
      an(esc(S.tool.noun))} from the list to read what it printed.</p></div>`;
    return;
  }

  const out = [];
  if(n.ancestors.length){
    out.push(`<p class="doc-path">${n.ancestors
      .map(a => `<button type="button" data-hash="${esc(a.hash)}">${esc(a.title)}</button>`)
      .join(' / ')}</p>`);
  }

  const kidsOf = (hash) => S.data.nodes.filter(x => x.parentHash === hash).sort((a, b) => b.z - a.z);
  const walk = (node, depth) => {
    out.push(docSection(node, depth));
    kidsOf(node.hash).forEach(k => walk(k, depth + 1));
  };
  walk(n, 0);

  sheet.innerHTML = `<div class="doc">${out.join('')}</div>`;
  if(!S.attrFilter) sheet.scrollTop = 0;
  if(S.attrFilter && !sheet.querySelector('.doc-row, .doc-table')){
    sheet.innerHTML = `<div class="doc"><p class="doc-empty">Nothing this ${
      esc(S.tool.noun)} printed matches that.</p></div>`;
  }
}

/* The heading of a subsection selects it, which is how a service that printed
   two thousand lines is narrowed down to the part being read. */
function docSection(node, depth){
  const head = depth === 0 ? esc(node.title)
    : `<button type="button" data-hash="${esc(node.hash)}">${esc(node.title)}</button>`;
  const body = blockRuns(node.body)
    .map(run => run.kind === 'table' ? docTable(run) : docRows(node, run.lines))
    .filter(Boolean).join('');
  return `<section class="doc-sec" style="margin-left:${Math.min(depth, 4) * 14}px">
    <h3>${head}</h3>
    ${body || '<p class="doc-empty">Nothing printed here.</p>'}
  </section>`;
}

/* The search reaches the tables as well as the rows: a table is what a run of
   lines was printed as, and a line is a line. A table nothing in matches is
   not drawn at all. */
function docTable(run){
  const m = textMatcher(S.attrFilter);
  if(m){
    const rows = m.ok ? run.rows.filter(r =>
      m.test(`${r.cells.join(' ')} ${r.under.join(' ')}`.toLowerCase())) : [];
    if(!rows.length) return '';
    run = { ...run, rows };
  }
  return `<div class="doc-scroll"><table class="doc-table">
    <thead><tr>${run.keys.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead>
    <tbody>${run.rows.map(r => {
      const row = esc(r.cells.join(' '));
      return `<tr>${r.cells.map(v => `<td>${docNamed(esc(v), row)}</td>`).join('')}</tr>` +
        r.under.map(u => `<tr class="doc-under"><td colspan="${run.keys.length}"
          >${docNamed(esc(u), row + ' ' + esc(u))}</td></tr>`).join('');
    }).join('')}</tbody>
  </table></div>`;
}

/* Text keeps the shape it was printed in, less the indent the whole block
   carries: that indent is the dump's nesting, which the pane is already
   showing. Every line becomes a row — the name it printed and the value after
   it — so what a service printed can be searched and picked at instead of
   read as a wall. A row is identified by the section it is in and the line it
   is on, which is stable for as long as the dump is open. */
function docRows(node, lines){
  const m = textMatcher(S.attrFilter);
  const q = m ? S.attrFilter.trim() : '';
  const hit = (e) => !m || (m.ok && m.test(`${e.key} ${e.value || ''}`.toLowerCase()));
  const under = (e) => e.children.reduce((sum, c) => sum + 1 + under(c), 0);
  /* A row whose child matched is kept as the way in to it, and marked so it
     does not read as a match of its own. */
  const keep = (e) => hit(e) || e.children.some(keep);

  const out = [];
  const walk = (e, depth) => {
    if(q && !keep(e)) return;
    const id = `${node.hash}#${e.at}.${e.field}`;
    const kids = under(e);
    const value = e.value === null ? ''
      : e.value || (kids ? `${kids} under` : '');
    out.push(`<button class="doc-row${e.value === null ? ' is-bare' : ''}${
        q && !hit(e) ? ' is-context' : ''}" type="button" data-attr="${esc(id)}"
        aria-selected="${S.attr === id}"
        style="padding-left:${8 + Math.min(depth, 8) * 13}px" title="${esc(e.line)}">
      <span class="doc-key">${docNamed(esc(e.key), esc(e.line))}</span>${
      e.value === null ? '' : `<span class="doc-val">${docNamed(esc(value), esc(e.line))}${
        e.value && kids ? ` <span class="doc-under-n">· ${kids} under</span>` : ''}</span>`}
    </button>`);
    e.children.forEach(c => walk(c, depth + 1));
  };
  blockEntries(lines).forEach(e => walk(e, 0));
  return out.join('');
}

/* The entry a row stands for, found again from the id the row carries. */
function docEntryAt(node, id){
  if(!id || !id.startsWith(`${node.hash}#`)) return null;
  /* The line it is on, and which of the fields on that line it is: one line
     can have printed several. */
  const [at, field] = id.slice(node.hash.length + 1).split('.').map(Number);
  const find = (list) => {
    for(const e of list){
      if(e.at === at && e.field === field) return e;
      const deeper = find(e.children);
      if(deeper) return deeper;
    }
    return null;
  };
  for(const run of blockRuns(node.body)){
    if(run.kind !== 'text') continue;
    const found = find(blockEntries(run.lines));
    if(found) return found;
  }
  return null;
}

/* What the details pane answers about while a row is picked. The value is
   pulled apart the same way everything else is — the `k=v` pairs a service
   crams onto one line become a table — and what was printed under the row
   comes with it. */
function docAttrDetail(id){
  const owner = S.data.nodes.find(n => n.hash === id.split('#')[0]);
  const entry = owner && docEntryAt(owner, id);
  if(!entry) return null;

  const out = [];
  out.push(`<section class="dgroup"><h3>Printed</h3>${dl([
    ['name', docNamed(esc(entry.key), esc(entry.line))],
    entry.value !== null && entry.value !== '' && ['value', docNamed(esc(entry.value), esc(entry.line))],
    ['at', `line ${owner.bodyAt + entry.at}`],
    ['in', docLink(owner.hash, owner.title)],
  ])}</section>`);

  const pairs = docInline(entry.value || '');
  if(pairs.length > 1){
    out.push(`<section class="dgroup"><h3>Pulled apart</h3>${
      dl(pairs.map(([k, v]) => [esc(k), docNamed(esc(v), esc(entry.line))]))}</section>`);
  }

  if(entry.children.length){
    out.push(`<section class="dgroup"><h3>Under it</h3>${dl(entry.children.map(c =>
      [docNamed(esc(c.key), esc(c.line)),
       c.value === null ? dim('—') : docNamed(esc(c.value), esc(c.line))]))}</section>`);
  }

  const block = [];
  const collect = (e) => { block.push(e.line); e.children.forEach(collect); };
  collect(entry);

  return { title: entry.key, out, raw: block.length > 1 ? block.join('\n') : '' };
}

/* The `k=v` pairs a value is made of, where it is made of any. A value that is
   one thing — a number, a path, a policy id — is not pulled apart. */
function docInline(value){
  const out = [];
  let m;
  KV_RE.lastIndex = 0;
  while((m = KV_RE.exec(value)) !== null) out.push([m[1], m[2]]);
  return out;
}

/* A property id is a bare hex int wherever it is printed. The dump names them
   in two of its own tables, so every other mention can carry the name. */
/* `within` is what the id was printed alongside — its row, or its line. The
   two tables the names are read from print the name themselves, so an id
   standing next to its own name is left alone rather than saying it twice. */
function docNamed(html, within){
  const names = (S.data.globals && S.data.globals.propNames) || {};
  const near = within === undefined ? html : within;
  return html.replace(/\b0x[0-9a-f]{6,8}\b/gi, (hex) => {
    const name = names[hex.toLowerCase()];
    return name && !near.includes(name) ? `${hex} <span class="doc-name">${esc(name)}</span>` : hex;
  });
}

/* One swatch per node on the sheet, grouped by type — the shades only mean
   something if you can see which one each of them belongs to. It follows what
   is drawn rather than what is listed: a node with no frame is nowhere on the
   sheet, so a swatch for it would point at nothing. */
function renderLegend(){
  const groups = new Map();
  for(const w of paintOrder()){
    const k = w.typeLabel;
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  const el = $('legend');
  el.hidden = groups.size === 0;
  el.innerHTML = [...groups.entries()]
    .sort((a, b) => a[1][0].zRank - b[1][0].zRank)
    .map(([type, ws]) => `<span class="lg"><span class="lg-sw">${
      ws.map(w => `<button type="button" data-hash="${esc(w.hash)}" style="background:${tintFor(w)}"
        aria-pressed="${S.selected === w.hash}" title="${esc(w.title)} — z ${w.zRank+1}/${w.zCount}"
        aria-label="${esc(w.title)}"></button>`).join('')
    }</span>${esc(type)}${ws.length > 1 ? ` <span class="lg-n">×${ws.length}</span>` : ''}</span>`)
    .join('');
}

/* The footer reads the same in either view. */
function renderSheetFoot(){
  const d = currentDisplay();
  const framed = visibleNodes().filter(w => w.frame);
  const derived = framed.filter(w => w.frameDerived).length;
  const foot = [];
  foot.push(`<span>display ${d.id}${d.name ? ' · ' + esc(d.name) : ''}</span>`);
  foot.push(`<span>${d.size.w} × ${d.size.h} px${d.dpi ? ' · ' + d.dpi + ' dpi' : ''}${d.synthesised ? ' (inferred)' : ''}</span>`);
  foot.push(`<span>${framed.length} of ${d.nodes.length} ${S.tool.nouns} with a frame</span>`);
  const hidden = d.nodes.length - listItems().length;
  if(hidden > 0 && !S.filter.trim()) foot.push(`<span>${hidden} not listed</span>`);
  if(derived) foot.push(`<span>${derived} frame${derived>1?'s':''} recovered</span>`);
  /* A capture playing over this layout is part of what the sheet is showing,
     so it is said on the sheet's own line rather than somewhere else. */
  const trace = gevHostFoot();
  if(trace) foot.push(trace);
  $('sheetFoot').innerHTML = foot.join('');
}

/* ---- shared by both sheet renderers ---- */

/* How far a sheet may grow past the display it draws. A layer can state
   bounds far larger than any screen — an input sink that takes touches
   wherever they land states half a world, and a modern SurfaceFlinger dump is
   full of them — and fitting the sheet around one would shrink the display to
   a speck. A screen's width past the display in each direction is as far as
   the sheet goes; what lies beyond that is still drawn, and the edge of the
   sheet is where it stops being shown. */
const sheetLimit = (size) => ({ l: -size.w, t: -size.h, r: size.w * 2, b: size.h * 2 });
const clipToSheet = (lim, rc) => ({
  l: Math.max(rc.l, lim.l), t: Math.max(rc.t, lim.t),
  r: Math.min(rc.r, lim.r), b: Math.min(rc.b, lim.b),
});

/* The nodes to draw, bottom of the stack first — which is also the order
   SVG needs, both for the fills and for the hit targets stacked over them. */
function paintOrder(){
  return visibleNodes().filter(w => w.frame).sort((a, b) => a.z - b.z);
}

const dimClass = (w) => (S.dim && S.selected && w.hash !== S.selected) ? ' pw-dim' : '';

/* An empty sheet is a result too — say which kind of empty it is. */
function emptyNote(shownCount, x, y){
  const at = (msg, dy, cls) =>
    `<text class="pw-label${cls || ''}" x="${x}" y="${y + dy}" text-anchor="middle"
       dominant-baseline="middle">${esc(msg)}</text>`;
  if(!shownCount) return at(`No ${S.tool.nouns} match this filter`, 0);

  /* Nothing has a frame. Name the rects the blocks did carry: that is the
     difference between a dump that states no geometry at all and one that
     states it under a spelling this build of Telltale does not know. */
  const keys = new Set();
  for(const n of currentDisplay().nodes) for(const k of Object.keys(n.rects || {})) keys.add(k);
  const found = [...keys].join(', ');
  return at(`No frames in this dump for the ${S.tool.nouns} shown`, 0)
    + at(found ? `rects found in the blocks: ${found}` : 'no rects found in any block',
         22, ' pw-note');
}

const hitShape = (w, shape, region) =>
  `<${shape} class="pw-hit" data-hash="${esc(w.hash)}"${
    region === undefined ? '' : ` data-region="${region}"`} `;

function sheetSvg({ vb, label, parts, fit }){
  $('sheet').innerHTML =
    `<svg class="plan"${fit ? ` data-fit="${fit}"` : ''} viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}"
       preserveAspectRatio="xMidYMid meet" width="${vb.w}" height="${vb.h}"
       role="img" aria-label="${label}">${parts.join('')}</svg>`;
  refit();
  requestAnimationFrame(refit);
}

/* Winscope-style exploded stack: every window keeps its real frame but is
   pushed along a depth axis by its position in the z order, then the whole
   pile is rotated so you look at it from the side. At angle 0 it collapses
   back into the plan view, which is the point — the two are the same drawing. */
function renderDepth(){
  const d = currentDisplay();
  const shownCount = visibleNodes().length;
  const stack = paintOrder();
  const W = d.size.w, H = d.size.h;
  const span = Math.max(W, H);
  const step = span * 0.11 * (S.sep / 100);
  const yaw = S.yaw * Math.PI / 180, pitch = S.pitch * Math.PI / 180;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);

  // Orthographic: yaw about the vertical axis, then pitch about the horizontal.
  const cx = W / 2, cy = H / 2;
  const P = (x, y, z) => {
    const X = x - cx, z1 = -X * syw + z * cyw;
    return [X * cyw + z * syw, (y - cy) * cp - z1 * sp];
  };
  const quad = (r, z) => [P(r.l,r.t,z), P(r.r,r.t,z), P(r.r,r.b,z), P(r.l,r.b,z)];
  const pts = (q) => q.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

  const base = quad({l:0,t:0,r:W,b:H}, 0);
  const lim = sheetLimit(d.size);
  const faces = stack.map((w, i) => {
    const z = (i + 1) * step;
    const q = quad(clipToSheet(lim, w.frame), z);
    return { w, q, z, a: q.reduce((m,p) => p[0] > m[0] ? p : m, q[0]) };   // right-most corner
  });
  // Rows follow where each window landed on the sheet, not its rank, so the
  // leaders never cross. The rank is on the row, which is what carries z.
  [...faces].sort((x, y) => x.a[1] - y.a[1]).forEach((f, i) => { f.row = i; });

  const bb = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
  for(const q of [base, ...faces.map(f => f.q)]) for(const [x,y] of q){
    bb.l = Math.min(bb.l, x); bb.t = Math.min(bb.t, y);
    bb.r = Math.max(bb.r, x); bb.b = Math.max(bb.b, y);
  }

  // A label column to the right, one row per window, topmost at the top —
  // the leaders are what actually make the ordering readable.
  const gap = span * 0.07;
  const labX = bb.r + gap;
  const rows = Math.max(faces.length, 1);
  const rowH = (bb.b - bb.t) / rows;
  const labY = (row) => bb.t + rowH * (row + 0.5);

  const parts = [];
  parts.push(`<polygon class="dp-base" points="${pts(base)}"/>`);

  for(const { w, q, z } of faces){
    /* The face is the frame. Where the node also states which part of itself
       takes touch, each of those rects is drawn on the face at the same
       height, so a window that is live in two places reads as two places
       rather than as one box with a count next to it. */
    const regions = S.tool.regions ? S.tool.regions(w, false) : null;
    parts.push(`<polygon class="dp-face${w.visible ? '' : ' is-hidden'}${dimClass(w)}"
      style="color:${tintFor(w)}" points="${pts(q)}"/>` +
      (regions || []).map(({ rc }) =>
        `<polygon class="dp-region${dimClass(w)}" points="${pts(quad(rc, z))}"/>`).join(''));
  }

  const labelClass = (w) => (b) =>
    b + (w.hash === S.selected ? ' is-sel' : '') + (w.visible ? '' : ' is-hidden') + dimClass(w);

  for(const { w, q, z } of faces){
    if(w.hash !== S.selected) continue;
    parts.push(`<polygon class="dp-sel" points="${pts(q)}"/>`);
    /* Picking a window marks every rect it takes touch in, including the one
       that is the frame again — the point of picking it is to be shown what
       it takes, not only where it differs. */
    const selRegions = S.tool.regions ? S.tool.regions(w, true) : null;
    for(const { rc, i } of selRegions || []){
      parts.push(`<polygon class="dp-sel-region${i === S.region ? ' is-pick' : ''}"
        points="${pts(quad(rc, z))}"/>`);
    }
  }

  // Every leader before any name: a leader drawn afterwards would cross the
  // labels of the rows above it, and no halo can rub out a line laid on top.
  for(const { w, row, a: anchor } of faces){
    const y = labY(row);
    parts.push(`<path class="${labelClass(w)('dp-lead')}" d="M${anchor[0].toFixed(1)} ${anchor[1].toFixed(1)}L${(labX - gap*0.45).toFixed(1)} ${y.toFixed(1)}L${labX.toFixed(1)} ${y.toFixed(1)}"/>`);
  }

  for(const { w, row } of faces){
    const y = labY(row);
    const cls = labelClass(w);
    parts.push(
      `<text class="${cls('dp-rank')}" x="${(labX - gap*0.62).toFixed(1)}" y="${y.toFixed(1)}">${w.zRank+1}</text>` +
      `<text class="${cls('dp-text')}" x="${(labX + gap*0.12).toFixed(1)}" y="${y.toFixed(1)}">${esc(trim(w.title, 34))}</text>`
    );
  }

  if(!faces.length) parts.push(emptyNote(shownCount, 0, 0));

  /* The trace lies on the screen, so it goes through the same projection the
     faces did at depth 0 — turn the stack and the gesture turns with it. The
     playhead is painted through that mapping too, which is what this leaves
     behind for it. */
  parts.push(gevOverlay(span, (x, y) => P(x, y, 0)));

  // Hit targets last, bottom-up, so the window on top takes the click.
  for(const { w, q, z } of faces){
    parts.push(hitShape(w, 'polygon') + `points="${pts(q)}"><title>${esc(w.title)}</title></polygon>`);
    for(const { rc, i } of (S.tool.regions ? S.tool.regions(w, true) : [])){
      parts.push(hitShape(w, 'polygon', i) + `points="${pts(quad(rc, z))}"><title>${
        esc(w.title)} — touch rect ${i + 1}</title></polygon>`);
    }
  }
  // The name on the right is the easier thing to aim at, so give each row its
  // own target rather than leaving only the glyphs clickable.
  for(const { w, row } of faces){
    const y = labY(row);
    parts.push(hitShape(w, 'rect') +
      `x="${(labX - gap * 0.75).toFixed(1)}" y="${(y - rowH * 0.44).toFixed(1)}"
       width="${(gap * 0.75 + span).toFixed(1)}" height="${(rowH * 0.88).toFixed(1)}"
       ><title>${esc(w.title)}</title></rect>`);
  }

  // The labels are drawn at a constant screen size, so how much room they need
  // in model units is only known once the sheet has been scaled — start narrow
  // and let fitLabels() widen the sheet to whatever they turn out to be.
  const pad = span * 0.03;
  const vb = { x: bb.l - pad, y: bb.t - pad,
               w: (labX + span * 0.06) - (bb.l - pad), h: (bb.b - bb.t) + pad * 2 };

  sheetSvg({ vb, fit: pad, parts,
             label: `Window stack for display ${d.id}, topmost first` });
}

/* Widen the sheet until the label column fits, and no further. Font size and
   sheet width each depend on the other, so this settles over a few passes. */
function fitLabels(){
  const svg = document.querySelector('svg.plan[data-fit]');
  if(!svg) return;
  const pad = +svg.dataset.fit;
  for(let pass = 0; pass < 4; pass++){
    scaleLabels();
    let right = -Infinity;
    svg.querySelectorAll('.dp-text').forEach((t) => {
      const b = t.getBBox();
      right = Math.max(right, b.x + b.width);
    });
    if(!isFinite(right)) return;
    const vb = svg.viewBox.baseVal;
    const want = right + pad - vb.x;
    if(Math.abs(want - vb.width) < pad * 0.04) break;
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${want} ${vb.height}`);
    svg.setAttribute('width', want);
  }
}

function refit(){ scaleLabels(); fitLabels(); }

function renderFlat(){
  const d = currentDisplay();
  const shownCount = visibleNodes().length;
  const paint = paintOrder();
  const dispRect = { l:0, t:0, r:d.size.w, b:d.size.h };

  // Expand the sheet if any window sits off the display, but only so far.
  const lim = sheetLimit(d.size);
  const bb = { ...dispRect };
  for(const { frame } of paint){
    const rc = clipToSheet(lim, frame);
    bb.l = Math.min(bb.l, rc.l); bb.t = Math.min(bb.t, rc.t);
    bb.r = Math.max(bb.r, rc.r); bb.b = Math.max(bb.b, rc.b);
  }
  const pad = Math.max(rectW(bb), rectH(bb)) * 0.06;
  const vb = { x: bb.l - pad, y: bb.t - pad, w: rectW(bb) + pad*2, h: rectH(bb) + pad*2 };

  const sel = paint.find(w => w.hash === S.selected);

  // Dimension leaders go outside the window; pick the side with room, then
  // widen the sheet on that side so the numbers are never clipped.
  let sx = 1, sy = 1;
  if(sel && sel.frame){
    sx = (sel.frame.r + pad * 0.9 > bb.r) ? -1 : 1;
    sy = (sel.frame.b + pad * 0.4 > bb.b) ? -1 : 1;
    const ann = pad * 1.5;
    if(sx > 0) vb.w += ann; else { vb.x -= ann; vb.w += ann; }
    if(sy > 0) vb.h += ann; else { vb.y -= ann; vb.h += ann; }
  }
  const cropLen = Math.min(rectW(dispRect), rectH(dispRect)) * 0.045;

  const parts = [];
  parts.push(`<rect class="pw-screen" ${rectAttrs(dispRect)}/>`);

  for(const w of paint){
    const dash = w.visible ? '' : ' stroke-dasharray="6 5"';
    /* Some dumps state a second set of rects per node that is the point of
       reading them — the part of an input window that actually takes touch.
       Under the frame only the ones that are not simply the frame again are
       worth drawing; the selected node gets all of them, in the redline,
       below. */
    const regions = S.tool.regions ? S.tool.regions(w, false) : null;
    parts.push(
      `<g style="color:${tintFor(w)}" class="${dimClass(w).trim()}">` +
      (w.visible ? `<rect class="pw-fill" ${rectAttrs(w.frame)}/>` : '') +
      `<rect class="pw-stroke"${dash} ${rectAttrs(w.frame)}/>` +
      (regions || []).map(({ rc }) => `<rect class="pw-region" ${rectAttrs(rc)}/>`).join('') +
      `</g>`
    );
  }

  // Corner crop marks on the display outline.
  const cm = [];
  for(const [x,y,dx,dy] of [
    [dispRect.l,dispRect.t,1,1],[dispRect.r,dispRect.t,-1,1],
    [dispRect.l,dispRect.b,1,-1],[dispRect.r,dispRect.b,-1,-1]]){
    cm.push(`<path class="pw-crop" d="M${x} ${y+dy*cropLen}L${x} ${y}L${x+dx*cropLen} ${y}"/>`);
  }
  parts.push(cm.join(''));

  // Redline dimensioning for the selected window.
  if(sel && sel.frame){
    const f = sel.frame;
    const off = pad * 0.42;
    const vx = sx > 0 ? f.r : f.l;                          // vertical leader sits here
    const hy = sy > 0 ? f.b : f.t;                          // horizontal leader sits here
    const lx = vx + sx * off, ly = hy + sy * off;
    const topLabelY = (f.t - off * 0.6 < vb.y + off) ? f.t + off * 1.1 : f.t - off * 0.6;

    parts.push(`<rect class="pw-sel" ${rectAttrs(f)}/>`);
    /* The frame is marked in the redline; where the node also states the part
       of itself that is live, that is marked too, so picking a window says
       both where it is and where it can be touched. */
    const selRegions = S.tool.regions ? S.tool.regions(sel, true) : null;
    for(const { rc, i } of selRegions || []){
      parts.push(`<rect class="pw-sel-region${i === S.region ? ' is-pick' : ''}"
        ${rectAttrs(rc)}/>`);
    }
    parts.push(
      `<path class="pw-lead" d="M${f.l} ${ly}L${f.r} ${ly}M${f.l} ${ly-off*0.5}L${f.l} ${ly+off*0.5}M${f.r} ${ly-off*0.5}L${f.r} ${ly+off*0.5}"/>` +
      `<text class="pw-label" x="${(f.l+f.r)/2}" y="${ly + (sy>0 ? off*1.2 : -off*0.5)}" text-anchor="middle">${rectW(f)}</text>` +
      `<path class="pw-lead" d="M${lx} ${f.t}L${lx} ${f.b}M${lx-off*0.5} ${f.t}L${lx+off*0.5} ${f.t}M${lx-off*0.5} ${f.b}L${lx+off*0.5} ${f.b}"/>` +
      `<text class="pw-label" x="${lx + sx*off*0.8}" y="${(f.t+f.b)/2}" text-anchor="${sx>0 ? 'start' : 'end'}" dominant-baseline="middle">${rectH(f)}</text>` +
      `<text class="pw-label" x="${f.l}" y="${topLabelY}">${f.l}, ${f.t}</text>`
    );
  }

  if(!paint.length) parts.push(emptyNote(shownCount, dispRect.r / 2, dispRect.b / 2));

  /* A touch log pasted onto this dump plays over it, on top of every window
     and under nothing: the whole point of putting it here is to see which
     window the finger was on. */
  parts.push(gevOverlay(Math.max(rectW(dispRect), rectH(dispRect))));

  // Hit targets last. SVG paints in document order, so these go bottom-up like
  // the fills: the topmost window ends up on top and takes the click.
  for(const w of paint){
    parts.push(hitShape(w, 'rect') + `${rectAttrs(w.frame)}><title>${esc(w.title)}</title></rect>`);
    for(const { rc, i } of (S.tool.regions ? S.tool.regions(w, true) : [])){
      parts.push(hitShape(w, 'rect', i) + `${rectAttrs(rc)}><title>${
        esc(w.title)} — touch rect ${i + 1}</title></rect>`);
    }
  }

  sheetSvg({ vb, parts, label: `Window layout for display ${d.id}` });
}

/* Keep annotation text a constant size on screen regardless of display resolution. */
function scaleLabels(){
  const svg = document.querySelector('svg.plan');
  if(!svg) return;
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  if(!box.width || !box.height || !vb.width || !vb.height) return;
  // preserveAspectRatio="meet" letterboxes, so the drawn scale is the smaller ratio.
  const scale = Math.min(box.width / vb.width, box.height / vb.height);
  if(scale > 0) svg.style.setProperty('--fs', (12 / scale) + 'px');
}
