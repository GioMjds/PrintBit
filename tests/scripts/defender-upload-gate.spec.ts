import fs from 'node:fs/promises';
import path from 'node:path';

describe('Defender upload gate scripts', () => {
  it('requires SYSTEM startup, Defender health, signature freshness, and private upload ACLs', async () => {
    const script = await fs.readFile(
      path.resolve('scripts/verify-defender-upload-gate.ps1'),
      'utf8',
    );

    expect(script).toContain("Get-ScheduledTask -TaskName 'PrintBit Kiosk'");
    expect(script).toContain("'SYSTEM'");
    expect(script).toContain('Get-MpComputerStatus');
    expect(script).toContain('PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS');
    expect(script).toContain('uploads\\.staging');
    expect(script).toContain('uploads\\quarantine');
  });

  it('creates private staging ACLs without granting the kiosk user access', async () => {
    const script = await fs.readFile(
      path.resolve('scripts/configure-upload-storage-acl.ps1'),
      'utf8',
    );

    expect(script).toContain('NTAccount');
    expect(script).toContain('/inheritance:r');
    expect(script).toContain('SYSTEM:(OI)(CI)(F)');
    expect(script).toContain('BUILTIN\\Administrators:(OI)(CI)(F)');
  });
});
