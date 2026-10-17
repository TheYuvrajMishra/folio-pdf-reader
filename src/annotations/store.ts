/**
 * store.ts — persistent annotation store (PRD §6.7, EXACTLY).
 *
 * SQLite-backed replacement for the in-memory OpLog in ops.ts. Two tables:
 *  - `annotations` — materialized current state (fast render);
 *  - `annotation_ops` — event-sourced op log (seq, op_type, annotation_id,
 *    before/after JSON, undone flag, batch_id), history survives restarts.
 *
 * Rules (PRD §6.7):
 *  - Every mutation writes the op row(s) + the materialized annotations
 *    row(s) in ONE SQLite transaction (withTransaction). DB failure →
 *    the whole action rolls back; an annotation op is never silently dropped.
 *  - undo(): max seq where undone=0 (whole batch if batched) → apply
 *    before_json → undone=1. redo(): min seq where undone=1 (whole batch)
 *    → re-apply after_json → undone=0.
 *  - A new op deletes all undone=1 rows first (standard linear history).
 *  - Multi-annotation actions (eraser sweep, clear page) are one batch op
 *    → a single undo step; batch members share one batch_id.
 *  - Soft deletes: `annotations.deleted = 1`; undo of an add removes the
 *    row again (it was created by that op).
 *
 * The in-memory OpLog class (ops.ts) is kept for the property tests; the
 * SQLite conformance test drives both with identical seeded sequences.
 *
 * Platform note: importing this module is safe in Node (db.ts defers the
 * expo-sqlite dynamic import until getDb() runs). Call the methods only on
 * a React Native runtime; unit tests jest.mock('../data/db') with a
 * better-sqlite3-backed fake of the SDK 58 async surface.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb, withTransaction } from '../data/db';
import { uuidv4 } from '../library/uuid';
import type { NormRect } from '../util/geometry';
import { hitTestStroke, simplifyPolyline, type NormPoint } from './pen';

/** Annotation types (PRD §6.6). */
export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'pen'
  | 'note'
  | 'bookmark'
  | 'rect';

/** Geometry payload stored as JSON in `annotations.data_json`. */
export interface AnnotationData {
  /** Per-line segment rects (highlight/underline/strike) or free box (rect). */
  rects?: NormRect[];
  /** Simplified polyline (pen). Simplified with Douglas-Peucker ε=0.0005. */
  polyline?: NormPoint[];
  /** Pin position (note). */
  noteAnchor?: NormPoint;
  /** Pen stroke width in dp at 1× zoom (pen only). */
  width?: number;
}

/** One materialized annotation (mirrors the `annotations` table). */
export interface Annotation {
  id: string;
  book_id: string;
  /** 1-based page number. */
  page: number;
  type: AnnotationType;
  /** Hex color, e.g. '#FFD60A'. */
  color: string;
  /** 0..1. */
  opacity: number;
  dataJson: AnnotationData;
  /** Note text (type 'note') or attached note; null when none. */
  note: string | null;
  created_at: number;
  updated_at: number;
  /** 0 | 1 — soft delete flag. */
  deleted: 0 | 1;
}

/** Fields accepted by addAnnotation (id optional → generated). */
export type NewAnnotation = Omit<Annotation, 'id' | 'created_at' | 'updated_at' | 'deleted'> & {
  id?: string;
};

/** Fields accepted by updateAnnotation (id/book_id/created_at immutable). */
export type AnnotationPatch = Partial<
  Omit<Annotation, 'id' | 'book_id' | 'created_at'>
>;

export type StoreOpType = 'add' | 'update' | 'delete';

/** One op input for applyBatch (mirrors the NewOpInput shape of ops.ts). */
export interface StoreOpInput {
  opType: StoreOpType;
  annotationId: string;
  before?: Annotation | null;
  after?: Annotation | null;
}

interface OpRow {
  id: number;
  book_id: string;
  seq: number;
  op_type: StoreOpType;
  annotation_id: string;
  before_json: string | null;
  after_json: string | null;
  undone: number;
  batch_id: string | null;
  created_at: number;
}

interface AnnotationRow {
  id: string;
  book_id: string;
  page: number;
  type: AnnotationType;
  color: string;
  opacity: number;
  data_json: string;
  note: string | null;
  created_at: number;
  updated_at: number;
  deleted: number;
}

const ANNOTATION_COLUMNS =
  'id, book_id, page, type, color, opacity, data_json, note, created_at, updated_at, deleted';

/* ---------------- exported SQL (unit-tested as consts) ---------------- */

export const SQL_INSERT_OP = `
  INSERT INTO annotation_ops
    (book_id, seq, op_type, annotation_id, before_json, after_json, undone, batch_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
`;

export const SQL_DELETE_REDONE = `
  DELETE FROM annotation_ops WHERE book_id = ? AND undone = 1
`;

