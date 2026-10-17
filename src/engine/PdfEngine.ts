/**
 * PdfEngine — headless pdf.js engine hosted in a react-native-webview.
 *
 * The WebView is never visible: it rasterizes pages and extracts text lines,
 * and this class exposes a typed, queued request API to the rest of the app.
 *
 * M0 status: skeleton. The protocol, HTML bootstrap, chunking, job queue and
 * timeout handling are real; it typechecks. M1 wires it to a real WebView
 * (render the props from getWebViewProps(), attach the ref) and exercises
 * open/render/get-lines against a device.
 *
 * Transfer (spike S1 decision, see docs/spikes/S1.md): chunked base64,
 * PROTOCOL_CHUNK_BYTES per message, into a preallocated Uint8Array inside the
 * WebView. Never one giant message. Files > 64 MiB use the file:// URL path
 * (open-url) instead.
 */
import type { WebViewMessageEvent, WebViewProps } from 'react-native-webview';
import { base64Encode } from './base64';
import { buildEngineHtml } from './html/bootstrap.generated';
import {
  PROTOCOL_CHUNK_BYTES,
  isEngineErrorResponse,
  parseEngineMessage,
  type EngineError,
  type EngineInbound,
  type EngineRequest,
  type GetLinesRequest,
  type GetRowProfileRequest,
  type ImageFormat,
  type OpenBeginRequest,
  type OpenChunkRequest,
  type OpenEndRequest,
  type OpenResult,
  type OpenUrlRequest,
  type OutlineNode,
  type PageLinesResult,
  type RenderPageRequest,
  type RenderPageResult,
  type RequestId,
  type RowProfileResult,
} from './protocol';

/** Structural type of the react-native-webview ref handle (v14 imperative API). */
export interface EngineWebViewHandle {
  postMessage(data: string): void;
  injectJavaScript(data: string): void;
  reload(): void;
  stopLoading(): void;
}

/** Payload type per request kind. */
export interface EnginePayloads {
  'open-begin': null;
  'open-chunk': null;
  'open-end': OpenResult;
  'open-url': OpenResult;
  'render-page': RenderPageResult;
  'get-lines': PageLinesResult;
  'get-row-profile': RowProfileResult;
  'get-outline': OutlineNode[];
  'close': null;
  'ping': null;
}

export type EngineRequestKind = keyof EnginePayloads;

