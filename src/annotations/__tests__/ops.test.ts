import { OpLog, type Annotation, type Op } from '../ops';

/**
 * better-sqlite3 mock of ../../data/db (same pattern as
 * src/data/__tests__/positions.test.ts): the REAL SQL from store.ts runs
 * against a real SQLite engine, so the conformance suite below tests the
 * actual SQL logic, not just query strings.
 */
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
    getDb: () => Promise.resolve(fake),
    withTransaction: <T>(task: (db: unknown) => Promise<T>): Promise<T> =>
      task(fake),
    closeDb: () => Promise.resolve(),
    __resetTables: () => {
      raw.exec('DELETE FROM annotations; DELETE FROM annotation_ops;');
    },
  };
});

import { AnnotationStore, type Annotation as StoreAnnotation } from '../store';

/** Deterministic PRNG (mulberry32) — no external deps. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent replay of the log: non-undone ops, seq order, from empty. */
function replayState(ops: Op[]): Map<string, Annotation> {
  const m = new Map<string, Annotation>();
  for (const op of [...ops].sort((a, b) => a.seq - b.seq)) {
    if (op.undone) continue;
    if (op.after !== null) {
      m.set(op.annotationId, JSON.parse(JSON.stringify(op.after)));
    } else {
      m.delete(op.annotationId);
    }
  }
  return m;
}

function mapsEqual(
  a: Map<string, Annotation>,
  b: Map<string, Annotation>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined) return false;
    if (JSON.stringify(v) !== JSON.stringify(w)) return false;
  }
  return true;
}

const ann = (id: string, extra: Record<string, unknown> = {}): Annotation => ({
  id,
  type: 'highlight',
  color: 'yellow',
  ...extra,
});

describe('OpLog — basic semantics', () => {
  test('add → undo → redo', () => {
    const log = new OpLog('b1');
    log.applyOp({ opType: 'add', annotationId: 'a1', after: ann('a1') });
    expect(log.state().has('a1')).toBe(true);
    expect(log.canUndo()).toBe(true);
    expect(log.canRedo()).toBe(false);

    const undone = log.undo();
    expect(undone).toHaveLength(1);
    expect(undone![0].undone).toBe(true);
    expect(log.state().size).toBe(0);
    expect(log.canRedo()).toBe(true);

    const redone = log.redo();
    expect(redone).toHaveLength(1);
    expect(redone![0].undone).toBe(false);
    expect(log.state().get('a1')).toEqual(ann('a1'));
  });

  test('update: undo restores before, redo re-applies after', () => {
    const log = new OpLog();
    const before = ann('a1', { color: 'yellow' });
    const after = ann('a1', { color: 'red' });
    log.applyOp({ opType: 'add', annotationId: 'a1', after: before });
    log.applyOp({ opType: 'update', annotationId: 'a1', before, after });
    expect(log.state().get('a1')).toEqual(after);
    log.undo();
    expect(log.state().get('a1')).toEqual(before);
    log.redo();
    expect(log.state().get('a1')).toEqual(after);
  });

  test('delete: undo restores, redo deletes again', () => {
    const log = new OpLog();
    log.applyOp({ opType: 'add', annotationId: 'a1', after: ann('a1') });
    log.applyOp({
      opType: 'delete',
      annotationId: 'a1',
      before: ann('a1'),
      after: null,
    });
    expect(log.state().has('a1')).toBe(false);
    log.undo();
    expect(log.state().get('a1')).toEqual(ann('a1'));
    log.redo();
    expect(log.state().has('a1')).toBe(false);
  });

  test('undo/redo on empty history return null', () => {
    const log = new OpLog();
    expect(log.undo()).toBeNull();
    expect(log.redo()).toBeNull();
    expect(log.canUndo()).toBe(false);
    expect(log.canRedo()).toBe(false);
  });

  test('new op clears the redo stack (linear history)', () => {
    const log = new OpLog();
    log.applyOp({ opType: 'add', annotationId: 'a1', after: ann('a1') });
    log.applyOp({ opType: 'add', annotationId: 'a2', after: ann('a2') });
    log.undo(); // a2 undone
    expect(log.canRedo()).toBe(true);
    log.applyOp({ opType: 'add', annotationId: 'a3', after: ann('a3') });
    // The undone row is deleted, not just flagged.
    expect(log.canRedo()).toBe(false);
    expect(log.redo()).toBeNull();
    expect(log.size).toBe(2);
    expect([...log.state().keys()].sort()).toEqual(['a1', 'a3']);
    // State still equals replay after the history rewrite.
    expect(mapsEqual(log.state(), replayState(log.log()))).toBe(true);
  });

  test('batch: multi-annotation action is one undo step', () => {
    const log = new OpLog();
    const ops = log.applyBatch([
      { opType: 'add', annotationId: 'a1', after: ann('a1') },
      { opType: 'add', annotationId: 'a2', after: ann('a2') },
      { opType: 'add', annotationId: 'a3', after: ann('a3') },
    ]);
    expect(ops).toHaveLength(3);
    const batchId = ops[0].batchId;
    expect(batchId).not.toBeNull();
    expect(new Set(ops.map((o) => o.batchId)).size).toBe(1);
    expect(log.state().size).toBe(3);

    const undone = log.undo();
    expect(undone).toHaveLength(3); // one step undoes all three
    expect(log.state().size).toBe(0);

    const redone = log.redo();
    expect(redone).toHaveLength(3);
    expect(log.state().size).toBe(3);
  });

  test('batch undo then new op clears the whole batch from history', () => {
    const log = new OpLog();
    log.applyBatch([
      { opType: 'add', annotationId: 'a1', after: ann('a1') },
      { opType: 'add', annotationId: 'a2', after: ann('a2') },
    ]);
    log.undo();
    log.applyOp({ opType: 'add', annotationId: 'a9', after: ann('a9') });
    expect(log.size).toBe(1);
    expect([...log.state().keys()]).toEqual(['a9']);
  });

  test('before/after are deep-cloned: caller mutation cannot corrupt the log', () => {
    const log = new OpLog();
    const payload = ann('a1', { tags: ['x'] });
    log.applyOp({ opType: 'add', annotationId: 'a1', after: payload });
    (payload.tags as string[]).push('MUTATED');
    payload.color = 'MUTATED';
    expect(log.state().get('a1')).toEqual(ann('a1', { tags: ['x'] }));

    const leaked = log.state().get('a1')!;
    leaked.color = 'MUTATED';
    expect(log.state().get('a1')).toEqual(ann('a1', { tags: ['x'] }));
  });
});

