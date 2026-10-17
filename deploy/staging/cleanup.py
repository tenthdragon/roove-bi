#!/usr/bin/env python3
"""Retain staging rollback releases and recent backups; default to dry run."""
import argparse
import fcntl
import pathlib
import re
import shutil
import time

RELEASES = pathlib.Path('/var/www/releases/roove-bi-staging')
BACKUPS = pathlib.Path('/opt/roove-staging/backups')


def candidates(releases, backups, now, busy=()):
    # Fail closed if either rollback pointer is missing or points outside staging.
    protected = set(busy)
    for name in ('current', 'previous'):
        link = releases / name
        target = link.resolve(strict=True)
        if not link.is_symlink() or target.parent != releases or not target.is_dir():
            raise RuntimeError('Invalid staging release pointer: ' + name)
        protected.add(target)
    for link in releases.iterdir():
        if link.is_symlink():
            protected.add(link.resolve())
    for path in sorted(releases.iterdir()):
        if path.is_symlink() or path.resolve() in protected:
            continue
        if not re.fullmatch(r'[a-zA-Z0-9-]+(?:\.tar\.gz)?', path.name):
            continue
        # Allow a day for release preparation; do not remove in-progress builds.
        if path.stat().st_mtime > now - 86400:
            continue
        if path.is_dir() or (path.is_file() and path.name.endswith('.tar.gz')):
            yield path
    dumps = sorted((p for p in backups.glob('*.dump') if p.is_file() and not p.is_symlink()
                    and p.name != 'initial.dump'), key=lambda p: p.stat().st_mtime, reverse=True)
    # Keep initial snapshot forever, at least five recent dumps, and all dumps <14 days.
    for path in dumps[5:]:
        if path.stat().st_mtime < now - 14 * 86400:
            yield path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with open('/run/lock/roove-staging-cleanup.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        busy = set()
        for proc in pathlib.Path('/proc').glob('[0-9]*'):
            for entry in ('cwd', 'exe'):
                try:
                    target = (proc / entry).resolve(strict=True)
                    if target.is_relative_to(RELEASES):
                        busy.add(RELEASES / target.relative_to(RELEASES).parts[0])
                except (OSError, RuntimeError):
                    pass
        for path in candidates(RELEASES, BACKUPS, time.time(), busy):
            print(('DELETE ' if args.apply else 'WOULD DELETE ') + str(path), flush=True)
            if args.apply:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()


if __name__ == '__main__':
    main()
