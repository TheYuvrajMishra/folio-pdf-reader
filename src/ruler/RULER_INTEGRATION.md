# Ruler integration (M3)

Mount the reading ruler inside the reader tree — do NOT edit `ReaderScreen.tsx`
itself; add this block to the reader-screen composition (or a `ReaderRuler`
wrapper rendered by it).

```tsx
import { useRuler } from '../ruler/useRuler';
import { RulerOverlay } from '../ruler/RulerOverlay';
import { RulerPill } from '../ruler/RulerPill';

// Inside the reader component (bookId, page, session, resume, engine,
// toScreen already exist there):
const ruler = useRuler({
  bookId,
  getPage: () => page,                       // current reader page, 1-based
  getLines: (p) => session.getPageLines(p),  // bookSession.getPageLines
  turnPage: (d) => goToPage(page + d),       // reader's page turn (chosen animation)
  getRowProfile: (p) => engine.getRowProfile(p, 0.25), // pixel mode, PRD §6.5
  resume,                                    // ResumeController: reportRuler / setRulerEnabled
  toScreen: (box) => toScreen(box),          // norm → screen incl. zoom/pan
});
const bandBox = ruler.bandBox ? ruler.toScreen(ruler.bandBox) : null;

return (<>
  <RulerOverlay box={bandBox} visible={ruler.enabled}
    style={ruler.settings.style} color={ruler.settings.color}
    fillAlpha={ruler.settings.opacity} glide={ruler.settings.glide}
    pageKey={page} />
  <RulerPill visible={ruler.enabled} lineIndex={ruler.lineIndex}
    totalLines={ruler.lines.length} onStep={(d) => void ruler.step(d)}
    side={ruler.settings.side}
    onSideChange={(s) => void ruler.updateSettings({ side: s })} />
  {ruler.enabled && ruler.emptyPage &&
    <Text style={styles.noText}>No text on this page. ▼ to skip.</Text>}
</>);
```

Toggle (PRD §6.5): toolbar ruler button `onPress={() => ruler.toggle()}` and/or
the existing long-press-center gesture (DESIGN §8) → `ruler.toggle()`.

Notes

- Settings sheet (DESIGN §6.3): `ruler.settings` + `ruler.updateSettings(patch)`
  — keys: color, opacity, lines (1–3), glide, haptics, skipHeaders, style,
  padding, side. Persisted in the `settings` table (`src/ruler/rulerSettings.ts`).
- Resume: `reportRuler` fires on every placement; pixel-mode steps report
  line_index −1 (y_norm-only, PRD §6.4). Restore places the ruler via
  `ResumeController.onRestore` → set the controller to that line index.
- Pixel mode is automatic: text-less pages try `getRowProfile` first; only
  when detection finds no rows does `emptyPage` go true. Omit `getRowProfile`
  to get the text-only behavior.
- `useRuler` re-renders on every placement; keep `toScreen`/`getPage` cheap.
  Long-press repeat is handled inside `RulerPill` (6/s); `step()` is
  re-entrancy-guarded.
