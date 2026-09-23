#!/usr/bin/env python3
"""Builds tests/fixtures/bugreport-sample.zip out of the text fixtures.

`adb bugreport <dir>` writes a zip, so that is what people have and what
Telltale has to open. The fixture is the shape dumpstate writes: the dump as
one entry, its name in main_entry.txt, and the files dumpstate collected
around it. The dump itself is every text fixture in the tests, one after
another under the rule dumpstate prints above each service — which is also
what makes it the one file that proves every reader gets its own tab.

Rebuild after changing any fixture:

    python3 tools/make-bugreport-fixture.py
"""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / 'tests' / 'fixtures'
NAME = 'bugreport-panther-UQ1A.240105.004-2026-09-21-11-04-02.txt'

# The rule dumpstate prints above each one, and the fixture that goes under it.
SECTIONS = [
    ('SYSTEM PROPERTIES',                               'props-sample.txt'),
    ('WINDOW MANAGER WINDOWS (dumpsys window windows)', 'window-sample.txt'),
    ('SURFACEFLINGER (dumpsys SurfaceFlinger)',         'sf-sample.txt'),
    ('DISPLAY MANAGER (dumpsys display)',               'display-sample.txt'),
    ('APP ACTIVITIES (dumpsys activity -v all)',         'activity-sample.txt'),
    ('APP SERVICES (dumpsys activity service all)',      'service-sample.txt'),
    ('PACKAGE MANAGER (dumpsys package)',               'package-sample.txt'),
    ('USERS (dumpsys user)',                            'user-sample.txt'),
    ('OVERLAY MANAGER (dumpsys overlay)',                'overlay-sample.txt'),
    ('INPUT (dumpsys input)',                           'input-sample.txt'),
    ('CAR SERVICE (dumpsys car_service)',               'car-service-sample.txt'),
    ('BINDER CALLS STATS (dumpsys binder_calls_stats)', 'binder-sample.txt'),
    ('VM TRACES AT LAST ANR (/data/anr/traces.txt)',    'anr-sample.txt'),
]


def build() -> str:
    out = [
        '========================================================',
        '== dumpstate: 2026-09-21 11:04:02',
        '========================================================',
        '',
        'Build: UQ1A.240105.004',
        "Build fingerprint: 'google/panther/panther:14/UQ1A.240105.004/11129216:user/release-keys'",
        'Kernel: Linux version 5.10.177-android13',
        '',
    ]
    for title, fixture in SECTIONS:
        out.append(f'------ {title} ------')
        out.append((FIX / fixture).read_text())
        out.append(f'--------- 0.212s was the duration of {title.split("(")[0].strip().lower()}')
        out.append('')
    # The logs come last in a bugreport, and carry their own rules already.
    out.append((FIX / 'logcat-sample.txt').read_text())
    return '\n'.join(out)


def main() -> None:
    text = build()
    target = FIX / 'bugreport-sample.zip'
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('main_entry.txt', NAME + '\n')
        z.writestr(NAME, text)
        z.writestr('version.txt', '2026-09-21\n')
        z.writestr('dumpstate_board.txt', 'nothing the readers know\n')
        z.writestr('FS/data/misc/logd/logcat', 'not the dump either\n')
    print(f'{target.relative_to(ROOT)}: {target.stat().st_size} bytes, '
          f'{len(text)} of text in {NAME}')


if __name__ == '__main__':
    main()
