import { destroyPdfLoadingTask } from '@/public/shared/pdfjs-loading-task-cleanup';

describe('PDF.js loading-task cleanup', () => {
  it('releases a v6 PDF through its loading task', async () => {
    const destroy = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);

    await destroyPdfLoadingTask({ destroy });

    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
