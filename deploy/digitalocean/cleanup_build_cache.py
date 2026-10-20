#!/usr/bin/env python3
"""Remove only stale production webpack caches. Dry-run unless --apply is set."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import stat
import time

ROOT = Path('/var/www/releases/roove-bi')
LOCK = Path('/run/lock/roove-bi-release-maintenance.lock')
MIN_AGE = 24 * 60 * 60
KEEP_NEWEST = 3
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def emit(event, **values):
    print(json.dumps({'event': event, **values}), flush=True)


def identity(path):
    info = path.lstat()
    return info.st_dev, info.st_ino


def release_links(root):
    links = {}
    for name in ('current', 'previous'):
        link = root / name
        if not link.is_symlink():
            raise RuntimeError(f'Missing release symlink: {name}')
        target = link.resolve(strict=True)
        if target.parent != root or not target.is_dir():
            raise RuntimeError(f'Release symlink escapes production root: {name}')
        links[name] = target
    # Protect additional aliases too, including a prepared cutover/rollback link.
    for link in root.iterdir():
        if link.is_symlink() and link.name not in links:
            target = link.resolve(strict=True)
            if target.parent == root:
                links[link.name] = target
    return links


def process_releases(root, proc_root):
    protected = set()
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            cwd = Path(os.readlink(entry / 'cwd'))
        except (FileNotFoundError, ProcessLookupError):
            continue  # Process exited, or a kernel thread has no cwd.
        # Permission/other errors abort rather than assuming the release is unused.
        if cwd.is_relative_to(root) and cwd != root:
            protected.add(root / cwd.relative_to(root).parts[0])
    return protected


def mount_paths(mountinfo):
    return {Path(re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), line.split()[4]))
            for line in mountinfo.read_text().splitlines()}


def cache_info(root, release, mounts, now):
    """No symlink, mount, or recent writes anywhere in the target cache."""
    path = release
    for name in ('.next', 'cache', 'webpack'):
        path = path / name
        if path.is_symlink() or not path.is_dir() or path.resolve() != path:
            return None
    if any(m == path or m.is_relative_to(path) or path.is_relative_to(m) and m.is_relative_to(release)
           for m in mounts):
        return None
    device = root.stat().st_dev
    newest, size = 0.0, 0
    def fail_on_walk_error(error):
        raise error
    for folder, dirs, files in os.walk(path, followlinks=False, onerror=fail_on_walk_error):
        for item in [Path(folder), *(Path(folder) / name for name in dirs + files)]:
            info = item.lstat()
            if stat.S_ISLNK(info.st_mode) or info.st_dev != device or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                return None
            newest = max(newest, info.st_mtime, info.st_ctime)
            if stat.S_ISREG(info.st_mode):
                size += info.st_blocks * 512
    if newest > now - MIN_AGE:
        return None
    return {'path': path, 'bytes': size, 'identity': identity(path),
            'parents': [identity(release), identity(release / '.next'), identity(release / '.next/cache')]}


def remove_cache(root, release, info, guard):
    # fd-relative rmtree resists symlink substitution, including parent directories.
    if not shutil.rmtree.avoids_symlink_attacks:
        raise RuntimeError('This Python runtime does not support safe fd-relative deletion')
    fds = [os.open(root, FLAGS)]
    try:
        for name, expected in zip((release.name, '.next', 'cache'), info['parents']):
            fd = os.open(name, FLAGS, dir_fd=fds[-1])
            fds.append(fd)
            current = os.fstat(fd)
            if (current.st_dev, current.st_ino) != expected:
                raise RuntimeError('Cache ancestor changed during cleanup')
        current = os.stat('webpack', dir_fd=fds[-1], follow_symlinks=False)
        if (current.st_dev, current.st_ino) != info['identity'] or not stat.S_ISDIR(current.st_mode):
            raise RuntimeError('Cache changed during cleanup')
        guard()
        shutil.rmtree('webpack', dir_fd=fds[-1])
    finally:
        for fd in reversed(fds):
            os.close(fd)


def cleanup(root=ROOT, lock_path=LOCK, proc_root=Path('/proc'),
            mountinfo=Path('/proc/self/mountinfo'), apply=False, now=None):
    now = time.time() if now is None else now
    if root.resolve(strict=True) != root or not root.is_dir():
        raise RuntimeError('Production root must be a real, canonical directory')
    # A shared deployment lock serializes builds, cutovers, rollbacks and cleanup.
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            result = {'status': 'skipped', 'reason': 'release-maintenance-lock-busy'}
            emit('summary', **result)
            return result
        root_identity, links = identity(root), release_links(root)
        mounts = mount_paths(mountinfo)
        releases = []
        for release in root.iterdir():
            if release.is_symlink() or not release.is_dir() or release.resolve() != release:
                continue
            package = release / 'package.json'
            if not package.is_file() or package.is_symlink() or package.stat().st_size > 1024 * 1024:
                continue
            if json.loads(package.read_text()).get('name') == 'roove-bi':
                releases.append(release)
        def release_time(release):
            marker = release / '.next/BUILD_ID'
            return marker.stat().st_mtime if marker.is_file() and not marker.is_symlink() else release.stat().st_mtime
        newest = set(sorted(releases, key=lambda p: (release_time(p), p.name), reverse=True)[:KEEP_NEWEST])
        protected = set(links.values()) | newest | process_releases(root, proc_root)
        def guard():
            if identity(root) != root_identity or release_links(root) != links:
                raise RuntimeError('Release links changed; aborting cleanup')
        removed, eligible, bytes_removed, bytes_eligible = [], [], 0, 0
        for release in sorted(releases):
            guard()
            if release in protected:
                continue
            info = cache_info(root, release, mounts, now)
            if not info:
                continue
            if release in process_releases(root, proc_root):
                continue
            guard()
            eligible.append(release.name)
            bytes_eligible += info['bytes']
            if apply:
                remove_cache(root, release, info, guard)
                removed.append(release.name)
                bytes_removed += info['bytes']
            emit('removed' if apply else 'would-remove', release=release.name,
                 target='.next/cache/webpack', bytes=info['bytes'])
        result = {'status': 'ok', 'apply': apply, 'eligible': eligible, 'removed': removed,
                  'eligibleBytes': bytes_eligible, 'removedBytes': bytes_removed,
                  'protected': sorted(p.name for p in protected), 'freeBytes': shutil.disk_usage(root).free}
        emit('summary', **result)
        return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Delete eligible webpack caches (default: dry-run)')
    args = parser.parse_args()
    try:
        if os.geteuid() != 0:
            raise RuntimeError('Run as root so all running release processes can be inspected')
        cleanup(apply=args.apply)
    except Exception as error:
        emit('error', message=str(error))
        raise SystemExit(1)
