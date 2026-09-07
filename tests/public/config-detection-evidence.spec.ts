import {
  buildColorDetectionEvidence,
  buildOrientationDetectionEvidence,
} from '../../src/public/config/detection-evidence';

describe('config detection evidence', () => {
  test('summarizes the selected pages that contain color', () => {
    const evidence = buildColorDetectionEvidence({
      selectedColorPages: 3,
      selectedBwPages: 2,
      analysisConfidence: 'high',
    });

    expect(evidence).toEqual({
      colorPages: 3,
      grayscalePages: 2,
      selectedPages: 5,
      colorPercentage: 60,
      confidence: 'high',
    });
  });

  test('keeps a zero-page summary safe and unambiguous', () => {
    const evidence = buildColorDetectionEvidence({
      selectedColorPages: 0,
      selectedBwPages: 0,
      analysisConfidence: 'low',
    });

    expect(evidence.colorPercentage).toBe(0);
    expect(evidence.selectedPages).toBe(0);
  });

  test('describes orientation from preview dimensions', () => {
    const evidence = buildOrientationDetectionEvidence('landscape', 1600, 1100);

    expect(evidence).toEqual({
      orientation: 'landscape',
      width: 1600,
      height: 1100,
      aspectRatio: 1.45,
    });
  });
});
