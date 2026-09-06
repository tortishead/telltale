# Telltale

What the device says about itself.

Telltale is a browser toolkit for reading what an Android device reports about
itself. Drop something in and it works out what it is holding, then draws it or
lists it: the window stack to scale, SurfaceFlinger layers, packages, the
thread that blocks main in an ANR trace. A whole bugreport works too — every
reader gets a look, and each one that recognises something keeps its result.

One static HTML file. No dependencies, no build step, no server. What you load
never leaves your browser.

## Use it

Open `index.html`. Drop a file in, paste text, pick one with the file dialog,
or point it at a URL.

```
adb shell dumpsys window windows   > windows.txt
adb shell dumpsys SurfaceFlinger   > sf.txt
adb shell dumpsys package          > packages.txt
adb pull /data/anr/traces.txt
adb bugreport                          # all of the above at once
```

More than one thing can be open at a time; each gets a tab and keeps its own
place — the filter, the selection, the view. Drop several files to open one tab
each.

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
