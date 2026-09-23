/* ---------------- render: the pickers and the node list ---------------- */

/* One tab per workspace, in the strip above the dumps. `armedClose` is the
   workspace whose cross has been clicked once: closing one throws away every
   dump in it and nothing puts them back, so the cross turns into a question
   first. `renamingId` is the workspace whose name is being typed, which is
   drawn as a box in place of the name rather than as a dialogue over it. */
let armedClose = null, renamingId = null;

const heldDumps = (c) => `${c} ${c === 1 ? 'dump' : 'dumps'}`;

/* A workspace keeps its colour for as long as it exists, because it is taken
   from the id it was made with rather than from where it sits in the strip:
   closing the one to its left must not repaint the rest of them. There are six
   and the ladder wraps, so a seventh workspace shares with the first. */
const ACCENTS = 6;
const accentOf = (space) => `var(--acc-${(space.id - 1) % ACCENTS + 1})`;

function renderSpaceTabs(){
  const strip = $('wspTabs');
  strip.innerHTML = S.spaces.map(w => {
    const open = w.id === S.spaceId;
    const n = w.docs.length;
    const armed = armedClose === w.id;
    const last = S.spaces.length === 1;
    const name = w.id === renamingId
      ? `<input class="wsp-rename" type="text" maxlength="40" data-rename="${w.id}"
           aria-label="Workspace name" value="${esc(w.name)}">`
      : `<button class="wsp-open" type="button" data-space="${w.id}" aria-pressed="${open}"
          title="${esc(w.name)} — ${heldDumps(n)}. Double-click to rename.">
          <span class="wsp-name">${esc(w.name)}</span
          ><span class="wsp-count">${n || 'empty'}</span>
        </button>`;
    /* The last workspace is emptied rather than closed — the page always has a
       desk to load the next dump onto — so its cross says so. */
    const closeTitle = armed
      ? `Click again to discard ${heldDumps(n)}`
      : last ? 'Empty this workspace' : 'Close this workspace';
    return `<span class="wsp-tab" aria-current="${open}" style="--wsp-accent:${accentOf(w)}"
      ><span class="wsp-swatch"></span>${name}<button
        class="wsp-close${armed ? ' is-armed' : ''}" type="button" data-close-space="${w.id}"
        title="${closeTitle}" aria-label="${closeTitle}: ${esc(w.name)}"
        >${armed ? `discard ${n}?` : '\u00d7'}</button></span>`;
  }).join('');
  const box = strip.querySelector('[data-rename]');
  if(box){ box.focus(); box.select(); }
}

/* Closing a workspace holding dumps asks once, in the cross itself. Anything
   else the user does puts the question away again. */
function requestCloseSpace(space){
  if(space.docs.length && armedClose !== space.id){
    armedClose = space.id;
    return renderSpaceTabs();
  }
  closeSpace(space);
}

function disarmClose(){
  if(armedClose === null) return;
  armedClose = null;
  renderSpaceTabs();
}

function startRename(space){
  renamingId = space.id;
  renderSpaceTabs();
}

function endRename(save){
  const box = $('wspTabs').querySelector('[data-rename]');
  if(!box) return;
  const space = S.spaces.find(w => w.id === +box.dataset.rename);
  const value = box.value;
  renamingId = null;
  if(save && space) renameSpace(space, value); else renderSpaceTabs();
}

/* One tab per dump loaded. The strip shows from the first one, because it is
   also the way back from the loader — and it stays up for a second workspace
   even while the open one is empty, or there would be no way back to the
   dumps in the other. */
