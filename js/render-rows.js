/* ---------------- render: a list too long to put in the DOM ------------- */

/* A log is three hundred thousand lines and the pane shows forty of them. Rows
   for the rest are not built: what is in the DOM is the slice around the
   scroll position, with one spacer above it and one below standing in for the
   height of everything that is not there. So the scrollbar is the length of
   the log, the search is over all of it, and the browser is only ever laying
   out a screenful.

   This is worth its complexity for exactly one kind of list — one where the
   rows are uniform, tiny and beyond counting — which is why it is reached only
   through `tool.row` and everything else still renders whole. */
const rowWin = { nodes: [], rowH: 22, key: '', from: 0, to: 0,
                 pending: false, measured: false };

/* Rows either side of the fold, so a flick of the wheel lands on rows that are
   already there rather than on blank paper. */
const ROW_WIN_PAD = 24;

function renderRowWindow(nodes){
  rowWin.nodes = nodes;
  /* Which list this is. A different one — another buffer, another filter,
     another dump — starts at the top; the same one redrawn (a row was picked)
     stays where the reader had scrolled it to. */
  const key = `${S.toolId}|${S.displayId}|${S.show}|${S.filter}|${nodes.length}`;
  const fresh = key !== rowWin.key;
  rowWin.key = key;
  if(fresh){ $('stackScroll').scrollTop = 0; rowWin.measured = false; }
  paintRowWindow();
}

function paintRowWindow(){
  const list = $('wlist'), box = $('stackScroll');
  const nodes = rowWin.nodes;
  const h = rowWin.rowH;
  const view = box.clientHeight || 600;
  const top = box.scrollTop;
  const from = Math.max(0, Math.floor(top / h) - ROW_WIN_PAD);
  const to = Math.min(nodes.length, Math.ceil((top + view) / h) + ROW_WIN_PAD);

  const rows = [];
  for(let i = from; i < to; i++){
    const w = nodes[i];
    rows.push(`<li class="wrow${i % 2 ? ' is-alt' : ''} ${
        S.tool.rowClass ? S.tool.rowClass(w) : ''}"
      role="option" tabindex="0" data-hash="${esc(w.hash)}" data-i="${i}"
      aria-posinset="${i + 1}" aria-setsize="${nodes.length}"
      aria-selected="${S.selected === w.hash}">${S.tool.row(w)}</li>`);
  }
  list.innerHTML = `<li class="row-gap" style="height:${from * h}px"></li>`
    + rows.join('')
    + `<li class="row-gap" style="height:${(nodes.length - to) * h}px"></li>`;
  rowWin.from = from; rowWin.to = to;

  /* The spacers are in row heights, so the height a row actually has is worth
     knowing. It is read back off the first one drawn rather than assumed from
     the stylesheet — and read once per list, because a height that disagreed
     with itself between two paints would repaint for ever. */
  if(!rowWin.measured){
    rowWin.measured = true;
    const first = list.querySelector('.wrow');
    const got = first ? Math.round(first.getBoundingClientRect().height) : 0;
    if(got && got !== rowWin.rowH){ rowWin.rowH = got; paintRowWindow(); }
  }
}

/* A repaint throws the rows away and builds them again, which takes any text
   selection with it. That is nothing while reading and everything while
   dragging a selection across the rows to copy them: a drag that reaches the
   bottom of the pane scrolls it, and the scroll would wipe what had been
   selected so far. So a drag holds the window still. What is under the fold
   is off the end of the drawn slice anyway; the next scroll after the button
   comes up paints it back. */
let rowDrag = false;
$('wlist').addEventListener('mousedown', (e) => { if(e.button === 0) rowDrag = true; });
document.addEventListener('mouseup', () => {
  if(!rowDrag) return;
  rowDrag = false;
  /* A drag that selected nothing was a click, and the window it held still
     is stale by however far the pane scrolled under it. */
  const sel = window.getSelection();
  if(!S.tool || !S.tool.row || (sel && !sel.isCollapsed)) return;
  const box = $('stackScroll'), h = rowWin.rowH;
  const from = Math.floor(box.scrollTop / h);
  const to = Math.ceil((box.scrollTop + (box.clientHeight || 600)) / h);
  if(from < rowWin.from || to > rowWin.to) paintRowWindow();
});

/* Scrolling repaints, at most once a frame. */
$('stackScroll').addEventListener('scroll', () => {
  if(!S.data || !S.tool || !S.tool.row || rowWin.pending || rowDrag) return;
  rowWin.pending = true;
  requestAnimationFrame(() => {
    rowWin.pending = false;
    /* Nothing to do while the fold is still inside the slice that is drawn. */
    const box = $('stackScroll'), h = rowWin.rowH;
    const from = Math.floor(box.scrollTop / h);
    const to = Math.ceil((box.scrollTop + (box.clientHeight || 600)) / h);
    if(from >= rowWin.from && to <= rowWin.to) return;
    paintRowWindow();
  });
});
