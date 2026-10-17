import { uuidv4 } from '../uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv4', () => {
  test('matches the v4 format', () => {
    expect(uuidv4()).toMatch(V4);
  });

  test('generates unique values', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = uuidv4();
      expect(id).toMatch(V4);
      seen.add(id);
    }
    expect(seen.size).toBe(1000);
  });
});