function renderDocTabs(){
  /* Both strips are one thing and come and go together: an empty workspace
     still shows its own tab and an empty dump strip under it, because that is
     what an empty desk looks like and the way back to a full one. Neither is
     worth drawing before anything has been loaded at all. */
  const any = S.spaces.some(w => w.docs.length) || S.spaces.length > 1;
  $('wspBar').hidden = $('docBar').hidden = !any;
  if(!any){ armedClose = renamingId = null; return $('docTabs').innerHTML = ''; }
  renderSpaceTabs();
  /* The dump strip is inside a workspace, so it is lit by that workspace's
     colour: one property here, inherited by whichever tab is open. */
  $('docBar').style.setProperty('--wsp-accent', accentOf(currentSpace()));
  const shown = !$('app').hidden;
  /* A tab is one reader's reading of one file, and a bugreport is ten of them
     off the same file, so the reader's name is what tells the tabs apart and
     leads the tab. The file's name only earns its place when more than one is
     open; either way the whole of it is in the tooltip. */
  const files = new Set(S.docs.map(d => d.label));
  $('docTabs').innerHTML = S.docs.map(d => {
    const entry = d.found[0];
    const n = entry.scene.nodes.length;
    const open = shown && d.id === S.docId;
    const counted = `${n} ${n === 1 ? entry.tool.noun : entry.tool.nouns}`;
    return `<span class="doc-tab" aria-current="${open}">
      <button class="doc-open" type="button" data-doc="${d.id}" aria-pressed="${open}"
        title="${esc(entry.tool.name)} — ${counted} — ${esc(d.label)}${
          d.from ? `, out of ${esc(d.from)}` : ''}">
        <span class="doc-name">${esc(entry.tool.name)}</span
        >${files.size > 1 ? `<span class="doc-kind">${esc(elide(d.label, 22))}</span>` : ''}
      </button
      ><button class="doc-close" type="button" data-close="${d.id}"
        title="Close this dump" aria-label="Close ${esc(entry.tool.name)} from ${esc(d.label)}">\u00d7</button>
    </span>`;
  }).join('');
}

/* Only worth showing when the text held more than one thing Telltale reads. */
/* The picker over whatever a tool groups by. It normally sits above the sheet,
   which a tool with nothing to draw does not have, so a list tool gets the
   copy of it that lives at the top of the stack pane instead. */
function renderTabs(){
  const ds = S.data.displays;
  const list = S.tool.layout === 'list';
  const noun = S.tool.groupNoun || 'display';
  /* A drawn dump's group chip says how big the display is, which is worth the
     strip even when there is only one of them. A document's says what the
     details pane already says when nothing is picked, so one group there is a
     header over nothing. */
  $('sheetHead').hidden = list || (S.tool.layout === 'doc' && ds.length < 2);
  $('listHead').hidden = !list;
  const host = list ? $('listTabs') : $('displayTabs');
  host.innerHTML = ds.map(d => {
    const n = d.nodes.length;
    const meta = d.meta || (`${d.size.w} × ${d.size.h}${d.synthesised ? '?' : ''}`
      + `${d.dpi ? ' · ' + d.dpi + ' dpi' : ''} · ${n} ${n === 1 ? S.tool.noun : S.tool.nouns}`);
    const head = d.label || `${noun} ${d.id}`;
    const badges = (S.tool.groupBadges ? S.tool.groupBadges(d) : [])
      .map(([label, cls]) => `<span class="badge badge-lead ${cls}">${esc(label)}</span>`).join('');
    const body = `<b>${esc(head)}${d.name && list ? ' · ' + esc(d.name) : ''}</b>${
      badges ? `<span class="tab-badges">${badges}</span>` : ''
    }<span class="tab-meta">${meta}</span>`;
    return ds.length < 2
      ? `<span class="tab tab-display tab-static" aria-pressed="true">${body}</span>`
      : `<button class="tab tab-display" type="button" data-did="${d.id}" aria-pressed="${d.id===S.displayId}">${body}</button>`;
  }).join('');
}

function renderShow(){
  $('optShow').innerHTML = Object.entries(shows()).map(([key, { label }]) =>
    `<button class="tab" type="button" data-show="${key}"
       aria-pressed="${key === S.show}">${label}</button>`).join('');
}

/* The line under a row's name. Size and z rank are what a drawn dump puts
   there; a tool with neither says what belongs there instead. The search
   results want the same line under the same name, so it is spelled once. */
function rowMeta(tool, w){
  if(tool.rowMeta) return tool.rowMeta(w);
  const f = w.frame;
  const size = f ? `${rectW(f)}×${rectH(f)}${w.frameDerived ? '*' : ''}` : 'no frame';
  return `${esc(w.typeLabel)} · ${size} · z ${w.zRank+1}/${w.zCount}`;
}

