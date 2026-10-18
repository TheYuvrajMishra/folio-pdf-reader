#!/usr/bin/env node
/**
 * Spike S3 — SQLite WAL + FTS5 page_text (PRD §9 M0).
 *
 * expo-sqlite doesn't run in Node, so this measures the same SQLite
 * engine semantics via node:sqlite (bundled SQLite with FTS5): insert
 * ~10k text lines + FTS5 table, then measure insert + query latency.
 * The app schema (src/data/db.ts) mirrors these tables exactly.
 */
import { DatabaseSync } from 'node:sqlite';

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const N = 10000;
const db = new DatabaseSync(':memory:');
console.log(`sqlite version: ${db.prepare('select sqlite_version() as v').get().v}`);

db.exec('PRAGMA journal_mode=WAL;');
db.exec(`CREATE TABLE page_lines(
  book_id TEXT, page INTEGER, idx INTEGER,
  x0 REAL, y0 REAL, x1 REAL, y1 REAL, text TEXT, kind TEXT,
  PRIMARY KEY(book_id, page, idx))`);
db.exec(`CREATE VIRTUAL TABLE page_text USING fts5(book_id UNINDEXED, page UNINDEXED, text)`);

// Deterministic pseudo-text.
const words = ['fox', 'riverbank', 'scholar', 'codex', 'margin', 'reading', 'chapter', 'dawn', 'text', 'page'];
function lineText(i) {
  const w = [];
  const n = 8 + (i % 9);
  for (let k = 0; k < n; k++) w.push(words[(i * 7 + k * 13) % words.length]);
  return w.join(' ');
}

const t0 = performance.now();
const insLine = db.prepare(
  'INSERT INTO page_lines(book_id,page,idx,x0,y0,x1,y1,text,kind) VALUES(?,?,?,?,?,?,?,?,?)');
const insFts = db.prepare('INSERT INTO page_text(book_id,page,text) VALUES(?,?,?)');
db.exec('BEGIN');
for (let i = 0; i < N; i++) {
  const page = 1 + Math.floor(i / 500);
  const text = lineText(i);
  insLine.run('book1', page, i % 500, 0.1, 0.1, 0.9, 0.12, text, 'body');
  insFts.run('book1', page, text);
}
db.exec('COMMIT');
const insertMs = performance.now() - t0;

const queries = ['fox', 'scholar AND codex', '"riverbank at dawn"', 'margin*', 'chapter NEAR reading'];
const qMs = [];
for (const q of queries) {
  const runs = [];
  for (let r = 0; r < 20; r++) {
    const a = performance.now();
    db.prepare(`SELECT page, snippet(page_text, 2, '<b>', '</b>', '…', 12) AS snip
                FROM page_text WHERE page_text MATCH ? LIMIT 20`).all(q);
    runs.push(performance.now() - a);
  }
  qMs.push({ q, p50: percentile(runs, 50) });
}

const count = db.prepare('SELECT COUNT(*) AS c FROM page_lines').get().c;
console.log('--- S3 results (node:sqlite, same engine family as expo-sqlite) ---');
console.log(`insert ${N} lines + FTS rows: ${insertMs.toFixed(0)}ms total (${(insertMs / N).toFixed(3)}ms/row)`);
console.log(`rows verified: ${count}`);
for (const { q, p50 } of qMs) console.log(`fts query "${q}": p50=${p50.toFixed(2)}ms`);
db.close();
