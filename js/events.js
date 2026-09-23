/* ================ events ================ */

/* Whether a keystroke belongs to a box the user is typing in rather than to
   the page. `activeElement` is null while focus is between elements — after
   the row the keyboard was on was redrawn away, which this page does on every
   selection — so it is asked about rather than reached into. */
const typingInField = () => {
  const el = document.activeElement;
  return !!el && (/^(INPUT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable === true);
};

/* Whether there is selected text inside an element. A click is the release of
   a drag as much as it is a click, so this is what tells the two apart. */
function textSelectedIn(el){
  const sel = window.getSelection();
  if(!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const at = sel.getRangeAt(0).commonAncestorContainer;
  return el.contains(at.nodeType === 1 ? at : at.parentNode);
}

$('wlist').addEventListener('click', (e) => {
  /* Text was dragged out of the list: the release is the end of that gesture,
     not a pick. Picking would redraw the list and drop the selection before
     it could be copied. */
  if(textSelectedIn($('wlist'))) return;
  const twist = e.target.closest('[data-toggle]');
  if(twist) return toggleCollapse(twist.dataset.toggle);
  const row = e.target.closest('.wrow'); if(row) select(row.dataset.hash);
});

/* Copying rows out of the list. A row is a grid of cells, so the browser's own
   copy puts every column on a line of its own and a hundred log lines come off
   the clipboard as five hundred — which is not a log. So the clipboard is
   written from the rows instead: the line as the dump wrote it where the row
   still has it, and its cells joined back onto one line where it does not.
   A selection inside a single row is left as the reader drew it, minus the
   line breaks the columns put in. */
document.addEventListener('copy', (e) => {
  const list = $('wlist');
  const sel = window.getSelection();
  /* Only the lists drawn a row at a time are columns like this. The window
     tree is one row per line already and the browser copies it correctly. */
  if(!S.tool || !S.tool.row) return;
  if(!e.clipboardData || !sel || sel.isCollapsed || !textSelectedIn(list)) return;
  const oneLine = (t) => t.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s+$/, '');
  const rows = [...list.querySelectorAll('.wrow')].filter(r => sel.containsNode(r, true));
  const text = rows.length > 1
    ? rows.map(rowCopyText).join('\n')
    : oneLine(sel.toString());
  if(!text) return;
  e.clipboardData.setData('text/plain', text);
  e.preventDefault();
});

function rowCopyText(row){
  const n = row.dataset.i !== undefined ? rowWin.nodes[+row.dataset.i] : null;
  const raw = n && ((n.entry && n.entry.raw) || n.raw);
  if(raw) return raw;
  return [...row.children].map(c => c.textContent.trim()).filter(Boolean).join(' ');
}

$('wlist').addEventListener('keydown', (e) => {
  const row = e.target.closest('.wrow'); if(!row) return;
  if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); select(row.dataset.hash); }
  if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    e.preventDefault();
    /* In a windowed list the next row may not be in the DOM yet, so the step
       is taken in the list itself and the window is moved to follow it. */
    if(row.dataset.i !== undefined){
      const i = +row.dataset.i + (e.key === 'ArrowDown' ? 1 : -1);
      const next = rowWin.nodes[i];
      if(next) goToRow(next.hash);
      return;
    }
    const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
    if(next && next.classList.contains('wrow')) goToRow(next.dataset.hash);
  }
  /* The arrows a tree is worked with: right opens a shut row and then steps
     into it, left shuts an open one and then steps out to its parent. */
  if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
    const open = row.getAttribute('aria-expanded');
    const hash = row.dataset.hash;
    e.preventDefault();
    if(e.key === 'ArrowRight'){
      if(open === 'false') return keepFocus(hash, () => toggleCollapse(hash));
      const next = row.nextElementSibling;
      if(next && +next.getAttribute('aria-level') > +row.getAttribute('aria-level')){
        goToRow(next.dataset.hash);
      }
      return;
    }
    if(open === 'true') return keepFocus(hash, () => toggleCollapse(hash));
    const level = +row.getAttribute('aria-level');
    for(let up = row.previousElementSibling; up; up = up.previousElementSibling){
      if(+up.getAttribute('aria-level') < level){ goToRow(up.dataset.hash); break; }
    }
  }
});
/* Selecting redraws the list, which throws away the row the keyboard was on,
   so every move puts the focus back on whatever that row is now. */
function keepFocus(hash, act){
  act();
  revealRow(hash);
  const row = $('wlist').querySelector(`.wrow[data-hash="${CSS.escape(hash)}"]`);
  if(row) row.focus();
}
const goToRow = (hash) => keepFocus(hash, () => select(hash));
$('treeCtl').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tree]');
  if(b) setAllCollapsed(b.dataset.tree === 'collapse');
});
/* Picking and orbiting share one gesture, so both live on the pointer events.
   Selection cannot hang off `click`: orbiting captures the pointer and redraws
   the sheet on every move, which destroys the node that was pressed, so by the
   time a click would be dispatched there is nothing left to match. The window
   under the press is therefore recorded on pointerdown and acted on at
   pointerup, provided the press did not turn into a drag. */
const orbit = { id:null, x:0, y:0, live:false, hash:null };
const TURN_SLOP = 7;   // px travelled before a press counts as a turn, not a pick

/* The pose handlers belong to the sheet only while the sheet is drawing on.
   A reading pane is text: a drag there is a selection, and a click that hit no
   node must not clear the one the list picked. */
const drawingSheet = () => S.tool && S.tool.layout === 'spatial';

