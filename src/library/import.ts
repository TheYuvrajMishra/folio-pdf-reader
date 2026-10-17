/**
 * import.ts — PDF import pipeline (PRD §6.1).
 *
 * Flow: pick (or receive) a PDF → copy into app-private
 * `documentDirectory/books/<uuid>.pdf` (the original URI is never depended
 * on afterwards) → SHA-256 of (first 1 MiB + file size) for duplicate
 * detection (an existing book is returned + touched instead of imported
 * twice) → insert the book row → kick off the background indexer
 * (non-blocking; see ./indexer.ts).
 *
 * Uses the expo-file-system legacy subpath (`expo-file-system/legacy`): the
 * main entry's legacy functions throw at runtime on SDK 58.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FS from 'expo-file-system/legacy';

import { getBook, getBookByHash, insertBook, touchBook, type Book } from '../data/books';
import { base64ToBytes } from './base64';
import { HASH_HEAD_BYTES, hashPdfHead } from './hashInput';
import { startBackgroundIndex } from './indexer';
import { uuidv4 } from './uuid';

const BOOKS_DIR_NAME = 'books';

function documentBase(): string {
  const base = FS.documentDirectory;
  if (!base) {
    throw new Error('[folio] import: no document directory on this platform');
  }
  return base;
}

async function ensureBooksDir(): Promise<string> {
  const dir = `${documentBase()}${BOOKS_DIR_NAME}/`;
  const info = await FS.getInfoAsync(dir);
  if (!info.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

function titleFromName(name: string | undefined, fallbackUri: string): string {
  const raw = (name ?? fallbackUri.split('/').pop() ?? '').split('?')[0];
  const stem = raw.replace(/\.pdf$/i, '').trim();
  return stem.length > 0 ? stem : 'Untitled';
}

/**
 * Import a PDF from any readable URI (file://, content://, cache copy).
 * Returns the existing book (touched) when the duplicate hash matches.
 * Never throws for a user-cancelled pick — that path returns null from
 * importPdfFromPicker instead.
 */
export async function importPdfFromUri(sourceUri: string, name?: string): Promise<Book> {
  const id = uuidv4();
  const booksDir = await ensureBooksDir();
  const destUri = `${booksDir}${id}.pdf`;

  // Size + head hash BEFORE copying, read straight off the source URI.
  const info = await FS.getInfoAsync(sourceUri);
  const size =
    info.exists && typeof info.size === 'number' && info.size >= 0 ? info.size : 0;
  const headLength = size > 0 ? Math.min(size, HASH_HEAD_BYTES) : HASH_HEAD_BYTES;
  const headB64 = await FS.readAsStringAsync(sourceUri, {
    encoding: FS.EncodingType.Base64,
    position: 0,
    length: headLength,
  });
  const hash = hashPdfHead(base64ToBytes(headB64), size);

  const existing = await getBookByHash(hash);
  if (existing) {
    await touchBook(existing.id);
    const refreshed = await getBook(existing.id);
    return refreshed ?? existing;
  }

  // PRD §6.1: never depend on the original URI — copy into app storage.
  await FS.copyAsync({ from: sourceUri, to: destUri });

  const now = Date.now();
  await insertBook({
    id,
    title: titleFromName(name, sourceUri),
    filePath: destUri,
    sizeBytes: size > 0 ? size : null,
    hash,
    addedAt: now,
    lastOpenedAt: now,
  });

  const book = await getBook(id);
  if (!book) {
    throw new Error('[folio] import: book row missing right after insert');
  }

  // Background: page count, metadata, cover, text-line index. Fire-and-forget.
  startBackgroundIndex(id);
  return book;
}

/**
 * Import a PDF via the system document picker (type application/pdf).
 * Returns null when the user cancels.
 */
export async function importPdfFromPicker(): Promise<Book | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }
  const asset = result.assets[0];
  return importPdfFromUri(asset.uri, asset.name ?? undefined);
}
