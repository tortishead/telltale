/* ================ parse: ANR traces ================ */
/* An ART thread dump is the fourth shape Telltale reads and the second with no
   geometry: `/data/anr/traces.txt`, or the `VM TRACES` sections of a
   bugreport. What it has is the same shape as the rest — named things,
   grouped, each read out of a block of text — so it hands back the same scene
   with the frame left null. The group is the process: one dump can hold the
   ANR'ing app and the system_server it is waiting on, and those are two sets
   of threads that never mix. */

const ANR_PID_HEAD  = /^-{2,}\s*pid\s+(\d+)\s+at\s+(.+?)\s*-{2,}\s*$/;
const ANR_PID_END   = /^-{2,}\s*end\s+\d+\s*-{2,}\s*$/;
// "main" prio=5 tid=1 Blocked   /   "Worker-3" daemon prio=5 tid=12 Runnable
const ANR_HEAD      = /^"(.*)"\s+(daemon\s+)?prio=(\d+)\s+tid=(\d+)\s+(.+?)\s*$/;
// A thread that never attached to the runtime only gets a sysTid.
const ANR_HEAD_NAT  = /^"(.*)"\s+sysTid=(\d+)\s*$/;
const ANR_JAVA      = /^at\s+(.+?)\s*\((.*)\)\s*$/;
const ANR_NATIVE    = /^native:\s+#\d+\s+pc\s+([0-9a-fA-F]+)\s+(\S+)\s*(?:\((.*)\))?\s*$/;
const ANR_KERNEL    = /^kernel:\s+(.*)$/;
/* The monitor annotations, which are the whole point of the dump:
   `- waiting to lock <0x0e2b8f8f> (a java.lang.Object) held by thread 12` */
const ANR_LOCK      = /^-\s+(locked|waiting to lock|waiting on|sleeping on)\s+<(0x[0-9a-fA-F]+)>(?:\s+\(a\s+([^)]+)\))?(?:\s+held by\s+(?:thread\s+(\d+)|tid=(\d+))(?:\s+\(([^)]*)\))?)?/;
const ANR_LOCK_ANON = /^-\s+(waiting to lock|waiting on)\s+an unknown object/;
const ANR_CMDLINE   = /^Cmd\s*line:\s*(.+)$/;
const ANR_FINGER    = /^Build fingerprint:\s*'?(.+?)'?\s*$/;
const ANR_SUBJECT   = /^(?:Subject|subject):\s*(.+)$/;

const ANR_LOCK_KIND = {
  'locked': 'locked',
  'waiting to lock': 'waiting-to-lock',
  'waiting on': 'waiting-on',
  'sleeping on': 'sleeping-on',
};
const ANR_LOCK_LABEL = {
  'locked': 'locked',
  'waiting-to-lock': 'waiting for',
  'waiting-on': 'waiting on',
  'sleeping-on': 'sleeping on',
};

function anrLock(line) {
  const m = ANR_LOCK.exec(line);
  if (m) {
    const held = m[4] || m[5];
    return {
      addr: m[2], klass: m[3] || null, kind: ANR_LOCK_KIND[m[1]],
      heldByTid: held ? +held : null, heldByName: m[6] || null, raw: line,
    };
  }
  const u = ANR_LOCK_ANON.exec(line);
  return u ? { addr: null, klass: null, kind: ANR_LOCK_KIND[u[1]],
               heldByTid: null, heldByName: null, raw: line } : null;
}

function anrFrame(line) {
  const j = ANR_JAVA.exec(line);
  if (j) {
    /* The location is `Bar.java:12`, `Native method`, `Unknown Source:0` — the
       part after the last colon is a line number only when it is a number. */
    const loc = j[2];
    const colon = loc.lastIndexOf(':');
    const n = colon >= 0 ? Number(loc.slice(colon + 1)) : NaN;
    return { kind: 'java', raw: line, method: j[1],
             file: colon >= 0 && Number.isFinite(n) ? loc.slice(0, colon) : loc,
             line: Number.isFinite(n) ? n : null, locks: [] };
  }
  const n = ANR_NATIVE.exec(line);
  if (n) return { kind: 'native', raw: line, method: n[3] || null, file: n[2], line: null, locks: [] };
  const k = ANR_KERNEL.exec(line);
  if (k) return { kind: 'kernel', raw: line, method: k[1], file: null, line: null, locks: [] };
  return null;
}

