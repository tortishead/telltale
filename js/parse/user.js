/* ================ parse: dumpsys user ================ */

/* A user dump is a document too, but one that marks nothing: its sections are
   simply the lines at no indent at all, and what belongs to a section is what
   is indented under it. Inside two of them the dump lists things rather than
   settings — the users, and the types a user can be — and those are printed in
   shapes worth recognising, so they become sections of their own and can be
   picked, badged and counted. Everything else stays what it is: attributes,
   which the reading pane lays out. */
const USER_HEAD_RE = /^\s*UserInfo\{(-?\d+):([^:}]*):([0-9a-f]+)\}(.*)$/;
const USER_TYPE_HEAD_RE = /^\s*(android\.os\.usertype\.[\w.]+):\s*$/;

/* The flags a user carries are printed as an int and then spelled out; the
   spelling is what anyone reads, and it is what the badges come from. */
function userFlagNames(line) {
  const m = String(line).match(/^\s*Flags:\s*\d+\s*\(([^)]*)\)/);
  return m ? m[1].split('|').map((f) => f.trim()).filter(Boolean) : [];
}

/* The value printed after a name somewhere in a block, at any depth. It reads
   a line the same way the reading pane does, so what a dump calls a name is
   one thing across the whole page. */
function userField(body, name) {
  for (const line of body) {
    const m = line.trim().match(PAIR_RE);
    if (m && m[1].trim() === name) return m[2].trim();
  }
  return null;
}

/* A list printed under a label — the restrictions a user has, mostly. `none`
   and `null` are the dump saying there are none, not the name of one. */
function userListUnder(body, label) {
  const at = body.findIndex((l) => l.trim().replace(/:$/, '') === label);
  if (at < 0) return [];
  const pad = indentOf(body[at]);
  const out = [];
  for (let i = at + 1; i < body.length; i++) {
    const line = body[i];
    if (!line.trim()) continue;
    if (indentOf(line) <= pad) break;
    const item = line.trim();
    if (item !== 'none' && item !== 'null') out.push(item);
  }
  return out;
}

function userNode(head, body, opts) {
  const { hash, title, family, typeLabel, badges, meta } = opts;
  return {
    hash, title, displayId: 0,
    frame: null, frameSource: null, z: opts.z,
    family, typeLabel, badges,
    search: `${title} ${typeLabel} ${head}\n${body.join('\n')}`.toLowerCase(),
    raw: [head, ...body].join('\n').replace(/\n+$/, ''),
    visible: opts.visible !== false, focused: !!opts.focused,
    parentHash: opts.parentHash || null,
    ancestors: opts.ancestors || [],
    body, bodyAt: opts.bodyAt, subCount: 0,
    own: body.length + 1, lines: body.length + 1,
    at: opts.at, meta,
  };
}

/* A bugreport is every dumpsys one after another in one file, and this parser
   is handed all of it. This dump marks its sections with nothing but a line at
   no indent, which every other dump in the file has too — so unscoped, a
   SurfaceFlinger layer and a package become sections of `dumpsys user`. The
   dump is therefore read inside its own part of the file, the way the input
   reader reads its two halves: from the first line this dump prints to the
   next thing that is plainly a heading — a bugreport rule, or the line naming
   the next service.

   The two openers are matched at no indent only. `Current user:` is printed
   indented by other services, and `Users:` by the package dump; neither of
   those is this dump starting. */
const USER_SECTION_START = /^(?:Current user:\s*-?\d+\s*|Users:\s*)$/;

/* A dump that opens with neither is not a bugreport's; read all of it, which
   is what a pasted `dumpsys user` wants. */
const userSection = (lines) => sectionSpan(lines, USER_SECTION_START, null, 'all');

