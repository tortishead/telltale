/* ================ parse: dumpsys package ================ */

/* The first dump Telltale reads with no geometry in it at all: a package does not
   sit anywhere, so there is nothing honest to put on the sheet and the tool is
   registered with `layout:'list'`, which takes the sheet out of the grid and
   gives the stack its room. What a package dump does have is the same shape
   underneath — named things, grouped, each read out of a block of text — so it
   hands back the same scene as the others with `frame` left null.

   The group is the Android user, which is the axis a package dump really
   splits on: a work profile has its own set installed, its own grants and its
   own enabled state, and the same package is a different row under each.

   `sharedUser` becomes the parent, so the stack pane draws the one piece of
   structure a package dump has — which apps run as `android.uid.system` and
   which share a uid with each other — using the tree it already had for
   SurfaceFlinger. */

const PKG_HEAD_RE = /^(\s*)Package \[([^\]\s]+)\](?:\s*\((\w+)\))?:\s*$/;
const PKG_LIST_RE = /^(\s*)(?:(declared|requested|install|runtime) permissions|grantedPermissions):\s*$/;
const PKG_USER_RE = /^(\s*)User (\d+):\s*(.*)$/;
const PKG_COMP_RE = /^(\s*)(disabled|enabled)Components:\s*$/;
/* Only these top-level headings hold `Package [x] (hash):` blocks. */
const PKG_SECTIONS = /^(Packages|Hidden system packages|Renamed packages)$/;
/* Column zero does not reliably mean a new section. `dumpsys package` prints a
   package's overlay paths through a printer that has lost its indent, so two
   lines like

       com.android.oem.tokens overlay paths:

   land at column zero in the middle of `Packages:`, hundreds of blocks before
   the end of it. Reading those as the end of the section costs every package
   after them — 253 of 264 on an emulator — and reading one as the end of the
   block it interrupts costs that package its permissions.

   What tells them apart is capitalisation: every heading dumpsys prints is
   capitalised and a Java package name is not. A stray line also has its own
   deeper-indented lines under it, which is checked as well, so a heading has
   to fail both tests before it is taken for a package name. */
const PKG_STRAY_RE = /^[a-z]/;
function pkgStray(lines, i, headIndent){
  if (!PKG_STRAY_RE.test(lines[i])) return false;
  for (let j = i + 1; j < lines.length; j++) {
    if (!lines[j].trim()) continue;
    return indentOf(lines[j]) > headIndent;
  }
  return false;
}

/* takeBlock stops at the first line indented no deeper than the head, which is
   right everywhere else and wrong here for the reason above. */
function takePackageBlock(lines, start, headIndent) {
  const out = [lines[start]];
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { out.push(line); continue; }
    if (indentOf(line) <= headIndent && !pkgStray(lines, i, headIndent)) break;
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { text: out.join('\n'), next: i };
}
/* enabled= is COMPONENT_ENABLED_STATE_*, printed as the int on every build
   that matters and as the name on a few, so both are read. */
const PKG_ENABLED = ['default', 'enabled', 'disabled', 'disabled by user', 'disabled until used'];

/* KV_RE is shared and carries a lastIndex, so each pass gets its own. */
function kvOf(line) {
  const out = {};
  const re = new RegExp(KV_RE.source, 'g');
  let m;
  while ((m = re.exec(line))) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

/* One line of a permission list. The three lists print different things after
   the name — a protection level, a grant, a set of grant flags — and a build
   that prints something else again keeps it as a note rather than losing it. */
function permOf(line) {
  const s = line.trim();
  const m = s.match(/^([\w.$/-]+):?\s*(.*)$/);
  if (!m) return { name: s, granted: null, flags: [], prot: null, note: null };
  const rest = (m[2] || '').trim();
  const g = rest.match(/granted=(true|false)/);
  const fl = rest.match(/flags=\[([^\]]*)\]/);
  const pr = rest.match(/prot=([^,]+)/);
  return {
    name: m[1],
    granted: g ? g[1] === 'true' : null,
    flags: fl ? fl[1].trim().split(/[|,\s]+/).filter(Boolean) : [],
    prot: pr ? pr[1].trim() : null,
    note: !g && !fl && !pr && rest ? rest : null,
  };
}

