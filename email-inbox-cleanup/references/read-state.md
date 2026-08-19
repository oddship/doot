# Protected read state

Reading an email must not change its upstream read/unread state.

For IMAP inspection, use:

- `UID FETCH <uids> (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])` for header scans.
- `UID FETCH <uid> (UID BODY.PEEK[])` for full-message review or attachment inspection.

Avoid bare `RFC822` and `BODY[...]`; servers commonly set `\\Seen` when those forms are fetched. Do not “restore” flags after reading: that can race with the user or another client and can destroy a genuine state change. If the adapter cannot use `BODY.PEEK`, stop before reading content and report the limitation.
