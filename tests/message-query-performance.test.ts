// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { legacyCanonicalSql, legacyFacets } from "./helpers/message-query-baseline";

// Opt-in benchmark against an isolated SQLite backup, never the live writable DB.
it.skipIf(process.env.DOOT_QUERY_BENCHMARK !== "1")(
  "benchmarks canonical queries and facets on a private cache copy",
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "doot-query-benchmark-"));
    const previousPath = process.env.DOOT_DATABASE_PATH;
    const source = new Database(
      process.env.DOOT_BENCH_DATABASE_PATH || path.join(process.cwd(), "email-cache.sqlite3"),
      { readonly: true, fileMustExist: true },
    );
    let database: typeof import("@/lib/database") | undefined;
    try {
      const target = path.join(directory, "cache.sqlite3");
      await source.backup(target);
      source.close();
      process.env.DOOT_DATABASE_PATH = target;
      database = await import("@/lib/database");
      const { messageFacets } = await import("@/lib/message-facets");
      const { db } = database;
      db.exec(`CREATE TEMP VIEW legacy_canonical_messages AS ${legacyCanonicalSql}`);
      const timestamp = Math.floor(Date.now() / 1000);
      vi.spyOn(Date, "now").mockReturnValue(timestamp * 1000);
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const measure = (fn: () => unknown) => {
        fn();
        const times = [];
        for (let i = 0; i < 7; i++) {
          const start = performance.now();
          fn();
          times.push(performance.now() - start);
        }
        return Math.round(median(times) * 10) / 10;
      };
      const beforeCount = db.prepare("SELECT COUNT(*) count FROM legacy_canonical_messages");
      const afterCount = db.prepare("SELECT COUNT(*) count FROM canonical_messages");
      expect(afterCount.get()).toEqual(beforeCount.get());
      // Verify every winner, without printing private headers if a comparison fails.
      const keys = "account,folder,uid";
      expect(
        isDeepStrictEqual(
          db.prepare(`SELECT ${keys} FROM canonical_messages ORDER BY account,folder,uid`).all(),
          db.prepare(`SELECT ${keys} FROM legacy_canonical_messages ORDER BY account,folder,uid`).all(),
        ),
      ).toBe(true);
      console.log(
        JSON.stringify({
          benchmark: "canonical count",
          before_ms: measure(() => beforeCount.get()),
          after_ms: measure(() => afterCount.get()),
        }),
      );
      const select = "account,folder,uid,sender,subject,date_ts";
      const beforeSearch = db.prepare(
        `SELECT ${select} FROM legacy_canonical_messages ORDER BY date_ts DESC,CAST(uid AS INTEGER) DESC LIMIT 25`,
      );
      const afterSearch = db.prepare(
        `SELECT ${select} FROM canonical_messages ORDER BY date_ts DESC,CAST(uid AS INTEGER) DESC LIMIT 25`,
      );
      expect(isDeepStrictEqual(beforeSearch.all(), afterSearch.all())).toBe(true);
      console.log(
        JSON.stringify({
          benchmark: "header page",
          before_ms: measure(() => beforeSearch.all()),
          after_ms: measure(() => afterSearch.all()),
        }),
      );
      for (const input of [{}, { query: "domain:linkedin.com" }]) {
        const { where, values } = database.messageWhere(input);
        const before = () => legacyFacets(db, input, where, values, timestamp);
        const after = () => messageFacets(input);
        expect(isDeepStrictEqual(before(), after())).toBe(true);
        console.log(
          JSON.stringify({
            benchmark: input.query ? "filtered facets" : "whole-cache facets",
            matched: after().total,
            before_ms: measure(before),
            after_ms: measure(after),
            sql_queries_before: 8,
            sql_queries_after: 1,
          }),
        );
      }
    } finally {
      vi.restoreAllMocks();
      if (source.open) source.close();
      database?.db.close();
      delete (globalThis as any).__emailAgentDatabase;
      if (previousPath === undefined) delete process.env.DOOT_DATABASE_PATH;
      else process.env.DOOT_DATABASE_PATH = previousPath;
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30000,
);
