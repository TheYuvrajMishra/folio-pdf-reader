/**
 * Engine protocol — typed messages between RN and the headless pdf.js
 * WebView (PRD §7.2/§7.3). The WebView is a pure rasterize + text-line
 * engine; everything the user sees is drawn natively in Skia.
 *
 * Byte transfer (spike S1 decides per device):
 *  (a) file:// URI with allowFileAccess — pdf.js fetches it directly;
 *  (b) chunked base64 (512 KiB chunks) reassembled into a Uint8Array.
 * Never base64 the whole file in one message (PRD §7.3).
 */
import type { NormRect } from '../util/geometry';

export const CHUNK_SIZE = 512 * 1024;

/** Normalized text line from getTextContent (PRD §7.4). */
export interface TextLine {
  idx: number;
  text: string;
  box: NormRect;
  /** 'margin' when inside the top/bottom 6% (headers/footers/page numbers). */
  kind: 'body' | 'margin';
  words: { text: string; box: NormRect }[];
}

export interface PageRender {
  page: number; // 1-based
  scale: number;
  width: number;
  height: number;
  /** WebP/JPEG bytes, base64 (chunked on the way back for large pages). */
  dataBase64: string;
  format: 'webp' | 'jpeg';
}

export interface OutlineNode {
  title: string;
  page: number; // 1-based, -1 if unresolvable
  children: OutlineNode[];
}

export type EngineSource =
  | { kind: 'fileUri'; uri: string }
  | { kind: 'bytes'; totalChunks: number };

/** RN → WebView */
export type EngineRequest =
  | { id: string; type: 'open'; source: EngineSource; password?: string }
  | { id: string; type: 'openChunk'; chunkIndex: number; totalChunks: number; base64: string }
  | { id: string; type: 'renderPage'; page: number; scale: number }
  | { id: string; type: 'getLines'; page: number }
  | { id: string; type: 'getOutline' }
  | { id: string; type: 'getPageCount' }
  | { id: string; type: 'close' };

/** WebView → RN */
export type EngineWireResponse =
  | { id: string; type: 'ready' }
  | { id: string; type: 'closed'; ok: true }
  | { id: string; type: 'renderResultChunk' | 'linesResultChunk'; chunkIndex: number; totalChunks: number; chunk: string }
  | { id: string; type: 'openAck'; ok: true };
export type EngineResponse = EngineWireResponse
  | { id: string; type: 'openResult'; ok: true; pageCount: number; title?: string; author?: string }
  | { id: string; type: 'openResult'; ok: false; error: 'password' | 'corrupt' | 'unsupported'; message: string }
  | { id: string; type: 'renderResult'; page: number; ok: true; render: PageRender }
  | { id: string; type: 'renderResult'; page: number; ok: false; message: string }
  | { id: string; type: 'linesResult'; page: number; ok: true; lines: TextLine[] }
  | { id: string; type: 'linesResult'; page: number; ok: false; message: string }
  | { id: string; type: 'outlineResult'; ok: true; outline: OutlineNode[] }
  | { id: string; type: 'pageCountResult'; ok: true; pageCount: number }
  | { id: string; type: 'error'; message: string };

export type RequestType = EngineRequest['type'];

/** Narrow a response to its success/failure variant for a request id. */
export function isOkResponse(r: EngineResponse): boolean {
  return (r as { ok?: boolean }).ok === true;
}
