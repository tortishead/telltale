/* ================ parse: dumpsys activity services ================ */

/* The other half of what the activity manager holds. `dumpsys activity
 * activities` says what is on screen; this says what is running behind it and,
 * more to the point, who is keeping it running — which is the question a
 * battery or a memory bug gets opened with.
 *
 * The dump is a list of service records grouped by the user they belong to,
 * with the ones that have not started yet and the ones that keep dying listed
 * under headings of their own:
 *
 *   User 0 active services:
 *   * ServiceRecord{ceb7f39 u0 com.example.mail/.SyncService}
 *     app=ProcessRecord{31fa7b8 7714:com.example.mail/u0a231}
 *     startRequested=true ... lastStartId=12
 *     isForeground=true foregroundId=42 foregroundServiceType=dataSync
 *     All Connections:
 *       ConnectionRecord{a91bd2e u0 CR FGS !VIS com.example.mail/.MailActivity}
 *
 * A service is read with its connections hung under it, because a bound
 * service is alive for exactly as long as something holds it: the row says
 * what the service is, and the rows under it say who will not let go. The
 * foreground fields are read for the same reason — a foreground service is the
 * one thing an app can run indefinitely, and Android 14 onwards prints the
 * type it declared and, for a short service, the deadline it is running
 * against. */

const SVC_SECTION_START =
  /^(?:ACTIVITY MANAGER SERVICES\b|\s*User \d+ active services:)/;
/* The service heading, and the two the dump keeps its unhappy records under. */
const SVC_USER_HEAD = /^\s*User (\d+) active services:\s*$/;
const SVC_LIST_HEAD = /^\s*(Pending|Restarting|Active foreground) services:\s*$/;
/* `Connection bindings to services:` prints the same connections again from
   the client's end. They are already under the services they are on, so the
   subsection is read for nothing but its end. */
const SVC_OTHER_HEAD = /^\s*(Connection bindings to services|Services in resolver):\s*$/;
const SVC_HEAD = /^(\s*)\*\s+ServiceRecord\{([0-9a-fA-F]+)\s+u(\d+)\s+(\S+?)\}:?\s*$/;
/* `ConnectionRecord{a91bd2e u0 CR FGS !VIS com.example.mail/.MailActivity}` —
   the hash, the user, the flags the binding was made with, and the client the
   dump ends the line with. */
const SVC_CONN = /ConnectionRecord\{([0-9a-fA-F]+)\s+u(\d+)\s+([^}]*)\}/g;

const svcSection = (lines) => sectionSpan(lines, SVC_SECTION_START, ACT_SECTION_END, 'none');

/* The pid a service is running in, out of the record the dump names its
   process with: `ProcessRecord{31fa7b8 7714:com.example.mail/u0a231}`. */
function svcPid(app) {
  const m = app && app.match(/\{\S+\s+(\d+):/);
  return m ? +m[1] : null;
}

/* One connection line. What is worth reading off it is who made the binding
   and what they asked for, and the client is the last thing on the line — the
   flags before it are the constants the binder prints short. */
function svcConnection(inner) {
  const parts = inner.trim().split(/\s+/).filter(Boolean);
  let client = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].includes('/')) { client = parts.splice(i, 1)[0]; break; }
  }
  return { client, flags: parts };
}

/* What the row is coloured and badged by, which is the state the record is
   actually in rather than the heading it was printed under. */
