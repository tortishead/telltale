/* ---------------- details: ANR traces ---------------- */
/* The pane an ANR dump wants is not a list of fields: it is the stack, with
   the monitor annotations attached to the frames that carry them, and a way to
   step from a thread to the one it is waiting behind. Both lock badges are
   buttons, and the pane's own click handler selects whatever they name. */

const ANR_SEV = { critical:'badge-focus', warn:'badge-exit', info:'badge-comp' };

const anrThreadRef = (node, tid, name) => node
  ? `<button class="anc-row anr-ref" type="button" data-hash="${esc(node.hash)}"
       title="Go to this thread">${esc(node.title)} ${dim('tid ' + tid)}</button>`
  : `<span class="anr-ref anr-ref-gone">${esc(name || '?')} ${dim('tid ' + tid + ' · not in this dump')}</span>`;

function anrFindingRows(findings, byTid, self){
  return findings.map((f) => {
    const at = f.tid !== undefined && byTid ? byTid.get(f.tid) : null;
    return `<div class="finding">
    <span class="badge ${ANR_SEV[f.severity] || 'badge-comp'}">${esc(f.severity)}</span>
    <b>${esc(f.title)}</b>
    <p>${esc(f.detail)}</p>
    ${at && at.hash !== self ? anrThreadRef(at, f.tid, null) : ''}
  </div>`;
  }).join('');
}

/* A frame as one row: what it is, where it is, and whatever monitor lines ART
   printed under it. The leaf is marked, because where a thread actually is is
   the one frame worth finding at a glance. */
function anrFrameRow(f, i, n, isLeaf){
  const kind = anrFrameKind(f, n.prefix);
  const loc = f.kind === 'java'
    ? (f.file ? esc(f.file + (f.line !== null ? ':' + f.line : '')) : '')
    : (f.file ? esc(f.file.split('/').pop()) : '');
  const method = esc(f.method || f.raw);

  const locks = f.locks.map((l) => {
    const label = ANR_LOCK_LABEL[l.kind] + (l.addr ? ' ' + l.addr : ' an unknown object');
    const klass = l.klass ? ' ' + dim('(' + esc(l.klass) + ')') : '';
    if(l.kind === 'waiting-to-lock'){
      const edge = n.waitFor.find((w) => w.addr === l.addr);
      const to = edge && edge.node;
      return `<span class="lock lock-wait">${esc(label)}${klass} ${
        to ? `· held by <button class="lock-link" type="button" data-hash="${esc(to.hash)}"
                title="Go to the holder">${esc(to.title)} (tid ${to.thread.tid})</button>`
           : (l.heldByTid !== null ? '· held by tid ' + l.heldByTid : dim('· no holder in this dump'))}</span>`;
    }
    if(l.kind === 'locked'){
      const waiters = n.waitedOnBy.filter((w) => w.addr === l.addr);
      return `<span class="lock lock-held">${esc(label)}${klass}${
        waiters.length ? ` · ${waiters.length} waiting` : ''}</span>`;
    }
    return `<span class="lock lock-park">${esc(label)}${klass}</span>`;
  }).join('');

  return `<div class="stk-row stk-${kind}${isLeaf ? ' stk-leaf' : ''}">
    <span class="stk-m">${method}</span>${loc ? `<span class="stk-loc">${loc}</span>` : ''}
    ${locks}</div>`;
}

/* Runs of framework frames with nothing attached to them fold into one row.
   A 60-frame stack is mostly ZygoteInit and ActivityThread; the three or four
   frames that are the app's are what the pane is for. The fold is a
   <details>, so opening it needs no script and printing shows what is open. */
function anrStack(n){
  const frames = n.thread.frames;          // leaf first, the way ART prints it
  if(!frames.length) return `<p style="color:var(--dim)">No frames — the thread was not attached to the runtime, or the dump was truncated here.</p>`;
  const rows = [];
  let i = 0;
  while(i < frames.length){
    const foldable = (j) => j !== 0 && j < frames.length
      && anrFrameKind(frames[j], n.prefix) !== 'app' && !frames[j].locks.length;
    if(foldable(i)){
      let j = i;
      while(foldable(j)) j++;
      const run = frames.slice(i, j);
      if(run.length >= 3){
        const first = run[0].method || run[0].raw, last = run[run.length-1].method || run[run.length-1].raw;
        rows.push(`<details class="fold"><summary>${run.length} framework frames ${
          dim(esc(anrShort(first)) + ' … ' + esc(anrShort(last)))}</summary>${
          run.map((f, k) => anrFrameRow(f, i + k, n, false)).join('')}</details>`);
        i = j;
        continue;
      }
    }
    rows.push(anrFrameRow(frames[i], i, n, i === 0));
    i++;
  }
  return `<div class="stk">${rows.join('')}</div>`;
}
const anrShort = (m) => { const p = String(m).split('.'); return p.length >= 2 ? p.slice(-2).join('.') : m; };

