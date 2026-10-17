/**
 * Typed message protocol between React Native (PdfEngine) and the headless
 * WebView pdf.js engine.
 *
 * Wire format (both directions): JSON.stringify(message).
 *   RN -> WebView : WebView ref postMessage(string) -> page 'message' event.
 *   WebView -> RN : window.ReactNativeWebView.postMessage(string) -> onMessage.
 *
 * Every request carries an `id`; every response echoes it. Unsolicited
 * engine->RN traffic uses the `event` kind. Large payloads (PDF bytes in,
 * raster bytes out) are chunked — never one giant message (see CHUNK_BYTES in
 * PdfEngine and the matching constant in bootstrap.ts).
 */

export type ImageFormat = 'webp' | 'jpeg';

/** 512 KiB per PRD §7.3: chunked base64 transfer. */
export const PROTOCOL_CHUNK_BYTES = 512 * 1024;

export type RequestId = string;

// ---------------------------------------------------------------------------
// RN -> engine requests
// ---------------------------------------------------------------------------

export interface OpenBeginRequest {
  id: RequestId;
  kind: 'open-begin';
  /** Correlates the chunk sequence that follows. */
  transferId: string;
  byteLength: number;
  chunkCount: number;
}

export interface OpenChunkRequest {
  id: RequestId;
  kind: 'open-chunk';
  transferId: string;
  index: number;
  /** base64 of this chunk (raw PDF bytes). */
  base64: string;
}

export interface OpenEndRequest {
  id: RequestId;
  kind: 'open-end';
  transferId: string;
  password?: string;
}

/** Large-file path (PRD §7.3a): let pdf.js fetch from a file:// URL itself. */
export interface OpenUrlRequest {
  id: RequestId;
  kind: 'open-url';
  url: string;
  password?: string;
}

export interface RenderPageRequest {
  id: RequestId;
  kind: 'render-page';
  pageNumber: number; // 1-based
  scale: number;
  format: ImageFormat;
  quality: number; // 0..1
}

export interface GetLinesRequest {
  id: RequestId;
  kind: 'get-lines';
  pageNumber: number; // 1-based
}

export interface GetOutlineRequest {
  id: RequestId;
  kind: 'get-outline';
}

export interface CloseRequest {
  id: RequestId;
  kind: 'close';
}

export interface PingRequest {
  id: RequestId;
  kind: 'ping';
}

export type EngineRequest =
  | OpenBeginRequest
  | OpenChunkRequest
  | OpenEndRequest
  | OpenUrlRequest
  | RenderPageRequest
  | GetLinesRequest
  | GetOutlineRequest
  | CloseRequest
  | PingRequest;

// ---------------------------------------------------------------------------
// Engine -> RN payloads
// ---------------------------------------------------------------------------

/** One text item from getTextContent(). Carries both the raw pdf.js fields
 *  (for the RN-side line clustering in lines.ts) and the precomputed
 *  normalized 0..1 box (top-left origin) for direct overlay use. */
export interface EngineTextItem {
  str: string;
  /** Raw pdf.js item transform [a,b,c,d,e,f]; e,f = origin in PDF user space. */
  transform: [number, number, number, number, number, number];
  /** Raw width/height in PDF user-space units. */
  width: number;
  height: number;
  /** Normalized box (0..1, top-left origin), rotation/crop handled. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  hasEOL: boolean;
}

export interface PageLinesResult {
  pageNumber: number;
  /** Page size in PDF points (unscaled). */
  widthPt: number;
  heightPt: number;
  rotation: number;
  items: EngineTextItem[];
}

export interface OpenResult {
  numPages: number;
  fingerprint: string;
  title: string | null;
  author: string | null;
}

export interface RenderPageResult {
  pageNumber: number;
  scale: number;
  widthPx: number;
  heightPx: number;
  format: ImageFormat;
  byteLength: number;
  /** base64 chunks of the encoded image, in order. */
  chunks: string[];
}

export interface OutlineNode {
  title: string;
  /** Raw destination (may be null); RN resolves it against the document. */
  destJson: string | null;
  children: OutlineNode[];
}

export interface EngineError {
  code: string;
  message: string;
}

export interface EngineResponse {
  id: RequestId;
  kind: 'response';
  ok: true;
  payload: OpenResult | RenderPageResult | PageLinesResult | OutlineNode[] | null;
}

export interface EngineErrorResponse {
  id: RequestId;
  kind: 'response';
  ok: false;
  error: EngineError;
}

/** Unsolicited engine -> RN events (engine boot, transfer progress). */
export interface EngineEvent {
  kind: 'event';
  event: 'ready' | 'open-progress';
  /** 0..1 for open-progress. */
  progress?: number;
}

export type EngineInbound = EngineResponse | EngineErrorResponse | EngineEvent;

// ---------------------------------------------------------------------------
// Guards (narrow unknown across the bridge boundary)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isRequestId(v: unknown): v is RequestId {
  return typeof v === 'string' && v.length > 0;
}

const REQUEST_KINDS: ReadonlySet<string> = new Set([
  'open-begin',
  'open-chunk',
  'open-end',
  'open-url',
  'render-page',
  'get-lines',
  'get-outline',
  'close',
  'ping',
]);

/** Validate an inbound RN->engine message inside the WebView (plain JS there). */
export function isEngineRequest(v: unknown): v is EngineRequest {
  return isRecord(v) && isRequestId(v['id']) && typeof v['kind'] === 'string' && REQUEST_KINDS.has(v['kind']);
}

export function isEngineInbound(v: unknown): v is EngineInbound {
  if (!isRecord(v)) return false;
  if (v['kind'] === 'event') {
    return v['event'] === 'ready' || v['event'] === 'open-progress';
  }
  return v['kind'] === 'response' && isRequestId(v['id']) && typeof v['ok'] === 'boolean';
}

export function isEngineErrorResponse(v: EngineInbound): v is EngineErrorResponse {
  return v.kind === 'response' && !v.ok;
}

/** Parse a raw bridge string into a typed inbound message, or null. */
export function parseEngineMessage(raw: string): EngineInbound | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isEngineInbound(parsed) ? parsed : null;
}
