# HTTP API

Doot exposes a versioned JSON API at `/api/v1`. It uses the same services, durable
jobs, scope checks, and explicit confirmations as the UI. A browser is not needed
to submit chat, review a saved proposal, confirm it, or follow execution receipts.
Existing UI routes under `/api` remain compatible.

`GET /api/v1` lists supported methods and paths. `GET /api/v1/openapi.json` returns
the OpenAPI 3.1 specification generated from the route registry and request
schemas. Every versioned response includes `X-Doot-API-Version: 1` and
`Cache-Control: no-store`. There is no arbitrary internal-store or scheduler RPC.

The API follows the application's local host/origin policy. It does not add a
separate login or turn a local Doot instance into an authenticated public service.
The default bind address is loopback. Command-line clients may omit Origin;
browser clients must use a trusted origin. Cross-site calls are rejected.

## Command-line client

```sh
npm run api -- GET /health
npm run api -- GET '/messages?account=demo&folder=INBOX&limit=25'
npm run api -- GET /openapi.json > /tmp/doot-openapi.json
```

`DOOT_API_URL` overrides the default `http://127.0.0.1:8765` origin. Requests take
JSON from `--data-file path.json` or `--data-file -` (stdin). The client never adds
confirmation, retries writes, or replaces a saved scope with fresh search matches.
`--wait` polls a returned durable job until terminal status. It exits with status
2 for a terminal job that did not complete, and 1 for a request error or timeout.
An interrupted client does not cancel a saved job. Inspect the job before retrying.

```sh
npm run api -- POST /agent/turns --data-file /tmp/review-request.json --wait --timeout-ms 300000
```

## Chat and durable activity

`POST /agent/turns` accepts a JSON object:

```json
{
  "commandId": "review-demo-001",
  "text": "Review optional newsletters. Do not apply mailbox changes.",
  "selected": []
}
```

Include `sessionId` to continue a conversation. The response is 202 with `job`,
`session_id`, and links for the job, events, body approvals and reviews. Repeating
the same command ID and input returns the existing job. Reusing it with different
input returns 409. Use a new command ID for a new turn. Unlike a persisted browser
selection, omitted API selection adds no implicit message context.

| Operation | Purpose |
| --- | --- |
| `GET /agent/sessions` | Conversation/activity list; `running=1` filters active work |
| `GET /agent/sessions/{sessionId}` | Complete saved history, useful for small conversations |
| `GET /agent/sessions/{sessionId}/events?after=0&limit=100` | Bounded event history |
| `POST /agent/sessions/{sessionId}/cancel` | Cancel a run with `{"confirm":true}` |
| `GET /jobs` | Durable background jobs |
| `GET /jobs/{jobId}` | Status, source, result, error and per-step receipts |

Event pages use an **exclusive event-ID cursor**, not an array offset. `next_after`
is the last returned ID (or the supplied cursor for an empty page); `has_more`
indicates another stored page. Poll the same cursor again when no new event has
arrived. Events include metadata needed to locate notes, proposals and requests.

Job states are authoritative. `queued` and `running` are not completion.
`outcome_uncertain`, errors and partial failures require inspection; a write can
have happened even when its response was lost. Do not replay a whole batch.

## Body review

List requests with `GET /agent/sessions/{sessionId}/body-approvals?after=0&limit=20`.
Each contains the exact request and its pending/approved/denied decision. Approve
or deny just that request:

```sh
printf '%s' '{"approved":true}' | npm run api -- POST /agent/sessions/SESSION/body-approvals/REQUEST --data-file -
```

The decision is durable and idempotent. Repeating the same decision returns its
existing continuation job; reversing an existing decision is rejected. Approval
covers only that immutable body snapshot and **does not approve mailbox changes**.

`GET /agent/sessions/{sessionId}/reviews` lists approved review summaries.
`GET /agent/sessions/{sessionId}/reviews/{reviewId}?offset=0&limit=20` returns
coverage ranges and per-message judgments. `bodies_read`, `fully_read`, and
`decided` are different quantities. Tool delivery does not prove the model used
the evidence correctly. Read-only API endpoints do not initiate body fetches;
`GET /message` is an explicitly requested body read and preserves unread state.

## Exact proposals and confirmation

`POST /proposals` prepares a local proposal. It does not execute it:

