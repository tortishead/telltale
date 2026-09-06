# Telltale

What the device says about itself.

Telltale reads the text dumps an Android device prints about itself. It draws the
screen ones to scale — frames, stacking order, flags, visibility — and lists
the ones with no geometry in them. It reads `dumpsys window`, `dumpsys
SurfaceFlinger`, `dumpsys package` and ART thread dumps (`/data/anr/traces.txt`)
today, and it is one static HTML file with no dependencies and no build step.
The dump is never uploaded anywhere — the only request Telltale ever makes is
fetching a dump you point it at by URL.

## Use it

```
adb shell dumpsys window windows   > windows.txt
adb shell dumpsys SurfaceFlinger   > sf.txt
adb shell dumpsys package          > packages.txt
adb pull /data/anr/traces.txt
```

Open the page and drop the file in, paste the text, or pick it with the file
dialog. A full bugreport works too: every parser gets a look at whatever you
load, and each one that recognises something keeps its result, so a bugreport
opens with a **switch in the top bar** between the window stack and the
SurfaceFlinger layers. The switch only appears when there is more than one
thing to switch to.

More than one dump can be open at a time. Each one you load gets a **tab**
under the top bar, so the windows off one device sit beside the layers off
another, or last week's dump beside today's. **Load another dump** and the
**+** on the tab strip go to the loader without disturbing what is open;
`Esc` or a click on a tab comes back. Dropping several files at once opens one
tab each. `Alt`+`1`…`9` picks a tab, `Alt`+`0` the last one, and a tab closes
on its `×` or a middle click.

Each tab keeps its own place: which section of a bugreport it is showing, the
display, the filter, the selection, the pose of the Z-order view. Switching
away and back puts all of it back the way it was.

It also reads a dump straight off a URL: use **Fetch a URL**, paste a bare URL
into the page, or link to it directly. `?tool=` says which section to open, and
`?url=` given more than once opens a tab per dump, in the order the link names
them.

```
https://your-host/telltale/?url=https://your-host/dumps/bugreport.txt&tool=sf
https://your-host/telltale/?url=/dumps/before.txt&url=/dumps/after.txt
```

`?tool=` takes `window`, `sf`, `package` or `anr`.

The fetch runs in the browser without credentials, so a cross-origin dump has to
send `Access-Control-Allow-Origin`. Same-origin files — a dump sitting next to
`index.html` — always work.

## Host it

Copy `index.html` into the root of a repository, then enable GitHub Pages
(Settings → Pages → deploy from branch). That is the whole deployment. It also
works from `file://` if you just want to open it locally.

## What it shows