/* The `| group=… sCount=1 nice=-10 … state=S utm=12 stm=3 core=2` lines under
   a header. Harvested rather than schema'd, like everything else here. */
function anrSched(t, line) {
  const num = (re) => { const m = re.exec(line); return m ? +m[1] : null; };
  const set = (k, v) => { if (t[k] === null && v !== null) t[k] = v; };
  set('sysTid', num(/\bsysTid=(\d+)/));
  set('nice', num(/\bnice=(-?\d+)/));
  set('utm', num(/\butm=(\d+)/));
  set('stm', num(/\bstm=(\d+)/));
  set('core', num(/\bcore=(\d+)/));
  set('sCount', num(/\bsCount=(\d+)/));
  const st = /\bstate=(\w)/.exec(line);
  if (st && !t.schedState) t.schedState = st[1];
  const grp = /\bgroup="([^"]*)"/.exec(line);
  if (grp && !t.group) t.group = grp[1];
  const sched = /\bschedstat=\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)/.exec(line);
  if (sched && !t.schedstat) {
    t.schedstat = { run: +sched[1], wait: +sched[2], slices: +sched[3] };
  }
}

/* One process block: the header, the few lines above the first thread that
   describe the process, and every thread until `----- end pid -----` or the
   next process. A plain `traces.txt` with no header at all is still one
   process — an unnumbered one. */
function anrProcesses(input) {
  const lines = dumpLines(input);
  const procs = [];
  let p = null, t = null, raw = [];
  /* A bare traces.txt states its `Cmd line:` before there is a process to hang
     it on, so what is read above the first thread is held until one opens. */
  let pending = {};

  const openProc = (pid, at) => {
    p = { pid, at, name: null, fingerprint: null, subject: null, ...pending, threads: [] };
    pending = {};
    procs.push(p);
  };
  const flushThread = () => {
    if (!t) return;
    t.raw = raw.join('\n');
    p.threads.push(t);
    t = null; raw = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const head = ANR_PID_HEAD.exec(line);
    if (head) { flushThread(); openProc(+head[1], head[2]); continue; }
    if (ANR_PID_END.test(line)) { flushThread(); p = null; continue; }

    const j = ANR_HEAD.exec(line);
    const h = j || ANR_HEAD_NAT.exec(line);
    if (h) {
      flushThread();
      if (!p) openProc(null, null);
      t = {
        name: h[1], daemon: j ? !!h[2] : false,
        prio: j ? +h[3] : null,
        tid: j ? +h[4] : null,
        state: j ? h[5] : 'Native',
        sysTid: j ? null : +h[2],
        nice: null, utm: null, stm: null, core: null, sCount: null,
        schedState: null, schedstat: null, group: null,
        frames: [], isMain: h[1] === 'main', raw: '',
      };
      raw = [rawLine];
      continue;
    }

    if (!t) {
      /* The process's own lines sit above its first thread. */
      const at = p || pending;
      const cmd = ANR_CMDLINE.exec(line);
      if (cmd) { at.name = cmd[1].trim(); continue; }
      const fp = ANR_FINGER.exec(line);
      if (fp) { at.fingerprint = fp[1]; continue; }
      const su = ANR_SUBJECT.exec(line);
      if (su) { at.subject = su[1].trim(); continue; }
      continue;
    }

    raw.push(rawLine);
    if (line.startsWith('|')) { anrSched(t, line); continue; }

    /* ART prints a monitor annotation directly under the frame it belongs to. */
    const lock = anrLock(line);
    if (lock) {
      const owner = t.frames[t.frames.length - 1];
      if (owner) owner.locks.push(lock);
      continue;
    }
    const f = anrFrame(line);
    if (f) t.frames.push(f);
  }
  flushThread();
  return procs.filter((x) => x.threads.length).map(anrIdentifyMain);
}

/* The threads ART starts in every process it runs. One of them is the tell
   that a process is running the runtime at all, which a native daemon is not. */
const ANR_ART_DAEMON =
  /^(Signal Catcher|HeapTaskDaemon|ReferenceQueueDaemon|Finalizer(?:Watchdog)?Daemon|Jit thread pool|JDWP|perfetto_hprof)/;

