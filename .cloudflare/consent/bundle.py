#!/usr/bin/env python3
"""Build a dependency-free Dashboard Worker module; no deploy or credentials."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
BUILTIN = "import {DurableObject} from 'cloudflare:workers';\n"
LOCAL = "import {ConsentLedger, LedgerError, POLICY, TOKEN_PATTERN, EVENT_PATTERN,\n  constantTimeEqual, validObject, digest, token} from './ledger.mjs';\n"


def build():
    ledger = (ROOT / 'ledger.mjs').read_text()
    worker = (ROOT / 'worker.mjs').read_text()
    if not worker.startswith(BUILTIN + LOCAL) or worker.count(LOCAL) != 1:
        raise ValueError('Review Worker imports before building a single module')
    ledger = re.sub(r'^export ', '', ledger, flags=re.MULTILINE)
    worker = worker[len(BUILTIN + LOCAL):]
    worker = worker.replace('export async function parseOperation', 'async function parseOperation')
    worker = worker.replace('export function applyOperation', 'function applyOperation')
    bundle = ("// Prepared Nick Rae consent service; no credentials/deployment.\n" + BUILTIN + ledger + '\n' + worker).encode()
    if DIST.is_symlink():
        raise ValueError('Refusing a symlinked build directory')
    DIST.mkdir(exist_ok=True)
    (DIST / 'consent-worker.bundle.mjs').write_bytes(bundle)
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
              for name in ['ledger.mjs', 'worker.mjs', 'wrangler.jsonc', 'bundle.py']}
    manifest = {'purpose': 'Prepared single-file Dashboard module; no deployment or secret',
                'bytes': len(bundle), 'sha256': hashlib.sha256(bundle).hexdigest(), 'sources': hashes}
    (DIST / 'bundle-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))
    return manifest


if __name__ == '__main__':
    build()
