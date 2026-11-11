# Doot design system

Doot helps people read, find, organize, and clear email on their own server.
Reading and search work with a connected IMAP account; the assistant additionally
needs an AI provider. The interface must make both paths understandable.

## Foundation

Oatbase is the native HTML/CSS foundation. `app/vendor/oatbase/provenance.json`
records the exact upstream revision and SHA-256 of the checked-in distribution.
The MIT license and third-party notices travel with it. No CDN, npm publication,
sibling source checkout, web font service, or custom-element runtime is needed.
React owns application state, asynchronous requests, keyboard interactions, and
modal focus. Do not load Oat's global JavaScript alongside those handlers.
Oatbase empty-state and message patterns are used directly; buttons, forms,
labels, cards, and badges use Oat's native semantic foundation.

`app/globals.css` declares the cascade explicitly:

1. `theme`, `base`, `components`, `animations`, `utilities`: unchanged Oatbase CSS.
2. `layout`: feature structure and responsive layout.
3. `design`: `tokens.css` and `components.css`, the shared visual contract.

Files declare their layers internally and use plain CSS imports: Next's webpack
CSS loader does not support `@import ... layer(name)` reliably.

Tailwind is not required. Do not add a new theme or a screen-specific button,
input, badge, typography, or radius override. Change the shared adapter instead.
Feature styles may define layout, content sizing, and overflow behavior.

## Tokens and components

Oat's `--background`, `--foreground`, `--card`, `--primary`, `--border`, `--input`,
`--ring`, `--success`, `--warning`, and `--danger` are the public theme API.
`--muted` and `--accent` are background surfaces, never text colors. Compatibility
aliases (`--text-muted`, `--brand-accent`, etc.) map existing feature styles onto
that API. All palette values live in `app/styles/tokens.css`.

The current application appearance is light. Do not expose a dark-mode control
until email surfaces, overlays, and every feature have been verified in dark mode.

Use Oat's 4px spacing scale, system sans-serif type, 8px controls, and 12px card
corners. Monospace is reserved for code and identifiers. The teal accent marks
primary actions and selected navigation; amber means attention; red means a
failure or destructive action. Status always includes text, never color alone.
The Doot mark retains its marigold dispatch dot.

`components/ui.tsx` supplies Button, Card, Badge, Input, Textarea, Label, Tabs,
Skeleton, PageHeader, EmptyState, and Tooltip. The Dialog adapter owns focus
trapping, Escape, nested dialogs, and return focus; do not implement a second
modal per screen. ConfirmDialog and global toasts own action confirmation and
outcome feedback. Keep accessible labels, descriptions, validation states, and
keyboard behavior when adding or adapting a component.

Use one primary action per task region, outline for secondary actions, ghost for
low-emphasis actions, and danger for destructive choices. Icon-only actions need
an accessible name. Navigation is a link, actions are buttons. Preserve modified
link clicks. Never use a clickable div as a message row.

Each top-level list/settings screen uses PageHeader for its title, supporting
copy, and actions. EmptyState explains the absence and provides a useful next
step. Retain meaningful loading, error, retry, and disconnected states.

## Product language

- **Inbox**: browse, read, search, and select email across accounts.
- **Workspace**: the email assistant and its generated overview.
- **Drafts**: local email drafts; saving to IMAP is an explicit action. Doot does
  not currently send email. Never label a local save as Send.
- **Flows**: reusable email filters with a proposed action. Preview current
  matches, review the exact proposal, then approve applying it.
- **History**: syncs, conversations, reviews, and outcomes.
- **Settings**: accounts, AI providers, models, sync, privacy, and saved items.

Use "email" in navigation and supporting copy; "message" is appropriate for an
individual email or a conversation entry. Use "Add account", "Save settings",
"Review changes", and "Apply changes" rather than implementation terms. Explain
"local" or "cached" where freshness or privacy affects the decision. Do not
rename persisted API fields or endpoints as part of copy changes.

Never imply that opening email marks it read, that Organize already changed the
mailbox, or that a schedule has approval to mutate mail. The flow is always
**find → preview → review → apply**. Describe the exact target and count at the
approval boundary. Technical details belong in help, settings, and expandable
logs, rather than primary headings.

## Responsive and accessible behavior

- Controls are at least 44px on touch screens; text inputs are 16px on phones.
- Navigation remains named and scrollable. Selected navigation uses aria-current.
- Under 900px, Workspace switches between Chat and Workspace without unmounting
  either; Inbox switches between list and reader.
- Returning from the reader restores the list URL, filters, page, scroll, and
  opener focus. Browser Back and Forward remain meaningful.
- Grid tracks use minmax(0, 1fr); flex/grid children may shrink. Check visible
  descendants, not only document width, at 320px and above.
- Headers, toolbars, dialogs, long subjects, account addresses, and statuses wrap.
- Focus is visible. Reduced-motion preferences are respected. Labels name controls.
- Email HTML remains isolated in the existing sanitized iframe; app theming must
  never restyle email sender content or enable remote content.

## Upstream updates and validation

To update Oatbase, copy `dist/oatbase.css`, LICENSE, and THIRD_PARTY_NOTICES.md from
one reviewed upstream commit into `app/vendor/oatbase/`. Update provenance with
that revision and the distribution's SHA-256. Keep upstream CSS unchanged. Run
lint, type checking, the regression suite, and a production build. The vendored
CSS is excluded from formatting, not from provenance verification.

Verify all six navigation destinations at phone, tablet, and desktop widths,
including long real-world content and empty-account states. Check focused
controls and dialogs, pending Flow previews, reader Back/Forward, and generated
message links. Browser verification must not sync or mutate a real mailbox.
Use isolated fixtures for mutation and first-run tests. Production build checks
must use a temporary database rather than the user's mailbox database.

## Mobile mail density

At compact widths, the app bar is one 56px row: navigation menu, current section,
and sync. All destinations remain available in the focus-managed navigation
dialog. Branding and the horizontal destination strip belong on larger screens.
The Inbox uses search first, a concise account/count line, and expandable account
and selection controls. Its explanatory page heading stays available to assistive
technology without consuming the phone's reading area.

Mail rows use a human sender name, a single-line subject, compact account context,
and a right-aligned local time or short date. Full sender headers remain in the
title and full localized timestamps remain accessible and visible on desktop.
Selection targets remain 44px. Do not fetch bodies just to populate previews.
Touch devices do not show hover tooltips. Check first-message offset and visible
row count as well as overflow: at 390px the collapsed Inbox should reach its first
message within 150px and fit at least six complete rows in an 844px viewport.
