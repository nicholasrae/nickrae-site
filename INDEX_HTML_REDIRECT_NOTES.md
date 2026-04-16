# index.html duplicate cleanup notes

## What was done in repo
Client-side canonical guards were added so these explicit URLs immediately replace to the slash version in the browser while preserving query strings and fragments:
- `/index.html` -> `/`
- `/blog/index.html` -> `/blog/`
- `/feedfare/index.html` -> `/feedfare/`
- `/flight-funded/index.html` -> `/flight-funded/`

This improves user-facing duplication, but it is **not** a true HTTP 301.

## What still needs to happen for the real SEO fix
GitHub Pages serves `index.html` files as 200 responses. If you want Google to see a true redirect instead of a canonical-plus-JS hint, do it at the edge.

## Best path: Cloudflare redirect rules
Create 4 redirect rules:

1. If path equals `/index.html`
   - Forwarding URL
   - 301
   - Destination: `https://nickrae.net/`

2. If path equals `/blog/index.html`
   - 301
   - Destination: `https://nickrae.net/blog/`

3. If path equals `/feedfare/index.html`
   - 301
   - Destination: `https://nickrae.net/feedfare/`

4. If path equals `/flight-funded/index.html`
   - 301
   - Destination: `https://nickrae.net/flight-funded/`

## Why this matters
Right now Google can still fetch both URLs as 200s:
- `/blog/`
- `/blog/index.html`

That creates duplicate canonical noise.
A real 301 removes the ambiguity.

## Verification after Cloudflare rule setup
Check with a no-redirect request and confirm:
- `https://nickrae.net/index.html` -> 301
- `https://nickrae.net/blog/index.html` -> 301
- `https://nickrae.net/feedfare/index.html` -> 301
- `https://nickrae.net/flight-funded/index.html` -> 301

Then re-run coverage checks in GSC.
