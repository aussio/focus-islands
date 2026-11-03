"""Exercise restart installation without launching or modifying the Personal app."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("restart", Path(__file__).resolve().parents[1] / "electron/restart-install.py")
restart = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restart)


class RestartTests(unittest.TestCase):
    def test_waits_for_exit_before_installing_and_opening_in_background(self):
        with patch.object(restart.os, "kill", side_effect=[None, ProcessLookupError]), \
             patch.object(restart.time, "sleep") as sleep, \
             patch.object(restart.subprocess, "run", return_value=Mock(returncode=0)) as run:
            restart.finish_restart(123, "/checkout", "/built.app", "/target.app")
            sleep.assert_called_once_with(0.1)
            self.assertEqual(run.call_args_list[0].args[0], ["/checkout/scripts/install-personal-bundle.sh", "/built.app"])
            self.assertEqual(run.call_args_list[1].args[0], ["/usr/bin/open", "-g", "-n", "-a", "/target.app"])

    def test_does_not_install_if_app_fails_to_quit(self):
        with patch.object(restart.os, "kill"), patch.object(restart.time, "sleep"), \
             patch.object(restart.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "did not quit"):
                restart.finish_restart(123, "/checkout", "/built.app", "/target.app")
            run.assert_not_called()

    def test_reopens_previous_app_on_install_failure(self):
        with patch.object(restart.os, "kill", side_effect=ProcessLookupError), \
             patch.object(restart.subprocess, "run", return_value=Mock(returncode=1)) as run:
            with self.assertRaisesRegex(RuntimeError, "previous app"):
                restart.finish_restart(123, "/checkout", "/built.app", "/target.app")
            self.assertEqual(run.call_count, 2)


if __name__ == "__main__":
    unittest.main()
