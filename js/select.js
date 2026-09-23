/* ---------------- selectors over the parsed dump ---------------- */
function currentDisplay(){ return S.data.displays.find(d => d.id === S.displayId) || S.data.displays[0]; }
/* A SurfaceFlinger dump is mostly scaffolding — of 140 layers on a car IVI,
   eight put pixels anywhere and the rest are tasks, tokens and animation
   leashes holding them. `show` is what keeps that from burying the few that
   matter. The settings are not degrees of the same thing: `with a frame` is
   whatever Telltale worked out a rect for, which is what the sheet can put
   somewhere, and says nothing about whether it reached the screen; `visible`
   is what the dump says did reach the screen, container layers with no
   geometry of their own included. A layer can be either without the other.
   Each tool picks the default that suits its own data, and a filter always
   searches everything. */
const SHOW = {
  framed:  { label:'with a frame', test:(n) => !!n.frame },
  visible: { label:'visible',      test:(n) => !!n.visible },
  all:     { label:'all',          test:() => true },
};
/* Two of those three are about geometry, which not every dump has. A tool
   that needs its own set says so and the pane follows; the rest get these. */
function shows(){ return (S.tool && S.tool.shows) || SHOW; }

/* What a filter box means. Plain text is a substring, which is what nearly
   every query is. It is read as a regular expression instead when the `.*`
   beside the box is on — `activity.*`, `anr|crash` — or when it is written
   between slashes, which is the same thing without reaching for the switch:
   `/^am_/`, `/\\bpid 1631\\b/i`. A log is the one dump that is read by pattern,
   and a box that only takes substrings sends you to grep.

   The text being matched is already lowercased, so `i` is on whether or not it
   was typed; `g` and `y` are dropped, since a stateful regex would match every
   other row. A pattern that will not compile matches nothing and says so
   rather than falling back to matching its own slashes. */
function textMatcher(query, asRegex){
  const q = String(query == null ? '' : query).trim();
  if(!q) return null;
  const wrapped = q.match(/^\/(.+)\/([gimsuy]*)$/);
  if(wrapped || asRegex){
    const body = wrapped ? wrapped[1] : q;
    const flags = (wrapped ? wrapped[2] : '').replace(/[gy]/g, '');
    try {
      const rx = new RegExp(body, flags.includes('i') ? flags : flags + 'i');
      return { test:(s) => rx.test(s || ''), ok:true, regex:true, source:rx };
    } catch(err){
      return { test:() => false, ok:false, regex:true, error:err.message };
    }
  }
  const low = q.toLowerCase();
  return { test:(s) => (s || '').includes(low), ok:true, regex:false };
}

function visibleNodes(){
  const m = textMatcher(S.filter, S.regex);
  if(m) return m.ok ? currentDisplay().nodes.filter(n => m.test(n.search)) : [];
  const set = shows();
  const keep = (set[S.show] || set.all || SHOW.all).test;
  return currentDisplay().nodes.filter(keep);
}

/* The rows the stack pane shows. Where a parser knows what is parented to
   what, the layers that were asked for are joined by the layers they hang
   from: a SurfaceFlinger dump is a tree, and five drawn layers on their own
   say nothing about how they got where they are. The ones nobody asked for
   come back marked as context, so a result still reads as a result. */
function listItems(){
  const d = currentDisplay();
  let rows = visibleNodes();

  /* A selection reached from somewhere other than this list — a step in the
     ancestry, say — need not be in what `show` is listing. Pin it on rather
     than let the pane look as though nothing happened. */
  const sel = S.selected && d.nodes.find(n => n.hash === S.selected);
  if(sel && !rows.includes(sel)) rows = [sel, ...rows];
  if(!rows.length || !d.nodes.some(n => n.parentHash)) {
    return rows.map(node => ({ node, depth:0, context:false }));
  }

  const byHash = new Map(d.nodes.map(n => [n.hash, n]));
  const asked = new Set(rows.map(n => n.hash));
  const keep = new Map();
  for(const n of rows){
    for(const a of n.ancestors || []){
      const up = byHash.get(a.hash);
      if(up) keep.set(up.hash, up);
    }
    keep.set(n.hash, n);
  }

  const kids = new Map(), roots = [];
  for(const n of keep.values()) kids.set(n.hash, []);
  for(const n of keep.values()){
    const up = n.parentHash && keep.get(n.parentHash);
    if(up) kids.get(up.hash).push(n); else roots.push(n);
  }

  /* A filter searches the whole dump, so it has to be able to reach what a
     shut row is hiding: while one is typed the tree is open, and the collapse
     state is left alone to come back when the filter is cleared. A tool whose
     rows open shut can ask for the same of its `show` settings, where picking
     one is picking the rows and burying them behind a twisty would make the
     button look as though it did nothing. */
  const narrowed = S.tool.openOnShow && S.show !== 'all';
  const shut = S.filter.trim() || narrowed ? null : S.collapsed;
  const under = (n) => kids.get(n.hash).reduce((sum, k) => sum + 1 + under(k), 0);

  // Siblings keep the order the flat list had them in: topmost first.
  const topFirst = (a, b) => b.z - a.z;
  const out = [];
  const walk = (n, depth) => {
    const children = kids.get(n.hash).sort(topFirst);
    const open = !(shut && shut.has(n.hash)) || !children.length;
    out.push({ node:n, depth, context:!asked.has(n.hash),
               kids:children.length, open, hiding:open ? 0 : under(n) });
    if(open) children.forEach(k => walk(k, depth + 1));
  };
  roots.sort(topFirst).forEach(r => walk(r, 0));
  return out;
}

/* ---- opening and shutting rows ---- */
/* The tree is the same one the parsers hand over — a layer's parent chain, a
   package's shared uid, an ANR's thread pool — so this is about which of it is
   on screen and nothing else. */
function toggleCollapse(hash){
  const set = S.collapsed;
  if(!set) return;
  if(set.has(hash)) set.delete(hash); else set.add(hash);
  renderList();
}
/* A selection reached from somewhere other than the list — the ancestry in the
   details pane, a lock badge naming another thread — must not land inside a
   shut row and look as though nothing happened. */
function revealAncestors(hash){
  const set = S.collapsed;
  if(!set || !set.size) return;
  const d = currentDisplay();
  const n = d && d.nodes.find(x => x.hash === hash);
  if(!n) return;
  for(const a of n.ancestors || []) set.delete(a.hash);
}
function setAllCollapsed(shut){
  const set = S.collapsed;
  if(!set) return;
  set.clear();
  if(shut){
    // Only a row with children below it is a row with a twisty to shut.
    const parents = new Set(currentDisplay().nodes.map(n => n.parentHash).filter(Boolean));
    for(const h of parents) set.add(h);
  }
  renderList();
}