export const SQL_MAX_SEQ = `
  SELECT COALESCE(MAX(seq), -1) AS max_seq FROM annotation_ops WHERE book_id = ?
`;

export const SQL_UPSERT_ANNOTATION = `
  INSERT OR REPLACE INTO annotations
    (${ANNOTATION_COLUMNS})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const SQL_SOFT_DELETE_ANNOTATION = `
  UPDATE annotations SET deleted = 1, updated_at = ? WHERE id = ?
`;

export const SQL_HARD_DELETE_ANNOTATION = `
  DELETE FROM annotations WHERE id = ?
`;

export const SQL_GET_ANNOTATION = `
  SELECT ${ANNOTATION_COLUMNS} FROM annotations WHERE id = ?
`;

export const SQL_LIST_PAGE = `
  SELECT ${ANNOTATION_COLUMNS} FROM annotations
  WHERE book_id = ? AND page = ? AND deleted = 0
  ORDER BY created_at ASC
`;

export const SQL_LIST_ALL = `
  SELECT ${ANNOTATION_COLUMNS} FROM annotations
  WHERE book_id = ? AND deleted = 0
  ORDER BY page ASC, created_at ASC
`;

export const SQL_LIST_PAGE_PENS = `
  SELECT ${ANNOTATION_COLUMNS} FROM annotations
  WHERE book_id = ? AND page = ? AND type = 'pen' AND deleted = 0
`;

export const SQL_UNDO_TARGET = `
  SELECT id, book_id, seq, op_type, annotation_id, before_json, after_json,
         undone, batch_id, created_at
  FROM annotation_ops
  WHERE book_id = ? AND undone = 0
  ORDER BY seq DESC
  LIMIT 1
`;

export const SQL_REDO_TARGET = `
  SELECT id, book_id, seq, op_type, annotation_id, before_json, after_json,
         undone, batch_id, created_at
  FROM annotation_ops
  WHERE book_id = ? AND undone = 1
  ORDER BY seq ASC
  LIMIT 1
`;

export const SQL_BATCH_GROUP = `
  SELECT id, book_id, seq, op_type, annotation_id, before_json, after_json,
         undone, batch_id, created_at
  FROM annotation_ops
  WHERE book_id = ? AND batch_id = ? AND undone = ?
  ORDER BY seq ASC
`;

export const SQL_MARK_BATCH_UNDONE = `
  UPDATE annotation_ops SET undone = ? WHERE book_id = ? AND batch_id = ? AND undone = ?
`;

export const SQL_MARK_OP_UNDONE = `
  UPDATE annotation_ops SET undone = ? WHERE id = ?
`;

export const SQL_CAN_UNDO = `
  SELECT 1 FROM annotation_ops WHERE book_id = ? AND undone = 0 LIMIT 1
`;

export const SQL_CAN_REDO = `
  SELECT 1 FROM annotation_ops WHERE book_id = ? AND undone = 1 LIMIT 1
