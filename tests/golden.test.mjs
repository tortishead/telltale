/* Every fixture, through its parser, written out as a digest and compared to
 * the file under tests/golden. These catch drift: a regex loosened for one
 * build that quietly stops matching another, a field that stops being read, a
 * node that stops being drawn.
 *
 * When a change is meant, look at the diff, satisfy yourself it is the change
 * you made, then rewrite the goldens:
 *
 *     UPDATE_GOLDEN=1 node --test tests/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as parsers from '../tools/parse-layer.mjs';
import { digest } from '../tools/scene-digest.mjs';
/* Which fixture is which, and which release it came off, is stated once in
   tools/fixtures.mjs — the coverage tool reads the same list. */
import { CASES, fixtureName } from '../tools/fixtures.mjs';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/* Every golden is `tests/golden/<name>.txt` and every fixture is
   `tests/fixtures/<name>.txt` unless the case names another one. */
const fixture = (c) => dir(`fixtures/${fixtureName(c)}`);

if (UPDATE && !existsSync(dir('golden'))) mkdirSync(dir('golden'));

for (const c of CASES) {
  test(`${c.name} digest is unchanged`, () => {
    const scene = parsers[c.parse](readFileSync(fixture(c), 'utf8'));
    assert.ok(scene, `${c.parse} returned nothing for ${c.name}`);
    const got = digest(scene);
    const golden = dir(`golden/${c.name}.txt`);

    if (UPDATE) { writeFileSync(golden, got); return; }

    assert.ok(existsSync(golden),
      `no golden for ${c.name}. Run: UPDATE_GOLDEN=1 node --test tests/`);
    assert.equal(got, readFileSync(golden, 'utf8'));
  });
}

/* Every parser has to say no to every dump that is not its own. A bugreport is
   one text with all of them in it and every parser gets a look at all of it,
   so one that is merely tolerant enough to find something in anything would
   put a phantom tab on the page.
   `ok` is the whole of the answer: `load` keeps a scene if and only if it is
   set, so a parser reports "not mine" by coming back with it false, not by
   returning nothing. */
const OWN = {
  parseWindowDump: ['window-sample', 'window-a15-sample'],
  parseSurfaceFlingerDump: ['sf-sample', 'sf-a15-sample', 'sf-a16-sample'],
  parsePackageDump: ['package-sample', 'package-a15-sample'],
  parseDisplayManagerDump: ['display-sample', 'display-a15-sample', 'display-a16-sample'],
  parseActivityDump: ['activity-sample', 'activity-a15-sample', 'activity-a16-sample'],
  parseActivityServicesDump: ['service-sample', 'service-a15-sample', 'service-a16-sample'],
  parseAnrDump: ['anr-sample', 'anr-native-sample'],
  parseOverlayDump: ['overlay-sample', 'overlay-a15-sample'],
  parseBinderCallsStatsDump: ['binder-sample', 'binder-a15-sample'],
  parseInputDump: ['input-sample', 'input-a15-sample'],
  parseInputDevicesDump: ['input-sample', 'input-a15-sample'],
  /* The event log is a log, and it is the one log the log reader does not
     read: its lines are tags and numbers, and the event reader next door is
     what they are for. So a pasted event buffer is that reader's alone. */
  parseLogcatDump: ['logcat-sample', 'logcat-a15-sample'],
  parseSystemPropertiesDump: ['props-sample', 'props-a15-sample'],
  parseEventLogDump: ['events-sample', 'events-a15-sample', 'logcat-sample'],
};

test('each parser recognises its own dumps and no others', () => {
  const texts = Object.fromEntries(
    CASES.map((c) => [c.file || c.name, readFileSync(fixture(c), 'utf8')]));

  for (const [fn, own] of Object.entries(OWN)) {
    for (const [name, text] of Object.entries(texts)) {
      const scene = parsers[fn](text);
      assert.ok(scene, `${fn} returned nothing at all for ${name}`);
      assert.equal(!!scene.ok, own.includes(name),
        own.includes(name)
          ? `${fn} did not recognise ${name}, which is its own`
          : `${fn} claimed to understand ${name}`);
    }
  }
});

/* Truncation is the normal state of a dump off a field log. Cutting one short
   at any point must give back a scene that is merely smaller — never a throw,
   which `load` would report as "it could not be read". */
test('a truncated dump parses without throwing', () => {
  for (const c of CASES) {
    const text = readFileSync(fixture(c), 'utf8');
    for (const frac of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const cut = text.slice(0, Math.floor(text.length * frac));
      assert.doesNotThrow(() => parsers[c.parse](cut),
        `${c.parse} threw on ${c.name} cut to ${frac * 100}%`);
    }
  }
});
