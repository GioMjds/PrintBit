import {
  detectOrientationFromDimensions,
  detectPaperSizeFromDimensions,
} from '../../src/public/config/geometry-detection';

describe('geometry detection', () => {
  describe('detectOrientationFromDimensions', () => {
    test('detects portrait orientation when height is greater than width', () => {
      expect(detectOrientationFromDimensions(595, 842)).toBe('portrait');
      expect(detectOrientationFromDimensions(612, 792)).toBe('portrait');
      expect(detectOrientationFromDimensions(612, 1008)).toBe('portrait');
      expect(detectOrientationFromDimensions(1080, 1920)).toBe('portrait');
    });

    test('detects landscape orientation when width is greater than height', () => {
      expect(detectOrientationFromDimensions(842, 595)).toBe('landscape');
      expect(detectOrientationFromDimensions(792, 612)).toBe('landscape');
      expect(detectOrientationFromDimensions(1008, 612)).toBe('landscape');
      expect(detectOrientationFromDimensions(1920, 1080)).toBe('landscape');
    });

    test('defaults to portrait when width equals height', () => {
      expect(detectOrientationFromDimensions(500, 500)).toBe('portrait');
    });

    test('returns null for non-positive or invalid dimensions', () => {
      expect(detectOrientationFromDimensions(0, 500)).toBeNull();
      expect(detectOrientationFromDimensions(500, 0)).toBeNull();
      expect(detectOrientationFromDimensions(-100, 200)).toBeNull();
      expect(detectOrientationFromDimensions(NaN, 200)).toBeNull();
      expect(detectOrientationFromDimensions(Infinity, 200)).toBeNull();
    });
  });

  describe('detectPaperSizeFromDimensions', () => {
    test('detects Letter when long dimension is below 815 pt', () => {
      // US Letter is 612 x 792 pt
      expect(detectPaperSizeFromDimensions(612, 792)).toBe('Letter');
      expect(detectPaperSizeFromDimensions(792, 612)).toBe('Letter');
      expect(detectPaperSizeFromDimensions(600, 800)).toBe('Letter');
      expect(detectPaperSizeFromDimensions(814, 600)).toBe('Letter');
    });

    test('detects Legal when long dimension is above 950 pt', () => {
      // US Legal is 612 x 1008 pt
      expect(detectPaperSizeFromDimensions(612, 1008)).toBe('Legal');
      expect(detectPaperSizeFromDimensions(1008, 612)).toBe('Legal');
      expect(detectPaperSizeFromDimensions(951, 612)).toBe('Legal');
    });

    test('detects A4 when long dimension is between 815 pt and 950 pt', () => {
      // A4 is 595.28 x 841.89 pt
      expect(detectPaperSizeFromDimensions(595.28, 841.89)).toBe('A4');
      expect(detectPaperSizeFromDimensions(841.89, 595.28)).toBe('A4');
      expect(detectPaperSizeFromDimensions(815, 600)).toBe('A4');
      expect(detectPaperSizeFromDimensions(950, 600)).toBe('A4');
    });

    test('returns null for non-positive or invalid dimensions', () => {
      expect(detectPaperSizeFromDimensions(0, 800)).toBeNull();
      expect(detectPaperSizeFromDimensions(600, -10)).toBeNull();
      expect(detectPaperSizeFromDimensions(NaN, 800)).toBeNull();
    });
  });
});
