# Frozen demo

The [interactive Doot demo](https://oddship.github.io/doot/demo/) is a Next.js static export of the product experience with deterministic fictional messages. It is safe to explore: there is no backend, provider key, account credential, SQLite database, external service, or mailbox mutation path.

The demo is generated rather than edited as deployment output:

```bash
npm run demo:build
npm run demo:serve
npm run demo:screenshot
```

`demo-site/fixtures/*.json` contains response-shaped fixtures for the workspace, current conversation, inbox, message reader, Drafts, Flows, history, and settings APIs. The export-only Next entry mounts the same `WorkspaceClient`, `InboxClient`, `DraftsClient`, `RulesClient`, `HistoryScreen`, `SettingsClient`, and `AppHeader` used by the live application. A frozen transport supplies those components with fixture responses and rejects real persistence or mailbox writes.

`scripts/build-static-demo.mjs` runs Next with `output: "export"`, applies the `/doot/demo` Pages base path, and copies the result to `_site/demo`. It also publishes the source payloads below `_frozen-api/` so a reviewer can inspect exactly what feeds the demo. The screenshot command opens that generated output over HTTP, exercises every navigation view, rejects external requests, console errors, missing assets, and horizontal overflow, then writes the README image.

Only the export source and JSON fixtures are versioned. Next build directories and `_site/demo` are ignored; GitHub Actions generates the deployable site from scratch.

Changes to the application visual system or demo fixtures trigger the Pages workflow. CI builds both Moat documentation and the static Next export into one Pages artifact.
