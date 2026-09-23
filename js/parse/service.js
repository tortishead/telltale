/* ================ parse: dumpsys activity services ================ */

/* The other half of what the activity manager holds. `dumpsys activity
 * activities` says what is on screen; this says what is running behind it and,
 * more to the point, who is keeping it running — which is the question a
 * battery or a memory bug gets opened with.
 *
 * The dump is a list of service records grouped by the user they belong to,
 * with the ones that have not started yet and the ones that keep dying listed
 * under headings of their own. What the manager actually prints, heading and
 * record head alike, is a word in front of the record:
 *
 *   User 0 active services:
 *   * ServiceRecord{ceb7f39 u0 com.example.mail/.SyncService c:com.example.home}
 *     app=ProcessRecord{31fa7b8 7714:com.example.mail/u0a231}
 *     startRequested=true ... lastStartId=12
 *      startCommandResult=1
 *     isForeground=true foregroundId=42 types=0x00000001 foregroundNoti=...
 *     All Connections:
 *       ConnectionRecord{a91bd2e u0 CR FGS !VIS com.example.mail/.SyncService:@f10 flags=0x1}
 *   Restarting services:
 *   * Restarting ServiceRecord{...}
 *
 * Three things about that shape are worth stating, because a reader written
 * from a remembered dump gets all three wrong:
 *
 *   * The record head carries `c:` and the package that last called the
 *     service, and the lists print `Pending`, `Restarting`, `Destroy`,
 *     `Delayed start` or `Starting bg` between the star and the record.
 *   * `startCommandResult=` is printed with one space and no indent of its
 *     own, so a block read by indentation ends there — in the middle of the
 *     record, before its bindings and its connections.
 *   * A ConnectionRecord names the *service* it is on, not the client that
 *     made it: the tail is `<service>:@<binder> flags=0x<n>`. The client is
 *     the process named by the `Client AppBindRecord{}` the connection is
 *     printed under, and a connection under `All Connections:` names none.
 *
 * A service is read with its connections hung under it, because a bound
 * service is alive for exactly as long as something holds it: the row says
 * what the service is, and the rows under it say who will not let go. The
 * foreground fields are read for the same reason — a foreground service is the
 * one thing an app can run indefinitely — and since Android 14 the type it
 * declared is printed as a bitmask rather than by name, with a short service's
 * deadline on the line under it. */

const SVC_SECTION_START = new RegExp(
  '^(?:ACTIVITY MANAGER SERVICES\\b'
  + '|\\s*User \\d+ (?:active|delayed start) services:'
  + '|\\s*User \\d+ starting in background:)');
/* The per-user headings, and the lists the dump keeps its unhappy records
   under. `Active foreground` is the one heading here that is not a list of
   service records — the manager prints `Active foreground apps - user N:` —
   but a build that spells it `services` costs nothing to allow. */
const SVC_USER_HEAD =
  /^\s*User (\d+) (active services|delayed start services|starting in background):\s*$/;
const SVC_LIST_HEAD = /^\s*(Pending|Restarting|Destroying|Active foreground) services:\s*$/;
/* `Connection bindings to services:` prints the same connections again from
   the client's end, and `Last ANR service:` prints one record again without a
   star in front of it. Both are already read elsewhere, so the subsections are
   read for nothing but their end. */
const SVC_OTHER_HEAD =
  /^\s*(Connection bindings to services|Services in resolver|Last ANR service):\s*$/;
/* The word between the star and the record says which list it came out of, and
   `c:` at the end of the record names the package that last called it. */
const SVC_HEAD = new RegExp(
  '^(\\s*)\\*\\s+(?:(Pending|Restarting|Destroy|Delayed start|Starting bg)\\s+)?'
  + 'ServiceRecord\\{([0-9a-fA-F]+)\\s+u(\\d+)\\s+([^\\s}]+)(?:\\s+c:([^\\s}]+))?\\}:?\\s*$');
const SVC_ANY_HEAD =
  /^\s*\*\s+(?:Pending |Restarting |Destroy |Delayed start |Starting bg )?ServiceRecord\{/;
/* `ConnectionRecord{a91bd2e u0 CR FGS !VIS com.example.mail/.SyncService:@f10 flags=0x1}` —
   the hash, the client's user, the flags the binding was made with, and the
   service the binding is on. */
const SVC_CONN = /ConnectionRecord\{([0-9a-fA-F]+)\s+u(\d+)\s+([^}]*)\}/g;
/* `* Client AppBindRecord{0ba4c17 ProcessRecord{9911aa2 4471:com.example.maps/u0a288}}` */
const SVC_BIND_CLIENT = /\*\s+Client AppBindRecord\{[0-9a-fA-F]+\s+(.+)\}\s*$/;

