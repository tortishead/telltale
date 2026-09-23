/* What the details pane does around whatever a reader put in it.
 *
 * The sections that join the readers to each other sit under what the reader
 * itself had to say, and they are long, so they fold. The fold is a <details>
 * and needs no script to work — what needs a test is that it is still shut
 * after the next click, because the pane is rebuilt from nothing every time
 * something is selected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openPage } from '../tools/page-harness.mjs';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const bytes = readFileSync(dir('fixtures/bugreport-sample.zip'));

/* Both folding sections are drawn on one window of the bugreport: it is read
   by all three surface readers, and its uid and package are all over the rest
   of the desk. */
async function onAWindow(){
  const page = openPage();
  const { text, label, from } = await page.readDump(new File([bytes], 'bugreport.zip'));
  await page.load(text, null, from || label, from ? label : null);
  const doc = page.docs().find((d) => d.found[0].tool.id === 'window');
  const display = doc.found[0].scene.displays[0];
  const node = display.nodes.find((n) => n.title === 'NavigationBar0');
  page.open(doc);
  page.display(display.id);
  page.select(node.hash);
  page.again = () => page.select(node.hash);
  return page;
}

/* `<details data-fold="spine" open>` — the attribute is what the toggle
   listener writes down and what the next render reads back. */
const folds = (html) => Object.fromEntries(
  [...html.matchAll(/<details class="dgroup" data-fold="(\w+)"( open)?>/g)]
    .map((m) => [m[1], !!m[2]]));

test('the sections that join the readers are the sections that fold', async () => {
  const page = await onAWindow();
  assert.deepEqual(folds(page.detail()), { surface: true, spine: true },
    'both of them, and both open until someone says otherwise');
});

test('a section that was shut is still shut after the next selection', async () => {
  const page = await onAWindow();
  page.shut('spine', true);
  page.again();
  assert.deepEqual(folds(page.detail()), { surface: true, spine: false });

  page.shut('surface', true);
  page.again();
  assert.deepEqual(folds(page.detail()), { surface: false, spine: false },
    'shutting one says nothing about the other');

  page.shut('spine', false);
  page.again();
  assert.deepEqual(folds(page.detail()), { surface: false, spine: true });
});

/* The heading changes with the reader — the same section is headed window,
   layer or input window — so what is remembered is the key and not the words. */
test('one fold covers the section under whichever name a reader gives it', async () => {
  const page = await onAWindow();
  page.shut('surface', true);

  for(const [toolId, title, heading] of [['sf', 'NavigationBar0#9', 'The same layer elsewhere'],
                                         ['input', 'NavigationBar0', 'The same window elsewhere']]){
    const doc = page.docs().find((d) => d.found[0].tool.id === toolId);
    const display = doc.found[0].scene.displays[0];
    page.open(doc);
    page.display(display.id);
    page.select(display.nodes.find((n) => n.title === title).hash);

    const html = page.detail();
    assert.match(html, new RegExp(`<summary>${heading}</summary>`));
    assert.equal(folds(html).surface, false, 'and it is still shut');
  }
});
