/* ================ parse: logcat ================ */

/* A bugreport carries its logs in the same file as its dumps, printed by
   `logcat -v threadtime` under a rule that names the buffer. There is nothing
   to draw and nothing to nest: a log is a stream, and the thing that makes one
   readable is that it is the stream — every line, in the order it happened,
   with the stamp, the process, the level and the tag in fixed columns down the
   left. So the list is the lines. The rule above each log is a group, which is
   what puts main, events, radio and the kernel on their own tabs; the level
   buttons are the `*:W` every log reader has; the filter box is the tag or the
   pid or the words in the message.

   The same parser reads a plain `adb logcat -d`, which is the same text
   without the rule above it. */

/* `09-21 11:02:31.088  1000  1631  1668 I ActivityManager: msg`, and the four
   ways that line varies: a year in front of the date on a recent build, the
   uid column that `-v uid` adds, a pid and a tid that are always there, and
   the single letter that is the level. */
const LOG_HEAD_RE =
  /^(?:(\d{4})-)?(\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}:\d{2}\.\d{3})\s+(?:(\S+)\s+)?(\d+)\s+(\d+)\s+([VDIWEFSA])\s+(.*)$/;
/* dmesg, which is its own format: a timestamp since boot and then the line. */
const LOG_KERNEL_RE = /^\[\s*(\d+\.\d+)\]\s(.*)$/;
/* The rule a bugreport prints above each log, and the marker logd prints when
   it moves to another buffer. */
const LOG_SECTION_RE = /^-{4,}\s*([A-Z][A-Z0-9 _./-]*?LOG[A-Z0-9 _./-]*?)\s*(?:\(([^)]*)\))?\s*-{4,}\s*$/;
const LOG_BEGIN_RE = /^-{4,}\s*beginning of (\S+)\s*$/;

const LOG_LEVELS = {
  V: { name:'verbose', rank:0, family:'log-verbose' },
  D: { name:'debug',   rank:1, family:'log-debug' },
  I: { name:'info',    rank:2, family:'log-info' },
  W: { name:'warn',    rank:3, family:'log-warn' },
  E: { name:'error',   rank:4, family:'log-error' },
  F: { name:'fatal',   rank:5, family:'log-fatal' },
  A: { name:'assert',  rank:5, family:'log-fatal' },
  S: { name:'silent',  rank:0, family:'log-verbose' },
};
const logLevel = (ch) => LOG_LEVELS[ch] || LOG_LEVELS.I;

/* How many lines the reader will hold. Only the screenful being looked at is
   ever in the DOM, so what this bounds is memory rather than layout, and it is
   set high enough that the whole of a normal bugreport's logs is in the list
   and nothing is quietly missing from a search. Past it the log is sampled
   rather than truncated, so what is dropped is the repetition and not the end
   of the file. */
const LOG_MAX_LINES = 250000;

/* How the budget is split when a file holds several logs. Evenly, except that
   a log shorter than its share gives the rest back — so the event log and the
   kernel log come through whole and the system log, which is the one with a
   quarter of a million lines in it, takes what is left. A single pool handed
   out first-come would spend the whole of it on the first buffer and leave
   the others empty. */
/* Two hundred thousand rows is two hundred thousand objects, so what a row
   holds is worth counting. The text a filter matches on is the tag and the
   message again, lowercased — half the memory of the log for a string that is
   only ever read while someone is typing — so it is worked out when it is
   asked for rather than kept. Every log node is made on this, which is also
   what keeps the two empty arrays a row would otherwise each allocate down to
   one of each for the whole log. */
const LOG_NODE = {
  badges: Object.freeze([]),
  ancestors: Object.freeze([]),
  get search() {
    const e = this.entry;
    return `${e.tag} ${e.message} ${e.pid === null ? '' : e.pid}${
      e.tid === null ? '' : ' ' + e.tid} ${e.level.name}${
      e.process ? ' ' + e.process : ''}`.toLowerCase();
  },
};