const SVC_USER_SECTION = {
  'active services': 'Active',
  'delayed start services': 'Delayed',
  'starting in background': 'Starting',
};
const SVC_PREFIX_SECTION = {
  Pending: 'Pending', Restarting: 'Restarting', Destroy: 'Destroying',
  'Delayed start': 'Delayed', 'Starting bg': 'Starting',
};

/* The foreground service types, as bits, because that is how the manager
   prints them: `types=0x00000049`. The names are the ones the manifest
   attribute uses, which is what an app author would search for. */
const FGS_TYPE_BITS = [
  [1 << 0, 'dataSync'], [1 << 1, 'mediaPlayback'], [1 << 2, 'phoneCall'],
  [1 << 3, 'location'], [1 << 4, 'connectedDevice'], [1 << 5, 'mediaProjection'],
  [1 << 6, 'camera'], [1 << 7, 'microphone'], [1 << 8, 'health'],
  [1 << 9, 'remoteMessaging'], [1 << 10, 'systemExempted'], [1 << 11, 'shortService'],
  [1 << 12, 'fileManagement'], [1 << 13, 'mediaProcessing'], [1 << 30, 'specialUse'],
];

const svcSection = (lines) => sectionSpan(lines, SVC_SECTION_START, ACT_SECTION_END, 'none');

/* A record runs to the next thing that starts one, rather than to the first
   line indented no deeper than its head: `startCommandResult=` is printed with
   a single leading space and would otherwise end every started service before
   its connections. */
function svcBlock(lines, start, to) {
  const out = [lines[start]];
  let i = start + 1;
  for (; i < to; i++) {
    const line = lines[i];
    if (!line.trim()) { out.push(line); continue; }
    if (SVC_ANY_HEAD.test(line) || SVC_USER_HEAD.test(line) || SVC_LIST_HEAD.test(line)
      || SVC_OTHER_HEAD.test(line) || indentOf(line) === 0) break;
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { text: out.join('\n'), next: i };
}

/* The pid a service is running in, out of the record the dump names its
   process with: `ProcessRecord{31fa7b8 7714:com.example.mail/u0a231}`. */
function svcPid(app) {
  const m = app && app.match(/\{\S+\s+(\d+):/);
  return m ? +m[1] : null;
}

/* The client a bind record was made by, which the dump gives as a process
   record — `ProcessRecord{9911aa2 4471:com.example.maps/u0a288}` — and older
   readers of this dump gave as the bare `process/uid` inside it. */
function svcClient(text) {
  if (!text) return null;
  const inner = (text.match(/ProcessRecord\{\S+\s+(.+)\}/) || [])[1] || text.trim();
  const m = inner.match(/^(?:(\d+):)?([^/\s]+)(?:\/(\S+))?/);
  if (!m) return null;
  return {
    process: m[2] || null,
    pid: m[1] ? +m[1] : null,
    uid: m[3] || null,
  };
}

/* The names behind `types=0x…`. An app that declared its types in the manifest
   and passed none at runtime prints every bit set, which is the manager saying
   "whatever the manifest said" rather than fifteen types at once. */
function svcFgsTypes(hex) {
  if (hex === null || hex === undefined || hex === '') return [];
  const v = parseInt(String(hex).replace(/^0x/i, ''), 16);
  if (!Number.isFinite(v) || v === 0) return [];
  if ((v >>> 0) === 0xFFFFFFFF) return ['manifest'];
  const out = [];
  let rest = v;
  for (const [bit, name] of FGS_TYPE_BITS) {
    if (v & bit) { out.push(name); rest &= ~bit; }
  }
  if (rest) out.push(`0x${(rest >>> 0).toString(16)}`);
  return out;
}

/* One connection line. The tail names the service and the binder the client
   holds it through, the flags before it are the constants the binder prints
   short, and a build old enough not to print `flags=0x` still parses: the
   component is read off the end either way. */
function svcConnection(inner) {
  const parts = inner.trim().split(/\s+/).filter(Boolean);
  let bindFlags = null;
  if (parts.length && /^flags=0x[0-9a-fA-F]+$/.test(parts[parts.length - 1])) {
    bindFlags = parts.pop().slice('flags='.length);
  }
  let target = null;
  let binder = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].includes('/')) {
      const [name, at] = parts.splice(i, 1)[0].split(':@');
      target = name;
      binder = at || null;
      break;
    }
  }
  return { target, binder, bindFlags, flags: parts };
}

