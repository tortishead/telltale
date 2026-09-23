/* ================ parse: dumpsys activity activities ================ */

/* `dumpsys activity activities` is the activity manager's own answer to what
 * is on each display: a tree per display, printed front to back, of the tasks
 * the device is holding, the fragments a task was split into, and the
 * activities inside them. It is the one dump that says which activity is
 * resumed and which task a window belongs to, which is what makes it worth
 * reading beside a window dump: `dumpsys window` says what is on screen, this
 * says what the framework meant to put there.
 *
 * Every node of that tree is printed as a starred head with the object's
 * identity hash first inside the brace, then its fields indented under it:
 *
 *   * Task{a1f0c2d #6 type=standard A=10143:com.android.settings U=0 ...}
 *     bounds=[0,0][1080,2400]
 *     * ActivityRecord{3c9be41 u0 com.android.settings/.Settings t6}
 *       state=RESUMED stopped=false delayedResume=false finishing=false
 *
 * What changed between releases is the spelling of the geometry and the depth
 * of the tree, not the heads. A task printed its rect as `bounds=[l,t][r,b]`
 * for years and prints `mBounds=Rect(l, t - r, b)` on Android 16; split screen
 * and desktop windowing put tasks inside tasks, and activity embedding puts a
 * TaskFragment between a task and its activities. So the heads are what this
 * reader keys on, the nesting is read off the indentation rather than assumed,
 * and both spellings of a rect are accepted.
 *
 * The nodes are drawn: a task carries the bounds it was given, and an activity
 * that printed none is drawn at the bounds of whatever contains it, which is
 * what a fullscreen activity in a fullscreen task actually occupies. */

/* Where the section starts inside a bugreport, which prints half a dozen other
   `ACTIVITY MANAGER ...` sections around it. The display heading is here as
   well so a fragment pasted without the dumpsys line still opens. */
const ACT_SECTION_START =
  /^(?:ACTIVITY MANAGER ACTIVITIES\b|\s*Display #-?\d+ \(activities from top to bottom\))/;
const ACT_DISPLAY_HEAD = /^\s*Display #(-?\d+)\s*\(activities/;
/* One head shape for all three kinds: the star, the class, and the identity
   hash the object prints first inside its brace. */
const ACT_HEAD = /^(\s*)\*\s+(Task|TaskFragment|ActivityRecord)\{([0-9a-fA-F]+)\s*([^}]*)\}\s*$/;
/* `ActivityRecord{3c9be41 u0 com.android.settings/.Settings t6}` — the user,
   the component and the task it is in, which is the whole of an activity's
   head. */
const ACT_REC_HEAD = /^u(\d+)\s+(\S+)(?:\s+t(-?\d+))?/;
/* What a display says about itself after its tasks: the activity the manager
   has resumed on it. */
