# Flow lifecycle and activation

A Flow is a saved Inbox filter plus a reviewed action plan: mark as read, archive, move, or delete. It may also mark as read **before** one archive, move, or delete step. Other multi-action sequences are not supported. Saving or activating a Flow never changes mail by itself.

## Statuses

| Status | Meaning | Mailbox effect |
| --- | --- | --- |
| Suggested | Doot created it for review | None |
| Draft | Saved, but not marked ready | None |
| Active | Reviewed and ready for manual runs | None |
| Paused | No longer marked ready | None |

**Active means reviewed and eligible for attached schedules.** Activation alone does not execute anything. Active Flows sort ahead of other Flows, and an enabled schedule may evaluate them at its configured time. Scheduled evaluations prepare proposals for review; they do not mutate the mailbox.

## Activating a Flow

1. Open its directly addressable `/flows/:id` page.
2. Inspect the account, exact filter query, destination, and current cached matches.
3. Edit the definition or ask Doot to refine it if necessary.
4. Choose **Mark active**. This records `enabled=true` and status `active`; it does not create a proposal or contact IMAP by itself. It also allows any attached enabled schedules to evaluate the Flow.

Choose **Pause flow** to remove the readiness label. The definition and its manual preview remain available.

## Scheduling a Flow

Add a once, daily, or weekly schedule from the Flow page. The first run is stored as an exact UTC instant together with the browser's IANA timezone. The scheduler checks persisted schedules every 30 seconds while Doot is running.

At run time, an active Flow searches the current cache and creates a bounded proposal. The run and proposal appear in History with status **Needs review**. No IMAP mutation happens until the user reviews and approves a mailbox action. If the Flow is paused, the scheduled evaluation is recorded as skipped.

## Running a Flow

Running is always separate from activation:

1. Choose **Review & run** to prepare a bounded batch of up to 100 current matches.
2. Inspect the filter, complete ordered action sequence, destination, account, count, and sample messages in the approval dialog.
3. Choose **Approve and run** to create an audited proposal and apply that one batch.

The browser sends an explicit confirmation for this run. A later batch requires a new preview and confirmation, regardless of whether the Flow is active.

To mark bank alerts as read and file them, edit the existing Flow, select **Move**, choose the discovered `transactions` folder/label, and check **Mark as read before** moving. Save and review **Mark as read → Move to transactions** before confirming. Agent edits preserve the existing ID and leave the Flow disabled for review.

Running rejects a definition changed since review. Steps are not atomic: marking read may succeed while a subsequent relocation fails. History shows partial failures and completed steps; inspect it before retrying. Reading a body alone still preserves unread state.

For delete actions, approval moves or deletes the reviewed messages according to the connected provider. For Gmail move actions, Doot applies the chosen custom label and removes Inbox as described in the Flow editor.
