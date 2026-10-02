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
/* `marks` runs alongside `nodes`: what each row is besides a line — for a log
   being narrowed, whether this is one of the lines that matched. It is a
   parallel array rather than a flag on the node because it is about this
   listing of the log and not about the line. */
const rowWin = { nodes: [], marks: [], rowH: 22, key: '', from: 0, to: 0,
                 pending: false, measured: false, anchor: -1, move: false };

/* Rows either side of the fold, so a flick of the wheel lands on rows that are
   already there rather than on blank paper. */
const ROW_WIN_PAD = 24;

function renderRowWindow(items){
  const nodes = items.map(i => i.node);
  rowWin.nodes = nodes;
  /* A rail on the lines the box found, so that a log being narrowed can be
     read down as well as through the results under it. Nothing is marked while
     nothing is being looked for: a rail down every row says nothing. */
  rowWin.marks = items.some(i => i.match)
    ? items.map(i => i.match ? ' is-match' : '') : items.map(() => '');
  /* Which list this is. A different one — another buffer, another filter,
     another dump — starts at the top; the same one redrawn (a row was picked)
     stays where the reader had scrolled it to. A split reader's list follows
     the level buttons, which are asking for a different log, but not the box,
     which is searching the one it has — so the log does not move about under
     what is being typed into it. */
  const narrowed = S.tool.split ? S.show : `${S.show}|${S.filter}`;
  const key = `${S.toolId}|${S.displayId}|${narrowed}|${nodes.length}`;
  const fresh = key !== rowWin.key;
  rowWin.key = key;
  if(fresh){
    /* A new list starts at the top, except when the row that was picked is in
       it: the line the reader selected out of the last one is the line they
       are still reading, so the new list opens around it rather than at line
       one. */
    rowWin.anchor = S.selected ? nodes.findIndex(n => n.hash === S.selected) : -1;
    rowWin.measured = false;
    rowWin.move = true;
  }
  paintRowWindow();
}

/* Where the pane has to be scrolled to for row `i` to sit in the middle of it,
   clamped to the ends so the first and last rows are not scrolled past. */
function rowWinTop(i){
  const box = $('stackScroll'), h = rowWin.rowH;
  const view = box.clientHeight || 600;
  const end = Math.max(0, rowWin.nodes.length * h - view);
  return Math.min(end, Math.max(0, Math.round(i * h - (view - h) / 2)));
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
        S.tool.rowClass ? S.tool.rowClass(w) : ''}${rowWin.marks[i] || ''}"
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
    /* A height that disagrees with what the spacers were drawn in is worth
       one more paint, and the move that is still pending is made in the new
       height rather than the assumed one. */
    if(got && got !== rowWin.rowH){ rowWin.rowH = got; return paintRowWindow(); }
  }

  /* Where a new list is put. This can only happen after the rows are in: until
     they are, the pane is as tall as the list that is going — the spacers are
     the old one's lengths — and a browser clamps a scrollTop to the content it
     has, so a move made before the paint lands at the end of the old list
     instead of on the row. Clearing a filter is where that shows: typing the
     query away crawls there over one input event per keystroke, and the box's
     own clear button jumps in one and stops short. */
  if(rowWin.move){
    rowWin.move = false;
    const want = rowWin.anchor < 0 ? 0 : rowWinTop(rowWin.anchor);
    if(Math.abs(box.scrollTop - want) >= 1){
      box.scrollTop = want;
      paintRowWindow();
    }
  }
}

/* How much of the list the pane is over, in rows, clamped to the list itself:
   a pane taller than the log is still only as much log as there is. Unclamped,
   a short list reports a fold past its own end and the two handlers below then
   rebuild the rows on every scroll and every mouse-up — and a rebuild between a
   mousedown and the click it belongs to throws away the element that was
   pressed, so the click retargets to their common ancestor and lands on
   nothing. A row in a short list could not be picked by clicking it. */
function rowWinSpan(){
  const box = $('stackScroll'), h = rowWin.rowH, n = rowWin.nodes.length;
  return { from: Math.min(n, Math.floor(box.scrollTop / h)),
           to: Math.min(n, Math.ceil((box.scrollTop + (box.clientHeight || 600)) / h)) };
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
  const { from, to } = rowWinSpan();
  if(from < rowWin.from || to > rowWin.to) paintRowWindow();
});

/* Scrolling repaints, at most once a frame. */
$('stackScroll').addEventListener('scroll', () => {
  if(!S.data || !S.tool || !S.tool.row || rowWin.pending || rowDrag) return;
  rowWin.pending = true;
  requestAnimationFrame(() => {
    rowWin.pending = false;
    /* Nothing to do while the fold is still inside the slice that is drawn. */
    const { from, to } = rowWinSpan();
    if(from >= rowWin.from && to <= rowWin.to) return;
    paintRowWindow();
  });
});
