"""Finish a requested Personal restart after the old process has closed its database."""
import os
from pathlib import Path
import subprocess
import sys
import time


def finish_restart(pid, root, built, target):
    for _ in range(300):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError("App did not quit; installation cancelled.")
    result = subprocess.run([str(Path(root) / "scripts/install-personal-bundle.sh"), built])
    # The installer restores the previous bundle on failure, so reopen it in that case too.
    subprocess.run(["/usr/bin/open", "-g", "-n", "-a", target], check=True)
    if result.returncode:
        raise RuntimeError("Installation failed; reopened the previous app. See restart.log.")


if __name__ == "__main__":
    pid, root, built, target = sys.argv[1:]
    print("ready", flush=True)
    finish_restart(int(pid), root, built, target)
