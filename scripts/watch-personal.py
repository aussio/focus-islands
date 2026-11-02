#!/usr/bin/env python3
"""Relaunch the Personal Electron app after a successful source check."""

from pathlib import Path
import os
import signal
import subprocess
import sys
import time


WATCH = ("electron", "scripts", "Extension", "NativeHost")
FILES = ("package.json", "package-lock.json")


def snapshot(root):
    result = {}
    for name in FILES:
        path = root / name
        if path.exists():
            result[str(path)] = path.stat().st_mtime_ns
    for name in WATCH:
        base = root / name
        for directory, dirs, files in os.walk(base):
            dirs[:] = [item for item in dirs if item not in {"node_modules", "__pycache__"}]
            for name in files:
                path = Path(directory) / name
                result[str(path)] = path.stat().st_mtime_ns
    return result


def launch(root, app_bundle):
    log = (root / ".build/personal.log").open("a")
    executable = app_bundle / "Contents/MacOS/FocusIslands"
    return subprocess.Popen((str(executable), "--show-window"), stdout=log, stderr=log)


def main(root, app_bundle):
    app = launch(root, app_bundle)
    baseline = snapshot(root)
    changed_at = None
    print("Watching Electron source. Press Ctrl-C to leave the app running.", flush=True)
    try:
        while app.poll() is None:
            time.sleep(0.4)
            current = snapshot(root)
            if current != baseline:
                baseline = current
                changed_at = time.monotonic()
            if changed_at is None or time.monotonic() - changed_at < 0.8:
                continue
            changed_at = None
            check = subprocess.run((str(root / "scripts/build.sh"),), cwd=root,
                                   env={**os.environ, "FOCUS_ISLANDS_STAGE_BUILD": "1"})
            if check.returncode:
                print("Source check failed. Personal app is still running.", file=sys.stderr)
                continue
            app.send_signal(signal.SIGUSR1)
            try:
                app.wait(timeout=10)
            except subprocess.TimeoutExpired:
                print("Personal app did not stop. Watcher stopped.", file=sys.stderr)
                return 1
            current_build = root / ".build/ElectronBuild"
            next_build = root / ".build/ElectronBuild-next"
            if current_build.exists():
                import shutil
                shutil.rmtree(current_build)
            os.replace(next_build, current_build)
            built_app = current_build / f"FocusIslands-darwin-{os.uname().machine}/FocusIslands.app"
            installed = subprocess.run((str(root / "scripts/install-personal-bundle.sh"), str(built_app)))
            if installed.returncode:
                app = launch(root, app_bundle)
                print("Could not install the update. The previous Personal app was reopened.", file=sys.stderr)
                continue
            app = launch(root, app_bundle)
            print("Reloaded Personal app. Local data was kept.", flush=True)
        return 0
    except KeyboardInterrupt:
        print("Watcher stopped. Personal app remains open.", flush=True)
        return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: watch-personal.py REPO_ROOT APP_BUNDLE")
    raise SystemExit(main(Path(sys.argv[1]), Path(sys.argv[2])))
