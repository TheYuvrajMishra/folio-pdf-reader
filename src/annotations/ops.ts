/**
 * ops.ts — in-memory undo/redo op log (PRD §6.7 semantics).
 *
 * Schema mirrors the SQLite table annotation_ops:
 *   seq, op_type[add|update|delete], annotation_id, before/after JSON,
 *   undone flag. The materialized annotation map is derived by replaying
 *   non-undone ops in seq order (in the real app this lives in the
 *   `annotations` table, updated in the same SQLite transaction).
 *
 * Rules:
 *  - undo(): max seq with undone=0 → mark undone=1 (whole batch if batched).
 *  - redo(): min seq with undone=1 → mark undone=0 (whole batch if batched).
 *  - A new op deletes all undone=1 rows first (standard linear history).
 *  - Multi-annotation actions (eraser sweep, delete-page, …) are one batch
 *    op → a single undo step.
 *
 * Platform-free: no react-native imports. before/after are deep-cloned on
 * the way in and out so callers can never alias internal state.
 */

export type OpType = 'add' | 'update' | 'delete';

/** JSON-able annotation payload. `id` is the annotation's stable id. */
export interface Annotation {
  id: string;
  [key: string]: unknown;
}

export interface Op {
  seq: number;
  opType: OpType;
  annotationId: string;
  /** State before the op; null for add. */
  before: Annotation | null;
  /** State after the op; null for delete. */
  after: Annotation | null;
  undone: boolean;
  /** Non-null when this op belongs to a multi-op batch (one undo step). */
  batchId: string | null;
}

export interface NewOpInput {
  opType: OpType;
  annotationId: string;
  before?: Annotation | null;
  after?: Annotation | null;
}

function clone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export class OpLog {
  private ops: Op[] = [];
  private nextSeq = 0;
  private batchCounter = 0;
  readonly bookId: string;

  constructor(bookId = 'default') {
    this.bookId = bookId;
  }

  /** Append a single op (linear history: clears the redo stack first). */
  applyOp(input: NewOpInput): Op {
    return this.applyBatch([input])[0];
  }

  /**
   * Append several ops as one atomic batch → a single undo/redo step.
   * All ops in the batch share a batchId; a single op has batchId null.
   */
  applyBatch(inputs: NewOpInput[]): Op[] {
    if (inputs.length === 0) return [];
    // Linear history: a new op deletes all undone=1 rows.
    this.ops = this.ops.filter((o) => !o.undone);
    const batchId = inputs.length > 1 ? `b${++this.batchCounter}` : null;
    const applied: Op[] = [];
    for (const input of inputs) {
      const op: Op = {
        seq: this.nextSeq++,
        opType: input.opType,
        annotationId: input.annotationId,
        before: clone(input.before ?? null),
        after: clone(input.after ?? null),
        undone: false,
        batchId,
      };
      this.ops.push(op);
      applied.push(op);
    }
    return applied;
  }

  /**
   * Undo one step: the max-seq non-undone op (or its whole batch).
   * Returns the undone ops (ascending seq) or null when nothing to undo.
   */
  undo(): Op[] | null {
    let target: Op | null = null;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      if (!this.ops[i].undone) {
        target = this.ops[i];
        break;
      }
    }
    if (!target) return null;
    const group =
      target.batchId !== null
        ? this.ops.filter(
            (o) => !o.undone && o.batchId === (target as Op).batchId,
          )
        : [target];
    for (const op of group) op.undone = true;
    return [...group].sort((a, b) => a.seq - b.seq);
  }

  /**
   * Redo one step: the min-seq undone op (or its whole batch).
   * Returns the redone ops (ascending seq) or null when nothing to redo.
   */
  redo(): Op[] | null {
    const target = this.ops.find((o) => o.undone) ?? null; // ops stay in seq order
    if (!target) return null;
    const group =
      target.batchId !== null
        ? this.ops.filter(
            (o) => o.undone && o.batchId === (target as Op).batchId,
          )
        : [target];
    for (const op of group) op.undone = false;
    return [...group].sort((a, b) => a.seq - b.seq);
  }

  canUndo(): boolean {
    return this.ops.some((o) => !o.undone);
  }

  canRedo(): boolean {
    return this.ops.some((o) => o.undone);
  }

  /**
   * Materialized current state: replay non-undone ops in seq order.
   * add/update → after; delete → removed. Returned map is a deep copy.
   */
  state(): Map<string, Annotation> {
    const m = new Map<string, Annotation>();
    for (const op of this.ops) {
      if (op.undone) continue;
      if (op.after !== null) m.set(op.annotationId, clone(op.after));
      else m.delete(op.annotationId);
    }
    return m;
  }

  /** Full op log (deep copy), in seq order. */
  log(): Op[] {
    return this.ops.map((o) => ({
      ...o,
      before: clone(o.before),
      after: clone(o.after),
    }));
  }

  /** Number of op rows currently stored. */
  get size(): number {
    return this.ops.length;
  }
}
