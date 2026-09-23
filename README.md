# AOSP Telltale

What the device says about itself.

Telltale is a browser toolkit for reading what an Android device reports about
itself. Drop something in and it works out what it is holding, then draws it,
lists it, or lays it out to be read.

One static HTML file. No dependencies, no build step, no server. What you load
never leaves your browser.

## Use it

Open `index.html`. Drop a file in, paste text, pick one with the file dialog,
or point it at a URL. A bugreport zip opens as it came off the device, one tab
per reader that recognised a section of it.

| Take it with | Reads | `?tool=` |
| --- | --- | --- |
| `adb shell dumpsys window windows` | windows | `window` |
| `adb shell dumpsys SurfaceFlinger` | layers | `sf` |
| `adb shell dumpsys display` | displays | `display` |
| `adb shell dumpsys package` | packages | `package` |
| `adb pull /data/anr/traces.txt` | threads | `anr` |
| `adb shell dumpsys user` | users | `user` |
| `adb shell getprop` | properties | `props` |
| `adb shell dumpsys overlay` | overlays | `overlay` |
| `adb shell dumpsys car_service` | sections | `car` |
| `adb shell dumpsys input` | input windows | `input` |
| `adb shell dumpsys input` | input devices | `inputdev` |
| `adb shell dumpsys binder_calls_stats` | calls | `binder` |
| `adb shell getevent -lt` | touch strokes | `getevent` |
| `adb logcat -b events -d`, or any bugreport | framework events | `events` |
| `adb logcat -d`, or any bugreport | log lines | `logcat` |

A touch trace is the one dump a bugreport never holds — take it while the
gesture happens, and take the ranges with it so the strokes come out in the
panel's own coordinates:

```
adb shell getevent -lp > touch.txt     # the axes and their ranges
adb shell getevent -lt >> touch.txt    # then reproduce the gesture, ^C
```

It opens as the gesture rather than as the events: a stroke per finger, named
tap, long press, swipe or pinch, with a clock under the drawing to play it
against.

A trace and a layout can be brought together from either end, and both end up
as the same drawing:

* **Onto a layout.** With a window, input or SurfaceFlinger dump open, press
  **Play a touch log** under the sheet and paste the capture in. The gesture
  plays over that dump's own windows, in the plan and in the z-order view.
  Picking a window then says which strokes came down on it — and for an input
  dump, which of them something above it would have taken instead.
* **Onto a trace.** With the capture open as its own tab, pick a display under
  **over** and its windows are drawn under the strokes instead.

Either way the panel is scaled onto the display. How far round the panel is
mounted against that display is stated by `dumpsys display` and by nothing else
in a bugreport, so with one of those on the desk the turn comes from it;
otherwise it starts at none and the button beside the clock finds it.

binder_calls_stats is off, sampled and nameless until told otherwise, and
records nothing while the device is charging:

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
`Access-Control-Allow-Origin`.

## Search the whole desk

The filter above the list searches the dump you are reading. **Search** in the
top bar — or `⌘K` / `Ctrl+K` — searches every dump open in the workspace, every
reader that recognised each of them, and every display inside each reader.
Results are grouped by the tab they came out of; `↑` `↓` walk them and `⏎`
opens one, which switches to that tab, to that display, and leaves the query
on as that tab's own filter.

Either box takes a regular expression. Press the **`.*`** beside it, or write
the pattern between slashes: `/^am_(crash|anr)/`, `/\bpid 1631\b/i`. Matching
is case-insensitive whether or not you write `i`.

## Host it

Copy `index.html` into a repository and turn on GitHub Pages. It opens from
`file://` just as well. The header carries the day the copy was stamped and
which stamp of that day it is — `build 2026.09.23.2` — which is what to quote
in a bug report about Telltale itself. Every run is a new revision:

```
python3 tools/stamp-build.py     # once per copy you publish
```

## Tests

```
node --test tests/*.test.mjs
```
