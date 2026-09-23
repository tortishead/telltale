/* ================ parse: the event log ================ */

/* The event log is the framework's own account of what happened, and it is the
   one buffer in a bugreport that is not prose: every line is a tag and a list
   of fields, written by the framework at a moment it thought was worth
   recording. A process started. An activity resumed. Something ANRed. The
   configuration changed. Read as lines it is `am_proc_start: [0,5210,1000,…]`
   and unreadable; read as what the tags mean it is the story of the session,
   which is what this reader is for.

   The logcat reader already lists these lines, and deliberately leaves them as
   they were printed: a log reader that rewrote its lines would be lying about
   the file. This is the other reading of the same buffer — the tag decoded
   against what the framework declares it logs, one sentence a line — so the
   two sit as their own tabs over the same text rather than one inside the
   other.

   The fields come from AOSP's `event-log-tags`, which is where the tag's
   arity and the order of its fields are declared. A tag this reader has never
   seen is still a line of the log and still a row: it keeps its name and its
   fields as printed, and is filed under `other`. */

/* Splitting a field list is not splitting on commas: a field may hold a list
   of its own, and the last field of a crash is a message somebody wrote. So
   commas inside brackets are not separators, and a tag that came out with more
   fields than it declares had its free-text field eaten into — which is
   recoverable, because the fields around that one are fixed in number. */
function eventSplit(body) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
  }
  out.push(body.slice(start));
  /* Untrimmed on purpose: the free-text field is put back together by joining
     these again, and trimming first would eat the space somebody typed after
     their own comma. */
  return out;
}

function eventFields(message, names, greedy) {
  const raw = String(message === null || message === undefined ? '' : message).trim();
  const body = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  const parts = body === '' ? [] : eventSplit(body);
  const out = {};
  if (!names || !names.length) return { parts, fields: out };

  const gi = greedy ? names.indexOf(greedy) : -1;
  if (parts.length > names.length && gi >= 0) {
    /* The fields before the free-text one and the fields after it are both
       fixed, so what is left in the middle is the free-text one, commas and
       all. */
    const after = names.length - gi - 1;
    const tail = after ? parts.slice(parts.length - after) : [];
    const mid = parts.slice(gi, parts.length - after).join(',');
    names.forEach((n, i) => {
      const v = i < gi ? parts[i] : i === gi ? mid : tail[i - gi - 1];
      out[n] = v === undefined ? null : v.trim();
    });
  } else {
    names.forEach((n, i) => {
      out[n] = parts[i] === undefined ? null : parts[i].trim();
    });
  }
  return { parts: parts.map((v) => v.trim()), fields: out };
}

/* The bits `Configuration.diff` sets, which is what `configuration_changed`
   logs. A configuration change is read for which part of it changed — an
   orientation change and a font scale change are not the same event — and the
   mask is the only place the dump says. */
const CONFIG_BITS = [
  [0x00000001, 'mcc'], [0x00000002, 'mnc'], [0x00000004, 'locale'],
  [0x00000008, 'touchscreen'], [0x00000010, 'keyboard'], [0x00000020, 'keyboardHidden'],
  [0x00000040, 'navigation'], [0x00000080, 'orientation'], [0x00000100, 'screenLayout'],
  [0x00000200, 'uiMode'], [0x00000400, 'screenSize'], [0x00000800, 'smallestScreenSize'],
  [0x00001000, 'density'], [0x00002000, 'layoutDirection'], [0x00004000, 'colorMode'],
  [0x00008000, 'grammaticalGender'], [0x10000000, 'fontWeightAdjustment'],
  [0x20000000, 'windowConfiguration'], [0x40000000, 'fontScale'],
  [0x80000000, 'assetsPaths'],
];

function configChanges(mask) {
  const n = Number(mask);
  if (!Number.isFinite(n)) return [];
  const bits = n >>> 0;
  return CONFIG_BITS.filter(([b]) => (bits & (b >>> 0)) !== 0).map(([, name]) => name);
}

