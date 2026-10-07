# Agent tools

The agent operates on bounded structured results rather than a preloaded mailbox dump.

- `email_dashboard_snapshot` — compact totals, accounts, recent headers, proposals, and latest workspace.
- `email_facets` — counts grouped by account, age, sender, and domain.
- `email_search` — targeted FTS5/field search with explicit limit, offset, totals, and next offset.
- `email_request_body_access` — displays an explicit browser approval card for exact message references; it does not read bodies.
- `email_read_selected` — reads only UI-selected messages through the safe reader.
- `email_propose_organization` — persists an approval-only archive, move, or delete proposal. Every item must use the exact source folder returned by search; folder-scoped IMAP UIDs are never inferred.
- `email_prepare_draft` — creates or revises a structured local draft; it cannot send mail or write to IMAP.
- `render_workspace` — persists a versioned validated component tree.
- `update_workspace` — applies a minimal validated patch; new top-level batches are prepended like a stack while explicit positions remain available for deliberate reordering.
- `email_write_artifact` — stores a local note, draft, or supporting artifact.
- Flow tools — create, retrieve, update, preview, and propose editable filters and actions.
- `memory_get`, `memory_list`, `memory_set`, `memory_delete` — CRUD over bounded namespaced SQLite JSON values.
- `codemode` — bounded read-only JavaScript for batching searches and approved body reads, inspecting Flows, and calling the preferred classifier with agent-authored questions.

## Classification in codemode

Choose a preferred model in Settings → Classification and save settings. This is separate from the conversation model. With no preference, Doot chooses an available classifier, preferring Jev Free when available. An explicitly selected unavailable model is never silently replaced. OpenCode Go credentials can access Zen's classifier catalog without storing a duplicate key.

The agent automatically uses the configured or available classifier for email triage, prioritization, categorization, relevance judgments, recommendations and candidate Flow decisions. Users do not need to name the classifier or tool. Its saved preference is included in every turn, including existing conversations. The agent designs questions and rubrics for each task. It may compose state from available headers, user-provided information, permitted memory, and body excerpts already selected or approved. Classifier calls cannot read mail or authorize actions. Simple factual lookups and drafting edits do not require a classification call.

```javascript
const [model] = await models.getAvailableOfType("classifier");
if (!model) throw new Error("Choose a classification model in Settings");
const result = await models.classify(model, {
  state: { evidence: "A fictional newsletter about database indexing", interests: ["databases"] },
  questions: {
    relevance: {
      type: "choice",
      instructions: "Does the evidence match the user's stated interests?",
      criteria: { relevant: "Matches an interest", unrelated: "Does not match", uncertain: "Insufficient evidence" },
    },
  },
});
if (result.stopReason !== "stop") throw new Error(result.errorMessage || result.stopReason);
store("relevance", result.answers);
return result.answers;
```

Questions support `choice` with a label-to-description criteria object, `bool` with `{true: description, false: description}`, and `score` with criteria ordered from lowest to highest. Rubrics and labels are unrestricted. Pi validates their typed structure; Doot enforces up to 12 questions and 32000 input characters per request, 40 requests and 400000 input characters per turn, four concurrent requests, and a 15-second provider timeout without automatic retries. Estimated cost reservations and reported usage stop further calls at a $0.05 turn budget; this is a catalog-based estimate rather than a billing guarantee. Scripts retain their existing 60-second deadline and 2000 output-token cap.

Only the resolved classifier is exposed in the script model catalog. Chat/image models, credentials, provider URLs, and arbitrary network access are unavailable. Classifier usage and call summaries accompany codemode results. Exact questions, answers, usage and an evidence-state hash are recorded in the durable session without adding another stored body copy. Codemode is marked unsafe to replay, so recovery does not automatically rerun its provider calls.

Tools return compact summaries, pagination metadata, and stable account/UID identifiers. The model is instructed to use exact Inbox query syntax and directly addressable Flow routes. Memory is fetched deliberately and is not appended to every turn.

When Doot needs an unselected body, it requests access with the exact sender, subject, and stable account/UID references. Approval adds only those messages to the persistent selection and starts a follow-up turn; the safe reader then uses `BODY.PEEK[]`. Denying the card reads nothing.

Selected drafts are resolved from SQLite before a turn so the agent can revise the exact artifact. Saving that artifact to the server-advertised `\Drafts` mailbox is a separate browser-confirmed API action.