/* A package's block: scalars at the top, then lists that are headed by a line
   of their own and bounded by indentation, then a `User N:` block per user the
   package is known to, each with its own runtime grants. */
function parsePackageBlock(name, settingsHash, block, section) {
  const raw = block.join('\n').replace(/\s+$/, '');
  const p = { name, settingsHash, section, raw, props: {}, users: new Map(),
              declared: [], requested: [], install: [] };

  const LISTS = { declared: p.declared, requested: p.requested, install: p.install };
  let mode = null, modeIndent = 0, user = null;

  for (let i = 1; i < block.length; i++) {
    const line = block[i];
    if (!line.trim()) continue;
    const ind = indentOf(line);
    if (mode && ind <= modeIndent) mode = null;
    if (user && ind <= user.indent) user = null;

    const um = !mode && line.match(PKG_USER_RE);
    if (um) {
      user = { id: +um[2], indent: ind, props: kvOf(um[3]), gids: null,
               runtime: [], disabled: [], enabled: [] };
      if (!p.users.has(user.id)) p.users.set(user.id, user);
      continue;
    }
    const lm = line.match(PKG_LIST_RE);
    /* Pre-M builds head the install-time grants `grantedPermissions:` — the
       same list under another name, and one where being listed is the grant. */
    if (lm) { mode = lm[2] || 'granted'; modeIndent = ind; continue; }
    const cm = line.match(PKG_COMP_RE);
    if (cm) { mode = cm[2] + 'Components'; modeIndent = ind; continue; }

    if (mode === 'runtime') { (user ? user.runtime : p.install).push(permOf(line)); continue; }
    if (mode === 'granted') { p.install.push({ ...permOf(line), granted: true }); continue; }
    if (LISTS[mode]) { LISTS[mode].push(permOf(line)); continue; }
    if (mode === 'disabledComponents') { if (user) user.disabled.push(line.trim()); continue; }
    if (mode === 'enabledComponents') { if (user) user.enabled.push(line.trim()); continue; }

    const g = line.match(/^\s*gids=\[([^\]]*)\]/);
    if (g) { if (user) user.gids = g[1].trim(); continue; }
    Object.assign(user ? user.props : p.props, kvOf(line));
  }

  /* The fields KV harvesting cannot take whole: a timestamp has a space in it
     and a flag list has brackets round it. Read off the block, not the line,
     because which of the two names a build prints has changed. */
  const one = (re) => { const m = raw.match(re); return m ? m[1].trim() : null; };
  const list = (re) => { const v = one(re); return v ? v.split(/[\s|,]+/).filter(Boolean) : []; };
  p.firstInstall = one(/^\s*firstInstallTime=(.+)$/m);
  p.lastUpdate = one(/^\s*lastUpdateTime=(.+)$/m);
  p.timeStamp = one(/^\s*timeStamp=(.+)$/m);
  p.flags = list(/^\s*(?:pkgFlags|flags)=\[([^\]]*)\]/m);
  p.privateFlags = list(/^\s*(?:privatePkgFlags|privateFlags)=\[([^\]]*)\]/m);
  p.sharedUser = one(/sharedUser=SharedUserSetting\{\w+\s+(\S+?)\/\d+\}/)
              || one(/^\s*sharedUser=\[?([\w.]+)\]?\s*$/m)
              || one(/^\s*sharedUserId=(\S+)\s*$/m);
  return p;
}

/* One package as one user sees it. Everything the row and the badges read is
   worked out here; the details pane goes back to the parsed block for the
   rest. */
