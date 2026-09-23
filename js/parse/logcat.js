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
      e.tid === null ? '' : ' ' + e.tid} ${e.level.name}`.toLowerCase();
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

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
      if (LOG_CRASH_RE.test(e.tag) || LOG_CRASH_RE.test(e.message)) t.crash = true;
    }

    const keep = logKeep(sec.entries, budgets[si]);
    kept += keep.length;

    for (const e of keep) {
      const crash = LOG_CRASH_RE.test(e.message) || LOG_CRASH_RE.test(e.tag);
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

    const counts = {};
    for (const e of sec.entries) counts[e.level.name] = (counts[e.level.name] || 0) + 1;
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
      crashes: [...tags.values()].filter((t) => t.crash).map((t) => t.tag),
      meta: `${sec.entries.length} line${sec.entries.length === 1 ? '' : 's'} · ${
        tags.size} tag${tags.size === 1 ? '' : 's'}${errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : ''}`,
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
  const counts = {};
  for (const e of all) counts[e.level.name] = (counts[e.level.name] || 0) + 1;

  const crashTags = new Set();
  for (const e of all) {
    if (LOG_CRASH_RE.test(e.tag) || LOG_CRASH_RE.test(e.message)) crashTags.add(e.tag);
  }

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