/* The steps the framework marks on its way up. A boot in the log is these in
   order, and the gaps between them are where a slow boot went. */
const BOOT_STEPS = {
  boot_progress_start: 'init handed over',
  boot_progress_preload_start: 'zygote preload started',
  boot_progress_preload_end: 'zygote preload finished',
  boot_progress_system_run: 'system server running',
  boot_progress_pms_start: 'package manager started',
  boot_progress_pms_system_scan_start: 'scanning system packages',
  boot_progress_pms_data_scan_start: 'scanning data packages',
  boot_progress_pms_scan_end: 'package scan finished',
  boot_progress_pms_ready: 'package manager ready',
  boot_progress_ams_ready: 'activity manager ready',
  boot_progress_enable_screen: 'screen enabled',
};

/* An activity's last name is what anyone reads it by; the package in front of
   it is the row next to it more often than not. */
const shortComponent = (c) => {
  if (!c) return '';
  const slash = c.indexOf('/');
  if (slash < 0) return c;
  const pkg = c.slice(0, slash);
  const cls = c.slice(slash + 1);
  const dot = cls.lastIndexOf('.');
  return `${pkg}/${dot < 0 ? cls : cls.slice(dot + 1)}`;
};

const evMs = (v) => (v === null || v === undefined || v === '' ? null : `${v} ms`);

/* What the framework logs, and what each of them says. `fields` is the order
   the tag declares; `greedy` names the one field somebody's own words go into,
   which is the only one a comma can turn up inside. `who` is what the event is
   about — a process, a package, an activity — and it is what the row is filed
   and searched under. */
