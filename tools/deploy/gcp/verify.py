#!/usr/bin/env python3
"""VM-side hash verification before anything becomes publicly readable."""
import hashlib
import json
from pathlib import Path
import re
import sys


def safe_path(value):
    return (isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', value)
            and not any(p.startswith('.') or re.search(r'secret|credential|password|token', p, re.I)
                        for p in value.split('/')))


def verify(directory):
    root = Path(directory)
    deployment = json.loads((root / 'deploy.json').read_text())
    original = json.loads((root / 'manifest.json').read_text())
    assert deployment['schema'] == 'terminal-state-vm-v1'
    assert re.fullmatch(r'[a-f0-9]{40}', deployment['commit'])
    assert original['schema'] == 'terminal-state-static-ci-v1'
    assert original['commit'] == deployment['commit']
    assert original['entry'] == 'index.html' and original['base'] == './'
    assert re.fullmatch(r'v[0-9A-Za-z.+-]+', deployment['tag'])
    assert re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]', deployment['domain'])
    assert '..' not in deployment['domain']
    assert type(deployment['cap_bytes']) is int and deployment['cap_bytes'] >= 1_000_000
    assert not deployment['acme_email'] or re.fullmatch(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', deployment['acme_email'])
    expected = {}
    originals = {}
    for entries, target in [(deployment['files'], expected), (original['files'], originals)]:
        for entry in entries:
            name = entry['path']
            assert safe_path(name) and name not in target, f'Unsafe/duplicate path: {name}'
            assert type(entry['bytes']) is int and entry['bytes'] >= 0
            assert re.fullmatch(r'[a-f0-9]{64}', entry['sha256'])
            target[name] = entry
    assert 'index.html' in originals
    assert original['fileCount'] == len(originals)
    assert original['totalBytes'] == sum(entry['bytes'] for entry in originals.values())
    assert all(expected.get(name) == entry for name, entry in originals.items())
    assert all(name in originals or (name.endswith(('.br', '.gz')) and name[:-3] in originals) for name in expected)
    site = root / 'site'
    assert site.is_dir() and not site.is_symlink()
    actual = set()
    for file in site.rglob('*'):
        assert not file.is_symlink(), f'Symlink: {file}'
        if file.is_dir():
            continue
        assert file.is_file()
        name = file.relative_to(site).as_posix()
        assert name in expected, f'Unexpected file: {name}'
        entry = expected[name]
        assert file.stat().st_size == entry['bytes'], f'Wrong size: {name}'
        assert hashlib.sha256(file.read_bytes()).hexdigest() == entry['sha256'], f'Wrong hash: {name}'
        actual.add(name)
    assert actual == set(expected), 'Missing files'
    return deployment


if __name__ == '__main__':
    result = verify(sys.argv[1])
    print(f"Verified original CI manifest and all representations for {result['commit']}")