/* Which thread is the UI thread, and whether the process is one that has such
   a thing at all.

   ART names it `main`, and where the dump is in ART's own format that is the
   whole of it. But a process dumped in the native format takes its thread
   names from the kernel's comm field, which is truncated to 15 characters, so
   com.android.bluetooth's main thread arrives as `droid.bluetooth` and is
   found by no name test. The thread whose sysTid is the pid is the main thread
   by definition, and that recovers it.

   The fallback is deliberately not applied to a native daemon. audioserver has
   a first thread too, and calling it main would invite every question this
   reader asks of a main thread — is it idle in the looper, is it blocked on a
   monitor — of a thread that has no looper and no monitors. Those processes
   have no main thread, which is not a fault in them or in the dump. */
function anrIdentifyMain(p) {
  p.runtime = p.threads.some((t) => t.tid !== null || ANR_ART_DAEMON.test(t.name))
    ? 'art' : 'native';
  if (p.runtime === 'art' && !p.threads.some((t) => t.isMain) && p.pid !== null) {
    const main = p.threads.find((t) => t.sysTid === p.pid);
    if (main) main.isMain = true;
  }
  return p;
}

/* ---------------- the wait-for graph ---------------- */
/* One edge per `waiting to lock` that names, or implies, a holder.
   `waiting on` is `Object.wait()` — the thread released the monitor and is
   parked until notify(), so it is deliberately not an edge: it is not blocked
   *by* whoever holds the lock now. */
