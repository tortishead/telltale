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

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/* The fixtures, and which parser each one is for. */
const CASES = [
  { name: 'window-sample',  parse: 'parseWindowDump' },
  { name: 'sf-sample',      parse: 'parseSurfaceFlingerDump' },
  { name: 'package-sample', parse: 'parsePackageDump' },
  { name: 'anr-sample',     parse: 'parseAnrDump' },
  { name: 'anr-native-sample', parse: 'parseAnrDump' },
  { name: 'car-service-sample', parse: 'parseCarServiceDump' },
  { name: 'user-sample', parse: 'parseUserDump' },
  { name: 'binder-sample', parse: 'parseBinderCallsStatsDump' },
  /* One text, two readers: `dumpsys input` prints the dispatcher's windows
     and the reader's devices one after the other, and each is its own scene.
     A case names the fixture it reads when that is not its own name. */
  { name: 'input-sample', parse: 'parseInputDump' },
  { name: 'input-devices', file: 'input-sample', parse: 'parseInputDevicesDump' },
  { name: 'logcat-sample', parse: 'parseLogcatDump' },
];

/* Every golden is `tests/golden/<name>.txt` and every fixture is
   `tests/fixtures/<name>.txt` unless the case names another one. */
const fixture = (c) => dir(`fixtures/${c.file || c.name}.txt`);

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
  parseWindowDump: ['window-sample'],
  parseSurfaceFlingerDump: ['sf-sample'],
  parsePackageDump: ['package-sample'],
  parseAnrDump: ['anr-sample', 'anr-native-sample'],
  parseBinderCallsStatsDump: ['binder-sample'],
  parseInputDump: ['input-sample'],
  parseInputDevicesDump: ['input-sample'],
  parseLogcatDump: ['logcat-sample'],
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
