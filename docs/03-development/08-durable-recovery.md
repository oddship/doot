# Pi Durable recovery assessment

This document records the isolated evaluation that preceded the live agent transition. Doot now uses Pi Durable for its agent loop; see [transition operation](09-durable-transition.md). These mock mailbox workflows remain isolated and are not permission to execute a real mailbox action.

## Tested prototype

Run `npm run prototype:durable` on Node 22.19+ (Doot currently uses 22.23.2). Exact production dependencies pin Pi Durable, Pi AI, and Chord to 1.0.3. Durable's API is experimental and may change without notice. Node's SQLite backend also emits an experimental warning.

`scripts/prototype-durable-recovery.mjs` uses the real Durable Harness, task checkpoints, memos, session documents, and SQLite storage. Separate child processes reopen temporary databases. Its only external effect appends a fake message-reference/action plan to a temporary journal. It imports no Doot mailbox/store/credential code, registers no real model providers, and cleans up its temporary directory.

Assertions cover:

- An unapproved review survives restart with zero effects.
- A changed review fingerprint is rejected.
- Successful approved work is not repeated after reopening.
- Cancellation before execution persists and causes no effect.
- Abrupt process exit before the fake effect, after persisting its claim, requires reconciliation.
- Abrupt exit after the fake effect but before its receipt also requires reconciliation, without repeating it.
- Cancellation of that uncertain work preserves the reconciliation requirement rather than claiming nothing happened.

The fake plan includes account, source folder, UID, UIDVALIDITY, ordered actions, and destination. Approval creates the task atomically with the review decision. The prototype intentionally stops at the first ambiguous effect; it does not implement real reconciliation, UI integration, multi-message retries, or automatic compensation.

## Approval adapter and per-step mock IMAP workflow

Run `npm run test:durable` for the expanded prototype (also included in `npm test`).

`experiments/durable-mailbox.ts` implements an isolated, framework-neutral browser request adapter using `Request`/`Response`. It is **not mounted in Next.js** and no live agent/app code imports it. Each review has an immutable, bounded snapshot of 1–5 exact message references, ordered actions, and destination. Approval requires `confirm: true` and the exact fingerprint. Concurrent approval attempts admit at most one task. Browser snapshots are detached from Durable's tracker-owned state; conversation forks do not inherit reviews or approvals.

The custom Durable task executes a Gmail-style mark-read/move sequence as three separately journaled commands per message:

1. Set `\\Seen`.
2. Add the destination label.
3. Remove the source label.

Each command validates source identity and UIDVALIDITY, commits an execution claim and intent, runs the mock transport outside the transaction, then atomically commits its receipt with the next checkpoint. Receipts and intent/approval/outcome audit entries remain after task completion. The batch stops at its first rejected or uncertain command; it does not continue or compensate automatically. Cancellation preserves acknowledged receipts and records reconciliation when an outstanding claim has no receipt.

Tests in `tests/durable-mailbox.test.ts` cover review persistence, explicit confirmation, duplicate approvals, detached snapshots, fork isolation, absent UIDs, changed UIDVALIDITY before/between steps, partial multi-message batches, interruption/reopen, and cancellation before/during a mock write.

`tests/helpers/mock-imap-wire.ts` hosts a tiny IMAP server bound only to `127.0.0.1` on an ephemeral port. The wire tests use the actual ImapFlow client with dummy credentials and only synthetic data. They exercise successful STORE commands, explicit source-label-removal rejection after two acknowledged writes, server-side label application followed by a dropped TCP connection before acknowledgement, and changed UIDVALIDITY. Reopening Durable never repeats the writes.

**Integration finding:** ImapFlow's STORE helpers catch failures and may return `false` for either a server rejection or a transport failure. `false` alone is not proof that no effect occurred. The fixture distinguishes explicit tagged `NO` through its captured command warning; all other unconfirmed writes remain uncertain. A production migration must use a reliable, structured acknowledgement/error interface rather than assuming the boolean means rejection. The current live action error wording now warns about this uncertainty instead of claiming rejection.

The mock transport marker is a test convention, not a sandbox/security boundary. These tests do not prove real Gmail behavior or automatically reconcile ambiguous outcomes. The browser adapter is protocol-tested, not wired to a browser UI or real accounts. Process-crash assertions remain in the original child-process prototype; expanded tests additionally exercise clean Harness shutdown/reopen with interrupted invocations.

## Important distinction: intent is not completion

Durable's effect sandwich commits intent, performs the external effect, then commits a receipt. IMAP and local SQLite cannot commit atomically together. A crash between these steps leaves the outcome unknown. A memo written *before* an effect proves only that execution may have started; skipping the effect on recovery avoids duplication but can also skip work that never happened. It must not be interpreted as a success receipt.

Built-in Durable tools default to `replay: "unsafe"`. Recovery reruns them only when both stored intent and the current declaration are safe. Mailbox mutations must remain unsafe. Even apparently idempotent `\\Seen` updates need exact identity/UIDVALIDITY and approval checks; moves/deletes must never be blindly replayed. The custom task prototype enforces an explicit fail-closed claim check because custom task phases otherwise resume from their saved checkpoint.

## Migration recommendation

Durable is promising for approval persistence, restart recovery, task cancellation, and committed progress. It is not a drop-in replacement for `createAgentSession`:

1. Persist exact body approvals, run body budgets, selected references, and Flow edit provenance. Conversation forks must not inherit mutation/body permissions accidentally (`fork: "initial"` for approval documents).
2. Keep browser confirmation and immutable proposal snapshots; retain existing Flow IDs and History links. Guard enforcement belongs inside every tool, not only an optional extension hook.
3. Map Durable numeric conversation/task/submission IDs to Doot's existing conversation IDs. Keep one persistence authority for each fact; do not pretend commits in two separate databases are atomic.
4. Adapt committed views/events to current browser streaming and History. Watches can coalesce intermediate updates, so they are not an audit log.
5. Separate read-only codemode from mutation tools. Recheck approval inside bounded body reads even after recovery.
6. Journal per-message/per-step intent and receipts. Unknown outcomes should pause for provider-aware inspection, cache reconciliation, and explicit user review—not automatic retry or rollback.
7. Test real transport ambiguity with a mock IMAP server, including label-add success/source-label-remove failure, UIDVALIDITY changes, partial batches, and cancellation during network writes.
8. Preserve single-writer ownership during shutdown/reopen. Harness close joins non-cooperative code; never open a second Harness against the same Session concurrently.

The selected transition replaces only the agent loop and persists its approvals/budgets/History context; it does not enroll mailbox mutations in Durable. The prototype findings justify keeping browser mailbox writes outside replay. Additional prototype UI work is not part of this transition.

Sources reviewed: the 1.0.3 package README/API and release-matched `packages/durable/docs/spec.md`, Chord guide, and extension/recovery examples from `earendil-works/pi` (git head `d78dc83d633229d12f8b79631384c4c2717c399f`).
