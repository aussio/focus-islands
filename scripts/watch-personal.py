#!/usr/bin/env python3
"""Rebuild and relaunch the one Personal app after source changes."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import time


POLL_SECONDS = 0.35
QUIET_SECONDS = 0.8
WATCH_DIRECTORIES = ("Sources", "Extension", "NativeHost", "CozyFocusPet.xcodeproj")
WATCH_FILES = ("Package.swift", "scripts/build.sh", "scripts/run-personal.sh")
SKIP_DIRECTORIES = {".build", ".git", "__pycache__", "xcuserdata"}


def snapshot(root: Path) -> dict[str, tuple[int, int]]:
    result: dict[str, tuple[int, int]] = {}
    paths = [root / name for name in WATCH_FILES]
    for name in WATCH_DIRECTORIES:
        directory = root / name
        if not directory.is_dir():
            continue
        for current, directories, filenames in os.walk(directory):
            directories[:] = [name for name in directories if name not in SKIP_DIRECTORIES]
            paths.extend(Path(current) / name for name in filenames if not name.endswith((".pyc", ".swp", "~")))
    for path in paths:
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        result[str(path.relative_to(root))] = (stat.st_mtime_ns, stat.st_size)
    return result


def personal_processes(app: Path) -> list[int]:
    executable = app / "Contents/MacOS/CozyFocusPet"
    output = subprocess.check_output(("ps", "-Ao", "pid=,command="), text=True)
    result = []
    for line in output.splitlines():
        fields = line.strip().split(None, 1)
        if len(fields) == 2 and fields[1] == f"{executable} --show-window":
            result.append(int(fields[0]))
    return result


def wait_for_process(app: Path, present: bool, seconds: float = 10) -> list[int]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = personal_processes(app)
        if bool(found) == present:
            return found
        time.sleep(0.1)
    return personal_processes(app)


def tail(path: Path, lines: int = 60) -> str:
    try:
        return "".join(path.read_text(errors="replace").splitlines(keepends=True)[-lines:])
    except FileNotFoundError:
        return "Build log was not created.\n"


def main(root: Path, app: Path) -> int:
    processes = wait_for_process(app, present=True)
    if len(processes) != 1:
        print("Watch mode could not identify one Personal app; stopping.", file=sys.stderr, flush=True)
        return 1
    pid = processes[0]
    baseline = snapshot(root)
    print("Watching source files. Press Ctrl-C to stop watching; the app stays open.", flush=True)
    pending_at = None
    try:
        while True:
            time.sleep(POLL_SECONDS)
            if pid not in personal_processes(app):
                print("Personal app quit; watcher stopped.", flush=True)
                return 0
            current = snapshot(root)
            if current != baseline:
                changed = set(current) ^ set(baseline)
                changed.update(name for name in current.keys() & baseline.keys() if current[name] != baseline[name])
                print(f"Changed: {', '.join(sorted(changed)[:6])}", flush=True)
                baseline = current
                pending_at = time.monotonic()
            if pending_at is None or time.monotonic() - pending_at < QUIET_SECONDS:
                continue

            pending_at = None
            before_build = baseline
            log = root / ".build/build-personal.log"
            print("Building updated app…", flush=True)
            with log.open("w") as output:
                built = subprocess.run((str(root / "scripts/build.sh"),), cwd=root,
                                       stdout=output, stderr=subprocess.STDOUT).returncode == 0
            if not built:
                print("Build failed; the current app is still running.\n" + tail(log),
                      file=sys.stderr, flush=True)
            else:
                if personal_processes(app) != [pid]:
                    print("App process changed during build; watcher stopped without relaunching.",
                          file=sys.stderr, flush=True)
                    return 1
                os.kill(pid, signal.SIGUSR1)
                if wait_for_process(app, present=False):
                    print("The old app did not quit; watcher stopped without starting another copy.",
                          file=sys.stderr, flush=True)
                    return 1
                subprocess.run(("open", "-n", "-a", str(app), "--args", "--show-window"), check=True)
                processes = wait_for_process(app, present=True)
                if len(processes) != 1:
                    print("The updated app did not start; watcher stopped.", file=sys.stderr, flush=True)
                    return 1
                pid = processes[0]
                print("Reloaded Personal app. Local data was kept.", flush=True)
            after_build = snapshot(root)
            if after_build != before_build:
                baseline = after_build
                pending_at = time.monotonic()
    except KeyboardInterrupt:
        print("Watcher stopped; app left running.", flush=True)
        return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: watch-personal.py REPO_ROOT APP_PATH")
    raise SystemExit(main(Path(sys.argv[1]), Path(sys.argv[2])))