describe('OpLog — property test (PRD §6.7 acceptance)', () => {
  const COLORS = ['yellow', 'red', 'blue', 'green', 'pink'];

  function runScenario(seed: number, steps: number): { log: Op[]; undos: number; redos: number } {
    const rand = mulberry32(seed);
    const log = new OpLog(`book-${seed}`);
    const allIds: string[] = [];
    let idCounter = 0;
    let undos = 0;
    let redos = 0;
    const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

    const newId = (): string => {
      const id = `a${idCounter++}`;
      allIds.push(id);
      return id;
    };
    const liveIds = (): string[] =>
      allIds.filter((id) => log.state().has(id));

    for (let i = 0; i < steps; i++) {
      const r = rand();
      if (r < 0.32 || allIds.length === 0) {
        // add — sometimes a batch of adds
        const n = rand() < 0.2 ? 2 + Math.floor(rand() * 3) : 1;
        log.applyBatch(
          Array.from({ length: n }, () => {
            const id = newId();
            return {
              opType: 'add' as const,
              annotationId: id,
              after: ann(id, {
                color: pick(COLORS),
                page: Math.floor(rand() * 50),
              }),
            };
          }),
        );
      } else if (r < 0.55) {
        // update a live annotation
        const live = liveIds();
        if (live.length === 0) {
          const id = newId();
          log.applyOp({ opType: 'add', annotationId: id, after: ann(id) });
        } else {
          const id = pick(live);
          const before = log.state().get(id)!;
          const after: Annotation = {
            ...before,
            color: pick(COLORS),
            v: ((before.v as number | undefined) ?? 0) + 1,
          };
          log.applyOp({ opType: 'update', annotationId: id, before, after });
        }
      } else if (r < 0.7) {
        // delete — sometimes an eraser-sweep batch
        const live = liveIds();
        if (live.length === 0) {
          const id = newId();
          log.applyOp({ opType: 'add', annotationId: id, after: ann(id) });
        } else {
          const n = rand() < 0.25 ? Math.min(live.length, 2 + Math.floor(rand() * 3)) : 1;
          const victims = [...live].sort(() => rand() - 0.5).slice(0, n);
          log.applyBatch(
            victims.map((id) => ({
              opType: 'delete' as const,
              annotationId: id,
              before: log.state().get(id)!,
              after: null,
            })),
          );
        }
      } else if (r < 0.86) {
        if (log.undo() !== null) undos++;
      } else {
        if (log.redo() !== null) redos++;
      }
      // PRD acceptance: materialized state === full log replay, after EVERY op.
      if (!mapsEqual(log.state(), replayState(log.log()))) {
        throw new Error(
          `seed=${seed} step=${i}: materialized state != log replay`,
        );
      }
    }
    return { log: log.log(), undos, redos };
  }

  test.each([1, 7, 42, 1234, 99999])(
    'seed %i: 200 random ops keep state == replay',
    (seed) => {
      const { log: finalLog, undos, redos } = runScenario(seed, 200);
      // Sanity: the scenario actually exercised undo and redo.
      expect(finalLog.length).toBeGreaterThan(0);
      expect(undos).toBeGreaterThan(0);
      expect(redos).toBeGreaterThan(0);
    },
  );

  test('same seed → identical op log (deterministic)', () => {
    const a = JSON.stringify(runScenario(2026, 200).log);
    const b = JSON.stringify(runScenario(2026, 200).log);
    expect(a).toBe(b);
  });

  test('long stress: 1000 ops, seed 5', () => {
    runScenario(5, 1000);
  });
});