function packageNode(p, uid, u) {
  const props = p.props;
  const has = (f) => p.flags.includes(f) || p.privateFlags.includes(f);
  const code = props.codePath || props.path || '';
  const apex = /^\/apex\//.test(code);
  const privileged = p.privateFlags.includes('PRIVILEGED') || /\/priv-app\//.test(code);
  const updated = has('UPDATED_SYSTEM_APP');
  const system = has('SYSTEM') || /^\/(system|system_ext|product|vendor|odm)\b/.test(code);

  const family = apex ? 'pkg-apex' : privileged ? 'pkg-priv'
               : updated ? 'pkg-updated' : system ? 'pkg-system' : 'pkg-app';
  const typeLabel = apex ? 'apex' : privileged ? 'privileged'
                  : updated ? 'updated system' : system ? 'system' : 'third-party';

  /* A dump off a single-user device prints no `User N:` line at all, and then
     everything the block says is simply true. */
  const up = u ? u.props : {};
  const bool = (k, dflt) => (up[k] === undefined ? dflt : up[k] === 'true');
  const installed = bool('installed', true);
  const enabledRaw = up.enabled;
  const enabled = enabledRaw === undefined ? null
    : /^-?\d+$/.test(enabledRaw) ? (PKG_ENABLED[+enabledRaw] || `state ${enabledRaw}`)
    : String(enabledRaw).toLowerCase().replace(/^component_enabled_state_/, '').replace(/_/g, ' ');
  const off = enabled !== null && /^disabled/.test(enabled);
  const hidden = bool('hidden', false);
  const suspended = bool('suspended', false);
  const stopped = bool('stopped', false);

  const versionCode = props.versionCode || props.versionCodeMajor || null;
  const version = props.versionName
    ? `${props.versionName}${versionCode ? ` (${versionCode})` : ''}`
    : versionCode ? `code ${versionCode}` : null;

  /* A package an update has replaced is printed twice — once under
     `Packages:` and once under `Hidden system packages:`. */
  const shadowed = p.section === 'Hidden system packages';
  const badges = [
    ...(installed ? [] : [['not installed', 'badge-exit']]),
    ...(off ? [[enabled, 'badge-exit']] : []),
    ...(suspended ? [['suspended', 'badge-exit']] : []),
    ...(hidden ? [['hidden', 'badge-exit']] : []),
    ...(stopped ? [['stopped', 'badge-comp']] : []),
    ...(shadowed ? [['shadowed', 'badge-comp']] : []),
    ...(has('DEBUGGABLE') ? [['debuggable', 'badge-focus']] : []),
    ...(has('TEST_ONLY') ? [['test-only', 'badge-focus']] : []),
    ...(bool('instant', false) ? [['instant', 'badge-comp']] : []),
  ];

  /* The filter matches the permissions too: "who asked for CAMERA" is the
     question a package dump gets opened for more than any other. */
  const search = [p.name, typeLabel, version, code, p.sharedUser,
                  props.installerPackageName, props.installInitiator,
                  ...p.requested.map((x) => x.name),
                  ...(u ? u.runtime.filter((x) => x.granted).map((x) => x.name) : []),
                 ].filter(Boolean).join(' ').toLowerCase();

  return {
    hash: `${uid}:${shadowed ? 'shadowed:' : ''}${p.name}`, title: p.name, displayId: uid,
    frame: null, frameSource: null, z: 0,
    family, typeLabel, badges, search, raw: p.raw,
    visible: installed && !off && !suspended && !hidden,
    focused: false,
    shadowed,
    parentHash: p.sharedUser ? `${uid}:shared:${p.sharedUser}` : null,
    ancestors: p.sharedUser ? [{ hash: `${uid}:shared:${p.sharedUser}`, title: p.sharedUser }] : [],
    pkg: p, user: u, userId: uid,
    appId: props.userId || props.appId || null,
    version, versionCode, codePath: code,
    installed, enabled, hidden, suspended, stopped,
    system, privileged, updated, apex,
  };
}

/* A uid shared between packages is the one piece of hierarchy in the dump, so
   it gets a node of its own to hang them from. It is not in the text as a
   block — the `Shared users:` section describes it separately — so it carries
   no raw block and the details pane says what it is instead. */