function svcFamily(s) {
  if (s.section === 'Restarting') return 'svc-restarting';
  if (s.section === 'Pending') return 'svc-pending';
  if (!s.app) return 'svc-dead';
  if (s.foreground) return 'svc-foreground';
  if (s.startRequested) return 'svc-started';
  return 'svc-bound';
}

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
    if (um) { userId = +um[1]; section = 'Active'; skipping = false; continue; }
    const lm = line.match(SVC_LIST_HEAD);
    if (lm) { section = lm[1]; skipping = false; continue; }
    if (SVC_OTHER_HEAD.test(line)) { skipping = true; continue; }

    const m = line.match(SVC_HEAD);
    if (!m || skipping) continue;

    const { text: raw, next } = takeBlock(lines, i, m[1].length);
    const body = raw.split('\n').slice(1).join('\n');
    const fgs = actField(body, 'foregroundServiceType');
    const app = actField(body, 'app');

    /* The same connection is printed twice — once under the client that made
       it, once under `All Connections:` — so they are gathered by hash. */
    const conns = new Map();
    SVC_CONN.lastIndex = 0;
    let c;
    while ((c = SVC_CONN.exec(raw)) !== null) {
      if (conns.has(c[1])) continue;
      conns.set(c[1], { hash: c[1], userId: +c[2], ...svcConnection(c[3]) });
    }

    records.push({
      idHash: m[2], userId: +m[3], component: m[4], section, at: i + 1, raw,
      lines: raw.split('\n').length,
      pkg: actField(body, 'packageName'),
      process: actField(body, 'processName'),
      permission: actField(body, 'permission'),
      app,
      pid: svcPid(app),
      intent: actField(body, 'intent'),
      created: actField(body, 'createTime'),
      lastActivity: actField(body, 'lastActivity'),
      startRequested: actBool(body, 'startRequested') === true,
      callStart: actBool(body, 'callStart'),
      lastStartId: actField(body, 'lastStartId'),
      foreground: actBool(body, 'isForeground') === true,
      foregroundId: actField(body, 'foregroundId'),
      fgsTypes: fgs ? fgs.split('|').filter(Boolean) : [],
      fgsCount: actField(body, 'startForegroundCount'),
      fgsSince: actField(body, 'mFgsEnterTime'),
      /* Android 14 gave a short service a deadline and Android 15 started
         printing what happens at each end of it. */
      shortTimeout: (raw.match(/^\s*Short FGS timeout:\s*(.+)$/m) || [])[1] || null,
      allowedBy: actField(body, 'mAllowStartForeground'),
      whileInUse: actBool(body, 'mAllowWhileInUsePermissionInFgs'),
      notificationShown: actBool(body, 'mFgsNotificationShown'),
      restartCount: actField(body, 'restartCount'),
      nextRestart: actField(body, 'nextRestartTime'),
      bindings: (raw.match(/IntentBindRecord\{/g) || []).length,
      clients: (raw.match(/Client AppBindRecord\{/g) || []).length,
      conns: [...conns.values()],
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
      ...(!s.app && s.section === 'Active' ? [['not running', 'badge-exit']] : []),
      ...(s.shortTimeout ? [['short service', 'badge-comp']] : []),
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
        s.section !== 'Active' ? s.section.toLowerCase() : null,
        s.pid === null ? 'not running' : `pid ${s.pid}`,
        s.conns.length ? `${s.conns.length} client${s.conns.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · '),
      search: `${s.component} ${s.pkg || ''} ${s.process || ''} ${s.fgsTypes.join(' ')} `
            + `${s.conns.map((x) => x.client || '').join(' ')} ${s.raw}`.toLowerCase(),
    };
    nodes.push(node);

    const ancestors = [{ hash: node.hash, title: node.title }];
    for (const conn of s.conns) {
      nodes.push({
        hash: `conn:${s.at}:${conn.hash}`,
        idHash: conn.hash,
        kind: 'connection',
        title: conn.client ? shortComponent(conn.client) : `binding ${conn.hash}`,
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
        body: [`client=${conn.client || '—'}`, `flags=${conn.flags.join(' ') || '—'}`,
               `user=${conn.userId}`],
        raw: `ConnectionRecord{${conn.hash} u${conn.userId} ${
          [...conn.flags, conn.client].filter(Boolean).join(' ')}}`,
        subCount: 0,
        connection: conn,
        meta: conn.flags.join(' ') || null,
        search: `${conn.client || ''} ${conn.flags.join(' ')} ${conn.hash}`.toLowerCase(),
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
    users: users.length,
    lines: to - from,
  };

  return finaliseScene('service', displays, nodes, globals);
}
