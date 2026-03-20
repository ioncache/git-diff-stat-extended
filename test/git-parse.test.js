import { describe, it, expect } from 'vitest';

import {
  parseRawDiffZ,
  parseShortstat,
  formatShortstatLine,
  parseHunkHeader,
  buildRangeArgs,
  zeroSha,
} from '../src/git-parse.js';

describe('git-parse', () => {
  describe('zeroSha', () => {
    it('should return true for null input', () => {
      expect(zeroSha(null)).toBe(true);
    });

    it('should return true for undefined input', () => {
      expect(zeroSha(undefined)).toBe(true);
    });

    it('should return true for empty string', () => {
      expect(zeroSha('')).toBe(true);
    });

    it('should return true for all-zero strings of varying length', () => {
      expect(zeroSha('0000000')).toBe(true);
      expect(zeroSha('0000000000000000000000000000000000000000')).toBe(true);
    });

    it('should return false for a valid hex SHA', () => {
      expect(zeroSha('abc1234')).toBe(false);
      expect(zeroSha('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe(false);
    });
  });

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

    it('should parse an added file entry', () => {
      // Arrange
      const rawText = ':000000 100644 0000000 abc1234 A\0src/new.js\0';

      // Act
      const entries = parseRawDiffZ(rawText);

      // Assert
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('A');
      expect(entries[0].oldPath).toBeNull();
      expect(entries[0].newPath).toBe('src/new.js');
      expect(entries[0].displayPath).toBe('src/new.js');
    });

    it('should parse a deleted file entry', () => {
      // Arrange
      const rawText = ':100644 000000 abc1234 0000000 D\0src/old.js\0';

      // Act
      const entries = parseRawDiffZ(rawText);

      // Assert
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('D');
      expect(entries[0].oldPath).toBe('src/old.js');
      expect(entries[0].newPath).toBeNull();
      expect(entries[0].displayPath).toBe('src/old.js');
    });

    it('should parse a modified file entry with both paths set', () => {
      // Arrange
      const rawText = ':100644 100644 abc1234 def5678 M\0src/value.js\0';

      // Act
      const entries = parseRawDiffZ(rawText);

      // Assert
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('M');
      expect(entries[0].oldPath).toBe('src/value.js');
      expect(entries[0].newPath).toBe('src/value.js');
    });

    it('should parse a rename entry consuming two path tokens', () => {
      // Arrange
      const rawText = ':100644 100644 abc1234 def5678 R100\0src/old.js\0src/new.js\0';

      // Act
      const entries = parseRawDiffZ(rawText);

      // Assert
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('R');
      expect(entries[0].statusCode).toBe('R100');
      expect(entries[0].oldPath).toBe('src/old.js');
      expect(entries[0].newPath).toBe('src/new.js');
      expect(entries[0].displayPath).toBe('src/new.js');
    });

    it('should parse a copy entry consuming two path tokens', () => {
      // Arrange
      const rawText = ':100644 100644 abc1234 abc1234 C100\0src/orig.js\0src/copy.js\0';

      // Act
      const entries = parseRawDiffZ(rawText);

      // Assert
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('C');
      expect(entries[0].oldPath).toBe('src/orig.js');
      expect(entries[0].newPath).toBe('src/copy.js');
    });

    it('should parse multiple entries in a single raw output', () => {
      // Arrange
      const rawText = [
        ':100644 100644 aaa bbb M\0src/a.js\0',
        ':000000 100644 0000000 ccc A\0src/b.js\0',
      ].join('');

      // Act
      const entries = parseRawDiffZ(rawText);

      // Assert
      expect(entries).toHaveLength(2);
      expect(entries[0].status).toBe('M');
      expect(entries[1].status).toBe('A');
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

    it('should parse a full shortstat line with all three metrics', () => {
      // Arrange
      const input = ' 3 files changed, 10 insertions(+), 5 deletions(-)';

      // Act
      const parsed = parseShortstat(input);

      // Assert
      expect(parsed.filesChanged).toBe(3);
      expect(parsed.insertions).toBe(10);
      expect(parsed.deletions).toBe(5);
    });

    it('should parse singular forms correctly', () => {
      // Arrange
      const input = ' 1 file changed, 1 insertion(+), 1 deletion(-)';

      // Act
      const parsed = parseShortstat(input);

      // Assert
      expect(parsed.filesChanged).toBe(1);
      expect(parsed.insertions).toBe(1);
      expect(parsed.deletions).toBe(1);
    });

    it('should handle insertions-only shortstat', () => {
      // Arrange
      const input = ' 1 file changed, 5 insertions(+)';

      // Act
      const parsed = parseShortstat(input);

      // Assert
      expect(parsed.filesChanged).toBe(1);
      expect(parsed.insertions).toBe(5);
      expect(parsed.deletions).toBe(0);
    });

    it('should handle deletions-only shortstat', () => {
      // Arrange
      const input = ' 1 file changed, 3 deletions(-)';

      // Act
      const parsed = parseShortstat(input);

      // Assert
      expect(parsed.filesChanged).toBe(1);
      expect(parsed.insertions).toBe(0);
      expect(parsed.deletions).toBe(3);
    });
  });

  describe('formatShortstatLine', () => {
    it('should use plural forms for counts greater than one', () => {
      // Act
      const result = formatShortstatLine(3, 10, 5);

      // Assert
      expect(result).toBe('3 files changed, 10 insertions(+), 5 deletions(-)');
    });

    it('should use singular forms for counts of exactly one', () => {
      // Act
      const result = formatShortstatLine(1, 1, 1);

      // Assert
      expect(result).toBe('1 file changed, 1 insertion(+), 1 deletion(-)');
    });

    it('should use plural forms for zero counts', () => {
      // Act
      const result = formatShortstatLine(0, 0, 0);

      // Assert
      expect(result).toBe('0 files changed, 0 insertions(+), 0 deletions(-)');
    });
  });

  describe('parseHunkHeader', () => {
    it('should parse a standard hunk header with counts', () => {
      // Act
      const result = parseHunkHeader('@@ -10,5 +20,3 @@');

      // Assert
      expect(result).toEqual({ oldLine: 10, newLine: 20 });
    });

    it('should parse a hunk header without line counts', () => {
      // Act
      const result = parseHunkHeader('@@ -1 +1 @@');

      // Assert
      expect(result).toEqual({ oldLine: 1, newLine: 1 });
    });

    it('should parse a hunk header with trailing context label', () => {
      // Act
      const result = parseHunkHeader('@@ -42,6 +42,8 @@ function example() {');

      // Assert
      expect(result).toEqual({ oldLine: 42, newLine: 42 });
    });

    it('should return null for non-hunk lines', () => {
      expect(parseHunkHeader('+added line')).toBeNull();
      expect(parseHunkHeader('-removed line')).toBeNull();
      expect(parseHunkHeader(' context line')).toBeNull();
      expect(parseHunkHeader('diff --git a/file b/file')).toBeNull();
    });
  });

  describe('buildRangeArgs', () => {
    it('should return an explicit range as a single-element array', () => {
      // Act
      const result = buildRangeArgs({ range: 'main..HEAD' });

      // Assert
      expect(result).toEqual(['main..HEAD']);
    });

    it('should return base and head when range is not provided', () => {
      // Act
      const result = buildRangeArgs({ base: 'v1.0', head: 'v2.0' });

      // Assert
      expect(result).toEqual(['v1.0', 'v2.0']);
    });

    it('should default base to HEAD~1 and head to HEAD when neither is provided', () => {
      // Act
      const result = buildRangeArgs({});

      // Assert
      expect(result).toEqual(['HEAD~1', 'HEAD']);
    });

    it('should prefer range over base and head when all are provided', () => {
      // Act
      const result = buildRangeArgs({ range: 'a..b', base: 'c', head: 'd' });

      // Assert
      expect(result).toEqual(['a..b']);
    });
  });
});