/* The connections a record holds, each with the client that made it where the
   dump says so. A connection is printed twice — under the `Client
   AppBindRecord{}` that made it, and again under `All Connections:` — and the
   first of the two is the one that names a client, so the first wins. */
function svcConnections(raw) {
  const conns = new Map();
  let client = null;
  for (const line of raw.split('\n')) {
    const cm = line.match(SVC_BIND_CLIENT);
    if (cm) { client = svcClient(cm[1]); continue; }
    if (/^\s*(All Connections|Bindings):\s*$/.test(line)) { client = null; continue; }

    SVC_CONN.lastIndex = 0;
    let c;
    while ((c = SVC_CONN.exec(line)) !== null) {
      if (conns.has(c[1])) continue;
      conns.set(c[1], { hash: c[1], userId: +c[2], client, ...svcConnection(c[3]) });
    }
  }
  return [...conns.values()];
}

/* What a short service is running against, off the line the manager prints it
   on: `isShortFgs=true startId=4 … timeout=+2m22s demoteTime=+2m22s anrTime=+3m22s`.
   A build that printed the deadline as a sentence of its own is taken as it
   was written. */
function svcShortDeadline(raw) {
  const line = (raw.match(/^\s*isShortFgs=true\s+(.*)$/m) || [])[1];
  if (!line) return (raw.match(/^\s*Short FGS timeout:\s*(.+)$/m) || [])[1] || null;
  const timeout = actField(line, 'timeout');
  const demote = actField(line, 'demoteTime');
  const anr = actField(line, 'anrTime');
  return [
    timeout ? `timeout ${timeout}` : null,
    demote ? `procstate demotion at ${demote}` : null,
    anr ? `anr at ${anr}` : null,
  ].filter(Boolean).join('; ') || null;
}

/* What the row is coloured and badged by, which is the state the record is
   actually in rather than the heading it was printed under. */
function svcFamily(s) {
  if (s.section === 'Restarting') return 'svc-restarting';
  if (s.section === 'Destroying') return 'svc-dead';
  if (s.section === 'Pending' || s.section === 'Delayed' || s.section === 'Starting') {
    return 'svc-pending';
  }
  if (!s.app) return 'svc-dead';
  if (s.foreground) return 'svc-foreground';
  if (s.startRequested) return 'svc-started';
  return 'svc-bound';
}

const SVC_SECTION_LABEL = {
  Active: 'active services',
  Pending: 'pending services',
  Restarting: 'restarting services',
  Destroying: 'destroying services',
  Delayed: 'delayed start services',
  Starting: 'starting in background',
};

