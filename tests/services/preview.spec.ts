import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PreviewService } from '@/services/preview';

type PreviewServiceInternals = {
  resolveLibreOfficePath(): string | null;
  convertViaLibreOffice(sourcePath: string, cachePdf: string): Promise<string>;
  convertViaWordCom(sourcePath: string, cachePdf: string): Promise<void>;
};

function createSourceFile(): { directory: string; sourcePath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'printbit-preview-'));
  const sourcePath = path.join(directory, 'document.docx');
  fs.writeFileSync(sourcePath, 'test document');
  return { directory, sourcePath };
}

describe('PreviewService', () => {
  test('shares one LibreOffice conversion when preview and analysis request the same DOCX', async () => {
    const { directory, sourcePath } = createSourceFile();
    const service = new PreviewService();
    const internals = service as unknown as PreviewServiceInternals;

    jest.spyOn(internals, 'resolveLibreOfficePath').mockReturnValue('soffice.com');
    const wordConversion = jest
      .spyOn(internals, 'convertViaWordCom')
      .mockRejectedValue(new Error('Word should not run when LibreOffice exists'));
    const libreOfficeConversion = jest
      .spyOn(internals, 'convertViaLibreOffice')
      .mockImplementation(async (_sourcePath, cachePdf) => {
        await fs.promises.writeFile(cachePdf, 'pdf');
        return cachePdf;
      });

    const first = service.convertToPdfPreview(sourcePath);
    const second = service.convertToPdfPreview(sourcePath);

    try {
      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.stringMatching(/\.pdf$/),
        expect.stringMatching(/\.pdf$/),
      ]);
      expect(libreOfficeConversion).toHaveBeenCalledTimes(1);
      expect(wordConversion).not.toHaveBeenCalled();
    } finally {
      await Promise.all([first, second].map((conversion) => conversion.catch(() => undefined)));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
