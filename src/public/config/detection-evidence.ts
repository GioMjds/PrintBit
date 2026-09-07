export type DetectionConfidence = 'high' | 'medium' | 'low';
export type DetectionOrientation = 'portrait' | 'landscape';

export interface ColorDetectionEvidence {
  colorPages: number;
  grayscalePages: number;
  selectedPages: number;
  colorPercentage: number;
  confidence: DetectionConfidence;
}

export interface OrientationDetectionEvidence {
  orientation: DetectionOrientation;
  width: number;
  height: number;
  aspectRatio: number;
}

interface ColorEvidenceInput {
  selectedColorPages: number;
  selectedBwPages: number;
  analysisConfidence: DetectionConfidence;
}

function safePageCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function buildColorDetectionEvidence(
  input: ColorEvidenceInput,
): ColorDetectionEvidence {
  const colorPages = safePageCount(input.selectedColorPages);
  const grayscalePages = safePageCount(input.selectedBwPages);
  const selectedPages = colorPages + grayscalePages;

  return {
    colorPages,
    grayscalePages,
    selectedPages,
    colorPercentage:
      selectedPages > 0 ? Math.round((colorPages / selectedPages) * 100) : 0,
    confidence: input.analysisConfidence,
  };
}

export function buildOrientationDetectionEvidence(
  orientation: DetectionOrientation,
  width: number,
  height: number,
): OrientationDetectionEvidence | null {
  const safeWidth = safePageCount(width);
  const safeHeight = safePageCount(height);
  if (safeWidth <= 0 || safeHeight <= 0) return null;

  return {
    orientation,
    width: safeWidth,
    height: safeHeight,
    aspectRatio: Math.round((safeWidth / safeHeight) * 100) / 100,
  };
}
