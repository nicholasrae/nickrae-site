#!/usr/bin/env python3
"""Prepare a separate production-capable Pages artifact; never deploy or edit DNS.

The existing preview command and source remain unchanged. This explicit command
also rebuilds that preview as a preservation/check fixture, then emits a distinct
production artifact whose pages.dev candidate is still noindex and unmeasured.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import quote

import build_cloudflare_preview as preview
from check_site import Page

ROOT = Path(__file__).resolve().parents[1]
CONTROL = ROOT / ".cloudflare"
OUTPUT = CONTROL / "production-dist"
GENERATED = CONTROL / "generated"


def build() -> dict:
    manifest = preview.build()
    preview.build_pages(manifest)
    noindex = {}
    for relative in manifest["files"]:
        if not relative.endswith(".html"):
            continue
        page = Page(ROOT / relative, relative)
        if page.noindex:
            # Preserve only the source's explicit robots directives. Do not
            # infer a noindex rule from names such as privacy or support.
            noindex["/" + quote(relative, safe="/-._~")] = ", ".join(page.metas("robots"))
    policies = {"noindex": noindex}
    policy_module = "export default " + json.dumps(policies, sort_keys=True, separators=(",", ":")) + ";\n"
    (GENERATED / "production-policies.mjs").write_text(policy_module)

    routing_module = (GENERATED / "routes.mjs").read_text()
    html_module = (GENERATED / "pages-html.mjs").read_text()
    core = (CONTROL / "production-worker.mjs").read_text()
    adapter = (CONTROL / "pages-worker.mjs").read_text()
    core_imports = "import routing from './generated/routes.mjs';\nimport policies from './generated/production-policies.mjs';\n"
    adapter_imports = "import previewWorker from './preview-worker.mjs';\nimport htmlPages from './generated/pages-html.mjs';\n"
    if not core.startswith(core_imports) or core.count("export default {") != 1:
        raise ValueError("Review production router imports/exports before bundling")
    if not adapter.startswith(adapter_imports) or adapter.count("return previewWorker.fetch(") != 1:
        raise ValueError("Review unchanged Pages adapter before production bundling")
    if any(not module.startswith("export default ") for module in [routing_module, html_module, policy_module]):
        raise ValueError("Unexpected generated module format")
    bundle = (
        "// Explicit production-capable Nick Rae artifact. No deployment or DNS action.\n"
        + routing_module.replace("export default ", "const routing = ", 1)
        + policy_module.replace("export default ", "const policies = ", 1)
        + core[len(core_imports):].replace("export default {", "const productionWorker = {", 1)
        + html_module.replace("export default ", "const htmlPages = ", 1)
        + adapter[len(adapter_imports):].replace("return previewWorker.fetch(", "return productionWorker.fetch(", 1)
    ).encode("utf-8")
    compressed_bytes = len(gzip.compress(bundle, mtime=0))
    if len(bundle) >= 3 * 1024 * 1024 or compressed_bytes >= 3 * 1024 * 1024:
        raise ValueError("Production Pages Worker exceeds the conservative 3 MiB size gate")
    if OUTPUT.is_symlink():
        raise ValueError("Refusing symlinked production output")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    shutil.copytree(preview.OUTPUT, OUTPUT)
    routes = (json.dumps({"version": 1, "include": ["/*"], "exclude": []}, indent=2) + "\n").encode()
    (OUTPUT / "_worker.js").write_bytes(bundle)
    (OUTPUT / "_routes.json").write_bytes(routes)
    (GENERATED / "production-bundle.mjs").write_bytes(bundle)
    files = dict(manifest["files"])
    for name, body in {"_worker.js": bundle, "_routes.json": routes}.items():
        files[name] = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    result = {
        "mode": "explicit-production-candidate",
        "purpose": "Prepared production-capable Pages artifact; no deployment, custom domain, DNS or main merge",
        "sourceCommit": manifest["sourceCommit"],
        "productionHosts": ["nickrae.net", "www.nickrae.net"],
        "canonicalHostPolicy": "HTTPS apex serves content; www permanently redirects 301 to HTTPS nickrae.net with path/query preserved",
        "candidateHostPolicy": "Only *.pages.dev; noindex, nofollow, no-store; existing source blocks Google on this host",
        "publicFileCount": manifest["publicFileCount"],
        "uploadFileCount": len(files),
        "htmlFiles": manifest["htmlFiles"],
        "pdfFiles": manifest["pdfFiles"],
        "intentionalNoindexPages": noindex,
        "workerBytes": len(bundle),
        "workerGzipBytes": compressed_bytes,
        "files": files,
        "output": str(OUTPUT),
    }
    (GENERATED / "production-manifest.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key not in {"files", "intentionalNoindexPages"}}, indent=2), flush=True)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate", action="store_true", help="Run all existing source/preview checks and production checks")
    options = parser.parse_args()
    build()
    if options.validate:
        for command in [
            [sys.executable, "scripts/check_site.py"],
            ["node", "scripts/test_measurement.cjs"],
            ["node", "scripts/test_confirmed_matching.cjs"],
            ["node", "scripts/test_confirmed_matching_bridge.cjs"],
            ["node", "scripts/test_preview_navigation.cjs"],
            ["node", "scripts/test_cloudflare_preview.cjs"],
            ["node", "scripts/test_cloudflare_pages_preview.cjs"],
            ["node", "scripts/test_cloudflare_production.cjs"],
        ]:
            subprocess.run(command, cwd=ROOT, check=True)
