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
| `adb shell dumpsys car_service` | sections | `car` | Every service the car stack dumped, as the tree of sections it printed, and which of them threw on the way out. Picking one lists what it printed in the middle pane — a name, its value, and whatever it printed under that — with its own search over it, and a run of lines written to one shape laid out in columns instead. Picking a line reads it on the right. Property ids are named from the two tables the dump names them in. |

`adb bugreport` holds the first four, and car_service too on an automotive build. Every reader gets a look at whatever you load
and each one that recognises something keeps its result, so a bugreport opens
with a switch in the top bar between them.

More than one thing can be open at a time; each gets a tab and keeps its own
place — the filter, the selection, the view. Drop several files to open one tab
each.

Those tabs belong to a workspace, and there is a strip of workspaces above
them — a workspace per thing you are looking into, so the dumps opened for one
are not sitting in the strip while you read another. The dump strip shows the
open workspace's tabs and nothing else. Click a workspace to switch to it,
`+` to start another, double-click one to rename it, `×` to close it, or step
round them with `alt+shift+←` and `alt+shift+→`. Closing a workspace closes
every dump in it, so the cross asks once before it does. Nothing survives
closing the page, workspace names included.

Each workspace carries a colour, on its own tab and on the line over whichever
dump is open inside it, so the desk you are standing at is legible without
reading the name. There are six and they repeat; the first is the colour the
page has always used, so one workspace looks like no workspaces at all.

It also reads straight off a URL:

```
?url=https://your-host/dumps/bugreport.txt
?url=/dumps/before.txt&url=/dumps/after.txt
```

The fetch runs without credentials, so a cross-origin file has to send
`Access-Control-Allow-Origin`. Anything sitting next to `index.html` always
works.

## Host it

Copy `index.html` into a repository and turn on GitHub Pages. That is the whole
deployment. It opens from `file://` just as well.
