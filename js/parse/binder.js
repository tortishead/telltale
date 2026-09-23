/* ================ parse: dumpsys binder_calls_stats ================ */

/* binder_calls_stats is not a document and nothing in it sits anywhere: it is
   one table of counters, a row per caller and method, and it is opened to
   compare — who is spending the system's time, and what threw on the way back
   out. So the rows become a two-level list, each caller over the methods it
   called, grouped by the Android user the caller runs as. On a car that
   grouping is the point: one app runs once for the driver and once for the
   system user, and the dump prints it as two callers that look alike.

   Two lines above the table decide whether any of the numbers mean anything,
   and both are easy to read past. `On battery time (ms): 0` means the
   collector never ran — nothing is recorded while the device is charging,
   which is an emulator's normal state, so a dump taken without
   `dumpsys battery unplug` is an empty table rather than a quiet device.
   `Sampling interval period: N` above 1 means one call in N was timed, so the
   times are a sample scaled up while the counts are not. Both are reported
   here rather than left as header lines nobody reads.

   The columns are read by the names the header prints rather than by
   position: builds have added and moved them, and `worksource` and
   `screen_interactive` are not in all of them. */

const BINDER_RAW_HEAD_RE = /^\s*Per-UID raw data.*\(([^()]*)\):\s*$/;
const BINDER_SUM_HEAD_RE = /^\s*Per-UID Summary.*\(([^()]*)\):\s*$/;
const BINDER_SUM_ROW_RE = /^\s+(\d+)\s+(\d+)%\s+(\d+)\s+(\d+)\s+(\S.*?)\s*$/;
const BINDER_EXC_ROW_RE = /^\s+(\d+)\s+([\w$]+(?:\.[\w$]+)+)\s*$/;
const BINDER_TOTAL_RE = /^\s*Summary:\s*total_cpu_time=(\d+),\s*calls_count=(\d+)(?:,\s*avg_call_cpu_time=(\S+))?/m;

/* The header names every column, and the name is what the parser goes by. A
   column this table gains keeps its own name and is carried through as-is. */
const BINDER_COLS = {
  'package/uid': 'who',
  'worksource': 'worksource',
  'call_desc': 'desc',
  'screen_interactive': 'screen',
  'cpu_time_micros': 'cpu',
  'max_cpu_time_micros': 'maxCpu',
  'latency_time_micros': 'latency',
  'max_latency_time_micros': 'maxLatency',
  'exception_count': 'exceptions',
  'max_request_size_bytes': 'maxRequest',
  'max_reply_size_bytes': 'maxReply',
  'recorded_call_count': 'recorded',
  'call_count': 'calls',
};

/* A caller printed as a bare number is one of the uids the platform reserves,
   and the number is not what anyone calls it. Only the ones that turn up in a
   binder dump are worth the table. */
const BINDER_UID_NAMES = {
  0: 'root', 1000: 'system', 1001: 'phone', 1002: 'bluetooth', 1003: 'graphics',
  1004: 'input', 1005: 'audio', 1006: 'camera', 1007: 'log', 1010: 'wifi',
  1013: 'media', 1017: 'keystore', 1019: 'drm', 1021: 'gps', 1027: 'nfc',
  1041: 'audioserver', 1046: 'mediacodec', 1047: 'cameraserver',
  1053: 'webview_zygote', 1066: 'network_stack', 1068: 'secure_element',
  2000: 'shell', 9999: 'nobody',
};

/* Every binder interface answers a handful of transactions that belong to
   binder rather than to the interface, and their codes are four packed
   characters rather than a method index. Unpacking one is how `#1598311760`
   turns back into the dump call that the row is actually about. */
const BINDER_META_TXN = {
  _PNG: 'ping', _DMP: 'dump', _CMD: 'shell command', _NTF: 'interface',
  _SPR: 'sysprops', _EXT: 'extension', _PID: 'debug pid', _RPC: 'rpc client',
  _TWT: 'tweet', _LIK: 'like',
};

function binderTxn(code) {
  if (!(code > 0x00ffffff)) return null;      // below this it is a method index
  const chars = [24, 16, 8, 0].map((s) => (code >>> s) & 0xff);
  if (chars.some((c) => c < 32 || c > 126)) return null;
  return String.fromCharCode(...chars);
}

const binderNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* The times are microseconds and span four orders of magnitude, so each is
   read in the unit that keeps it to three figures. */
