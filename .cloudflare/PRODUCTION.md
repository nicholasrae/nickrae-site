# Prepared Cloudflare production configuration

This is preparation only. GitHub remains the source, GitHub Pages still serves
the live domain, and no DNS, domain binding, deployment or merge is performed by
these scripts. The existing preview project and build command are unchanged.

## Separate explicit build

```sh
python3 scripts/build_cloudflare_production.py --validate
```

- Build output: `.cloudflare/production-dist`
- Framework: None; repository root is the build root.
- Branch under review: `codex/nick-cloudflare-production`.
- Root selects/reviews the separate Pages project and branch; do not replace the
  existing preview project's settings or attach a custom domain during preparation.
- No deploy command, API token, account ID, custom domain or DNS record is stored
  in this configuration. All prior source/measurement/preview tests also run.

The command reuses the existing tracked-file exporter and exact HTML adapter,
rebuilds the original preview fixtures, then emits a distinct production bundle.
It exports all 224 current public files byte-exactly and adds only `_worker.js`
and `_routes.json`. The separately authorized Kit fix changes five HTML files
from preview commit `3ebf534`; this is not a claim that all HTML still matches
that older preview. The 171 non-HTML assets, including all seven PDFs, tracking
JavaScript and design files, remain preserved. Internal configuration, scripts,
data and Git files remain absent from every public payload. Generated output is
ignored by Git.

## Production and candidate behavior

- HTTPS `nickrae.net` serves the original closed map of public files and aliases.
  Explicit `.html` and `index.html` URLs remain available; directory slash 301s
  preserve the original encoded query. Existing client index/legacy redirects
  retain their query/fragment behavior.
- `www.nickrae.net` returns the existing site's 301 to the same path/query on
  HTTPS `nickrae.net`. HTTP www combines its HTTPS and apex upgrade into one hop.
  Unknown hosts or nonstandard ports receive 421. Only GET/HEAD are served;
  writes and OPTIONS receive 405 without asset access or redirects.
- Only candidate hosts ending in `.pages.dev` are additionally accepted. Every
  candidate response, including redirects, errors, ranges and 304s, receives
  `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`. The unchanged
  analytics script also refuses production Google collection on those hosts.
- Production HTML uses `Cache-Control: no-cache` and a content-based ETag for
  revalidation. Source pages intentionally marked noindex keep their exact robots
  directives in metadata and an equivalent response header, including support,
  legal, thank-you and legacy pages. Ordinary pages receive no blanket noindex.
- Non-HTML assets retain Pages' own deployment-aware caching and validators.
  Stable PDF/script URLs are not assigned immutable or year-long cache rules.
  Error responses use no-store. No Cache API, custom CDN rule, HSTS or CSP is added.
- Unknown/private/control URLs return the full custom 404 with status 404,
  including HEAD requests; unrelated Range/validator headers cannot truncate it.
  Direct `/404.html` remains an available noindex document. All other HTML and
  PDF HEAD/range/validator behavior is covered by local tests.

Production canonicals, social/schema URLs, consent/QA tracking, Kit form identity
and subscription endpoint, PDFs, guide content, design and site tracking JavaScript
are unchanged. Source/browser behavior does not prove Google receipt, Kit
acceptance or email delivery.

## Kit embed maintenance

The five signup placements now contain the current official HTML embed copied
from Kit's form builder, including its official loader, UID `899d974875`, form ID
`10042240`, subscription endpoint and supported returning-visitor Show Form option.
An outdated hosted fallback is replaced by signup help; static confirmation-email
instructions remain visible outside the vendor form. The source receipt for this
separate change is `kit-supported-html-source-change.json` in the production release
evidence folder.

If Kit form content or options change later, recopy the complete supported HTML
from that same form's builder into the five maintained placements and rerun the
strict source and runtime checks. Do not independently alter Kit's SDK, security,
confirmation flow or fields to imitate the saved option. Verify a fresh signup,
authenticated confirmation, actual PDF delivery, and returning-browser reload on
the candidate; saved builder settings and local rendering alone do not prove
provider publication or delivery. Keep the existing consent/QA tracking code and
all subscriber account changes separately controlled.

## Future cutover and rollback record

Before any separately authorized cutover, record current DNS and GitHub Pages
settings, email/DNS authentication records, the exact production/candidate
deployment IDs and commit hashes, TLS/custom-domain readiness, and project
fail-closed behavior. The production project must use the explicit production
command above, not the preview build. Verify hosted headers, status codes, ranges,
bytes, full navigation and the real signup/delivery path before treating local
checks as hosted proof. No DNS change is part of this preparation.

Preserve GitHub Pages and its source/domain configuration as the existing serving
path. If a later authorized migration needs rollback, restore the recorded prior
DNS/hosting values and verify the live site and mail records; do not invent or
overwrite DNS values from this document. A Pages rollback also requires a known
good deployment of this production configuration. The preview-only `3ebf534`
bundle rejects production hosts, so it is not a production deployment rollback.
No rollback or cutover script runs automatically.

## Platform assumptions checked

[Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)
gives `_worker.js` control of routing and uses `env.ASSETS.fetch` for static files.
[Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
explains why Function response headers are applied in code rather than `_headers`.
[Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)
documents automatic HTML canonical redirects and deployment-aware asset caching.
The unchanged exact-byte HTML adapter avoids those automatic URL redirects.
