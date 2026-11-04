# Inbox UI performance

`components/inbox-client.tsx` keeps draft search input separate from the submitted search. Pagination, background refreshes, displayed search scope, and Doot search handoffs use the submitted query; typing alone does not submit a search.

## Requests and background updates

- `LatestRequest` aborts superseded browser requests and rejects stale completions even if a transport ignores abort. Search and message-body requests use independent lanes.
- Request cleanup runs on unmount. Switching accounts or removing the opened message cancels its pending body response.
- Searches keep the existing list visible with a spinner and `aria-busy`. Only the latest request updates results, URL, errors, or loading state.
- `useCacheEvents` shares one WebSocket per browser tab instead of reconnecting for query, page, or message-selection changes. Handlers see the latest committed state, malformed frames are ignored, and HTTPS uses WSS.
- Cache-refresh bursts during a pending search queue one follow-up for that requested scope. They do not replace the user's request with an older search.

Aborting an HTTP request does not guarantee that an already-started server IMAP read is cancelled. No speculative message bodies are fetched. Remote images remain blocked by default and are allowed only by the existing explicit control.

## Opening messages

The mounted Inbox retains up to 12 opened messages in memory, with a 4 MiB serialized-byte budget and a 60-second lifetime. Reopening one of these messages avoids another body request. The cache is discarded on unmount and invalidated by message, reconnect, and visibility refreshes. Responses that allow remote images are excluded, including explicit one-time image loads.

Startup warms read-only INBOX connections. Hovering, focusing, or pressing an uncached message's open button can warm its exact account and folder before the click finishes. This opens an IMAP connection and selects the mailbox; it does not fetch a message body or change unread state. Speculative warming is throttled to once per minute per mailbox and creates at most two reader sessions per account. Normal body reads can still open other folders.

`scripts/benchmark-message-reader.mjs` intercepts message responses with synthetic content and a 150 ms delay. Set `DOOT_BASE_URL` and `DOOT_READER_REPORT` to run it; set `CHROMIUM_PATH` if needed. It measures first open, reopen, and body-request counts without fetching provider bodies. Its timings describe that simulated network delay, not provider latency.

## Rendering

Memoized mail rows and stable action callbacks skip unchanged rows when typing, loading bodies, or updating other UI state. `reuseMailRows` preserves header identities across refreshes only when every field is unchanged, so flags, sender/subject metadata, and body-cache indicators still update. Selection membership uses a Set.

The email frame is memoized by sanitized HTML. ResizeObserver notifications schedule at most one measurement per animation frame; obsolete observers and scheduled measurements are cancelled when content changes or the frame unmounts. The iframe sandbox is unchanged and does not allow scripts.

Inbox pages remain capped at 100 rows; virtualization is not added. No end-to-end latency multiplier is claimed. Component tests verify row-render counts, request cancellation, stale-result protection, submitted-search scope, refresh coalescing, and frame cleanup.
