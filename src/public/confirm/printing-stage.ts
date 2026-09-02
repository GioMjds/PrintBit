export interface PrintingStageInput {
  pagesPrinted: number;
  totalPages: number | null;
}

export interface PrintingStage {
  label: string;
  progress: number | null;
}

export function getPrintingStage(input: PrintingStageInput): PrintingStage {
  if (!input.totalPages || input.pagesPrinted <= 0) {
    return { label: 'Preparing your print job…', progress: null };
  }

  const currentPage = Math.min(input.pagesPrinted, input.totalPages);
  return {
    label: `Printing page ${currentPage} of ${input.totalPages}`,
    progress: Math.round((currentPage / input.totalPages) * 100),
  };
}