$('sheet').addEventListener('click', (e) => {
  if(drawingSheet()) return;
  const row = e.target.closest('[data-attr]');
  if(row){
    // Clicking the picked row again puts the pane back on the section.
    S.attr = S.attr === row.dataset.attr ? null : row.dataset.attr;
    return void (renderDoc(), renderDetail());
  }
  const b = e.target.closest('button[data-hash]');
  if(b) select(b.dataset.hash);
});

$('attrFilter').addEventListener('input', (e) => {
  S.attrFilter = e.target.value;
  renderDoc();
});

$('sheet').addEventListener('pointerdown', (e) => {
  if(!S.data || e.button !== 0 || !drawingSheet()) return;
  const hit = e.target.closest && e.target.closest('[data-hash]');
  orbit.id = e.pointerId;
  orbit.x = e.clientX; orbit.y = e.clientY;
  orbit.live = false;
  orbit.hash = hit ? hit.dataset.hash : null;
  orbit.region = hit && hit.dataset.region !== undefined ? hit.dataset.region : null;
  if(S.view === 'depth') $('sheet').setPointerCapture(e.pointerId);
});

$('sheet').addEventListener('pointermove', (e) => {
  if(orbit.id !== e.pointerId || S.view !== 'depth' || !drawingSheet()) return;
  const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
  if(!orbit.live){
    if(Math.hypot(dx, dy) < TURN_SLOP) return;
    orbit.live = true;
    orbit.hash = null;              // this is a turn; nothing gets picked
    orbit.region = null;
    $('sheet').classList.add('is-turning');
  }
  orbit.x = e.clientX; orbit.y = e.clientY;
  S.yaw = clamp(S.yaw + dx * 0.35, -70, 70);
  S.pitch = clamp(S.pitch - dy * 0.35, -60, 60);
  syncDepthCtl();
  renderPlan();
});

$('sheet').addEventListener('pointerup', (e) => {
  if(orbit.id !== e.pointerId || !drawingSheet()) return;
  const { live, hash, region } = orbit;
  orbit.id = null; orbit.live = false; orbit.hash = null; orbit.region = null;
  $('sheet').classList.remove('is-turning');
  if(live) return;
  if(hash) select(hash, region); else { S.selected = null; S.region = null; renderAll(); }
});

$('sheet').addEventListener('pointercancel', (e) => {
  if(orbit.id !== e.pointerId) return;
  orbit.id = null; orbit.live = false; orbit.hash = null; orbit.region = null;
  $('sheet').classList.remove('is-turning');
});
$('legend').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hash]');
  if(b) select(b.dataset.hash);
});
$('docTabs').addEventListener('click', (e) => {
  const x = e.target.closest('[data-close]');
  if(x) return closeDoc(+x.dataset.close);
  const b = e.target.closest('[data-doc]');
  if(!b) return;
  const doc = S.docs.find(d => d.id === +b.dataset.doc);
  // Clicking the open tab is how the loader gets cancelled, so it is not a
  // no-op when the app is hidden.
  if(doc && (doc.id !== S.docId || $('app').hidden)) openDoc(doc);
});
// Middle click closes a tab, as it does in a browser.
$('docTabs').addEventListener('auxclick', (e) => {
  if(e.button !== 1) return;
  const b = e.target.closest('[data-doc],[data-close]');
  if(!b) return;
  e.preventDefault();
  closeDoc(+(b.dataset.doc || b.dataset.close));
});
$('btnDocAdd').addEventListener('click', showLoader);

/* ---- the workspace strip ---- */
/* The same gestures as the dump strip below it, one level up: click to open,
   the cross to close, middle click to close, double click to rename. */
$('wspTabs').addEventListener('click', (e) => {
  const x = e.target.closest('[data-close-space]');
  if(x){
    const space = S.spaces.find(w => w.id === +x.dataset.closeSpace);
    return space && requestCloseSpace(space);
  }
  const b = e.target.closest('[data-space]');
  if(!b) return;
  const space = S.spaces.find(w => w.id === +b.dataset.space);
  // Clicking the open workspace is how the loader gets cancelled, so it is not
  // a no-op while the app is hidden.
  if(space && (space.id !== S.spaceId || $('app').hidden)) openSpace(space);
});
$('wspTabs').addEventListener('dblclick', (e) => {
  const b = e.target.closest('[data-space]'); if(!b) return;
  const space = S.spaces.find(w => w.id === +b.dataset.space);
  if(space) startRename(space);
});
$('wspTabs').addEventListener('auxclick', (e) => {
  if(e.button !== 1) return;
  const b = e.target.closest('[data-space],[data-close-space]');
  if(!b) return;
  e.preventDefault();
  const space = S.spaces.find(w => w.id === +(b.dataset.space || b.dataset.closeSpace));
  if(space) requestCloseSpace(space);
});
/* The name box is drawn into the strip, so its handlers are delegated with it
   rather than bound to an element a redraw would replace. */
$('wspTabs').addEventListener('keydown', (e) => {
  if(!e.target.closest('[data-rename]')) return;
  // The page reads Escape and / on its own; in the box they are text.
  e.stopPropagation();
  if(e.key === 'Enter'){ e.preventDefault(); endRename(true); }
  if(e.key === 'Escape'){ e.preventDefault(); endRename(false); }
});
$('wspTabs').addEventListener('focusout', (e) => {
  if(e.target.closest('[data-rename]')) endRename(true);
});
$('btnWspAdd').addEventListener('click', addSpace);
/* Anything done elsewhere puts an armed cross away. It listens on pointerdown
   rather than click because arming redraws the strip: by the time a click on
   the cross has bubbled up here its target has already been replaced, and a
   detached node cannot say what it sits inside. */
