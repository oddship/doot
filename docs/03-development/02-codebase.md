# Codebase map

```text
app/                 Next.js pages and API route handlers
app/styles/          Ordered global cascade split by UI responsibility
components/          Product UI and schema-driven workspace renderer
components/ui.tsx    Shared visual primitives
demo-site/           Export-only Next app and frozen fictional API responses
lib/                 Domain, persistence, IMAP, agent, and client helpers
scripts/             Developer and visual-audit automation
tests/               Unit and executable architecture-contract tests
types/               Process-wide TypeScript declarations
public/              Product marks and static assets
docs/                Moat source, pinned base layout, and branded docs theme
.github/             CI, release, Pages, and contribution automation
server.mjs           Next.js + WebSocket process entry point
```

## Module ownership

- `lib/database.ts` owns connection setup, migrations, settings defaults, and indexed query primitives.
- `lib/store.ts` is the compatibility command boundary used by routes and agent tooling. New domain behavior should live in a focused module and be called from this boundary.
- `lib/api/` contains the typed catch-all API dispatcher and bounded domain handlers. `app/api/[...path]/route.ts` only adapts Next.js requests and centralizes error responses.
- `lib/imap.ts` owns safe connection, sync, read, and mutation operations; provider-specific mailbox semantics live in `mail-provider.ts` and `imap-folder.ts`.
- `lib/agent-runtime.ts` owns session lifecycle and tool translation. Workspace validation lives separately in `workspace.ts` and patching in `workspace-patch.ts`.
- Client persistence helpers isolate browser selection, conversation, and Flow-selection state from page components.
- Production screens stay data-driven and are shared with the static demo; `demo-site` may adapt transport and navigation but must not reimplement those screens.
- `app/globals.css` is an import manifest. Foundation, screen, theme, responsive, and feature rules stay in ordered files under `app/styles/`; preserve import order when cascade precedence matters.

## Repository inventory

Every tracked file belongs to one of these discovery or ownership paths:

- Next.js discovers pages, layouts, icons, and route handlers under `app/`; the `/rules` pages are intentionally retained as compatibility redirects to canonical `/flows` URLs.
- TypeScript imports connect every module under `components/` and `lib/` to a runtime, demo, or test entry point. Shared Flow page loading lives under `app/flows/`, not the legacy redirect directory.
- `app/globals.css` imports every tracked file in `app/styles/` in cascade order.
- Vitest discovers every `tests/*.test.ts` file; `tests/source-contract.ts` is their shared source-inspection helper.
- The export-only Next app imports every `demo-site/fixtures/*.json` fixture. The Pages workflow watches shared components, styles, libraries, lockfiles, and demo sources so the hosted demo cannot silently lag behind production UI.
- Moat discovers the Markdown tree under `docs/`; `_layout.html`, `_static/`, and `config.toml` are its layout, asset, and configuration inputs.
- Root manifests, lockfiles, container/Nix/Just configuration, GitHub metadata, and governance documents are entry points for their named tools rather than application imports.
- `public/doot-mark.svg` and `public/doot-logo.svg` are duplicated under `docs/_static/` intentionally because Moat copies only its documentation source tree. `app/icon.svg` is the square-background Next.js application icon.

The following local paths are generated or environment-owned and must stay untracked:

| Path | Purpose |
| --- | --- |
| `node_modules/`, `.next/`, `demo-site/.next/` | Dependency and Next.js build caches |
| `demo-site/out/`, `demo-site/public/`, `_site/` | Repeatable static demo and documentation output |
| `artifacts/` | Local UI audit screenshots and reports |
| `email-cache.sqlite3*` | Private local mailbox cache, settings, credentials, and history |
| `.direnv/`, `*.tsbuildinfo` | Local Nix shell and TypeScript caches |
| `.agents/`, `.codex/` | Optional coding-environment mounts; not repository content |

## Organization rule

Prefer a focused domain module over adding another large branch to a UI component or `store.ts`. Keep API parsing thin, persistence explicit, and safety checks close to the operation they protect.
