# Telltale

What the device says about itself.

Telltale is a browser toolkit for reading what an Android device reports about
itself. Drop something in and it works out what it is holding, then draws it,
lists it, or lays it out to be read.

One static HTML file. No dependencies, no build step, no server. What you load
never leaves your browser.

## Use it

Open `index.html`. Drop a file in, paste text, pick one with the file dialog,
or point it at a URL.

| Take it with | Reads | `?tool=` | Shows |
| --- | --- | --- | --- |
| `adb shell dumpsys window windows` | windows | `window` | Every window drawn to scale on its display, in z order, with frames, flags and visibility. A window that printed no frame is placed from its gravity and size. |
| `adb shell dumpsys SurfaceFlinger` | layers | `sf` | Every layer drawn to scale on its display, as a tree, with its regions, composition type and the row the hardware composer gave it. |
| `adb shell dumpsys package` | packages | `package` | Every package, grouped by Android user, with its flags, paths, permissions and the uid it shares. Opens on third-party. |
| `adb pull /data/anr/traces.txt` | threads | `anr` | Every thread, grouped by process, with what blocks main, deadlocks and thread pools. Opens on the threads that block. |
| `adb shell dumpsys user` | users | `user` | Every user on the device, with its type, state, flags and what it is barred from, and which one is current. The types a user can be, and the packages allowlisted for each of them, are in there too. |
| `adb shell dumpsys car_service` | sections | `car` | Every service the car stack dumped, as the tree of sections it printed, and which of them threw on the way out. Picking one lists what it printed in the middle pane — a name, its value, and whatever it printed under that — with its own search over it, and a run of lines written to one shape laid out in columns instead. Picking a line reads it on the right. Property ids are named from the two tables the dump names them in. |
| `adb shell dumpsys input` | input windows | `input` | Every window the input dispatcher will consider on its display, drawn to scale in the order it walks them, with the part of each one that actually takes touch drawn inside its frame where the two differ. Says which window has focus, which one a touch is going to right now, and — the question this dump gets opened with — which windows are covered by another window's touch area or are dropping their input because something untrusted is over them. Opens on the windows that take touch. |
| `adb shell dumpsys input` | input devices | `inputdev` | Every device the reader found, grouped by the display it drives, with what the kernel says it is and what Android made of that: its sources, its axes and their ranges, the key layout and IDC files configuring it, and the mappers the reader gave it. |
| `adb shell dumpsys binder_calls_stats` | calls | `binder` | Every binder call the system server handled, grouped by the Android user the caller ran as, then by the caller, then by the method it called — with the cpu it cost, its share of the total, the worst latency, the largest reply, and how many of the calls came back with an exception instead. Says whether the dump was worth taking: it records nothing while the device is charging, and samples one call in a thousand unless told not to. |
| `adb logcat -d`, or any bugreport | log lines | `logcat` | A log reader: every line, in the order it was printed, in the columns logcat prints them in — time, pid-tid, level, tag, message — coloured by level. Every log the bugreport carries is its own group (system, events, radio, crash, kernel). The level buttons are `*:I`, `*:W`, `*:E`; the filter box matches tag, message, pid or tid; rows alternate shade so a stamp on the left stays tied to its message on the right; the line that starts a crash is marked. Only the screenful being read is in the page, so a three-hundred-thousand-line log scrolls like a file. |

## Bugreports

`adb bugreport <dir>` writes a **zip**, and that is what Telltale opens: drop
the archive in as it came off the device. The entry dumpstate named in
`main_entry.txt` is the one read, inflated in the browser — no upload, no
unzipping first, nothing installed. A flat `bugreport.txt` works the same way,
and so does a URL pointing at either.

Every reader that recognises a section of it opens as its own tab — ten of
them on the sample in `tests/fixtures`, left to right in the order of the
table above, with `?tool=` deciding which one is in front. A phone's bugreport
holds all of these but car_service, which needs an automotive build, and
binder_calls_stats, which has to be switched on first. Each tab is named for
the reader; the file it came out of is on the tab when more than one file is
open, and in its tooltip always.

One `dumpsys input` is two of those rows: the dispatcher's windows and the
reader's devices are different questions about the same text, so it opens two
tabs. A dump from
Android 12 or earlier printed `flags`, `type` and `inputFeatures` as hex where
a newer one prints the `inputConfig` names; the bits that decide whether an
event reaches a window are read into those names, so an old dump reads the same
as a new one.

binder_calls_stats is off, sampled and nameless until it is told otherwise, and
it records nothing at all while the device is charging — which is an emulator's
normal state, so a dump taken without unplugging it first is an empty table:

```
adb shell dumpsys battery unplug
adb shell dumpsys binder_calls_stats --enable --no-sampling --enable-detailed-tracking
adb shell dumpsys binder_calls_stats --reset      # then reproduce what you are after
adb shell dumpsys binder_calls_stats > binder.txt
```

It also reads straight off a URL:

```
?url=https://your-host/dumps/bugreport.txt
?url=/dumps/before.txt&url=/dumps/after.txt
```

The fetch runs without credentials, so a cross-origin file has to send
`Access-Control-Allow-Origin`. Anything sitting next to `index.html` always
works.

## Search the whole desk

The filter above the list searches the dump you are reading. **Search** in the
top bar — or `⌘K` / `Ctrl+K` — searches every dump open in the workspace, every
reader that recognised each of them, and every display inside each reader.
Results are grouped by the tab they came out of; `↑` `↓` walk them and `⏎`
opens one, which switches to that tab, to that display, and leaves the query
on as that tab's own filter so the thing you found is the thing on screen.

Either box takes a regular expression. Press the **`.*`** beside it and what
you type is the pattern — `activity.*`, `timeout|watchdog` — or write it
between slashes without touching the switch: `/^am_(crash|anr)/`,
`/\bpid 1631\b/i`. Matching is case-insensitive whether or not you write `i`,
and a pattern that will not compile says what is wrong with it instead of
matching nothing in silence. The switch belongs to the dump you are reading,
and opening a search result carries it over with the query.

## Host it

Copy `index.html` into a repository and turn on GitHub Pages. That is the whole
deployment. It opens from `file://` just as well.
