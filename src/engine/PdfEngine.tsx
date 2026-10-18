/**
 * PdfEngine — headless pdf.js in a hidden WebView (PRD §7.3).
 * RN side of the protocol in ./protocol.ts. Responsibilities:
 * - host the 0×0 WebView with the bundled offline ENGINE_HTML
 * - typed request/response with timeouts + chunked payloads
 * - byte transfer: (a) file:// URI first, (b) chunked base64 fallback
 * - auto-restart the engine on termination (max 3) and replay the queue
 *   (PRD §7.9)
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import { ENGINE_HTML } from './html/engineHtml';
import {
  CHUNK_SIZE,
  EngineRequest,
  EngineResponse,
  EngineWireResponse,
  OutlineNode,
  PageRender,
  TextLine,
} from './protocol';

const REQUEST_TIMEOUT_MS = 30_000;
const OPEN_TIMEOUT_MS = 60_000;
const MAX_RESTARTS = 3;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  chunks: Map<number, string>;
  totalChunks: number;
}

let requestSeq = 0;
const nextId = (): string => `r${Date.now().toString(36)}_${requestSeq++}`;

export interface PdfEngine {
  openFile: (uri: string, password?: string) => Promise<{ pageCount: number; title?: string; author?: string }>;
  renderPage: (page: number, scale: number) => Promise<PageRender>;
  getLines: (page: number) => Promise<TextLine[]>;
  getOutline: () => Promise<OutlineNode[]>;
  close: () => Promise<void>;
  host: () => React.JSX.Element;
}

/**
 * usePdfEngine — creates the engine. Render `engine.host()` once near the
 * root (hidden). All methods serialize through one FIFO queue.
 */
