/* Which fixture is which, and which release it came off.
 *
 * Telltale reads dumps from builds years apart, and a fixture is the only
 * proof that a reader still reads the release it was taken from. So the list
 * lives here rather than inside one test file: the golden tests read it to
 * know what to run, and tools/coverage.mjs reads it to print what is covered
 * and — the part worth having — what is not.
 *
 * `release` is the Android release the dump was taken off, and it is stated
 * only where something says so: a build fingerprint in the fixture, a
 * property in it, or the name the fixture was given. A dump states no build of
 * its own, so the rest are null rather than guessed, and the coverage tool
 * prints them as the holes they are. Filling one in means taking a dump off
 * that release and adding the fixture, not editing this number.
 */

/* Every `-a15-` fixture is a section cut whole out of one bugreport,
   `google/sdk_gphone64_arm64/emu64a:15/AE3A.240806.036`, so what they say
   about each other is what one device said at one moment.

   Every fixture, the parser it is for, and the release it came off. A case
   names the fixture it reads when that is not its own name. */
export const CASES = [
  { name: 'window-sample',  parse: 'parseWindowDump', release: null },
  /* The same reader on a real Android 15 bugreport's window section, where
     the display states its IME target as `imeLayeringTarget in display# 0`
     rather than with an `=`. */
  { name: 'window-a15-sample', parse: 'parseWindowDump', release: 15 },
  { name: 'sf-sample',      parse: 'parseSurfaceFlingerDump', release: null },
  /* Android 15 is already on the new frontend: it prints the composition,
     input and hierarchy lists, and none of the counts the old one summarised
     itself with. */
  { name: 'sf-a15-sample', parse: 'parseSurfaceFlingerDump', release: 15 },
  /* The same reader on an Android 16 dump, which prints none of the lists the
     one above is made of. */
  { name: 'sf-a16-sample',  parse: 'parseSurfaceFlingerDump', release: 16 },
  { name: 'display-sample', parse: 'parseDisplayManagerDump', release: null },
  { name: 'display-a15-sample', parse: 'parseDisplayManagerDump', release: 15 },
  /* The same reader on an Android 16 dump, which underlines every heading
     inside itself with a rule of the shape that ends a bugreport section. */
  { name: 'display-a16-sample', parse: 'parseDisplayManagerDump', release: 16 },
  { name: 'activity-sample', parse: 'parseActivityDump', release: null },
  /* A whole section off a real bugreport rather than a hand-cut one, which is
     the only place the second copy of the tree turns up: the manager prints
     each display's tasks top to bottom and then the window manager's own
     hierarchy prints the same tasks again, deeper indented and carrying the
     bounds and the activity the first copy leaves out. */
  { name: 'activity-a15-sample', parse: 'parseActivityDump', release: 15 },
  /* The same reader on an Android 16 dump: tasks inside tasks for split
     screen, a TaskFragment under one of them for activity embedding, a task
     in desktop windowing, and every rect printed as `Rect(l, t - r, b)`
     rather than `[l,t][r,b]`. */
  { name: 'activity-a16-sample', parse: 'parseActivityDump', release: 16 },
  { name: 'service-sample', parse: 'parseActivityServicesDump', release: null },
  { name: 'service-a15-sample', parse: 'parseActivityServicesDump', release: 15 },
  /* The same reader on an Android 16 dump, where a foreground service states
     the type it declared, a short one states the deadline it is running
     against, and the manager prints what let it start. */
  { name: 'service-a16-sample', parse: 'parseActivityServicesDump', release: 16 },
  { name: 'package-sample', parse: 'parsePackageDump', release: null },
  { name: 'package-a15-sample', parse: 'parsePackageDump', release: 15 },
  /* Both ANR fixtures carry the fingerprint of the build they were taken off:
     `generic/x/x:15/AP4A` and `google/panther/panther:15/AP4A`. */
  { name: 'anr-sample',     parse: 'parseAnrDump', release: 15 },
  { name: 'anr-native-sample', parse: 'parseAnrDump', release: 15 },
  { name: 'car-service-sample', parse: 'parseCarServiceDump', release: null },
  { name: 'user-sample', parse: 'parseUserDump', release: null },
  { name: 'user-a15-sample', parse: 'parseUserDump', release: 15 },
  { name: 'overlay-sample', parse: 'parseOverlayDump', release: null },
  { name: 'overlay-a15-sample', parse: 'parseOverlayDump', release: 15 },
  { name: 'binder-sample', parse: 'parseBinderCallsStatsDump', release: null },
  { name: 'binder-a15-sample', parse: 'parseBinderCallsStatsDump', release: 15 },
  /* One text, two readers: `dumpsys input` prints the dispatcher's windows
     and the reader's devices one after the other, and each is its own scene. */
  { name: 'input-sample', parse: 'parseInputDump', release: null },
  { name: 'input-devices', file: 'input-sample', parse: 'parseInputDevicesDump', release: null },
  { name: 'input-a15-sample', parse: 'parseInputDump', release: 15 },
  { name: 'input-devices-a15', file: 'input-a15-sample', parse: 'parseInputDevicesDump', release: 15 },
  /* `Build fingerprint: 'google/panther/panther:14/UQ1A'`, in the fixture. */
  { name: 'logcat-sample', parse: 'parseLogcatDump', release: 14 },
  { name: 'logcat-a15-sample', parse: 'parseLogcatDump', release: 15 },
  /* `[ro.build.version.release]: [14]`, in the fixture. */
  { name: 'props-sample', parse: 'parseSystemPropertiesDump', release: 14 },
  /* `[ro.build.version.release]: [15]`, in the fixture. */
  { name: 'props-a15-sample', parse: 'parseSystemPropertiesDump', release: 15 },
  { name: 'events-sample', parse: 'parseEventLogDump', release: null },
  { name: 'events-a15-sample', parse: 'parseEventLogDump', release: 15 },
  { name: 'getevent-sample', parse: 'parseGeteventCapture', release: null },
  /* The same reader on a capture taken with a device argument, which prints
     no node in front of its events. */
  { name: 'getevent-bare-sample', parse: 'parseGeteventCapture', release: null },
];

/* The whole-bugreport fixture is not a case above — it is a zip, read by
   tests/bugreport.test.mjs rather than by one parser — but it is a release
   every reader in the page is proven against at once, so coverage counts it.
   Its fingerprint is `google/panther/panther:14/UQ1A`. */
export const BUGREPORT = { name: 'bugreport-sample', file: 'bugreport-sample.zip', release: 14 };

/* Every fixture is `tests/fixtures/<name>.txt` unless the case names another
   one. Callers hold the path to that folder, because a test and a tool sit at
   different depths. */
export const fixtureName = (c) => `${c.file || c.name}.txt`;
