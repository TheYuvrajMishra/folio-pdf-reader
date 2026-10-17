import {
  isPlaceholderMetadata,
  sanitizeMetadataAuthor,
  sanitizeMetadataTitle,
} from '../metadata';

describe('isPlaceholderMetadata', () => {
  it('rejects null/undefined/blank', () => {
    expect(isPlaceholderMetadata(null)).toBe(true);
    expect(isPlaceholderMetadata(undefined)).toBe(true);
    expect(isPlaceholderMetadata('')).toBe(true);
    expect(isPlaceholderMetadata('   ')).toBe(true);
  });

  it('rejects common placeholders, case-insensitive, with wrapping parens', () => {
    for (const v of [
      '(anonymous)',
      'anonymous',
      'ANONYMOUS',
      'Untitled',
      'untitled document',
      '[Unknown]',
      'x',
    ]) {
      expect(isPlaceholderMetadata(v)).toBe(true);
    }
  });

  it('accepts real titles', () => {
    for (const v of [
      'Designing Data-Intensive Applications',
      'Thinking, Fast and Slow',
      'A1',
    ]) {
      expect(isPlaceholderMetadata(v)).toBe(false);
    }
  });
});

describe('sanitizeMetadataTitle', () => {
  it('keeps the filename title when metadata is junk', () => {
    expect(sanitizeMetadataTitle('(anonymous)', 'My Resume')).toBe('My Resume');
    expect(sanitizeMetadataTitle(null, 'My Resume')).toBe('My Resume');
    expect(sanitizeMetadataTitle('Untitled', 'notes.pdf')).toBe('notes.pdf');
  });

  it('prefers real metadata titles', () => {
    expect(sanitizeMetadataTitle('  Dune  ', 'dune.pdf')).toBe('Dune');
  });
});

describe('sanitizeMetadataAuthor', () => {
  it('keeps existing author when metadata is junk', () => {
    expect(sanitizeMetadataAuthor('(anonymous)', null)).toBe(null);
    expect(sanitizeMetadataAuthor('Unknown', 'Ada')).toBe('Ada');
  });

  it('prefers real metadata authors', () => {
    expect(sanitizeMetadataAuthor('Frank Herbert', null)).toBe('Frank Herbert');
  });
});
