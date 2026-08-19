# Development workflows

`Justfile` is the discoverable developer interface; npm scripts remain the portable automation contract used by CI.

| Command | Purpose |
| --- | --- |
| `just setup` | Reproducible locked dependency install |
| `just dev` | Development server on localhost |
| `just check` | Biome, TypeScript, and Vitest |
| `just build` | Production Next.js build |
| `just ui-check` | Widescreen screenshot and console/overflow audit |
| `just audit` | Production dependency vulnerability audit |
| `just db` | Open the configured SQLite database |
| `just docker-up` | Build and run the container locally |

## Pull requests

CI runs quality checks and a production build on Linux. UI changes should include a local screenshot audit. Keep mailbox safety changes isolated and add contract tests for invariants that code review must preserve.

## Releases

Tags matching `v*` create a GitHub release and publish a multi-platform image to `ghcr.io/oddship/doot`. The repository version and changelog should be updated before tagging.

## Documentation

Documentation is built by the reusable `oddship/moat` GitHub Pages workflow whenever `main` changes under `docs/`.
