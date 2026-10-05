# Inbox UI performance

`components/inbox-client.tsx` keeps draft search input separate from the submitted search. Pagination, background refreshes, displayed search scope, and Doot search handoffs use the submitted query; typing alone does not submit a search.

## Requests and background updates

- `LatestRequest` aborts superseded browser requests and rejects stale completions even if a transport ignores abort. Search and message-body requests use independent lanes.
- Request cleanup runs on unmount. Switching accounts or removing the opened message cancels its pending body response.
- Searches keep the existing list visible with a spinner and `aria-busy`. Only the latest request updates results, URL, errors, or loading state.
- `useCacheEvents` maintains one WebSocket per mounted Inbox instead of reconnecting for query, page, or message-selection changes. Handlers see the latest committed state, malformed frames are ignored, and HTTPS uses WSS.
- Cache-refresh bursts during a pending search queue one follow-up for that requested scope. They do not replace the user's request with an older search.

Aborting an HTTP request does not guarantee that an already-started server IMAP read is cancelled. No speculative body prefetch or client body cache is introduced. Remote images remain blocked by default and are allowed only by the existing explicit control.

## Rendering

Memoized mail rows and stable action callbacks skip unchanged rows when typing, loading bodies, or updating other UI state. `reuseMailRows` preserves header identities across refreshes only when every field is unchanged, so flags, sender/subject metadata, and body-cache indicators still update. Selection membership uses a Set.

The email frame is memoized by sanitized HTML. ResizeObserver notifications schedule at most one measurement per animation frame; obsolete observers and scheduled measurements are cancelled when content changes or the frame unmounts. The iframe sandbox is unchanged and does not allow scripts.

Inbox pages remain capped at 100 rows; virtualization is not added. No end-to-end latency multiplier is claimed. Component tests verify row-render counts, request cancellation, stale-result protection, submitted-search scope, refresh coalescing, and frame cleanup.
