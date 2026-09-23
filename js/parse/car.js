/* ================ parse: dumpsys car_service ================ */

/* A car_service dump is a document of nested sections rather than a list of
   things: `*Name*` opens one, and everything up to the next heading of any
   kind belongs to it. Depth is read from the stars first and the indent
   second, because the services behind it disagree about which of the two
   carries the nesting — CarAudioService indents its subsections and keeps one
   star, Input Service leaves the indent alone and adds a star per level — and
   neither of them is wrong. Reading both, stars first, is what puts every
   writer's sections where they belong, the `***X dump***` heading the service
   dumper prints at no indent at all included. */
const CAR_HEAD_RE = /^(\s*)(\*+)\s*([^*\s].*?)\s*$/;

/* The headings that are the shape of the document rather than anything in it.
   They are dropped and whatever they held is raised into their place, so the
   list opens on the services instead of on one row saying `Dump all
   services`. */
const CAR_STRUCTURAL_RE = /^dump (?:car service|versions?|all services)$/i;

/* A service that threw on its way out says so, and then prints the stack it
   threw. Either half is enough to know the block below is short of what it
   should have held. */
const CAR_FAIL_RE = /^\s*(?:Failed dumping\b|(?:java|android|dalvik)\.[\w.$]*(?:Exception|Error)\b)/m;

/* A heading's own name, without the stars that close it and without whatever
   the service went on to print on the same line. */
function carHeadName(rest) {
  const m = rest.match(/^(.*?)\s*\*+\s*(.*)$/);
  const trail = m ? m[2].trim() : '';
  /* `***CarOemProxyService dump***` is the heading the service dumper writes
     for a service that prints none of its own; the service is the name. */
  const name = (m ? m[1] : rest).trim().replace(/\s+dump$/i, '');
  return { name, trail };
}

/* Most of what a section prints is `key: value` or `key=value`, one to a line,
   so the details pane can lay it out instead of leaving it as a wall of text.
   A line that starts with anything but a name — a timestamp, a stack frame, a
   table row — is not a pair and is left to the raw block. */
/* What a name printed before its value looks like, in any dump. The charset
   is narrow on purpose: a stack frame is `at Foo.dump(Foo.java:744)` and a log
   line starts with a date, and neither is a name with a value after it. */
