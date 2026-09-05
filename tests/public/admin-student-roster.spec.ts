import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve(__dirname, '../../src/public/admin');

describe('admin student roster UI', () => {
  test('uploads the selected CSV as FormData and renders only accepted and disabled counts', () => {
    const html = fs.readFileSync(
      path.join(publicRoot, 'settings/index.html'),
      'utf8',
    );
    const app = fs.readFileSync(
      path.join(publicRoot, 'settings/app.ts'),
      'utf8',
    );

    expect(html).toContain('id="studentRosterFile"');
    expect(html).toContain('id="studentRosterImportBtn"');
    expect(html).toContain('id="studentRosterImportResult"');
    expect(app).toContain("new FormData()");
    expect(app).toContain("formData.append('file', file)");
    expect(app).toContain("'/api/admin/student-roster/import'");
    expect(app).toContain('acceptedCount');
    expect(app).toContain('disabledCount');
    expect(app).not.toContain('localStorage.setItem(\'studentRoster');
  });

  test('renders only a masked student verification label in the transaction drawer', () => {
    const html = fs.readFileSync(
      path.join(publicRoot, 'transactions/index.html'),
      'utf8',
    );
    const app = fs.readFileSync(
      path.join(publicRoot, 'transactions/app.ts'),
      'utf8',
    );

    expect(html).toContain('id="dContextHint"');
    expect(app).toContain('studentIdMasked');
    expect(app).toContain('Student verified');
    expect(app).not.toContain('studentIdHmac');
  });
});