document.addEventListener('pointerdown', (e) => {
  if(armedClose !== null && !e.target.closest('[data-close-space]')) disarmClose();
});

for(const id of ['displayTabs', 'listTabs']){
  $(id).addEventListener('click', (e) => {
    const t = e.target.closest('[data-did]'); if(!t) return;
    S.displayId = +t.dataset.did; S.selected = null; S.region = null;
    renderTabs(); renderAll();
  });
}
function syncFilterBox(){
  const box = $('filter');
  const m = textMatcher(S.filter, S.regex);
  box.classList.toggle('is-bad', !!m && !m.ok);
  box.title = m && !m.ok ? m.error : '';
  $('filterRe').setAttribute('aria-pressed', String(!!S.regex));
}
$('filter').addEventListener('input', (e) => {
  S.filter = e.target.value;
  syncFilterBox();
  renderList(); renderPlan();
});
$('filterRe').addEventListener('click', () => {
  S.regex = !S.regex;
  syncFilterBox();
  renderList(); renderPlan();
});
$('optShow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-show]'); if(!b) return;
  S.show = b.dataset.show;
  renderShow(); renderList(); renderPlan();
});
$('optDim').addEventListener('change', (e) => { S.dim = e.target.checked; renderPlan(); });
$('viewTabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if(!b) return;
  setView(b.id === 'viewDepth' ? 'depth' : 'plan');
});
/* ---- the trace bar ---- */
/* Playback is the one control on this page that changes the drawing without
   changing what the drawing is of, so it moves the playhead and repaints, and
   never rebuilds the sheet. */
$('btnPlay').addEventListener('click', () => gevPlay.running ? gevStop() : gevStart());
$('rngPlay').addEventListener('input', (e) => {
  const { span } = gevClock();
  S.playAt = clamp(+e.target.value / 1000, 0, 1) * span;
  gevPaint();
});
/* Scrubbing stops the playback the way dragging a video's scrubber does. */
$('rngPlay').addEventListener('pointerdown', () => gevStop());
/* The speed and the loop are read at the moment the clock ticks, so neither
   needs a handler; the speed only drops the frame it changed on, which would
   otherwise be played at the old rate across the new one's gap. */
$('selSpeed').addEventListener('change', () => { gevPlay.last = 0; });
/* Taking a capture onto a layout. The panel opens under the bar, the text is
   read by the same reader that would have opened it as a tab of its own, and
   what comes back hangs off this document. */
function gevClosePaste(){
  $('tracePaste').dataset.open = '0';
  gevSaid('');
  gevSyncBar();
}
/* The one line under the box, which says either why the text did not read or
   what it turned out to be. */
function gevSaid(text, ok){
  const el = $('traceErr');
  el.textContent = text;
  el.classList.toggle('is-ok', !!ok && !!text);
}
/* What a capture that read says back: the drawer stays open over the text a
   paste dropped in, so the log that is playing can be read against the
   drawing it is playing on. */
function gevPasteNote(){
  const stage = gevStage();
  if(!stage) return 'Playing.';
  const { span } = gevClock(stage);
  const n = stage.nodes.length;
  return `Playing ${n} stroke${n === 1 ? '' : 's'}${
    span ? ' · ' + gevMs(span) : ' · no timestamps'}.`;
}
/* Reading what is in the box. The text is kept either way — the drawer is how
   a capture is looked at again, and a box emptied behind the reader's back
   left `Play it` with nothing to read. */
function gevTake(close){
  const text = $('traceText').value;
  /* Nothing in the box and something already playing: the hand that emptied it
     meant to close the drawer, not to be told there is no capture in it. */
  if(!text.trim() && S.trace){ if(close) gevClosePaste(); return; }
  const bad = gevAttach(text);
  if(bad) return gevSaid(bad);
  renderPlan(); renderDetail();
  if(close) return gevClosePaste();
  gevSaid(gevPasteNote(), true);
  gevSyncBar();
}
$('btnTracePaste').addEventListener('click', () => {
  const panel = $('tracePaste');
  panel.dataset.open = panel.dataset.open === '1' ? '0' : '1';
  gevSaid('');
  gevSyncBar();
  if(panel.dataset.open === '1') $('traceText').focus();
});
$('btnTraceCancel').addEventListener('click', () => gevClosePaste());
$('btnTraceAttach').addEventListener('click', () => gevTake(true));
/* Pasting into the box is the whole gesture, so it is also the button: a
   capture dropped in plays without a second click. The drawer is left open on
   the text it read, because a drawer that shut itself on a log nobody had seen
   yet read as the paste having gone nowhere. */
$('traceText').addEventListener('paste', () => {
  setTimeout(() => gevTake(false), 0);
});
$('btnTraceDrop').addEventListener('click', () => gevDetach());
$('selTraceDev').addEventListener('change', (e) => {
  gevStop();
  S.traceDev = +e.target.value;
  S.playAt = 0;
  renderPlan(); renderDetail();
});
$('selMap').addEventListener('change', (e) => {
  S.mapTo = e.target.value || null;
  /* A display of its own is a turn of its own: whatever the last one was
     turned to by hand is not this one's answer. */
  S.mapTurn = null;
  renderPlan(); renderDetail();
});
$('btnMapRot').addEventListener('click', () => {
  S.mapTurn = (gevStageTurn() + 90) % 360;
  renderPlan(); renderDetail();
});

