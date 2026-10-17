/**
 * integrations.ts — bridges to the annotations agent's store (M5).
 *
 * Real contract (src/annotations/store.ts, landed): a per-book class —
 * `new AnnotationStore(bookId)` with `listAllAnnotations()`,
 * `deleteAnnotation(id)` (returns the deleted annotation, op-logged) and
 * `undo()` (restores the last op — drives the Undo snackbar after a delete).
 *
 * The import stays dynamic + defensive: if the module ever fails to load,
 * every loader resolves to null and the UI degrades gracefully (empty
 * states, delete actions hidden) instead of crashing.
 */

import type { Annotation as StoreAnnotation } from '../annotations/store';

export type { StoreAnnotation };

export interface AnnotationStoreHandle {
  listAllAnnotations: () => Promise<StoreAnnotation[]>;
  /** Op-logged delete; returns the deleted annotation (or null). */
  deleteAnnotation: (id: string) => Promise<StoreAnnotation | null>;
  /** Undo the last op — restores a just-deleted annotation. */
  undo: () => Promise<StoreAnnotation[] | null>;
}

const cache = new Map<string, AnnotationStoreHandle | null>();

/**
 * Load (and cache) a per-book store handle. Resolves to null when the
 * module is unavailable — callers must degrade, never throw.
 */
export async function loadAnnotationStore(bookId: string): Promise<AnnotationStoreHandle | null> {
  if (cache.has(bookId)) return cache.get(bookId) ?? null;
  try {
    const { AnnotationStore } = await import('../annotations/store');
    const store = new AnnotationStore(bookId);
    const handle: AnnotationStoreHandle = {
      listAllAnnotations: () => store.listAllAnnotations(),
      deleteAnnotation: (id: string) => store.deleteAnnotation(id),
      undo: () => store.undo(),
    };
    cache.set(bookId, handle);
    return handle;
  } catch {
    cache.set(bookId, null);
    return null;
  }
}

/** True when the annotation list contract is available. */
export async function hasAnnotationStore(bookId: string): Promise<boolean> {
  return (await loadAnnotationStore(bookId)) !== null;
}

/**
 * Placeholder: toggle annotate mode. The annotations agent's M4 mount
 * contract (ANNOTATE_INTEGRATION.md) wires annotate mode via an AnnotateHost
 * in the reader — no toggle export exists yet, so this returns false and the
 * menu row stays a disabled placeholder.
 */
export async function tryToggleAnnotate(): Promise<boolean> {
  return false;
}

/** Side-effect-free probe for the annotate-mode toggle. */
export async function isAnnotateAvailable(): Promise<boolean> {
  return false;
}

/**
 * Placeholder: toggle the reading ruler via the ruler agent's contract.
 *
 * NOTE: this is intentionally a static placeholder, not a dynamic import
 * probe. Metro resolves every `import()` at bundle time, so probing for a
 * module that does not exist yet would break the release build. The ruler
 * agent's contract (src/ruler/RULER_INTEGRATION.md) mounts the ruler via a
 * wrapper around the reader — not through this menu — so this stays
 * disabled until that agent publishes a toggle entry point.
 */
export async function tryToggleRuler(): Promise<boolean> {
  return false;
}

/** Side-effect-free probe: is the ruler contract present? (See above.) */
export async function isRulerAvailable(): Promise<boolean> {
  return false;
}