A dump with geometry in it gets three panes, because the two Telltale draws are
the same shape underneath: things that sit on a display, carry a frame and
stack in a z order. `dumpsys window` calls them windows and SurfaceFlinger
calls them layers; the drawing does not care. A dump with no geometry —
`dumpsys package`, an ANR trace — keeps the same three panes and changes what
is in them: **the groups it splits on go down the left**, one row per Android
user or per process; **the tree takes the middle**, where the sheet would have
been; the details stay on the right. There is nothing honest to draw, so the
room the sheet would have had goes to the thing that is actually being read.
See [Dumps with nothing to draw](#dumps-with-nothing-to-draw) and
[ANR traces](#anr-traces).

- **Stack** — everything on the display, topmost first. Each row leads with
  the badges that apply — a green **v** for visible, then focus, exiting, how
  a layer was composited — then the name, then its type, size and place in the z order. Filter by name,
  package, type or hash; the filter always searches the whole dump, whatever
  **show** is set to. Where a dump says what is parented to what, the pane is
  a **tree**: siblings stay in z order, and the layers a result hangs from are
  shown above it in italic as context rather than as results of their own. A
  window dump has no hierarchy to show, so it stays a flat list.

  A row with anything under it carries a **twisty**: click it to shut the row,
  and what it was holding goes away with it, counted on the row as `N hidden`.
  **expand all** and **collapse all** sit beside **show** and appear only when
  there is a tree to work. The arrow keys work it the way a tree is usually
  worked — `→` opens a shut row and then steps into it, `←` shuts an open one
  and then steps out to its parent, `↑` and `↓` move between the rows on screen.
  Collapsing changes the list and nothing else: the sheet still draws what
  **show** says it draws, because a layer does not stop being on the display
  because you stopped looking at its parent.

  What is shut is per tab, and it gets out of the way when it would hide an
  answer. **A filter opens the tree** — it searches the whole dump, so it has
  to be able to show what a shut row was holding — and clearing the filter puts
  back what you had shut. Selecting something inside a shut row — from the
  ancestry in the details pane, or a lock badge naming another thread — opens
  what it takes to show it.
- **Plan** — the display drawn to scale, looking straight down. Rects are
  filled and outlined by type; invisible ones are dashed. Things that share a
  type are separated by shade, so the type is still legible as a colour family
  while no two rects look alike. The legend under the sheet names every type
  that is drawn and carries one swatch each — click a swatch to select it. It
  follows the sheet rather than the stack, so a layer with no frame of its own
  has no swatch: there would be nothing on the sheet for it to point at.
  Selecting one marks it in red with dimension leaders for its offset, width
  and height.
- **Z-order** — the same drawing exploded along a depth axis, Winscope style,
  and what a dump opens on: each rect is pushed back by its place in the stack
  and the pile is rotated so you can see the order. **Plan** is one click away
  and so is the pose that collapses back into it. **Drag the sheet to orbit it** — sideways to turn, up
  and down to tilt — or use the **turn** and **tilt** sliders, which follow the
  drag. With both at 0 the view collapses back into the plan. **spread** sets
  how far apart the layers sit, and **Reset view** puts all three back. Each
  rect gets a numbered label — 1 is topmost — with a leader to it; click either
  the rect or its name to select. A press that does not travel picks rather
  than turns, so a slightly unsteady click still selects.

The three panes are resizable: drag the divider between them, double-click it
to go back to the default, or focus it and use the arrow keys. Going back to
the default hands the width to the stylesheet rather than to a number in the
script, because the default is not one number: the stack and detail panes are
wider above 1200px than below it, where giving them the room would leave the
sheet with less than it needs.

**show** — `with a frame`, `visible`, `all` — is what keeps a long dump
readable. A SurfaceFlinger dump is mostly scaffolding: of 140 layers on a car
head unit, eight put pixels anywhere and the other 132 are display areas,
tasks, activity records, window tokens and animation leashes holding them up.
Not one of those 132 holds a buffer, which is the point — they have no size of
their own and exist to position, crop and order their children.

The first two settings are not degrees of the same thing. `with a frame` is
whatever Telltale worked out a rect for, which is what the sheet can put
somewhere; it says nothing about whether the layer reached the screen, and a
layer with its `HIDDEN` flag set still qualifies and is drawn dashed.
`visible` is what the dump says did reach the screen, container layers with no
geometry of their own included. A layer can be either without the other. `all`
is the dump as it stands.

The sheet follows the same setting and the footer says how many are not
listed. Each dump opens on the one that suits it — `with a frame` for
SurfaceFlinger, `all` for windows, where nearly every entry is a real window
already.

Nothing is lost by hiding it. Whatever is listed brings its ancestry with it,
so the shape is still there — the five drawn layers of that car head unit come
with the twenty-five that hold them, and it is those that show one bar sitting
under an animation leash while another sits under a task. The filter searches
everything regardless, the **Ancestry** block in the details pane walks the
chain a step at a time, and a layer reached that way is pinned onto the stack
so the selection is never invisible.

The **details** pane is the one place each dump speaks for itself.

- From `dumpsys window`: identity, geometry (every rect found in the block, not
  just the frame), stacking, state, attributes and the raw text block. With
  nothing selected it shows the **display** instead — size in px and dp,
  density, app area and size range, rotation, cutout insets, orientation and ui
  mode, every insets source the display publishes, what has focus and what the
  IME is targeting, and a window count.
- From `dumpsys SurfaceFlinger`: identity and parent, geometry (frame, pos,
  size, crop, bounds, source crop, visible region, transform, corner radius),
  stacking, composition (how the composer handled it, the active buffer,
  dataspace, pixel format, blur and shadow) and appearance (alpha, colour,
  opacity, flags). With nothing selected it shows the **display** — its layer
  stack, size, rotation, power mode, and a tally of how its layers were
  composited, which is where a pile of `CLIENT` gives away GPU fallback.

Hover a flag chip — or tab to it — for the official text: the constant it
stands for, its value, its documentation and any deprecation note. Window flags
resolve against `WindowManager.LayoutParams`, layer flags against
`layer_state_t`.

The picker above the sheet carries each display's size, density and count.
Multi-display dumps get one entry per display, which is the common case on
automotive targets with an IVI and a cluster. A dump with no sheet has no sheet
to sit above, so its picker **is the left pane**: one row per group, name over
count, the open one marked, headed with how many there are and scrolling on its
own. A row of chips is fine for the two displays a phone dump has and falls
apart at the twenty processes a bugreport brings. Drag the left gutter to give
the names more room. SurfaceFlinger keys its displays on the layer stack, which
is what its layers carry.

Telltale follows the system's light or dark setting. The button in the top bar
cycles **system → light → dark** and remembers the choice, per browser. The
drawing itself does not change with the theme: the sheet stays paper and the
type colours stay put, so a screenshot of a plan reads the same either way.

## Dumps with nothing to draw

`dumpsys package` has no geometry in it at all: a package does not sit
anywhere. Rather than invent a rect for it, the tool is registered as a **list**
— the sheet, the legend and the z-order view give up the middle pane, the list
of packages takes it, and the groups they split into take the left.

What it does have is the same shape underneath — named things, grouped, each
read out of a block of text — so it hands back the same scene as the others
with the frame left null. Two things move:

- **The group is the Android user**, not a display, and the left pane is the
  list of them. That is the axis a package dump really splits on: a
  work profile has its own set installed, its own grants and its own enabled
  state, so the same package is a different row under each user, and one that
  only user 10 has is only listed there.
- **`sharedUser` is the parent.** A uid shared between packages is the one
  piece of hierarchy a package dump has, so the list draws it as a tree using
  the same code the SurfaceFlinger view uses, and you can see at a glance what
  runs as `android.uid.system`. A uid one package has to itself is not a group
  and stays flat. The row is Telltale's, not the dump's — `dumpsys package`
  describes the uid separately, under `Shared users` — so it carries no raw
  block.

**show** changes with it: `with a frame` and `visible` mean nothing here, and
what buries a package dump is the system image, so the settings are
`third-party`, `installed` and `all`. It opens on `third-party`, which on a
real device is eighty rows out of four hundred. `installed` sits between the
two because a dump lists packages the user in question does not have.

There is no green **v** here. It earns its place on a screen dump, where most
of what is listed never reached the display; nearly every package is installed
and enabled, so a v on nearly every row would say nothing. The exceptions carry
their own badges — `not installed`, `disabled`, `suspended`, `stopped`, and
`shadowed` for the system build of a package an update has replaced, alongside
`debuggable` and `test-only` — and the row still dims, which is the same signal
the other dumps give.

The filter searches the permissions as well as the name, path, uid and
installer, because *who asked for CAMERA* is the question a package dump gets
opened for more than any other.

The details pane leads with identity and version, then **what this user sees** —
installed, enabled, hidden, suspended, stopped, gids, how many components are
turned off — then the flags, then the permissions in the order they are worth
reading: **runtime** grants first, with the grant flags beside each, then
**install** permissions, then what the manifest **requested** and did not get,
then what it **declares** for others.

## ANR traces

An ANR trace is the second dump with nothing to draw, and the one where the
question is not *what does the screen look like* but *what is the main thread
waiting for*. `/data/anr/traces.txt`, an `anr_2026-…` file, or the `VM TRACES`
sections of a bugreport all open the same way — drop the file in, and the tool
that recognises it takes the tab.

The shape underneath is the same as every other dump — named things, grouped,
each read out of a block of text — so it renders through the same list, the
same filter, the same tree and the same details pane. Two things are its own:

- **The group is the process.** A bugreport carries the ANR'ing app and the
  `system_server` it was talking to, and those never mix; each `----- pid N at
  … -----` block is its own row in the list of processes down the left, labelled
  with the pid, the cmd line and how many of its threads are blocked. A bugreport prints the traces
  twice — `AT LAST ANR` and `JUST NOW` — and the same pid in two blocks is two
  moments, so it stays two groups, told apart by the timestamp on the picker.
- **The parent is the pool.** Binder threads are the reason: a busy process has
  a dozen, `Binder:12345_2`, `binder:12345_1A`, `HwBinder:751_1` and
  pre-Android-8 `Binder_3` are all recognised, each `:pid` is its own pool, and
  executor pools (`pool-5-thread-N`) and numbered workers
  (`RxCachedThreadScheduler-N`, `DefaultDispatcher-worker-N`) group the same
  way. Two members is enough. The row carries the member count, the state
  histogram and what the pool is mostly doing, which is usually the whole of
  what it has to say. A member is pulled out and listed on its own when it is
  part of the answer — it holds a monitor somebody is queued on, or it sits on
  the chain main is blocked behind. Threads that are merely *waiting* stay
  inside on purpose: twelve binder threads queued on one lock is one fact, and
  `12 Blocked` on the group row says it better than twelve rows do. A pool
  opens **shut**: the count, the states and what it is mostly doing are usually
  the whole of what a healthy one has to say, and its twisty opens it.

**show** changes with it. `with a frame` and `visible` mean nothing here, and
what buries an ANR dump is the two hundred healthy threads around the handful
in the answer, so the settings are `blocking`, `active` and `all`. It opens on
`blocking`: main, the chain main is waiting behind, any deadlock cycle, and
anything holding or queued on a monitor. `active` drops the threads with no app
frames, no monitor of their own and nothing waiting on them — a pool worker
parked on its queue. Those rows still dim under `all`, which is the same signal
the other dumps give.

Rows are ordered by relevance rather than by tid: **main first, then the
threads it is waiting behind in the order it waits through them**, then
everything else blocked, then the rest. The row's colour is the ART state it
was caught in, and the badges are what is worth knowing at a glance — `main`,
`deadlock`, `blocks main`, `blocked`, `holds · N waiting`.

With nothing selected the details pane is the **process**: its identity, the
findings, the chain from main step by step with the monitor named at each step,
and a tally of thread states.

Selecting a thread gives its scheduler state, its monitors and its **call
stack, leaf first**. The app's own frames are at full strength — matched
against the package from `Cmd line:` — the framework is dim, native frames are
teal, and the frame the thread is actually executing carries an amber underline.
Runs of framework frames with nothing attached to them fold into one row: a
60-frame stack is mostly `ZygoteInit` and `ActivityThread`, and the three or
four frames that are the app's are what the pane is for. The fold is a
`<details>`, so it opens without script and a print shows what is open.

The monitor annotations are attached to the frames that carry them, and both
kinds are links. **`waiting for 0x…`** is red and names the holder — click it
and the holder's thread is selected, with its own stack and the frame where it
took the lock. **`locked 0x…`** is amber and says how many threads are queued
behind it. Walking the chain is clicking through it.

### What it flags

The findings on the process are the ones an ANR trace is opened to answer, most
serious first:

- **Deadlock** — any cycle in the wait-for graph, named thread by thread.
  Nothing else matters if there is one.
- **Main blocked on a monitor** — who holds it, what state that holder is in
  and what it is currently executing. The holder is where the time is going.
- **A known ANR cause on the main thread** — synchronous Binder IPC, SQLite,
  network, disk I/O, SharedPreferences, GC waits, `Thread.sleep`,
  latches and futures. The rules are ordered most specific first and only the
  first match on a thread is reported, so a Binder call inside SQLite reads as
  one problem rather than two.
- **The same causes on the chain behind main**, one severity lower: heavy work
  on a worker matters when the UI thread is queued behind it and is a worker
  doing its job otherwise.
- **An idle main thread.** If `main` is parked in `MessageQueue.nativePollOnce`
  with nothing of the app's above it, the dump does not contain the cause — a
  message that already finished, CPU starvation from another process, or a
  stuck `system_server`. Saying so beats inventing a root cause out of plumbing
  frames, and it points at the CPU section of the bugreport instead.

## Parsing notes

Android's text dumps have no stability guarantee and drift between releases, so
no parser assumes a schema. They split blocks on indentation, harvest generically
and only special-case the few fields needed in order to draw. Anything else
still shows up in the details pane.

### `dumpsys window`

Known-handled variants:

- `mFrame=[...]` (newer) and the older `Frames: containing= / parent= / display=` block
- Plain `dumpsys window` (no `-a`), whose window blocks carry no frames and no
  layers at all — see below
- Dumps with no `Display:` section — bounds come from `mLogicalSize` if it is
  present, otherwise are inferred from window frames and labelled as inferred
- Display sections whose own lines are indented no deeper than their heading —
  the section is bounded by what starts the next one, not by indentation
- `ty=` printed as a raw int (`ty=2040`) instead of a name
- Multiple displays
- CRLF line endings, negative coordinates, windows positioned off-screen

The frame used for drawing is resolved in this order, and which source won is
shown next to the frame in the details pane:

1. `mFrame`, `frame`, `parent`, `containing`, `display` from the window's own block
2. **window handle** — the `<hash> <title>, frame=[l,t,r,b]` lists printed by
   `AccessibilityWindowsPopulator` and the input window handles. Exact, but only
   present for visible windows.
3. **insets source** — `mSourceFrame` from the `InsetsSourceProvider` that names
   the window. Exact, and covers the system bars.
4. **from attrs** — the requested size from `Requested w= h=` / `mAttrs`, placed
   on the display by the window's gravity. An estimate.
5. **task bounds** — the bounds of the containing task, for activity windows
   with no size of their own. A coarse estimate.

Anything from step 2 down is an estimate, marked with `*` in the stack and
counted as "recovered" in the sheet footer. A window whose requested size is
`0x0` is left undrawn rather than guessed at.

Dumps with no `mBaseLayer` anywhere are stacked by dump order instead —
`dumpsys` prints windows topmost first.

### `dumpsys SurfaceFlinger`

SurfaceFlinger prints the same scene several times over, and which of the lists
a build prints has changed more than once. Telltale reads all of them and joins on
the `Name#id` every one of them carries:

- **the layer list** — `+ BufferStateLayer (Name#3) uid=10046` on older builds,
  `+ Layer (Name#3) uid=10046` or `* Layer 0x… (Name#3)` on newer ones. Carries
  layerStack, z, pos, crop, colour, flags, the regions, the parent and the
  active buffer. Every layer is in it, composited or not.
- **the composition layers** — `* Layer 0x… (Name#3)` under `Composition
  layers`: the compositor's view of each layer — geomLayerBounds, alpha, blend,
  composition type — but no position and no layer stack.
- **the output layers** — `- Output Layer 0x…(Name#3)` nested under each
  display, which is where newer builds keep the geometry that matters:
  `displayFrame`, already in display coordinates, plus the visible region and
  what the composer did with the layer.
- **the HWC table** — under `Display … HWC layers:`, two lines per layer that
  reached the compositor: its z, its window type, how it was composited
  (`DEVICE`, `CLIENT`, `SOLID_COLOR`…) and the frame it was composited into.

A layer's blocks are collected in the order the file prints them and parsed as
one text, so the first block to state a field is the one that wins and a build
that prints only some of the lists still resolves.

The HWC table is read by its own header row, so the four-column layout on older
builds and the newer one with window type and transform both parse. Newer
builds rule off between every entry rather than only at the ends, mark a
relatively-z-ordered layer's z as `rel 0`, and elide the middle of a long name
(`com.foo/com.f[...]Activity#301`) — a name carrying that marker is matched on
its two ends.

The frame used for drawing:

1. **hwc frame** — the `Disp Frame` the composer used.
2. **display frame** — the output layer's `displayFrame`.
3. **screen bounds**, then **bounds** — where a build prints either outright.
4. **pos+size** — the layer's own position and size.
5. **visible region** — the union of the rects in `VisibleRegion` (the layer
   list) or `visibleRegion` (the output layers). Absolute, but clipped to what
   is on screen, so it can be smaller than the layer.
6. **buffer** — the active buffer's size at the layer's origin. An estimate,
   and the only one of these marked as recovered.

`crop`, `sourceCrop` and `geomLayerBounds` are in the layer's own coordinates
rather than the display's — drawing one as a screen rect would put a bottom bar
at the top of the sheet — so they are read and shown in the details pane but
never drawn from. A layer with no size of its own is left undrawn rather than
guessed at, which on a modern dump is most of them: the layer list is mostly
containers, and only the handful that reach the compositor have a rect.

Displays are keyed on the **layer stack**, which is what the layers carry.
Where a layer never names one — the composition list does not print it — the
display is taken from which display's section the layer's block was printed
inside, since the output layers are nested under the display they belong to.
A display's size comes from `displaySpace`, `orientedDisplaySpace` or
`layerStackSpace`, and its name, resolution and power mode are joined on the
composer id from the separate `Displays (N entries)` list.

Stacking follows the order the dump prints, not the `z=` field: the lists are
z-order traversals printed back to front, and `z=` is relative to a layer's
parent, so it does not sort globally. The `z=` value is still shown in the
details pane. A layer is treated as invisible when its `HIDDEN` flag is set,
its alpha is zero, or its visible region is empty.

`parent=` is resolved to the layer it names, and the details pane shows the
whole chain from the display root down. That chain is usually the answer to why
a layer is where it is: an `animation-leash` in the middle of it means
something is moving, and a `WindowToken` or `Task` above it says which part of
the window manager put it there.

Colour and the legend follow the **window type** the HWC table prints, which is
the same number `dumpsys window` prints as `ty=`, so one device reads in one
set of colours whichever dump you are looking at. A layer the table says
nothing about falls back to what it is made of — a buffer, an effect, a
container.

### `dumpsys package`

Read from `Packages:`, `Hidden system packages:` and `Renamed packages:`.
Everything under `Activity Resolver Table:`, `Queries:`, `Permissions:` and
`Shared users:` is skipped — those describe the same packages from another
angle and none of it is needed to list them.

Column zero does not reliably start a new section, which matters more than it
sounds. `dumpsys package` prints one package's overlay paths through a printer
that has lost its indent, so a line like

```
com.android.oem.tokens overlay paths:
```

lands at column zero in the middle of `Packages:` — on an emulator, hundreds
of blocks before the end of it. Taking that for the end of the section drops
every package after it, and taking it for the end of the block it interrupts
costs that package its gids and its runtime grants. What separates the two is
capitalisation: every heading dumpsys prints is capitalised and a Java package
name is not. A stray line also carries its own deeper-indented lines, which is
checked as well, so a real heading has to fail both tests before it is taken
for a package name.

Known-handled variants:

- `sharedUser=SharedUserSetting{... name/uid}` (newer), `sharedUser=[name]` and
  `sharedUserId=name` (older)
- `pkgFlags=`/`privatePkgFlags=` (newer) and `flags=`/`privateFlags=` (older)
- `grantedPermissions:` (pre-M), where being in the list is the grant, read as
  install permissions
- Dumps with no `User N:` block at all, taken as user 0 — which is what a
  single-user device prints
- `enabled=` as the `COMPONENT_ENABLED_STATE_*` int or as the name
- A package printed twice, once under `Packages:` and once under `Hidden system
  packages:`, which are two rows and not one

A package's kind — what picks its colour and what `third-party` filters on — is
taken from the flags first and the code path second: `/apex/` is apex,
`PRIVILEGED` or `/priv-app/` is privileged, `UPDATED_SYSTEM_APP` is an updated
system app, `SYSTEM` or a path under `/system`, `/system_ext`, `/product`,
`/vendor` or `/odm` is system, and what is left is third-party.

### ANR traces

ART thread dumps drift like everything else here, so the parser reads what it
recognises and keeps the rest as the raw block. Known-handled variants:

- `"name" prio=5 tid=1 Blocked` headers, with or without `daemon`
- `"kworker/u16:3" sysTid=289` — a thread that never attached to the runtime,
  which has a sysTid and a state and no tid at all
- Java frames, `native: #00 pc … /path/lib.so (symbol+8)` frames and
  `kernel:` frames
- `- locked`, `- waiting to lock`, `- waiting on` and `- sleeping on`, with the
  holder as `held by thread 12`, `held by tid=12` or `held by tid=12 (Worker-3)`
- `- waiting to lock an unknown object`, which is a monitor with no address
- The `|` scheduler lines: `sysTid`, `nice`, `state`, `utm`, `stm`, `core`,
  `sCount`, `group` and `schedstat`
- A whole bugreport, several processes, and the same pid printed twice
- A bare `traces.txt` with no `----- pid N -----` header at all, which becomes
  one group labelled as having no pid rather than one with a made-up number

The wait-for graph has one edge per `waiting to lock` that names a holder, or
whose address another thread printed a `locked` line for — which one it was is
shown in the details pane, since an inferred holder is a guess about a monitor
two threads both touched. `waiting on <addr>` — `Object.wait()` — is
deliberately **not** an edge: the thread released the monitor and is parked
until `notify()`, so whoever holds it now is not what blocks it. It is still
listed under the thread's monitors, where it says so.

The trace analysis follows [anrlyze](https://github.com/tortishead/anrlyze),
which is the same idea as its own page; here it is a fourth tool in Telltale
rather than a second site.

## The flag table

The text behind the window flag chips is generated, not typed.
`tools/flag-docs.py` reads `WindowManager.java` from `android.googlesource.com`
— `main` first, then the release branches back to `android10` — takes the
javadoc of every `FLAG_*`, `PRIVATE_FLAG_*` and `SYSTEM_FLAG_*` constant, keys
it by the name the `ViewDebug` tables make `dumpsys` print, and rewrites the
block between the markers in `index.html`.

```
python3 tools/flag-docs.py           # rewrite the table in place
python3 tools/flag-docs.py --check   # exit 1 if it is out of date
```

The oldest branch is read last and never overwrites a newer entry, so a name
that main has since deleted still resolves for dumps off old builds. To reach
further back, add a branch to `BRANCHES`. The one case a javadoc cannot state
honestly — `LOCAL_FOCUS_MODE`, which the `ViewDebug` table prints for two
different flags — is written by hand in `OVERRIDES` at the top of the script.

The `layer_state_t` bits behind the SurfaceFlinger flag chips are short enough
to be written by hand, in `SF_FLAG_DOCS`. A bit with no name in that table is
kept as a hex chip rather than dropped, so a flag from a newer build still
shows up.

The generated table lives inline. Telltale stays one file with nothing to fetch and
nothing to build; the script is a maintenance tool, not a dependency.

## Adding a dump

The page is four layers — parse, state, render, events — and only the first and
a little of the third know what kind of dump is open. A parser turns text into
a **scene**: displays, plus nodes carrying `hash`, `title`, `displayId`,
`frame`, `frameSource`, `z`, `family`, `typeLabel`, `search`, `badges` and
`raw`. `buildDisplays` and `finaliseScene` do the parts that are the same every
time — synthesising displays a dump never described, sorting into z order,
handing out the shades that keep one family's nodes apart.

Adding a dump means an entry in `TOOLS` with a `detect` that scores how much
the text looks like it, a `parse`, and the two functions that render its
details pane. Nothing else on the page knows how many kinds there are.

A list tool's panes are the drawing tool's panes with different things in
them: `syncUi` moves the controls and the node list into the middle pane and
leaves the left one to the group picker, so there is one set of elements and
one set of handlers whichever kind of dump is open. `groupNouns` names the
plural where adding an `s` does not do it — `process`, `processes`.

A tool whose rows are worth hiding until they are asked for says so with
`startCollapsed`, a predicate over its nodes. The rest of the tree — the
twisties, the arrow keys, what a filter overrides — is the same for every tool
with a `parentHash` to hang rows from.

A dump with no geometry adds `layout:'list'` and, because the words on the
page stop being about displays and rects, four more fields: `groupNoun` for
what the picker picks, `shows` for its own set of **show** settings, `rowMeta`
for the line under each row — size and z rank only for a dump that has them —
and `visBadge:false` where a green **v** on nearly every row would say nothing.
A group can also carry a `label`, for a group whose id is Telltale's own key
rather than a number the dump printed, and a tool with something to say about
its groups adds `groupBadges` — what an ANR trace badges each process with, so
which one to open is a question the left pane answers. Everything else — the filter, the tree,
the badges, the selection, the tabs, the details pane — is already the tool's
or already the same for all of them.

The panes stay one page and one file. `index.html` opens from `file://` as
well as over HTTP, which splitting the script into ES modules would break —
modules are fetched, and `file://` refuses cross-origin fetches — so a split
would mean a bundler and a build step to get back what the page has now.
Sections in the file do the job instead: parse, state, render, events, in that
order, with a comment at each boundary.

## Tests

```
node --test 'tests/**/*.test.mjs'
```

Node 18 or newer, and nothing else — no install, no build, no dependencies.
The page still ships as one file; the tests are a development tool the way
`tools/flag-docs.py` is a maintenance one, and nothing under `tests/` or
`tools/` is fetched by `index.html`.

`tools/parse-layer.mjs` reads `index.html` itself, slices out everything above
the `state and shared helpers` heading and evaluates it. That works because the
parse layer touches no DOM and no state — text in, scene out — so it runs as-is
under node. It also means the layering is checked rather than merely asserted:
if a parser starts reaching forward into a later layer, the slice stops
evaluating and the tests fail naming what it reached for.

There are two kinds of test. `tests/parsers.test.mjs` states the behaviour a
parser is supposed to have, one claim at a time, and covers the cases the
source comments call out as ones a build has already broken — gravity that
prints as one word, the column-zero line in the middle of `Packages:`, a flag
from a build newer than the table. `tests/golden.test.mjs` runs every fixture
through its parser and compares a digest of the scene to a file under
`tests/golden`, which catches drift nobody thought to assert on. The digest is
text rather than JSON so a diff is readable — and because an ANR scene holds a
wait-for graph with cycles in it and does not serialise.

When a golden changes on purpose, read the diff, satisfy yourself it is the
change you made, then rewrite them:

```
UPDATE_GOLDEN=1 node --test 'tests/**/*.test.mjs'
```

The fixtures are `sample.txt` beside `index.html` and the two in
`tests/fixtures`. They cover the window, package and ANR parsers;
`parseSurfaceFlingerDump` has no fixture and no coverage beyond its flag
decoding. All of them are written rather than captured, so they say what a dump
looks like in the shape the parsers were built against — a real dump off a
device is worth more for catching what `dumpsys` actually prints. To add
either, drop the file in `tests/fixtures`, add it to `CASES` in
`golden.test.mjs`, and run with `UPDATE_GOLDEN=1` to record it.

## Limits

Telltale reads the **text** dumps only. If you can get proto output
(`dumpsys window --proto`, `dumpsys SurfaceFlinger --proto`) or a Perfetto
trace, Winscope will give you more — real hierarchy and time. Telltale is for the
cases where all you have is a text dump from a field log, a bugreport or a
vendor.

The window view shows the window frame, not the surface: scaling, transforms
and cropping applied at the SurfaceFlinger layer are not reflected there. The
SurfaceFlinger view shows the rects flat — a layer's transform is reported but
not applied to the drawing, so a rotated or scaled layer is drawn as the rect
it would occupy unrotated.

An ANR trace is one moment, and nothing in it is a timeline: a thread caught in
`nativePollOnce` had nothing to do when the dump was taken, not necessarily
when the ANR fired. The CPU usage section of a bugreport is not parsed, so an
idle main thread still sends you back to the bugreport to find what starved it.

## License

MIT.