$('rngYaw').addEventListener('input', (e) => { S.yaw = +e.target.value; renderPlan(); });
$('rngPitch').addEventListener('input', (e) => { S.pitch = +e.target.value; renderPlan(); });
$('rngSep').addEventListener('input', (e) => { S.sep = +e.target.value; renderPlan(); });
$('btnResetView').addEventListener('click', resetView);
$('btnNew').addEventListener('click', showLoader);
$('tabStack').addEventListener('click', () => {
  document.body.classList.add('show-stack');
  $('tabStack').setAttribute('aria-pressed','true'); $('tabPlan').setAttribute('aria-pressed','false');
});
$('tabPlan').addEventListener('click', () => {
  document.body.classList.remove('show-stack');
  $('tabStack').setAttribute('aria-pressed','false'); $('tabPlan').setAttribute('aria-pressed','true');
  refit();
});
/* ---------------- events: theme ---------------- */
/* Three settings, one button: follow the system, or pin light or dark. The
   head script has already stamped the resolved theme on <html>; this only has
   to keep that stamp honest when the choice or the system preference moves. */
const THEMES = ['system', 'light', 'dark'];
const THEME_LABEL = { system:'system', light:'light', dark:'dark' };
const prefersLight = matchMedia('(prefers-color-scheme: light)');
let themeMode = 'system';
try {
  const stored = localStorage.getItem('telltale.theme') || localStorage.getItem('oriel.theme');
  if(THEMES.includes(stored)) themeMode = stored;
  // Carry the old key over on first run under the new name, then drop it.
  if(stored && !localStorage.getItem('telltale.theme')) localStorage.setItem('telltale.theme', stored);
  localStorage.removeItem('oriel.theme');
} catch(e) {}

function applyTheme(){
  const resolved = themeMode === 'system' ? (prefersLight.matches ? 'light' : 'dark') : themeMode;
  document.documentElement.dataset.theme = resolved;
  const b = $('btnTheme');
  b.textContent = THEME_LABEL[themeMode];
  const label = themeMode === 'system'
    ? `Theme: following the system (${resolved})` : `Theme: ${themeMode}`;
  b.title = label + ' — click to change';
  b.setAttribute('aria-label', label);
}

$('btnTheme').addEventListener('click', () => {
  themeMode = THEMES[(THEMES.indexOf(themeMode) + 1) % THEMES.length];
  try { localStorage.setItem('telltale.theme', themeMode); } catch(e) {}
  applyTheme();
});
prefersLight.addEventListener('change', () => { if(themeMode === 'system') applyTheme(); });
applyTheme();

/* ---------------- events: flag tooltips ---------------- */
/* Flag chips carry the official text for the flag they name — the
   WindowManager.LayoutParams javadoc for a window flag, the layer_state_t
   comment for a SurfaceFlinger one. Hover shows it; so does focus, so a
   keyboard walk reads the same. */
const tip = $('tip');
let tipFor = null;

function tipHtml(name, f, src){
  const tag = f.h === 2 ? '<span class="tip-tag">@SystemApi</span>'
            : f.h === 1 ? '<span class="tip-tag">@hide</span>' : '';
  return `<div class="tip-head">
      <span class="tip-name">${esc(name)}</span>
      ${f.v ? `<span class="tip-val">${esc(f.v)}</span>` : ''}
    </div>
    <div class="tip-const">${esc(f.c)}${tag}</div>
    <p class="tip-doc">${esc(f.d)}</p>
    ${f.x ? `<p class="tip-dep">Deprecated. ${esc(f.x)}</p>` : ''}
    <div class="tip-src">${esc(src)}</div>`;
}

function placeTip(el){
  // Measure from the corner, so a chip near the right edge does not reflow it.
  tip.style.left = '0px'; tip.style.top = '0px';
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), m = 8;
  let top = r.top - t.height - 6;
  if(top < m) top = r.bottom + 6;          // no room above: sit under the chip
  tip.style.left = clamp(r.left, m, Math.max(m, innerWidth - t.width - m)) + 'px';
  tip.style.top = clamp(top, m, Math.max(m, innerHeight - t.height - m)) + 'px';
}

function showTip(el){
  const set = DOC_SETS[el.dataset.flagset] || DOC_SETS.wm;
  const f = set.docs()[el.dataset.flag];
  if(!f || tipFor === el) return;
  tipFor = el;
  tip.innerHTML = tipHtml(el.dataset.flag, f, set.src);
  tip.hidden = false;
  placeTip(el);
}

function hideTip(){
  if(!tipFor) return;
  tipFor = null; tip.hidden = true;
}

$('detail').addEventListener('click', (e) => {
  /* A tag or a pid in the pane is the narrowing a log reader does next, so it
     is typed into the filter box rather than opening anything of its own —
     the box is where it can then be edited or cleared. */
  const tag = e.target.closest('[data-logtag]');
  if(tag){
    S.filter = tag.dataset.logtag;
    $('filter').value = S.filter;
    return void renderAll();
  }
  /* A rect's row and the rect on the sheet are the same pick seen from two
     sides, so clicking the row marks the rect — and clicking the marked row
     again puts the drawing back to the whole node. */
  const row = e.target.closest('[data-region]');
  if(row){
    const i = +row.dataset.region;
    S.region = S.region === i ? null : i;
    return void (renderPlan(), renderDetail());
  }
  const b = e.target.closest('button[data-hash]');
  if(b) select(b.dataset.hash);
});
/* The row is a button, so the keys a button answers to work on it. */
$('detail').addEventListener('keydown', (e) => {
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest && e.target.closest('[data-region]');
  if(!row) return;
  e.preventDefault();
  const i = +row.dataset.region;
  S.region = S.region === i ? null : i;
  renderPlan(); renderDetail();
});
$('detail').addEventListener('pointerover', (e) => {
  const c = e.target.closest('[data-flag]');
  if(c) showTip(c); else hideTip();
});
$('detail').addEventListener('pointerleave', hideTip);
$('detail').addEventListener('focusin', (e) => {
  const c = e.target.closest('[data-flag]');
  if(c) showTip(c);
});
$('detail').addEventListener('focusout', hideTip);
addEventListener('scroll', hideTip, true);
addEventListener('resize', hideTip);