function binderTime(us) {
  const n = Number(us);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} s`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} ms`;
  return `${n} µs`;
}

function binderBytes(b) {
  const n = Number(b);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} kB`;
  return `${n} B`;
}

/* A reply this big is worth pointing at: the buffer a binder transaction is
   copied through is a megabyte shared by the whole process, and the calls that
   fill it are the ones that fail under load rather than in a dump. */
const BINDER_BIG_REPLY = 64 * 1024;

/* `com.android.systemui/u0a210`, `shared:android.uid.phone/1001`, or a bare
   `0`. The half after the slash is the uid, written either as the plain number
   or as the user-and-app pair, and it is the only part that says which user
   the caller ran as. */
function binderCaller(field) {
  const raw = String(field == null ? '' : field).trim();
  const slash = raw.lastIndexOf('/');
  const name = slash < 0 ? null : raw.slice(0, slash);
  const spec = slash < 0 ? raw : raw.slice(slash + 1);
  const shared = !!name && name.startsWith('shared:');

  let uid = null, user = null, appId = null;
  const pair = spec.match(/^u(\d+)a(\d+)$/);
  if (pair) {
    user = +pair[1];
    appId = 10000 + +pair[2];
    uid = user * 100000 + appId;
  } else if (/^\d+$/.test(spec)) {
    uid = +spec;
    user = Math.floor(uid / 100000);
    appId = uid % 100000;
  }

  const plain = name ? name.replace(/^shared:/, '') : null;
  const label = plain
    || (uid !== null && BINDER_UID_NAMES[uid] ? BINDER_UID_NAMES[uid] : null)
    || (spec ? `uid ${spec}` : 'unknown caller');

  return { raw, name: plain, shared, spec, uid, user, appId, label };
}

/* `com.android.server.am.ActivityManagerService#startService`. The class is
   printed in full and the method only when detailed tracking is on; without it
   the dump prints the transaction code, or `null` where it has neither. */
function binderCall(desc) {
  const s = String(desc == null ? '' : desc).trim();
  const at = s.lastIndexOf('#');
  const cls = at < 0 ? s : s.slice(0, at);
  const printed = at < 0 ? null : s.slice(at + 1);
  const tail = cls.split('.').pop() || cls;
  const service = tail.split('$')[0] || tail;
  const inner = tail.includes('$') ? tail.slice(tail.indexOf('$') + 1) : null;

  let method = printed, named = true;
  if (!printed || printed === 'null') {
    method = null;
    named = false;
  } else if (/^\d+$/.test(printed)) {
    named = false;
    const txn = binderTxn(+printed);
    method = txn ? (BINDER_META_TXN[txn] || txn) : `transaction ${printed}`;
  }

  return { cls, service, inner, method, named,
           title: `${service}#${method || '?'}` };
}

function binderNode(opts) {
  return {
    hash: opts.hash, title: opts.title, displayId: opts.displayId,
    frame: null, frameSource: null, z: opts.z,
    family: opts.family, typeLabel: opts.typeLabel, badges: opts.badges,
    search: String(opts.search || '').toLowerCase(),
    raw: opts.raw || '',
    visible: true, focused: false,
    parentHash: opts.parentHash || null,
    ancestors: opts.ancestors || [],
    at: opts.at, meta: opts.meta || null, subCount: opts.subCount || 0,
  };
}

