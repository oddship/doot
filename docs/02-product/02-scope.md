# Feature scope and maturity

| Area | v0.1 status | Boundary |
| --- | --- | --- |
| IMAP | Evaluation-ready | Common IMAP servers; Gmail special-use folders are normalized separately |
| Sync | Incremental headers | Manual trigger; no daemon scheduler |
| Reader | Safe cached body reader | Not a full mail composition client |
| Agent | Manual, tool-driven analysis | Provider behavior and cost vary by selected model |
| Workspaces | Schema-validated components | No arbitrary model-authored UI |
| Flows | Draft, preview, edit, run | Run always confirms; no automatic execution |
| Memory | Bounded namespaced KV | Retrieved on demand, not injected every turn |
| Deployment | Local Node/Docker | No authentication or public hosting support |

The first stabilization priority is safety and correctness, followed by observability and performance. New surface area should wait until existing account, sync, search, proposal, and Flow paths are dependable across providers.
