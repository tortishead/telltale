/* ================ parse: dumpsys overlay ================ */

/* The overlay manager prints one block per runtime resource overlay it knows
   about, for one user, and then the idmap of each one. The question the dump
   gets opened with is nearly always the same — an overlay is installed and the
   target still looks the way it did — and the answer is one of four: it is
   disabled, its target is not on the device, the idmap never built, or
   something above it in the stack won. So the list is built the way that
   question is asked: a target package, and the overlays over it, the one that
   wins first.

   The block's head line is the one shape only this service prints —
   `<overlay>:<user> {` — and it is what the reader scopes itself by inside a
   bugreport. There is no heading above the blocks to scope by: the manager
   prints them straight out, one after another, at no indent. */
const OVERLAY_HEAD_RE = /^(\s*)(\S+):(-?\d+)\s*\{\s*$/;

/* Then, once per overlay, its idmap: the table the target's resource ids are
   mapped through, or a line saying there is none. `<missing idmap>` is the
   whole answer to a `STATE_NO_IDMAP`, so the two are brought together. */
const OVERLAY_IDMAP_HEAD_RE = /^\s*IDMAP OF (\S+)\s*$/;
/* What the manager prints after the last idmap, and therefore what ends one. */
const OVERLAY_TAIL_RE = /^\s*(?:Default overlays:|Overlay configurations:|AndroidPackage cache)/;

/* The states OverlayInfo prints that mean the overlay is not over anything and
   will not be until something outside this dump changes. `STATE_DISABLED` is
   not one of them: it is off because something turned it off. */
const OVERLAY_BROKEN = {
  STATE_MISSING_TARGET: 'no target',
  STATE_NO_IDMAP: 'no idmap',
  STATE_UNKNOWN: 'unknown state',
};

/* The fields of one block. The service pads its names out with dots so the
   values line up, and the dots are not part of the name. */
function overlayFields(body) {
  const out = new Map();
  for (const line of body) {
    const m = line.trim().match(PAIR_RE);
    if (!m) continue;
    const key = m[1].replace(/\.+$/, '').trim();
    if (!out.has(key)) out.set(key, m[2].trim());
  }
  return out;
}

/* What an overlay is held to, which is Android 16's addition to the block.
   `None` is the manager saying there are none, and a build before 16 prints
   the field at all. Each one reads `{type: DISPLAY_ID, value: 2}`. */
function overlayConstraints(value) {
  if (!value || value === 'None' || value === 'null') return [];
  const out = [];
  for (const m of value.matchAll(/\{\s*type:\s*([^,}]+),\s*value:\s*([^}]*)\}/g)) {
    out.push(`${m[1].trim().toLowerCase().replace(/_/g, ' ')} ${m[2].trim()}`);
  }
  return out.length ? out : [value];
}

/* A head line on its own is a shape another dump could print. What makes it
   this one's is what is directly under it: the manager prints its fields as
   `m<Name>` padded out with dots, and prints them first. */
function overlayHeadAt(lines, i) {
  if (!OVERLAY_HEAD_RE.test(lines[i])) return false;
  for (let k = i + 1; k < Math.min(i + 4, lines.length); k++) {
    if (/^\s*m[A-Z]\w*\.*\s*:/.test(lines[k])) return true;
  }
  return false;
}

/* The part of a bugreport this dump is in: from the first block's head — or a
   heading the blocks are printed under, where an older build printed one — to
   the next thing that is plainly another service. A text with no block in it
   at all is not this dump, and says so by having no span. */
