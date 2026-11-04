Nick Rae PPL consent service — prepared, disabled by default

Run tests from this directory with npm ci --no-audit --no-fund, then npm test.
The dev dependency is the official pinned Miniflare4.20260730.0 package; tests
execute the actual workerd Durable Object with SQLite and no external requests.
Node25 is used for the separate node:sqlite core time/expiry cases.

python3 bundle.py writes dist/consent-worker.bundle.mjs and its SHA256 manifest.
This single file imports only the Workers builtin cloudflare:workers and can be
reviewed in the Dashboard editor. It contains no account, Kit or importer secret.
The modular Wrangler config is also supplied for a later approved deployment.

No resources, migrations, credentials, public API or binding have been created by
these files. Root must obtain approval for the concrete new endpoint/storage and
importer access before deploying. Defaults: SERVICE_ENABLED=false, no routes,
workers.dev=false, preview_urls=false and observability=false. Actual SQLite DO
class PplConsentLedger needs the v1 new_sqlite_classes migration. The existing
nickrae-production Pages project then needs service binding PPL_CONSENT and
PPL_CONSENT_ENABLED=true. The private Worker needs SERVICE_ENABLED=true and a
server-only IMPORTER_TOKEN_SHA256, while the raw token stays private on the Mac.
The existing Kit key never leaves the Mac.

Exact API and owner review are in the task evidence directory:
ads-confirmed-matching-2026-11-04/service/api-contract.json
ads-confirmed-matching-2026-11-04/service/owner-review.txt

Rollback
Disable Pages PPL_CONSENT_ENABLED or the private Worker SERVICE_ENABLED first.
Existing authenticated /revoke requests remain available through both flags,
provided the binding/namespace remain; new grants/import access are disabled.
The native Kit form must keep working without optional measurement. Preserve the
Durable Object and its current consent/revocation/event history. Revert website
code or binding/flags only. Do not delete/recreate the namespace, restore an older
ledger/PITR snapshot, rotate around consent failures, or reissue a used event key
as a rollback shortcut: those actions could resurrect revoked grants or duplicate
an acquisition. Keep any unknown external dispatch in the Mac quarantine until
the same transaction is reconciled. Changing flags cannot recall data already
sent to Google; this service has no Google sender or correction operation.
