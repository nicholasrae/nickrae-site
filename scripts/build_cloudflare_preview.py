#!/usr/bin/env python3
"""Export only tracked public files into an isolated Cloudflare preview payload.

Production source bytes, GitHub Pages configuration and DNS are not changed.
Uses the current simple Jekyll exclusion list; unsupported exclusion syntax fails
closed so a future configuration change requires an explicit publication review.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
CONTROL = ROOT / ".cloudflare"
OUTPUT = CONTROL / "dist"
PAGES_OUTPUT = CONTROL / "pages-dist"
GENERATED = CONTROL / "generated"
MAX_ASSET_BYTES = 25 * 1024 * 1024
PUBLIC_SUFFIXES = {
    ".html", ".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp",
    ".gif", ".avif", ".ico", ".pdf", ".mp4", ".txt", ".xml", ".woff",
    ".woff2", ".ttf", ".otf",
}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def jekyll_exclusions() -> set[str]:
    exclusions: set[str] = set()
    in_exclude = False
    for raw in (ROOT / "_config.yml").read_text().splitlines():
        text = raw.split("#", 1)[0].rstrip()
        if not text.strip():
            continue
        if text == "exclude:":
            in_exclude = True
            continue
        if in_exclude and re.fullmatch(r"\s+- [A-Za-z0-9_./-]+", text):
            value = text.strip()[2:]
            parts = PurePosixPath(value).parts
            if value.startswith("/") or ".." in parts:
                raise ValueError("Unsafe Jekyll exclusion")
            exclusions.add(value.rstrip("/"))
            continue
        raise ValueError("Review unsupported _config.yml syntax before exporting: " + text)
    if not in_exclude:
        raise ValueError("Explicit Jekyll exclusions are required")
    return exclusions


def excluded_reason(relative: str, excludes: set[str]) -> str | None:
    parts = PurePosixPath(relative).parts
    if not parts or relative.startswith("/") or ".." in parts:
        raise ValueError("Unsafe tracked path")
    if any(part.startswith((".", "_", "#")) or part.endswith("~") for part in parts):
        return "Jekyll/default metadata exclusion"
    if relative == "CNAME":
        return "GitHub Pages domain configuration, not a preview asset"
    if any(relative == item or relative.startswith(item + "/") for item in excludes):
        return "Explicit Jekyll exclusion"
    return None


def build() -> dict:
    excludes = jekyll_exclusions()
    tracked = sorted(git("ls-files", "-z").decode().rstrip("\0").split("\0"))
    files: dict[str, dict] = {}
    excluded: dict[str, str] = {}
    for relative in tracked:
        reason = excluded_reason(relative, excludes)
        if reason:
            excluded[relative] = reason
            continue
        source = ROOT / relative
        if source.is_symlink() or not source.resolve().is_relative_to(ROOT):
            raise ValueError("Refusing symlink/outside-root public asset: " + relative)
        if not source.is_file():
            raise ValueError("Missing tracked public file: " + relative)
        if source.suffix.lower() not in PUBLIC_SUFFIXES:
            raise ValueError("Review unsupported public file type before export: " + relative)
        body = source.read_bytes()
        if len(body) > MAX_ASSET_BYTES:
            raise ValueError("Public file exceeds Cloudflare 25 MiB asset limit: " + relative)
        files[relative] = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    if "index.html" not in files or "404.html" not in files:
        raise ValueError("Both homepage and custom 404 must be present")

    # This exact generated directory belongs to this exporter. It never clears
    # the repository, source folders, parent release folder or unrelated paths.
    if OUTPUT.is_symlink():
        raise ValueError("Refusing symlinked preview output")
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)
    GENERATED.mkdir(parents=True, exist_ok=True)
    routes: dict[str, str] = {}
    slash_redirects: dict[str, str] = {}
    assets: list[str] = []
    for relative in files:
        target = OUTPUT / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, target)
        asset = "/" + quote(relative, safe="/-._~")
        assets.append(asset)
        if relative.endswith(".html"):
            # GitHub serves known extensionless HTML aliases with 200 while its
            # canonical article URLs keep .html. Do not introduce new redirects.
            routes[asset[:-5]] = asset
        if relative.endswith("index.html"):
            directory = "/" + quote(relative[:-10], safe="/-._~")
            routes[directory] = asset
            if directory != "/":
                slash_redirects[directory[:-1]] = directory
    # Directory slash redirects have precedence over same-name file aliases.
    routing = {"assets": assets, "routes": routes, "slashRedirects": slash_redirects}
    (GENERATED / "routes.mjs").write_text("export default " + json.dumps(routing, sort_keys=True, separators=(",", ":")) + ";\n")
    manifest = {
        "sourceCommit": git("rev-parse", "HEAD").decode().strip(),
        "purpose": "Isolated Cloudflare preview; no DNS or production cutover",
        "publicFileCount": len(files),
        "htmlFiles": sum(path.endswith(".html") for path in files),
        "pdfFiles": sum(path.endswith(".pdf") for path in files),
        "files": files,
        "excluded": excluded,
        "routing": routing,
        "contentPolicy": "Every exported asset is byte-identical to its source file",
    }
    (GENERATED / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"publicFiles": len(files), "htmlFiles": manifest["htmlFiles"], "pdfFiles": manifest["pdfFiles"], "excludedTrackedFiles": len(excluded), "output": str(OUTPUT)}, indent=2))
    return manifest


def build_pages(manifest: dict) -> dict:
    """Bundle advanced-mode Pages source without relying on HTML redirects."""
    if PAGES_OUTPUT.is_symlink():
        raise ValueError("Refusing symlinked Pages output")
    if PAGES_OUTPUT.exists():
        shutil.rmtree(PAGES_OUTPUT)
    shutil.copytree(OUTPUT, PAGES_OUTPUT)
    html_pages = {}
    for relative, info in manifest["files"].items():
        if not relative.endswith(".html"):
            continue
        body = (OUTPUT / relative).read_bytes()
        # This validates the current HTML encoding; base64 then preserves bytes
        # rather than reserializing HTML, Unicode, whitespace or line endings.
        if body.decode("utf-8").encode("utf-8") != body:
            raise ValueError("HTML UTF-8 round-trip mismatch: " + relative)
        html_pages["/" + quote(relative, safe="/-._~")] = {
            **info, "base64": base64.b64encode(body).decode("ascii")
        }
    html_module = "export default " + json.dumps(html_pages, sort_keys=True, separators=(",", ":")) + ";\n"
    (GENERATED / "pages-html.mjs").write_text(html_module)
    routing_module = (GENERATED / "routes.mjs").read_text()
    core = (CONTROL / "preview-worker.mjs").read_text()
    pages = (CONTROL / "pages-worker.mjs").read_text()
    core_import = "import routing from './generated/routes.mjs';\n"
    pages_imports = "import previewWorker from './preview-worker.mjs';\nimport htmlPages from './generated/pages-html.mjs';\n"
    if not routing_module.startswith("export default ") or not html_module.startswith("export default "):
        raise ValueError("Unexpected generated module format")
    if not core.startswith(core_import) or core.count("export default {") != 1 or not pages.startswith(pages_imports):
        raise ValueError("Review Worker imports/exports before bundling")
    bundle = (
        "// Generated isolated Nick Rae preview. No DNS or production cutover.\n"
        + routing_module.replace("export default ", "const routing = ", 1)
        + core[len(core_import):].replace("export default {", "const previewWorker = {", 1)
        + html_module.replace("export default ", "const htmlPages = ", 1)
        + pages[len(pages_imports):]
    ).encode("utf-8")
    compressed_bytes = len(gzip.compress(bundle, mtime=0))
    if len(bundle) >= 3 * 1024 * 1024 or compressed_bytes >= 3 * 1024 * 1024:
        raise ValueError("Pages preview Worker exceeds the conservative 3 MiB size gate")
    routes = (json.dumps({"version": 1, "include": ["/*"], "exclude": []}, indent=2) + "\n").encode()
    (PAGES_OUTPUT / "_worker.js").write_bytes(bundle)
    (PAGES_OUTPUT / "_routes.json").write_bytes(routes)
    (GENERATED / "pages-bundle.mjs").write_bytes(bundle)
    files = dict(manifest["files"])
    for name, body in {"_worker.js": bundle, "_routes.json": routes}.items():
        files[name] = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    result = {
        "purpose": "Pages Git-connected preview; no custom domain or DNS cutover",
        "sourceCommit": manifest["sourceCommit"],
        "publicFileCount": manifest["publicFileCount"],
        "uploadFileCount": len(files),
        "htmlFilesEmbedded": len(html_pages),
        "embeddedHtmlBytes": sum(page["bytes"] for page in html_pages.values()),
        "workerBytes": len(bundle),
        "workerGzipBytes": compressed_bytes,
        "files": files,
        "output": str(PAGES_OUTPUT),
    }
    (GENERATED / "pages-manifest.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "files"}, indent=2), flush=True)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pages", action="store_true", help="Also emit the self-contained Pages advanced-mode preview")
    parser.add_argument("--validate", action="store_true", help="Run source, measurement and preview tests after export")
    options = parser.parse_args()
    manifest = build()
    if options.pages:
        build_pages(manifest)
    if options.validate:
        for command in [
            [sys.executable, "scripts/check_site.py"],
            ["node", "scripts/test_measurement.cjs"],
            ["node", "scripts/test_cloudflare_preview.cjs"],
            *([["node", "scripts/test_cloudflare_pages_preview.cjs"]] if options.pages else []),
        ]:
            subprocess.run(command, cwd=ROOT, check=True)
