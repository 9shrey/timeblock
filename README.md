# Timeblock

Time-block your day (**Plan**), correct it to what really happened (**Actual**), and compare each weekly goal's target hours and outcomes against planned and actual time.

A local-first desktop app built with Tauri 2, React and TypeScript. Data lives in a SQLite file on your machine.

> Work in progress. See [docs/design/implementation-plan.md](docs/design/implementation-plan.md).

## Development

```bash
npm install
npm run dev          # browser mode (sql.js, data in localStorage) on http://localhost:1420
npm run tauri dev    # native app
npm run lint && npm test
```

License: MIT
