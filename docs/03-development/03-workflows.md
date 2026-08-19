# Development workflows

`Justfile` is the discoverable developer interface; npm scripts remain the portable automation contract used by CI.

| Command | Purpose |
| --- | --- |
| `just setup` | Reproducible locked dependency install |
| `just dev` | Development server on localhost |
| `just check` | Biome, TypeScript, and Vitest |
| `just build` | Production Next.js build |
| `just ui-check` | Widescreen screenshot and console/overflow audit |
| `npm run demo:build` | Generate the frozen, fictional Next.js Pages export |
| `npm run demo:serve` | Serve the generated Pages artifact at its production base path |
| `npm run demo:screenshot` | Rebuild and capture the README demo image |
| `just audit` | Production dependency vulnerability audit |
| `just db` | Open the configured SQLite database |
| `just docker-up` | Build and run the container locally |

## Pull requests

CI runs quality checks and a production build on Linux. UI changes should include a local screenshot audit. Keep mailbox safety changes isolated and add contract tests for invariants that code review must preserve.

## Releases

Tags matching `v*` create a GitHub release and publish a multi-platform image to `ghcr.io/oddship/doot`. The repository version and changelog should be updated before tagging.

## Documentation

The Pages workflow installs a pinned Oddship Moat release, builds documentation, then runs the repeatable Next static export into the same `_site` artifact. Demo source and frozen responses live in `demo-site/`; generated `_site` output is ignored.
