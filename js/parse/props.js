/* ================ parse: system properties ================ */

/* `getprop` prints the whole property store — two and a half thousand lines of
   it — one property to a line, name and value each in its own brackets, sorted
   by name; dumpstate prints the same thing into a bugreport under a rule of
   its own. There is nothing to draw and nothing the dump itself nests, so the
   shape the reader gives it is the one the names already carry. A property is
   a path: `ro.build.version.sdk` is the build's, `init.svc.adbd` is that
   service's. The first segment is the namespace and becomes the group; the
   two segments after it are the thing inside it and become a section; the
   properties are what a section holds.

   Which is also why this is worth a reader at all. Every other dump in a
   bugreport says what the device was doing; this one says what the device is
   — the fingerprint, the SDK, the patch level, whether it is debuggable and
   whether its bootloader is open — and those answers sit in the reading pane
   of whichever namespace is open rather than having to be found in the list.
   Until this reader, Telltale only learned a fingerprint from an ANR trace. */

/* One property as `getprop` prints it. The value is whatever was between the
   last pair of brackets on the line, because a value may hold brackets of its
   own and nothing escapes them. A value holding a newline — rare, and always
   somebody's mistake — spills onto lines that are not properties, and those
   are left where they are rather than guessed at. */
const PROP_LINE_RE = /^\[([A-Za-z_][A-Za-z0-9_.@\-]*)\]:\s*\[(.*)\]$/;

/* The rule dumpstate prints above them. Some builds name the command in the
   rule and some do not, so only the words are matched. */
const PROP_SECTION_START = /^-{4,}\s*SYSTEM PROPERTIES\b/;

/* A text that opens with no such rule is a pasted `getprop`; read all of it,
   and let the line shape decide what is a property. */
const propsSection = (lines) => sectionSpan(lines, PROP_SECTION_START, null, 'all');

const propNamespace = (name) => {
  const i = name.indexOf('.');
  return i < 0 ? '' : name.slice(0, i);
};

/* The thing inside a namespace a property belongs to. A name of one segment
   belongs to nothing and a name of two is already its own thing, so neither
   gets a section and both sit straight in the group. */
const propSectionOf = (name) => {
  const p = name.split('.');
  return p.length >= 3 ? `${p[0]}.${p[1]}` : null;
};

/* `ro.` is not a naming convention: init refuses to set a property twice if it
   starts with one, so the prefix is the whole difference between a fact about
   the build and something the running system put there. */
const propReadOnly = (name) => /^ro\./.test(name);

/* The properties whose value is the answer to a question a bugreport gets
   opened with, and the word for the value that answers it. Everything else in
   here is a fact; one of these, at one of these values, is a finding — so it
   is badged on the row rather than left to be found by reading two thousand
   lines. `init.svc.*` is the one rule rather than a name: init prints what it
   thinks of every service it started, and anything but `running` is worth
   seeing. */
/* init prints what it thinks of every service it started, under a name of
   this shape and nowhere else. */
const INIT_SVC_RE = /^init\.svc\./;

function propFlag(name, value) {
  if (INIT_SVC_RE.test(name)) return value && value !== 'running' ? value : null;
  switch (name) {
    case 'ro.debuggable':             return value === '1' ? 'debuggable' : null;
    case 'ro.secure':                 return value === '0' ? 'insecure' : null;
    case 'ro.adb.secure':             return value === '0' ? 'adb unsecured' : null;
    case 'ro.boot.flash.locked':      return value === '0' ? 'bootloader unlocked' : null;
    case 'ro.boot.verifiedbootstate': return value && value !== 'green' ? `verified boot ${value}` : null;
    case 'ro.boot.veritymode':        return value && value !== 'enforcing' ? `verity ${value}` : null;
    case 'ro.build.type':             return value && value !== 'user' ? value : null;
    case 'ro.build.tags':             return /\btest-keys\b/.test(value || '') ? 'test-keys' : null;
    case 'sys.boot_completed':        return value === '1' ? null : 'boot not completed';
    default:                          return null;
  }
}