/* ---------------- events: pane resizing ---------------- */
// Only a fallback: the live defaults are the CSS custom properties above.
const PANE0 = { stack:380, detail:420 };
const PANE_MIN = { stack:200, detail:220, plan:280 };

function paneWidth(which){
  const v = getComputedStyle($('app')).getPropertyValue('--w-' + which);
  return parseFloat(v) || PANE0[which];
}

/* Going back to the default means dropping the override, not writing the
   numbers out again — CSS holds them, and they vary with the window. */
function resetPaneWidth(which){
  $('app').style.removeProperty('--w-' + which);
  refit();
}

/* A drag is a preference, not a gesture, so the widths outlive the tab. Only a
   width the user actually set is written down: the defaults stay in CSS, where
   they can go on varying with the layout and the window. */
const PANE_KEY = 'telltale.panes';

function savePanes(){
  const out = {};
  for(const which of ['stack','detail']){
    const v = $('app').style.getPropertyValue('--w-' + which);
    if(v) out[which] = Math.round(parseFloat(v));
  }
  try {
    if(Object.keys(out).length) localStorage.setItem(PANE_KEY, JSON.stringify(out));
    else localStorage.removeItem(PANE_KEY);
  } catch(e) {}
}

/* Restoring writes the numbers straight through rather than going by way of
   setPaneWidth: #app is still hidden here and so has no width to clamp
   against. openDoc clamps them once it does. */
function restorePanes(){
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PANE_KEY) || 'null'); } catch(e) {}
  if(!saved || typeof saved !== 'object') return;
  for(const which of ['stack','detail']){
    const n = +saved[which];
    if(n >= PANE_MIN[which]) $('app').style.setProperty('--w-' + which, n + 'px');
  }
}

/* A width saved on a wide screen has to fit the window it is opened in. Two
   that no longer fit together are dropped rather than squeezed: clamping them
   in turn spends the whole window on the first one and pins the second to its
   minimum, which is not a layout anyone chose. */
function clampPanes(){
  const set = ['stack','detail'].filter(w => $('app').style.getPropertyValue('--w-' + w));
  if(!set.length) return;
  const total = $('app').clientWidth;
  if(!total) return;
  const want = set.reduce((n, w) => n + paneWidth(w), 0)
             + (set.length < 2 ? paneWidth(set[0] === 'stack' ? 'detail' : 'stack') : 0);
  if(want + PANE_MIN.plan + 14 > total){
    set.forEach(resetPaneWidth);
    savePanes();
    return;
  }
  set.forEach(w => setPaneWidth(w, paneWidth(w)));
}

function setPaneWidth(which, px){
  const total = $('app').clientWidth;
  const other = which === 'stack' ? paneWidth('detail') : paneWidth('stack');
  // Leave the plan pane room; on narrow screens the detail pane is not laid out.
  const shown = which === 'detail' || window.innerWidth > 1080 ? other : 0;
  const max = Math.max(PANE_MIN[which], total - shown - PANE_MIN.plan - 14);
  const w = Math.min(Math.max(px, PANE_MIN[which]), max);
  $('app').style.setProperty('--w-' + which, w + 'px');
  refit();
}

for(const [id, which] of [['gutterL','stack'], ['gutterR','detail']]){
  const el = $(id);
  let from = 0, at = 0;
  el.addEventListener('pointerdown', (e) => {
    if(e.button !== 0) return;
    from = e.clientX; at = paneWidth(which);
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-drag');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if(!el.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - from;
    setPaneWidth(which, which === 'stack' ? at + dx : at - dx);
  });
  const stop = (e) => {
    if(el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.remove('is-drag');
    savePanes();
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('dblclick', () => { resetPaneWidth(which); savePanes(); });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 48 : 16;
    if(e.key === 'ArrowLeft') { e.preventDefault(); setPaneWidth(which, paneWidth(which) + (which === 'stack' ? -step : step)); }
    if(e.key === 'ArrowRight'){ e.preventDefault(); setPaneWidth(which, paneWidth(which) + (which === 'stack' ? step : -step)); }
    if(e.key === 'Home')      { e.preventDefault(); resetPaneWidth(which); }
    if(['ArrowLeft','ArrowRight','Home'].includes(e.key)) savePanes();
  });
}

restorePanes();

window.addEventListener('resize', refit);
if(window.ResizeObserver) new ResizeObserver(refit).observe($('sheet'));

