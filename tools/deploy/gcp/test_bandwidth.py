import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, call
import json
import signal

spec = importlib.util.spec_from_file_location('bandwidth', Path(__file__).with_name('bandwidth.py'))
meter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(meter)


class MeterTests(unittest.TestCase):
    def step(self, state=None, month='2026-11', boot='boot-a', tx=100, cap=1000):
        return meter.advance(state, month, boot, tx, cap)

    def test_first_install_includes_current_boot_and_regular_poll_counts_delta(self):
        state = self.step(tx=100)
        self.assertEqual(state['used'], 100)
        state = self.step(state, tx=450)
        self.assertEqual(state['used'], 450)

    def test_redeploy_and_clean_reboot_preserve_usage(self):
        state = self.step(tx=900)
        self.assertEqual(self.step(state, tx=950)['used'], 950)
        state['clean'] = True
        self.assertEqual(self.step(state, boot='boot-b', tx=70)['used'], 970)

    def test_crash_same_boot_recovers_from_nic_delta(self):
        state = self.step(tx=700)
        self.assertEqual(self.step(state, tx=1100)['used'], 1100)

    def test_unclean_reboot_missing_or_corrupt_state_and_counter_reset_close(self):
        state = self.step(tx=700)
        for recovered in [self.step(state, boot='boot-b', tx=5), self.step({}), self.step('corrupt'), self.step(state, tx=2)]:
            self.assertGreaterEqual(recovered['used'], 1000)

    def test_new_month_resets_and_retains_unobserved_traffic(self):
        state = self.step(tx=1200)
        state = self.step(state, month='2026-12', tx=1210)
        self.assertEqual(state['used'], 10)
        state = self.step(state, tx=50, month='2027-01', boot='boot-b')
        self.assertEqual(state['used'], 50)

    def test_backwards_clock_cannot_reopen_cutoff(self):
        state = self.step(tx=800)
        state = self.step(state, month='2026-10', tx=850)
        self.assertEqual(state['month'], '2026-11')
        self.assertGreaterEqual(state['used'], 1000)

    def test_pacific_month_boundary_and_daylight_saving(self):
        utc = dt.timezone.utc
        self.assertEqual(meter.month_now(dt.datetime(2026, 11, 1, 6, 59, tzinfo=utc)), '2026-10')
        self.assertEqual(meter.month_now(dt.datetime(2026, 11, 1, 7, 0, tzinfo=utc)), '2026-11')
        self.assertEqual(meter.month_now(dt.datetime(2026, 12, 1, 7, 59, tzinfo=utc)), '2026-11')
        self.assertEqual(meter.month_now(dt.datetime(2026, 12, 1, 8, 0, tzinfo=utc)), '2026-12')

    def test_cutoff_flag_is_idempotent_and_state_is_atomic(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            self.assertTrue(meter.set_cutoff(directory, True))
            self.assertFalse(meter.set_cutoff(directory, True))
            self.assertEqual((directory / 'cutoff').stat().st_mode & 0o777, 0o644)
            self.assertTrue(meter.set_cutoff(directory, False))
            meter.atomic_json(directory / 'state.json', self.step())
            self.assertIn('"used": 100', (directory / 'state.json').read_text())
            self.assertFalse((directory / 'state.tmp').exists())

    def test_running_monitor_switches_page_once_ends_transfers_and_saves_clean_shutdown(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            config = directory / 'config.json'
            config.write_text(json.dumps({'cap_bytes': 1000, 'interface': 'ens4'}))
            state_dir = directory / 'state'
            counters = iter([100, 1100, 1150, 1200])
            handlers, observations = {}, []
            original_read = Path.read_text

            def read(file, *args, **kwargs):
                if str(file) == '/sys/class/net/ens4/statistics/tx_bytes':
                    return str(next(counters))
                return original_read(file, *args, **kwargs)

            def sleep(_seconds):
                observations.append((state_dir / 'cutoff').exists())
                if len(observations) == 3:
                    handlers[signal.SIGTERM](signal.SIGTERM, None)

            with patch.object(meter, 'STATE_DIR', state_dir), patch.object(meter, 'CONFIG', config), \
                    patch.object(meter, 'month_now', return_value='2026-11'), \
                    patch.object(Path, 'read_text', read), patch.object(meter.time, 'sleep', side_effect=sleep), \
                    patch.object(meter.signal, 'signal', side_effect=lambda sig, fn: handlers.update({sig: fn})), \
                    patch.object(meter, 'notify'), patch.object(meter.subprocess, 'run') as commands:
                meter.run()
            self.assertEqual(observations, [False, True, True])
            self.assertEqual(commands.call_args_list, [
                call(['systemctl', '--no-block', 'start', 'nginx'], check=True),
                call(['systemctl', '--no-block', 'restart', 'nginx'], check=True)])
            state = json.loads((state_dir / 'state.json').read_text())
            self.assertEqual(state['used'], 1200)
            self.assertTrue(state['clean'])


if __name__ == '__main__':
    unittest.main()
