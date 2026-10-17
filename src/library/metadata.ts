/**
 * metadata.ts — sanitize PDF metadata before it touches the library.
 *
 * PDF producers routinely write junk into Title/Author ("(anonymous)",
 * "Untitled", "Unknown"). Blindly trusting it (as the indexer did) renames
 * the user's book to garbage. These helpers reject placeholder-looking
 * metadata so callers can fall back to the filename-derived title.
 *
 * Pure functions, no platform imports — unit-tested.
 */

/** Metadata values that are placeholders, not real titles/authors. */
const PLACEHOLDER_RE = /^(anonymous|untitled|unknown|untitled document|document|pdf)$/;

/**
 * Normalize a metadata string for placeholder detection: strip wrapping
 * brackets/parens some producers add ("(anonymous)"), trim, lowercase.
 */
function bare(value: string): string {
  return value
    .replace(/^[\s([{"']+|[\s)\]}"']+$/g, '')
    .trim()
    .toLowerCase();
}

/**
 * True when the metadata string is missing or looks like a placeholder
 * ("", "(anonymous)", "Untitled", "x", …).
 */
export function isPlaceholderMetadata(value: string | null | undefined): boolean {
  if (value == null) return true;
  const b = bare(value);
  return b.length < 2 || PLACEHOLDER_RE.test(b);
}

/**
 * Pick the display title: PDF metadata title wins unless it's missing or
 * placeholder-looking, in which case the filename-derived title is kept.
 */
export function sanitizeMetadataTitle(
  metaTitle: string | null | undefined,
  filenameTitle: string,
): string {
  if (isPlaceholderMetadata(metaTitle)) return filenameTitle;
  return (metaTitle as string).trim();
}

/**
 * Pick the display author: metadata author wins unless placeholder-looking;
 * otherwise keep the existing value (usually null).
 */
export function sanitizeMetadataAuthor(
  metaAuthor: string | null | undefined,
  existing: string | null,
): string | null {
  if (isPlaceholderMetadata(metaAuthor)) return existing;
  return (metaAuthor as string).trim();
}