function anrDetail(n){
  const out = [];
  const d = currentDisplay();
  const byTid = new Map((d.threadNodes || []).map((x) => [x.thread.tid, x]));

  if(n.pool){
    out.push(`<section class="dgroup"><h3>Pool</h3>${dl([
      ['threads', n.members.length],
      ['states', n.histogram.map(([s, c]) => `${c} ${esc(s)}`).join(' · ')],
      n.mostly && ['mostly at', `<span style="font-family:var(--mono)">${esc(anrShort(n.mostly))}</span>`],
      ['note', dim('interchangeable threads, collapsed into one row. A member holding a contended monitor, or on the chain main is blocked behind, is listed on its own instead.')],
    ])}</section>`);
    out.push(`<section class="dgroup"><h3>Members</h3><div class="anc">${
      n.members.map((m) => `<button class="anc-row" type="button" data-hash="${esc(m.hash)}"
        title="${esc(m.title)}">${esc(m.title)} ${dim(esc(m.thread.state))}</button>`).join('')
    }</div></section>`);
    return out;
  }

  const t = n.thread;
  out.push(`<section class="dgroup"><h3>Thread</h3>${dl([
    ['state', `${esc(t.state)}${n.idle ? ' ' + dim('(idle — no app frames, nothing waiting on it)') : ''}`],
    t.tid !== null && ['tid', `${t.tid}${t.isMain ? ' ' + dim('(main — the UI thread)') : ''}`],
    t.sysTid !== null && ['sysTid', t.sysTid],
    t.prio !== null && ['prio', `${t.prio}${t.daemon ? ' ' + dim('· daemon') : ''}`],
    t.nice !== null && ['nice', t.nice],
    t.schedState && ['scheduler', `state ${esc(t.schedState)}${t.core !== null ? ` · core ${t.core}` : ''}`],
    (t.utm !== null || t.stm !== null) && ['cpu', `${t.utm !== null ? t.utm : '?'} user · ${t.stm !== null ? t.stm : '?'} system ${dim('jiffies')}`],
    t.schedstat && ['schedstat', `${t.schedstat.run} ns run · ${t.schedstat.wait} ns waiting · ${t.schedstat.slices} slices`],
    t.group && ['group', esc(t.group)],
    n.inPool && ['pool', esc(n.inPool)],
    n.pulledFrom && ['pool', `${esc(n.pulledFrom)} ${dim('· listed on its own because it is part of the answer')}`],
  ])}</section>`);

  if(n.findings.length){
    out.push(`<section class="dgroup"><h3>What this is</h3>${anrFindingRows(n.findings, byTid, n.hash)}</section>`);
  }

  const monitors = [];
  for(const w of n.waitFor){
    monitors.push([`waiting for ${w.addr}`,
      `${w.klass ? `<div>${esc(w.klass)}</div>` : ''}${anrThreadRef(w.node, w.tid, null)}${
        w.inferred ? `<div>${dim('holder inferred from a locked line')}</div>` : ''}`]);
  }
  for(const h of n.holds){
    const waiters = n.waitedOnBy.filter((x) => x.addr === h.addr);
    monitors.push([`holds ${h.addr}`, h.klass ? esc(h.klass) : dim('no class printed')]);
    if(waiters.length){
      monitors.push([dim('  waiting on it'), `<div class="anc">${
        waiters.map((w) => anrThreadRef(w.node, w.tid, null)).join('')}</div>`]);
    }
  }
  for(const p of n.parks){
    monitors.push([`${ANR_LOCK_LABEL[p.kind]} ${p.addr || 'an unknown object'}`,
      `${p.klass ? `<div>${esc(p.klass)}</div>` : ''}${
        dim('released the monitor — not blocked by whoever holds it now')}`]);
  }
  if(monitors.length){
    out.push(`<section class="dgroup"><h3>Monitors</h3>${dl(monitors)}</section>`);
  }

  if(n.inCycle){
    const cycle = d.graph.cycles.find((c) => c.includes(t.tid)) || [];
    out.push(`<section class="dgroup"><h3>Deadlock</h3><div class="anc">${
      cycle.map((tid) => anrThreadRef(byTid.get(tid), tid, null)).join('')
      + anrThreadRef(byTid.get(cycle[0]), cycle[0], null)
    }</div><p style="color:var(--dim);font-family:var(--sans);margin:6px 0 0">
      Every thread here waits for the next. Nothing in the cycle can proceed.</p></section>`);
  } else if(n.chainAt > 0){
    out.push(`<section class="dgroup"><h3>Main is waiting behind this</h3>${dl([
      ['step', `${n.chainAt} of ${d.graph.chain.length - 1} from main`],
    ])}</section>`);
  }

  out.push(`<section class="dgroup"><h3>Call stack ${dim('leaf first')}</h3>${anrStack(n)}</section>`);
  /* The process the thread belongs to, kept in view: the chain and the graph
     are what sent you into this thread, and following them should not cost you
     sight of them. */
  out.push(...anrProcessAnalysis(d));
  return out;
}

