import fs from 'node:fs';
import path from 'node:path';

describe.each(['report', 'feedback'])('%s direct portal', (portal) => {
  it('loads its portal-specific stylesheet from the direct route', () => {
    const html = fs.readFileSync(
      path.resolve('src', 'public', portal, 'index.html'),
      'utf8',
    );

    expect(html).toContain(
      `<link rel="stylesheet" href="/${portal}/styles.css" />`,
    );
  });

  it('allows vertical touch scrolling without horizontal page drift', () => {
    const css = fs.readFileSync(
      path.resolve('src', 'public', portal, 'styles.css'),
      'utf8',
    );
    const pageRule = css.match(/html\s*,\s*body\s*\{([^}]*)\}/)?.[1] ?? '';
    const declarations = Object.fromEntries(
      pageRule
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .map((declaration) => {
          const separator = declaration.indexOf(':');
          return [
            declaration.slice(0, separator).trim(),
            declaration.slice(separator + 1).trim(),
          ];
        }),
    );

    expect(declarations).toMatchObject({
      'overflow-x': 'hidden',
      'overflow-y': 'auto',
      'overscroll-behavior-y': 'auto',
      'touch-action': 'pan-y',
      '-webkit-overflow-scrolling': 'touch',
    });
  });
});
