import { describe, it, expect } from 'vitest';

import { parseRawDiffZ, parseShortstat } from '../src/git-parse.js';

describe('git-parse', () => {
  describe('parseRawDiffZ', () => {
    it('should throw when raw diff metadata tokens are malformed', () => {
      // Arrange
      const invalidRaw = 'not-a-raw-token\0src/value.js\0';

      // Act
      const readRaw = () => parseRawDiffZ(invalidRaw);

      // Assert
      expect(readRaw).toThrow('Unable to parse git raw diff metadata token');
    });

    it('should return no entries for empty raw diff output', () => {
      // Arrange
      const rawText = '';

      // Act
      const entries = parseRawDiffZ(rawText);

      // Assert
      expect(entries).toEqual([]);
    });

    it('should skip empty metadata tokens in raw diff output', () => {
      // Arrange
      const rawText = '\0:100644 100644 a1 b2 M\0src/value.js\0';

      // Act
      const entries = parseRawDiffZ(rawText);

      // Assert
      expect(entries).toHaveLength(1);
      expect(entries[0].displayPath).toBe('src/value.js');
    });
  });

  describe('parseShortstat', () => {
    it('should return zero counts for an empty shortstat line', () => {
      // Arrange
      const input = '';

      // Act
      const parsed = parseShortstat(input);

      // Assert
      expect(parsed).toEqual({
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        raw: '',
      });
    });
  });
});
