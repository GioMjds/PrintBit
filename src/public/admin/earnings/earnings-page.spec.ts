import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(__dirname, 'index.html'), 'utf8');

describe('earnings page command deck', () => {
  it('exposes one accessible loading trend target', () => {
    expect(html).toContain('data-direction="flat"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="list"');
    expect(html.match(/id="trendGrid"/g)).toHaveLength(1);
  });
});