const EVENT_TAGS = {
  /* ---- processes ---- */
  am_proc_start: {
    kind: 'process', fields: ['user', 'pid', 'uid', 'process', 'type', 'component'],
    who: (f) => f.process,
    say: (f) => `${f.process} started · pid ${f.pid}${f.type ? ` · for ${f.type}` : ''}`,
  },
  am_proc_bound: {
    kind: 'process', fields: ['user', 'pid', 'process'],
    who: (f) => f.process, say: (f) => `${f.process} bound · pid ${f.pid}`,
  },
  am_proc_died: {
    kind: 'process', fields: ['user', 'pid', 'process', 'oomAdj', 'procState'],
    who: (f) => f.process, say: (f) => `${f.process} died · pid ${f.pid}`,
  },
  am_kill: {
    kind: 'trouble', fields: ['user', 'pid', 'process', 'oomAdj', 'reason'], greedy: 'reason',
    who: (f) => f.process,
    say: (f) => `${f.process} killed${f.reason ? ` · ${f.reason}` : ''}`,
  },
  am_freeze: {
    kind: 'process', fields: ['pid', 'process'],
    who: (f) => f.process, say: (f) => `${f.process} frozen · pid ${f.pid}`,
  },
  am_unfreeze: {
    kind: 'process', fields: ['pid', 'process'],
    who: (f) => f.process, say: (f) => `${f.process} unfrozen · pid ${f.pid}`,
  },
  am_uid_running: { kind: 'process', fields: ['uid'], who: (f) => `uid ${f.uid}`,
    say: (f) => `uid ${f.uid} running` },
  am_uid_idle:    { kind: 'process', fields: ['uid'], who: (f) => `uid ${f.uid}`,
    say: (f) => `uid ${f.uid} idle` },
  am_uid_active:  { kind: 'process', fields: ['uid'], who: (f) => `uid ${f.uid}`,
    say: (f) => `uid ${f.uid} active` },
  am_uid_stopped: { kind: 'process', fields: ['uid'], who: (f) => `uid ${f.uid}`,
    say: (f) => `uid ${f.uid} stopped` },
  am_pss: {
    kind: 'process',
    fields: ['pid', 'uid', 'process', 'pss', 'uss', 'swapPss', 'rss', 'statType',
             'procState', 'timeToCollect'],
    who: (f) => f.process,
    say: (f) => `${f.process} measured · ${Math.round(Number(f.pss) / 1024) || 0} MB pss`,
  },

  /* ---- what went wrong ---- */
  am_anr: {
    kind: 'trouble', fields: ['user', 'pid', 'package', 'flags', 'reason'], greedy: 'reason',
    who: (f) => f.package,
    say: (f) => `ANR in ${f.package}${f.reason ? ` · ${f.reason}` : ''}`,
  },
  am_crash: {
    kind: 'trouble',
    fields: ['user', 'pid', 'process', 'flags', 'exception', 'message', 'file', 'line'],
    greedy: 'message',
    who: (f) => f.process,
    say: (f) => `Crash in ${f.process} · ${[f.exception, f.message]
      .filter(Boolean).join(': ')}`,
  },
  am_wtf: {
    kind: 'trouble', fields: ['user', 'pid', 'process', 'flags', 'tag', 'message'],
    greedy: 'message',
    who: (f) => f.process,
    say: (f) => `WTF in ${f.process} · ${[f.tag, f.message].filter(Boolean).join(': ')}`,
  },
  am_low_memory: {
    kind: 'trouble', fields: ['processes'], who: () => null,
    say: (f) => `Low memory · ${f.processes} process${f.processes === '1' ? '' : 'es'} left`,
  },
  am_meminfo: {
    kind: 'trouble', fields: ['cached', 'free', 'zram', 'kernel', 'native'],
    who: () => null, say: () => 'Memory low enough to be recorded',
  },
  watchdog: {
    kind: 'trouble', fields: ['service'], greedy: 'service', who: (f) => f.service,
    say: (f) => `Watchdog · ${f.service}`,
  },
  watchdog_soft_reset:       { kind: 'trouble', fields: [], who: () => null,
    say: () => 'Watchdog asked for a soft reset' },
  watchdog_hard_reset:       { kind: 'trouble', fields: [], who: () => null,
    say: () => 'Watchdog asked for a hard reset' },
  watchdog_requested_reboot: { kind: 'trouble', fields: [], who: () => null,
    say: () => 'Watchdog asked for a reboot' },

  /* ---- the system ---- */
  configuration_changed: {
    kind: 'system', fields: ['mask'], who: () => null,
    say: (f) => {
      const names = configChanges(f.mask);
      return `Configuration changed${names.length ? ` · ${names.join(', ')}` : ''}`;
    },
  },
  am_switch_user: {
    kind: 'system', fields: ['user'], who: (f) => `user ${f.user}`,
    say: (f) => `Switched to user ${f.user}`,
  },
  power_screen_state: {
    kind: 'system',
    fields: ['state', 'becauseOfUser', 'totalTouchDownTime', 'touchCycles', 'latency'],
    who: () => null,
    say: (f) => `Screen ${f.state === '0' ? 'off' : 'on'}${
      f.becauseOfUser && f.becauseOfUser !== '0' ? ' · the user asked' : ''}`,
  },
  power_sleep_requested: {
    kind: 'system', fields: ['wakeLocksCleared'], who: () => null,
    say: (f) => `Sleep requested · ${f.wakeLocksCleared} wake lock${
      f.wakeLocksCleared === '1' ? '' : 's'} cleared`,
  },
  power_partial_wake_state: {
    kind: 'system', fields: ['held', 'tag'], greedy: 'tag', who: (f) => f.tag,
    say: (f) => `Partial wake lock ${f.held === '1' ? 'taken' : 'released'} · ${f.tag}`,
  },
  screen_toggled: {
    kind: 'system', fields: ['state'], who: () => null,
    say: (f) => `Screen ${f.state === '0' ? 'off' : 'on'}`,
  },
  battery_level: {
    kind: 'system', fields: ['level', 'voltage', 'temperature'], who: () => null,
    say: (f) => `Battery ${f.level}%${f.temperature ? ` · ${
      (Number(f.temperature) / 10).toFixed(1)}°C` : ''}`,
  },
  battery_status: {
    kind: 'system', fields: ['status', 'health', 'present', 'plugged', 'technology'],
    who: () => null, say: () => 'Battery status changed',
  },
  device_idle: {
    kind: 'system', fields: ['state', 'reason'], greedy: 'reason', who: () => null,
    say: (f) => `Doze state ${f.state}${f.reason ? ` · ${f.reason}` : ''}`,
  },
  device_idle_off_start: { kind: 'system', fields: ['reason'], greedy: 'reason', who: () => null,
    say: (f) => `Leaving doze${f.reason ? ` · ${f.reason}` : ''}` },
  device_idle_on_start:  { kind: 'system', fields: [], who: () => null,
    say: () => 'Entering doze' },
  notification_panel_revealed: { kind: 'system', fields: ['items'], who: () => null,
    say: () => 'Notification shade opened' },
  notification_panel_hidden:   { kind: 'system', fields: [], who: () => null,
    say: () => 'Notification shade closed' },
  volume_changed: {
    kind: 'system', fields: ['stream', 'prevVolume', 'volume', 'max', 'caller'],
    greedy: 'caller', who: (f) => f.caller,
    say: (f) => `Volume ${f.prevVolume} → ${f.volume} of ${f.max}`,
  },
  input_focus: {
    kind: 'system', fields: ['reason'], greedy: 'reason', who: () => null,
    say: (f) => `Input focus · ${f.reason}`,
  },
  dvm_lock_sample: {
    kind: 'trouble',
    fields: ['process', 'flags', 'thread', 'waitMs', 'file', 'line',
             'ownerFile', 'ownerLine', 'sampleMs'],
    who: (f) => f.process,
    say: (f) => `Lock contention in ${f.process} · ${f.waitMs} ms on ${
      f.thread || 'a thread'}`,
  },
  sf_stop_bootanim: {
    kind: 'system', fields: ['time'], who: () => null,
    say: (f) => `Boot animation stopped${evMs(f.time) ? ` · at ${evMs(f.time)}` : ''}`,
  },
};