function logBudgets(sections, cap) {
  const need = sections.map((sec) => sec.entries.length);
  const out = need.map(() => 0);
  let left = cap;
  let open = need.map((_, i) => i).filter((i) => need[i] > 0);
  while (open.length && left > 0) {
    const share = Math.floor(left / open.length);
    if (!share) break;
    const next = [];
    for (const i of open) {
      const take = Math.min(share, need[i] - out[i]);
      out[i] += take;
      left -= take;
      if (out[i] < need[i]) next.push(i);
    }
    open = next;
  }
  return out;
}

/* Which lines to keep when a log printed more than the budget: the worst
   first, and among equals the first ones printed, then back into printed order
   so the list still reads down the page. */
function logKeep(entries, cap) {
  if (entries.length <= cap) return entries;
  const ranked = entries.slice().sort((a, b) => b.level.rank - a.level.rank || a.at - b.at);
  return ranked.slice(0, cap).sort((a, b) => a.at - b.at);
}

/* Which buffer is the event log, out of the name a bugreport rules it with or
   the marker logd writes at the top of a pasted one. Both readers of that
   buffer agree on this: the event reader takes it, and the log reader leaves
   it, so the two never list the same line twice. */
const EVENT_SECTION_RE = /event/i;

/* `FATAL EXCEPTION` is the first line of a Java crash and `am_crash` is the
   event the framework logs for the same thing. Either one means this tag is
   the reason the log was taken. */
const LOG_CRASH_RE = /FATAL EXCEPTION|^am_crash|beginning of crash/;
const logCrash = (e) => LOG_CRASH_RE.test(e.tag) || LOG_CRASH_RE.test(e.message);

/* How many lines each level printed, keyed by the level's name. */
function logLevelCounts(entries) {
  const out = {};
  for (const e of entries) out[e.level.name] = (out[e.level.name] || 0) + 1;
  return out;
}

const logPlural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function logEntry(m, at, buffer) {
  const rest = m[8];
  const cut = rest.indexOf(': ');
  const tag = (cut < 0 ? rest : rest.slice(0, cut)).trim();
  const message = cut < 0 ? '' : rest.slice(cut + 2);
  return {
    at,
    year: m[1] || null,
    date: m[2],
    time: m[3],
    uid: m[4] || null,
    pid: +m[5],
    tid: +m[6],
    level: logLevel(m[7]),
    levelChar: m[7],
    tag: tag || '(no tag)',
    message,
    buffer,
    raw: m[0],
  };
}

