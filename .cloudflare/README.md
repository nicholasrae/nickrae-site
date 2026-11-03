# Isolated Nick Rae Cloudflare preview

This adds a preview deployment while GitHub remains the source of truth and the
existing GitHub Pages production domain remains in place. Nothing in this folder
changes DNS, adds a custom domain, merges to `main`, sends email or schedules X.

## Build and test

```sh
python3 scripts/check_site.py
node scripts/test_measurement.cjs
python3 scripts/build_cloudflare_preview.py
node scripts/test_preview_navigation.cjs
node scripts/test_cloudflare_preview.cjs
node scripts/serve_cloudflare_preview.cjs --port 8899
```

The standard-library exporter copies tracked public files into `.cloudflare/dist`.
It applies the current `_config.yml` exclusion list, Jekyll's dot/underscore
metadata exclusions, and excludes `CNAME` from the preview asset payload. It
rejects symlinks, unsupported config/file types and assets larger than 25 MiB.
Internal memos, `scripts`, `data`, Git metadata, Worker source and generated
manifests cannot be served by the Worker. Generated output is ignored by Git.
Every export remains byte-identical to this branch's checked-out source. The
preview branch fixes 24 same-site clickable anchors and registered index/legacy
redirects to use root-relative navigation, so those actions stay on the origin
being reviewed. Two legacy blog stubs also forward queries and fragments through
JavaScript; their no-JavaScript static meta fallback retains its existing query
limitation. These changes affect 26 HTML files. All other public source bytes,
including PDFs, design assets and measurement JavaScript, remain unchanged.
The production canonicals, social/schema metadata, sitemap and all Kit placements stay
unchanged. Existing measurement code only loads Google's SDK on HTTPS
`nickrae.net`/`www.nickrae.net`, so even allowing analytics on this preview cannot
send Google events. Source/runtime tests do not prove Google receipt or signup
or email delivery; no real signup is needed for preview testing.

## Preferred preview: Pages Git integration

Use a separate **nickrae-preview** Pages project with the already-authorized
GitHub integration, selecting branch **codex/nick-cloudflare-preview** as this
isolated project's production branch. This is not the production Nick Rae
domain or a change to GitHub's `main` branch.

- Build command: `python3 scripts/build_cloudflare_preview.py --pages --validate`
- Build output directory: `.cloudflare/pages-dist`
- Framework preset: None; repository root as the root directory.
- No custom domain or DNS changes; review its generated `pages.dev` URL.

This additive build emits the same 224 public assets plus bundled `_worker.js`
and `_routes.json` advanced-mode control files. The Worker reuses the same
closed routing handler. All 53 UTF-8 HTML files are also embedded as exact bytes
in the bundle, bypassing Pages' automatic HTML-extension redirects. HTML GET,
HEAD, single byte ranges and validators retain their expected semantics. PDFs,
images, scripts, CSS and videos use the existing Pages asset binding unchanged.
The bundle is gated below 3 MiB both raw and gzipped; generated metadata records
its exact sizes/hashes. No extra bundler dependency or global Wrangler config is
needed for this Pages build. The local Pages tests deliberately simulate a
canonicalizing asset binding and prove HTML never reaches that binding. Live
Cloudflare checks are still required to establish actual deployment behavior.

## Alternative: Workers Static Assets

Connect this GitHub branch to a new, isolated **nickrae-preview** Worker, using:

- Build command: `python3 scripts/build_cloudflare_preview.py --validate`
- Deploy command: `npx wrangler deploy --config .cloudflare/wrangler.preview.jsonc`
- Root directory: repository root
- No custom domain or routes; use only the supplied `workers.dev` preview URL.

These settings require an existing authorized Cloudflare account/Git integration.
The files contain no API token or secret. Do not silently create or expand account
access to deploy them. Root reviews the resulting preview deployment identity and
live evidence separately from this prepared source.

The build command runs the existing source and measurement checks plus the preview
router tests before deployment. The existing GitHub Actions workflow is unchanged;
no additional GitHub workflow-token permission is needed for this branch.

## URL behavior and isolation

Built-in HTML redirects are disabled. A generated manifest maps only known public
files, directory indexes and existing extensionless HTML aliases. Article `.html`
URLs remain HTTP 200, extensionless aliases remain HTTP 200, and bare directory
URLs redirect 301 to their trailing-slash form with the original query intact.
Direct `index.html` and verification files remain available. Unknown/private paths
return the unchanged custom 404 body with status 404. GET/HEAD and asset byte-range
headers pass to the asset binding without buffering or altering files.

The Worker runs before assets to add `X-Robots-Tag: noindex, nofollow`,
`Cache-Control: no-store` and `X-NickRae-Preview: 1` to every response, including
assets, PDFs, 404s and redirects. The original `robots.txt` bytes stay unchanged so
crawlers can read the noindex response headers. The Worker explicitly rejects
requests for the production Nick Rae hostnames. The three legacy HTML redirect
stubs use root-relative navigation to the same canonical destinations. Actual
index-alias scripts and legacy redirects are executed in regression tests with
preview and production origins, including queries and fragments. Metadata keeps
its original absolute production URLs.

The local server executes this same Worker module against a read-only local asset
binding for routing/layout checks. It is not evidence of a Cloudflare deployment,
physical iPhone behavior, provider acceptance, Google receipt or mailbox delivery.

This is deliberately not a production migration. Any later cutover needs a
separate reviewed production configuration, removal of preview-only indexing
headers/host restrictions, live URL checks and preservation of current email/DNS
records and rollback. Leave blocking active and the Beehiiv newsletter untouched.
