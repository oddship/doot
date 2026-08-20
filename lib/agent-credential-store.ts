import { db, now } from "@/lib/database";

export type AgentCredential =
  | { type: "api_key"; key?: string; env?: Record<string, string> }
  | { type: "oauth"; refresh: string; access: string; expires: number; [key: string]: unknown };

type AuthOperationOptions = { signal?: AbortSignal };
const queues = new Map<string, Promise<void>>();

function validProvider(provider: string) {
  if (!/^[a-z0-9_-]{2,80}$/.test(provider)) throw new Error("invalid provider");
  return provider;
}

function parseCredential(row: any): AgentCredential | undefined {
  if (!row) return undefined;
  if (row.credential_json) {
    try {
      const value = JSON.parse(row.credential_json);
      if (value?.type === "api_key" || value?.type === "oauth") return value;
    } catch {}
  }
  return row.api_key ? { type: "api_key", key: row.api_key } : undefined;
}

function read(provider: string) {
  return parseCredential(db.prepare("SELECT * FROM agent_credentials WHERE provider=?").get(validProvider(provider)));
}

function write(provider: string, credential: AgentCredential) {
  const apiKey = credential.type === "api_key" ? String(credential.key || "") : "";
  db.prepare(
    `INSERT INTO agent_credentials(provider,api_key,auth_type,credential_json,updated_at)
     VALUES(?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET
     api_key=excluded.api_key,auth_type=excluded.auth_type,
     credential_json=excluded.credential_json,updated_at=excluded.updated_at`,
  ).run(provider, apiKey, credential.type, JSON.stringify(credential), now());
}

async function serialized<T>(provider: string, operation: () => Promise<T>) {
  const previous = queues.get(provider) || Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  queues.set(provider, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(provider) === queued) queues.delete(provider);
  }
}

export const sqliteAgentCredentialStore = {
  async read(provider: string, options: AuthOperationOptions = {}) {
    options.signal?.throwIfAborted();
    return read(provider);
  },
  async list(options: AuthOperationOptions = {}) {
    options.signal?.throwIfAborted();
    return (
      db.prepare("SELECT provider,auth_type FROM agent_credentials ORDER BY provider").all() as Array<{
        provider: string;
        auth_type: "api_key" | "oauth";
      }>
    ).map((row) => ({ providerId: row.provider, type: row.auth_type || "api_key" }));
  },
  async modify(
    provider: string,
    change: (current: AgentCredential | undefined) => Promise<AgentCredential | undefined>,
    options: AuthOperationOptions = {},
  ) {
    validProvider(provider);
    return serialized(provider, async () => {
      options.signal?.throwIfAborted();
      const credential = await change(read(provider));
      options.signal?.throwIfAborted();
      if (credential) write(provider, credential);
      return credential;
    });
  },
  async delete(provider: string, options: AuthOperationOptions = {}) {
    validProvider(provider);
    await serialized(provider, async () => {
      options.signal?.throwIfAborted();
      db.prepare("DELETE FROM agent_credentials WHERE provider=?").run(provider);
    });
  },
};

export function listStoredAgentCredentials() {
  return {
    credentials: (
      db.prepare("SELECT provider,auth_type type,updated_at FROM agent_credentials ORDER BY provider").all() as any[]
    ).map((item) => ({ ...item, type: item.type || "api_key" })),
  };
}