function overlaySection(lines) {
  const at = lines.findIndex((l, i) => overlayHeadAt(lines, i));
  if (at < 0) return null;
  const above = at > 0 ? lines[at - 1] : null;
  const start = above && above.trim() && indentOf(above) === 0
             && !DUMP_BOUNDARY_RE.test(above) ? at - 1 : at;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (DUMP_BOUNDARY_RE.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

function parseOverlayDump(input) {
  const lines = dumpLines(input);
  const span = overlaySection(lines);
  if (!span) return finaliseScene('overlay', [], [], {});
  const { start: from, end: to } = span;
  const text = lines.slice(from, to).join('\n');
  /* Every line this reader accounted for. What is left over at the end is what
     a build started printing that this one has never seen. */
  const seen = new Set();
  const take = (a, b) => { for (let k = a; k < b; k++) seen.add(k); };

  /* Every block in the span: from its head to the `}` printed back at the
     head's own indent, or to wherever the dump stopped, because a truncated
     one never printed that brace. */
  const items = [];
  for (let i = from; i < to; i++) {
    if (!overlayHeadAt(lines, i)) continue;
    const m = lines[i].match(OVERLAY_HEAD_RE);
    const pad = m[1].length;
    let end = i + 1;
    while (end < to && !(lines[end].trim() && indentOf(lines[end]) <= pad)) end++;
    const closed = end < to && lines[end].trim() === '}';
    take(i, (closed ? end : end - 1) + 1);
    items.push({ at: i, id: m[2], userId: +m[3], head: lines[i],
                 body: lines.slice(i + 1, end) });
    i = closed ? end : end - 1;
  }
  if (!items.length) return finaliseScene('overlay', [], [], {});

  /* The idmaps, keyed by the overlay each belongs to. They are printed once
     per overlay rather than once per user, so one of these can belong to two
     rows in the list. */
  const idmaps = new Map();
  for (let i = from; i < to; i++) {
    const m = lines[i].match(OVERLAY_IDMAP_HEAD_RE);
    if (!m) continue;
    let end = i + 1;
    while (end < to && !OVERLAY_IDMAP_HEAD_RE.test(lines[end])
                    && !OVERLAY_TAIL_RE.test(lines[end])) end++;
    const body = lines.slice(i + 1, end);
    take(i, end);
    idmaps.set(m[1], {
      lines: body,
      missing: body.some((l) => /^\s*<(?:missing idmap|internal error)>\s*$/.test(l)),
      targetPath: (body.find((l) => /^\s*target path\s*:/.test(l)) || '').split(':').slice(1).join(':').trim() || null,
      overlayPath: (body.find((l) => /^\s*overlay path\s*:/.test(l)) || '').split(':').slice(1).join(':').trim() || null,
      mapped: body.filter((l) => /^\s*0x[0-9a-f]+\s*->/.test(l)).length,
    });
    i = end - 1;
  }

  /* What the build asked for, as against what the settings did with it: the
     configuration each overlay was shipped with. It is one line per overlay
     and says nothing a row does not, so it is counted rather than listed. */
  let configured = 0;
  for (let i = from; i < to; i++) {
    if (!/^\s*Overlay configurations:\s*$/.test(lines[i])) continue;
    let end = i + 1;
    while (end < to && (!lines[end].trim() || indentOf(lines[end]) > 0)) end++;
    configured = lines.slice(i + 1, end).filter((l) => /^\s*\d+,\s/.test(l)).length;
    take(i, end);
    break;
  }

  const overlays = items.map(overlayRead);
  for (const n of overlays) if (idmaps.has(n.identifier)) n.idmap = idmaps.get(n.identifier);

  const nodes = [];
  const displays = [];
  let z = 0;

  for (const uid of [...new Set(overlays.map((o) => o.userId))].sort((a, b) => a - b)) {
    const mine = overlays.filter((o) => o.userId === uid);
    let targets = 0;
    for (const target of [...new Set(mine.map((o) => o.target))].sort()) {
      /* Highest priority is applied last, so it is the one that wins a
         conflict, so it is the one that goes at the top of its stack. */
      const over = mine.filter((o) => o.target === target)
        .sort((a, b) => (b.priority === null ? -1 : b.priority) - (a.priority === null ? -1 : a.priority)
                     || a.title.localeCompare(b.title));
      const on = over.filter((o) => o.on);
      const broken = over.filter((o) => o.broken);
      targets++;

      const head = overlayNode({
        hash: `overlay:u${uid}:${target}`, title: target, head: null, body: [],
        userId: uid, z: -z++, at: over[0].at,
        family: 'overlay-target', typeLabel: 'target',
        visible: on.length > 0,
        subCount: over.length,
        searchExtra: over.map((o) => o.title).join(' '),
        badges: [
          ...(broken.length ? [[`${broken.length} broken`, 'badge-exit']] : []),
          ...(on.length ? [[`${on.length} on`, 'badge-focus']] : [['none enabled', 'badge-comp']]),
        ],
        meta: `${over.length} overlay${over.length === 1 ? '' : 's'} · ${on.length} enabled`,
      });
      Object.assign(head, {
        targetNode: true, userId: uid, target,
        overlays: over, enabled: on.length, brokenCount: broken.length,
      });
      nodes.push(head);
      const ancestors = [{ hash: head.hash, title: target }];

      over.forEach((n) => {
        /* Two enabled overlays over one target is the case the priority is
           there to settle, so the winner is marked rather than left to be read
           off the numbers. */
        n.z = -z++;
        n.parentHash = head.hash;
        n.ancestors = ancestors;
        if (on.length > 1 && n === on[0]) n.badges = [['wins', 'badge-focus'], ...n.badges];
        nodes.push(n);
      });
    }
    displays.push({
      id: uid, label: `user ${uid}`, name: null,
      size: { w: 0, h: 0 }, insets: [], raw: '',
      meta: `${mine.length} overlay${mine.length === 1 ? '' : 's'} · ${
        mine.filter((o) => o.on).length} enabled · ${targets} target${targets === 1 ? '' : 's'}`,
    });
  }

  /* `Default overlays` is the one line outside the blocks worth a name of its
     own. Whatever else is left is kept as printed and capped, so a build that
     starts printing something new shows up rather than being dropped — and a
     build that prints a great deal of it does not bury the pane. */
  const defaults = (text.match(/^\s*Default overlays:\s*(.*)$/m) || [])[1] || null;
  const tail = [];
  for (let i = from; i < to && tail.length < 8; i++) {
    const line = lines[i];
    if (seen.has(i) || !line.trim() || indentOf(line) !== 0) continue;
    if (/^Default overlays:/.test(line.trim())) continue;
    tail.push(line.trim());
  }

  const globals = {
    users: displays.length,
    overlays: overlays.length,
    targets: nodes.filter((n) => n.targetNode).length,
    enabled: overlays.filter((o) => o.on).length,
    broken: overlays.filter((o) => o.broken).length,
    fabricated: overlays.filter((o) => o.fabricated).length,
    constrained: overlays.filter((o) => o.constraints.length).length,
    idmaps: idmaps.size,
    missingIdmaps: [...idmaps.values()].filter((i) => i.missing).length,
    configured,
    defaults: defaults ? defaults.replace(/;/g, ' · ') : null,
    tail: tail.join(' · ') || null,
    lines: to - from,
  };

  return finaliseScene('overlay', displays, nodes, globals);
}

/* One block, read. What comes back is the node, with the few facts the
   grouping above needs hung off it: an overlay's place in the list depends on
   its siblings, which are not known until every block has been read. */
function overlayRead(it) {
  const f = overlayFields(it.body);
  const get = (k) => (f.has(k) && f.get(k) !== 'null' ? f.get(k) : null) || null;
  const sep = it.id.indexOf(':');
  const pkg = get('mPackageName') || (sep < 0 ? it.id : it.id.slice(0, sep));
  /* A fabricated overlay is not a package of its own, so the manager names it
     `<owner>:<name>` and prints the name again in the block. The block is the
     better of the two, because a build that stops printing one of them still
     prints the other. */
  const name = get('mOverlayName') || (sep < 0 ? null : it.id.slice(sep + 1));
  const target = get('mTargetPackageName') || pkg;
  const state = get('mState') || '';
  const priority = /^-?\d+$/.test(get('mPriority') || '') ? +get('mPriority') : null;
  const mutable = f.get('mIsMutable') !== 'false';
  const fabricated = f.get('mIsFabricated') === 'true';
  const constraints = overlayConstraints(f.get('mConstraints'));
  const broken = OVERLAY_BROKEN[state] || null;
  /* `mIsEnabled` is what was asked for and the state is what came of it, so
     the state wins wherever the dump printed one — including a state this
     build of the manager had no name for, which it prints as
     `<unknown state>` and which is not an overlay that is over anything. */
  const on = state ? /^STATE_ENABLED/.test(state) : f.get('mIsEnabled') === 'true';
  const title = name ? `${pkg} · ${name}` : pkg;

  const node = overlayNode({
    hash: `overlay:${it.at}`, title, head: it.head, body: it.body,
    userId: it.userId, z: 0, at: it.at + 1, bodyAt: it.at + 2,
    family: broken ? 'overlay-broken' : !on ? 'overlay-off'
          : !mutable ? 'overlay-fixed' : 'overlay-on',
    typeLabel: fabricated ? 'fabricated overlay' : 'overlay',
    visible: on,
    searchExtra: `${target} ${state} ${get('mCategory') || ''} ${get('mBaseCodePath') || ''}`,
    badges: [
      ...(broken ? [[broken, 'badge-exit']] : []),
      ...(!broken && !on ? [[overlayStateLabel(state) || 'off', 'badge-exit']] : []),
      ...(fabricated ? [['fabricated', 'badge-comp']] : []),
      ...(!mutable ? [['immutable', 'badge-comp']] : []),
      ...(constraints.length ? [[constraints.join(', '), 'badge-comp']] : []),
    ],
    meta: [overlayStateLabel(state), priority === null ? null : `priority ${priority}`,
           get('mCategory')].filter(Boolean).join(' · '),
  });
  Object.assign(node, {
    overlay: true, userId: it.userId, identifier: it.id,
    overlayPkg: pkg, overlayName: name,
    target, state, priority, on, broken, fabricated, mutable, constraints,
    category: get('mCategory'), overlayable: get('mTargetOverlayableName'),
    path: get('mBaseCodePath'), idmap: null,
  });
  return node;
}

/* `STATE_MISSING_TARGET` is how the constant is spelled and not how anyone
   says it. */
const overlayStateLabel = (state) => state
  ? state.replace(/^STATE_/, '').toLowerCase().replace(/_/g, ' ') : null;

function overlayNode(opts) {
  const { hash, title, head, body } = opts;
  return {
    hash, title, displayId: opts.userId,
    frame: null, frameSource: null, z: opts.z,
    family: opts.family, typeLabel: opts.typeLabel, badges: opts.badges,
    search: `${title} ${opts.searchExtra || ''} ${head || ''}\n${body.join('\n')}`.toLowerCase(),
    raw: [head, ...body].filter((l) => l !== null).join('\n').replace(/\n+$/, ''),
    visible: opts.visible !== false, focused: false,
    parentHash: opts.parentHash || null, ancestors: opts.ancestors || [],
    body, bodyAt: opts.bodyAt, subCount: opts.subCount || 0,
    own: body.length, lines: body.length + (head ? 1 : 0),
    at: opts.at, meta: opts.meta,
  };
}