/* The lifecycle events, which the framework logs twice over: with the user in
   front of them on a build up to Android 10 and with the activity's token in
   front of them since, under `am_` then `wm_`. Neither number is in the
   sentence, so one shape reads both eras — which is the whole reason they are
   generated here rather than written out twice. */
const EVENT_LIFECYCLE = [
  ['create_activity', 'created', ['user', 'token', 'taskId', 'component', 'action',
                                 'mimeType', 'uri', 'flags']],
  ['restart_activity', 'restarted', ['user', 'token', 'taskId', 'component']],
  ['resume_activity', 'resumed', ['user', 'token', 'taskId', 'component']],
  ['pause_activity', 'paused', ['user', 'token', 'component', 'userLeaving']],
  ['stop_activity', 'stopped', ['user', 'token', 'component']],
  ['destroy_activity', 'destroyed', ['user', 'token', 'taskId', 'component', 'reason']],
  ['finish_activity', 'finished', ['user', 'token', 'taskId', 'component', 'reason']],
  ['set_resumed_activity', 'is the resumed activity', ['user', 'component', 'reason']],
  ['focused_activity', 'took focus', ['user', 'component', 'reason']],
  ['new_intent', 'was given a new intent', ['user', 'token', 'taskId', 'component',
                                            'action', 'mimeType', 'uri', 'flags']],
];

/* And the callbacks, which are the same line again with the reason the
   framework called it. */
const EVENT_CALLBACKS = [
  ['create', 'onCreate'], ['start', 'onStart'], ['restart', 'onRestart'],
  ['resume', 'onResume'], ['paused', 'onPause'], ['stop', 'onStop'],
  ['destroy', 'onDestroy'], ['activity_result', 'onActivityResult'],
  ['top_resumed_gained', 'onTopResumedActivityChanged(true)'],
  ['top_resumed_lost', 'onTopResumedActivityChanged(false)'],
];

