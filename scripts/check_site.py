#!/usr/bin/env python3
"""Offline checks for nickrae.net. Run: python3 scripts/check_site.py

Uses only Python's standard library. Checks source integrity, not remote HTTP,
retailer availability, rendering, accessibility behavior, or email delivery.
Keep product identity in data/workbooks.json and intentional route exceptions
below explicit; do not silence missing files with a broad allowlist.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET

ORIGIN = "https://nickrae.net"
LOCAL_HOSTS = {"nickrae.net", "www.nickrae.net"}
INTERNAL_DIRS = {"scripts", "data", "sketches", "node_modules", "_site"}
VERIFICATION_FILES = {"google4fe268415010cf4b.html"}
REDIRECTS = {
    "blog/blog-trajectory-learning.html": ORIGIN + "/blog/self-improving-ai-agents.html",
    "blog/openclaw-setup.html": ORIGIN + "/blog/blog-openclaw-setup.html",
    "inflection/index.html": ORIGIN + "/inflection-point/",
}
# Local copies of policies maintained on the product's own site.
EXTERNAL_CANONICALS = {
    "feedfare/privacy.html": "https://feedfare.app/privacy-policy.html",
    "feedfare/terms.html": "https://feedfare.app/terms.html",
}
KIT_UID = "899d974875"
KIT_FORM = f"https://nick-rae.kit.com/{KIT_UID}"
KIT_SCRIPT = KIT_FORM + "/index.js"
KIT_PAGES = {
    "index.html", "aviation-workbooks/index.html",
    "aviation-workbooks/private-pilot/index.html",
    "blog/checkride-prep-guide.html", "blog/student-pilot-apps-2026.html",
}
WORKBOOK_IDS = {"ppl", "instrument", "commercial", "multi-engine", "vfr-radio"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.I | re.S)
CSS_IMPORT = re.compile(r"@import\s+['\"]([^'\"]+)['\"]", re.I)


@dataclass
class Element:
    tag: str
    attrs: dict
    line: int
    text: str = ""
    inside_signup: bool = False


class Page(HTMLParser):
    def __init__(self, path: Path, relative: str):
        super().__init__(convert_charrefs=True)
        self.path, self.relative = path, relative
        self.elements: list[Element] = []
        self.stack: list[Element] = []
        self.feed(path.read_text(encoding="utf-8"))
        self.close()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        signup = any("ppl-signup" in x.attrs.get("class", "").split() for x in self.stack)
        node = Element(tag, attrs, self.getpos()[0], inside_signup=signup)
        self.elements.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        for node in self.stack:
            node.text += data

    def tags(self, tag):
        return [x for x in self.elements if x.tag == tag]

    def metas(self, name):
        return [x.attrs.get("content", "") for x in self.tags("meta") if x.attrs.get("name", "").lower() == name]

    @property
    def canonical(self):
        return [x.attrs.get("href", "") for x in self.tags("link") if "canonical" in x.attrs.get("rel", "").split()]

    @property
    def noindex(self):
        return any("noindex" in re.split(r"[\s,]+", s.lower()) for s in self.metas("robots"))

    @property
    def ids(self):
        return [x.attrs["id"] for x in self.elements if x.attrs.get("id")]

    @property
    def anchors(self):
        return self.tags("a")

    @property
    def refreshes(self):
        return [x for x in self.tags("meta") if x.attrs.get("http-equiv", "").lower() == "refresh"]

    @property
    def url(self):
        return page_url(self.relative)


def page_url(relative):
    return ORIGIN + "/" + (relative[:-10] if relative.endswith("index.html") else relative)


def public_path(path: Path, root: Path):
    parts = path.relative_to(root).parts
    return not any(p.startswith(".") or p in INTERNAL_DIRS for p in parts)


def srcset_urls(value):
    # Candidate URL plus optional width/density descriptors. Data URIs are
    # self-contained, so consume their comma as part of the first URL token.
    position = 0
    while position < len(value):
        while position < len(value) and (value[position].isspace() or value[position] == ","):
            position += 1
        start = position
        while position < len(value) and not value[position].isspace():
            position += 1
        url = value[start:position].rstrip(",")
        if url:
            yield url
        if position and value[position - 1] == ",":
            continue
        while position < len(value) and value[position] != ",":
            position += 1


def json_nodes(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from json_nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from json_nodes(child)


class Audit:
    def __init__(self, root):
        self.root = root.resolve()
        self.errors = []
        self.stats = Counter()
        self.pages = {}
        self.structured = {}
        self.ignored = []

    def error(self, source, message, line=None):
        location = f"{source}:{line}" if line else source
        self.errors.append(f"{location}: {message}")

    def target(self, absolute):
        path = unquote(urlsplit(absolute).path).lstrip("/")
        target = (self.root / path).resolve()
        if not target.is_relative_to(self.root) or not public_path(target, self.root):
            return None
        if target.is_dir():
            target /= "index.html"
        return target

    def check_url(self, raw, base, source, line=None, fragments=True):
        if not raw or raw.startswith(("data:", "mailto:", "tel:", "javascript:")):
            return
        try:
            absolute = urljoin(base, raw)
            parsed = urlsplit(absolute)
        except ValueError as exc:
            self.error(source, f"invalid URL {raw!r}: {exc}", line)
            return
        if parsed.hostname in ("ecfr.gov", "www.ecfr.gov") and parsed.path.startswith("/current/") and "/section-" in parsed.path:
            # Short section routes returned 503 in the normal browser even
            # when a cached web reader resolved them. Use the official full
            # hierarchy; source checks do not establish live HTTP availability.
            hierarchy = r"/current/title-[^/]+/chapter-[^/]+/subchapter-[^/]+/part-[^/]+/subpart-[^/]+/(?:subject-group-[^/]+/)?section-[^/]+"
            if not re.fullmatch(hierarchy, parsed.path):
                self.error(source, f"eCFR section link must use the verified full hierarchy: {raw!r}", line)
            self.stats["ecfr_section_links"] += 1
        if parsed.scheme not in ("http", "https") or parsed.hostname not in LOCAL_HOSTS:
            return
        self.stats["local_references"] += 1
        target = self.target(absolute)
        if target is None or not target.is_file():
            self.error(source, f"missing or non-public local target {raw!r}", line)
            return
        if parsed.fragment and fragments and target.suffix == ".html":
            page = self.pages.get(target)
            if page:
                fragment = unquote(parsed.fragment)
                names = [x.attrs.get("name") for x in page.anchors]
                if fragment not in page.ids and fragment not in names:
                    self.error(source, f"missing fragment in {raw!r}", line)
                self.stats["fragment_references"] += 1

    def check_css(self, text, base, source, line=None):
        for match in CSS_URL.finditer(text):
            self.check_url(match.group(2).strip(), base, source, line)
        for match in CSS_IMPORT.finditer(text):
            self.check_url(match.group(1), base, source, line)

    def load_pages(self):
        for path in sorted(self.root.rglob("*.html")):
            if not public_path(path, self.root):
                continue
            relative = path.relative_to(self.root).as_posix()
            if relative in VERIFICATION_FILES:
                expected = "google-site-verification: " + relative
                if path.read_text().strip() != expected:
                    self.error(relative, "verification file no longer matches its expected token")
                self.ignored.append(relative)
                continue
            try:
                self.pages[path.resolve()] = Page(path, relative)
            except (OSError, UnicodeError, ValueError) as exc:
                self.error(relative, f"HTML parse/read error: {exc}")
        self.stats["html_pages"] = len(self.pages)

    def check_pages(self):
        for page in self.pages.values():
            source = page.relative
            duplicate_ids = [name for name, count in Counter(page.ids).items() if count > 1]
            for name in duplicate_ids:
                self.error(source, f"duplicate id {name!r}")
            if page.tags("base"):
                self.error(source, "base elements require an explicit URL-resolution review")
            if source in REDIRECTS:
                destination = REDIRECTS[source]
                refresh = page.refreshes
                if len(refresh) != 1 or destination not in refresh[0].attrs.get("content", ""):
                    self.error(source, f"expected redirect to {destination}")
                if not page.noindex or page.canonical != [destination]:
                    self.error(source, "redirect must be noindex with its destination canonical")
                self.stats["intentional_redirects"] += 1
            elif page.refreshes:
                self.error(source, "undeclared refresh redirect; register its intentional destination")
            elif not page.noindex:
                expected = EXTERNAL_CANONICALS.get(source, page.url)
                if page.canonical != [expected]:
                    self.error(source, f"expected exactly one canonical {expected}")
                for tag in ("title", "h1", "main"):
                    elements = page.tags(tag)
                    if len(elements) != 1 or not elements[0].text.strip():
                        self.error(source, f"indexable page needs one nonempty {tag}")
                if len(page.metas("description")) != 1 or not page.metas("description")[0].strip():
                    self.error(source, "indexable page needs one nonempty meta description")
                for heading in [x for x in page.elements if re.fullmatch(r"h[1-6]", x.tag)]:
                    if not heading.text.strip():
                        self.error(source, f"empty {heading.tag}", heading.line)
                self.stats["indexable_pages"] += 1
            else:
                self.stats["noindex_pages"] += 1
            self.structured[source] = []
            for node in page.elements:
                for attribute in ("href", "src", "poster", "action", "formaction"):
                    if attribute in node.attrs:
                        self.check_url(node.attrs[attribute], page.url, source, node.line)
                if "srcset" in node.attrs:
                    for url in srcset_urls(node.attrs["srcset"]):
                        self.check_url(url, page.url, source, node.line)
                        self.stats["srcset_candidates"] += 1
                if "style" in node.attrs:
                    self.check_css(node.attrs["style"], page.url, source, node.line)
                if node.tag == "style":
                    self.check_css(node.text, page.url, source, node.line)
                if node.tag == "meta" and node.attrs.get("property", node.attrs.get("name", "")) in ("og:image", "twitter:image", "og:url"):
                    self.check_url(node.attrs.get("content"), page.url, source, node.line, fragments=False)
                if node.tag == "script" and node.attrs.get("type") == "application/ld+json":
                    try:
                        data = json.loads(node.text)
                    except json.JSONDecodeError as exc:
                        self.error(source, f"invalid JSON-LD: {exc}", node.line)
                        continue
                    if not isinstance(data, (dict, list)):
                        self.error(source, "JSON-LD must be an object or array", node.line)
                        continue
                    self.structured[source].extend(json_nodes(data))
                    self.stats["json_ld_blocks"] += 1
                    for record in json_nodes(data):
                        for key in ("@id", "url", "image", "contentUrl", "logo"):
                            values = record.get(key, [])
                            if isinstance(values, str):
                                values = [values]
                            if isinstance(values, list):
                                for value in values:
                                    if isinstance(value, str):
                                        self.check_url(value, page.url, source, node.line, fragments=False)
        for path in sorted(self.root.rglob("*.css")):
            if public_path(path, self.root):
                relative = path.relative_to(self.root).as_posix()
                self.check_css(path.read_text(), ORIGIN + "/" + relative, relative)
                self.stats["css_files"] += 1

    def check_sitemap(self):
        try:
            document = ET.parse(self.root / "sitemap.xml")
        except (OSError, ET.ParseError) as exc:
            self.error("sitemap.xml", str(exc))
            return
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        urls = [node.text.strip() if node.text else "" for node in document.findall("s:url/s:loc", ns)]
        self.stats["sitemap_urls"] = len(urls)
        if not urls:
            self.error("sitemap.xml", "no sitemap URLs found")
        for url, count in Counter(urls).items():
            if count > 1:
                self.error("sitemap.xml", f"duplicate URL {url}")
            parsed = urlsplit(url)
            if parsed.scheme != "https" or parsed.netloc != "nickrae.net" or parsed.query or parsed.fragment:
                self.error("sitemap.xml", f"expected an absolute canonical URL, got {url!r}")
                continue
            target = self.target(url)
            if target is None or not target.is_file():
                self.error("sitemap.xml", f"missing/non-public target {url}")
                continue
            page = self.pages.get(target)
            if page:
                if page.noindex or page.relative in REDIRECTS or page.canonical != [url]:
                    self.error("sitemap.xml", f"non-canonical, noindex or redirect page listed: {url}")
            elif target.relative_to(self.root).as_posix() in VERIFICATION_FILES:
                self.error("sitemap.xml", "verification files do not belong in the sitemap")
        for page in self.pages.values():
            if not page.noindex and page.relative not in REDIRECTS and page.relative not in EXTERNAL_CANONICALS and page.url not in urls:
                self.error("sitemap.xml", f"indexable page absent: {page.url}")

    def check_workbooks(self):
        source = "data/workbooks.json"
        try:
            data = json.loads((self.root / source).read_text())
            products = data["products"]
            if not isinstance(products, list):
                raise ValueError("products must be a list")
        except (OSError, ValueError, KeyError) as exc:
            self.error(source, f"invalid workbook registry: {exc}")
            return
        ids = [x.get("id") for x in products if isinstance(x, dict)]
        if len(products) != 5 or set(ids) != WORKBOOK_IDS or len(set(ids)) != len(ids):
            self.error(source, "expected exactly five unique known workbook IDs")
            return
        asins, product_keys = {}, {}
        for product in products:
            for key in ("slug", "product", "name", "pb", "kindle"):
                if not isinstance(product.get(key), str) or not product[key]:
                    self.error(source, f"{product['id']} missing {key}")
                    return
            for field_name, format_name in (("pb", "paperback"), ("kindle", "kindle")):
                asin = product[field_name]
                if not re.fullmatch(r"[A-Z0-9]{10}", asin) or asin in asins:
                    self.error(source, f"invalid or repeated ASIN {asin!r}")
                asins[asin] = (product["id"], format_name)
            product_keys[product["product"]] = product["pb"]
            product_keys[product["product"] + "_kindle"] = product["kindle"]
            paths = ["aviation-workbooks/index.html", f"aviation-workbooks/{product['slug']}/index.html"]
            for relative in paths:
                page = self.pages.get((self.root / relative).resolve())
                if not page:
                    self.error(source, f"missing workbook page {relative}")
                    continue
                for kind in ("pb", "kindle"):
                    expected_asin = product[kind]
                    expected_key = product["product"] + ("_kindle" if kind == "kindle" else "")
                    matches = [a for a in page.anchors if a.attrs.get("data-product") == expected_key and urlsplit(a.attrs.get("href", "")).path == "/dp/" + expected_asin]
                    label = "kindle" if kind == "kindle" else "paperback"
                    if not any(label in (a.text + " " + a.attrs.get("aria-label", "")).lower() for a in matches):
                        self.error(relative, f"missing correctly labeled {product['id']} {label} link to {expected_asin}")
                if relative != paths[0]:
                    books = [n for n in self.structured.get(relative, []) if n.get("@type") == "Book"]
                    for kind, schema_format in (("pb", "Paperback"), ("kindle", "EBook")):
                        if not any(n.get("url") == "https://www.amazon.com/dp/" + product[kind] and n.get("bookFormat", "").endswith("/" + schema_format) for n in books):
                            self.error(relative, f"Book JSON-LD lacks matching {kind} ASIN/format")
            self.stats["workbooks"] += 1
        for page in self.pages.values():
            for anchor in page.anchors:
                parsed = urlsplit(anchor.attrs.get("href", ""))
                if parsed.hostname not in ("amazon.com", "www.amazon.com"):
                    continue
                match = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})(?:/|$)", parsed.path)
                if not match:
                    continue
                asin = match.group(1)
                product_key = anchor.attrs.get("data-product")
                if product_key in product_keys and asin != product_keys[product_key]:
                    self.error(page.relative, f"{product_key} points to {asin}, expected {product_keys[product_key]}", anchor.line)
                if asin in asins:
                    label = (anchor.text + " " + anchor.attrs.get("aria-label", "")).lower()
                    expected_format = asins[asin][1]
                    if "paperback" in label and expected_format != "paperback":
                        self.error(page.relative, f"paperback label points to Kindle ASIN {asin}", anchor.line)
                    if "kindle" in label and "paperback" not in label and expected_format != "kindle":
                        self.error(page.relative, f"Kindle label points to paperback ASIN {asin}", anchor.line)
                    self.stats["amazon_identity_links"] += 1

    def check_page_registry(self):
        source = "data/pages.json"
        try:
            records = json.loads((self.root / source).read_text())["pages"]
            if not isinstance(records, list):
                raise ValueError("pages must be a list")
            sitemap = ET.parse(self.root / "sitemap.xml")
        except (OSError, ValueError, KeyError, ET.ParseError) as exc:
            self.error(source, f"invalid page registry or sitemap: {exc}")
            return
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        lastmods = {n.findtext("s:loc", namespaces=ns): n.findtext("s:lastmod", namespaces=ns)
                    for n in sitemap.findall("s:url", ns)}
        expected = {p.relative for p in self.pages.values()
                    if not p.noindex and p.relative not in REDIRECTS and p.relative not in EXTERNAL_CANONICALS}
        paths = [r.get("path") for r in records if isinstance(r, dict)]
        if len(paths) != len(records) or len(set(paths)) != len(paths) or set(paths) != expected:
            self.error(source, "registry must list each indexable primary HTML page exactly once")
        for record in records:
            if not isinstance(record, dict):
                continue
            relative = record.get("path", "")
            if not isinstance(relative, str):
                self.error(source, "page path must be a string")
                continue
            page = self.pages.get((self.root / relative).resolve())
            if not page:
                continue
            if record.get("url") != page.url:
                self.error(source, f"{relative} has the wrong canonical URL")
            changed = record.get("last_content_change", "")
            try:
                if date.fromisoformat(changed).isoformat() != changed:
                    raise ValueError("not normalized")
            except (ValueError, TypeError):
                self.error(source, f"{relative} needs a YYYY-MM-DD content revision date")
            if lastmods.get(page.url) != changed:
                self.error(source, f"{relative}: content revision date differs from sitemap lastmod")
            for node in self.structured.get(relative, []):
                if node.get("@type") == "BlogPosting" and node.get("dateModified") != changed:
                    self.error(relative, "BlogPosting dateModified differs from the content registry")
            social = record.get("social_image")
            if social:
                self.check_url(social, page.url, source, fragments=False)
                images = [n.attrs.get("content") for n in page.tags("meta") if n.attrs.get("property") == "og:image"]
                if images != [social]:
                    self.error(relative, "og:image differs from the page registry")
        self.stats["registered_pages"] = len(records)
        config = (self.root / "_config.yml").read_text()
        exclusions = re.search(r"^exclude:\s*\n((?:[ \t]+.*\n?)*)", config, re.M)
        listed = re.findall(r"^\s+-\s+([a-zA-Z0-9_-]+)\s*$", exclusions.group(1), re.M) if exclusions else []
        if not {"scripts", "data"}.issubset(listed):
            self.error("_config.yml", "internal scripts and data registries must be excluded from the public Jekyll build")

    def check_kit(self):
        actual_pages = set()
        for page in self.pages.values():
            scripts = [x for x in page.tags("script") if "data-uid" in x.attrs or "nick-rae.kit.com/" in x.attrs.get("src", "")]
            if not scripts:
                continue
            actual_pages.add(page.relative)
            if len(scripts) != 1:
                self.error(page.relative, "expected one Kit embed")
            for script in scripts:
                if script.attrs.get("data-uid") != KIT_UID or script.attrs.get("src") != KIT_SCRIPT or "async" not in script.attrs:
                    self.error(page.relative, "Kit script UID, source or async attribute differs from the approved form", script.line)
                if not script.inside_signup:
                    self.error(page.relative, "Kit script must be inside .ppl-signup", script.line)
            if "free-ppl-cards" not in page.ids:
                self.error(page.relative, "missing free-ppl-cards anchor")
            if not any(a.attrs.get("href") == KIT_FORM and a.inside_signup for a in page.anchors):
                self.error(page.relative, "missing hosted-form fallback within .ppl-signup")
            if not any(urljoin(page.url, a.attrs.get("href", "")) == ORIGIN + "/privacy/" and a.inside_signup for a in page.anchors):
                self.error(page.relative, "missing privacy link within .ppl-signup")
        if actual_pages != KIT_PAGES:
            self.error("Kit placements", f"missing={sorted(KIT_PAGES - actual_pages)}, unexpected={sorted(actual_pages - KIT_PAGES)}")
        self.stats["kit_placements"] = len(actual_pages)

    def run(self):
        self.load_pages()
        self.check_pages()
        self.check_sitemap()
        self.check_workbooks()
        self.check_kit()
        self.check_page_registry()
        return {"ok": not self.errors, "counts": dict(self.stats), "intentional_verification_files": self.ignored, "errors": self.errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--json", type=Path, help="optionally save the machine-readable check result")
    args = parser.parse_args()
    result = Audit(args.root).run()
    if args.json:
        args.json.write_text(json.dumps(result, indent=2) + "\n")
    for error in result["errors"]:
        print("ERROR " + error)
    print(("PASS" if result["ok"] else "FAIL") + ": " + ", ".join(f"{k}={v}" for k, v in result["counts"].items()))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
