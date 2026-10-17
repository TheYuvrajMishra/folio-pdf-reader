/**
 * store.test.ts — unit tests for the persistent annotation store (PRD §6.7).
 *
 * expo-sqlite has no Node runtime, so we jest.mock('../../data/db') with a
 * better-sqlite3-backed fake implementing the exact SDK 58 async surface
 * the store uses (getFirstAsync/getAllAsync/runAsync + withTransaction).
 * The REAL SQL consts from store.ts execute against a real SQLite engine,
 * so this tests the actual SQL logic — including the v2 batch_id column.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

jest.mock('../../data/db', () => {
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    SCHEMA_STATEMENTS_V1,
    SCHEMA_STATEMENTS_V2,
  } = require('../../data/schema');
  const raw = new Database(':memory:');
  for (const stmt of [...SCHEMA_STATEMENTS_V1, ...SCHEMA_STATEMENTS_V2]) {
    raw.exec(stmt);
  }

  const toArray = (params: unknown): unknown[] =>
    params === undefined ? [] : Array.isArray(params) ? params : [params];

  const fake = {
    getFirstAsync: (sql: string, params?: unknown) =>
      Promise.resolve(raw.prepare(sql).get(toArray(params)) ?? null),
    getAllAsync: (sql: string, params?: unknown) =>
      Promise.resolve(raw.prepare(sql).all(toArray(params))),
    runAsync: (sql: string, params?: unknown) => {
      const info = raw.prepare(sql).run(toArray(params));
      return Promise.resolve({
        changes: info.changes,
        lastInsertRowId: Number(info.lastInsertRowId),
      });
    },
  };

  return {
    getDb: () => Promise.resolve(fake as unknown as SQLiteDatabase),
    withTransaction: <T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> =>
      task(fake as unknown as SQLiteDatabase),
    closeDb: () => Promise.resolve(),
    __resetTables: () => {
      raw.exec('DELETE FROM annotations; DELETE FROM annotation_ops;');
    },
  };
});

import {
  AnnotationStore,
  type Annotation,
  type NewAnnotation,
} from '../store';

const { __resetTables } = jest.requireMock('../../data/db') as {
  __resetTables: () => void;
};

const BOOK = 'book-store-test';

let store: AnnotationStore;

const mkAnn = (overrides: Partial<NewAnnotation> = {}): NewAnnotation => ({
  book_id: BOOK,
  page: 5,
  type: 'highlight',
  color: '#FFD60A',
  opacity: 1,
  dataJson: { rects: [{ x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.25 }] },
  note: null,
  ...overrides,
});

const mkPen = (id: string, polyline: Array<{ x: number; y: number }>): NewAnnotation =>
  mkAnn({ id, type: 'pen', dataJson: { polyline, width: 3 } });

beforeEach(() => {
  __resetTables();
  store = new AnnotationStore(BOOK);
});

describe('AnnotationStore — CRUD + undo/redo (PRD §6.7)', () => {
  test('add → list → undo removes → redo restores', async () => {
    const a = await store.addAnnotation(mkAnn({ id: 'a1' }));
    expect(a.id).toBe('a1');
    expect(a.deleted).toBe(0);
    expect(await store.listAnnotations(5)).toHaveLength(1);
    expect(await store.canUndo()).toBe(true);
    expect(await store.canRedo()).toBe(false);

    const undone = await store.undo();
    expect(undone).not.toBeNull();
    expect(undone).toHaveLength(1);
    expect(undone![0].id).toBe('a1');
    expect(undone![0].deleted).toBe(1); // fade-out signal
    expect(await store.listAnnotations(5)).toHaveLength(0);
    expect(await store.canRedo()).toBe(true);

    const redone = await store.redo();
    expect(redone).not.toBeNull();
    expect(redone![0].deleted).toBe(0);
    const listed = await store.listAnnotations(5);
    expect(listed).toHaveLength(1);
    expect(listed[0].dataJson).toEqual(a.dataJson);
  });

  test('update: undo restores before, redo re-applies after', async () => {
    await store.addAnnotation(mkAnn({ id: 'a1', color: '#FFD60A' }));
    const updated = await store.updateAnnotation('a1', { color: '#6CB6FF' });
    expect(updated!.color).toBe('#6CB6FF');

    await store.undo();
    expect((await store.getAnnotation('a1'))!.color).toBe('#FFD60A');
    await store.redo();
    expect((await store.getAnnotation('a1'))!.color).toBe('#6CB6FF');
  });

  test('update of missing id → null, no op logged', async () => {
    expect(await store.updateAnnotation('nope', { color: '#fff' })).toBeNull();
    expect(await store.canUndo()).toBe(false);
  });

  test('delete is soft: row stays with deleted=1, undo restores', async () => {
    await store.addAnnotation(mkAnn({ id: 'a1' }));
    const deleted = await store.deleteAnnotation('a1');
    expect(deleted!.deleted).toBe(1);
    expect(await store.listAnnotations(5)).toHaveLength(0);
    // Row still in the table, flagged.
    expect((await store.getAnnotation('a1'))!.deleted).toBe(1);

    await store.undo();
    expect((await store.getAnnotation('a1'))!.deleted).toBe(0);
    expect(await store.listAnnotations(5)).toHaveLength(1);

    await store.redo();
    expect(await store.listAnnotations(5)).toHaveLength(0);
  });

  test('new op deletes the redo stack (linear history)', async () => {
    await store.addAnnotation(mkAnn({ id: 'a1' }));
    await store.addAnnotation(mkAnn({ id: 'a2' }));
    await store.undo(); // a2 undone
    expect(await store.canRedo()).toBe(true);
    await store.addAnnotation(mkAnn({ id: 'a3' }));
    expect(await store.canRedo()).toBe(false);
    expect(await store.redo()).toBeNull();
    const ids = (await store.listAllAnnotations()).map((a) => a.id).sort();
    expect(ids).toEqual(['a1', 'a3']);
  });

  test('undo/redo on empty history → null', async () => {
    expect(await store.undo()).toBeNull();
    expect(await store.redo()).toBeNull();
    expect(await store.canUndo()).toBe(false);
    expect(await store.canRedo()).toBe(false);
  });

  test('batch: clearPageAnnotations is one undo step', async () => {
    await store.addAnnotation(mkAnn({ id: 'a1', page: 5 }));
    await store.addAnnotation(mkAnn({ id: 'a2', page: 5 }));
    await store.addAnnotation(mkAnn({ id: 'a3', page: 6 }));

    const cleared = await store.clearPageAnnotations(5);
    expect(cleared).toHaveLength(2);
    expect(await store.listAnnotations(5)).toHaveLength(0);
    expect(await store.listAnnotations(6)).toHaveLength(1);

    const undone = await store.undo();
    expect(undone).not.toBeNull();
    expect(undone).toHaveLength(2); // one step restored both
    expect(await store.listAnnotations(5)).toHaveLength(2);

    const redone = await store.redo();
    expect(redone).toHaveLength(2);
    expect(await store.listAnnotations(5)).toHaveLength(0);
  });

  test('clearPageAnnotations on empty page → [] and no op', async () => {
    expect(await store.clearPageAnnotations(9)).toEqual([]);
    expect(await store.canUndo()).toBe(false);
  });

  test('eraseAt hits only pen strokes within radius (batch delete)', async () => {
    await store.addAnnotation(
      mkPen('p1', [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.5 },
        { x: 0.9, y: 0.1 },
      ]),
    );
    await store.addAnnotation(
      mkPen('p2', [
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.9 },
      ]),
    );
    await store.addAnnotation(mkAnn({ id: 'h1', page: 5 })); // highlight: untouched

    const erased = await store.eraseAt(5, { x: 0.5, y: 0.52 }, 0.05);
    expect(erased.map((a) => a.id)).toEqual(['p1']);

    const remaining = await store.listAnnotations(5);
    expect(remaining.map((a) => a.id).sort()).toEqual(['h1', 'p2']);

    // One undo step restores the erased stroke.
    const undone = await store.undo();
    expect(undone!.map((a) => a.id)).toEqual(['p1']);
    expect((await store.listAnnotations(5)).map((a) => a.id).sort()).toEqual([
      'h1',
      'p1',
      'p2',
    ]);
  });

  test('eraseAt with no hit → [] and no op', async () => {
    await store.addAnnotation(mkPen('p1', [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]));
    expect(await store.eraseAt(5, { x: 0.9, y: 0.9 }, 0.01)).toEqual([]);
    // eraseAt logged nothing: a single undo removes the earlier add.
    await store.undo();
    expect(await store.listAnnotations(5)).toHaveLength(0);
    expect(await store.canUndo()).toBe(false);
  });

  test('pen polyline is Douglas-Peucker simplified at write time (ε=0.0005)', async () => {
    const raw: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40; i++) raw.push({ x: i / 40, y: 0.5 });
    const a = await store.addAnnotation(mkPen('p1', raw));
    expect(a.dataJson.polyline).toHaveLength(2); // collinear → endpoints
    const listed = await store.listAnnotations(5);
    expect(listed[0].dataJson.polyline).toHaveLength(2);
  });

  test('listAnnotations filters by page; listAllAnnotations orders by page', async () => {
    await store.addAnnotation(mkAnn({ id: 'a1', page: 7 }));
    await store.addAnnotation(mkAnn({ id: 'a2', page: 5 }));
    await store.addAnnotation(mkAnn({ id: 'a3', page: 7 }));
    await store.deleteAnnotation('a3');

    expect((await store.listAnnotations(7)).map((a) => a.id)).toEqual(['a1']);
    expect((await store.listAllAnnotations()).map((a) => a.id)).toEqual([
      'a2',
      'a1',
    ]);
  });

  test('annotations are isolated per book', async () => {
    const other = new AnnotationStore('other-book');
    await store.addAnnotation(mkAnn({ id: 'a1' }));
    expect(await other.listAnnotations(5)).toHaveLength(0);
    expect(await other.canUndo()).toBe(false);
    expect(await store.canUndo()).toBe(true);
  });
});