for (const [name, verb, fields] of EVENT_LIFECYCLE) {
  const entry = {
    kind: 'activity', fields, greedy: 'reason',
    who: (f) => f.component,
    say: (f) => `${shortComponent(f.component)} ${verb}${
      f.reason ? ` · ${f.reason}` : ''}`,
  };
  EVENT_TAGS[`am_${name}`] = entry;
  EVENT_TAGS[`wm_${name}`] = entry;
}

for (const [name, call] of EVENT_CALLBACKS) {
  const entry = {
    kind: 'activity', fields: ['who', 'component', 'reason'], greedy: 'reason',
    who: (f) => f.component,
    say: (f) => `${shortComponent(f.component)} · ${call}${
      f.reason ? ` · ${f.reason}` : ''}`,
  };
  EVENT_TAGS[`am_on_${name}_called`] = entry;
  EVENT_TAGS[`wm_on_${name}_called`] = entry;
}

for (const [name, what] of [['activity_launch_time', 'launched'],
                            ['activity_fully_drawn_time', 'fully drawn']]) {
  const entry = {
    kind: 'activity', fields: ['user', 'token', 'component', 'time'],
    who: (f) => f.component,
    say: (f) => `${shortComponent(f.component)} ${what}${
      evMs(f.time) ? ` in ${evMs(f.time)}` : ''}`,
  };
  EVENT_TAGS[`am_${name}`] = entry;
  EVENT_TAGS[`wm_${name}`] = entry;
}

for (const [tag, step] of Object.entries(BOOT_STEPS)) {
  EVENT_TAGS[tag] = {
    kind: 'system', fields: ['time'], who: () => null,
    say: (f) => `Boot · ${step}${evMs(f.time) ? ` · at ${evMs(f.time)}` : ''}`,
  };
}

/* What the reader makes of one line. A tag it knows becomes a sentence; one it
   does not keeps its name and whatever it printed, because a tag this reader
   has never seen is still something the framework thought worth logging. */
function eventRead(e) {
  const spec = EVENT_TAGS[e.tag] || null;
  const { parts, fields } = eventFields(e.message, spec ? spec.fields : null,
                                        spec ? spec.greedy : null);
  if (!spec) {
    return { kind: 'other', fields: {}, parts,
             who: null, title: `${e.tag}${e.message ? ` ${e.message}` : ''}` };
  }
  /* A tag's sentence is written per tag and reads its fields by name, so a
     line that came out short is a throw rather than a wrong sentence. What the
     line itself said is the answer either way. */
  const said = (fn, fallback) => {
    try { return fn(fields) || fallback; } catch (err) { return fallback; }
  };
  return {
    kind: spec.kind, fields, parts,
    who: said(spec.who, null),
    title: said(spec.say, `${e.tag} ${e.message}`),
  };
}

/* How many of each kind, and how many tags — asked of one section and again of
   the whole log. */
const eventCounts = (list) => {
  const out = {};
  for (const e of list) out[e.kind] = (out[e.kind] || 0) + 1;
  return out;
};
const eventTagCount = (list) => new Set(list.map((e) => e.tag)).size;

const EVENT_KINDS = {
  process:  { label: 'process',  mark: 'p', family: 'ev-process' },
  activity: { label: 'activity', mark: 'a', family: 'ev-activity' },
  trouble:  { label: 'trouble',  mark: '!', family: 'ev-trouble' },
  system:   { label: 'system',   mark: 's', family: 'ev-system' },
  other:    { label: 'other',    mark: '·', family: 'ev-other' },
};

/* A tag this reader has never seen is still an event, and is filed as one. */
const evKind = (kind) => EVENT_KINDS[kind] || EVENT_KINDS.other;