const PAIR_RE = /^([A-Za-z_#][\w .#/-]*?)\s*[:=]\s*(.*)$/;

function carPairs(body) {
  const out = [];
  for (const line of body) {
    const t = line.trim();
    /* A thrown stack is answered above the block rather than laid out in it. */
    if (/^at\s/.test(t) || CAR_FAIL_RE.test(t)) continue;
    const m = t.match(PAIR_RE);
    if (m && m[2]) out.push([m[1].trim(), m[2].trim()]);
  }
  return out;
}

/* A line read as a record: `key: value` fields separated by commas that are
   not inside brackets. Dumps print their tables this way — one property, one
   event, one user to a line — and a run of them is unreadable until it is laid
   out in columns. A line that does not read as a record from end to end is not
   one, so prose stays prose. */
function lineFields(line) {
  const t = String(line).trim();
  if (!t) return null;
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') depth--;
    else if (c === ',' && depth === 0) { parts.push(t.slice(start, i)); start = i + 1; }
  }
  parts.push(t.slice(start));

  const fields = [];
  for (const part of parts) {
    const m = part.trim().match(/^([A-Za-z][\w .#/-]*?)\s*([:=])\s*(.*)$/);
    if (!m) return null;
    /* The separator comes back with the field. A line whose fields all use the
       same one is a line of fields; one that mixes them is a name followed by
       something that has fields of its own, and those are not the same thing. */
    fields.push([m[1].trim(), m[3].trim(), m[2]]);
  }
  return fields;
}

/* What a section printed, split into the runs it printed it in: three or more
   lines to the same shape at the same indent are a table, and everything else
   is text. Two fields are the minimum for a table — a run of one-field lines
   is a list, and a list reads better as the lines it was written as.
   A line printed deeper than the run does not end it: a property that has
   areas prints them under itself, and those belong to the row above rather
   than to a table of their own. */
function blockRuns(body) {
  const out = [];
  let text = [];
  const flush = () => { if (text.length) { out.push({ kind: 'text', lines: text }); text = []; } };
  const sig = (f) => f.map(([k]) => k).join('|');

  for (let i = 0; i < body.length;) {
    const first = lineFields(body[i]);
    if (!first) { text.push(body[i]); i++; continue; }
    const head = sig(first), pad = indentOf(body[i]);

    const rows = [];
    let j = i;
    for (; j < body.length; j++) {
      const line = body[j];
      const fields = lineFields(line);
      if (fields && sig(fields) === head && indentOf(line) === pad) {
        rows.push({ cells: fields.map(([, v]) => v), under: [] });
      } else if (rows.length && line.trim() && indentOf(line) > pad) {
        rows[rows.length - 1].under.push(line.trim());
      } else break;
    }

    if (first.length >= 2 && rows.length >= 3) {
      flush();
      out.push({ kind: 'table', keys: first.map(([k]) => k), rows });
    } else {
      for (let k = i; k < j; k++) text.push(body[k]);
    }
    i = j;
  }
  flush();
  return out;
}

/* The lines a block printed, as the tree the indenting says they are: a line
   is an entry, and the lines under it at a deeper indent belong to it.
   `key: value` and `key=value` split; a line that is neither is an entry with
   no value, which is what a label over a list is, and what a log line or a
   policy printed with its own brackets is too. This and blockRuns are what the
   reading pane is built on, and neither knows which dump it is reading. */
function blockEntries(lines) {
  const roots = [];
  const open = [];
  lines.forEach((raw, at) => {
    if (!raw.trim()) return;
    const indent = indentOf(raw);
    while (open.length && indent <= open[open.length - 1].indent) open.pop();

    const line = raw.trim();
    const parent = open.length ? open[open.length - 1].entry : null;
    const add = (key, value, field) => {
      const entry = { at, field, indent, key, value, line, children: [] };
      (parent ? parent.children : roots).push(entry);
      return entry;
    };

    /* A service that printed three names and their values on one line printed
       three attributes, not one with a value that swallowed the other two.
       They come back as siblings; anything printed under the line belongs to
       the last of them, which is where the indenting continues from. */
    const fields = lineFields(line);
    const split = fields && fields.length > 1
      && fields.every((f) => f[2] === fields[0][2]);

    let last;
    if (split) fields.forEach(([key, value], i) => { last = add(key, value, i); });
    else {
      const m = line.match(PAIR_RE);
      last = add(m ? m[1].trim() : line, m ? m[2].trim() : null, 0);
    }
    open.push({ indent, entry: last });
  });
  return roots;
}

/* A property id is printed as a bare hex int nearly everywhere and given its
   name in two places: the Vehicle HAL's property list and its handler table.
   Reading both means every other mention of that id can be named too, without
   this file carrying a copy of the VHAL's property ids. */
function carPropNames(text) {
  const names = {};
  const shapes = [
    /Property:(0x[0-9a-f]+),\s*Property name:([A-Za-z0-9_]+)/gi,
    /\/\/\s*(0x[0-9a-f]+)\s+name:\s*([A-Za-z0-9_]+)/gi,
  ];
  for (const re of shapes) {
    let m;
    while ((m = re.exec(text)) !== null) names[m[1].toLowerCase()] = m[2];
  }
  return names;
}

function carNode(h, parent, ancestors, hashOf, lines, z) {
  const failed = CAR_FAIL_RE.test(h.raw);
  const service = !parent;
  const hal = /\bHALs?\b|HALSERVICE/i.test(h.name);
  const family = failed ? 'car-failed' : hal ? 'car-hal'
               : service ? 'car-service' : 'car-section';
  const typeLabel = failed ? 'failed to dump' : hal ? 'HAL'
                  : service ? 'service' : 'section';
  const printed = h.body.filter((l) => l.trim()).length;

  return {
    hash: hashOf(h), title: h.name, displayId: 0,
    frame: null, frameSource: null, z,
    family, typeLabel,
    badges: [
      ...(failed ? [['failed to dump', 'badge-exit']] : []),
      ...(!printed && !h.kids.length ? [['empty', 'badge-comp']] : []),
    ],
    /* The filter reaches the whole block, not just the heading: what a
       car_service dump is opened for is usually a value somewhere inside one
       of forty services, and the tree opens down to whatever matches. */
    search: `${h.name} ${typeLabel} ${h.raw}`.toLowerCase(),
    raw: h.raw, visible: true, focused: false,
    parentHash: parent ? hashOf(parent) : null,
    ancestors,
    failed, service, hal,
    /* The lines themselves, for the pane that reads the section rather than
       summarising it. They are the same strings the raw block holds. */
    body: h.body,
    /* Where body[0] sits in the file. A section that went on printing on its
       own heading line starts a line earlier than one that did not. */
    bodyAt: h.trail ? h.line + 1 : h.line + 2,
    subCount: h.kids.length,
    own: h.own, lines,
    at: h.line + 1,
  };
}

/* What opens this dump: the heading the car service dumper writes before
   anything else. A bugreport is every dumpsys one after another in one file,
   and a heading here is a line between stars — which SurfaceFlinger prints
   for every layer (`* Layer 0x...`), so unscoped, a phone's layers become a
   couple of thousand car services. The dump is read inside its own part of
   the file, the way the input and user readers read theirs. */
const CAR_SECTION_START = /^\s*\*+\s*Dump (?:car service|versions?|all services)\s*\*+\s*$/i;

/* Nothing said where it starts, so all of it is the dump — a pasted
   `dumpsys car_service` of one service prints no such heading. */
const carSection = (lines) => sectionSpan(lines, CAR_SECTION_START, null, 'all');

function parseCarServiceDump(input) {
  const lines = dumpLines(input);
  /* Indices stay the file's own, so a section still says which line of the
     bugreport it came off; only the span being read is narrowed. */
  const { start: from, end: to } = carSection(lines);

  const heads = [];
  for (let i = from; i < to; i++) {
    const m = lines[i].match(CAR_HEAD_RE);
    if (!m) continue;
    const { name, trail } = carHeadName(m[3]);
    if (name) heads.push({ line: i, indent: m[1].length, stars: m[2].length, name, trail, kids: [] });
  }
  if (!heads.length) return finaliseScene('car', [], [], {});

  /* A section holds what it printed before the next heading started, so a
     service's own block is its preamble and its subsections are theirs. */
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].line : to;
    h.body = (h.trail ? [h.trail] : []).concat(lines.slice(h.line + 1, end));
    h.raw = lines.slice(h.line, end).join('\n').replace(/\n+$/, '');
    h.own = end - h.line;
  });

  const deeper = (a, b) => a.stars > b.stars || (a.stars === b.stars && a.indent > b.indent);
  const open = [];
  for (const h of heads) {
    while (open.length && !deeper(h, open[open.length - 1])) open.pop();
    h.parent = open.length ? open[open.length - 1] : null;
    if (h.parent) h.parent.kids.push(h);
    open.push(h);
  }

  const structural = (h) => CAR_STRUCTURAL_RE.test(h.name);
  const up = (h) => { let p = h.parent; while (p && structural(p)) p = p.parent; return p; };
  const hashOf = (h) => `car:${h.line}`;
  const deep = (h) => h.own + h.kids.reduce((sum, k) => sum + deep(k), 0);

  const nodes = heads.filter((h) => !structural(h)).map((h, i) => {
    const parent = up(h);
    const chain = [];
    for (let p = parent; p; p = up(p)) chain.unshift({ hash: hashOf(p), title: p.name });
    return carNode(h, parent, chain, hashOf, deep(h), -i);
  });

  const versions = heads.find((h) => /^dump versions?$/i.test(h.name));
  const globals = {
    versions: versions ? carPairs(versions.body) : [],
    propNames: carPropNames(lines.slice(from, to).join('\n')),
    services: nodes.filter((n) => !n.parentHash).length,
    sections: nodes.length,
    failed: nodes.filter((n) => n.failed).map((n) => n.hash),
    lines: to - from,
  };

  /* Nothing in a car_service dump belongs to a display or a user, so there is
     one group and it is the dump. */
  const display = {
    id: 0, label: 'car service', name: null,
    size: { w: 0, h: 0 }, insets: [], raw: '',
    meta: `${globals.services} services · ${globals.sections} sections`,
  };

  return finaliseScene('car', [display], nodes, globals);
}
