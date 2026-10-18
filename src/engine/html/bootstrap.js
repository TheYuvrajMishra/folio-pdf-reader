/**
 * pdf.js headless engine bootstrap — runs INSIDE the WebView.
 * Inlined together with pdfjs-dist by scripts/bundle-pdfjs.mjs into a
 * single offline HTML file. Implements the RN↔WebView protocol from
 * src/engine/protocol.ts. Plain ES2019, no modules, no network.
 *
 * Expects a global `pdfjsLib` (inlined before this script).
 */
(function () {
  'use strict';

  var pdfDoc = null;
  var upload = null; // { chunks: string[], total: number, received: number, password: string|undefined }
  var renderCanvas = null;

  function post(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function fail(id, type, message) {
    post({ id: id, type: type, ok: false, message: String(message) });
  }

  /** Send a large JSON payload back in 256 KiB string chunks. */
  function sendChunked(id, type, payload) {
    var s = JSON.stringify(payload);
    var CH = 256 * 1024;
    var n = Math.max(1, Math.ceil(s.length / CH));
    for (var i = 0; i < n; i++) {
      post({
        id: id,
        type: type,
        chunkIndex: i,
        totalChunks: n,
        chunk: s.slice(i * CH, (i + 1) * CH),
      });
    }
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function openWithData(data, password, id) {
    var params = { data: data, useSystemFonts: true };
    if (password) params.password = password;
    pdfjsLib
      .getDocument(params)
      .promise.then(function (doc) {
        pdfDoc = doc;
        return doc.getMetadata().then(function (meta) {
          var info = (meta && meta.info) || {};
          post({
            id: id,
            type: 'openResult',
            ok: true,
            pageCount: doc.numPages,
            title: info.Title || undefined,
            author: info.Author || undefined,
          });
        });
      })
      .catch(function (err) {
        var name = err && err.name;
        if (name === 'PasswordException') {
          post({
            id: id,
            type: 'openResult',
            ok: false,
            error: 'password',
            message: 'This book is locked.',
          });
        } else {
          post({
            id: id,
            type: 'openResult',
            ok: false,
            error: 'corrupt',
            message: "That file didn't open. It may be damaged.",
          });
        }
      });
  }

  function ensureCanvas(w, h) {
    if (!renderCanvas) renderCanvas = document.createElement('canvas');
    renderCanvas.width = Math.max(1, Math.floor(w));
    renderCanvas.height = Math.max(1, Math.floor(h));
    return renderCanvas;
  }

  function handleRenderPage(m) {
    var id = m.id;
    if (!pdfDoc) return fail(id, 'renderResult', 'No document open');
    pdfDoc
      .getPage(m.page)
      .then(function (page) {
        var viewport = page.getViewport({ scale: m.scale });
        var canvas = ensureCanvas(viewport.width, viewport.height);
        var ctx = canvas.getContext('2d', { alpha: false });
        return page
          .render({ canvasContext: ctx, viewport: viewport })
          .promise.then(function () {
            var url = null;
            var format = 'jpeg';
            try {
              url = canvas.toDataURL('image/webp', 0.85);
              if (url.indexOf('data:image/webp') === 0) format = 'webp';
              else throw new Error('no webp');
            } catch (_e) {
              url = canvas.toDataURL('image/jpeg', 0.85);
              format = 'jpeg';
            }
            var b64 = url.slice(url.indexOf(',') + 1);
            sendChunked(id, 'renderResultChunk', {
              id: id,
              type: 'renderResult',
              page: m.page,
              ok: true,
              render: {
                page: m.page,
                scale: m.scale,
                width: canvas.width,
                height: canvas.height,
                dataBase64: b64,
                format: format,
              },
            });
          });
      })
      .catch(function (err) {
        fail(id, 'renderResult', err && err.message);
      });
  }

  /** PRD §7.4 — text items → normalized, clustered lines (see lines.js). */
  function extractLines(page, viewport) {
    return page.getTextContent().then(function (tc) {
      return clusterTextItems(tc.items, viewport);
    });
  }

  function handleGetLines(m) {
    var id = m.id;
    if (!pdfDoc) return fail(id, 'linesResult', 'No document open');
    pdfDoc
      .getPage(m.page)
      .then(function (page) {
        // Cluster in UNROTATED space (reading order is top→bottom there),
        // then rotate boxes onto the displayed page. The raster path renders
        // with rotation applied, so overlays must match the display frame.
        var rotation = page.rotate || 0;
        var viewport = page.getViewport({ scale: 1, rotation: 0 });
        return extractLines(page, viewport).then(function (lines) {
          if (rotation) {
            lines.forEach(function (ln) {
              ln.box = rotateBox(ln.box, rotation);
              ln.words.forEach(function (w) { w.box = rotateBox(w.box, rotation); });
            });
          }
          return lines;
        });
      })
      .then(function (lines) {
        sendChunked(id, 'linesResultChunk', {
          id: id, type: 'linesResult', page: m.page, ok: true, lines: lines,
        });
      })
      .catch(function (err) {
        fail(id, 'linesResult', err && err.message);
      });
  }

  function handleGetOutline(m) {
    var id = m.id;
    if (!pdfDoc) return fail(id, 'outlineResult', 'No document open');
    pdfDoc
      .getOutline()
      .then(function (outline) {
        function walk(nodes) {
          return (nodes || []).map(function (n) {
            return { title: n.title, page: -1, children: walk(n.items) };
          });
        }
        // Resolve dest → page numbers lazily is M5 work; structure now.
        post({ id: id, type: 'outlineResult', ok: true, outline: walk(outline) });
      })
      .catch(function () {
        post({ id: id, type: 'outlineResult', ok: true, outline: [] });
      });
  }

  function onMessage(data) {
    var m;
    try {
      m = JSON.parse(data);
    } catch (_e) {
      return;
    }
    var id = m.id;
    try {
      switch (m.type) {
        case 'open': {
          if (m.source.kind === 'fileUri') {
            // Strategy (a): let pdf.js fetch the file:// URL directly.
            pdfjsLib
              .getDocument({ url: m.source.uri, useSystemFonts: true, password: m.password || '' })
              .promise.then(function (doc) {
                pdfDoc = doc;
                return doc.getMetadata().then(function (meta) {
                  var info = (meta && meta.info) || {};
                  post({ id: id, type: 'openResult', ok: true, pageCount: doc.numPages,
                    title: info.Title || undefined, author: info.Author || undefined });
                });
              })
              .catch(function () {
                // Strategy (a) failed → ask RN to fall back to chunked bytes.
                post({ id: id, type: 'openResult', ok: false, error: 'fileUriFailed',
                  message: 'file-uri open failed, use chunked bytes' });
              });
          } else {
            upload = { chunks: [], total: m.source.totalChunks, received: 0, password: m.password };
            post({ id: id, type: 'openAck', ok: true });
          }
          break;
        }
        case 'openChunk': {
          if (!upload) return;
          upload.chunks[m.chunkIndex] = m.base64;
          upload.received++;
          if (upload.received >= upload.total) {
            var bytes = b64ToBytes(upload.chunks.join(''));
            var pw = upload.password;
            upload = null;
            openWithData(bytes, pw, id);
          }
          break;
        }
        case 'renderPage':
          handleRenderPage(m);
          break;
        case 'getLines':
          handleGetLines(m);
          break;
        case 'getOutline':
          handleGetOutline(m);
          break;
        case 'getPageCount':
          post({ id: id, type: 'pageCountResult', ok: true, pageCount: pdfDoc ? pdfDoc.numPages : 0 });
          break;
        case 'close':
          if (pdfDoc) { try { pdfDoc.destroy(); } catch (_e) {} pdfDoc = null; }
          post({ id: id, type: 'closed', ok: true });
          break;
        default:
          break;
      }
    } catch (err) {
      fail(id, 'error', err && err.message);
    }
  }

  // Single message target: window. (RN dispatches exactly one MessageEvent
  // on window per request; listening on both window and document would
  // double-handle every message — e.g. two concurrent renders on one canvas.)
  window.addEventListener('message', function (e) { onMessage(e.data); });
  // Signal readiness to the RN host.
  post({ id: '__ready', type: 'ready' });
})();
