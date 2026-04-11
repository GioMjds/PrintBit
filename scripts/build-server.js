const { execSync } = require('child_process');

const command = [
  'esbuild',
  'src/server.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--packages=external',
  '--target=node22',
  '--outfile=dist/server.js',
].join(' ');

try {
  console.log(`Running: ${command}`);
  execSync(command, { stdio: 'inherit' });
  console.log('Server build completed successfully.');
} catch (error) {
  console.error('Server build failed:', error);
  process.exit(1);
}