$('btnFind').addEventListener('click', openFind);
$('findBox').addEventListener('input', () => { findAt = 0; renderFind(); });
$('findRe').addEventListener('click', () => {
  findRegex = !findRegex;
  $('findRe').setAttribute('aria-pressed', String(findRegex));
  findAt = 0;
  renderFind();
  $('findBox').focus();
});
$('findBox').addEventListener('keydown', (e) => {
  if(e.key === 'ArrowDown'){ e.preventDefault(); moveFind(1); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); moveFind(-1); }
  else if(e.key === 'Enter'){
    e.preventDefault();
    const hit = findFlat[findAt];
    if(hit) goToHit(hit);
  }
});
$('findResults').addEventListener('click', (e) => {
  const b = e.target.closest('.find-hit');
  if(!b) return;
  const hit = findFlat[+b.dataset.at];
  if(hit) goToHit(hit);
});
/* Clicking the page behind the card is asking for the page back. On click
   rather than mousedown: the backdrop is still what the release lands on, so
   the same gesture cannot go on to pick a row underneath. */
$('find').addEventListener('click', (e) => { if(e.target === $('find')) closeFind(); });

document.addEventListener('keydown', (e) => {
  /* While the card is up it owns the keyboard: nothing below it should be
     stepping tabs or clearing selections under a search. */
  if(!$('find').hidden){
    if(e.key === 'Escape'){ e.preventDefault(); closeFind(); }
    return;
  }
  if((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')){
    e.preventDefault(); openFind();
  }
  if(e.key === 'Escape'){
    if(armedClose !== null) disarmClose();
    else if(!$('empty').hidden && S.docs.length) openDoc(currentDoc() || S.docs[S.docs.length - 1]);
    else if(document.body.classList.contains('show-detail')) document.body.classList.remove('show-detail');
    else if(S.selected){ S.selected = null; S.region = null; renderAll(); }
  }
  if(e.key === '/' && !$('app').hidden && !typingInField()){
    e.preventDefault(); $('filter').focus();
  }
  /* Space plays a trace, as it does in every other thing that plays. Only
     where there is one: everywhere else it is the key that scrolls. */
  if(e.key === ' ' && !$('app').hidden && !typingInField() && gevStage()){
    e.preventDefault();
    if(gevPlay.running) gevStop(); else gevStart();
  }
  /* Alt+shift+arrow moves between workspaces. Arrows rather than digits
     because alt with a digit does not survive every keyboard layout, and the
     workspaces are a ring worth stepping round. */
  if(e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey
     && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && S.spaces.length > 1){
    e.preventDefault();
    const n = S.spaces.length;
    const i = S.spaces.findIndex(w => w.id === S.spaceId);
    openSpace(S.spaces[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n]);
  }
  // Alt+1…9 picks a tab, and alt+0 the last one, as a browser does.
  if(e.altKey && !e.ctrlKey && !e.metaKey && /^[0-9]$/.test(e.key) && S.docs.length){
    const doc = e.key === '0' ? S.docs[S.docs.length - 1] : S.docs[+e.key - 1];
    if(doc){ e.preventDefault(); openDoc(doc); }
  }
});

/* file + paste + drop */
$('btnPick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => {
  const f = e.target.files[0]; if(!f) return;
  openFile(f);
  e.target.value = '';
});

/* One file, however it arrived. A zip is opened to the dump inside it, and
   which entry that was is said on the way in — a bugreport zip holds a dozen
   files and only one of them is the dump. */
function openFile(f){
  note('');
  progress(`Reading ${f.name}`, null);
  return readDump(f)
    .then(({ text, label, from }) => {
      if(!text.trim()) return fail(`${f.name} is empty.`);
      if(from) note(`Read ${from} out of ${f.name}.`);
      return load(text, null, from || label, from ? f.name : null);
    })
    .catch((err) => fail(`${f.name} could not be read${err && err.message ? ': ' + err.message : '.'}`))
    .finally(progressDone);
}
$('btnPaste').addEventListener('click', () => {
  const card = document.querySelector('.sheet-blank');
  if($('pasteArea')) { $('pasteArea').focus(); return; }
  const wrap = document.createElement('div');
  wrap.className = 'extra-panel';
  wrap.style.marginTop = '16px';
  wrap.innerHTML = `<textarea class="pastebox" id="pasteArea" placeholder="Paste the dumpsys window output" aria-label="Paste dump text"></textarea>
    <div style="margin-top:10px"><button class="btn-paper btn-paper-key" id="btnPasteGo" type="button">Show the layout</button></div>`;
  card.appendChild(wrap);
  $('pasteArea').focus();
  $('btnPasteGo').onclick = () => {
    const v = $('pasteArea').value;
    if(v.trim()) load(v, null, 'pasted text'); else fail('Paste the dump text first.');
  };
});
document.addEventListener('paste', (e) => {
  // Only on the loader screen: with a dump open the page has its own inputs
  // and a paste is meant for one of them.
  if($('empty').hidden) return;
  if(typingInField()) return;
  const t = e.clipboardData && e.clipboardData.getData('text');
  if(!t || !t.trim()) return;
  e.preventDefault();
  // A lone URL on the clipboard is an address, not a dump.
  if(URL_RE.test(t.trim())) loadUrl(t.trim()); else load(t, null, 'pasted text');
});