interface PendingEntry {
  resolve: (payload: unknown) => void;
  reject: (err: EngineError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface PdfEngineOptions {
  /** Per-request timeout ms. */
  requestTimeoutMs?: number;
  /** Called when the WebView render process dies (PRD §7.9: restart, max 3). */
  onCrash?: (crashCount: number) => void;
  /** Transfer chunk size; defaults to PROTOCOL_CHUNK_BYTES (512 KiB). */
  chunkBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
/** Above this size the chunked path is skipped in favour of open-url (file://). */
export const CHUNKED_TRANSFER_LIMIT_BYTES = 64 * 1024 * 1024;

let requestCounter = 0;
function nextId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${requestCounter.toString(36)}-${Math.floor(
    Math.random() * 0xffff,
  ).toString(36)}`;
}

export class PdfEngine {
  private webview: EngineWebViewHandle | null = null;
  private readonly html: string;
  private readonly pending = new Map<RequestId, PendingEntry>();
  /** Serializes requests: one in flight at a time. */
  private queue: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private resolveReady: () => void = () => undefined;
  private crashCount = 0;
  private readonly opts: Required<Pick<PdfEngineOptions, 'requestTimeoutMs' | 'chunkBytes'>> &
    Pick<PdfEngineOptions, 'onCrash'>;

  constructor(options: PdfEngineOptions = {}) {
    this.html = buildEngineHtml();
    this.opts = {
      requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      chunkBytes: options.chunkBytes ?? PROTOCOL_CHUNK_BYTES,
      onCrash: options.onCrash,
    };
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  // ------------------------------------------------------------------ wiring

  /** Call with the WebView ref (e.g. from ref={engine.attachWebView}). */
  attachWebView = (handle: EngineWebViewHandle | null): void => {
    this.webview = handle;
    if (handle) this.armReady();
  };

  private armReady(): void {
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /**
   * Props for the headless WebView. Render exactly one:
   *   <WebView ref={engine.attachWebView} {...engine.getWebViewProps()} />
   * Hardened: no file access (chunked path needs none), no cache, invisible.
   */
  getWebViewProps(): WebViewProps {
    return {
      source: { html: this.html },
      originWhitelist: ['about:blank'],
      javaScriptEnabled: true,
      domStorageEnabled: false,
      cacheEnabled: false,
      allowFileAccess: false,
      allowFileAccessFromFileURLs: false,
      allowUniversalAccessFromFileURLs: false,
      mixedContentMode: 'never',
      scrollEnabled: false,
      showsHorizontalScrollIndicator: false,
      showsVerticalScrollIndicator: false,
      onMessage: this.handleWebViewMessage,
      onRenderProcessGone: this.handleRenderProcessGone,
      style: { width: 0, height: 0, opacity: 0 },
    };
  }

  // ------------------------------------------------------- inbound handling

  private handleWebViewMessage = (event: WebViewMessageEvent): void => {
    const inbound: EngineInbound | null = parseEngineMessage(event.nativeEvent.data);
    if (!inbound) return;
    if (inbound.kind === 'event') {
      if (inbound.event === 'ready') this.resolveReady();
      return;
    }
    const entry = this.pending.get(inbound.id);
    if (!entry) return;
    this.pending.delete(inbound.id);
    clearTimeout(entry.timer);
    if (isEngineErrorResponse(inbound)) {
      entry.reject(inbound.error);
    } else {
      entry.resolve(inbound.payload);
    }
  };

  private handleRenderProcessGone = (): boolean => {
    // PRD §7.9: auto-restart the engine, re-open, retry (max 3). M1 implements
    // the re-open; here we count and notify so the app can decide.
    this.crashCount += 1;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject({ code: 'engine-crashed', message: 'WebView render process died' });
    }
    this.pending.clear();
    this.opts.onCrash?.(this.crashCount);
    return true;
  };

  // ------------------------------------------------------------- job queue

  private enqueue<K extends EngineRequestKind>(
    request: Extract<EngineRequest, { kind: K }>,
  ): Promise<EnginePayloads[K]> {
    // Chain onto the queue so only one request is in flight at a time; the
    // queue itself never rejects (a failed request must not wedge later ones).
    const result = this.queue.then(() => this.sendOnce(request));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private sendOnce<K extends EngineRequestKind>(
    request: Extract<EngineRequest, { kind: K }>,
  ): Promise<EnginePayloads[K]> {
    return (async (): Promise<EnginePayloads[K]> => {
      await this.readyPromise;
      const handle = this.webview;
      if (!handle) throw new Error('[folio-engine] WebView not attached');
      return new Promise<EnginePayloads[K]>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(request.id);
          reject(new Error(`[folio-engine] request timed out: ${request.kind} ${request.id}`));
        }, this.opts.requestTimeoutMs);
        const entry: PendingEntry = {
          resolve: (payload: unknown) => resolve(payload as EnginePayloads[K]),
          reject: (err: EngineError) => reject(new Error(`[folio-engine] ${err.code}: ${err.message}`)),
          timer,
        };
        this.pending.set(request.id, entry);
        handle.postMessage(JSON.stringify(request));
      });
    })();
  }

  // ------------------------------------------------------------------- API

  /** Liveness check. */
  ping(): Promise<null> {
    return this.enqueue({ id: nextId('ping'), kind: 'ping' });
  }

  /**
   * Open a PDF from in-memory bytes via the chunked base64 path.
   * Prefer openStreamed() on device (streams from disk, less JS heap).
   */
  async openBytes(bytes: Uint8Array, password?: string): Promise<OpenResult> {
    const chunkBytes = this.opts.chunkBytes;
    return this.openStreamed(
      bytes.length,
      async (index) => bytes.subarray(index * chunkBytes, Math.min(bytes.length, (index + 1) * chunkBytes)),
      password,
    );
  }

  /**
   * Open a PDF by streaming chunks from the caller (e.g. chunked disk reads).
   * The JS heap never holds the whole file: each chunk is base64-encoded and
   * sent as its own message (PRD §7.3 — never one giant message).
   */
  async openStreamed(
    byteLength: number,
    readChunk: (index: number) => Promise<Uint8Array>,
    password?: string,
  ): Promise<OpenResult> {
    const transferId = nextId('xfer');
    const chunkBytes = this.opts.chunkBytes;
    const chunkCount = Math.max(1, Math.ceil(byteLength / chunkBytes));
    const begin: OpenBeginRequest = {
      id: nextId('open'),
      kind: 'open-begin',
      transferId,
      byteLength,
      chunkCount,
    };
    await this.enqueue(begin);
    for (let i = 0; i < chunkCount; i += 1) {
      const slice = await readChunk(i);
      const chunk: OpenChunkRequest = {
        id: nextId('chunk'),
        kind: 'open-chunk',
        transferId,
        index: i,
        base64: base64Encode(slice),
      };
      await this.enqueue(chunk);
    }
    const end: OpenEndRequest = {
      id: nextId('open'),
      kind: 'open-end',
      transferId,
      ...(password ? { password } : {}),
    };
    return this.enqueue(end);
  }

  /**
   * Open a PDF already on disk via a file:// URL (large-file path, PRD §7.3a).
   * Requires the WebView to be created with file access enabled — see
   * docs/spikes/S1.md; the default getWebViewProps() keeps it OFF.
   */
  openUrl(url: string, password?: string): Promise<OpenResult> {
    const req: OpenUrlRequest = {
      id: nextId('open'),
      kind: 'open-url',
      url,
      ...(password ? { password } : {}),
    };
    return this.enqueue(req);
  }

  renderPage(
    pageNumber: number,
    scale: number,
    format: ImageFormat = 'webp',
    quality = 0.85,
  ): Promise<RenderPageResult> {
    const req: RenderPageRequest = {
      id: nextId('render'),
      kind: 'render-page',
      pageNumber,
      scale,
      format,
      quality,
    };
    return this.enqueue(req);
  }

  getLines(pageNumber: number): Promise<PageLinesResult> {
    const req: GetLinesRequest = { id: nextId('lines'), kind: 'get-lines', pageNumber };
    return this.enqueue(req);
  }

  /**
   * Pixel-mode row profile (PRD §6.5): per-row darkness sums of the page
   * rendered at thumbScale (default 0.25). Used by the reading ruler on
   * image-only pages; see ruler/pixelMode.ts rowProfileToRows.
   */
  getRowProfile(pageNumber: number, thumbScale = 0.25): Promise<RowProfileResult> {
    const req: GetRowProfileRequest = {
      id: nextId('rowprofile'),
      kind: 'get-row-profile',
      pageNumber,
      thumbScale,
    };
    return this.enqueue(req);
  }

  getOutline(): Promise<OutlineNode[]> {
    return this.enqueue({ id: nextId('outline'), kind: 'get-outline' });
  }

  close(): Promise<null> {
    return this.enqueue({ id: nextId('close'), kind: 'close' });
  }
}
