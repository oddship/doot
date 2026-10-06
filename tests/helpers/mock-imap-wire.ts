// Tiny loopback IMAP fixture. Not a general server and never uses real credentials/mail.
import { createServer, type Socket } from "node:net";
import { ImapFlow } from "imapflow";
import { MockCommandRejected, type MockMailboxTransport, type Ref, type Step } from "../../experiments/durable-mailbox";

export async function mockImapWire() {
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  const labels = new Set(["INBOX"]);
  let seen = false;
  let validity = "42";
  let rejectRemoval = false;
  let disconnectAfterLabel = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.write("* OK mock IMAP ready\r\n");
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString();
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        commands.push(line);
        const [tag, ...parts] = line.split(" ");
        const command = parts.join(" ");
        const reply = (text: string) => socket.write(`${text}\r\n`);
        if (/^CAPABILITY$/i.test(command)) reply(`* CAPABILITY IMAP4rev1 X-GM-EXT-1\r\n${tag} OK capability`);
        else if (/^LOGIN /i.test(command)) reply(`${tag} OK logged in`);
        else if (/^LIST /i.test(command)) reply(`* LIST () "/" "INBOX"\r\n${tag} OK listed`);
        else if (/^(SELECT|EXAMINE) /i.test(command))
          reply(
            `* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY ${validity}] validity\r\n* OK [UIDNEXT 2] next\r\n${tag} OK [READ-WRITE] selected`,
          );
        else if (/^UID FETCH /i.test(command))
          reply(`* 1 FETCH (UID 1 FLAGS (${seen ? "\\Seen" : ""}))\r\n${tag} OK fetched`);
        else if (/^UID STORE /i.test(command)) {
          if (command.includes("+FLAGS")) seen = true;
          if (command.includes("+X-GM-LABELS")) {
            labels.add("transactions");
            if (disconnectAfterLabel) {
              socket.destroy();
              continue;
            }
          }
          if (command.includes("-X-GM-LABELS")) {
            if (rejectRemoval) {
              reply(`${tag} NO mock removal rejected`);
              continue;
            }
            labels.delete("INBOX");
          }
          reply(`${tag} OK stored`);
        } else if (/^LOGOUT$/i.test(command)) {
          reply(`* BYE closing\r\n${tag} OK logged out`);
          socket.end();
        } else if (/^(NOOP|CLOSE)$/i.test(command)) reply(`${tag} OK done`);
        else reply(`${tag} BAD mock unsupported command`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing mock listener");
  const clients: ImapFlow[] = [];
  const transport = (): MockMailboxTransport => {
    let lastStoreError: any;
    const client = new ImapFlow({
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      doSTARTTLS: false,
      auth: { user: "fake", pass: "fake" },
      logger: {
        debug() {},
        info() {},
        error() {},
        warn(value: any) {
          if (value.err) lastStoreError = value.err;
        },
      },
      disableAutoIdle: true,
      connectionTimeout: 2000,
      greetingTimeout: 2000,
      socketTimeout: 2000,
    });
    clients.push(client);
    client.on("error", () => {});
    let connected = false;
    return {
      mock: true,
      async validate(ref: Ref, signal: AbortSignal) {
        if (signal.aborted) throw new Error("cancelled");
        if (!connected) {
          await client.connect();
          connected = true;
        }
        // Re-select for each check to expose changed UIDVALIDITY in this fixture.
        if (client.mailbox) await client.mailboxClose();
        const mailbox = await client.mailboxOpen(ref.folder);
        if (!mailbox || String(mailbox.uidValidity) !== ref.uidValidity) throw new Error("UIDVALIDITY changed");
        const message = await client.fetchOne(ref.uid, { uid: true }, { uid: true });
        if (!message || String(message.uid) !== ref.uid) throw new Error("Source UID absent");
      },
      async execute(step: Step, signal: AbortSignal) {
        if (signal.aborted) throw new Error("cancelled");
        lastStoreError = undefined;
        try {
          const applied =
            step.operation === "seen"
              ? await client.messageFlagsAdd(step.ref.uid, ["\\Seen"], { uid: true, silent: true })
              : step.operation === "add_label"
                ? await client.messageFlagsAdd(step.ref.uid, [step.destination], {
                    uid: true,
                    silent: true,
                    useLabels: true,
                  })
                : await client.messageFlagsRemove(step.ref.uid, ["\\Inbox"], {
                    uid: true,
                    silent: true,
                    useLabels: true,
                  });
          if (applied === false) {
            // ImapFlow catches STORE failures and returns false for NO *and* lost ACKs.
            if (lastStoreError?.responseStatus === "NO") throw new MockCommandRejected("NO mock IMAP rejected command");
            throw new Error("Mock IMAP did not confirm command; outcome unknown");
          }
        } catch (error: any) {
          if (error.responseStatus === "NO") throw new MockCommandRejected("NO mock IMAP rejected command");
          throw error;
        }
      },
    };
  };
  return {
    commands,
    labels,
    transport,
    get seen() {
      return seen;
    },
    changeValidity(value: string) {
      validity = value;
    },
    rejectRemoval() {
      rejectRemoval = true;
    },
    disconnectAfterLabel() {
      disconnectAfterLabel = true;
    },
    async close() {
      for (const client of clients) client.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
