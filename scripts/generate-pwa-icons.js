const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const outDir = path.resolve(__dirname, '../src/public/admin/icons');
fs.mkdirSync(outDir, { recursive: true });

// SVG source matching PrintBit Admin brand logomark
const svgBuffer = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="112" fill="#0b0a1a" />
  <rect x="76.8" y="64" width="358.4" height="217.6" rx="44.8" fill="#4f46e5" opacity="0.3" />
  <rect x="38.4" y="179.2" width="435.2" height="243.2" rx="64" fill="#4f46e5" opacity="0.85" />
  <rect x="76.8" y="256" width="358.4" height="179.2" rx="38.4" fill="#0b0a1a" />
  <rect x="128" y="320" width="204.8" height="32" rx="16" fill="#10b981" />
  <circle cx="396.8" cy="217.6" r="19.2" fill="#38bdf8" />
</svg>
`);

// Maskable SVG with safe-zone inset (padded by 15-20% for adaptive icon masks)
const maskableSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" fill="#0b0a1a" />
  <g transform="translate(64, 64) scale(0.75)">
    <rect x="76.8" y="64" width="358.4" height="217.6" rx="44.8" fill="#4f46e5" opacity="0.3" />
    <rect x="38.4" y="179.2" width="435.2" height="243.2" rx="64" fill="#4f46e5" opacity="0.85" />
    <rect x="76.8" y="256" width="358.4" height="179.2" rx="38.4" fill="#0b0a1a" />
    <rect x="128" y="320" width="204.8" height="32" rx="16" fill="#10b981" />
    <circle cx="396.8" cy="217.6" r="19.2" fill="#38bdf8" />
  </g>
</svg>
`);

async function generate() {
  console.log(`Generating PWA icons in: ${outDir}`);

  // 1. Standard 192x192
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(outDir, 'icon-192x192.png'));
  console.log('  Created icon-192x192.png');

  // 2. Standard 512x512
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, 'icon-512x512.png'));
  console.log('  Created icon-512x512.png');

  // 3. Maskable 512x512
  await sharp(maskableSvg)
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, 'icon-maskable-512x512.png'));
  console.log('  Created icon-maskable-512x512.png');

  // 4. Apple Touch Icon 180x180
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(outDir, 'apple-touch-icon.png'));
  console.log('  Created apple-touch-icon.png');

  // 5. Favicon SVG
  fs.writeFileSync(path.join(outDir, 'favicon.svg'), svgBuffer);
  console.log('  Created favicon.svg');

  console.log('All PWA icons generated successfully.');
}

generate().catch((err) => {
  console.error('Failed to generate PWA icons:', err);
  process.exit(1);
});