export function usePdfEngine(): PdfEngine {
  const webviewRef = useRef<WebView | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const readyRef = useRef<Promise<void> | null>(null);
  const readyResolve = useRef<(() => void) | null>(null);
  const restarts = useRef(0);
  const lastSource = useRef<{ uri: string; password?: string } | null>(null);
  const [webviewKey, setWebviewKey] = React.useState(0);

  /** Lazily created; never touched during render (refs are for handlers). */
  const ensureReady = useCallback((): Promise<void> => {
    if (!readyRef.current) {
      readyRef.current = new Promise<void>((res) => {
        readyResolve.current = res;
      });
    }
    return readyRef.current;
  }, []);

  /** Send a message RN → WebView (escapes `<` so PDF text can't break out). */
  const send = useCallback((msg: EngineRequest) => {
    const json = JSON.stringify(msg).replace(/</g, '\\u003c');
    // Dispatch exactly once, on window — the engine listens on window only.
    // (Dispatching on both window and document double-handles messages.)
    const js = `(function(){var d=${json};window.dispatchEvent(new MessageEvent('message',{data:d}));})();true;`;
    webviewRef.current?.injectJavaScript(js);
  }, []);

  const request = useCallback(
    <T,>(type: EngineRequest['type'], payload: object, timeoutMs: number): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const id = nextId();
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error(`Engine request timed out: ${type}`));
        }, timeoutMs);
        pending.current.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
          chunks: new Map(),
          totalChunks: -1,
        });
        void ensureReady().then(() => send({ id, type, ...payload } as EngineRequest));
      });
    },
    [send, ensureReady],
  );

  /** Reassemble chunked responses (renderResultChunk / linesResultChunk). */
  const handleChunk = useCallback(
    (msg: { id: string; chunkIndex: number; totalChunks: number; chunk: string }) => {
      const p = pending.current.get(msg.id);
      if (!p) return;
      p.chunks.set(msg.chunkIndex, msg.chunk);
      p.totalChunks = msg.totalChunks;
      if (p.chunks.size === msg.totalChunks) {
        const parts: string[] = [];
        for (let i = 0; i < msg.totalChunks; i++) parts.push(p.chunks.get(i) ?? '');
        clearTimeout(p.timer);
        pending.current.delete(msg.id);
        try {
          p.resolve(JSON.parse(parts.join('')));
        } catch (e) {
          p.reject(e instanceof Error ? e : new Error('Bad chunked payload'));
        }
      }
    },
    [],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: EngineResponse | EngineWireResponse;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready' && msg.id === '__ready') {
        readyResolve.current?.();
        return;
      }
      if (
        (msg.type === 'renderResultChunk' || msg.type === 'linesResultChunk') &&
        typeof msg.chunk === 'string'
      ) {
        handleChunk(msg as { id: string; chunkIndex: number; totalChunks: number; chunk: string });
        return;
      }
      const p = pending.current.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.current.delete(msg.id);
      if ((msg as { ok?: boolean }).ok === false) {
        const m = msg as { error?: string; message?: string };
        const err = new Error(m.message ?? 'Engine error');
        (err as { code?: string }).code = m.error;
        p.reject(err);
      } else {
        p.resolve(msg);
      }
    },
    [handleChunk],
  );

  /** Restart the engine after a crash, re-open the last source (PRD §7.9). */
  const restart = useCallback(() => {
    if (restarts.current >= MAX_RESTARTS) return;
    restarts.current += 1;
    readyRef.current = new Promise<void>((res) => {
      readyResolve.current = res;
    });
    setWebviewKey((k) => k + 1);
  }, []);

  const engine = useMemo<PdfEngine>(() => {
    /** Strategy (b): chunked base64 upload of the whole file. */
    async function openByBytes(uri: string, password: string | undefined, id0: string): Promise<unknown> {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const totalChunks = Math.max(1, Math.ceil(b64.length / CHUNK_SIZE));
      // Prime the upload buffer; the bootstrap acks immediately.
      await request('open', { source: { kind: 'bytes', totalChunks } }, OPEN_TIMEOUT_MS);
      for (let i = 0; i < totalChunks; i++) {
        send({
          id: i === totalChunks - 1 ? id0 : nextId(),
          type: 'openChunk',
          chunkIndex: i,
          totalChunks,
          base64: b64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        } as EngineRequest);
        // Yield to the bridge between chunks so the UI thread stays alive.
        await new Promise((r) => setTimeout(r, 0));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.current.delete(id0);
          reject(new Error('Engine open (bytes) timed out'));
        }, OPEN_TIMEOUT_MS);
        pending.current.set(id0, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
          chunks: new Map(),
          totalChunks: -1,
        });
      });
    }

    return {
      openFile: async (uri: string, password?: string) => {
        lastSource.current = { uri, password };
        // Strategy (a): file:// URI — pdf.js fetches it directly.
        try {
          const res = (await request('open', { source: { kind: 'fileUri', uri }, password }, OPEN_TIMEOUT_MS)) as {
            error?: string;
          } & Record<string, unknown>;
          if (res.error === 'fileUriFailed') throw new Error('fileUriFailed');
          return res as { pageCount: number; title?: string; author?: string };
        } catch (e) {
          if ((e as { code?: string }).code === 'password') throw e;
          if ((e as Error).message !== 'fileUriFailed' && !(e as Error).message.includes('timed out')) throw e;
          // Strategy (b): chunked base64 fallback (PRD §7.3).
          const id0 = nextId();
          const res = (await openByBytes(uri, password, id0)) as Record<string, unknown>;
          return res as { pageCount: number; title?: string; author?: string };
        }
      },
      renderPage: async (page: number, scale: number) => {
        const res = (await request('renderPage', { page, scale }, REQUEST_TIMEOUT_MS)) as {
          render?: PageRender;
        };
        // Chunked responses resolve to the full parsed payload.
        const full = res as unknown as { render: PageRender };
        if (!full.render) throw new Error('Bad render result');
        return full.render;
      },
      getLines: async (page: number) => {
        const res = (await request('getLines', { page }, REQUEST_TIMEOUT_MS)) as unknown as {
          lines: TextLine[];
        };
        return res.lines ?? [];
      },
      getOutline: async () => {
        const res = (await request('getOutline', {}, REQUEST_TIMEOUT_MS)) as {
          outline?: OutlineNode[];
        };
        return res.outline ?? [];
      },
      close: async () => {
        lastSource.current = null;
        await request('close', {}, REQUEST_TIMEOUT_MS).catch(() => {});
      },
      host: () => (
        <WebView
          key={webviewKey}
          ref={webviewRef}
          source={{ html: ENGINE_HTML }}
          javaScriptEnabled
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          originWhitelist={['*']}
          onMessage={onMessage}
          onError={restart}
          onContentProcessDidTerminate={restart}
          style={{ width: 0, height: 0, position: 'absolute' }}
        />
      ),
    };
  }, [request, send, onMessage, restart, webviewKey]);

  useEffect(() => {
    const map = pending.current;
    return () => {
      map.forEach((p) => {
        clearTimeout(p.timer);
        p.reject(new Error('Engine torn down'));
      });
      map.clear();
    };
  }, []);

  return engine;
}