function drawList(){
  const list = $('wlist');
  const items = listItems();
  const tree = items.some(i => i.depth > 0 || i.context || i.kids);
  list.setAttribute('role', tree ? 'tree' : 'listbox');
  list.classList.toggle('is-tree', tree);
  /* A tool that draws its own rows says so here, once, rather than on every
     row: the columns are the list's, not the row's. */
  list.classList.toggle('is-log', S.tool.listClass === 'is-log');
  $('treeCtl').hidden = !tree;

  if(!items.length){
    const set = shows();
    const where = `in this ${S.tool.groupNoun || 'display'}`;
    const bad = textMatcher(S.filter, S.regex);
    const why = bad && !bad.ok
      ? `That is not a regular expression: ${esc(bad.error)}`
      : S.filter.trim() ? `No ${S.tool.nouns} match this filter.`
      : S.show !== 'all' && set[S.show]
        ? `Nothing ${where} is <b>${esc(set[S.show].label)}</b>. Try <b>all</b>.`
      : `No ${S.tool.nouns} ${where}.`;
    list.innerHTML = `<li style="padding:16px 12px;color:var(--dim)">${why}</li>`;
    return;
  }
  /* A row a tool draws itself: the twisty, the swatch and the title-and-meta
     are the generic row, and a log line is none of those. Everything around
     the contents — which row is picked, which keys move between them — is the
     same either way, so only the inside changes. */
  if(S.tool.row) return renderRowWindow(items.map(i => i.node));

  list.innerHTML = items.map(({ node: w, depth, context, kids, open, hiding }) => {
    const meta = rowMeta(S.tool, w);
    /* Badges lead the row. A title is ellipsised when it does not fit — and
       the long ones are exactly the ones worth badging — so anything trailing
       the title is the first thing to disappear. Visibility goes first of all:
       it is the one thing worth reading off every row at a glance, so it is a
       single letter rather than a word. It earns that place where most of a
       dump never reaches the screen; where the normal case is that it did, a
       tool turns it off and lets the exceptions carry their own badges. */
    const badges = [
      ...(w.visible && S.tool.visBadge !== false ? [['v', 'badge-vis', 'visible']] : []),
      ...(w.focused ? [['focus', 'badge-focus']] : []),
      ...w.badges,
    ].map(([label, cls, tip]) =>
      `<span class="badge badge-lead ${cls}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(label)}</span>`
    ).join('');
    /* A row with children below it gets a twisty. It is a button so a pointer
       has something to hit, and `aria-hidden` because the row itself already
       says whether it is open and the arrow keys already work it. */
    const twisty = !tree ? ''
      : kids ? `<button class="twisty${open ? ' is-open' : ''}" type="button" tabindex="-1" aria-hidden="true"
            data-toggle="${esc(w.hash)}"
            title="${open ? 'Hide what is under this' : `Show the ${hiding} below this`}"
          ><span class="twisty-arrow">\u25b8</span></button>`
      : '<span class="twisty twisty-none"></span>';
    // Indentation is charged against the title, which is the thing worth
    // reading, so it stays small and the pane can be dragged wider. The rails
    // are what carries the nesting, so the step can afford to stay narrow.
    return `<li class="wrow ${w.visible ? '' : 'is-hidden'}${context ? ' is-context' : ''}"
        role="${tree ? 'treeitem' : 'option'}"${tree ? ` aria-level="${depth + 1}"` : ''}${
          tree && kids ? ` aria-expanded="${open}"` : ''} tabindex="0"
        style="--depth:${Math.min(depth, 8)}" title="${esc(w.title)}"
        data-hash="${esc(w.hash)}" aria-selected="${S.selected===w.hash}">
      ${twisty}<span class="swatch" style="background:${tintFor(w)}"></span>
      <span>
        <span class="wtitle">${badges}${esc(w.title)}</span>
        ${context ? '' : `<span class="wmeta">${meta}${
          open || !hiding ? '' : dim(` · ${hiding} hidden`)}</span>`}
      </span>
    </li>`;
  }).join('');
}