function parseBinderCallsStatsDump(input) {
  const text = dumpText(input);
  const lines = text.split('\n');

  const headAt = lines.findIndex((l) => BINDER_RAW_HEAD_RE.test(l));
  if (headAt < 0) return finaliseScene('binder', [], [], {});

  const cols = lines[headAt].match(BINDER_RAW_HEAD_RE)[1]
    .split(',').map((c) => BINDER_COLS[c.trim()] || c.trim());

  /* The table runs to the first blank line. A row with the wrong number of
     fields is not one of its rows, so the table stops there too rather than
     the parser guessing which column it lost. */
  const rows = [];
  for (let i = headAt + 1; i < lines.length; i++) {
    if (!lines[i].trim()) break;
    const parts = lines[i].split(',');
    if (parts.length !== cols.length) break;
    const row = { at: i + 1, line: lines[i] };
    cols.forEach((c, k) => { row[c] = parts[k].trim(); });
    rows.push(row);
  }

  /* The summary below the table is the same callers totalled, and it counts
     the rows the table dropped when it kept only the top of the dump. Where it
     and the rows disagree, it is the one that saw everything. */
  const summary = new Map();
  const sumAt = lines.findIndex((l) => BINDER_SUM_HEAD_RE.test(l));
  if (sumAt >= 0) {
    for (let i = sumAt + 1; i < lines.length; i++) {
      const m = lines[i].match(BINDER_SUM_ROW_RE);
      if (!m) { if (!lines[i].trim()) continue; break; }
      summary.set(m[5], { cpu: +m[1], pct: +m[2], recorded: +m[3], calls: +m[4] });
    }
  }

  const exceptions = [];
  const excAt = lines.findIndex((l) => /^\s*Exceptions thrown \(/.test(l));
  if (excAt >= 0) {
    for (let i = excAt + 1; i < lines.length; i++) {
      const m = lines[i].match(BINDER_EXC_ROW_RE);
      if (!m) { if (!lines[i].trim()) continue; break; }
      exceptions.push([+m[1], m[2]]);
    }
  }

  /* One caller per distinct `package/uid`, holding the rows it was printed
     across. A caller the summary named but the table dropped is still a
     caller, with its totals and nothing under it. */
  const callers = new Map();
  const caller = (key) => {
    let c = callers.get(key);
    if (!c) {
      c = { key, who: binderCaller(key), rows: [],
            cpu: 0, calls: 0, recorded: 0, exceptions: 0, maxReply: 0 };
      callers.set(key, c);
    }
    return c;
  };
  for (const row of rows) {
    const c = caller(row.who);
    c.rows.push(row);
    c.cpu += binderNum(row.cpu);
    c.calls += binderNum(row.calls);
    c.recorded += binderNum(row.recorded);
    c.exceptions += binderNum(row.exceptions);
    c.maxReply = Math.max(c.maxReply, binderNum(row.maxReply));
  }
  for (const key of summary.keys()) caller(key);
  for (const c of callers.values()) {
    c.summary = summary.get(c.key) || null;
    c.cpuTotal = c.summary ? c.summary.cpu : c.cpu;
    c.callsTotal = c.summary ? c.summary.calls : c.calls;
    c.pct = c.summary ? c.summary.pct : null;
    /* A caller whose totals are bigger than its rows had some of them dropped
       when the dump kept only the top by cpu time. */
    c.trimmed = c.rows.length > 0 && c.callsTotal > c.calls;
  }

  const nodes = [];
  let z = 0;
  const ordered = [...callers.values()]
    .sort((a, b) => b.cpuTotal - a.cpuTotal || a.key.localeCompare(b.key));

  for (const c of ordered) {
    const user = c.who.user === null ? 0 : c.who.user;
    const hash = `binder:uid:${c.key}`;
    const methods = c.rows.length;
    const uidText = c.who.uid === null ? c.who.spec : String(c.who.uid);

    const node = binderNode({
      hash, title: c.who.label, displayId: user, z: -z++,
      family: 'binder-caller', typeLabel: c.who.shared ? 'shared uid' : 'caller',
      badges: [
        ...(c.exceptions ? [[`${c.exceptions} threw`, 'badge-focus']] : []),
        ...(c.who.shared ? [['shared', 'badge-comp']] : []),
        ...(c.maxReply >= BINDER_BIG_REPLY
          ? [[`reply ${binderBytes(c.maxReply)}`, 'badge-exit']] : []),
      ],
      search: `${c.key} ${c.who.label} ${uidText} ${c.rows.map((r) => r.desc).join(' ')}`,
      raw: c.rows.map((r) => r.line).join('\n'),
      at: c.rows.length ? c.rows[0].at : (sumAt >= 0 ? sumAt + 1 : headAt + 1),
      subCount: methods,
      meta: `${methods} method${methods === 1 ? '' : 's'}`,
    });
    Object.assign(node, {
      caller: true, key: c.key, who: c.who,
      uid: c.who.uid, appId: c.who.appId, sharedUid: c.who.shared,
      cpu: c.cpuTotal, calls: c.callsTotal, recorded: c.recorded,
      exceptions: c.exceptions, pct: c.pct, methods,
      maxReply: c.maxReply, trimmed: c.trimmed,
      rowsCpu: c.cpu, rowsCalls: c.calls,
    });
    nodes.push(node);

    const ancestors = [{ hash, title: c.who.label }];
    for (const row of c.rows.slice().sort((a, b) => binderNum(b.cpu) - binderNum(a.cpu))) {
      const call = binderCall(row.desc);
      const threw = binderNum(row.exceptions);
      const calls = binderNum(row.calls);
      const recorded = binderNum(row.recorded);
      const maxReply = binderNum(row.maxReply);

      const kid = binderNode({
        hash: `binder:call:${row.at}`, title: call.title, displayId: user, z: -z++,
        family: threw ? 'binder-threw' : call.named ? 'binder-call' : 'binder-unnamed',
        typeLabel: call.named ? 'method' : 'transaction',
        badges: [
          ...(threw ? [[`${threw} threw`, 'badge-focus']] : []),
          ...(maxReply >= BINDER_BIG_REPLY
            ? [[`reply ${binderBytes(maxReply)}`, 'badge-exit']] : []),
          ...(recorded < calls ? [['sampled', 'badge-comp']] : []),
        ],
        search: `${c.key} ${c.who.label} ${row.desc} ${call.service} ${call.method || ''}`,
        raw: row.line.trim(),
        at: row.at,
        parentHash: hash, ancestors,
      });
      Object.assign(kid, {
        call: true, desc: row.desc, cls: call.cls, service: call.service,
        inner: call.inner, method: call.method, named: call.named,
        cpu: binderNum(row.cpu), maxCpu: binderNum(row.maxCpu),
        latency: binderNum(row.latency), maxLatency: binderNum(row.maxLatency),
        exceptions: threw, calls, recorded,
        maxRequest: binderNum(row.maxRequest), maxReply,
        screen: row.screen === undefined ? null : row.screen === 'true',
        worksource: row.worksource === undefined || row.worksource === row.who
          ? null : row.worksource,
      });
      nodes.push(kid);
    }
  }

  const one = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const int = (re) => { const v = one(re); return v === null ? null : +v; };
  const total = text.match(BINDER_TOTAL_RE);
  const batteryMs = int(/^\s*On battery time \(ms\):\s*(\d+)\s*$/m);
  const sampling = int(/^\s*Sampling interval period:\s*(\d+)\s*$/m);
  const userIds = [...new Set(nodes.map((n) => n.displayId))].sort((a, b) => a - b);

  const globals = {
    startTime: one(/^\s*Start time:\s*(.+)$/m),
    batteryMs,
    sampling,
    sharding: int(/^\s*Sharding modulo:\s*(\d+)\s*$/m),
    totalCpu: total ? +total[1] : null,
    totalCalls: total ? +total[2] : null,
    avgCpu: total && total[3] !== undefined && total[3] !== 'NaN' ? total[3] : null,
    exceptions,
    threw: exceptions.reduce((sum, [n]) => sum + n, 0),
    callers: ordered.length,
    rows: rows.length,
    users: userIds.length,
    /* The two things that decide whether the table means anything, worked out
       once here so every pane that says so is saying the same thing. */
    recording: batteryMs === null ? null : batteryMs > 0,
    detailed: rows.length ? rows.some((r) => binderCall(r.desc).named) : null,
    lines: lines.length,
  };

  const displays = (userIds.length ? userIds : [0]).map((id) => {
    const own = nodes.filter((n) => n.displayId === id);
    const heads = own.filter((n) => n.caller);
    const cpu = heads.reduce((sum, n) => sum + n.cpu, 0);
    const calls = heads.reduce((sum, n) => sum + n.calls, 0);
    const threw = own.filter((n) => n.call).reduce((sum, n) => sum + n.exceptions, 0);
    return {
      id, label: `user ${id}`, name: null,
      size: { w: 0, h: 0 }, insets: [], raw: '',
      callers: heads.length, methods: own.length - heads.length,
      cpu, calls, threw,
      meta: heads.length
        ? `${heads.length} caller${heads.length === 1 ? '' : 's'} · ${calls} call${
            calls === 1 ? '' : 's'} · ${binderTime(cpu)}`
        : 'nothing recorded',
    };
  });

  const scene = finaliseScene('binder', displays, nodes, globals);
  /* A collector that never ran prints this dump with an empty table, and why
     it is empty is the answer it has. `ok` is whether the table was there, not
     whether anything got into it. */
  scene.ok = true;
  return scene;
}
