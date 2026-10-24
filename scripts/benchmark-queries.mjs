// Run after `corepack pnpm build`: node scripts/benchmark-queries.mjs
import { performance } from "node:perf_hooks";
import { IndexDatabase } from "../packages/storage-node/dist/index-database.js";
import {
  queryIndexedEntityPage,
  countIndexedCalendarDays,
} from "../packages/storage-node/dist/index-query.js";
import {
  createSearchDocumentWriter,
  searchDocuments,
} from "../packages/storage-node/dist/search.js";
import { quickOpenIndexedEntities } from "../packages/storage-node/dist/quick-open.js";
const index = new IndexDatabase(":memory:");
try {
  const insert = index.database
    .prepare(`INSERT INTO entities(id,type,path,display_name,name_key,created_at,updated_at,exclude_from_ai,body,journal_date)
    VALUES (?, 'entry', ?, ?, ?, ?, ?, 0, ?, '2026-10-03')`);
  const search = createSearchDocumentWriter(index.database);
  const started = performance.now();
  index.database.transaction(() => {
    for (let i = 0; i < 10000; i++) {
      const id = `entity-${String(i).padStart(5, "0")}`;
      const name = `Entity ${String(i).padStart(5, "0")}`;
      const body = `${"通常の文章と数値123について記録する。".repeat(100)}${i % 1000 === 0 ? " 探索対象" : ""}`;
      const date = new Date(Date.UTC(2026, 9, 3, 0, 0, i)).toISOString();
      insert.run(id, `${id}.md`, name, name.toLowerCase(), date, date, body);
      search({ id, content: `${name}\n${body}` });
    }
  })();
  const buildMs = performance.now() - started;
  const measure = (name, fn) => {
    fn();
    const timings = [];
    for (let i = 0; i < 40; i++) {
      const start = performance.now();
      fn();
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    return {
      name,
      p50Ms: +timings[20].toFixed(3),
      p95Ms: +timings[38].toFixed(3),
    };
  };
  let page = queryIndexedEntityPage(index, {
    type: "entry",
    sort: "createdAt",
    direction: "desc",
  });
  let cursor;
  for (let i = 0; i < 180; i++) {
    cursor = page.nextCursor;
    page = queryIndexedEntityPage(index, {
      type: "entry",
      sort: "createdAt",
      direction: "desc",
      cursor,
    });
  }
  const scan = index.database.prepare(
    "SELECT id,content FROM search_documents WHERE instr(content,?)>0",
  );
  const results = [
    measure("short search (indexed, 10 hits)", () =>
      searchDocuments(index.database, "探索"),
    ),
    measure("short search (previous full scan, 10 hits)", () =>
      scan.all("探索"),
    ),
    measure("long search (indexed, 10 hits)", () =>
      searchDocuments(index.database, "探索対象"),
    ),
    measure("Quick Open (short, 10 hits)", () =>
      quickOpenIndexedEntities(index, "探索"),
    ),
    measure("first timeline page (50 previews)", () =>
      queryIndexedEntityPage(index, {
        type: "entry",
        sort: "createdAt",
        direction: "desc",
      }),
    ),
    measure("timeline page after 9000 rows (50 previews)", () =>
      queryIndexedEntityPage(index, {
        type: "entry",
        sort: "createdAt",
        direction: "desc",
        cursor,
      }),
    ),
    measure("calendar counts", () =>
      countIndexedCalendarDays(index, "2026-10-01", "2026-11-01"),
    ),
  ];
  const full = index.database.prepare("SELECT * FROM entities").all();
  const preview = queryIndexedEntityPage(index, {
    type: "entry",
    sort: "createdAt",
    direction: "desc",
  });
  console.log(
    JSON.stringify(
      {
        entities: 10000,
        bodyChars: full[0].body.length,
        buildMs: +buildMs.toFixed(1),
        fullListBytes: Buffer.byteLength(JSON.stringify(full)),
        firstPageBytes: Buffer.byteLength(JSON.stringify(preview)),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  index.close();
}
