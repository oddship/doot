import { randomUUID } from "node:crypto";
import { BODY_ACCESS_LIMITS, type BodyRef, bodyRefKey, compactMessageBody } from "@/lib/agent-body-access";
import { db, json } from "@/lib/database";

type Verdict = { disposition: "delete" | "retain" | "uncertain"; reason: string };
type Item = BodyRef & {
  folder: string;
  subject?: string;
  sender?: string;
  total?: number;
  initialRead?: boolean;
  ranges: [number, number][];
  verdict?: Verdict;
  lease?: { callId: string; token: string; until: number };
};
type Page = { index: number; offset: number; chars: number };
type Review = {
  id: string;
  sessionId: string;
  items: Item[];
  calls: Record<string, { pages: Page[]; done: boolean; token: string }>;
};
const prefix = (sessionId: string) => `body-review:${sessionId}:`;
const key = (sessionId: string, id: string) => `${prefix(sessionId)}${id}`;
const save = (review: Review) =>
  db
    .prepare(
      "INSERT INTO app_state(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
    )
    .run(key(review.sessionId, review.id), JSON.stringify(review));

function load(sessionId: string, id: string): Review {
  const decision = db
    .prepare("SELECT value_json FROM app_state WHERE key=?")
    .get(`body-decision:${sessionId}:${id}`) as any;
  if (json<any>(decision?.value_json, {}).status !== "approved")
    throw new Error("This review needs browser body approval");
  const row = db.prepare("SELECT value_json FROM app_state WHERE key=?").get(key(sessionId, id)) as any;
  if (!row) throw new Error("Approved body review not found in this conversation");
  return json<Review>(row.value_json, null as any);
}

export function createApprovedBodyReview(sessionId: string, id: string) {
  const existing = db.prepare("SELECT value_json FROM app_state WHERE key=?").get(key(sessionId, id)) as any;
  if (existing) return reviewProgress(sessionId, id);
  const decision = db
    .prepare("SELECT value_json FROM app_state WHERE key=?")
    .get(`body-decision:${sessionId}:${id}`) as any;
  if (json<any>(decision?.value_json, {}).status !== "approved") throw new Error("Body approval is required");
  const event = db
    .prepare(
      "SELECT metadata_json FROM agent_events WHERE session_id=? AND event_type='body_read_requested' AND json_extract(metadata_json,'$.request.id')=?",
    )
    .get(sessionId, id) as any;
  const messages = json<any>(event?.metadata_json, {}).request?.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > BODY_ACCESS_LIMITS.approval)
    throw new Error("Invalid approved review snapshot");
  const items: Item[] = messages.map((ref: any) => {
    if (!ref.account || !ref.folder || !/^\d+$/.test(String(ref.uid)))
      throw new Error("Review requires exact folder-scoped references");
    return {
      account: ref.account,
      folder: ref.folder,
      uid: String(ref.uid),
      subject: ref.subject,
      sender: ref.sender,
      ranges: [],
    };
  });
  if (new Set(items.map(bodyRefKey)).size !== items.length) throw new Error("Review snapshot has duplicate references");
  save({ id, sessionId, items, calls: {} });
  return reviewProgress(sessionId, id);
}

function coveredEnd(item: Item) {
  let end = 0;
  for (const [start, stop] of item.ranges) {
    if (start > end) break;
    end = Math.max(end, stop);
  }
  return end;
}
function complete(item: Item) {
  return item.initialRead === true && item.total !== undefined && coveredEnd(item) >= item.total;
}
function addRange(item: Item, start: number, end: number) {
  const merged: [number, number][] = [];
  for (const range of [...item.ranges, [start, end] as [number, number]].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  item.ranges = merged;
}
function progress(review: Review, offset = 0, limit = 20) {
  const dispositions = { delete: 0, retain: 0, uncertain: 0 };
  for (const item of review.items) if (item.verdict) dispositions[item.verdict.disposition]++;
  return {
    review_id: review.id,
    total: review.items.length,
    bodies_read: review.items.filter((item) => item.initialRead).length,
    fully_read: review.items.filter(complete).length,
    unread: review.items.filter((item) => !item.initialRead).length,
    decided: review.items.filter((item) => item.verdict).length,
    pending_decisions: review.items.filter((item) => !item.verdict).length,
    in_flight: review.items.filter((item) => item.lease && item.lease.until > Date.now()).length,
    dispositions,
    messages: review.items.slice(offset, offset + limit).map((item) => ({
      account: item.account,
      folder: item.folder,
      uid: item.uid,
      initial_read: Boolean(item.initialRead),
      fully_read: complete(item),
      body_chars_total: item.total ?? null,
      covered_ranges: item.ranges,
      next_body_offset: complete(item) ? null : coveredEnd(item),
      verdict: item.verdict ?? null,
    })),
    next_offset: offset + limit < review.items.length ? offset + limit : null,
  };
}
export function reviewProgress(sessionId: string, id: string, offset = 0, limit = 20) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error("Invalid review progress page");
  return progress(load(sessionId, id), offset, limit);
}
export function latestBodyReviewId(sessionId: string): string | undefined {
  const row = db
    .prepare("SELECT value_json FROM app_state WHERE key LIKE ? ORDER BY rowid DESC LIMIT 1")
    .get(`${prefix(sessionId)}%`) as any;
  return json<Review | null>(row?.value_json, null)?.id;
}