`;

/* ---------------- row mapping ---------------- */

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    book_id: row.book_id,
    page: row.page,
    type: row.type,
    color: row.color,
    opacity: row.opacity,
    dataJson: JSON.parse(row.data_json) as AnnotationData,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted: row.deleted === 1 ? 1 : 0,
  };
}

/** Bind values this store passes to expo-sqlite (subset of SQLiteBindValue). */
type BindValue = string | number | null;

function annotationToParams(a: Annotation): BindValue[] {
  return [
    a.id,
    a.book_id,
    a.page,
    a.type,
    a.color,
    a.opacity,
    JSON.stringify(a.dataJson),
    a.note,
    a.created_at,
    a.updated_at,
    a.deleted,
  ];
}

/** Pen strokes are stored Douglas-Peucker-simplified (PRD §6.6, ε=0.0005). */
function normalizeData(type: AnnotationType, data: AnnotationData): AnnotationData {
  if (type === 'pen' && data.polyline && data.polyline.length > 2) {
    return { ...data, polyline: simplifyPolyline(data.polyline) };
  }
  return data;
}

/* ---------------- store ---------------- */

/**
 * Per-book persistent annotation store. Create one per open book:
 * `new AnnotationStore(bookId)`.
 */
export class AnnotationStore {
  readonly bookId: string;

  constructor(bookId: string) {
    this.bookId = bookId;
  }

  /* ----- mutations (each = one SQLite transaction) ----- */

  /** Add one annotation (single undo step). Generates an id when absent. */
  async addAnnotation(input: NewAnnotation): Promise<Annotation> {
    const now = Date.now();
    const annotation: Annotation = {
      id: input.id ?? uuidv4(),
      book_id: input.book_id,
      page: input.page,
      type: input.type,
      color: input.color,
      opacity: input.opacity,
      dataJson: normalizeData(input.type, input.dataJson ?? {}),
      note: input.note ?? null,
      created_at: now,
      updated_at: now,
      deleted: 0,
    };
    await this.applyBatch([
      { opType: 'add', annotationId: annotation.id, before: null, after: annotation },
    ]);
    return annotation;
  }

  /**
   * Update one annotation (single undo step). Reads the current row as
   * before_json; patch fields overwrite it (id/book_id/created_at kept).
   * Returns the updated annotation, or null when the id does not exist.
   */
  async updateAnnotation(
    id: string,
    patch: AnnotationPatch,
  ): Promise<Annotation | null> {
    const before = await this.getAnnotation(id);
    if (!before || before.deleted === 1) return null;
    const after: Annotation = {
      ...before,
      ...patch,
      id: before.id,
      book_id: before.book_id,
      created_at: before.created_at,
      dataJson:
        patch.dataJson !== undefined
          ? normalizeData(patch.type ?? before.type, patch.dataJson)
          : before.dataJson,
      updated_at: Date.now(),
    };
    await this.applyBatch([
      { opType: 'update', annotationId: id, before, after },
    ]);
    return after;
  }

  /**
   * Soft-delete one annotation (single undo step). Returns the deleted
   * annotation, or null when the id does not exist / already deleted.
   */
  async deleteAnnotation(id: string): Promise<Annotation | null> {
    const before = await this.getAnnotation(id);
    if (!before || before.deleted === 1) return null;
    await this.applyBatch([
      { opType: 'delete', annotationId: id, before, after: null },
    ]);
    return { ...before, deleted: 1 as const };
  }

  /**
   * Erase pen strokes whose polyline passes within `radius` (normalized
   * page units) of `point` on `page`. One batch op → one undo step.
   * Returns the erased annotations (empty when nothing hit).
   */
  async eraseAt(
    page: number,
    point: NormPoint,
    radius: number,
  ): Promise<Annotation[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<AnnotationRow>(SQL_LIST_PAGE_PENS, [
      this.bookId,
      page,
    ]);
    const hits = rows
      .map(rowToAnnotation)
      .filter((a) => {
        const line = a.dataJson.polyline;
        return line !== undefined && hitTestStroke(line, point, radius);
      });
    if (hits.length === 0) return [];
    await this.applyBatch(
      hits.map((a) => ({
        opType: 'delete' as const,
        annotationId: a.id,
        before: a,
        after: null,
      })),
    );
    return hits.map((a) => ({ ...a, deleted: 1 as const }));
  }

  /**
   * Delete every annotation on `page` (one batch op → one undo step).
   * Returns the deleted annotations.
   */
  async clearPageAnnotations(page: number): Promise<Annotation[]> {
    const live = await this.listAnnotations(page);
    if (live.length === 0) return [];
    await this.applyBatch(
      live.map((a) => ({
        opType: 'delete' as const,
        annotationId: a.id,
        before: a,
        after: null,
      })),
    );
    return live.map((a) => ({ ...a, deleted: 1 as const }));
  }

  /**
   * Append ops as one atomic batch → a single undo/redo step. A batch of
   * one is a plain single op (batch_id NULL). Every call runs in one
   * transaction: linear-history cleanup + op rows + materialized rows.
   */
  async applyBatch(inputs: StoreOpInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const now = Date.now();
    await withTransaction(async (db) => {
      // Linear history: a new op deletes all undone=1 rows.
      await db.runAsync(SQL_DELETE_REDONE, [this.bookId]);
      const seqRow = await db.getFirstAsync<{ max_seq: number }>(SQL_MAX_SEQ, [
        this.bookId,
      ]);
      let seq = (seqRow?.max_seq ?? -1) + 1;
      const batchId = inputs.length > 1 ? uuidv4() : null;
      for (const input of inputs) {
        const before = input.before ?? null;
        const after = input.after ?? null;
        await db.runAsync(SQL_INSERT_OP, [
          this.bookId,
          seq,
          input.opType,
          input.annotationId,
          before ? JSON.stringify(before) : null,
          after ? JSON.stringify(after) : null,
          batchId,
          now,
        ]);
        await this.materialize(db, input);
        seq += 1;
      }
    });
  }

  /** Apply an op's after-state to the materialized table (inside a txn). */
  private async materialize(
    db: SQLiteDatabase,
    input: StoreOpInput,
  ): Promise<void> {
    const after = input.after ?? null;
    if (after === null) {
      // delete op → soft delete the materialized row
      await db.runAsync(SQL_SOFT_DELETE_ANNOTATION, [
        Date.now(),
        input.annotationId,
      ]);
      return;
    }
    await db.runAsync(SQL_UPSERT_ANNOTATION, annotationToParams(after));
  }

  /**
   * Undo one step: the max-seq non-undone op (or its whole batch).
   * Applies before_json in descending seq order. Returns the affected
   * annotations in their post-undo state (for the 140 ms fade animation;
   * annotations removed by the undo are returned with deleted=1), or null
   * when there is nothing to undo.
   */
  async undo(): Promise<Annotation[] | null> {
    return this.step('undo');
  }

  /**
   * Redo one step: the min-seq undone op (or its whole batch).
   * Re-applies after_json in ascending seq order. Returns the affected
   * annotations in their post-redo state, or null when nothing to redo.
   */
  async redo(): Promise<Annotation[] | null> {
    return this.step('redo');
  }

  private async step(kind: 'undo' | 'redo'): Promise<Annotation[] | null> {
    const targetSql = kind === 'undo' ? SQL_UNDO_TARGET : SQL_REDO_TARGET;
    const affected: Annotation[] = [];
    await withTransaction(async (db) => {
      const target = await db.getFirstAsync<OpRow>(targetSql, [this.bookId]);
      if (!target) return;
      let group: OpRow[];
      if (target.batch_id !== null) {
        // Batch members always share the undone flag (undo/redo marks the
        // whole batch), so this selects exactly the batch.
        group = await db.getAllAsync<OpRow>(SQL_BATCH_GROUP, [
          this.bookId,
          target.batch_id,
          kind === 'undo' ? 0 : 1,
        ]);
      } else {
        group = [target];
      }
      if (group.length === 0) return;
      const markTo = kind === 'undo' ? 1 : 0;
      if (target.batch_id !== null) {
        await db.runAsync(SQL_MARK_BATCH_UNDONE, [
          markTo,
          this.bookId,
          target.batch_id,
          kind === 'undo' ? 0 : 1,
        ]);
      } else {
        await db.runAsync(SQL_MARK_OP_UNDONE, [markTo, target.id]);
      }
      // Undo applies before_json last-op-first; redo applies after_json
      // first-op-first (mirrors OpLog.state() replay semantics).
      const ordered = [...group].sort((a, b) =>
        kind === 'undo' ? b.seq - a.seq : a.seq - b.seq,
      );
      for (const op of ordered) {
        const payload =
          kind === 'undo' ? op.before_json : op.after_json;
        const annotation =
          payload !== null ? (JSON.parse(payload) as Annotation) : null;
        if (annotation === null) {
          if (kind === 'undo') {
            // Undo of an add: the row was created by this op → remove it.
            const cur = await db.getFirstAsync<AnnotationRow>(
              SQL_GET_ANNOTATION,
              [op.annotation_id],
            );
            if (cur) {
              await db.runAsync(SQL_HARD_DELETE_ANNOTATION, [op.annotation_id]);
              affected.push({ ...rowToAnnotation(cur), deleted: 1 as const });
            }
          } else {
            // Redo of a delete: soft-delete again.
            const cur = await db.getFirstAsync<AnnotationRow>(
              SQL_GET_ANNOTATION,
              [op.annotation_id],
            );
            if (cur) {
              await db.runAsync(SQL_SOFT_DELETE_ANNOTATION, [
                Date.now(),
                op.annotation_id,
              ]);
              affected.push({ ...rowToAnnotation(cur), deleted: 1 as const });
            }
          }
        } else {
          await db.runAsync(
            SQL_UPSERT_ANNOTATION,
            annotationToParams(annotation),
          );
          affected.push(annotation);
        }
      }
    });
    return affected.length > 0 ? affected : null;
  }

  /* ----- reads ----- */

  /** Live annotations on one page, oldest first (render order). */
  async listAnnotations(page: number): Promise<Annotation[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<AnnotationRow>(SQL_LIST_PAGE, [
      this.bookId,
      page,
    ]);
    return rows.map(rowToAnnotation);
  }

  /** Every live annotation in the book (page, then creation order) — M5 export. */
  async listAllAnnotations(): Promise<Annotation[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<AnnotationRow>(SQL_LIST_ALL, [this.bookId]);
    return rows.map(rowToAnnotation);
  }

  /** Single annotation by id (including soft-deleted ones). */
  async getAnnotation(id: string): Promise<Annotation | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<AnnotationRow>(SQL_GET_ANNOTATION, [id]);
    return row ? rowToAnnotation(row) : null;
  }

  /** Toolbar state: is there anything to undo? */
  async canUndo(): Promise<boolean> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ '1': number }>(SQL_CAN_UNDO, [
      this.bookId,
    ]);
    return row !== null;
  }

  /** Toolbar state: is there anything to redo? */
  async canRedo(): Promise<boolean> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ '1': number }>(SQL_CAN_REDO, [
      this.bookId,
    ]);
    return row !== null;
  }
}
