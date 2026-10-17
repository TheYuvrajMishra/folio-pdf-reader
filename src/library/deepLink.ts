/**
 * deepLink.ts — incoming-PDF contract for the READER agent (M1-A).
 *
 * Android intent filters (app.json) route VIEW/SEND of application/pdf into
 * the app. The reader agent owns src/app/_layout.tsx; from there it should:
 *
 *   // cold start
 *   useEffect(() => {
 *     void (async () => {
 *       const uri = await consumeIncomingPdf();
 *       if (uri) {
 *         const book = await importPdfFromUri(uri);
 *         router.replace(`/reader/${book.id}`);
 *       }
 *     })();
 *     // warm start (app already running)
 *     return onIncomingPdf((uri) => {
 *       void importPdfFromUri(uri).then((book) => router.replace(`/reader/${book.id}`));
 *     });
 *   }, []);
 *
 * `importPdfFromUri` handles the copy into app storage + duplicate detection,
 * so the layout only routes. After consuming, the initial URL is NOT cleared
 * automatically — the reader agent should guard against double-import (e.g.
 * a module-level Set of consumed URLs) since _layout effects can re-run.
 */

import * as Linking from 'expo-linking';

/** Extract a PDF file URI from an incoming URL, or null when not a PDF share. */
function pdfUriFromUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const parsed = Linking.parse(url);
  // Direct file/content shares (Android VIEW/SEND).
  if (parsed.scheme === 'file' || parsed.scheme === 'content') {
    return url.split('#')[0];
  }
  // folio://import?uri=<encoded file uri> (explicit scheme shares).
  if (parsed.scheme === 'folio') {
    const uri = parsed.queryParams?.['uri'];
    if (typeof uri === 'string' && uri.length > 0) {
      return uri;
    }
  }
  return null;
}

/**
 * Cold-start entry: the URL the app was launched with, if it carries a PDF.
 * Returns the file URI (file:// or content://) or null.
 */
export async function consumeIncomingPdf(): Promise<string | null> {
  try {
    return pdfUriFromUrl(await Linking.getInitialURL());
  } catch (err) {
    console.warn('[folio] consumeIncomingPdf failed', err);
    return null;
  }
}

/**
 * Warm-start entry: fires when a PDF share arrives while the app is running.
 * Returns an unsubscribe function.
 */
export function onIncomingPdf(callback: (uri: string) => void): () => void {
  const subscription = Linking.addEventListener('url', (event) => {
    const uri = pdfUriFromUrl(event.url);
    if (uri) {
      callback(uri);
    }
  });
  return () => subscription.remove();
}
