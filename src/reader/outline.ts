/**
 * outline.ts — best-effort PDF outline destination → page resolution (M5).
 *
 * Pure module (no react-native imports) so it is unit-testable in Node.
 *
 * The engine serializes pdf.js outline dests as JSON (`destJson`). Explicit
 * destinations whose first element is a 0-based page index resolve directly.
 * Named destinations and page-reference objects (`{num, gen}`) cannot be
 * resolved client-side → null → the Contents tab renders a disabled row.
 */

/**
 * Resolve an outline node's `destJson` to a 1-based page number, or null
 * when the destination cannot be resolved client-side.
 */
export function resolveOutlinePage(destJson: string | null): number | null {
  if (!destJson) return null;
  try {
    const d: unknown = JSON.parse(destJson);
    if (typeof d === 'number' && Number.isInteger(d) && d >= 0) return d + 1;
    if (Array.isArray(d) && typeof d[0] === 'number' && Number.isInteger(d[0]) && d[0] >= 0) {
      return d[0] + 1;
    }
    return null;
  } catch {
    return null;
  }
}
