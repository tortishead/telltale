# Telltale

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
| `adb shell dumpsys package` | packages | `package` |
| `adb pull /data/anr/traces.txt` | threads | `anr` |
| `adb shell dumpsys user` | users | `user` |
| `adb shell dumpsys car_service` | sections | `car` |
| `adb shell dumpsys input` | input windows | `input` |
| `adb shell dumpsys input` | input devices | `inputdev` |
| `adb shell dumpsys binder_calls_stats` | calls | `binder` |
| `adb logcat -d`, or any bugreport | log lines | `logcat` |

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
`file://` just as well.

## Tests

```
node --test tests/*.test.mjs
```
