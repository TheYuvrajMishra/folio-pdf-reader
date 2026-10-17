/**
 * engineSerial.ts — serialized, lifecycle-safe access to the headless PdfEngine.
 *
 * Contract note: the READER agent owns src/engine/engineHost.tsx, which exports
 * `getEngine(): PdfEngine` (singleton) and mounts the hidden WebView. That file
 * does not exist yet, so this module holds its own singleton slot instead of
 * importing it (a static import would break the Metro bundle until the file
 * lands). Once EngineHost exists, the reader agent wires it with one call from
 * the root layout:
 *
 *     import { getEngine } from '../engine/engineHost';
 *     import { setSharedEngine } from '../library/engineSerial';
 *     setSharedEngine(getEngine());
 *
 * `withEngineDocument(bytes, fn)` serializes whole-document sessions with a
 * promise mutex: open → fn(engine, opened) → close (always, even on throw).
 * The engine itself also queues requests, but document-level serialization
 * keeps open/close pairing unambiguous for background jobs like the indexer.
 */

import type { OpenResult } from '../engine/protocol';
import type { PdfEngine } from '../engine/PdfEngine';
import { base64ToBytes } from './base64';

let sharedEngine: PdfEngine | null = null;

/**
 * Attach the engine singleton. Called once the reader agent's EngineHost is
 * mounted (see header).
 */
export function setSharedEngine(engine: PdfEngine): void {
  sharedEngine = engine;
}

function requireEngine(): PdfEngine {
  if (!sharedEngine) {
    throw new Error(
      '[folio] engine not attached — the reader agent must call ' +
        'setSharedEngine(getEngine()) from the root layout once EngineHost is mounted.',
    );
  }
  return sharedEngine;
}

// Simple promise mutex: each acquirer waits for the previous release.
let mutex: Promise<void> = Promise.resolve();

function acquire(): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = mutex;
  mutex = previous.then(() => next);
  return previous.then(() => release);
}

/**
 * Open `bytes` in the engine, run `fn`, then close the document — serialized
 * against other document sessions. Rejects if the engine isn't attached yet.
 */
export async function withEngineDocument<T>(
  bytes: Uint8Array,
  fn: (engine: PdfEngine, opened: OpenResult) => Promise<T>,
): Promise<T> {
  const release = await acquire();
  try {
    const engine = requireEngine();
    const opened = await engine.openBytes(bytes);
    try {
      return await fn(engine, opened);
    } finally {
      await engine.close().catch(() => undefined);
    }
  } finally {
    release();
  }
}

/**
 * Open a document by streaming chunks (e.g. chunked disk reads), run `fn`,
 * then close — serialized against other document sessions. The file is never
 * held whole in the JS heap (M6, PRD §6.1 ≥200 MB support).
 */
export async function withEngineDocumentStreamed<T>(
  byteLength: number,
  readChunk: (index: number) => Promise<Uint8Array>,
  fn: (engine: PdfEngine, opened: OpenResult) => Promise<T>,
): Promise<T> {
  const release = await acquire();
  try {
    const engine = requireEngine();
    const opened = await engine.openStreamed(byteLength, readChunk);
    try {
      return await fn(engine, opened);
    } finally {
      await engine.close().catch(() => undefined);
    }
  } finally {
    release();
  }
}

/** Read a file URI fully into memory as bytes (legacy FS API, SDK 58). */
export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const FS = await import('expo-file-system/legacy');
  const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
  return base64ToBytes(b64);
}