function parseActivityServicesDump(input) {
  const lines = dumpLines(input);
  const span = svcSection(lines);
  if (!span) return finaliseScene('service', [], [], {});
  const { start: from, end: to } = span;

  const records = [];
  let userId = 0;
  let section = 'Active';
  let skipping = false;

  for (let i = from; i < to; i++) {
    const line = lines[i];
    const um = line.match(SVC_USER_HEAD);
    if (um) {
      userId = +um[1];
      section = SVC_USER_SECTION[um[2]] || 'Active';
      skipping = false;
      continue;
    }
    const lm = line.match(SVC_LIST_HEAD);
    if (lm) { section = lm[1] === 'Active foreground' ? 'Active' : lm[1]; skipping = false; continue; }
    if (SVC_OTHER_HEAD.test(line)) { skipping = true; continue; }

    const m = line.match(SVC_HEAD);
    if (!m || skipping) continue;

    const { text: raw, next } = svcBlock(lines, i, to);
    const body = raw.split('\n').slice(1).join('\n');
    const app = actField(body, 'app');
    /* Android 14 onwards prints the types as a bitmask on the foreground line;
       before that, and in the tooling that rewrote the dump, they were names
       separated by bars. */
    const fgLine = (raw.match(/^\s*isForeground=.*$/m) || [])[0] || '';
    const named = actField(body, 'foregroundServiceType');
    const fgsTypes = named
      ? named.split('|').filter(Boolean)
      : svcFgsTypes(actField(fgLine, 'types'));

    records.push({
      idHash: m[3],
      userId: +m[4],
      component: m[5],
      calledBy: m[6] || null,
      /* The word in front of the record outranks the heading above it: a
         bugreport cut between the two still says what the record is. */
      section: SVC_PREFIX_SECTION[m[2]] || section,
      at: i + 1,
      raw,
      lines: raw.split('\n').length,
      pkg: actField(body, 'packageName'),
      process: actField(body, 'processName'),
      permission: actField(body, 'permission'),
      targetSdk: actField(body, 'targetSdkVersion'),
      app,
      pid: svcPid(app),
      intent: actField(body, 'intent'),
      created: actField(body, 'createTime'),
      lastActivity: actField(body, 'lastActivity'),
      startRequested: actBool(body, 'startRequested') === true,
      callStart: actBool(body, 'callStart'),
      lastStartId: actField(body, 'lastStartId'),
      startResult: actField(body, 'startCommandResult'),
      foreground: actBool(body, 'isForeground') === true,
      foregroundId: actField(fgLine, 'foregroundId') || actField(body, 'foregroundId'),
      fgsTypes,
      fgsCount: actField(body, 'startForegroundCount'),
      fgsSince: actField(body, 'mFgsEnterTime'),
      fgsDelegate: actBool(body, 'mIsFgsDelegate'),
      shortTimeout: svcShortDeadline(raw),
      /* What let the service go to the foreground, and what it may use while
         it is there. Android 15 split each of those into a reason code per
         route and stopped printing the booleans that came before them. */
      allowedBy: actField(body, 'getFgsAllowStart')
        || actField(body, 'mAllowStart_noBinding')
        || actField(body, 'allowStartForeground')
        || actField(body, 'mAllowStartForeground'),
      /* Free text to the end of the line, and the manager writes it with
         both spaces and `=` in it: a field reader stops at the first of
         those and comes back with a quarter of the sentence. */
      allowedNote: ((raw.match(/^\s*infoAllowStartForeground=(.*)$/m) || [])[1] || '').trim()
        || null,
      whileInUseBy: actField(body, 'getFgsAllowWiu_forCapabilities')
        || actField(body, 'getFgsAllowWiu_new')
        || actField(body, 'mAllowWiu_noBinding'),
      whileInUse: actBool(body, 'mAllowWhileInUsePermissionInFgs') === null
        ? actBool(body, 'allowWhileInUsePermissionInFgs')
        : actBool(body, 'mAllowWhileInUsePermissionInFgs'),
      notificationShown: actBool(body, 'mFgsNotificationShown'),
      restartCount: actField(body, 'restartCount'),
      nextRestart: actField(body, 'nextRestartTime'),
      crashCount: actField(body, 'crashCount'),
      destroying: actBool(body, 'destroying'),
      destroyTime: actField(body, 'destroyTime'),
      bindings: (raw.match(/IntentBindRecord\{/g) || []).length,
      clients: (raw.match(/Client AppBindRecord\{/g) || []).length,
      conns: svcConnections(raw),
    });
    i = next - 1;
  }

  if (!records.length) return finaliseScene('service', [], [], {});

  const nodes = [];
  for (const s of records) {
    const badges = [
      ...(s.foreground ? [['foreground', 'badge-focus']] : []),
      ...(s.section === 'Restarting'
        ? [[s.restartCount ? `restarting ×${s.restartCount}` : 'restarting', 'badge-exit']] : []),
      ...(s.section === 'Pending' ? [['pending', 'badge-comp']] : []),
      ...(s.section === 'Delayed' ? [['delayed start', 'badge-comp']] : []),
      ...(s.section === 'Starting' ? [['starting', 'badge-comp']] : []),
      ...(s.section === 'Destroying' ? [['destroying', 'badge-exit']] : []),
      ...(!s.app && s.section === 'Active' ? [['not running', 'badge-exit']] : []),
      ...(s.fgsTypes.includes('shortService') || s.shortTimeout
        ? [['short service', 'badge-comp']] : []),
    ];
    const node = {
      hash: `svc:${s.at}`,
      idHash: s.idHash,
      kind: 'service',
      title: shortComponent(s.component),
      displayId: s.userId,
      frame: null, frameSource: null, z: 0,
      family: svcFamily(s),
      typeLabel: 'service',
      badges,
      visible: s.foreground || (!!s.app && s.startRequested),
      focused: false,
      parentHash: null, ancestors: [],
      at: s.at, bodyAt: s.at + 1, lines: s.lines, own: s.lines,
      /* The reading pane is handed the block under the head: the head is the
         row it is already reading. */
      body: s.raw.split('\n').slice(1),
      raw: s.raw,
      subCount: s.conns.length,
      service: s,
      meta: [
        s.section !== 'Active' ? SVC_SECTION_LABEL[s.section] : null,
        s.pid === null ? 'not running' : `pid ${s.pid}`,
        s.conns.length ? `${s.conns.length} client${s.conns.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · '),
      search: `${s.component} ${s.pkg || ''} ${s.process || ''} ${s.fgsTypes.join(' ')} `
            + `${s.conns.map((x) => (x.client && x.client.process) || '').join(' ')} ${s.raw}`
              .toLowerCase(),
    };
    nodes.push(node);

    const ancestors = [{ hash: node.hash, title: node.title }];
    for (const conn of s.conns) {
      const who = conn.client && conn.client.process;
      nodes.push({
        hash: `conn:${s.at}:${conn.hash}`,
        idHash: conn.hash,
        kind: 'connection',
        title: who ? shortComponent(who) : `binding ${conn.hash}`,
        displayId: s.userId,
        frame: null, frameSource: null, z: 0,
        family: 'svc-connection',
        typeLabel: 'connection',
        badges: conn.flags.includes('FGS') ? [['fgs', 'badge-comp']] : [],
        visible: true, focused: false,
        parentHash: node.hash, ancestors,
        at: s.at, bodyAt: s.at + 1, lines: 1, own: 1,
        /* A connection is one line, and that line is what the pane reads:
           there is nothing printed under it to show instead. */
        body: [`client=${who || '—'}`,
               `pid=${(conn.client && conn.client.pid) || '—'}`,
               `service=${conn.target || '—'}`,
               `flags=${conn.flags.join(' ') || '—'}`,
               `user=${conn.userId}`],
        raw: `ConnectionRecord{${conn.hash} u${conn.userId} ${
          [...conn.flags,
           conn.target && conn.binder ? `${conn.target}:@${conn.binder}` : conn.target,
           conn.bindFlags ? `flags=${conn.bindFlags}` : null].filter(Boolean).join(' ')}}`,
        subCount: 0,
        connection: conn,
        meta: [conn.flags.join(' ') || null,
               conn.client && conn.client.pid ? `pid ${conn.client.pid}` : null]
          .filter(Boolean).join(' · ') || null,
        search: `${who || ''} ${conn.target || ''} ${conn.flags.join(' ')} ${conn.hash}`
          .toLowerCase(),
      });
    }
  }

  /* Nothing here is in front of anything, so the order is the one a list is
     read in: the services of a user alphabetically, each with its clients
     under it in the order the dump printed them. */
  const users = [...new Set(records.map((s) => s.userId))].sort((a, b) => a - b);
  for (const uid of users) {
    const mine = nodes.filter((n) => n.displayId === uid && n.kind === 'service');
    mine.sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1
                       : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0));
    mine.forEach((n, i) => {
      n.z = -i * 100;
      nodes.filter((k) => k.parentHash === n.hash).forEach((k, j) => { k.z = n.z - j - 1; });
    });
  }

  const displays = users.map((uid) => {
    const mine = nodes.filter((n) => n.displayId === uid && n.kind === 'service');
    const fg = mine.filter((n) => n.service.foreground).length;
    return {
      id: uid, name: uid === 0 ? 'owner' : null,
      size: { w: 0, h: 0 }, insets: [], raw: '',
      meta: `${mine.length} service${mine.length === 1 ? '' : 's'} · ${fg} foreground`,
      services: mine.length,
      foreground: fg,
      restarting: mine.filter((n) => n.service.section === 'Restarting').length,
    };
  });

  const all = records;
  const globals = {
    services: all.length,
    foreground: all.filter((s) => s.foreground).length,
    connections: all.reduce((n, s) => n + s.conns.length, 0),
    pending: all.filter((s) => s.section === 'Pending').length,
    restarting: all.filter((s) => s.section === 'Restarting').length,
    destroying: all.filter((s) => s.section === 'Destroying').length,
    users: users.length,
    lines: to - from,
  };

  return finaliseScene('service', displays, nodes, globals);
}
