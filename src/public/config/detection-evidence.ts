export type DetectionConfidence = 'high' | 'medium' | 'low';

export interface ColorDetectionEvidence {
  colorPages: number;
  grayscalePages: number;
  selectedPages: number;
  colorPercentage: number;
  confidence: DetectionConfidence;
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