/* A value goes on a row as well as into the pane, and a row is one line. The
   few properties that print a kilobyte of it — a package list, a whole
   allowlist — would push everything else off the row otherwise. */
const propShort = (v) => v.length > 96 ? v.slice(0, 95) + '…' : v;

const propCount = (n) => `${n} propert${n === 1 ? 'y' : 'ies'}`;

function propNode(opts) {
  return {
    hash: opts.hash, title: opts.title, displayId: opts.displayId,
    frame: null, frameSource: null, z: opts.z,
    family: opts.family, typeLabel: opts.typeLabel, badges: opts.badges || [],
    search: opts.search,
    raw: opts.raw,
    visible: true, focused: false,
    parentHash: opts.parentHash || null, ancestors: opts.ancestors || [],
    body: opts.body, bodyAt: opts.bodyAt, subCount: opts.subCount || 0,
    own: opts.body.length, lines: opts.body.length,
    at: opts.at, meta: opts.meta,
  };
}

function parseSystemPropertiesDump(input) {
  const lines = dumpLines(input);
  const { start: from, end: to } = propsSection(lines);

  const props = [];
  for (let i = from; i < to; i++) {
    const m = lines[i].match(PROP_LINE_RE);
    if (m) props.push({ at: i, name: m[1], value: m[2] });
  }
  if (!props.length) return finaliseScene('props', [], [], {});

  /* The store answers a name once. A dump that printed one twice — a vendor
     script appending its own getprop to the end of the section — is read as
     the first answer, which is the one the section was taken at. */
  const byName = new Map();
  for (const p of props) if (!byName.has(p.name)) byName.set(p.name, p.value);

  const groups = new Map();
  for (const p of props) {
    p.flag = propFlag(p.name, p.value);
    p.section = propSectionOf(p.name);
    const ns = propNamespace(p.name) || 'no namespace';
    if (!groups.has(ns)) groups.set(ns, { ns, props: [], sections: new Map() });
    const g = groups.get(ns);
    g.props.push(p);
    if (p.section) {
      if (!g.sections.has(p.section)) g.sections.set(p.section, []);
      g.sections.get(p.section).push(p);
    }
  }

  /* The biggest namespace first, which on every device is `ro` and therefore
     the one holding what the device is. The order is the counts the strip
     already prints, so the list says why it is in the order it is in. */
  const ordered = [...groups.values()].sort((a, b) =>
    b.props.length - a.props.length || (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0));

  const displays = [];
  const nodes = [];
  let z = 0;

  ordered.forEach((g, id) => {
    /* The section a property hangs under, once it has one. A section is
       opened by the first property that belongs to it, which is also where
       its line number comes from. */
    const heads = new Map();

    for (const p of g.props) {
      let head = null;
      if (p.section) {
        head = heads.get(p.section) || null;
        if (!head) {
          const own = g.sections.get(p.section);
          const flagged = own.filter((x) => x.flag).length;
          /* `getprop` prints its properties sorted, so a section is a run of
             lines and the reading pane can count a row's line number off the
             first of them. A dump that printed them in some other order still
             reads, with the line numbers inside a section no better than the
             line it starts on. */
          head = propNode({
            hash: `props:${own[0].at}:${p.section}`,
            title: p.section, displayId: id, z: -z++,
            family: 'prop-section', typeLabel: 'section',
            badges: flagged ? [[`${flagged} flagged`, 'badge-exit']] : [],
            search: `${p.section} ${own.map((x) => `${x.name} ${x.value}`).join(' ')}`.toLowerCase(),
            raw: own.map((x) => lines[x.at]).join('\n'),
            body: own.map((x) => `${x.name}: ${x.value}`),
            bodyAt: own[0].at + 1, at: own[0].at + 1,
            subCount: own.length,
            meta: propCount(own.length),
          });
          Object.assign(head, {
            propSection: true, namespace: g.ns, section: p.section,
            readOnly: propReadOnly(p.section), flagged: flagged > 0,
          });
          heads.set(p.section, head);
          nodes.push(head);
        }
      }

      const ro = propReadOnly(p.name);
      const node = propNode({
        hash: `props:${p.at}`,
        title: p.name, displayId: id, z: -z++,
        family: p.flag ? 'prop-flagged'
              : INIT_SVC_RE.test(p.name) ? 'prop-service'
              : /^persist\./.test(p.name) ? 'prop-persist'
              : ro ? 'prop-ro' : 'prop-runtime',
        typeLabel: 'property',
        badges: p.flag ? [[p.flag, 'badge-exit']] : [],
        search: `${p.name} ${p.value}`.toLowerCase(),
        raw: lines[p.at],
        body: [`${p.name}: ${p.value}`],
        bodyAt: p.at + 1, at: p.at + 1,
        parentHash: head ? head.hash : null,
        ancestors: head ? [{ hash: head.hash, title: p.section }] : [],
        meta: p.value === '' ? '\u2014' : propShort(p.value),
      });
      Object.assign(node, {
        prop: true, name: p.name, value: p.value,
        namespace: g.ns, section: p.section,
        readOnly: ro, flagged: !!p.flag, flag: p.flag,
      });
      nodes.push(node);
    }

    const secs = g.sections.size;
    displays.push({
      id, label: g.ns, name: null,
      size: { w: 0, h: 0 }, insets: [], raw: '',
      meta: `${propCount(g.props.length)}${
        secs ? ` · ${secs} section${secs === 1 ? '' : 's'}` : ''}`,
    });
  });

  const one = (...names) => {
    for (const n of names) {
      const v = byName.get(n);
      if (v !== undefined && v !== '') return v;
    }
    return null;
  };
  const services = props.filter((p) => INIT_SVC_RE.test(p.name));

  const globals = {
    count: props.length,
    namespaces: displays.length,
    sections: ordered.reduce((n, g) => n + g.sections.size, 0),
    lines: to - from,

    fingerprint: one('ro.build.fingerprint', 'ro.system.build.fingerprint',
                     'ro.vendor.build.fingerprint', 'ro.bootimage.build.fingerprint'),
    brand: one('ro.product.brand', 'ro.product.vendor.brand'),
    model: one('ro.product.model', 'ro.product.vendor.model'),
    device: one('ro.product.device', 'ro.product.vendor.device'),
    product: one('ro.product.name', 'ro.build.product'),
    manufacturer: one('ro.product.manufacturer'),
    hardware: one('ro.hardware', 'ro.boot.hardware'),
    board: one('ro.product.board', 'ro.board.platform'),
    abi: one('ro.product.cpu.abi'),
    characteristics: one('ro.build.characteristics'),

    sdk: one('ro.build.version.sdk'),
    release: one('ro.build.version.release'),
    patch: one('ro.build.version.security_patch'),
    buildId: one('ro.build.id'),
    incremental: one('ro.build.version.incremental'),
    buildType: one('ro.build.type'),
    tags: one('ro.build.tags'),
    buildDate: one('ro.build.date'),
    firstApi: one('ro.product.first_api_level', 'ro.board.first_api_level'),
    treble: one('ro.treble.enabled'),

    locale: one('persist.sys.locale', 'ro.product.locale'),
    timezone: one('persist.sys.timezone'),
    density: one('ro.sf.lcd_density', 'ro.boot.lcd_density'),

    bootState: one('ro.boot.verifiedbootstate'),
    locked: one('ro.boot.flash.locked'),
    bootReason: one('sys.boot.reason', 'ro.boot.bootreason'),
    bootCompleted: one('sys.boot_completed'),

    services: services.length,
    servicesRunning: services.filter((p) => p.value === 'running').length,
    /* Everything the rows are badged with, gathered once so the pane can say
       it without the list having to be walked for it. */
    flagged: props.filter((p) => p.flag)
      .map((p) => ({ name: p.name, value: p.value, label: p.flag })),
  };

  return finaliseScene('props', displays, nodes, globals);
}
