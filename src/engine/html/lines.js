/**
 * Shared text-line clustering (PRD §7.4). ONE implementation used in two
 * places:
 *  - the WebView engine: inlined by scripts/bundle-pdfjs.mjs before
 *    bootstrap.js (same global scope → top-level function is visible);
 *  - the Node spike harness: required as a CommonJS module.
 *
 * Input: pdf.js getTextContent() items + the page viewport.
 * Output: TextLine[] with normalized 0..1 boxes, 'body'|'margin' kinds,
 * and proportional word splits.
 */
function clusterClamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function clusterVerticalOverlap(a, b) {
  var top = Math.max(a.y0, b.y0);
  var bot = Math.min(a.y1, b.y1);
  var ov = Math.max(0, bot - top);
  var smaller = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  return smaller > 0 ? ov / smaller : 0;
}

function clusterTextItems(items, viewport) {
  var vw = viewport.width;
  var vh = viewport.height;
  var rects = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it.str || !it.str.trim()) continue;
    var t = it.transform;
    // v6 removed convertToViewportRectangle; transform the two corners
    // (identical math — handles rotation and CropBox via the viewport).
    var p1 = viewport.convertToViewportPoint(t[4], t[5]);
    var p2 = viewport.convertToViewportPoint(t[4] + it.width, t[5] + it.height);
    var r = [p1[0], p1[1], p2[0], p2[1]];
    rects.push({
      str: it.str,
      x0: clusterClamp01(Math.min(r[0], r[2]) / vw),
      y0: clusterClamp01(Math.min(r[1], r[3]) / vh),
      x1: clusterClamp01(Math.max(r[0], r[2]) / vw),
      y1: clusterClamp01(Math.max(r[1], r[3]) / vh),
    });
  }
  if (rects.length === 0) return [];

  var heights = rects
    .map(function (it) { return it.y1 - it.y0; })
    .sort(function (a, b) { return a - b; });
  var medianH = heights[Math.floor(heights.length / 2)] || 0.01;

  rects.sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; });

  // Cluster into lines: vertical overlap > 50% of the smaller height.
  var lines = [];
  var cur = null;
  rects.forEach(function (it) {
    if (cur && clusterVerticalOverlap(cur.box, it) > 0.5) {
      cur.items.push(it);
      cur.box.x0 = Math.min(cur.box.x0, it.x0);
      cur.box.y0 = Math.min(cur.box.y0, it.y0);
      cur.box.x1 = Math.max(cur.box.x1, it.x1);
      cur.box.y1 = Math.max(cur.box.y1, it.y1);
    } else {
      cur = { items: [it], box: { x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1 } };
      lines.push(cur);
    }
  });

  var out = [];
  lines.forEach(function (ln, idx) {
    ln.items.sort(function (a, b) { return a.x0 - b.x0; });
    var h = ln.box.y1 - ln.box.y0;
    if (h < 0.4 * medianH) return; // tiny artifact
    var text = ln.items.map(function (it) { return it.str; }).join('');
    if (!text.trim()) return;
    // Words via proportional char-width split.
    var words = [];
    ln.items.forEach(function (it) {
      var parts = it.str.split(/(\s+)/);
      var total = it.str.length || 1;
      var cx = it.x0;
      var wPerChar = (it.x1 - it.x0) / total;
      parts.forEach(function (p) {
        if (!p) return;
        var w = p.length * wPerChar;
        if (p.trim()) words.push({ text: p, box: { x0: cx, y0: it.y0, x1: cx + w, y1: it.y1 } });
        cx += w;
      });
    });
    var midY = (ln.box.y0 + ln.box.y1) / 2;
    out.push({
      idx: idx,
      text: text,
      box: ln.box,
      kind: midY < 0.06 || midY > 0.94 ? 'margin' : 'body',
      words: words,
    });
  });
  return out;
}

// Node spike harness loads this file as a module; in the WebView `module`
// is undefined and the top-level functions are shared via global scope.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { clusterTextItems: clusterTextItems, rotateBox: rotateBox };
}

/**
 * Rotate a normalized box by page /Rotate (clockwise), mirroring
 * src/util/geometry.ts rotateNormRect. Used to map boxes clustered in
 * unrotated space onto the displayed (rotated) page.
 */
function rotateBox(b, rotation) {
  switch (rotation) {
    case 90:
      return { x0: b.y0, y0: 1 - b.x1, x1: b.y1, y1: 1 - b.x0 };
    case 180:
      return { x0: 1 - b.x1, y0: 1 - b.y1, x1: 1 - b.x0, y1: 1 - b.y0 };
    case 270:
      return { x0: 1 - b.y1, y0: b.x0, x1: 1 - b.y0, y1: b.x1 };
    default:
      return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
  }
}