/* With nothing selected the pane is the process: what it is, what the dump
   says went wrong, and the chain to walk. */
function anrProcessDetail(d){
  const out = [];
  const p = d.proc, g = d.graph, a = d.analysis;
  const byTid = new Map((d.threadNodes || []).map((x) => [x.thread.tid, x]));

  out.push(`<section class="dgroup"><h3>Process</h3>${dl([
    p.pid !== null && ['pid', p.pid],
    p.name && ['cmd line', esc(p.name)],
    d.prefix && ['app frames', `matched against ${esc(d.prefix)}`],
    p.at && ['dumped', esc(p.at)],
    p.subject && ['subject', esc(p.subject)],
    ['threads', `${p.threads.length}${d.blocked ? ` · ${d.blocked} blocked` : ''}`],
    p.fingerprint && ['fingerprint', mono(p.fingerprint)],
  ])}</section>`);

  out.push(`<section class="dgroup"><h3>Findings</h3>${
    a.findings.length ? anrFindingRows(a.findings, byTid)
      : `<p style="color:var(--dim);font-family:var(--sans);margin:0">Nothing stood out: no lock cycle, no monitor under main, and nothing on the main thread matched a known ANR cause.</p>`
  }</section>`);

  out.push(...anrProcessAnalysis(d));

  const states = new Map();
  for(const t of p.threads) states.set(t.state, (states.get(t.state) || 0) + 1);
  out.push(`<section class="dgroup"><h3>Thread states</h3>${dl(
    [...states.entries()].sort((x, y) => y[1] - x[1]).map(([s, c]) => [esc(s), c])
  )}</section>`);
  return out;
}

/* The chain and the graph belong to the process rather than to any one thread,
   which is why they sit in the process pane — but they are also the reason a
   thread was worth clicking, and having them vanish the moment you follow the
   chain into it is the wrong way round. Both panes render them from here.

   The graph is drawn even with no edges in it. A process with no monitor
   contention is a real answer to "what is blocking this", and saying nothing
   at all makes it indistinguishable from a reader that cannot do the work. */
function anrProcessAnalysis(d){
  const out = [], g = d.graph;
  const byTid = new Map((d.threadNodes || []).map((x) => [x.thread.tid, x]));

  if(g.chain.length > 1){
    out.push(`<section class="dgroup"><h3>What main is waiting behind</h3><div class="anc">${
      g.chain.map((tid, i) => {
        const edge = i > 0 ? g.edges.find((e) => e.fromTid === g.chain[i-1] && e.toTid === tid) : null;
        const ref = anrThreadRef(byTid.get(tid), tid, null);
        return edge ? `<div class="anr-step">${dim('waits for ' + esc(edge.addr))}</div>${ref}` : ref;
      }).join('')
    }</div></section>`);
  }

  out.push(`<section class="dgroup"><h3>Wait-for graph</h3>${
    g.edges.length ? dl([
      ['edges', g.edges.length],
      ['deadlocks', g.cycles.length || dim('none')],
      ['note', dim('one edge per `waiting to lock`. `waiting on` — Object.wait() — is not an edge: the monitor was released, so the holder is not what blocks it.')],
    ]) : dl([
      ['edges', dim('none')],
      ['note', dim(d.proc.runtime === 'native'
        ? 'a native process prints no monitor annotations, so there is no lock graph to build from this dump.'
        : 'no thread in this process is waiting to lock a monitor another thread holds. Whatever is wrong here is not lock contention between these threads.')],
    ])
  }</section>`);
  return out;
}
