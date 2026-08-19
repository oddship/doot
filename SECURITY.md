# Security policy

## Supported versions

Doot is pre-1.0 software. Security fixes target the latest tagged release and `main`.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting for `oddship/doot`. Do not open a public issue containing credentials, email content, or a working exploit. Include the affected version, impact, reproduction, and any suggested mitigation.

## v0.1 security boundaries

Doot is a local, single-user application with no authentication. It binds to `127.0.0.1` by default. Do not expose it to the public internet or an untrusted LAN.

IMAP passwords, provider keys, cached headers, fetched bodies, agent memory, and session history are stored in SQLite. The file is created with mode `0600` where supported, but its security ultimately depends on the host, backups, and volume permissions.

Email HTML is sanitized, remote images are blocked by default, and message bodies render in a sandboxed iframe. These controls reduce risk; they are not a guarantee against every malicious message.

The agent cannot directly apply mailbox changes. It may write local artifacts, memory, Flows, and proposals; archive, move, delete, and IMAP folder writes require explicit confirmation in the browser.