function parseUserDump(input) {
  const lines = dumpLines(input);
  /* Indices stay the file's own throughout, so a row still says which line of
     the bugreport it came off; only the span being read is narrowed. */
  const { start: from, end: to } = userSection(lines);
  const text = lines.slice(from, to).join('\n');
  const current = (() => {
    const m = text.match(/^\s*Current user:\s*(-?\d+)/m);
    return m ? +m[1] : null;
  })();

  /* The sections are the lines at no indent. Each one holds what is indented
     under it, up to the next. */
  const heads = [];
  for (let i = from; i < to; i++) {
    const line = lines[i];
    if (line.trim() && indentOf(line) === 0) heads.push({ at: i, title: line.trim() });
  }
  if (!heads.length) return finaliseScene('user', [], [], {});
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].at : to;
    h.body = lines.slice(h.at + 1, end);
  });

  const nodes = [];
  let z = 0;
  const push = (n) => { nodes.push(n); return n; };

  for (const h of heads) {
    /* `Current user: 10` and the like are one line and no block; they are what
       the dump says about itself, not a part of it. */
    if (!h.body.some((l) => l.trim())) continue;

    const title = h.title.replace(/:$/, '');
    const kids = [];
    const section = push(userNode(h.title, h.body, {
      hash: `user:${h.at}`, title,
      family: 'user-section', typeLabel: 'section', badges: [],
      z: -z++, at: h.at + 1, bodyAt: h.at + 2,
    }));
    const ancestors = [{ hash: section.hash, title }];

    /* Inside a section, a line in one of the two shapes the dump lists things
       in opens a thing of its own; what follows it, indented deeper, is what
       it printed. */
    const opens = [];
    h.body.forEach((line, i) => {
      const m = line.match(USER_HEAD_RE) || line.match(USER_TYPE_HEAD_RE);
      if (m) opens.push({ i, line, indent: indentOf(line), user: !!line.match(USER_HEAD_RE) });
    });

    opens.forEach((open, k) => {
      const end = k + 1 < opens.length ? opens[k + 1].i : h.body.length;
      const body = h.body.slice(open.i + 1, end);
      const at = h.at + 1 + open.i;
      /* The line it starts on is what makes a node's hash: a dump that printed
         the same name twice must still be two things that can be picked
         apart. */
      const shared = {
        z: -z++, at: at + 1, bodyAt: at + 2,
        parentHash: section.hash, ancestors,
      };
      kids.push(open.user
        ? push(userAccountNode(open.line, body, shared, current))
        : push(userTypeNode(open.line, body, shared)));
    });

    section.subCount = kids.length;
    if (kids.length) section.meta = `${kids.length} ${kids[0].typeLabel}${kids.length === 1 ? '' : 's'}`;
  }

  const users = nodes.filter((n) => n.user);
  const types = nodes.filter((n) => n.userType);
  const one = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const globals = {
    current,
    users: users.length,
    types: types.length,
    maxUsers: one(/^\s*Max users:\s*(.+)$/m),
    switchable: one(/^\s*Supports switchable users:\s*(\S+)/m),
    headless: one(/^\s*Is headless-system mode:\s*(\S+)/m),
    userVersion: one(/^\s*User version:\s*(\S+)/m),
    bootUser: one(/^\s*Boot user:\s*(\S+)/m),
    deviceManaged: one(/^\s*Device managed:\s*(\S+)/m),
    visible: one(/^\s*Visible users:\s*(.+)$/m),
    warnings: one(/^\s*(\d+) warnings\s*$/m),
    lines: to - from,
  };

  const display = {
    id: 0, label: 'users', name: null,
    size: { w: 0, h: 0 }, insets: [], raw: '',
    meta: `${users.length} user${users.length === 1 ? '' : 's'} · ${types.length} types`,
  };

  return finaliseScene('user', [display], nodes, globals);
}

/* One user. The id, the name and the flags are on the head line; the type, the
   state and what it is barred from are in the block under it. */
function userAccountNode(head, body, shared, current) {
  const m = head.match(USER_HEAD_RE);
  const id = +m[1];
  const name = m[2] === 'null' ? null : m[2];
  const flags = userFlagNames(body.find((l) => /^\s*Flags:/.test(l)) || '');
  const type = userField(body, 'Type') || '';
  const base = (type.match(/usertype\.(\w+)\./) || [])[1] || null;
  const state = userField(body, 'State');
  const restrictions = userListUnder(body, 'Effective restrictions');
  const isCurrent = current !== null && id === current;
  const running = /^RUNNING/.test(state || '');

  const family = base === 'system' ? 'user-system' : base === 'profile' ? 'user-profile'
               : flags.includes('GUEST') ? 'user-guest' : 'user-full';

  return {
    ...userNode(head, body, {
      ...shared,
      hash: `user:${shared.at}`,
      title: name ? `user ${id} · ${name}` : `user ${id}`,
      family,
      typeLabel: 'user',
      badges: [
        ...(isCurrent ? [['current', 'badge-focus']] : []),
        ...(running ? [] : [[String(state || 'not running').toLowerCase(), 'badge-exit']]),
        ...(flags.includes('EPHEMERAL') ? [['ephemeral', 'badge-comp']] : []),
        ...(flags.includes('DISABLED') ? [['disabled', 'badge-exit']] : []),
        ...(flags.includes('PARTIAL') ? [['partial', 'badge-exit']] : []),
        ...(restrictions.length ? [[`${restrictions.length} restricted`, 'badge-comp']] : []),
      ],
      meta: [type.replace(/^android\.os\.usertype\./, ''), state].filter(Boolean).join(' · '),
    }),
    current: isCurrent,
    user: true, userId: id, userName: name,
    type, base, state, flags, restrictions,
    serial: (head.match(/serialNo=(-?\d+)/) || [])[1] || null,
  };
}

/* One type a user can be. */
function userTypeNode(head, body, shared) {
  const full = head.match(USER_TYPE_HEAD_RE)[1];
  const base = userField(body, 'mBaseType');
  const enabled = userField(body, 'mEnabled') === 'true';
  const maxAllowed = userField(body, 'mMaxAllowed');
  const perParent = userField(body, 'mMaxAllowedPerParent');

  return {
    ...userNode(head, body, {
      ...shared,
      hash: `user:${shared.at}`,
      title: full.replace(/^android\.os\.usertype\./, ''),
      family: base === 'PROFILE' ? 'user-profile' : base === 'SYSTEM' ? 'user-system' : 'user-full',
      typeLabel: 'type',
      badges: enabled ? [] : [['disabled', 'badge-exit']],
      meta: [base, maxAllowed && maxAllowed !== '-1' && `max ${maxAllowed}`,
             perParent && perParent !== '-1' && `${perParent} per parent`]
        .filter(Boolean).join(' · '),
    }),
    userType: true, typeName: full, base, enabled,
  };
}
