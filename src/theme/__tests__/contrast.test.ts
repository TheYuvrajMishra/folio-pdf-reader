/**
 * DESIGN §3.1 gate — contrast ratios, all four themes:
 * ink on bg ≥ 14:1 · ink-muted on bg ≥ 4.5:1 · on-accent on accent ≥ 4.5:1.
 */
import { themes, themeNames } from '../tokens';
import { contrastRatio } from '../../util/color';

describe('theme contrast (DESIGN §3.1)', () => {
  for (const name of themeNames) {
    const t = themes[name];
    test(`${name}: ink on bg ≥ 14:1`, () => {
      const r = contrastRatio(t.ink, t.bg);
      expect(r).toBeGreaterThanOrEqual(14);
    });
    test(`${name}: ink-muted on bg ≥ 4.5:1`, () => {
      const r = contrastRatio(t.inkMuted, t.bg);
      expect(r).toBeGreaterThanOrEqual(4.5);
    });
    test(`${name}: on-accent on accent ≥ 4.5:1`, () => {
      const r = contrastRatio(t.onAccent, t.accent);
      expect(r).toBeGreaterThanOrEqual(4.5);
    });
    test(`${name}: danger on bg ≥ 4.5:1 (error legibility)`, () => {
      expect(contrastRatio(t.danger, t.bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
