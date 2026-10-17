/**
 * resume.ts — re-match a saved reading position against a (possibly
 * re-indexed) page line list (PRD §6.4).
 *
 * Strategy, in order:
 *  1. If lines[line_index] still starts with the saved snippet → keep it.
 *  2. Else search all lines for a snippet prefix match → that index
 *     (covers re-indexed pages where line numbers shifted).
 *  3. Else fall back to the nearest line by y_norm center distance.
 *  4. Empty line list → null (page has no text layer; the caller uses
 *     y_norm directly in pixel mode).
 *
 * Platform-free: no react-native imports.
 */

export interface SavedPosition {
  /** 1-based page number (informational for this module). */
  page: number;
  line_index: number;
  /** 0..1, top-left origin. */
  y_norm: number;
  /** First up-to-48 chars of the line, as stored at save time. */
  snippet: string;
}

export interface ResumableLine {
  text: string;
  box: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Resolve a saved position to a line index in the current line list.
 * Returns null when the page has no lines.
 *
 * Note: an empty snippet carries no signal, so both snippet checks are
 * skipped and resolution falls straight through to the y_norm fallback.
 */
export function resolvePosition(
  saved: SavedPosition,
  lines: ResumableLine[],
): number | null {
  if (lines.length === 0) return null;

  const snippet = saved.snippet ?? '';
  if (snippet.length > 0) {
    const at = lines[saved.line_index];
    if (at && at.text.startsWith(snippet)) {
      return saved.line_index; // exact hit: line list unchanged here
    }
    const found = lines.findIndex((l) => l.text.startsWith(snippet));
    if (found !== -1) {
      return found; // snippet moved after re-index: re-found
    }
  }

  // y_norm fallback: nearest line by vertical-center distance.
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const center = (lines[i].box.y0 + lines[i].box.y1) / 2;
    const dist = Math.abs(center - saved.y_norm);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}