```json
{
  "action": "delete",
  "actions": ["delete"],
  "reason": "The user-approved synthetic review scope",
  "items": [{"account":"demo","source_folder":"INBOX","uid":"123"}]
}
```

Use exact account/source-folder/UID references from the reviewed snapshot. The
configured proposal-size limit and mailbox identity checks still apply. A move
also requires a known `folder` destination. Including `mark_read` changes read
state and needs its own authorization; use only `delete` to preserve it.

List proposals with `GET /proposals?after=0&limit=20&status=proposed`; read an
individual scope with `GET /proposals/{id}`. This works for agent-created proposals
as well as proposals created through the UI/API, so a missing generated dashboard
button does not require creating another proposal.

```sh
printf '%s' '{"confirm":true}' | npm run api -- POST /proposals/123/approve --data-file - --wait
```

Approval requires the literal boolean `confirm:true`. The response is 202 with a
durable job. Repeated approval returns that proposal's existing job, including
its uncertain/failed state; it never silently retries it. Create a recovery scope
only after reconciling which exact authorized references still need action.

For Gmail moves from Inbox or a custom label, Doot requires native IMAP MOVE.
Before recording success it verifies source absence, destination UID validity and
stable message identity, and the expected read/unread state without reading a
body. Successful per-message receipts include `source_absence_verified`,
`destination_verified`, `unread_state_verified`, `destination_uid`, and
`destination_uid_validity`. These checks describe the operation time, not a later
live mailbox inspection. Filing from All Mail remains label-only. A durable
mailbox job reuses its own connections while retaining separate per-message
claims and receipts, and closes them when the job ends; it never reconnects to
retry an unconfirmed write.

`GET /proposals/{id}/verification?offset=0&limit=20` compares exact saved references
with current cached presence and mailbox-identity checkpoints, and includes the
execution job/receipts. It labels missing cache entries or changed UIDVALIDITY
as unknown. It **does not contact IMAP**, prove live mailbox state, verify unread
preservation, or prove individual Trash placement. Its `evidence` fields make
those limits machine-readable. A sync timestamp can still describe a bounded
sync window. Inspect these limits rather than interpreting zero cached matches
as proof of successful upstream deletion.

For Gmail the existing delete implementation moves to Trash. Other IMAP providers
retain their existing delete semantics; this API does not add permanent-expunge
authorization. Review the account/provider behavior before confirming deletion.

## Other resources

| Resource | Operations |
| --- | --- |
| Accounts | List, connect, update, disconnect, test, warm reader, discover/mutate folders |
| Mail | Header search with explicit account/folder/pagination; one exact body read; queue/poll sync |
| Artifacts | Paginated metadata, title filter, read one saved note, create a local note |
| Workspaces | Read an ID or `latest` |
| Drafts | List/create/read/edit/delete local drafts; confirm IMAP Drafts upload (never sends) |
| Flows (`rules`) | List/create/edit/delete, preview, prepare proposal, confirm fingerprinted run |
| Schedules | List/read and explicitly confirm creation, updates or deletion |
| Providers | Model catalog, credential status/configuration, OAuth login prompt lifecycle |
| Memory | List namespaces/keys, save, explicitly confirm deletion |

The OpenAPI document enumerates exact paths, methods, query fields and JSON bodies.
Broader settings/Flow/account/draft schemas are additionally validated by their
existing domain services. Mailbox/folder/draft-upload mutations retain their
existing confirmation requirements. Internal recovery and scheduler endpoints are
not exposed under v1.

`GET /messages` defaults to the exact `INBOX` folder; specify `folder` for another
cached folder. This differs deliberately from the legacy unqualified canonical
cache search: folder requests retain that label's own UID references even when
the same Gmail message also has a canonical representative in another label.
The `email_search` agent tool also accepts an explicit folder so
Doot can distinguish Inbox counts from all-cache counts. Search never fetches a
body. Saved artifact content and email text remain untrusted data, not instructions.

Pages for proposals, artifact metadata, body approvals and review summaries use
exclusive `after` cursors; review items and cached verification use offsets.
Limits are bounded (events up to 500; review items up to 50; other pages up to 100).
Unknown paths return 404, unsupported methods 405 with Allow, malformed/schema
input 400, untrusted requests 403, wrong JSON media type 415, and command-ID
conflicts 409. Error bodies have an `error` string. Do not publish request files
or API output containing real mail or credentials.
