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

Deployment (`.github/workflows/site.yml`) auto-deploys on push to `main` (when
`website/**` changes), to the repo's existing GitHub Pages slot:
<https://9shrey.github.io/timeblock/>. This replaces the app demo that
`.github/workflows/pages.yml` used to publish there automatically — that workflow is
still around, `workflow_dispatch`-only, if you want the demo back at that URL
temporarily. No custom domain: the obvious `timeblock.*` names are all registered
already, and the free `*.github.io`-via-new-GitHub-org route (e.g. `usetimeblock.github.io`)
needs a human to actually create that org.

Sync/auth (login, account, cross-device sync) is a separate, later phase and intentionally
not started here — it needs an explicit decision on the backend/auth provider first.