$('btnUrl').addEventListener('click', () => {
  if($('urlArea')){ $('urlArea').focus(); return; }
  const wrap = document.createElement('div');
  wrap.className = 'extra-panel';
  wrap.style.marginTop = '16px';
  wrap.innerHTML = `<input class="urlbox" id="urlArea" type="url" spellcheck="false"
      placeholder="https://example.com/windows.txt" aria-label="URL of a dump to fetch">
    <div style="margin-top:10px"><button class="btn-paper btn-paper-key" id="btnUrlGo" type="button">Fetch and show</button></div>`;
  document.querySelector('.sheet-blank').appendChild(wrap);
  $('urlArea').focus();
  $('urlArea').addEventListener('keydown', (e) => { if(e.key === 'Enter') loadUrl($('urlArea').value); });
  $('btnUrlGo').onclick = () => loadUrl($('urlArea').value);
});
['dragenter','dragover'].forEach(t => document.addEventListener(t, (e) => {
  e.preventDefault(); document.body.classList.add('dragging');
}));
['dragleave','drop'].forEach(t => document.addEventListener(t, (e) => {
  if(t === 'dragleave' && e.relatedTarget) return;
  document.body.classList.remove('dragging');
}));
/* Dropping opens a tab, so a second file lands beside the first rather than
   replacing it. Several files at once open several tabs, left to right. */
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
  if(files.length){
    files.reduce((p, f) => p.then(() => openFile(f)), Promise.resolve());
    return;
  }
  const t = e.dataTransfer.getData('text');
  if(!t || !t.trim()) return;
  if(URL_RE.test(t.trim())) loadUrl(t.trim()); else load(t, null, 'dropped text');
});
$('btnSample').addEventListener('click', () => load(SAMPLE, null, 'window sample'));

/* ?url= (or #url=) opens a dump straight from a link, and ?tool= says which
   section of it to open when the dump holds more than one. Repeating ?url=
   opens one tab per dump, fetched in the order the link names them so the
   tabs come out in that order too. */
(function openFromLink(){
  const fromHash = location.hash.startsWith('#') ? new URLSearchParams(location.hash.slice(1)) : null;
  const q = new URLSearchParams(location.search);
  const get = (k) => q.get(k) || (fromHash && fromHash.get(k));
  const hrefs = q.getAll('url').concat(fromHash ? fromHash.getAll('url') : []);
  const tool = get('tool');
  hrefs.reduce((p, href) => p.then(() => loadUrl(href, tool)), Promise.resolve());
})();

