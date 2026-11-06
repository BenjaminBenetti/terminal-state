#!/usr/bin/env python3
"""Persistent outbound NIC meter. No Cloud API scopes or billing credentials.

nginx gates all game requests on `cutoff`; switching to the fallback page also
fast-restarts nginx to terminate downloads already in flight. Polling is NOT an
exact billing ceiling: leave headroom for the one-second interval and fallback.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import time
from zoneinfo import ZoneInfo

STATE_DIR = Path('/var/lib/terminal-state-bandwidth')
CONFIG = Path('/etc/terminal-state/bandwidth.json')


def month_now(now=None):
    return (now or dt.datetime.now(dt.timezone.utc)).astimezone(ZoneInfo('America/Los_Angeles')).strftime('%Y-%m')


def valid_state(state):
    return (isinstance(state, dict) and state.get('schema') == 1
            and re.fullmatch(r'\d{4}-(?:0[1-9]|1[0-2])', state.get('month', ''))
            and isinstance(state.get('boot'), str)
            and all(type(state.get(k)) is int and state[k] >= 0 for k in ('used', 'tx'))
            and type(state.get('clean')) is bool)


def advance(state, month, boot, tx, cap):
    if type(tx) is not int or tx < 0 or type(cap) is not int or cap < 1:
        raise ValueError('Invalid counter/cap')
    reason = ''
    if state is None:
        used = tx  # Conservative first install: include this entire boot's TX.
    elif not valid_state(state):
        used, reason = cap, 'Unreadable state; closed until next month'
    elif month > state['month']:
        # Attribute the whole unobserved interval to the new month, conservatively.
        used = tx - state['tx'] if boot == state['boot'] and tx >= state['tx'] else tx
    elif month < state['month']:
        used, reason = max(cap, state['used']), 'Clock moved backwards; cutoff retained'
        month = state['month']
    elif boot != state['boot']:
        if state['clean']:
            used = state['used'] + tx
        else:
            used, reason = max(cap, state['used']), 'Unclean reboot; unknown traffic, closed until next month'
    elif tx < state['tx']:
        used, reason = max(cap, state['used']), 'NIC counter reset; closed until next month'
    else:
        used = state['used'] + tx - state['tx']
    if not reason and valid_state(state) and month == state['month']:
        reason = state.get('reason', '')
    return {'schema': 1, 'month': month, 'boot': boot, 'tx': tx, 'used': used, 'clean': False, 'reason': reason}


def atomic_json(file, value):
    temporary = file.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(file)
    directory = os.open(file.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def set_cutoff(directory, closed):
    flag = directory / 'cutoff'
    previous = flag.exists()
    if closed:
        flag.touch(mode=0o644, exist_ok=True)
        flag.chmod(0o644)
    else:
        flag.unlink(missing_ok=True)
    return closed != previous


def notify(message):
    address = os.environ.get('NOTIFY_SOCKET')
    if address:
        if address.startswith('@'):
            address = '\0' + address[1:]
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as stream:
            stream.connect(address)
            stream.sendall(message.encode())


def run():
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    # Keep the fallback visible during startup and on every monitoring failure.
    previous_cutoff = (STATE_DIR / 'cutoff').exists()
    set_cutoff(STATE_DIR, True)
    config = json.loads(CONFIG.read_text())
    cap, interface = config['cap_bytes'], config['interface']
    if type(cap) is not int or cap < 1 or not re.fullmatch(r'[A-Za-z0-9_-]{1,15}', interface):
        raise ValueError('Invalid bandwidth configuration')
    counter = Path('/sys/class/net') / interface / 'statistics/tx_bytes'
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    state_file, marker = STATE_DIR / 'state.json', STATE_DIR / 'initialized'
    try:
        state = json.loads(state_file.read_text())
    except (OSError, ValueError):
        state = {} if marker.exists() else None
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    first = True
    while True:
        state = advance(state, month_now(), boot, int(counter.read_text()), cap)
        closed = state['used'] >= cap
        changed = closed != previous_cutoff
        set_cutoff(STATE_DIR, closed)
        state['clean'] = stopping
        atomic_json(state_file, state)
        marker.touch(exist_ok=True)
        if stopping:
            set_cutoff(STATE_DIR, True)
            return
        if first:
            notify('READY=1')
            # nginx BindsTo this service: recover it after a service restart, too.
            subprocess.run(['systemctl', '--no-block', 'start', 'nginx'], check=True)
        elif changed:
            # A reload gracefully drains transfers. A fast restart actually ends them.
            subprocess.run(['systemctl', '--no-block', 'restart', 'nginx'], check=True)
        if first or changed:
            print(json.dumps({'month': state['month'], 'used_bytes': state['used'], 'cap_bytes': cap,
                              'cutoff': closed, 'reason': state['reason']}), flush=True)
        previous_cutoff, first = closed, False
        notify('WATCHDOG=1')
        time.sleep(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args()
    if args.status:
        print((STATE_DIR / 'state.json').read_text())
        print(CONFIG.read_text())
        print('cutoff:', (STATE_DIR / 'cutoff').exists())
    else:
        try:
            run()
        except Exception:
            set_cutoff(STATE_DIR, True)
            # BindsTo stops nginx when this process exits; fail closed even if a
            # local override has removed that relationship.
            subprocess.run(['systemctl', '--no-block', 'stop', 'nginx'], check=False)
            raise