const ACT_RESUMED = /^\s*(?:ResumedActivity|mResumedActivity):?\s*(?:=\s*)?ActivityRecord\{([0-9a-fA-F]+)/;

/* A reader with half a dozen siblings in the same file — a bugreport prints
   `ACTIVITY MANAGER SERVICES`, `... BROADCAST STATE` and the rest around this
   one — so a text that never says where the activities start is not this
   dump at all, and the next of those headings is where it stops. The shared
   boundary does not catch them: it knows `(dumpsys overlay)` and these say
   `(dumpsys activity services)`, which is two words where it expects one. */
const ACT_SECTION_END = new RegExp(`^(?:${DUMP_BOUNDARY}|ACTIVITY MANAGER\\b)`);

const actSection = (lines) => sectionSpan(lines, ACT_SECTION_START, ACT_SECTION_END, 'none');

/* A field printed as `key=value` anywhere in a block. The dump crowds several
   onto a line — `state=RESUMED stopped=false finishing=false` — so a value
   runs to the next space, except where it is a brace of its own: an intent and
   a process record both hold spaces and would otherwise come out half read.
   `null` is the dump saying there is none. */
function actField(text, key) {
  const m = text.match(new RegExp(
    `\\b${key}=("[^"]*"|[A-Za-z_]\\w*\\{[^{}]*\\}|\\{[^{}]*\\}|[^\\s,]+)`));
  if (!m) return null;
  const v = m[1].replace(/^"|"$/g, '');
  return v === 'null' || v === '' ? null : v;
}

const actBool = (text, key) => {
  const v = actField(text, key);
  return v === 'true' ? true : v === 'false' ? false : null;
};

/* The rect a container was given, in whichever spelling the release prints it
   in — the shared reader takes both. A task that fills its parent prints an
   empty rect rather than the parent's, so an empty one is no answer and the
   caller inherits. */
function actBounds(text) {
  for (const key of ['mBounds', 'bounds', 'mLastReportedBounds']) {
    const rect = diaRectField(text, key);
    if (rectValid(rect)) return rect;
  }
  return null;
}

/* The head of a task, which is the only place a task states what kind of task
   it is and what the manager thinks of it. */
function actTaskHead(rest) {
  const id = rest.match(/#(-?\d+)/);
  const intent = actField(rest, 'A') || actField(rest, 'I') || actField(rest, 'aI');
  return {
    taskId: id ? +id[1] : null,
    type: actField(rest, 'type') || 'undefined',
    affinity: intent,
    userId: actField(rest, 'U') === null ? null : +actField(rest, 'U'),
    visible: actBool(rest, 'visible'),
    visibleRequested: actBool(rest, 'visibleRequested'),
    mode: actField(rest, 'mode') || null,
    translucent: actBool(rest, 'translucent'),
    childCount: actField(rest, 'sz') === null ? null : +actField(rest, 'sz'),
  };
}

/* What to call a task. Its affinity is the package prefixed with the uid it
   runs as, and a task that has none is named by the component the dump says
   it was started for. */
function actTaskName(head, body) {
  const name = head.affinity || actField(body, 'affinity')
            || actField(body, 'mActivityComponent');
  if (!name) return null;
  const bare = name.replace(/^\d+:/, '');
  return bare.includes('/') ? shortComponent(bare) : bare;
}

/* An activity is coloured for being one; a container is coloured by the kind
   of task it is, which is what tells the home task apart from the app on top
   of it at a glance. */
const ACT_FAMILIES = {
  home: 'act-home', recents: 'act-recents', assistant: 'act-assistant',
  dream: 'act-dream', standard: 'act-task', undefined: 'act-task',
};

/* Everything the three kinds of node share, filled in per kind by the callers
   below. */
function actNode(kind, opts) {
  return {
    kind,
    hash: opts.hash,
    idHash: opts.idHash,
    title: opts.title,
    displayId: opts.displayId,
    depth: opts.depth,
    rootIndex: opts.rootIndex,
    parentHash: opts.parentHash,
    ancestors: opts.ancestors,
    at: opts.at,
    frame: opts.frame,
    frameSource: opts.frame ? opts.frameSource : null,
    family: opts.family,
    typeLabel: opts.typeLabel,
    visible: opts.visible,
    focused: false,
    badges: opts.badges,
    props: opts.props,
    raw: opts.raw,
  };
}

function parseActivityDump(input) {
  const lines = dumpLines(input);
  const span = actSection(lines);
  if (!span) return finaliseScene('activity', [], [], {});
  const { start: from, end: to } = span;

  const nodes = [];
  const byIdHash = new Map();
  const displayBlocks = [];
  /* What is open above the line being read, deepest last: a head at a given
     indent closes everything indented as deep or deeper. */
  const stack = [];
  let displayId = null;

  for (let i = from; i < to; i++) {
    const line = lines[i];
    /* Indentation closes what it is shallower than, and the line that does the
       closing need not be a head of its own. A section follows a display's
       tasks with the window manager's hierarchy, whose headings sit at the
       depth of the tasks above them; a reader that only unwound on heads would
       hang everything under that heading off the last task of the list. */
    if (line.trim()) {
      const at = indentOf(line);
      while (stack.length && stack[stack.length - 1].indent >= at) stack.pop();
    }

    const dm = line.match(ACT_DISPLAY_HEAD);
    if (dm) {
      displayId = +dm[1];
      stack.length = 0;
      if (!displayBlocks.some((d) => d.id === displayId)) {
        displayBlocks.push({ id: displayId, name: null, size: null, insets: [], raw: '',
                             resumedHash: null, at: i + 1 });
      }
      continue;
    }

    const rm = line.match(ACT_RESUMED);
    if (rm && indentOf(line) <= 2) {
      const d = displayBlocks.find((x) => x.id === displayId);
      if (d && !d.resumedHash) d.resumedHash = rm[1];
      continue;
    }

    const m = line.match(ACT_HEAD);
    if (!m) continue;

    const indent = m[1].length;
    const kind = m[2];
    const idHash = m[3];
    const rest = m[4].trim();
    const { text: raw } = takeBlock(lines, i, indent);
    /* A node's own fields are what it printed before its first child. Reading
       the whole block instead would hand a task its activity's state. */
    const rawLines = raw.split('\n');
    let stop = rawLines.length;
    for (let k = 1; k < rawLines.length; k++) {
      if (ACT_HEAD.test(rawLines[k])) { stop = k; break; }
    }
    const body = `${rest}\n${rawLines.slice(1, stop).join('\n')}`;

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : null;
    /* A dump that names no display at all — a fragment somebody pasted — is
       still one display's worth of tree. */
    if (displayId === null) {
      displayId = 0;
      displayBlocks.push({ id: 0, name: null, size: null, insets: [], raw: '',
                           resumedHash: null, at: i + 1 });
    }
    const ancestors = parent ? [...parent.ancestors, { hash: parent.hash, title: parent.title }] : [];
    /* Which tree this node is in: the root task it hangs under, by the order
       that root was printed in. */
    const rootIndex = parent ? parent.rootIndex : nodes.length;
    const shared = {
      hash: `act:${i}`, idHash, displayId, at: i + 1,
      depth: stack.length, rootIndex, parentHash: parent ? parent.hash : null, ancestors,
      frame: actBounds(body), frameSource: 'bounds',
      raw,
    };

    let node;
    if (kind === 'ActivityRecord') {
      const head = rest.match(ACT_REC_HEAD);
      const component = head ? head[2] : rest;
      const state = actField(body, 'state');
      const finishing = actBool(body, 'finishing');
      const visible = actBool(body, 'mVisible');
      const requested = actBool(body, 'mVisibleRequested');
      node = actNode('activity', {
        ...shared,
        title: shortComponent(component),
        family: 'act-activity',
        typeLabel: 'activity',
        visible: visible === null ? (requested === null ? actBool(body, 'nowVisible') : requested) : visible,
        badges: [
          ...(finishing ? [['finishing', 'badge-exit']] : []),
          ...(state === 'RESUMED' ? [['resumed', 'badge-focus']]
            : state ? [[state.toLowerCase(), 'badge-comp']] : []),
          ...(actBool(body, 'occludesParent') === false ? [['see-through', 'badge-comp']] : []),
        ],
        props: {
          component,
          userId: head && head[1] !== undefined ? +head[1] : null,
          taskId: head && head[3] !== undefined ? +head[3] : null,
          state,
          finishing,
          package: actField(body, 'packageName'),
          process: actField(body, 'processName'),
          app: actField(body, 'app'),
          launchedFrom: actField(body, 'launchedFromPackage'),
          launchedFromUid: actField(body, 'launchedFromUid'),
          activityType: actField(body, 'mActivityType'),
          resizeMode: actField(body, 'resizeMode'),
          launchMode: actField(body, 'launchMode'),
          occludesParent: actBool(body, 'occludesParent'),
          visibleRequested: requested,
          nowVisible: actBool(body, 'nowVisible'),
          lastVisible: actField(body, 'lastVisibleTime'),
          intent: (body.match(/^\s*Intent \{ (.+?) \}\s*$/m) || [])[1] || null,
        },
      });
    } else if (kind === 'TaskFragment') {
      node = actNode('fragment', {
        ...shared,
        title: `fragment ${idHash}`,
        family: 'act-fragment',
        typeLabel: 'fragment',
        visible: actBool(body, 'isVisible'),
        badges: actBool(body, 'isEmbedded') ? [['embedded', 'badge-comp']] : [],
        props: {
          mode: actField(rest, 'mode'),
          embedded: actBool(body, 'isEmbedded'),
        },
      });
    } else {
      const head = actTaskHead(rest);
      const mode = head.mode || actField(body, 'mWindowingMode');
      node = actNode('task', {
        ...shared,
        title: `task #${head.taskId === null ? '?' : head.taskId}`
             + (actTaskName(head, body) ? ` · ${actTaskName(head, body)}` : ''),
        family: ACT_FAMILIES[head.type] || 'act-task',
        typeLabel: 'task',
        visible: head.visible === null ? head.visibleRequested : head.visible,
        badges: [
          ...(mode && mode !== 'fullscreen' ? [[mode, 'badge-comp']] : []),
          ...(head.childCount === 0 ? [['empty', 'badge-exit']] : []),
        ],
        props: {
          taskId: head.taskId,
          type: head.type,
          mode,
          affinity: head.affinity || actField(body, 'affinity'),
          component: actField(body, 'mActivityComponent'),
          userId: head.userId === null ? (actField(body, 'userId') === null ? null : +actField(body, 'userId')) : head.userId,
          uid: actField(body, 'effectiveUid'),
          visibleRequested: head.visibleRequested,
          translucent: head.translucent,
          childCount: head.childCount,
          organized: actBool(body, 'mCreatedByOrganizer'),
          resizeMode: actField(body, 'mResizeMode'),
          resizeable: actBool(body, 'isResizeable'),
          everVisible: actBool(body, 'mHasBeenVisible'),
          inRecents: actBool(body, 'inRecents'),
          lockTask: actField(body, 'mLockTaskAuth'),
          intent: actField(body, 'intent'),
          calledBy: actField(body, 'mCallingPackage'),
          resumedHash: (body.match(/(?:topResumedActivity|mResumedActivity)[:=]\s*ActivityRecord\{([0-9a-fA-F]+)/) || [])[1] || null,
        },
      });
    }

    if (!byIdHash.has(idHash)) byIdHash.set(idHash, node);
    nodes.push(node);
    stack.push({ indent, node });
  }

  if (!nodes.length) return finaliseScene('activity', [], [], {});

  /* The same tree, printed twice. A section states each display's tasks top to
     bottom, and then the window manager's own hierarchy — `Task display areas
     in top down Z order` — states them again, the second copy carrying the
     bounds and the activities the first one leaves out. They are the same
     objects said twice, and an object says which it is: the identity hash in
     its brace. So a tree every one of whose objects turns up in another tree
     is the copy to drop, and where two copies hold exactly the same objects
     the later one is the fuller. A tree holding anything of its own is nobody
     else's copy and stays, which is what keeps this from eating a display
     whose tasks the dump really did print once. */
  const trees = new Map();
  for (const n of nodes) {
    if (!trees.has(n.rootIndex)) trees.set(n.rootIndex, { hashes: new Set(), nodes: [] });
    const t = trees.get(n.rootIndex);
    t.hashes.add(n.idHash);
    t.nodes.push(n);
  }
  const grown = [...trees.values()];
  const inside = (a, b) => [...a.hashes].every((h) => b.hashes.has(h));
  const copies = new Set();
  for (let a = 0; a < grown.length; a++) {
    for (let b = 0; b < grown.length; b++) {
      if (a === b || !inside(grown[a], grown[b])) continue;
      if (grown[a].hashes.size < grown[b].hashes.size || b > a) { copies.add(a); break; }
    }
  }
  if (copies.size) {
    const gone = new Set();
    for (const a of copies) for (const n of grown[a].nodes) gone.add(n);
    const kept = nodes.filter((n) => !gone.has(n));
    nodes.length = 0;
    for (const n of kept) nodes.push(n);
    byIdHash.clear();
    for (const n of nodes) if (!byIdHash.has(n.idHash)) byIdHash.set(n.idHash, n);
  }

  /* Front to back is the order the dump printed in — the first task on a
     display is the one on top — and inside a task the nesting decides it: an
     activity is drawn over the task that holds it, and a task printed inside
     another is over that one. So a whole tree sits in front of the tree
     printed after it, and within a tree the deeper node wins. */
  nodes.forEach((n, i) => { n.z = -n.rootIndex * 1e6 + n.depth * 1e3 - i; });

  const byId = buildDisplays(displayBlocks, nodes, null);

  /* A container that printed no bounds of its own fills what holds it, and a
     root that printed none fills the display. Parents are filled before their
     children, which is what lets an activity two levels down inherit. */
  const byHash = new Map(nodes.map((n) => [n.hash, n]));
  for (const n of nodes) {
    if (n.frame) continue;
    const parent = n.parentHash ? byHash.get(n.parentHash) : null;
    if (parent && parent.frame) {
      n.frame = parent.frame;
      n.frameSource = 'parent bounds';
      continue;
    }
    const d = byId.get(n.displayId);
    if (d && d.size) {
      n.frame = { l: 0, t: 0, r: d.size.w, b: d.size.h };
      n.frameSource = 'fills display';
    }
  }

  const text = lines.slice(from, to).join('\n');
  const one = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const globals = {
    currentUser: one(/^\s*mCurrentUser=(-?\d+)/m),
    topDisplay: one(/\bmTopFocusedDisplayId=(-?\d+)/),
    focusedApp: one(/^\s*mFocusedApp=(.+)$/m),
    lastPaused: one(/^\s*mLastPausedActivity:?\s*=?\s*(.+)$/m),
    homeProcess: one(/^\s*mHomeProcess=(.+)$/m),
    sleeping: one(/^\s*mSleeping=(\S+)/m),
    tasks: nodes.filter((n) => n.kind === 'task').length,
    fragments: nodes.filter((n) => n.kind === 'fragment').length,
    activities: nodes.filter((n) => n.kind === 'activity').length,
    config: one(/^\s*mGlobalConfiguration=(.+)$/m),
    lines: to - from,
  };

  /* The activity the manager has resumed, per display and for the device. A
     display states its own; the focused app names the one the rest of the
     framework is pointed at, and is what a window dump's focus should agree
     with. */
  const focusHash = globals.focusedApp
    ? (globals.focusedApp.match(/ActivityRecord\{([0-9a-fA-F]+)/) || [])[1] : null;
  for (const n of nodes) n.focused = focusHash !== null && n.idHash === focusHash;

  for (const d of byId.values()) {
    const resumed = d.resumedHash ? byIdHash.get(d.resumedHash) : null;
    d.resumed = resumed || null;
    const on = nodes.filter((n) => n.displayId === d.id);
    d.meta = {
      tasks: on.filter((n) => n.kind === 'task').length,
      activities: on.filter((n) => n.kind === 'activity').length,
      resumed: resumed ? resumed.title : (d.resumedHash || null),
    };
  }

  for (const n of nodes) {
    n.search = `${n.title} ${n.idHash} ${Object.values(n.props)
      .filter((v) => v !== null && v !== undefined && typeof v !== 'object')
      .join(' ')}`.toLowerCase();
  }

  return finaliseScene('activity', [...byId.values()], nodes, globals);
}