function logKernelEntry(m, at, buffer) {
  const body = m[2];
  const cut = body.indexOf(': ');
  const tag = cut < 0 ? 'kernel' : body.slice(0, cut).trim();
  return {
    at,
    year: null, date: null, time: null,
    uptime: +m[1],
    uid: null, pid: null, tid: null,
    /* dmesg prints no level, and guessing one off the words in the line would
       put a colour on a judgement the log did not make. */
    level: logLevel('I'),
    levelChar: null,
    tag: tag.split(/[\s[]/)[0] || 'kernel',
    message: cut < 0 ? body : body.slice(cut + 2),
    buffer,
    raw: m[0],
  };
}

/* Which process a pid was. A log line carries the pid and nothing else about
   who printed it — Android Studio gets the name from the live device, which a
   bugreport no longer is. The file says it anyway, in the places the platform
   names a process beside its pid: the line ActivityManager writes as it starts
   one, the event for the same thing, the process records the activity dump
   prints, the crash header, the ANR trace and the `ps` table. A start is when a pid became
   that process, so it holds from then on; the rest only say what the pid was
   at some point, and are what is left for a pid the log never saw start —
   the activity dump's record over the rest, because it is the name the
   framework gave the process, and `ps` under everything, because what it
   prints for an app is a thread name cut to fifteen characters. It is still
   the only place system_server and the native daemons are named at all. */
const LOG_PROC_STARTS = [
  /\bStart proc (\d+):([^\s/]+)\//,
  /\bam_proc_start\s*:\s*\[\d+,(\d+),\d+,([^,\]]+)/,
];
const LOG_PROC_RECORD_RE = /\bProcessRecord\{[0-9a-f]+ (\d+):([^\s/}]+)\//;
const LOG_PROC_CRASH_RE = /\bProcess: ([^\s,]+), PID: (\d+)/;
/* The header of one process in an ANR trace, and the name under it. */
const LOG_TRACE_PID_RE = /^----- pid (\d+) at /;
const LOG_TRACE_CMD = 'Cmd line: ';
/* An app prints its first lines before ActivityManager gets round to saying
   it started it, so a start counts from a moment before it was logged. A pid
   is not handed out again inside that. */
const LOG_PROC_SLACK = 5000;

/* A clock stamp as milliseconds, near enough to order and subtract: the year
   is left out and a month is 31 days, neither of which a log's span crosses. */
const logMs = (e) => {
  if (!e.time) return null;
  const [mo, d] = e.date.split('-').map(Number);
  const [h, mi, sec] = e.time.split(':');
  return ((((mo * 31 + d) * 24 + +h) * 60 + +mi) * 60 + parseFloat(sec)) * 1000;
};

const LOG_PS_HEAD_RE = /^(?:LABEL\s+)?USER\s+PID\s+(?:TID\s+)?PPID\s.*\s(?:CMD|NAME)\s*$/;

function logProcs() {
  const starts = new Map(), seen = new Map();
  const saw = (pid, name, rank) => {
    const was = seen.get(pid);
    if (!was || was.rank <= rank) seen.set(pid, { name, rank });
  };
  let tracePid = null, ps = null;
  return {
    line(line) {
      if (ps) {
        const f = line.trim().split(/\s+/);
        const pid = +f[ps.pid];
        if (f.length > ps.name && Number.isInteger(pid) && pid > 0) {
          /* A thread listing names every thread; the process is the one whose
             tid is its pid. */
          if (ps.tid < 0 || +f[ps.tid] === pid) saw(pid, f.slice(ps.name).join(' '), 0);
          return;
        }
        ps = null;
      }
      if (LOG_PS_HEAD_RE.test(line)) {
        const h = line.trim().split(/\s+/);
        ps = { pid: h.indexOf('PID'), tid: h.indexOf('TID'),
               name: Math.max(h.indexOf('CMD'), h.indexOf('NAME')) };
        return;
      }
      if (tracePid !== null && line.startsWith(LOG_TRACE_CMD)) {
        saw(tracePid, line.slice(LOG_TRACE_CMD.length).trim(), 1);
        tracePid = null;
        return;
      }
      const trace = line.match(LOG_TRACE_PID_RE);
      if (trace) { tracePid = +trace[1]; return; }
      /* Every one of the shapes has `roc` in it, which is the cheap way past
         the half a million lines that are none of them. */
      if (!line.includes('roc')) return;
      for (const re of LOG_PROC_STARTS) {
        const m = line.match(re);
        if (!m) continue;
        const h = line.match(LOG_HEAD_RE);
        const at = h ? logMs({ date: h[2], time: h[3] }) : null;
        if (at === null) { saw(+m[1], m[2], 1); return; }
        if (!starts.has(+m[1])) starts.set(+m[1], []);
        starts.get(+m[1]).push({ at: at - LOG_PROC_SLACK, name: m[2] });
        return;
      }
      const rec = line.match(LOG_PROC_RECORD_RE);
      if (rec) return void saw(+rec[1], rec[2], 2);
      const crash = line.match(LOG_PROC_CRASH_RE);
      if (crash) saw(+crash[2], crash[1], 1);
    },
    /* The latest start at or before the line. A pid that started only after
       it was another process then, which the file does not name. */
    of(e) {
      if (e.pid === null) return null;
      const list = starts.get(e.pid);
      if (!list) return seen.has(e.pid) ? seen.get(e.pid).name : null;
      const t = logMs(e);
      let name = null;
      for (const s of list) if (t !== null && s.at <= t) name = s.name;
      return name;
    },
    done() { for (const list of starts.values()) list.sort((a, b) => a.at - b.at); },
  };
}

/* The stamp a row prints: the clock without the date, or the kernel's seconds
   since boot. */
const logWhenCell = (e) => e.time ? e.time
  : e.uptime !== undefined ? `[${e.uptime.toFixed(3)}]` : '';

const logStamp = (e) => e.time
  ? `${e.date} ${e.time}` : e.uptime !== undefined ? `[${e.uptime.toFixed(6)}]` : '';

function parseLogcatDump(input) {
  const text = dumpText(input);
  const lines = text.split('\n');

  /* One section per rule in the file, and one unnamed section for a log that
     arrived without a rule above it. A section only becomes a group once a
     line lands in it, so the dumps either side of a log in a bugreport do not
     leave empty buffers behind. */
  const sections = [];
  let current = null;
  const section = (title, command) => {
    current = { id: sections.length, title, command: command || null,
                entries: [], buffers: new Set() };
    sections.push(current);
    return current;
  };
  const into = (e) => {
    if (!current) section('log', null);
    current.entries.push(e);
    if (e.buffer) current.buffers.add(e.buffer);
  };

  /* The event buffer is a log, and it is the one log this reader does not
     read. Every line in it is a tag and a list of numbers — `am_proc_start:
     [0,5210,...]` — which is unreadable as a line and is the whole subject of
     the event reader next door. Listing it here as well would put the same
     lines on the desk twice, in the reading that is no use. */
  let buffer = null, kernel = false, events = false;
  const procs = logProcs();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    procs.line(line);

    const sec = line.match(LOG_SECTION_RE);
    if (sec) {
      const title = sec[1].trim().toLowerCase();
      events = EVENT_SECTION_RE.test(title);
      current = null;
      if (!events) section(title, sec[2] || null);
      buffer = null;
      kernel = /kernel|dmesg/.test(title) || /dmesg/.test(sec[2] || '');
      continue;
    }
    const begun = line.match(LOG_BEGIN_RE);
    /* A pasted `logcat -b events` has no rule over it, only logd's marker. */
    if (begun) { buffer = begun[1]; events = begun[1] === 'events'; continue; }
    /* Any other rule ends the log that was being read: what follows it is
       another service's dump, and a `[    1.2] ...` line in the middle of one
       is not a kernel log line. */
    if (/^-{4,}/.test(line)) {
      current = null; buffer = null; kernel = false; events = false; continue;
    }
    if (events) continue;

    const m = line.match(LOG_HEAD_RE);
    if (m) { into(logEntry(m, i + 1, buffer)); continue; }
    if (kernel) {
      const k = line.match(LOG_KERNEL_RE);
      if (k) into(logKernelEntry(k, i + 1, buffer || 'kernel'));
    }
  }

  procs.done();
  for (const sec of sections) for (const e of sec.entries) e.process = procs.of(e);

  const nodes = [];
  const displays = [];
  const budgets = logBudgets(sections, LOG_MAX_LINES);
  let kept = 0;

  for (const [si, sec] of sections.entries()) {
    if (!sec.entries.length) continue;
    const id = sec.id;

    /* The tags are still counted — how many printed, and which of them carry a
       crash, is what the group's own pane says about the log — but they are
       not what the list is made of. */
    const tags = new Map();
    for (const e of sec.entries) {
      let t = tags.get(e.tag);
      if (!t) { t = { tag: e.tag, lines: 0, crash: false }; tags.set(e.tag, t); }
      t.lines++;
      if (!t.crash && logCrash(e)) t.crash = true;
    }

    const keep = logKeep(sec.entries, budgets[si]);
    kept += keep.length;

    for (const e of keep) {
      const crash = logCrash(e);
      nodes.push(Object.assign(Object.create(LOG_NODE), {
        hash: `log:${id}:line:${e.at}`,
        /* The message is the row, which is why it is the title: it is what the
           filter matches on, what search across the desk shows, and what the
           pane is headed with when the line is picked. */
        title: e.message || e.tag,
        displayId: id,
        frame: null, frameSource: null,
        z: -e.at,
        family: crash ? 'log-crash' : e.level.family,
        typeLabel: e.level.name,
        visible: true, focused: false,
        at: e.at,
        raw: e.raw,
        entry: e,
        level: e.level,
        tag: e.tag,
        lineNo: e.at,
        crash,
        parentHash: null,
        subCount: 0,
        /* `badges` and `ancestors` come off the prototype; a crash is the one
           line in a log that has anything to say in the margin. */
        ...(crash ? { badges: [['crash', 'badge-focus']] } : null),
      }));
    }

    const counts = logLevelCounts(sec.entries);
    /* The widths the list sets its first columns at, so they line up down the
       log and a column dragged wider moves the same edge on every row. */
    let whenCh = 0, whoCh = 0, named = 0;
    for (const e of keep) {
      whenCh = Math.max(whenCh, logWhenCell(e).length);
      if (e.pid !== null) whoCh = Math.max(whoCh, `${e.pid}-${e.tid}`.length);
      if (e.process) named++;
    }
    const errors = (counts.error || 0) + (counts.fatal || 0);
    const first = sec.entries[0], last = sec.entries[sec.entries.length - 1];
    displays.push({
      id,
      label: sec.title,
      name: null,
      size: { w: 0, h: 0 },
      insets: [], raw: '',
      command: sec.command,
      lines: sec.entries.length,
      listed: keep.length,
      tags: tags.size,
      counts,
      errors,
      buffers: [...sec.buffers],
      first, last,
      whenCh, whoCh,
      /* How many lines the file names the process of. None is a log with no
         process starts in it and nothing else beside it, and the list leaves
         the column out rather than drawing it empty. */
      named,
      crashes: [...tags.values()].filter((t) => t.crash).map((t) => t.tag),
      meta: [logPlural(sec.entries.length, 'line'), logPlural(tags.size, 'tag'),
             errors && logPlural(errors, 'error')].filter(Boolean).join(' · '),
    });
  }

  const all = sections.flatMap((s) => s.entries);
  /* The span of a log read out of a bugreport is not its first and last line:
     the buffers are printed one after another, so the radio log's last line
     comes after the system log's in the file and an hour before it in time.
     The stamps sort as text — the fields run largest first — so the ends of
     that sort are the ends of the log. */
  const clocked = all.filter((e) => e.time)
    .sort((a, b) => `${a.year || ''}${a.date} ${a.time}`
      .localeCompare(`${b.year || ''}${b.date} ${b.time}`));
  const counts = logLevelCounts(all);
  const crashTags = new Set(displays.flatMap((d) => d.crashes));

  const globals = {
    sections: displays.length,
    lines: all.length,
    shown: kept,
    tags: new Set(all.map((e) => e.tag)).size,
    errors: (counts.error || 0) + (counts.fatal || 0),
    warns: counts.warn || 0,
    counts,
    crashes: crashTags.size,
    /* The span of the log, which is a wall clock. dmesg counts from boot
       instead, so its lines are left out of it rather than printed as the end
       of a range that starts at a date. */
    first: clocked.length ? logStamp(clocked[0]) : null,
    last: clocked.length ? logStamp(clocked[clocked.length - 1]) : null,
    /* How many lines the file had that the list does not, which is nothing at
       all until a log is longer than the budget. */
    trimmed: all.length - kept,
  };

  return finaliseScene('logcat', displays, nodes, globals);
}
