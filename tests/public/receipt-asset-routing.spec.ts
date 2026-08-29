import fs from 'node:fs';
import path from 'node:path';

describe('receipt asset routing', () => {
  it('registers receipt assets before the dynamic receipt page routes', () => {
    const controller = fs.readFileSync(
      path.resolve('src/modules/page/page.controller.ts'),
      'utf8',
    );

    expect(controller).toContain("this.router.get('/receipt/:asset'");
  });
});
