#!/usr/bin/env python3
"""Writes the build stamp in index.html's header.

AOSP Telltale has no build step, so the stamp is a literal in the page and this is
the only thing that writes it. It names the day the copy was stamped and which
stamp of that day it is — because the point of it is to say which copy of a page
that gets copied into repositories and served from anywhere is the one somebody
has open. The commit is carried in the title for whoever wants the code, but it
cannot be the stamp itself: the stamp is written before the commit that carries
it, so the sha is always the one before.

Every run is a new revision. Run it once per copy you publish:

    python3 tools/stamp-build.py
"""

import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'index.html'

# The element the header carries. Everything between the tags, and the title,
# is rewritten; nothing else in the page mentions the build.
STAMP_RE = re.compile(
    r'(<div class="build" id="build" title=")[^"]*("\s*>)[^<]*(</div>)')

# The build the page carries now, as `build <date>.<revision>`; the revision is
# optional so a stamp written before revisions existed still reads.
CURRENT_RE = re.compile(r'build (\d{4}\.\d{2}\.\d{2})(?:\.(\d+))?')


def git(*args: str) -> str:
    return subprocess.run(('git', *args), cwd=ROOT, check=True,
                          capture_output=True, text=True).stdout.strip()


def main() -> None:
    sha = git('log', '-1', '--format=%h')
    today = date.today().strftime('%Y.%m.%d')

    html = PAGE.read_text(encoding='utf-8')
    stamp = STAMP_RE.search(html)
    if not stamp:
        sys.exit('index.html: no build stamp in the header. Fix the element or '
                 'the pattern in this file.')

    current = CURRENT_RE.search(stamp.group(0))
    revision = 1
    if current and current.group(1) == today:
        revision = int(current.group(2) or 1) + 1
    build = f'{today}.{revision}'

    stamped, n = STAMP_RE.subn(
        rf'\g<1>AOSP Telltale build {build} ({sha})\g<2>build {build}\g<3>',
        html)
    if n != 1:
        sys.exit(f'index.html: expected one build stamp in the header, found {n}.')

    PAGE.write_text(stamped, encoding='utf-8')
    print(f'index.html: build {build} ({sha})')


if __name__ == '__main__':
    main()
