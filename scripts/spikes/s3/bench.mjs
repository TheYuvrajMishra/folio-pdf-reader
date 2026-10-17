/**
 * S3 benchmark: SQLite FTS5 search + page_lines lookups as a proxy for
 * expo-sqlite on-device performance.
 *
 * Corpus: synthetic 300-page book, 35 lines/page = 10,500 lines of
 * deterministic English-like text (mulberry32 seed), built from a
 * realistic vocabulary so FTS5 token statistics resemble a real book.
 *
 * Measures:
 *  (a) single-term FTS5 MATCH latency (p50/p95 over 200 queries)
 *  (b) phrase query latency
 *  (c) prefix query latency
 *  (d) total index size on disk
 *  (e) insert throughput for the 10.5k-line batch in one transaction
 *  (f) page_lines point lookup latency (one page's lines)
 *
 * Run: node scripts/spikes/s3/bench.mjs
 */

import Database from 'better-sqlite3';
import { mkdtempSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const scratchRoot = join(scriptDir, '.bench-tmp');
mkdirSync(scratchRoot, { recursive: true });
const tmp = mkdtempSync(join(scratchRoot, 'run-'));

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xF0110);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ---------------------------------------------------------------------------
// Vocabulary: frequent + topical words so queries return realistic hit counts
// ---------------------------------------------------------------------------
const COMMON = [
  'the', 'of', 'and', 'to', 'in', 'that', 'is', 'for', 'with', 'on', 'as', 'by',
  'from', 'at', 'or', 'this', 'which', 'it', 'was', 'are', 'be', 'have', 'has',
  'not', 'but', 'an', 'they', 'their', 'its', 'between', 'into', 'through',
  'during', 'before', 'after', 'under', 'over', 'while', 'where', 'when',
  'can', 'will', 'would', 'could', 'should', 'must', 'may', 'more', 'most',
  'other', 'such', 'only', 'than', 'then', 'there', 'these', 'those', 'each',
  'both', 'because', 'however', 'therefore', 'also', 'within', 'without',
  'about', 'against', 'among', 'toward', 'upon', 'per', 'using', 'used',
  'use', 'made', 'make', 'found', 'known', 'called', 'part', 'time', 'system',
  'process', 'data', 'model', 'design', 'method', 'result', 'effect', 'chapter',
];
const TOPIC = [
  'memory', 'cache', 'pipeline', 'render', 'shader', 'texture', 'thread',
  'mutex', 'socket', 'packet', 'router', 'kernel', 'scheduler', 'buffer',
  'frame', 'pixel', 'vertex', 'fragment', 'latency', 'throughput', 'bandwidth',
  'protocol', 'cipher', 'digest', 'token', 'session', 'cookie', 'header',
  'query', 'index', 'transaction', 'replica', 'shard', 'partition', 'queue',
  'worker', 'dispatch', 'event', 'signal', 'interrupt', 'register', 'stack',
  'heap', 'pointer', 'struct', 'vector', 'matrix', 'quaternion', 'normal',
  'photon', 'spectrum', 'isotope', 'neuron', 'synapse', 'cortex', 'enzyme',
  'protein', 'genome', 'allele', 'cell', 'tissue', 'organ', 'plasma', 'orbit',
  'comet', 'nebula', 'quasar', 'pulsar', 'galaxy', 'zenith', 'horizon',
  'tangent', 'gradient', 'integral', 'derivative', 'manifold', 'tensor',
  'eigenvalue', 'theorem', 'axiom', 'lemma', 'corollary', 'hypothesis',
  'experiment', 'sample', 'control', 'variable', 'bias', 'variance', 'prior',
  'posterior', 'likelihood', 'entropy', 'fractal', 'chaos', 'attractor',
];
const RARE = [
  's3spike', 'quuxword', 'folioprobe', 'zmxk', 'kdb', 'volvelle', 'qat',
  'xenops', 'jorum', 'twyblade',
];

const ALL = [...COMMON, ...TOPIC];

function makeLine() {
  const n = 8 + Math.floor(rand() * 10);
  const words = [];
  for (let i = 0; i < n; i++) {
    const r = rand();
    words.push(r < 0.82 ? pick(ALL) : r < 0.985 ? pick(ALL) : pick(RARE));
  }
  let s = words.join(' ');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s + (rand() < 0.7 ? '.' : ',');
}

// ---------------------------------------------------------------------------
// Corpus build
// ---------------------------------------------------------------------------
const PAGES = 300;
const LINES_PER_PAGE = 35;
const BOOK_ID = 'bench-book';

// (scratch dir `tmp` created above)
const dbPath = join(tmp, 'bench.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE page_lines (
    book_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    x0 REAL NOT NULL, y0 REAL NOT NULL, x1 REAL NOT NULL, y1 REAL NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'body',
    PRIMARY KEY (book_id, page, idx)
  );
  CREATE VIRTUAL TABLE page_text USING fts5(
    book_id UNINDEXED,
    page UNINDEXED,
    text
  );
  CREATE INDEX idx_page_lines_book_page ON page_lines (book_id, page, idx);