export async function readReviewNext(
  sessionId: string,
  id: string,
  callId: string,
  reader: (refs: BodyRef[]) => Promise<{ messages: any[]; metrics?: any }>,
  options: { depth?: "initial" | "full"; limit?: number; chars?: number; messages?: BodyRef[] } = {},
) {
  const depth = options.depth ?? "initial";
  const limit = options.limit ?? BODY_ACCESS_LIMITS.batch;
  const chars = options.chars ?? (depth === "initial" ? 2000 : BODY_ACCESS_LIMITS.textChars);
  if (
    !["initial", "full"].includes(depth) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 5 ||
    !Number.isSafeInteger(chars) ||
    chars < 1 ||
    chars > BODY_ACCESS_LIMITS.textChars
  )
    throw new Error("Invalid review read bounds");
  const reserved = db
    .transaction(() => {
      const review = load(sessionId, id);
      const allowed = new Set(review.items.map(bodyRefKey));
      if (options.messages?.some((ref) => !allowed.has(bodyRefKey(ref))))
        throw new Error("Message is outside this approved review");
      const wanted = options.messages && new Set(options.messages.map(bodyRefKey));
      // Expired reservations can be retried after process interruption.
      for (const item of review.items) if (item.lease && item.lease.until <= Date.now()) delete item.lease;
      const prior = review.calls[callId];
      if (prior && !prior.done && prior.pages.some((page) => review.items[page.index].lease))
        return { review, pages: [] as Page[], busy: true, replay: false, token: prior.token };
      const pages =
        prior?.pages ??
        review.items
          .flatMap((item, index) => {
            if (item.lease || (wanted && !wanted.has(bodyRefKey(item)))) return [];
            if (depth === "initial" ? item.initialRead : complete(item)) return [];
            return [{ index, offset: coveredEnd(item), chars }];
          })
          .slice(0, limit);
      const replay = Boolean(prior?.done);
      const token = replay ? prior.token : randomUUID();
      if (!replay) {
        for (const page of pages) review.items[page.index].lease = { callId, token, until: Date.now() + 120_000 };
        review.calls[callId] = { pages, done: false, token };
      }
      save(review);
      return { review, pages, busy: !pages.length && review.items.some((item) => item.lease), replay, token };
    })
    .immediate();
  if (!reserved.pages.length)
    return {
      status: reserved.busy ? "busy" : "complete_for_depth",
      messages: [],
      progress: progress(reserved.review, 0, 0),
    };
  const refs = reserved.pages.map((page) => {
    const { account, folder, uid } = reserved.review.items[page.index];
    return { account, folder, uid };
  });
  try {
    const result = await reader(refs);
    const found = new Map(result.messages.map((message) => [bodyRefKey(message), message]));
    if (found.size !== refs.length || refs.some((ref) => !found.has(bodyRefKey(ref))))
      throw new Error("Reader did not return the exact approved review messages");
    const excerpts = reserved.pages.map((page, index) =>
      compactMessageBody(found.get(bodyRefKey(refs[index])), page.offset, page.chars),
    );
    const updated = db
      .transaction(() => {
        const review = load(sessionId, id);
        if (!reserved.replay) {
          for (let index = 0; index < reserved.pages.length; index++) {
            const item = review.items[reserved.pages[index].index];
            if (item.lease?.token !== reserved.token) throw new Error("Review read reservation expired; retry");
            const excerpt = excerpts[index];
            if (item.total !== undefined && item.total !== excerpt.body_chars_total) {
              item.ranges = [];
              item.initialRead = false;
              delete item.verdict;
            }
            item.total = excerpt.body_chars_total;
            if (excerpt.body_offset === 0) item.initialRead = true;
            addRange(item, Math.min(excerpt.body_offset, item.total), excerpt.body_range_end);
            delete item.lease;
          }
          review.calls[callId].done = true;
          save(review);
        }
        return review;
      })
      .immediate();
    return { status: "read", messages: excerpts, metrics: result.metrics, progress: progress(updated, 0, 0) };
  } catch (error) {
    if (!reserved.replay)
      db.transaction(() => {
        const review = load(sessionId, id);
        for (const item of review.items) if (item.lease?.token === reserved.token) delete item.lease;
        if (review.calls[callId]?.token === reserved.token && !review.calls[callId].done) delete review.calls[callId];
        save(review);
      }).immediate();
    throw error;
  }
}

export function recordReviewDecisions(sessionId: string, id: string, decisions: (BodyRef & Verdict)[]) {
  if (!Array.isArray(decisions) || !decisions.length || decisions.length > 50)
    throw new Error("Record between one and 50 decisions");
  return db
    .transaction(() => {
      const review = load(sessionId, id);
      const items = new Map(review.items.map((item) => [bodyRefKey(item), item]));
      const seen = new Set<string>();
      for (const decision of decisions) {
        const refKey = bodyRefKey(decision);
        const item = items.get(refKey);
        if (!item || seen.has(refKey))
          throw new Error("Decision requires a unique reference inside this approved review");
        if (!item.initialRead) throw new Error("Read the initial excerpt before recording a body-review decision");
        if (
          !["delete", "retain", "uncertain"].includes(decision.disposition) ||
          typeof decision.reason !== "string" ||
          !decision.reason.trim() ||
          decision.reason.length > 1000
        )
          throw new Error("Invalid review decision");
        seen.add(refKey);
        item.verdict = { disposition: decision.disposition, reason: decision.reason.trim() };
      }
      save(review);
      return progress(review);
    })
    .immediate();
}
