/**
 * engineHost.tsx — singleton PdfEngine + the headless host component.
 *
 * The engine lives in a hidden WebView (never visible, never interactive):
 * it rasterizes pages and extracts text lines for the reader. Exactly one
 * <EngineHost /> is mounted (in the root layout); every consumer uses
 * getEngine() to reach the same instance.
 */

import { useMemo } from 'react';
import { WebView } from 'react-native-webview';

import { PdfEngine } from './PdfEngine';

let engineInstance: PdfEngine | null = null;

/** The app-wide PdfEngine singleton. */
export function getEngine(): PdfEngine {
  if (!engineInstance) {
    engineInstance = new PdfEngine({
      onCrash: (count) => {
        // PRD §7.9: the engine counts crashes and rejects in-flight work;
        // the reader re-opens the session on the next openBookSession().
        console.warn(`[folio-engine] WebView render process died (count=${count})`);
      },
    });
  }
  return engineInstance;
}

/**
 * Mounts the hidden headless engine WebView. Render exactly once, at the
 * root layout — never inside a screen that can unmount.
 */
export function EngineHost() {
  const engine = useMemo(() => getEngine(), []);
  return (
    <WebView
      ref={engine.attachWebView}
      {...engine.getWebViewProps()}
      style={{ width: 0, height: 0 }}
    />
  );
}
