import { resolvePosition, type ResumableLine } from '../resume';

const mkLines = (texts: string[]): ResumableLine[] =>
  texts.map((text, i) => ({
    text,
    box: { x0: 0.05, y0: i / texts.length, x1: 0.95, y1: (i + 1) / texts.length },
  }));

describe('resolvePosition', () => {
  const texts = [
    'Chapter one begins with a quiet morning in the village square',
    'The quick brown fox jumps over the lazy dog near the river',
    'Meditations on first philosophy require careful slow reading',
    'A long line about geometry and normalized coordinates here',
    'The ruler advances one line at a time with a gentle haptic',
    'Annotations persist across sessions via the operation log',
    'Every highlight can be undone and redone without any loss',
    'The quick brown fox returns again in a later paragraph',
    'Final thoughts on resuming exactly where you left off',
    'Appendix with references and further reading material',
  ];
  const lines = mkLines(texts);

  test('exact hit: line_index text still starts with snippet → keep', () => {
    const idx = resolvePosition(
      {
        page: 5,
        line_index: 3,
        y_norm: 0.35,
        snippet: texts[3].slice(0, 48),
      },
      lines,
    );
    expect(idx).toBe(3);
  });

  test('snippet moved after re-index: re-find by prefix match', () => {
    // Simulate re-indexing shifting lines: saved line 3's text now at 7.
    const moved = [...texts];
    const [snip] = moved.splice(3, 1);
    moved.splice(7, 0, snip);
    const movedLines = mkLines(moved);
    const idx = resolvePosition(
      {
        page: 5,
        line_index: 3, // stale: points at different text now
        y_norm: 0.35,
        snippet: snip.slice(0, 48),
      },
      movedLines,
    );
    expect(movedLines[3].text.startsWith(snip.slice(0, 48))).toBe(false);
    expect(idx).toBe(7);
  });

  test('snippet gone: fall back to nearest line by y_norm center distance', () => {
    const idx = resolvePosition(
      {
        page: 5,
        line_index: 3,
        y_norm: 0.55,
        snippet: 'this snippet no longer exists anywhere in the text',
      },
      lines,
    );
    // Line centers at 0.05, 0.15, …; nearest to 0.55 is line 5 (center 0.55).
    expect(idx).toBe(5);
  });

  test('stale line_index beyond the list still re-finds by snippet', () => {
    const idx = resolvePosition(
      {
        page: 5,
        line_index: 99,
        y_norm: 0.1,
        snippet: texts[1].slice(0, 48),
      },
      lines,
    );
    expect(idx).toBe(1);
  });

  test('stale line_index + missing snippet → y_norm fallback', () => {
    const idx = resolvePosition(
      { page: 5, line_index: 99, y_norm: 0.92, snippet: 'gone' },
      lines,
    );
    expect(idx).toBe(9); // center 0.95 nearest to 0.92
  });

  test('empty lines → null (scan page: caller uses y_norm directly)', () => {
    expect(
      resolvePosition(
        { page: 5, line_index: 0, y_norm: 0.4, snippet: 'anything' },
        [],
      ),
    ).toBeNull();
  });

  test('empty snippet carries no signal → straight to y_norm fallback', () => {
    const idx = resolvePosition(
      { page: 5, line_index: 3, y_norm: 0.85, snippet: '' },
      lines,
    );
    // Must NOT blindly keep line_index 3; nearest center to 0.85 is line 8.
    expect(idx).toBe(8);
  });

  test('snippet is a strict prefix (first-48-chars semantics)', () => {
    const idx = resolvePosition(
      {
        page: 2,
        line_index: 0,
        y_norm: 0.0,
        snippet: 'The quick brown fox jumps',
      },
      lines,
    );
    // Prefix-matches lines 1 and 7; first match wins.
    expect(idx).toBe(1);
  });
});
