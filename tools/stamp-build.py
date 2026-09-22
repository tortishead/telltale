#!/usr/bin/env python3
"""Writes the build stamp in index.html's header from git.

AOSP Telltale has no build step, so the stamp is a literal in the page and this is
the only thing that writes it. It names the commit the file was stamped from —
the date the commit was made, not the day it was stamped — because the point of
it is to say which copy of a page that gets copied into repositories and served
from anywhere is the one somebody has open.

Run it before publishing a copy:

    python3 tools/stamp-build.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'index.html'

# The element the header carries. Everything between the tags, and the title,
# is rewritten; nothing else in the page mentions the build.
STAMP_RE = re.compile(
    r'(<div class="build" id="build" title=")[^"]*("\s*>)[^<]*(</div>)')


def git(*args: str) -> str:
    return subprocess.run(('git', *args), cwd=ROOT, check=True,
                          capture_output=True, text=True).stdout.strip()


def main() -> None:
    sha = git('log', '-1', '--format=%h')
    date = git('log', '-1', '--format=%cd', '--date=format:%Y.%m.%d')

    html = PAGE.read_text(encoding='utf-8')
    stamped, n = STAMP_RE.subn(
        rf'\g<1>AOSP Telltale build {date} ({sha})\g<2>build {date}\g<3>', html)
    if n != 1:
        sys.exit('index.html: expected one build stamp in the header, found '
                 f'{n}. Fix the element or the pattern in this file.')

    if stamped == html:
        print(f'index.html: already at build {date} ({sha})')
        return
    PAGE.write_text(stamped, encoding='utf-8')
    print(f'index.html: build {date} ({sha})')


if __name__ == '__main__':
    main()
