const { execSync } = require('child_process');
const fs = require('node:fs');
const path = require('node:path');

function copyFlatpickrCss() {
  const sourcePath = path.resolve(
    'node_modules',
    'flatpickr',
    'dist',
    'flatpickr.min.css',
  );
  const targetPath = path.resolve(
    'src',
    'public',
    'vendor',
    'flatpickr',
    'flatpickr.min.css',
  );
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`Copied: ${sourcePath} -> ${targetPath}`);
  } catch (err) {
    console.warn(`Could not copy flatpickr css (ignoring): ${err.message}`);
  }
}

const builds = [
  'esbuild src/public/app.ts --bundle --outfile=src/public/bundle.js',
  'esbuild src/public/print/app.ts --bundle --outfile=src/public/print/app.js',
  'esbuild src/public/copy/app.ts --bundle --outfile=src/public/copy/app.js',
  'esbuild src/public/config/app.ts --bundle --outfile=src/public/config/app.js',
  'esbuild src/public/confirm/app.ts --bundle --outfile=src/public/confirm/app.js',
  'esbuild src/public/upload/app.ts --bundle --outfile=src/public/upload/app.js',
  'esbuild src/public/scan/app.ts --bundle --outfile=src/public/scan/app.js',
  'esbuild src/public/feedback/app.ts --bundle --outfile=src/public/feedback/app.js',
  'esbuild src/public/receipt/app.ts --bundle --outfile=src/public/receipt/app.js',
  'esbuild src/public/admin/dashboard/app.ts --bundle --outfile=src/public/admin/dashboard/app.js',
  'esbuild src/public/admin/earnings/app.ts --bundle --outfile=src/public/admin/earnings/app.js',
  'esbuild src/public/admin/system/app.ts --bundle --outfile=src/public/admin/system/app.js',
  'esbuild src/public/admin/settings/app.ts --bundle --outfile=src/public/admin/settings/app.js',
  'esbuild src/public/admin/logs/app.ts --bundle --outfile=src/public/admin/logs/app.js',
  'esbuild src/public/admin/transactions/app.ts --bundle --outfile=src/public/admin/transactions/app.js',
  'esbuild src/public/admin/feedback/app.ts --bundle --outfile=src/public/admin/feedback/app.js',
  'esbuild src/public/report/app.ts --bundle --outfile=src/public/report/app.js',
  'esbuild src/public/admin/report/app.ts --bundle --outfile=src/public/admin/report/app.js',
  'esbuild src/public/admin/alerts/app.ts --bundle --outfile=src/public/admin/alerts/app.js',
];

try {
  copyFlatpickrCss();
  for (const cmd of builds) {
    console.log(`Running: ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
  }
  console.log('Build completed successfully.');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
