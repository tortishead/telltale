/* ================ tools ================ */
/* One entry per kind of dump Telltale reads. `detect` scores how much the text
   looks like this one — it runs over everything that is loaded, so it stays to
   cheap regexes — and `parse` turns the text into a scene. Adding a dump means
   an entry here and the two functions that render its details; nothing else on
   the page knows how many kinds there are. */
const TOOLS = [
  {
    id: 'window',
    name: 'Windows',
    layout: 'spatial',
    noun: 'window', nouns: 'windows', groupNoun: 'display',
    show: 'all',            // a window dump is all windows and little else
    filterHint: 'Filter by title, package or type',
    detect: (t) => (/WINDOW MANAGER WINDOWS/.test(t) ? 3 : 0)
                 + (/^\s*Window #-?\d+ Window\{/m.test(t) ? 3 : 0)
                 + (/\bmBaseLayer=/.test(t) ? 1 : 0),
    parse: parseWindowDump,
    detail: windowDetail,
    displayDetail: windowDisplayDetail,
  },
  {
    id: 'sf',
    name: 'SurfaceFlinger',
    layout: 'spatial',
    noun: 'layer', nouns: 'layers', groupNoun: 'display',
    show: 'framed',         // the rest is scaffolding; one click brings it back
    filterHint: 'Filter by layer name, class or composition',
    detect: (t) => (/\bHWC layers\b/.test(t) ? 3 : 0)
                 + (/^\s*[+*]\s+\w*Layer\b.*\(.*#\d+\)/m.test(t) ? 3 : 0)
                 /* what the new frontend prints in place of that layer list */
                 + (/^\s*Layer \[\d+\].*#\d+\s*$/m.test(t) ? 3 : 0)
                 + (/^(?:Composition list|Input list|Layer Hierarchy)\b/m.test(t) ? 2 : 0)
                 + (/\blayerStack=/.test(t) ? 1 : 0)
                 + (/\bSurfaceFlinger\b/.test(t) ? 1 : 0),
    parse: parseSurfaceFlingerDump,
    detail: sfDetail,
    displayDetail: sfDisplayDetail,
  },
  {
    id: 'display',
    name: 'Displays',
    /* The one dump whose subject is the display itself, so its nodes are the
       rectangles a display is made of and they are drawn to scale like any
       other. It is also what makes this reader worth having open beside a
       window dump or a touch trace: those assume a display, and this one
       states it. */
    layout: 'spatial',
    noun: 'rect', nouns: 'rects', groupNoun: 'display',
    show: 'all',            // there are four of them; nothing is buried
    visBadge: false,
    filterHint: 'Filter by what the rect is, or by the display it is on',
    /* `DisplayManagerService state:` and `DisplayDeviceInfo{` are printed by
       this service and by nothing else in a bugreport. The viewports are not
       scored: `dumpsys input` prints those too. */
    detect: (t) => (/\bDisplayManagerService state:/.test(t) ? 3 : 0)
                 + (/\bDisplayDeviceInfo\{/.test(t) ? 2 : 0)
                 + (/^\s*Logical Displays:\s*size=\d+/m.test(t) ? 2 : 0)
                 + (/^-{4,}\s*DISPLAY MANAGER\b/m.test(t) ? 1 : 0),
    parse: parseDisplayManagerDump,
    detail: displayNodeDetail,
    displayDetail: displayManagerDetail,
  },
  {
    id: 'activity',
    name: 'Activities',
    /* The task tree is geometry: a task is a rectangle on a display and the
       activities in it are laid out in that rectangle. Drawn beside a window
       dump it says which of the windows on screen belong to which task, and
       why one of them is the size it is. */
    layout: 'spatial',
    noun: 'node', nouns: 'nodes', groupNoun: 'display',
    show: 'all',           // a task tree is tens of rows, not hundreds
    filterHint: 'Filter by activity, package, task or state',
    /* What buries a task tree is that most of it is not on screen: the home
       task under the app, the tasks the shell keeps around empty. `visible`
       is what the display is actually showing, and `activities` drops the
       containers and leaves the records themselves. */
    shows: {
      all:        { label:'all',        test:() => true },
      visible:    { label:'visible',    test:(n) => n.visible === true },
      activities: { label:'activities', test:(n) => n.kind === 'activity' },
    },
    rowMeta: (n) => (n.kind === 'activity'
      ? [n.props.state && esc(n.props.state.toLowerCase()),
         n.props.process && esc(n.props.process),
         n.props.taskId !== null && `task #${n.props.taskId}`]
      : n.kind === 'fragment'
      ? [esc(n.typeLabel), n.props.mode && esc(n.props.mode)]
      : [esc(n.props.type || 'task'), n.props.mode && esc(n.props.mode),
         n.props.childCount !== null && `${n.props.childCount} child${n.props.childCount === 1 ? '' : 'ren'}`]
      ).filter(Boolean).join(' \u00b7 '),
    /* The heading the service prints above the tree, and the tree itself. An
       `ActivityRecord{...}` turns up in a window dump and in the event log as
       well, so it only adds to a score rather than making one. */
    detect: (t) => (/^ACTIVITY MANAGER ACTIVITIES \(dumpsys activity activities\)/m.test(t) ? 3 : 0)
                 + (/^\s*Display #-?\d+ \(activities from top to bottom\):/m.test(t) ? 3 : 0)
                 + (/^\s*\*\s+Task\{[0-9a-f]+ #-?\d+/m.test(t) ? 2 : 0)
                 + (/^\s*\*\s+ActivityRecord\{[0-9a-f]+ u\d+ \S+ t-?\d+\}/m.test(t) ? 1 : 0),
    parse: parseActivityDump,
    detail: activityDetail,
    displayDetail: activityDisplayDetail,
  },
  {
    id: 'service',
    name: 'Services',
    /* A document: a list of records and what each one printed. Nothing here
       sits anywhere, but who is holding a service is worth reading, so the
       connections fold under the service they are on. */
    layout: 'doc',
    noun: 'service', nouns: 'services', groupNoun: 'user',
    show: 'services',
    /* Nearly every service in the list is running as intended, so a green v on
       nearly every row says nothing. The ones that are not carry a badge. */
    visBadge: false,
    filterHint: 'Filter by service, package, process or client',
    /* What buries this dump is that a device runs a couple of hundred
       services and cares about the handful holding a process up. `foreground`
       is what is allowed to run indefinitely, and `all` opens the connections
       themselves. */
    shows: {
      services:   { label:'services',   test:(n) => n.kind === 'service' },
      foreground: { label:'foreground', test:(n) => n.kind === 'service' && n.service.foreground },
      all:        { label:'all',        test:() => true },
    },
    /* A service's connections are the breakdown of it rather than what it is,
       so it opens shut and the list reads as the list of services — until a
       setting asks for the connections themselves. */
    startCollapsed: (n) => n.kind === 'service',
    openOnShow: true,
    rowMeta: (n) => n.kind === 'service'
      ? esc(n.meta || '')
      : [esc(n.typeLabel), n.meta && esc(n.meta)].filter(Boolean).join(' \u00b7 '),
    /* The heading the manager prints above the list, and the heading it groups
       by. A `ServiceRecord{...}` on its own turns up in the event log and in a
       process dump, so it only adds to a score. */
    detect: (t) => (/^ACTIVITY MANAGER SERVICES \(dumpsys activity services\)/m.test(t) ? 3 : 0)
                 + (/^\s*User \d+ active services:\s*$/m.test(t) ? 3 : 0)
                 + (/^\s*\*\s+ServiceRecord\{[0-9a-f]+ u\d+ \S+\}/m.test(t) ? 2 : 0)
                 + (/\bConnectionRecord\{[0-9a-f]+ u\d+/.test(t) ? 1 : 0),
    parse: parseActivityServicesDump,
    detail: serviceDetail,
    displayDetail: serviceGroupDetail,
    attrDetail: docAttrDetail,
  },
  {
    id: 'package',
    name: 'Packages',
    layout: 'list',         // nothing in a package dump sits anywhere
    noun: 'package', nouns: 'packages', groupNoun: 'user',
    show: 'apps',           // a device has ~400 packages and ~80 of its own
    /* Nearly every package is installed and enabled, so a green v on nearly
       every row says nothing. The ones that are not carry a badge of their
       own, and the row still dims. */
    visBadge: false,
    filterHint: 'Filter by package, path, uid or permission',
    /* `with a frame` and `visible` mean nothing here. What buries a package
       dump is the system image, so that is what the settings are about, and
       `installed` sits between the two because a dump lists packages a user
       does not have. */
    shows: {
      apps:      { label:'third-party', test:(n) => n.family === 'pkg-app' && n.installed },
      installed: { label:'installed',   test:(n) => n.installed },
      all:       { label:'all',         test:() => true },
    },
    rowMeta: (n) => n.shared
      ? `shared user · ${n.members.length} packages`
      : [esc(n.typeLabel), n.version && esc(n.version), n.appId && 'uid ' + esc(n.appId)]
          .filter(Boolean).join(' · '),
    detect: (t) => (/^Packages:\s*$/m.test(t) ? 3 : 0)
                 + (/^\s*Package \[[\w.]+\] \(\w+\):\s*$/m.test(t) ? 3 : 0)
                 + (/^\s*(?:requested|install) permissions:\s*$/m.test(t) ? 1 : 0)
                 + (/^\s*(?:pkgFlags|privatePkgFlags)=\[/m.test(t) ? 1 : 0),
    parse: parsePackageDump,
    detail: packageDetail,
    displayDetail: packageUserDetail,
  },
  {
    id: 'anr',
    name: 'ANR traces',
    layout: 'list',        // a thread does not sit anywhere either
    noun: 'thread', nouns: 'threads', groupNoun: 'process', groupNouns: 'processes',
    show: 'blocking',      // the one question an ANR trace gets opened with
    /* Nearly every thread in a dump is running fine. A green v on all of them
       says nothing; the ones that matter carry their own badges. */
    visBadge: false,
    filterHint: 'Filter by thread, state, lock or frame',
    /* `with a frame` and `visible` mean nothing here. What buries an ANR dump
       is the two hundred healthy threads around the handful in the answer, so
       that is what the settings are about. */
    shows: {
      blocking: { label:'blocking', test:(n) => n.pool ? n.members.some(anrBlocking) : anrBlocking(n) },
      active:   { label:'active',   test:(n) => n.pool ? n.members.some(m => !m.idle) : !n.idle },
      all:      { label:'all',      test:() => true },
    },
    /* What is wrong with a process is the reason to pick it, so it leads the
       row the way a thread's state does. */
    groupBadges: (d) => [
      ...(d.graph.cycles.length ? [['deadlock', 'badge-focus']] : []),
      ...(d.graph.chain.length > 1 ? [['main blocked', 'badge-focus']]
        : !d.analysis.main && d.proc.runtime !== 'native' ? [['no main thread', 'badge-exit']]
        : d.analysis.mainIdle ? [['main idle', 'badge-comp']] : []),
      ...(d.blocked ? [[`${d.blocked} blocked`, 'badge-exit']] : []),
    ],
    rowMeta: (n) => n.pool
      ? `${n.members.length} threads · ${n.histogram.map(([st, c]) => `${c} ${esc(st)}`).join(' · ')}${
          n.mostly ? ' · mostly ' + esc(anrShort(n.mostly)) : ''}`
      : [esc(n.thread.state),
         n.thread.tid !== null ? 'tid ' + n.thread.tid : 'sysTid ' + n.thread.sysTid,
         n.leaf && esc(anrShort(n.leaf.method || n.leaf.raw)),
        ].filter(Boolean).join(' · '),
    /* A pool row exists to stand in for its members, so it opens shut: the
       count, the state histogram and what it is mostly doing are the whole of
       what a healthy pool has to say. */
    startCollapsed: (n) => !!n.pool,
    detect: (t) => (/^-{2,}\s*pid\s+\d+\s+at\s+/m.test(t) ? 3 : 0)
                 + (/^"[^"]*"\s+(?:daemon\s+)?prio=\d+\s+tid=\d+\s/m.test(t) ? 3 : 0)
                 + (/\bDALVIK THREADS\b/.test(t) ? 1 : 0)
                 + (/^\s*-\s+waiting to lock </m.test(t) ? 1 : 0),
    parse: parseAnrDump,
    detail: anrDetail,
    displayDetail: anrProcessDetail,
  },
  {
    id: 'car',
    name: 'Car service',
    /* A document: nothing to draw, but the sections are worth reading, so the
       list keeps the left pane and the middle reads. */
    layout: 'doc',
    noun: 'section', nouns: 'sections', groupNoun: 'car service',
    show: 'services',      // the forty services, not the two hundred sections
    visBadge: false,
    filterHint: 'Filter by section or anything printed in one',
    /* What buries a car_service dump is its own depth: two thousand lines in
       which the thing being looked for is a value inside one of forty
       services. So the settings are about how far in to list, and the filter
       reaches the whole of every block. */
    shows: {
      services: { label:'services', test:(n) => !n.parentHash },
      problems: { label:'problems', test:(n) => n.failed },
      all:      { label:'all',      test:() => true },
    },
    rowMeta: (n) => [
      esc(n.typeLabel),
      n.subCount ? `${n.subCount} section${n.subCount === 1 ? '' : 's'}` : null,
      `${n.lines} line${n.lines === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' \u00b7 '),
    /* A service's subsections are what is inside it, not what it is, so they
       open shut and the list reads as the list of services. */
    startCollapsed: (n) => !n.parentHash,
    attrDetail: docAttrDetail,
    detect: (t) => (/^\s*\*Dump car service\*/m.test(t) ? 3 : 0)
                 + (/^\s*\*Dump all services\*/m.test(t) ? 3 : 0)
                 + (/^\s*Car Version:\s*CarVersion\[/m.test(t) ? 1 : 0)
                 + (/\*(?:CarPropertyService|CarFeatureController|CarAudioService)\*/.test(t) ? 1 : 0),
    parse: parseCarServiceDump,
    detail: carDetail,
    displayDetail: carDisplayDetail,
  },
  {
    id: 'user',
    name: 'Users',
    layout: 'doc',         // a document, and a short one: seventeen rows
    noun: 'section', nouns: 'sections', groupNoun: 'dump',
    show: 'all',           // nothing is buried in a list this size
    visBadge: false,
    filterHint: 'Filter by user, type, package or anything printed',
    shows: {
      users: { label:'users', test:(n) => !!n.user },
      types: { label:'types', test:(n) => !!n.userType },
      all:   { label:'all',   test:() => true },
    },
    rowMeta: (n) => [esc(n.typeLabel), n.meta && esc(n.meta)].filter(Boolean).join(' \u00b7 '),
    /* `Users:` at no indent is this dump's own heading and nothing else's;
       `UserInfo{` on its own turns up in other dumps, so it only adds to a
       score rather than making one. */
    detect: (t) => (/^Users:\s*$/m.test(t) ? 3 : 0)
                 + (/^Current user:\s*-?\d+/m.test(t) ? 2 : 0)
                 + (/^\s*UserInfo\{-?\d+:/m.test(t) ? 1 : 0)
                 + (/^User types \(\d+ types\):/m.test(t) ? 1 : 0),
    parse: parseUserDump,
    detail: userDetail,
    displayDetail: userGroupDetail,
    attrDetail: docAttrDetail,
  },
  {
    id: 'props',
    name: 'Properties',
    /* A document: a name and a value, two and a half thousand times, and
       nothing that sits anywhere. The list is the shape the names already
       have — a namespace, the things inside it, the properties they hold. */
    layout: 'doc',
    noun: 'property', nouns: 'properties',
    groupNoun: 'namespace', groupNouns: 'namespaces',
    show: 'all',
    visBadge: false,
    filterHint: 'Filter by property name or value, or /regex/',
    /* What buries a property dump is its size. `runtime` drops the two
       thousand properties the build set and cannot change, which leaves what
       the running device put there; `flagged` is the handful whose value is a
       finding rather than a fact. */
    shows: {
      all:     { label:'all',     test:() => true },
      runtime: { label:'runtime', test:(n) => !n.readOnly },
      flagged: { label:'flagged', test:(n) => !!n.flagged },
    },
    /* A namespace is the breakdown of itself rather than what it is, so it
       opens shut and the list reads as the list of namespaces — until a
       setting asks for the properties themselves. */
    startCollapsed: (n) => !!n.propSection,
    openOnShow: true,
    rowMeta: (n) => esc(n.meta || ''),
    /* The rule dumpstate prints, and the one property every Android device
       has. Neither on its own is enough for a pasted fragment, so a run of
       lines in the shape only `getprop` prints counts for as much. */
    detect: (t) => (/^-{4,}\s*SYSTEM PROPERTIES\b/m.test(t) ? 3 : 0)
                 + (/^\[ro\.build\.fingerprint\]:\s*\[/m.test(t) ? 2 : 0)
                 + (/^(?:\[[A-Za-z_][A-Za-z0-9_.@-]*\]:\s*\[.*\]\s*\n){8,}/m.test(t) ? 2 : 0),
    parse: parseSystemPropertiesDump,
    detail: propDetail,
    displayDetail: propsGroupDetail,
    attrDetail: docAttrDetail,
  },
  {
    id: 'overlay',
    /* A document: blocks of printed fields and nothing to draw. The list is
       the shape the dump is read in — a target package, and the overlays over
       it — and the reading pane is the block each one printed. */
    layout: 'doc',
    name: 'Overlays',
    noun: 'overlay', nouns: 'overlays', groupNoun: 'user',
    show: 'all',
    /* Half the overlays on a device are off on purpose — every theme the
       picker did not pick — so a green v on the other half says nothing. An
       overlay that is off still dims, and one that is off for a reason nobody
       chose carries a badge. */
    visBadge: false,
    filterHint: 'Filter by overlay, target, category or path',
    /* What buries an overlay dump is that a device ships sixty of them and
       cares about four. `applied` is the four; `problems` is the dump's own
       answer to why an overlay that should be one of them is not. */
    shows: {
      all:      { label:'all',      test:() => true },
      applied:  { label:'applied',  test:(n) => !!n.overlay && n.on },
      problems: { label:'problems', test:(n) => !!n.overlay && !!n.broken },
    },
    /* The overlays over a target are the breakdown of it rather than what it
       is, so a target opens shut and the list reads as the list of targets —
       until a setting asks for the overlays themselves. */
    startCollapsed: (n) => !!n.targetNode,
    openOnShow: true,
    rowMeta: (n) => [esc(n.typeLabel), n.meta && esc(n.meta)].filter(Boolean).join(' \u00b7 '),
    /* `mTargetPackageName` is printed by this service and by nothing else in a
       bugreport, dots and all. The rest only add to a score. */
    detect: (t) => (/^\s*mTargetPackageName\.*\s*:/m.test(t) ? 3 : 0)
                 + (/^\s*mIsMutable\.*\s*:\s*(?:true|false)\s*$/m.test(t) ? 2 : 0)
                 + (/\bSTATE_(?:ENABLED|DISABLED|MISSING_TARGET|NO_IDMAP)\b/.test(t) ? 2 : 0)
                 + (/^\s*mBaseCodePath\.*\s*:/m.test(t) ? 1 : 0),
    parse: parseOverlayDump,
    detail: overlayDetail,
    displayDetail: overlayGroupDetail,
    attrDetail: docAttrDetail,
  },
  {
    id: 'binder',
    name: 'Binder calls',
    layout: 'list',        // a table of counters; nothing in it sits anywhere
    noun: 'call', nouns: 'calls', groupNoun: 'user',
    show: 'all',           // the callers, with their methods folded under them
    visBadge: false,
    filterHint: 'Filter by package, uid, interface or method',
    /* What buries this dump is that every caller is printed once per method it
       called, so a few hundred rows are a couple of dozen callers. The list is
       those callers, shut, and the settings are about which of them to open
       with: everything, or only what threw. */
    shows: {
      all:     { label:'all',     test:() => true },
      callers: { label:'callers', test:(n) => !n.parentHash },
      threw:   { label:'threw',   test:(n) => n.exceptions > 0 },
    },
    /* A caller's methods are the breakdown of it, not what it is, so they open
       shut and the list reads as the list of callers — until a setting asks for
       the methods themselves, which is what `threw` is for. */
    startCollapsed: (n) => !!n.caller,
    openOnShow: true,
    rowMeta: (n) => n.caller
      ? [`${n.calls} call${n.calls === 1 ? '' : 's'}`,
         binderTime(n.cpu),
         n.pct !== null ? `${n.pct}% of cpu` : null,
         `${n.methods} method${n.methods === 1 ? '' : 's'}`,
        ].filter(Boolean).join(' \u00b7 ')
      : [`${n.calls} call${n.calls === 1 ? '' : 's'}`,
         binderTime(n.cpu),
         `worst ${binderTime(n.maxCpu)}`,
         `latency ${binderTime(n.latency)}`,
        ].filter(Boolean).join(' \u00b7 '),
    /* How the dump was taken decides whether any of it means anything, so the
       two ways it comes back empty or estimated are said on the group itself
       rather than found in the reading pane. */
    groupBadges: (d) => {
      const g = S.data.globals;
      return [
        ...(g.recording === false ? [['not recording', 'badge-exit']] : []),
        ...(g.sampling > 1 ? [[`1 in ${g.sampling}`, 'badge-comp']] : []),
        ...(d.threw ? [[`${d.threw} threw`, 'badge-focus']] : []),
      ];
    },
    detect: (t) => (/^\s*Per-UID raw data.*\(.*call_desc.*\):\s*$/m.test(t) ? 3 : 0)
                 + (/^\s*Exceptions thrown \(exception_count, class_name\):/m.test(t) ? 3 : 0)
                 + (/^\s*Sampling interval period:\s*\d+\s*$/m.test(t) ? 1 : 0)
                 + (/^\s*Summary: total_cpu_time=\d+/m.test(t) ? 1 : 0),
    parse: parseBinderCallsStatsDump,
    detail: binderDetail,
    displayDetail: binderUserDetail,
  },
  {
    id: 'input',
    name: 'Input windows',
    /* The dispatcher's own list of what is on each display, in the order it
       walks it. It is the window layout again, seen from the only place that
       decides where a touch goes. */
    layout: 'spatial',
    noun: 'window', nouns: 'windows', groupNoun: 'display',
    show: 'touchable',    // the question is where a touch goes, not what is up
    filterHint: 'Filter by window, application, uid or config',
    /* Half the windows in this list are not in a touch's way at all: the
       wallpaper, a drop target, an invisible shade, a window with no channel.
       They are the ones to bury, and `keys` is the other half of the same
       question for a keyboard rather than a finger. */
    shows: {
      touchable: { label:'take touch', test:(n) => n.touchable },
      keys:      { label:'take keys',  test:(n) => n.visible && !n.monitor
                                                && !n.config.includes('NOT_FOCUSABLE') },
      all:       { label:'all',        test:() => true },
    },
    /* Every window in this dump is one the dispatcher is considering, so a
       green v on all of them says nothing; what is worth reading off a row is
       whether it takes the touch, which is its colour and its badges. */
    visBadge: false,
    rowMeta: (n) => n.monitor
      ? 'every touch on this display'
      : [n.frame ? `${rectW(n.frame)}×${rectH(n.frame)}` : 'no frame',
         n.touchable ? (n.regions.length > 1 ? `${n.regions.length} touch rects` : 'takes touch')
                     : 'no touch',
         n.config.length ? esc(n.config.join(' · ')) : null,
        ].filter(Boolean).join(' \u00b7 '),
    /* The sheet draws the frame; the region inside it is what the window
       actually takes touch in, and where the two differ that difference is the
       answer. Under the frame a region that is the frame again is not drawn
       twice; the selected window is marked with all of its rects, because the
       point of picking one is to be shown what it takes. */
    regions: (n, selected) => !n.regions || !n.frame ? []
      : n.regions.map((rc, i) => ({ rc, i })).filter(({ rc }) => selected
          || rc.l !== n.frame.l || rc.t !== n.frame.t
          || rc.r !== n.frame.r || rc.b !== n.frame.b),
    detect: (t) => (/^\s*Input Dispatcher State:/m.test(t) ? 3 : 0)
                 + (/^\s*Input Reader State/m.test(t) ? 2 : 0)
                 + (/INPUT MANAGER \(dumpsys input\)/.test(t) ? 2 : 0)
                 + (/\btouchableRegion=/.test(t) ? 1 : 0),
    parse: parseInputDump,
    detail: inputDetail,
    displayDetail: inputDisplayDetail,
  },
  {
    id: 'inputdev',
    name: 'Input devices',
    layout: 'list',        // a device is a thing plugged in, not a thing drawn
    noun: 'device', nouns: 'devices', groupNoun: 'display',
    show: 'devices',       // the mappers are the breakdown, not the list
    visBadge: false,
    filterHint: 'Filter by device, source, path or descriptor',
    shows: {
      devices:  { label:'devices',  test:(n) => n.device },
      external: { label:'external', test:(n) => n.device && n.external },
      all:      { label:'all',      test:() => true },
    },
    startCollapsed: (n) => !!n.device,
    openOnShow: true,
    rowMeta: (n) => n.mapper
      ? [n.mode && esc(n.mode), `${n.lines} line${n.lines === 1 ? '' : 's'}`]
          .filter(Boolean).join(' \u00b7 ')
      : [`id ${n.id}`,
         n.sources.names.length ? esc(n.sources.names.join(' · ')) : esc(n.sources.raw || 'no sources'),
         n.keyboardLabel && n.keyboardLabel !== 'none' ? `${esc(n.keyboardLabel)} keys` : null,
        ].filter(Boolean).join(' \u00b7 '),
    detect: (t) => (/^\s*Input Reader State/m.test(t) ? 3 : 0)
                 + (/^\s*Event Hub State:/m.test(t) ? 2 : 0)
                 + (/INPUT MANAGER \(dumpsys input\)/.test(t) ? 2 : 0)
                 + (/^\s*Motion Ranges:\s*$/m.test(t) ? 1 : 0),
    parse: parseInputDevicesDump,
    detail: inputDevDetail,
    displayDetail: inputDevGroupDetail,
  },
  {
    id: 'getevent',
    name: 'Touch trace',
    /* Spatial, because a stroke is somewhere — but the plan and the z-order
       stack say nothing about a thing that only exists over time, so this one
       brings its own sheet and its own line under it, and has no pose. */
    layout: 'spatial',
    views: false,
    sheet: geteventSheet,
    sheetFoot: geteventFoot,
    noun: 'stroke', nouns: 'strokes', groupNoun: 'device',
    /* `event0` is the volume rocker on half the phones ever made and sorts
       first. The panel is what a touch trace is about, so that is what it
       opens on. */
    openOn: (scene) => (scene.displays.find(d => !d.noGeometry) || scene.displays[0]).id,
    show: 'all',
    visBadge: false,
    filterHint: 'Filter by gesture, key, slot or position',
    /* Everything, what the finger did, and what it did that was not standing
       still — which is the difference between a list of taps and the gesture
       that is actually being looked for. */
    shows: {
      all:   { label:'all',   test:() => true },
      touch: { label:'touch', test:(n) => !n.key },
      moved: { label:'moved', test:(n) => n.gesture || (n.geo && n.geo.travel > 0) },
    },
    rowMeta: (n) => n.key
      ? `held ${gevMs(n.end - n.start)}`
      : n.gesture
        ? `${n.fingers} fingers · ${gevMs(n.end - n.start)}`
        : [`slot ${n.slot}`, n.trackingId >= 0 ? `id ${n.trackingId}` : null,
           `${n.samples.length} samples`].filter(Boolean).join(' · '),
    /* A capture is its event lines and nothing else, so the shape of a line is
       the whole of the test. `ABS_MT_POSITION_X` on its own is not: a bugreport
       prints that name too, in the input reader's motion ranges. */
    detect: (t) => (/^\s*\[\s*\d+(?:\.\d+)?\s*\]\s*\/dev\/input\/[\w.-]+:\s/m.test(t) ? 3 : 0)
                 + (/^\s*\/dev\/input\/[\w.-]+:\s+(?:EV_[A-Z]+|[0-9a-f]{4})\s+\w+\s+[0-9a-f]{1,8}\s*$/m.test(t) ? 3 : 0)
                 /* Taken with a device argument, which prints no node: the
                    stamp and the labels are then the whole of the shape. */
                 + (/^\s*\[\s*\d+(?:\.\d+)?\s*\]\s*(?:EV_[A-Z]+|[0-9a-f]{4})\s+\w+\s+[0-9a-f]{1,8}\s*$/m.test(t) ? 3 : 0)
                 + (/^\s*EV_[A-Z]+\s+\w+\s+[0-9a-f]{1,8}\s*$/m.test(t) ? 2 : 0)
                 + (/^add device\s+\d+:\s*\/dev\/input\//m.test(t) ? 1 : 0),
    parse: parseGeteventCapture,
    detail: geteventDetail,
    displayDetail: geteventDeviceDetail,
  },
  {
    id: 'events',
    name: 'Events',
    /* An event happened; it does not sit anywhere. The list is the buffer in
       the order it was written, which is what makes it a story. */
    layout: 'list',
    noun: 'event', nouns: 'events', groupNoun: 'log', groupNouns: 'logs',
    show: 'all',
    visBadge: false,
    filterHint: 'Filter by tag, package, activity or anything in the line, or /regex/',
    /* The buffer is mostly bookkeeping — a uid going idle, a process measured
       — and what it is opened for is one of three things: what the apps did,
       what went wrong, and what the system did around them. */
    shows: {
      all:     { label:'all',     test:() => true },
      apps:    { label:'apps',    test:(n) => n.kind === 'process' || n.kind === 'activity' },
      trouble: { label:'trouble', test:(n) => n.kind === 'trouble' },
      system:  { label:'system',  test:(n) => n.kind === 'system' },
    },
    row: eventRow,
    rowClass: (n) => `is-log-row ${n.family}`,
    listClass: 'is-log',
    /* The rule a bugreport prints over the buffer, logd's own marker at the
       top of a pasted one, and the tags themselves — of which a text has to
       hold a few before it is this dump rather than a log that mentioned one. */
    detect: (t) => (/^-{4,}\s*EVENT LOG\b/m.test(t) ? 3 : 0)
                 + (/^-{4,}\s*beginning of events\s*$/m.test(t) ? 2 : 0)
                 + (/\b(?:am_proc_start|am_anr|am_crash|am_kill|wm_set_resumed_activity|am_on_resume_called|boot_progress_ams_ready)\s*:/.test(t) ? 2 : 0),
    parse: parseEventLogDump,
    detail: eventDetail,
    displayDetail: eventLogDetail,
  },
  {
    id: 'logcat',
    name: 'Logcat',
    layout: 'list',        // a log line happened, it does not sit anywhere
    noun: 'line', nouns: 'lines', groupNoun: 'log', groupNouns: 'logs',
    /* The log opens as the log: every line, in order. The buttons below are
       the `*:I`, `*:W`, `*:E` a log reader is normally read through, and they
       are a floor on the level rather than a set of rows picked out of it. */
    show: 'all',
    visBadge: false,
    filterHint: 'Filter by tag, message, pid or tid, or /regex/',
    shows: {
      all:      { label:'all',    test:() => true },
      info:     { label:'info+',  test:(n) => n.level.rank >= 2 },
      warnings: { label:'warn+',  test:(n) => n.level.rank >= 3 },
      errors:   { label:'error+', test:(n) => n.level.rank >= 4 },
    },
    /* A log line is read across, not down: the stamp, who printed it, the
       level, the tag, the message — in that order, in fixed columns, the way
       every other log reader prints one. That is a row of its own rather than
       a title with a line of meta under it, so the tool draws its own row. */
    row: logRow,
    rowClass: (n) => 'is-log-row ' + n.level.family + (n.crash ? ' is-crash' : ''),
    listClass: 'is-log',
    detect: (t) => (/^-{4,}\s*(?:SYSTEM|EVENT|RADIO|KERNEL|LAST|MAIN|CRASH)\s+LOG/m.test(t) ? 3 : 0)
                 + (/^(?:\d{4}-)?\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\.\d{3}\s+(?:\S+\s+)?\d+\s+\d+\s+[VDIWEFSA]\s/m.test(t) ? 3 : 0)
                 + (/^-{4,}\s*beginning of \S+/m.test(t) ? 1 : 0),
    parse: parseLogcatDump,
    detail: logDetail,
    displayDetail: logSectionDetail,
  },
];

/* What `blocking` keeps: main, the chain behind it, a deadlock, and anything
   holding or queued on a monitor. Everything else is a thread doing its job. */
function anrBlocking(n){
  return n.thread.isMain || n.chainAt >= 0 || n.inCycle
      || n.thread.state === 'Blocked' || n.holds.length > 0 || n.waits.length > 0;
}

/* The three panes are three answers about the same dump, and one of them
   failing is not a reason to lose the other two. A reader draws its own details
   pane, so it can throw there as easily as it can while parsing — and a click
   that dies half way through leaves two panes describing the row before last,
   which is worse than a pane that says what happened.

   The guard goes on the renderer rather than on the three call sites that ask
   for all of them, because a pane is redrawn on its own as often as it is
   redrawn with the others: a selection redraws the details without the sheet,
   and the promise is the same either way. */
function paneGuard(into, what, draw){
  return (...args) => {
    try { return draw(...args); }
    catch(e){
      /* The pane says so in the pane, which is where the reader is looking;
         the stack goes to the console for whoever is debugging it. */
      console.error(`Telltale: ${what} could not be drawn`, e);
      const el = $(into);
      if(el) el.innerHTML = `<p class="err">Telltale could not draw ${esc(what)}: `
        + `${esc((e && e.message) || String(e))}</p>`;
    }
  };
}

const renderList = paneGuard('wlist', 'the list', drawList);
const renderPlan = paneGuard('sheet', 'the sheet', drawPlan);
const renderDetail = paneGuard('detail', 'the details', drawDetail);

function renderAll(){ renderList(); renderPlan(); renderDetail(); }

function setView(view){
  S.view = view;
  /* Plan, Z-order and the pose they are about belong to a dump that draws.
     Nothing else has a view to set. */
  const drawn = S.tool && S.tool.layout === 'spatial';
  /* A drawn dump that brings its own sheet has neither of the two views nor a
     pose between them: the drawing is the drawing. */
  const posable = drawn && S.tool.views !== false;
  $('viewTabs').hidden = !posable;
  $('viewPlan').setAttribute('aria-pressed', String(view === 'plan'));
  $('viewDepth').setAttribute('aria-pressed', String(view === 'depth'));
  $('depthCtl').hidden = !posable || view !== 'depth';
  $('sheet').classList.toggle('is-orbit', posable && view === 'depth');
  gevSyncBar();
  syncDepthCtl();
  renderPlan();
}

function resetView(){
  Object.assign(S, VIEW0);
  syncDepthCtl();
  renderPlan();
}

function syncDepthCtl(){
  $('rngYaw').value = S.yaw;
  $('rngPitch').value = S.pitch;
  $('rngSep').value = S.sep;
}

/* `region` is which of the node's own rects was picked — the touchable rect a
   click landed in, or the row for it in the pane. Picking the node anywhere
   else drops it: the rect is a part of that node and means nothing under the
   next one. */
function select(hash, region){
  // Picking a section is a new thing to read; whatever was picked in the last
  // one is not in this one.
  if(hash !== S.selected) S.attr = null;
  S.selected = hash;
  S.region = region === undefined || region === null ? null : +region;
  revealAncestors(hash);
  renderList(); renderPlan(); renderDetail();
  if(window.matchMedia && window.matchMedia('(max-width:1080px)').matches) document.body.classList.add('show-detail');
}

/* ---------------- search across the workspace ---------------- */

/* The filter above the list searches the dump you are reading. This searches
   the desk: every dump open in the workspace, every reader that recognised
   each of them, and every display inside each reader — because what you are
   after is often in the one you are not looking at. A bugreport read by four
   parsers is four sets of names over the same text, and none of them is the
   wrong place to look.

   It matches the way the filter matches, on the same precomputed `search`
   string a parser hangs on every node, so picking a result and typing the same
   query into that dump's own filter list the same rows. That is what lets a
   result be handed over as a filter rather than as a scroll position. */
const FIND_PER_GROUP = 25;   // hits listed per reader per display
let findFlat = [];           // every listed hit, in the order they are drawn
let findAt = 0;              // which one the keyboard is on
let findRegex = false;       // whether the box is read as a pattern

function findHits(q){
  const needle = q.trim().toLowerCase();
  const m = textMatcher(q, findRegex);
  const groups = [], flat = [];
  let total = 0, capped = false;
  if(!m || !m.ok) return { groups, flat, total, capped, needle, bad:m && !m.ok ? m : null };
  for(const doc of S.docs){
    for(const entry of doc.found){
      for(const display of entry.scene.displays){
        const hits = [];
        let n = 0;
        for(const node of display.nodes){
          if(!m.test(node.search)) continue;
          n++; total++;
          /* A group is capped rather than dropped: a query that matches four
             hundred packages should still say which dumps hold them. */
          if(hits.length < FIND_PER_GROUP){
            const hit = { doc, entry, display, node };
            hits.push(hit); flat.push(hit);
          }
        }
        if(!hits.length) continue;
        if(n > hits.length) capped = true;
        groups.push({ doc, entry, display, hits, more:n - hits.length });
      }
    }
  }
  return { groups, flat, total, capped, needle };
}

/* Where a run of hits came from: the dump's tab label, the reader that found
   them, and — only where the reader found more than one — which display. */
function findSrc(g){
  const ds = g.entry.scene.displays;
  const where = ds.length < 2 ? ''
    : ' · ' + esc(g.display.label || `${g.entry.tool.groupNoun || 'display'} ${g.display.id}`);
  /* One tab is one reader, so the tab's name and the reader's are two halves
     of where a hit came from: the file, then what read it. */
  return `<b>${esc(g.doc.label)}</b> · ${esc(g.entry.tool.name)}${where}`;
}

function renderFind(){
  const res = findHits($('findBox').value);
  findFlat = res.flat;
  if(findAt >= findFlat.length) findAt = 0;
  const box = $('findResults'), foot = $('findFoot');
  const keys = '↑↓ to move · ⏎ to open · esc to close';

  if(!res.needle){
    const n = S.docs.length;
    box.innerHTML = `<p class="find-empty">Type to search every dump in <b>${
      esc(currentSpace().name)}</b>.</p>`;
    foot.hidden = false;
    foot.textContent = `${n} ${n === 1 ? 'dump' : 'dumps'} on this desk · ${keys}`;
    return;
  }
  if(!findFlat.length){
    box.innerHTML = res.bad
      ? `<p class="find-empty">That is not a regular expression: ${esc(res.bad.error)}</p>`
      : `<p class="find-empty">Nothing in this workspace matches <b>${
          esc(res.needle)}</b>.</p>`;
    foot.hidden = true;
    return;
  }

  let at = 0;
  box.innerHTML = res.groups.map(g => {
    const rows = g.hits.map(h => `<button class="find-hit" type="button" role="option"
        data-at="${at++}" aria-selected="${at - 1 === findAt}">
      <span class="find-title">${esc(h.node.title)}</span>
      <span class="find-meta">${rowMeta(g.entry.tool, h.node)}</span>
    </button>`).join('');
    return `<div class="find-group"><p class="find-src">${findSrc(g)}</p>${rows}${
      g.more ? `<p class="find-more">and ${g.more} more</p>` : ''}</div>`;
  }).join('');

  foot.hidden = false;
  foot.textContent = `${res.total} ${res.total === 1 ? 'match' : 'matches'}${
    res.capped ? ', the first few of each listed' : ''} · ${keys}`;
  scrollFindIntoView();
}

function scrollFindIntoView(){
  const el = $('findResults').querySelector('.find-hit[aria-selected="true"]');
  if(el) el.scrollIntoView({ block:'nearest' });
}

/* Moving the pick repaints the attribute rather than the list: the results do
   not change while you walk them, and a redraw would lose the scroll. */
function moveFind(step){
  if(!findFlat.length) return;
  findAt = (findAt + step + findFlat.length) % findFlat.length;
  for(const el of $('findResults').querySelectorAll('.find-hit')){
    el.setAttribute('aria-selected', String(+el.dataset.at === findAt));
  }
  scrollFindIntoView();
}

function openFind(){
  if(!S.docs.length) return;
  findAt = 0;
  $('find').hidden = false;
  const box = $('findBox');
  /* Whatever the open dump is already filtered by is the likeliest thing to
     want across the rest of them. */
  box.value = S.filter || '';
  renderFind();
  box.focus();
  box.select();
}

function closeFind(){ $('find').hidden = true; }

/* Picking a result is four moves in the order they have to happen: open the
   dump, switch it to the reader that found the hit — which starts that reader
   over, so the display and the filter can only be set after it — then select
   the node. The query is left on as the dump's own filter, so what was found
   is what is on screen rather than one row in two hundred. */
function goToHit(hit){
  const q = $('findBox').value.trim();
  closeFind();
  if(hit.doc.id !== S.docId) openDoc(hit.doc);
  S.displayId = hit.display.id;
  S.filter = q;
  /* A query that was read as a pattern has to keep being read as one, or the
     tab lands showing nothing with the thing that was found typed into it. */
  S.regex = findRegex;
  syncUi();
  select(hit.node.hash);
  revealRow(hit.node.hash);
}

/* A row can be found and still be below the fold — or, in a windowed list, not
   be in the DOM at all until the window is moved onto it. */
function revealRow(hash){
  if(S.tool && S.tool.row){
    const i = rowWin.nodes.findIndex(n => n.hash === String(hash));
    if(i >= 0 && (i < rowWin.from + 2 || i >= rowWin.to - 2)){
      const box = $('stackScroll');
      box.scrollTop = Math.max(0, i * rowWin.rowH - (box.clientHeight || 600) / 2);
      paintRowWindow();
    }
  }
  const row = $('wlist').querySelector(`.wrow[data-hash="${CSS.escape(String(hash))}"]`);
  if(row) row.scrollIntoView({ block:'nearest' });
}
