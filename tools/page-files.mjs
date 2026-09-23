/* Which files the page is, in the order it loads them.
 *
 * Telltale is plain scripts sharing one global scope, so the page is its files
 * concatenated in the order index.html lists them. Both harnesses need that
 * text, and neither should keep its own idea of what the page is made of: this
 * reads the <script src> list out of index.html, so adding a file to the page
 * adds it to the tests with nothing else to edit.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const PAGE = fileURLToPath(new URL('index.html', ROOT));

/* The layer after parse. Everything before it in the list is the parse layer:
   text in, scene out, no DOM and no state. */
export const STATE_FILE = 'js/state.js';

export function pageFiles(){
  const html = readFileSync(PAGE, 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  if(!srcs.length) throw new Error('index.html: no <script src> tags; fix the split in this file');
  if(!srcs.includes(STATE_FILE)) throw new Error(`index.html: ${STATE_FILE} is not in the script list`);
  return srcs;
}

export const readFiles = (files) =>
  files.map((f) => readFileSync(fileURLToPath(new URL(f, ROOT)), 'utf8')).join('\n');

/* The whole page, as one script. */
export const pageSource = () => readFiles(pageFiles());

/* Only the files before state: the part that runs under node as it is. If a
   parser ever reaches forward into a later layer, this stops evaluating and
   the tests fail with the name it reached for, which is the point. */
export function parseSource(){
  const files = pageFiles();
  return readFiles(files.slice(0, files.indexOf(STATE_FILE)));
}
