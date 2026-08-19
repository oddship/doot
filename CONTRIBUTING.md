# Contributing to Doot

Thanks for helping improve Doot. Keep changes small, safety-preserving, and easy to review.

## Setup

Use Node.js 22/23 with `npm ci`, or run `direnv allow` to enter the Nix shell. Copy `.env.example` to `.env`, then use `just dev`.

Before opening a pull request:

```bash
just check
just build
```

For UI changes, run the server and `just ui-check`; inspect every image in `artifacts/ui-audit` at 1920×1080.

## Design rules

- Preserve the confirmation boundary for every mailbox write.
- Never inject an entire mailbox or unbounded memory into an agent prompt.
- Keep generated UI schema-driven; do not allow model-authored HTML, CSS, URLs, or handlers.
- Use `BODY.PEEK[]` for reads and retain remote-image blocking and HTML sanitization.
- Add a regression test for behavior changes.

Use Conventional Commit-style subjects where practical (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