function sharedUserNode(nameOfUid, uid, kids) {
  return {
    hash: `${uid}:shared:${nameOfUid}`, title: nameOfUid, displayId: uid,
    frame: null, frameSource: null, z: 0,
    family: 'pkg-shared', typeLabel: 'shared user', badges: [],
    search: (nameOfUid + ' shared user ' + kids.map((k) => k.title).join(' ')).toLowerCase(),
    raw: '', visible: kids.some((k) => k.visible), focused: false,
    parentHash: null, ancestors: [],
    shared: true, userId: uid, members: kids,
    appId: kids.length ? kids[0].appId : null,
    installed: true, enabled: null, system: true,
  };
}

function parsePackageDump(input) {
  const lines = dumpLines(input);

  const pkgs = [];
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (indentOf(line) === 0) {
      const head = line.trim().replace(/:$/, '');
      if (PKG_SECTIONS.test(head)) section = head;
      else if (!pkgStray(lines, i, 0)) section = '';
      continue;
    }
    if (!section) continue;
    const m = line.match(PKG_HEAD_RE);
    if (!m) continue;
    const b = takePackageBlock(lines, i, m[1].length);
    i = b.next - 1;
    pkgs.push(parsePackageBlock(m[2], m[3] || null, b.text.split('\n'), section));
  }
  if (!pkgs.length) return finaliseScene('package', [], [], {});

  /* Which users the dump describes. A package that names none is taken as
     belonging to user 0, which is what a single-user device prints. */
  const userIds = new Set();
  for (const p of pkgs) for (const id of p.users.keys()) userIds.add(id);
  if (!userIds.size) userIds.add(0);
  const users = [...userIds].sort((a, b) => a - b);

  const nodes = [];
  for (const uid of users) {
    const mine = [];
    for (const p of pkgs) {
      if (p.users.size && !p.users.has(uid)) continue;
      mine.push(packageNode(p, uid, p.users.get(uid) || null));
    }
    const shared = new Map();
    for (const n of mine) {
      if (!n.pkg.sharedUser) continue;
      const key = n.pkg.sharedUser;
      if (!shared.has(key)) shared.set(key, []);
      shared.get(key).push(n);
    }
    /* A uid one package has to itself is not a group; leave those flat. */
    for (const [key, kids] of shared) {
      if (kids.length > 1) { nodes.push(sharedUserNode(key, uid, kids)); continue; }
      kids[0].parentHash = null;
      kids[0].ancestors = [];
    }
    nodes.push(...mine);
  }

  /* Alphabetical rather than stacked: nothing here is in front of anything.
     `z` is what finaliseScene sorts on and what the tree sorts siblings on, so
     the order is expressed there and the rank it hands out goes unread. */
  for (const uid of users) {
    const mine = nodes.filter((n) => n.displayId === uid);
    mine.sort((a, b) => a.title.toLowerCase() < b.title.toLowerCase() ? -1
                      : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0);
    mine.forEach((n, i) => { n.z = -i; });
  }

  const displays = users.map((uid) => {
    const mine = nodes.filter((n) => n.displayId === uid && !n.shared);
    const third = mine.filter((n) => n.family === 'pkg-app').length;
    return {
      id: uid, name: uid === 0 ? 'owner' : null,
      size: { w: 0, h: 0 }, insets: [], raw: '',
      meta: `${mine.length} package${mine.length === 1 ? '' : 's'} · ${third} third-party`,
      installed: mine.filter((n) => n.installed).length,
      disabled: mine.filter((n) => n.enabled && /^disabled/.test(n.enabled)).length,
    };
  });

  const one = (re) => { const m = lines.join('\n').match(re); return m ? m[1].trim() : null; };
  const globals = {
    packages: pkgs.length,
    shadowed: pkgs.filter((p) => p.section === 'Hidden system packages').length,
    sdk: one(/^\s*mSdkVersion=(\d+)/m),
    fingerprint: one(/^\s*Build fingerprint:\s*(.+)$/m),
  };

  return finaliseScene('package', displays, nodes, globals);
}
