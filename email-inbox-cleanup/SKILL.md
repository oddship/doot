---
name: email-inbox-cleanup
description: Review and safely organize multiple connected email inboxes using read-first analysis, conservative categorization, approval-ready action plans, and UID-precise IMAP operations. Use for inbox cleanup, triage, archiving, labeling, or bulk email organization; do not use for composing or sending email.
---

# Email Inbox Cleanup

Use the existing email-clear project as the local email adapter when it is available:

`/home/rhnvrm/Documents/Code/inbox/email-clear/src/scripts/inbox.py`

Its configuration is at `/home/rhnvrm/Documents/Code/inbox/email-clear/config.json`, with credentials in the adjacent `.secrets` file. Never print, copy, modify, or commit credentials. Do not move the credentials into this skill directory.

## Operating contract

- Treat every inbox as a separate account. Always show the account and UID for proposed actions.
- Begin with a read-only header scan. Use the configured account names and a bounded date range; do not assume that “all mail” means the entire mailbox.
- Fetch message bodies only for uncertain, high-impact, or potentially personal/financial/security messages. Prefer brief views and avoid exposing unnecessary message content in reports.
- All inspection fetches must be read-preserving: use IMAP `BODY.PEEK[...]` (including `BODY.PEEK[]` for full content) and header-only fetches. Never use bare `RFC822`/`BODY[...]` for review because many servers mark the message `\\Seen`.
- Treat read/unread state as protected mailbox state. If the adapter cannot guarantee a non-`\\Seen` fetch, stop and fix or replace the adapter before reading message bodies.
- Produce a local, human-readable action plan before changing anything. Use categories `KEEP`, `ARCHIVE`, `MOVE`, `DELETE`, and `REVIEW`; include account, UID, sender, subject, date, reason, and confidence.
- Default to `KEEP`/`REVIEW` when uncertain. “Looks old,” “has unsubscribe,” or “is automated” is not enough to delete it.
- Never delete personal correspondence, work threads, legal/tax records, financial records, security alerts, access/recovery messages, receipts, invoices, or messages requiring action without explicit user approval for that category or message group.
- Use UID-based operations only. Do not use sender/subject pattern deletion. Pattern searches may discover candidates, but convert them to verified UIDs first.
- Run the adapter’s dry-run/UID verification immediately before any mutation, then present the exact counts and representative subjects. Require explicit approval for the specific proposed batch; prior approval of the skill or a general request to “clear emails” is not enough.
- Prefer reversible operations: archive or move to a known folder before delete. If the user asks for deletion, explain that IMAP/Gmail deletion may be recoverable only through Trash for a limited time.
- Process in small, auditable batches. If an operation partially fails, stop, report the completed and uncompleted UIDs, and do not retry blindly.
- Keep an audit artifact in the workspace, such as `email-cleanup-YYYYMMDD-HHMM.md`; do not include passwords or full message bodies.

## Recommended workflow

1. Discover configured accounts with `python3 .../inbox.py accounts`. Confirm connectivity with a read-only search; report failures per account rather than silently skipping them.
2. Scan recent inbox headers with `search ACCOUNT . --days N --limit M --uids --fast`. For multiple accounts, keep results partitioned by account. Record the scan date, range, and per-account limits.
3. Group obvious candidates by sender and subject pattern, but inspect mixed senders individually. Preserve useful distinctions such as bank alerts versus bank marketing, deployment failures versus successful build notifications, and security alerts versus newsletters.
4. View a small sample or individual messages before recommending deletion of a group. Escalate anything involving money, identity, access, health, employment, family, legal matters, or an active conversation to `REVIEW`.
5. Write the action plan and summarize totals by account and category. Ask focused questions only for groups where the user’s preference materially changes the action.
6. After approval, run dry-run verification for each exact UID batch. Then execute only the approved batches through `inbox.py`; use archive/move before delete when that satisfies the goal.
7. Re-scan the affected inboxes read-only and write the audit result, including failures and remaining review items.

For the detailed classification policy and examples, read [references/decision-policy.md](references/decision-policy.md) when categorizing a mixed inbox.