function parseEventLogDump(input) {
  const lines = dumpLines(input);

  const sections = [];
  let current = null, inEvents = false;
  const section = (title) => {
    current = { id: sections.length, title: title || 'event log', events: [] };
    sections.push(current);
    return current;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const sec = line.match(LOG_SECTION_RE);
    if (sec) {
      const title = sec[1].trim().toLowerCase();
      inEvents = EVENT_SECTION_RE.test(title);
      current = inEvents ? section(title) : null;
      continue;
    }
    const begun = line.match(LOG_BEGIN_RE);
    if (begun) {
      inEvents = begun[1] === 'events';
      if (inEvents && !current) section(null);
      continue;
    }
    if (/^-{4,}/.test(line)) { current = null; inEvents = false; continue; }

    const m = line.match(LOG_HEAD_RE);
    if (!m) continue;
    const e = logEntry(m, i + 1, 'events');
    /* Outside a buffer this reader was told about, a line is an event only if
       the framework declares its tag. That is what keeps a system log full of
       `ActivityManager:` prose out of a reader that would otherwise read every
       line in a bugreport as an event with a tag it did not know. */
    if (!inEvents && !EVENT_TAGS[e.tag]) continue;
    if (!current) section(null);
    current.events.push(Object.assign(e, eventRead(e)));
  }

  const nodes = [];
  const displays = [];
  let z = 0;

  for (const sec of sections) {
    if (!sec.events.length) continue;
    const counts = eventCounts(sec.events);

    for (const e of sec.events) {
      const kind = evKind(e.kind);
      nodes.push({
        hash: `event:${sec.id}:${e.at}`,
        title: e.title,
        displayId: sec.id,
        frame: null, frameSource: null, z: -z++,
        family: kind.family,
        typeLabel: kind.label,
        badges: e.kind === 'trouble' ? [[kind.label, 'badge-exit']] : [],
        search: `${e.tag} ${e.title} ${e.who || ''} ${e.message} ${e.pid}`.toLowerCase(),
        raw: e.raw,
        visible: true, focused: false,
        parentHash: null, ancestors: [], subCount: 0,
        at: e.at, meta: e.who || null,
        entry: e, tag: e.tag, kind: e.kind, who: e.who,
        fields: e.fields, parts: e.parts,
        trouble: e.kind === 'trouble',
        known: !!EVENT_TAGS[e.tag],
      });
    }

    const first = sec.events[0], last = sec.events[sec.events.length - 1];
    const trouble = counts.trouble || 0;
    displays.push({
      id: sec.id, label: sec.title, name: null,
      size: { w: 0, h: 0 }, insets: [], raw: '',
      events: sec.events.length, counts, first, last,
      tags: eventTagCount(sec.events),
      meta: `${sec.events.length} event${sec.events.length === 1 ? '' : 's'}${
        trouble ? ` · ${trouble} trouble` : ''}`,
    });
  }

  const all = sections.flatMap((s) => s.events);
  const counts = eventCounts(all);
  const of = (...tags) => all.filter((e) => tags.includes(e.tag));

  const globals = {
    events: all.length,
    sections: displays.length,
    tags: eventTagCount(all),
    unknown: new Set(all.filter((e) => !EVENT_TAGS[e.tag]).map((e) => e.tag)).size,
    counts,
    first: all.length ? logStamp(all[0]) : null,
    last: all.length ? logStamp(all[all.length - 1]) : null,
    /* The three questions this buffer is opened with, answered before it is
       read: what crashed, what hung, and what the system took away. */
    anrs: of('am_anr').map((e) => ({ at: e.at, who: e.who, title: e.title })),
    crashes: of('am_crash', 'am_wtf').map((e) => ({ at: e.at, who: e.who, title: e.title })),
    kills: of('am_kill').map((e) => ({ at: e.at, who: e.who, title: e.title })),
    lowMemory: of('am_low_memory').length,
    /* A boot in the log is the marks the framework left on its way up, and the
       last of them is how long it took to get there. */
    boot: all.filter((e) => BOOT_STEPS[e.tag])
      .map((e) => ({ at: e.at, step: BOOT_STEPS[e.tag], ms: e.fields.time || null })),
    started: of('am_proc_start').length,
    died: of('am_proc_died').length,
    configChanges: of('configuration_changed').length,
  };

  return finaliseScene('events', displays, nodes, globals);
}
