export interface PdfLoadingTask {
  destroy: () => Promise<void> | void;
}

export async function destroyPdfLoadingTask(
  loadingTask: PdfLoadingTask | null | undefined,
): Promise<void> {
  await loadingTask?.destroy();
}