function anrWaitGraph(threads) {
  const byTid = new Map();
  for (const t of threads) if (t.tid !== null) byTid.set(t.tid, t);

  const owners = new Map();          // lock address -> tid that printed `locked`
  for (const t of threads) {
    if (t.tid === null) continue;
    for (const f of t.frames) for (const l of f.locks) {
      if (l.kind === 'locked' && l.addr && !owners.has(l.addr)) owners.set(l.addr, t.tid);
    }
  }

  const edges = [], seen = new Set();
  for (const t of threads) {
    if (t.tid === null) continue;
    for (const f of t.frames) for (const l of f.locks) {
      if (l.kind !== 'waiting-to-lock' || !l.addr) continue;
      const holder = l.heldByTid !== null ? l.heldByTid : (owners.has(l.addr) ? owners.get(l.addr) : null);
      if (holder === null || holder === t.tid) continue;
      const key = `${t.tid}->${holder}@${l.addr}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromTid: t.tid, toTid: holder, addr: l.addr, klass: l.klass,
                   inferred: l.heldByTid === null });
    }
  }
  return { edges, owners, byTid, cycles: anrCycles(edges), chain: anrChain(threads, edges) };
}

/* Every distinct cycle in the wait-for graph is a deadlock. Iterative DFS with
   a colour map; a cycle found from two entry points dedupes on a rotation
   invariant key. */
function anrCycles(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.fromTid)) adj.set(e.fromTid, []);
    adj.get(e.fromTid).push(e.toTid);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map(), cycles = [], emitted = new Set();

  const key = (cycle) => {
    const at = cycle.indexOf(Math.min(...cycle));
    return [...cycle.slice(at), ...cycle.slice(0, at)].join('>');
  };

  const visit = (root) => {
    const path = [root], stack = [{ node: root, i: 0 }];
    colour.set(root, GREY);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = adj.get(top.node) || [];
      if (top.i >= next.length) { colour.set(top.node, BLACK); stack.pop(); path.pop(); continue; }
      const to = next[top.i++];
      const c = colour.has(to) ? colour.get(to) : WHITE;
      if (c === GREY) {
        const start = path.indexOf(to);
        if (start >= 0) {
          const cycle = path.slice(start), k = key(cycle);
          if (!emitted.has(k)) { emitted.add(k); cycles.push(cycle); }
        }
      } else if (c === WHITE) {
        colour.set(to, GREY); stack.push({ node: to, i: 0 }); path.push(to);
      }
    }
  };
  for (const n of adj.keys()) if ((colour.has(n) ? colour.get(n) : WHITE) === WHITE) visit(n);
  return cycles;
}

/* The threads main is waiting behind, main first. This is the answer to the
   question an ANR trace gets opened with. */
function anrChain(threads, edges) {
  const main = threads.find((t) => t.isMain);
  if (!main || main.tid === null) return [];
  const next = new Map();
  for (const e of edges) if (!next.has(e.fromTid)) next.set(e.fromTid, e.toTid);
  const chain = [main.tid], seen = new Set([main.tid]);
  let cur = main.tid;
  for (;;) {
    const to = next.get(cur);
    if (to === undefined || seen.has(to)) break;
    chain.push(to); seen.add(to); cur = to;
  }
  return chain;
}

/* ---------------- what the stack is doing ---------------- */
/* Ordered most specific first, and only the first match on a thread is
   reported, so a Binder call inside SQLite does not read as two problems. */
const ANR_RULES = [
  { id:'binder', severity:'critical', title:'Synchronous Binder IPC',
    detail:'Blocked in a synchronous cross-process call. The stall is in the remote process — system_server or another app — not in this stack.',
    match:/BinderProxy\.transactNative|android\.os\.Binder(Proxy)?\.transact\b/ },
  { id:'sqlite', severity:'critical', title:'SQLite access',
    detail:'A query or transaction is in flight. On the UI thread that is a direct ANR cause; on a lock holder it is what makes the UI thread wait.',
    match:/android\.database\.sqlite|SQLiteDatabase|SQLiteConnection|androidx\.room/ },
  { id:'network', severity:'critical', title:'Network I/O',
    detail:'A socket read or connect is in flight. Network latency is unbounded, so anything behind this can stall for seconds.',
    match:/java\.net\.(Socket|PlainSocket|Inet)|okhttp3|HttpURLConnection|com\.squareup\.okhttp/ },
  { id:'sharedprefs', severity:'critical', title:'SharedPreferences write',
    detail:'commit() writes synchronously, and apply() still blocks in QueuedWork at lifecycle boundaries.',
    match:/SharedPreferencesImpl|QueuedWork|android\.app\.QueuedWork/ },
  { id:'diskio', severity:'critical', title:'Disk I/O',
    detail:'A file read or write is in flight. Flash latency spikes under memory pressure, which is where intermittent ANRs come from.',
    match:/java\.io\.(File(Input|Output)Stream|RandomAccessFile)|libcore\.io\.(Posix|IoBridge|BlockGuardOs)|BlockGuard|java\.util\.zip|dalvik\.system\.DexFile|android\.content\.res\.AssetManager/ },
  { id:'gc', severity:'warn', title:'Blocked on garbage collection',
    detail:'Waiting for a GC to finish or for a heap allocation. Usually memory pressure rather than this code path.',
    match:/waitForGcToComplete|WaitForGcToComplete|art::gc::|Heap::AllocObject|dalvik\.system\.VMRuntime/ },
  { id:'sleep', severity:'critical', title:'Thread.sleep',
    detail:'The thread is deliberately parked.',
    match:/java\.lang\.Thread\.sleep/ },
  { id:'latch', severity:'critical', title:'Blocked on a concurrency primitive',
    detail:'Parked on a latch, future or queue waiting for another thread.',
    match:/CountDownLatch\.await|FutureTask\.get|LinkedBlockingQueue\.take|ArrayBlockingQueue\.take|LockSupport\.park|AbstractQueuedSynchronizer|CompletableFuture\.get|kotlinx\.coroutines\.BlockingCoroutine/ },
  { id:'objectwait', severity:'warn', title:'Parked in Object.wait()',
    detail:'The monitor was released and the thread is waiting for notify(). Find who was supposed to notify it.',
    match:/java\.lang\.Object\.wait/ },
];

/* The idle looper stack every healthy app has. */
const ANR_IDLE_MAIN = /MessageQueue\.nativePollOnce|Looper\.loopOnce|epoll_wait|__epoll_pwait/;
const ANR_PLUMBING = /^(android\.os\.|com\.android\.internal\.os\.|java\.lang\.|libcore\.|art::|__|syscall|\/apex|\/system)/;

const anrHay = (f) => `${f.method || ''} ${f.file || ''}`;

function anrRuleFor(t) {
  for (let i = 0; i < t.frames.length; i++) {
    const hay = anrHay(t.frames[i]);
    for (const rule of ANR_RULES) if (rule.match.test(hay)) return { rule, frameIndex: i };
  }
  return null;
}

/* Idle means the whole stack is looper plumbing: nothing of the app's own sits
   above the poll. A main thread like that means the dump does not contain the
   cause, and saying so beats inventing one out of plumbing frames. */
function anrMainIdle(main) {
  const at = main.frames.findIndex((f) => ANR_IDLE_MAIN.test(anrHay(f)));
  if (at < 0) return false;
  return main.frames.slice(0, at).every((f) => ANR_PLUMBING.test(`${f.method || ''}${f.file || ''}`));
}

function anrFindings(proc, graph) {
  const out = [];
  const name = (tid) => `"${(graph.byTid.get(tid) || {}).name || '?'}" (tid ${tid})`;

  /* Deadlocks first: nothing else matters if there is a cycle. */
  for (const cycle of graph.cycles) {
    out.push({ severity:'critical', tid: cycle[0],
      title:`Deadlock: ${cycle.length} threads in a lock cycle`,
      detail:`${cycle.map(name).join(' waits for ')} waits for ${name(cycle[0])}. Nothing in this cycle can proceed.` });
  }

  const main = proc.threads.find((t) => t.isMain);
  if (!main) {
    /* A native daemon never had one. Saying so as a finding would put a
       warning on two thirds of the processes in a bugreport and bury the one
       that is actually wrong. */
    if (proc.runtime !== 'native') {
      out.push({ severity:'warn', title:'No main thread in this process',
        detail:'Nothing here is named main and no thread has the pid for its sysTid. A partial dump, most likely.' });
    }
    return { findings: out, mainIdle: false, main: null };
  }

  const blocking = graph.edges.find((e) => e.fromTid === main.tid);
  if (blocking) {
    const holder = graph.byTid.get(blocking.toTid);
    const top = holder && holder.frames[0] ? (holder.frames[0].method || holder.frames[0].raw) : 'unknown';
    out.push({ severity:'critical', tid: main.tid, hash: blocking.toTid,
      title:`Main thread blocked on monitor ${blocking.addr}`,
      detail:`Held by ${name(blocking.toTid)}, state ${holder ? holder.state : '?'}, currently at ${top}. That holder is where the time is going.` });
  }

  const mainIdle = anrMainIdle(main);
  if (mainIdle) {
    out.push({ severity:'info', tid: main.tid, title:'Main thread is idle in the looper',
      detail:'Parked in nativePollOnce with nothing above it at dump time, so the cause is not in this dump: a message that already finished, CPU starvation from another process, or a blocked system_server. The CPU usage section of the bugreport is the next place to look.' });
  } else {
    const hit = anrRuleFor(main);
    if (hit) out.push({ severity: hit.rule.severity, tid: main.tid, frameIndex: hit.frameIndex,
      title:`Main thread: ${hit.rule.title}`, detail: hit.rule.detail });
  }

  /* Heavy work elsewhere is worth reporting only where main is waiting behind
     it — a busy worker on a healthy app is a worker doing its job. */
  for (const tid of graph.chain.slice(1)) {
    const t = graph.byTid.get(tid);
    if (!t) continue;
    const hit = anrRuleFor(t);
    if (!hit) continue;
    out.push({ severity: hit.rule.severity === 'critical' ? 'warn' : hit.rule.severity,
      tid, frameIndex: hit.frameIndex,
      title:`${hit.rule.title} in ${name(tid)} — main is waiting behind it`,
      detail: hit.rule.detail });
  }
  return { findings: out, mainIdle, main };
}

/* ---------------- pools ---------------- */
/* Threads that come in interchangeable sets. Binder threads are the reason
   this exists: a busy process has a dozen, they are named after the pid that
   owns the pool, and one of them alone is almost never the answer. Twelve
   binder threads queued on one lock is one fact, and the group row says it
   better than twelve rows do. */
function anrPool(name) {
  /* Every binder spelling in the wild in one pattern: an optional Hw/Vnd
     prefix, an optional `:pid` naming the owning process, any suffix at all.
     `Binder:12345_2`, `binder:12345_A`, `HwBinder:751_1`, `Binder_3`. */
  const b = /^(hw|vnd)?binder(?::(\d+))?(?:[_:](.+))?$/i.exec(name);
  if (b) {
    const kind = (b[1] ? b[1][0].toUpperCase() + b[1].slice(1).toLowerCase() : '') + 'Binder';
    return b[2] ? { key:`${kind}:${b[2]}`, label:`${kind} pool · pid ${b[2]}` }
                : { key:kind, label:`${kind} pool` };
  }
  const p = /^(pool-\d+)-thread-\d+$/.exec(name);
  if (p) return { key:p[1], label:`${p[1]} workers` };
  /* Anything else ending in a separator and an index — `RxCachedThreadScheduler-4`,
     `DefaultDispatcher-worker-2`. Only grouped when enough share the stem. */
  const n = /^(.*[^-_ \d])[-_ ]\d+$/.exec(name);
  if (n && n[1].length >= 3) return { key:n[1], label:`${n[1]} threads` };
  return null;
}
const ANR_POOL_MIN = 2;    // two is already noise; one is not a pool

/* ---------------- the scene ---------------- */
const ANR_FRAMEWORK = /^(android\.|androidx\.|com\.android\.|java\.|javax\.|jdk\.|sun\.|libcore\.|dalvik\.|kotlin\.|kotlinx\.)/;

/* `com.example.app:remote` -> `com.example`, which is what tells the app's own
   frames apart from the framework and its libraries. */
function anrAppPrefix(procName) {
  const proc = procName ? procName.split(':')[0] : null;
  if (!proc) return null;
  const parts = proc.split('.');
  return parts.length >= 2 ? parts.slice(0, 2).join('.') : proc;
}

function anrFrameKind(f, prefix) {
  if (prefix && f.method && f.method.startsWith(prefix)) return 'app';
  if (f.kind !== 'java') return 'native';
  if (f.method && ANR_FRAMEWORK.test(f.method)) return 'framework';
  return 'app';           // unknown third-party code is worth seeing
}

/* ART prints a state name per thread and there are dozens of them —
   `WaitingInMainSignalCatcherLoop`, `WaitingPerformingGc`, `NativeForAbort`.
   Matching on the stem rather than a table means a state nobody has seen yet
   still lands in the right family. */
const ANR_STATE_FAMILY = [
  [/^(Blocked|Monitor)/,             'anr-blocked'],
  [/^WaitingForGcToComplete/,        'anr-blocked'],
  [/^Runnable/,                      'anr-running'],
  [/^Native/,                        'anr-native'],
  [/^(Waiting|Timed|Sleeping|Suspended|Starting|Parked)/, 'anr-waiting'],
];
function anrFamily(t) {
  if (t.isMain) return 'anr-main';
  const state = String(t.state);
  for (const [re, family] of ANR_STATE_FAMILY) if (re.test(state)) return family;
  return 'anr-other';
}

/* A thread with no app frames, no monitor of its own and nothing waiting on it
   is scaffolding: a pool worker parked on its queue. It is still listed, still
   searched, and still dims like anything else that did not matter. */
function anrIdle(t, prefix, graph) {
  if (t.isMain) return false;
  if (t.state === 'Blocked') return false;
  if (t.tid !== null && graph.edges.some((e) => e.fromTid === t.tid || e.toTid === t.tid)) return false;
  return !t.frames.some((f) => anrFrameKind(f, prefix) === 'app');
}

/* main first, then the chain it is blocked behind, then everything else
   blocked, then the rest. This is the order the question is asked in. */
function anrScore(t, graph) {
  if (t.isMain) return 0;
  if (t.tid !== null && graph.chain.includes(t.tid)) return 1;
  if (t.state === 'Blocked') return 2;
  return 3;
}

function anrThreadNode(t, i, ctx) {
  const { pid, prefix, graph, findings } = ctx;
  const hash = `${pid}:t${t.tid !== null ? t.tid : 's' + (t.sysTid !== null ? t.sysTid : i)}`;

  const waits = [];          // monitors this thread is queued on
  const holds = [];          // monitors it took
  const parks = [];          // Object.wait()/sleeping — not a blocking edge
  t.frames.forEach((f, fi) => {
    for (const l of f.locks) {
      const at = { ...l, frameIndex: fi };
      if (l.kind === 'locked') holds.push(at);
      else if (l.kind === 'waiting-to-lock') waits.push(at);
      else parks.push(at);
    }
  });

  const out = graph.edges.filter((e) => e.fromTid === t.tid);
  const incoming = t.tid === null ? [] : graph.edges.filter((e) => e.toTid === t.tid);
  const inCycle = t.tid !== null && graph.cycles.some((c) => c.includes(t.tid));
  const chainAt = t.tid === null ? -1 : graph.chain.indexOf(t.tid);
  const blocksMain = chainAt > 0;
  const idle = anrIdle(t, prefix, graph);
  const leaf = t.frames[0] || null;

  const badges = [
    ...(t.isMain ? [['main', 'badge-vis']] : []),
    ...(inCycle ? [['deadlock', 'badge-focus']] : []),
    ...(blocksMain ? [['blocks main', 'badge-focus']] : []),
    ...(t.state === 'Blocked' ? [['blocked', 'badge-exit']] : []),
    ...(incoming.length ? [[`holds · ${incoming.length} waiting`, 'badge-exit']] : []),
    ...(t.daemon ? [['daemon', 'badge-comp']] : []),
  ];

  const search = [
    t.name, t.state, t.tid !== null ? 'tid ' + t.tid : '', t.sysTid ? 'systid ' + t.sysTid : '',
    inCycle ? 'deadlock' : '', blocksMain ? 'blocks main' : '', idle ? 'idle' : '',
    ...t.frames.map((f) => `${f.method || ''} ${f.file || ''}`),
    ...t.frames.flatMap((f) => f.locks.map((l) => `${l.addr || ''} ${l.klass || ''}`)),
  ].filter(Boolean).join(' ').toLowerCase();

  return {
    hash, title: t.name || '(unnamed)', displayId: pid,
    frame: null, frameSource: null, z: 0,
    family: anrFamily(t), typeLabel: t.state, badges, search, raw: t.raw,
    /* `focused` is a spatial dump's idea — which window has input. The badge
       that matters here is `main`, and the row carries that already. */
    visible: !idle, focused: false,
    parentHash: null, ancestors: [],
    /* the ANR half */
    thread: t, prefix, idle, waits, holds, parks, outEdges: out, inEdges: incoming,
    inCycle, chainAt, blocksMain, leaf,
    findings: findings.filter((f) => f.tid !== undefined && f.tid === t.tid),
    score: anrScore(t, graph),
  };
}

/* A pool is one row until one of its members is part of the answer. A member
   that holds a contended monitor, or sits on the chain main is blocked behind,
   is pulled out and listed on its own; the ones merely waiting stay inside,
   where the count and the state histogram say what they are doing. */
function anrPoolNode(pool, kids, pid) {
  const states = new Map();
  for (const k of kids) states.set(k.thread.state, (states.get(k.thread.state) || 0) + 1);
  const histogram = [...states.entries()].sort((a, b) => b[1] - a[1]);

  const leaves = new Map();
  for (const k of kids) {
    const m = k.leaf ? (k.leaf.method || k.leaf.raw) : '(no frames)';
    leaves.set(m, (leaves.get(m) || 0) + 1);
  }
  const mostly = [...leaves.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    hash: `${pid}:pool:${pool.key}`, title: pool.label, displayId: pid,
    frame: null, frameSource: null, z: 0,
    family: 'anr-pool', typeLabel: 'pool', badges: [], raw: '',
    search: (pool.label + ' pool ' + kids.map((k) => k.title + ' ' + k.search).join(' ')).toLowerCase(),
    visible: kids.some((k) => k.visible), focused: false,
    parentHash: null, ancestors: [],
    pool: true, members: kids, histogram,
    mostly: mostly ? mostly[0] : null,
    findings: [],
    score: Math.min(...kids.map((k) => k.score)),
  };
}

function parseAnrDump(input) {
  const procs = anrProcesses(input);
  if (!procs.length) return finaliseScene('anr', [], [], {});

  const nodes = [], displays = [];

  /* A bugreport carries the traces twice — `VM TRACES AT LAST ANR` and `VM
     TRACES JUST NOW` — so the same pid turns up in two blocks that are two
     different moments and must stay two groups. The group's key is its place
     in the file; the pid is what the group is labelled with. */
  const repeated = new Set(procs.map((p) => p.pid).filter((pid, i, all) => all.indexOf(pid) !== i));

  procs.forEach((proc, key) => {
    const pid = key;                     // unique per block, whatever the pids are
    const prefix = anrAppPrefix(proc.name);
    const graph = anrWaitGraph(proc.threads);
    const analysis = anrFindings(proc, graph);
    const ctx = { pid, prefix, graph, findings: analysis.findings };

    const mine = proc.threads.map((t, i) => anrThreadNode(t, i, ctx));
    const byTid = new Map();
    for (const n of mine) if (n.thread.tid !== null) byTid.set(n.thread.tid, n);

    /* Hand every node the way to reach the threads it points at. */
    for (const n of mine) {
      n.waitFor = n.outEdges.map((e) => ({
        addr: e.addr, klass: e.klass, inferred: e.inferred,
        tid: e.toTid, node: byTid.get(e.toTid) || null,
      }));
      n.waitedOnBy = n.inEdges.map((e) => ({
        addr: e.addr, klass: e.klass, tid: e.fromTid, node: byTid.get(e.fromTid) || null,
      }));
    }

    /* Pools, and the members worth pulling back out of them. */
    const pools = new Map();
    for (const n of mine) {
      const p = anrPool(n.thread.name || '');
      if (!p) continue;
      if (!pools.has(p.key)) pools.set(p.key, { pool: p, kids: [] });
      pools.get(p.key).kids.push(n);
    }
    const poolNodes = [];
    for (const { pool, kids } of pools.values()) {
      if (kids.length < ANR_POOL_MIN) continue;
      /* Part of the answer: main itself, a thread on the chain, a thread in a
         cycle, or one somebody else is queued behind. */
      const answer = (n) => n.thread.isMain || n.chainAt >= 0 || n.inCycle || n.waitedOnBy.length > 0;
      const inside = kids.filter((n) => !answer(n));
      if (!inside.length) continue;
      const node = anrPoolNode(pool, kids, pid);
      for (const n of inside) {
        n.parentHash = node.hash;
        n.ancestors = [{ hash: node.hash, title: node.title }];
        n.inPool = pool.label;
      }
      for (const n of kids) if (!inside.includes(n)) n.pulledFrom = pool.label;
      poolNodes.push({ node, kids });
      nodes.push(node);
    }

    nodes.push(...mine);

    /* `z` is what the list sorts on, descending, and what orders siblings in
       the tree. Relevance is the order here — main, then the chain behind it,
       then the rest — so it is expressed as a z and the rank it hands out goes
       unread, the same way a package dump spells its alphabet. */
    const ordered = [...mine].sort((a, b) => a.score - b.score
      /* Threads main is blocked behind read in the order it waits through
         them, which is the order the story is told in. */
      || (a.chainAt >= 0 && b.chainAt >= 0 ? a.chainAt - b.chainAt : 0)
      || (a.thread.tid === null ? 1e9 : a.thread.tid) - (b.thread.tid === null ? 1e9 : b.thread.tid));
    ordered.forEach((n, i) => { n.z = -i; });
    // A pool sits where its most relevant member would have sat.
    for (const { node, kids } of poolNodes) node.z = Math.max(...kids.map((k) => k.z));

    const blocked = mine.filter((n) => n.thread.state === 'Blocked').length;
    displays.push({
      id: pid, name: proc.name || null,
      /* A plain traces.txt has no `----- pid N -----` header at all, and the
         key it gets instead is Telltale's, not the device's: say so rather than
         print a number the dump never mentioned. */
      label: proc.pid === null ? 'process (no pid header)' : `pid ${proc.pid}`,
      size: { w: 0, h: 0 }, insets: [], raw: '',
      meta: `${proc.threads.length} thread${proc.threads.length === 1 ? '' : 's'}`
        /* Which of the two is which is the whole question when a pid repeats. */
        + (repeated.has(proc.pid) && proc.at ? ` · ${proc.at}` : ''),
      proc, graph, analysis, prefix, blocked,
      threadNodes: mine,
    });
  });

  const globals = {
    processes: procs.length,
    threads: procs.reduce((n, p) => n + p.threads.length, 0),
    fingerprint: (procs.find((p) => p.fingerprint) || {}).fingerprint || null,
  };
  return finaliseScene('anr', displays, nodes, globals);
}