`);

// (e) insert throughput: one transaction for all 10,500 lines + FTS rows
const t0 = process.hrtime.bigint();
const insertLine = db.prepare(
  'INSERT INTO page_lines (book_id, page, idx, x0, y0, x1, y1, text, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);
const insertFts = db.prepare('INSERT INTO page_text (book_id, page, text) VALUES (?, ?, ?)');
const insertBatch = db.transaction(() => {
  for (let page = 1; page <= PAGES; page++) {
    const pageText = [];
    for (let idx = 0; idx < LINES_PER_PAGE; idx++) {
      const text = makeLine();
      const y = 0.04 + (idx / LINES_PER_PAGE) * 0.92;
      insertLine.run(BOOK_ID, page, idx, 0.05, y, 0.95, y + 0.022, text, 'body');
      pageText.push(text);
    }
    insertFts.run(BOOK_ID, page, pageText.join('\n'));
  }
});
insertBatch();
const t1 = process.hrtime.bigint();
const insertMs = Number(t1 - t0) / 1e6;
const totalLines = PAGES * LINES_PER_PAGE;
const insertThroughput = totalLines / (insertMs / 1000);

db.pragma('wal_checkpoint(TRUNCATE)');

// ---------------------------------------------------------------------------
// Latency harness
// ---------------------------------------------------------------------------
function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function measure(label, fn, n = 200) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const a = process.hrtime.bigint();
    fn();
    const b = process.hrtime.bigint();
    samples.push(Number(b - a) / 1e6);
  }
  samples.sort((x, y) => x - y);
  return {
    label,
    n,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
  };
}

const r2 = rand; // continue the deterministic stream
const termStmt = db.prepare(
  'SELECT page FROM page_text WHERE page_text MATCH ? AND book_id = ? ORDER BY rank LIMIT 20',
);
const phraseStmt = db.prepare(
  'SELECT page FROM page_text WHERE page_text MATCH ? AND book_id = ? ORDER BY rank LIMIT 20',
);
const prefixStmt = db.prepare(
  'SELECT page FROM page_text WHERE page_text MATCH ? AND book_id = ? ORDER BY rank LIMIT 20',
);
const linesStmt = db.prepare(
  'SELECT idx, x0, y0, x1, y1, text FROM page_lines WHERE book_id = ? AND page = ? ORDER BY idx',
);

const randomTerm = () => pick(TOPIC);
const randomPhrase = () => `"${pick(TOPIC)} ${pick(COMMON)}"`;
const randomPrefix = () => `${pick(TOPIC).slice(0, 3 + Math.floor(r2() * 3))}*`;
const randomPage = () => 1 + Math.floor(r2() * PAGES);

const results = [];
results.push(measure('single-term MATCH', () => termStmt.all(randomTerm(), BOOK_ID)));
results.push(measure('phrase MATCH', () => phraseStmt.all(randomPhrase(), BOOK_ID)));
results.push(measure('prefix MATCH', () => prefixStmt.all(randomPrefix(), BOOK_ID)));
results.push(measure('page_lines point lookup (35 lines)', () => linesStmt.all(BOOK_ID, randomPage())));

// (d) index size on disk
db.pragma('wal_checkpoint(TRUNCATE)');
const sizeBytes = statSync(dbPath).size;

// sanity: FTS table row count + a sample result count
const ftsRows = db.prepare('SELECT count(*) AS c FROM page_text').get().c;
const sampleHits = db
  .prepare("SELECT count(*) AS c FROM page_text WHERE page_text MATCH 'cache' AND book_id = ?")
  .get(BOOK_ID).c;

db.close();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const fmt = (x) => x.toFixed(3);
const out = {
  machine: {
    vm: 'Linux x86_64 (this sandbox VM)',
    node: process.version,
    sqlite: '3.53.4 (better-sqlite3 13.0.3, FTS5 enabled)',
    note: 'Proxy only: better-sqlite3 in Node 24. expo-sqlite on-device validation deferred to the APK.',
  },
  corpus: {
    pages: PAGES,
    linesPerPage: LINES_PER_PAGE,
    totalLines,
    ftsRows,
    bookId: BOOK_ID,
  },
  insert: {
    ms: insertMs,
    linesPerSecond: insertThroughput,
    note: `${totalLines} page_lines rows + ${PAGES} page_text rows in one transaction`,
  },
  disk: {
    dbBytes: sizeBytes,
    dbMiB: sizeBytes / 1048576,
    note: 'after wal_checkpoint(TRUNCATE); includes page_lines, page_text (FTS5), index',
  },
  queries: Object.fromEntries(
    results.map((r) => [
      r.label,
      { p50_ms: Number(fmt(r.p50)), p95_ms: Number(fmt(r.p95)), p99_ms: Number(fmt(r.p99)) },
    ]),
  ),
  sanity: { sampleQuery: "MATCH 'cache'", sampleHits },
};

console.log(JSON.stringify(out, null, 2));
rmSync(tmp, { recursive: true, force: true });