describe('SQLite store conformance (PRD §6.7 acceptance)', () => {
  // The SAME seeded random op sequences drive both the in-memory OpLog
  // and the SQLite-backed AnnotationStore; after every step the
  // materialized states (and canUndo/canRedo) must be identical.
  const { __resetTables } = jest.requireMock('../../data/db') as {
    __resetTables: () => void;
  };

  const COLORS = ['yellow', 'red', 'blue', 'green', 'pink'];
  const FIELDS = [
    'id',
    'book_id',
    'page',
    'type',
    'color',
    'opacity',
    'dataJson',
    'note',
    'deleted',
  ] as const;

  const mkPayload = (
    bookId: string,
    id: string,
    extra: Record<string, unknown> = {},
  ): Annotation => ({
    id,
    book_id: bookId,
    page: 1,
    type: 'highlight',
    color: 'yellow',
    opacity: 1,
    dataJson: { rects: [{ x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.22 }] },
    note: null,
    created_at: 0,
    updated_at: 0,
    deleted: 0,
    ...extra,
  });

  /** Drop in-memory-only extras (e.g. `v`) → canonical store shape. */
  const toStoreAnn = (bookId: string, a: Annotation | null): StoreAnnotation | null => {
    if (!a) return null;
    return {
      id: a.id,
      book_id: bookId,
      page: typeof a['page'] === 'number' ? (a['page'] as number) : 1,
      type: (a['type'] as StoreAnnotation['type']) ?? 'highlight',
      color: typeof a['color'] === 'string' ? (a['color'] as string) : '#FFD60A',
      opacity: typeof a['opacity'] === 'number' ? (a['opacity'] as number) : 1,
      dataJson: (a['dataJson'] as StoreAnnotation['dataJson']) ?? {},
      note: typeof a['note'] === 'string' ? (a['note'] as string) : null,
      created_at: 0,
      updated_at: 0,
      deleted: a['deleted'] === 1 ? 1 : 0,
    };
  };

  function canonState(m: Map<string, unknown>): string {
    const entries = [...m.entries()].map(([id, v]) => {
      const picked: Record<string, unknown> = {};
      const rec = v as Record<string, unknown>;
      for (const f of FIELDS) picked[f] = rec[f];
      return [id, picked] as const;
    });
    entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return JSON.stringify(entries);
  }

  beforeEach(() => {
    __resetTables();
  });

  async function driveDual(
    seed: number,
    steps: number,
  ): Promise<{ undos: number; redos: number }> {
    const rand = mulberry32(seed);
    const bookId = `book-${seed}`;
    const mem = new OpLog(bookId);
    const store = new AnnotationStore(bookId);
    const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

    const allIds: string[] = [];
    let idCounter = 0;
    const newId = (): string => {
      const id = `a${idCounter++}`;
      allIds.push(id);
      return id;
    };
    const liveIds = (): string[] => allIds.filter((id) => mem.state().has(id));
    let undos = 0;
    let redos = 0;

    const storeState = async (): Promise<Map<string, unknown>> =>
      new Map((await store.listAllAnnotations()).map((a) => [a.id, a]));

    for (let i = 0; i < steps; i++) {
      const r = rand();
      if (r < 0.32 || allIds.length === 0) {
        // add — sometimes a batch of adds
        const n = rand() < 0.2 ? 2 + Math.floor(rand() * 3) : 1;
        const inputs = Array.from({ length: n }, () => {
          const id = newId();
          return {
            opType: 'add' as const,
            annotationId: id,
            after: mkPayload(bookId, id, {
              color: pick(COLORS),
              page: Math.floor(rand() * 50),
            }),
          };
        });
        mem.applyBatch(inputs);
        await store.applyBatch(
          inputs.map((inp) => ({
            opType: inp.opType,
            annotationId: inp.annotationId,
            before: null,
            after: toStoreAnn(bookId, inp.after),
          })),
        );
      } else if (r < 0.55) {
        // update a live annotation
        const live = liveIds();
        if (live.length === 0) {
          const id = newId();
          const after = mkPayload(bookId, id);
          mem.applyOp({ opType: 'add', annotationId: id, after });
          await store.applyBatch([
            {
              opType: 'add',
              annotationId: id,
              before: null,
              after: toStoreAnn(bookId, after),
            },
          ]);
        } else {
          const id = pick(live);
          const before = mem.state().get(id)!;
          const after: Annotation = {
            ...before,
            color: pick(COLORS),
            v: ((before.v as number | undefined) ?? 0) + 1,
          };
          mem.applyOp({ opType: 'update', annotationId: id, before, after });
          await store.applyBatch([
            {
              opType: 'update',
              annotationId: id,
              before: toStoreAnn(bookId, before),
              after: toStoreAnn(bookId, after),
            },
          ]);
        }
      } else if (r < 0.7) {
        // delete — sometimes an eraser-sweep batch
        const live = liveIds();
        if (live.length === 0) {
          const id = newId();
          const after = mkPayload(bookId, id);
          mem.applyOp({ opType: 'add', annotationId: id, after });
          await store.applyBatch([
            {
              opType: 'add',
              annotationId: id,
              before: null,
              after: toStoreAnn(bookId, after),
            },
          ]);
        } else {
          const n = rand() < 0.25 ? Math.min(live.length, 2 + Math.floor(rand() * 3)) : 1;
          const victims = [...live].sort(() => rand() - 0.5).slice(0, n);
          const inputs = victims.map((id) => ({
            opType: 'delete' as const,
            annotationId: id,
            before: mem.state().get(id)!,
            after: null,
          }));
          mem.applyBatch(inputs);
          await store.applyBatch(
            inputs.map((inp) => ({
              opType: inp.opType,
              annotationId: inp.annotationId,
              before: toStoreAnn(bookId, inp.before),
              after: null,
            })),
          );
        }
      } else if (r < 0.86) {
        const a = mem.undo();
        const b = await store.undo();
        if ((a === null) !== (b === null)) {
          throw new Error(`seed=${seed} step=${i}: undo null-ness diverged`);
        }
        if (a !== null) undos++;
      } else {
        const a = mem.redo();
        const b = await store.redo();
        if ((a === null) !== (b === null)) {
          throw new Error(`seed=${seed} step=${i}: redo null-ness diverged`);
        }
        if (a !== null) redos++;
      }
      // PRD acceptance: identical materialized state after EVERY step.
      const memCanon = canonState(mem.state());
      const storeCanon = canonState(await storeState());
      if (memCanon !== storeCanon) {
        throw new Error(
          `seed=${seed} step=${i}: SQLite store state != in-memory OpLog state`,
        );
      }
      if ((await store.canUndo()) !== mem.canUndo()) {
        throw new Error(`seed=${seed} step=${i}: canUndo diverged`);
      }
      if ((await store.canRedo()) !== mem.canRedo()) {
        throw new Error(`seed=${seed} step=${i}: canRedo diverged`);
      }
    }
    return { undos, redos };
  }

  test.each([1, 7, 42])(
    'seed %i: 150 dual-driven ops keep SQLite state == in-memory state',
    async (seed) => {
      const { undos, redos } = await driveDual(seed, 150);
      expect(undos).toBeGreaterThan(0);
      expect(redos).toBeGreaterThan(0);
    },
  );

  test('batch undo is a single step in the SQLite store too', async () => {
    const store = new AnnotationStore('book-batch');
    await store.applyBatch([
      {
        opType: 'add',
        annotationId: 'b1',
        before: null,
        after: toStoreAnn('book-batch', mkPayload('book-batch', 'b1')),
      },
      {
        opType: 'add',
        annotationId: 'b2',
        before: null,
        after: toStoreAnn('book-batch', mkPayload('book-batch', 'b2')),
      },
    ]);
    expect((await store.listAllAnnotations()).map((a) => a.id).sort()).toEqual([
      'b1',
      'b2',
    ]);
    const undone = await store.undo();
    expect(undone).not.toBeNull();
    expect(undone).toHaveLength(2); // one step undoes the whole batch
    expect(await store.listAllAnnotations()).toHaveLength(0);
    expect(await store.canUndo()).toBe(false);
    const redone = await store.redo();
    expect(redone).toHaveLength(2);
    expect((await store.listAllAnnotations()).map((a) => a.id).sort()).toEqual([
      'b1',
      'b2',
    ]);
  });
});
