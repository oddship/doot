# Email cleanup decision policy

Use this policy to make proposals, not to bypass approval.

## Categories

### KEEP

Leave in the inbox when the message is current, actionable, part of an active thread, or likely useful soon. This includes recent delivery OTPs, pending payments, deployment failures, account warnings, and replies from people.

### ARCHIVE

Use for completed, non-urgent notifications that the user may want to retain but does not need in the inbox: delivered-package notices, completed CI successes, old social notifications, and routine service updates. Preserve the message; do not delete it.

### MOVE

Use only when a destination folder already exists or the user has approved creating/using one. Good candidates are statements, invoices, receipts, payslips, tax documents, investment/trading records, and booking/payment records. Never move a financial message merely because its sender is a bank or payment provider; inspect the subject and, when needed, the body.

### DELETE

Reserve for clearly disposable bulk marketing, duplicate newsletters, obvious spam, and expired promotional mail. Do not use this category for security notices, account messages, receipts, personal mail, work mail, or ambiguous automated notifications. When in doubt, use `ARCHIVE` or `REVIEW`.

### REVIEW

Use for personal or work correspondence, messages from individuals, mixed-content senders, legal or employment material, access/security notifications, possible fraud, and anything with an unclear consequence. Review may be grouped by a strong pattern, but the action must remain explicit.

## High-risk signals

Keep or review messages containing terms such as `security`, `alert`, `login`, `password`, `recovery`, `verification`, `OTP`, `refund`, `tax`, `invoice`, `statement`, `payment`, `failed`, `deadline`, `application`, `interview`, `contract`, `legal`, or `action required`. These are signals for closer inspection, not automatic retention or deletion rules.

## Approval format

Before mutation, summarize:

```text
Account: example@example.com
ARCHIVE: 12 UIDs — completed delivery notifications
MOVE: 4 UIDs — invoices → transactions
DELETE: 8 UIDs — duplicate marketing newsletters
REVIEW/KEEP: 19 UIDs — personal, security, and ambiguous messages
```

Then ask for approval of the named batches. If the user approves only one category or account, execute only that scope.
