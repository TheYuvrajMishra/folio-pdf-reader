/**
 * Headless pdf.js engine bootstrap — TEMPLATE.
 *
 * This file is the source of truth for the engine HTML. The placeholder
 * constants below are replaced at build time by scripts/bundle-pdfjs.mjs with
 * the JSON-escaped bundle contents, producing `bootstrap.generated.ts`
 * (same exports, real bundles inlined). PdfEngine imports the generated file.
 *
 * The WebView-side engine script (ENGINE_JS) is plain ES2019 JS on purpose:
 * it runs inside the generated HTML, not through the RN toolchain. It must
 * not contain backticks, '${', or a literal '</script'.
 */

export interface BuildEngineHtmlOptions {
  /** Debug tag, e.g. 'folio-engine'. Only used in the <title>. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Placeholder constants — replaced at build time. See header comment.
// ---------------------------------------------------------------------------
const PDFJS_MAIN_BUNDLE = '__FOLIO_PDFJS_MAIN_BUNDLE__';
const PDFJS_WORKER_BUNDLE = '__FOLIO_PDFJS_WORKER_BUNDLE__';

const MAIN_PLACEHOLDER = '__FOLIO_PDFJS_MAIN_BUNDLE__';
const WORKER_PLACEHOLDER = '__FOLIO_PDFJS_WORKER_BUNDLE__';

function assertInlined(): void {
  // Widen to string first: after build-time replacement the consts hold the
  // real bundles, and comparing literal types would be a TS2367 error in the
  // generated file.
  const main: string = PDFJS_MAIN_BUNDLE;
  const worker: string = PDFJS_WORKER_BUNDLE;
  if (main === MAIN_PLACEHOLDER || worker === WORKER_PLACEHOLDER) {
    throw new Error(
      '[folio-engine] pdf.js bundles are not inlined. ' +
        'Run `node scripts/bundle-pdfjs.mjs` and import bootstrap.generated instead.',
    );
  }
}

// ---------------------------------------------------------------------------
// WebView-side engine. Plain JS, no backticks / ${} / </script inside.
// ---------------------------------------------------------------------------
const ENGINE_JS = `
(function () {
  'use strict';

  var RENDER_CHUNK = 512 * 1024;

  function post(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }
  function respondOk(id, payload) {
    post({ id: id, kind: 'response', ok: true, payload: payload });
  }
  function respondError(id, code, err) {
    var message = err && err.message ? err.message : String(err);
    post({ id: id, kind: 'response', ok: false, error: { code: code, message: message } });
  }

  // Worker, fully offline: the worker source is inlined above as FOLIO_WORKER_SRC.
  // pdf.js creates new Worker(blobUrl, {type:'module'}) itself from
  // GlobalWorkerOptions.workerSrc. If that ever fails it falls back to its
  // main-thread fake worker automatically.
  try {
    var workerUrl = URL.createObjectURL(new Blob([FOLIO_WORKER_SRC], { type: 'text/javascript' }));
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch (err) {
    // leave unset -> fake worker fallback
  }

  var pdfDoc = null;
  var transfers = {};

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function chunkBase64(b64) {
    var out = [];
    for (var i = 0; i < b64.length; i += RENDER_CHUNK) out.push(b64.slice(i, i + RENDER_CHUNK));
    return out;
  }

  // Text-item rect in normalized 0..1 viewport coords.
  // NOTE: pdf.js 6.x removed viewport.convertToViewportRectangle(); the
  // equivalent is transforming the item's four corners with
  // convertToViewportPoint and taking min/max. Careful: item.width/height are
  // in PDF user-space units, while the transform axes carry the font-size
  // scale, so the direction vectors must be normalized first. This also
  // handles rotated text correctly, which the old helper did not.
  function itemRect(viewport, it) {
    var t = it.transform; // [a,b,c,d,e,f]
    var w = it.width || 0;
    var h = it.height || 0;
    var sx = Math.hypot(t[0], t[1]) || 1;
    var sy = Math.hypot(t[2], t[3]) || 1;
    var ux = t[0] / sx, uy = t[1] / sx; // text direction (unit)
    var vx = t[2] / sy, vy = t[3] / sy; // perpendicular (unit)
    var ex = t[4], ey = t[5];
    var corners = [
      [ex, ey],
      [ex + ux * w, ey + uy * w],
      [ex + vx * h, ey + vy * h],
      [ex + ux * w + vx * h, ey + uy * w + vy * h],
    ];
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < 4; i++) {
      var q = viewport.convertToViewportPoint(corners[i][0], corners[i][1]);
      if (q[0] < x0) x0 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[0] > x1) x1 = q[0];
      if (q[1] > y1) y1 = q[1];
    }
    return {
      x0: x0 / viewport.width,
      y0: y0 / viewport.height,
      x1: x1 / viewport.width,
      y1: y1 / viewport.height,
    };
  }

  function closeDocument() {
    if (pdfDoc) {
      var old = pdfDoc;
      pdfDoc = null;
      try { old.destroy(); } catch (err) { /* ignore */ }
    }
  }

  function finishOpen(req, params) {
    closeDocument();
    pdfjsLib.getDocument(params).promise.then(function (doc) {
      pdfDoc = doc;
      return doc.getMetadata().then(function (meta) {
        var info = (meta && meta.info) || {};
        respondOk(req.id, {
          numPages: doc.numPages,
          fingerprint: doc.fingerprint,
          title: info.Title || null,
          author: info.Author || null,
        });
      });
    }).catch(function (err) {
      respondError(req.id, 'open-failed', err);
    });
  }

  var handlers = {
    'open-begin': function (req) {
      transfers[req.transferId] = {
        buffer: new Uint8Array(req.byteLength),
        received: 0,
      };
      respondOk(req.id, null);
    },
    'open-chunk': function (req) {
      var t = transfers[req.transferId];
      if (!t) { respondError(req.id, 'no-transfer', 'unknown transferId'); return; }
      var bytes = b64ToBytes(req.base64);
      t.buffer.set(bytes, t.received);
      t.received += bytes.length;
      post({ kind: 'event', event: 'open-progress', progress: t.received / t.buffer.length });
      respondOk(req.id, null);
    },
    'open-end': function (req) {
      var t = transfers[req.transferId];
      if (!t) { respondError(req.id, 'no-transfer', 'unknown transferId'); return; }
      var data = t.buffer;
      delete transfers[req.transferId];
      var params = { data: data };
      if (req.password) params.password = req.password;
      finishOpen(req, params);
    },
    'open-url': function (req) {
      // Large-file path (PRD 7.3a): pdf.js fetches the file:// URL itself.
      var params = { url: req.url };
      if (req.password) params.password = req.password;
      finishOpen(req, params);
    },
    'render-page': function (req) {
      if (!pdfDoc) { respondError(req.id, 'no-document', 'no document open'); return; }
      pdfDoc.getPage(req.pageNumber).then(function (page) {
        var viewport = page.getViewport({ scale: req.scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        var ctx = canvas.getContext('2d', { alpha: false });
        return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
          var mime = req.format === 'jpeg' ? 'image/jpeg' : 'image/webp';
          var dataUrl = canvas.toDataURL(mime, req.quality);
          var b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
          canvas.width = 0;
          canvas.height = 0;
          respondOk(req.id, {
            pageNumber: req.pageNumber,
            scale: req.scale,
            widthPx: Math.floor(viewport.width),
            heightPx: Math.floor(viewport.height),
            format: req.format,
            byteLength: Math.floor((b64.length * 3) / 4),
            chunks: chunkBase64(b64),
          });
        });
      }).catch(function (err) {
        respondError(req.id, 'render-failed', err);
      });
    },
    'get-lines': function (req) {
      if (!pdfDoc) { respondError(req.id, 'no-document', 'no document open'); return; }
      pdfDoc.getPage(req.pageNumber).then(function (page) {
        var viewport = page.getViewport({ scale: 1 });
        return page.getTextContent().then(function (tc) {
          var items = [];
          for (var i = 0; i < tc.items.length; i++) {
            var it = tc.items[i];
            // PRD 7.4: item rect via viewport conversion (handles rotation /
            // crop), normalized to 0..1. See itemRect() for the 6.x-compatible
            // implementation.
            var r = itemRect(viewport, it);
            items.push({
              str: it.str,
              transform: [it.transform[0], it.transform[1], it.transform[2], it.transform[3], it.transform[4], it.transform[5]],
              width: it.width || 0,
              height: it.height || 0,
              x0: r.x0,
              y0: r.y0,
              x1: r.x1,
              y1: r.y1,
              hasEOL: !!it.hasEOL,
            });
          }
          respondOk(req.id, {
            pageNumber: req.pageNumber,
            widthPt: viewport.width,
            heightPt: viewport.height,
            rotation: viewport.rotation,
            items: items,
          });
        });
      }).catch(function (err) {
        respondError(req.id, 'lines-failed', err);
      });
    },
    'get-row-profile': function (req) {
      if (!pdfDoc) { respondError(req.id, 'no-document', 'no document open'); return; }
      // Pixel-mode fallback (PRD 6.5): render at thumbScale, compute per-row
      // darkness sums (horizontal projection profile), post the sums back.
      // No image bytes cross the bridge — just one small number array.
      var scale = req.thumbScale > 0 && req.thumbScale <= 1 ? req.thumbScale : 0.25;
      pdfDoc.getPage(req.pageNumber).then(function (page) {
        var viewport = page.getViewport({ scale: scale });
        var w = Math.max(1, Math.floor(viewport.width));
        var h = Math.max(1, Math.floor(viewport.height));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
          var data = ctx.getImageData(0, 0, w, h).data;
          var rowSums = new Array(h);
          for (var y = 0; y < h; y++) {
            var s = 0;
            var off = y * w * 4;
            for (var x = 0; x < w; x++) {
              var i = off + x * 4;
              // ITU-R BT.601 luma; darkness = 255 - luma.
              var luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              s += 255 - luma;
            }
            rowSums[y] = Math.round(s);
          }
          canvas.width = 0;
          canvas.height = 0;
          respondOk(req.id, {
            pageNumber: req.pageNumber,
            thumbScale: scale,
            widthPx: w,
            heightPx: h,
            rowSums: rowSums,
          });
        });
      }).catch(function (err) {
        respondError(req.id, 'row-profile-failed', err);
      });
    },
    'get-outline': function (req) {
      if (!pdfDoc) { respondError(req.id, 'no-document', 'no document open'); return; }
      pdfDoc.getOutline().then(function (outline) {
        function map(nodes) {
          return (nodes || []).map(function (n) {
            return {
              title: n.title,
              destJson: n.dest ? JSON.stringify(n.dest) : null,
              children: map(n.items),
            };
          });
        }
        respondOk(req.id, map(outline));
      }).catch(function (err) {
        respondError(req.id, 'outline-failed', err);
      });
    },
    'close': function (req) {
      closeDocument();
      transfers = {};
      respondOk(req.id, null);
    },
    'ping': function (req) {
      respondOk(req.id, null);
    },
  };

  function onMessage(event) {
    var req = null;
    try {
      req = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (!req || typeof req.kind !== 'string' || !handlers[req.kind]) return;
    try {
      handlers[req.kind](req);
    } catch (err) {
      respondError(req.id || 'unknown', 'handler-crash', err);
    }
  }

  // react-native-webview dispatches RN->WV postMessage as a 'message' event
  // on document; listen on window too for safety.
  document.addEventListener('message', onMessage);
  window.addEventListener('message', onMessage);

  post({ kind: 'event', event: 'ready' });
})();
`;

/**
 * Build the full engine HTML with the pdf.js bundles inlined.
 * The returned string is passed as WebView `source={{ html }}`.
 */
export function buildEngineHtml(options: BuildEngineHtmlOptions = {}): string {
  assertInlined();
  const title = options.title ?? 'folio-engine';
  // Defensive: a literal </script inside the bundle would terminate the tag.
  const mainJs = PDFJS_MAIN_BUNDLE.replace(/<\/script/gi, '<\\/script');
  const workerJson = JSON.stringify(PDFJS_WORKER_BUNDLE);
  return (
    '<!DOCTYPE html>\n' +
    '<html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' +
    title.replace(/[<>&]/g, '') +
    '</title></head>' +
    '<body>' +
    '<script>' +
    mainJs +
    '</script>' +
    '<script>var FOLIO_WORKER_SRC=' +
    workerJson +
    ';\n' +
    ENGINE_JS +
    '</script>' +
    '</body></html>'
  );
}