const SAMPLE = "WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)\n  Display: mDisplayId=0 rootDisplayAreaId=0\n    init=1080x2340 420dpi cur=1080x2340 app=1080x2210 rng=1080x1005-2210x2135\n    deferred=false mLayoutNeeded=false\n    mCurrentFocus=Window{a1b2c3 u0 com.example.player/com.example.player.MainActivity}\n    mFocusedApp=ActivityRecord{7f3e2d u0 com.example.player/.MainActivity t42}\n\nWINDOW MANAGER WINDOWS (dumpsys window windows)\n  Window #6 Window{c0ffee1 u0 NavigationBar0}:\n    mDisplayId=0 rootTaskId=-1 mSession=Session{9a1b2c 1234:1000} mClient=android.os.BinderProxy@33aa11\n    mOwnerUid=1000 showForAllUsers=true package=com.android.systemui appop=NONE\n    mAttrs={(0,0)(fillx132) gr=BOTTOM sim={adjust=pan} ty=NAVIGATION_BAR fmt=TRANSLUCENT\n      fl=NOT_FOCUSABLE NOT_TOUCH_MODAL TOUCHABLE_WHEN_WAKING SPLIT_TOUCH HARDWARE_ACCELERATED\n      pfl=COLOR_SPACE_AGNOSTIC FIT_INSETS_CONTROLLED}\n    Requested w=1080 h=132 mLayoutSeq=1085\n    mBaseLayer=231000 mSubLayer=0    mToken=WindowToken{4b5c6d type=2019}\n    mViewVisibility=0x0 mHaveFrame=true mObscured=false\n    mHasSurface=true isReadyForDisplay()=true mWindowRemovalAllowed=false\n    Frames: containing=[0,0][1080,2340] parent=[0,2208][1080,2340]\n        display=[0,0][1080,2340]\n        frame=[0,2208][1080,2340] last=[0,2208][1080,2340]\n    isOnScreen=true\n    isVisible=true\n\n  Window #5 Window{beef002 u0 StatusBar}:\n    mDisplayId=0 rootTaskId=-1 mSession=Session{9a1b2c 1234:1000} mClient=android.os.BinderProxy@44bb22\n    mOwnerUid=1000 showForAllUsers=true package=com.android.systemui appop=NONE\n    mAttrs={(0,0)(fillx130) gr=TOP sim={adjust=pan} ty=STATUS_BAR fmt=TRANSLUCENT\n      fl=NOT_FOCUSABLE SPLIT_TOUCH HARDWARE_ACCELERATED}\n    Requested w=1080 h=130 mLayoutSeq=1085\n    mBaseLayer=181000 mSubLayer=0    mToken=WindowToken{5c6d7e type=2000}\n    mViewVisibility=0x0 mHaveFrame=true mObscured=false\n    mHasSurface=true isReadyForDisplay()=true\n    mFrame=[0,0][1080,130] last=[0,0][1080,130]\n    isOnScreen=true\n    isVisible=true\n\n  Window #4 Window{d00d003 u0 InputMethod}:\n    mDisplayId=0 rootTaskId=-1 mSession=Session{7c8d9e 2345:10122} mClient=android.os.BinderProxy@55cc33\n    mOwnerUid=10122 showForAllUsers=false package=com.google.android.inputmethod.latin appop=NONE\n    mAttrs={(0,0)(fillx866) gr=BOTTOM CENTER_VERTICAL sim={adjust=pan} ty=INPUT_METHOD fmt=TRANSPARENT\n      fl=NOT_FOCUSABLE LAYOUT_IN_SCREEN SPLIT_TOUCH HARDWARE_ACCELERATED}\n    Requested w=1080 h=866 mLayoutSeq=1080\n    mBaseLayer=151000 mSubLayer=0    mToken=WindowToken{6d7e8f type=2011}\n    mViewVisibility=0x8 mHaveFrame=true mObscured=false\n    mHasSurface=false isReadyForDisplay()=false\n    mFrame=[0,1474][1080,2340] last=[0,1474][1080,2340]\n    isOnScreen=false\n    isVisible=false\n\n  Window #3 Window{a1b2c3 u0 com.example.player/com.example.player.MainActivity}:\n    mDisplayId=0 rootTaskId=42 mSession=Session{1a2b3c 3456:10233} mClient=android.os.BinderProxy@66dd44\n    mOwnerUid=10233 showForAllUsers=false package=com.example.player appop=NONE\n    mAttrs={(0,0)(fillxfill) sim={adjust=resize} ty=BASE_APPLICATION fmt=TRANSLUCENT\n      fl=LAYOUT_IN_SCREEN LAYOUT_INSET_DECOR SPLIT_TOUCH HARDWARE_ACCELERATED DRAWS_SYSTEM_BAR_BACKGROUNDS}\n    Requested w=1080 h=2340 mLayoutSeq=1085\n    mBaseLayer=21000 mSubLayer=0    mToken=ActivityRecord{7f3e2d u0 com.example.player/.MainActivity t42}\n    mViewVisibility=0x0 mHaveFrame=true mObscured=false\n    mGlobalScale=1.0\n    mHasSurface=true isReadyForDisplay()=true\n    Frames: containing=[0,0][1080,2340] parent=[0,0][1080,2340]\n        display=[0,0][1080,2340]\n        frame=[0,0][1080,2340] last=[0,0][1080,2340]\n        content=[0,130][1080,2208] visible=[0,130][1080,2208]\n    isOnScreen=true\n    isVisible=true\n\n  Window #2 Window{f00d004 u0 PopupWindow:1a2b3c}:\n    mDisplayId=0 rootTaskId=42 mSession=Session{1a2b3c 3456:10233} mClient=android.os.BinderProxy@77ee55\n    mOwnerUid=10233 showForAllUsers=false package=com.example.player appop=NONE\n    mAttrs={(120,640)(840x520) gr=LEFT TOP sim={adjust=pan} ty=APPLICATION_SUB_PANEL fmt=TRANSLUCENT\n      fl=ALT_FOCUSABLE_IM SPLIT_TOUCH HARDWARE_ACCELERATED}\n    Requested w=840 h=520 mLayoutSeq=1085\n    mBaseLayer=21000 mSubLayer=1    mToken=ActivityRecord{7f3e2d u0 com.example.player/.MainActivity t42}\n    mViewVisibility=0x0 mHaveFrame=true mObscured=false\n    mHasSurface=true isReadyForDisplay()=true\n    mFrame=[120,640][960,1160] last=[120,640][960,1160]\n    isOnScreen=true\n    isVisible=true\n\n  Window #1 Window{cafe005 u0 com.android.systemui.ImageWallpaper}:\n    mDisplayId=0 rootTaskId=-1 mSession=Session{9a1b2c 1234:1000} mClient=android.os.BinderProxy@88ff66\n    mOwnerUid=1000 showForAllUsers=true package=com.android.systemui appop=NONE\n    mAttrs={(0,0)(fillxfill) gr=CENTER sim={adjust=pan} ty=WALLPAPER fmt=RGB_565\n      fl=NOT_FOCUSABLE SCALED NOT_TOUCH_MODAL LAYOUT_IN_SCREEN LAYOUT_NO_LIMITS}\n    Requested w=1080 h=2340 mLayoutSeq=1085\n    mBaseLayer=11000 mSubLayer=0    mToken=WallpaperWindowToken{8f9a0b}\n    mViewVisibility=0x0 mHaveFrame=true mObscured=true\n    mHasSurface=true isReadyForDisplay()=true\n    mFrame=[0,0][1080,2340] last=[0,0][1080,2340]\n    isOnScreen=true\n    isVisible=true\n\n  Window #0 Window{dead006 u0 com.example.old/com.example.old.SplashActivity EXITING}:\n    mDisplayId=0 rootTaskId=41 mSession=Session{2b3c4d 4567:10244} mClient=android.os.BinderProxy@99aa77\n    mOwnerUid=10244 showForAllUsers=false package=com.example.old appop=NONE\n    mAttrs={(0,0)(fillxfill) sim={adjust=resize} ty=BASE_APPLICATION fmt=OPAQUE\n      fl=LAYOUT_IN_SCREEN SPLIT_TOUCH}\n    Requested w=1080 h=2340 mLayoutSeq=1071\n    mBaseLayer=21000 mSubLayer=0    mToken=ActivityRecord{6e5d4c u0 com.example.old/.SplashActivity t41}\n    mViewVisibility=0x8 mHaveFrame=true mObscured=true\n    mAnimatingExit=true mRemoveOnExit=true\n    mHasSurface=false isReadyForDisplay()=false\n    mFrame=[0,0][1080,2340] last=[0,0][1080,2340]\n    isOnScreen=false\n    isVisible=false\n\n  mGlobalConfiguration={1.0 ?mcc?mnc [en_US] ldltr sw411dp w411dp h842dp 420dpi nrml long port}\n  mCurrentFocus=Window{a1b2c3 u0 com.example.player/com.example.player.MainActivity}\n  mFocusedApp=ActivityRecord{7f3e2d u0 com.example.player/.MainActivity t42}\n  imeLayeringTarget=Window{a1b2c3 u0 com.example.player/com.example.player.MainActivity}\n";
