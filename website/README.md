# Timeblock website

Static marketing/docs/download site for Timeblock, built with [Astro](https://astro.build).
This is Phase 1 of the website plan: home, docs and download pages only — no accounts, no
backend. Content is kept in sync by hand with the main repo's `README.md`/`CHANGELOG.md`;
there's no build-time scrape.

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # -> dist/
```

The download page fetches the latest **published** (non-draft) GitHub release at build
time and falls back to build-from-source instructions when there isn't one yet.

Deployment (`.github/workflows/site.yml`) is `workflow_dispatch`-only for now: it targets
the same GitHub Pages slot the app's own demo build (`.github/workflows/pages.yml`,
deployed from `gh-pages-source`) already uses, and the two haven't been reconciled — see
the website plan's open questions. Wire up an automatic trigger once that's decided.

Sync/auth (login, account, cross-device sync) is a separate, later phase and intentionally
not started here — it needs an explicit decision on the backend/auth provider first.
