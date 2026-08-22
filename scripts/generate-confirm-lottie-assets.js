const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'src', 'public', 'assets', 'lottie');
const FRAME_RATE = 30;
const OUT_FRAME = 60;
const CANVAS_SIZE = 512;
const FIXED_DOS_TIME = { time: 0x6000, date: 0x5d16 }; // 2026-08-22 12:00:00

const COLOR = {
  deepSpace: [14 / 255, 13 / 255, 31 / 255, 1],
  indigo: [105 / 255, 111 / 255, 199 / 255, 1],
  lavender: [167 / 255, 170 / 255, 225 / 255, 1],
  peach: [245 / 255, 211 / 255, 196 / 255, 1],
  pink: [242 / 255, 174 / 255, 187 / 255, 1],
  white: [1, 1, 1, 1],
};

const staticValue = (value) => ({ a: 0, k: value });

const animatedValue = (keyframes) => ({
  a: 1,
  k: keyframes.map((keyframe, index) => {
    const frame = {
      t: keyframe.frame,
      s: Array.isArray(keyframe.value) ? keyframe.value : [keyframe.value],
    };

    if (index < keyframes.length - 1) {
      frame.i = { x: [0.7], y: [1] };
      frame.o = { x: [0.3], y: [0] };
    }

    return frame;
  }),
});

const rectangle = (name, size, position = [0, 0], roundness = 0) => ({
  ty: 'rc',
  d: 1,
  nm: name,
  p: staticValue(position),
  s: staticValue(size),
  r: staticValue(roundness),
});

const ellipse = (name, size, position = [0, 0]) => ({
  ty: 'el',
  d: 1,
  nm: name,
  p: staticValue(position),
  s: staticValue(size),
});

const fill = (name, color, opacity = 100) => ({
  ty: 'fl',
  nm: name,
  c: staticValue(color),
  o: staticValue(opacity),
  r: 1,
});

const stroke = (name, color, width, opacity = 100) => ({
  ty: 'st',
  nm: name,
  c: staticValue(color),
  o: staticValue(opacity),
  w: staticValue(width),
  lc: 2,
  lj: 2,
  ml: 4,
});

const groupTransform = () => ({
  ty: 'tr',
  nm: 'Transform',
  p: staticValue([0, 0]),
  a: staticValue([0, 0]),
  s: staticValue([100, 100]),
  r: staticValue(0),
  o: staticValue(100),
  sk: staticValue(0),
  sa: staticValue(0),
});

const layerTransform = ({
  position = staticValue([CANVAS_SIZE / 2, CANVAS_SIZE / 2, 0]),
  opacity = staticValue(100),
  rotation = staticValue(0),
  scale = staticValue([100, 100, 100]),
} = {}) => ({
  o: opacity,
  r: rotation,
  p: position,
  a: staticValue([0, 0, 0]),
  s: scale,
});

const shapeLayer = ({ index, name, shapes, transform }) => ({
  ddd: 0,
  ind: index,
  ty: 4,
  nm: name,
  sr: 1,
  ks: layerTransform(transform),
  ao: 0,
  shapes: [
    {
      ty: 'gr',
      nm: `${name} artwork`,
      it: [...shapes, groupTransform()],
    },
  ],
  ip: 0,
  op: OUT_FRAME,
  st: 0,
  bm: 0,
});

const baseAnimation = (name, layers) => ({
  v: '5.12.2',
  fr: FRAME_RATE,
  ip: 0,
  op: OUT_FRAME,
  w: CANVAS_SIZE,
  h: CANVAS_SIZE,
  nm: name,
  ddd: 0,
  assets: [],
  markers: [
    { tm: 0, cm: 'loop-start', dr: 0 },
    { tm: OUT_FRAME - 1, cm: 'loop-end', dr: 0 },
  ],
  layers,
});

const paperArtwork = (accent = COLOR.indigo) => [
  rectangle('Paper', [166, 206], [0, 0], 12),
  fill('Paper fill', COLOR.white),
  stroke('Paper outline', accent, 5),
  rectangle('Heading line', [96, 12], [0, -56], 6),
  fill('Heading line fill', COLOR.indigo),
  rectangle('Text line 1', [112, 7], [0, -25], 3.5),
  fill('Text line 1 fill', COLOR.lavender),
  rectangle('Text line 2', [112, 7], [0, -7], 3.5),
  fill('Text line 2 fill', COLOR.lavender),
  rectangle('Text line 3', [84, 7], [-14, 11], 3.5),
  fill('Text line 3 fill', COLOR.peach),
  rectangle('Footer line', [64, 7], [-24, 59], 3.5),
  fill('Footer line fill', COLOR.lavender),
];

const createPrintingAnimation = () => {
  const outputPaper = shapeLayer({
    index: 2,
    name: 'Traveling printed document',
    shapes: paperArtwork(COLOR.indigo),
    transform: {
      position: animatedValue([
        { frame: 0, value: [256, 170, 0] },
        { frame: 8, value: [256, 184, 0] },
        { frame: 42, value: [256, 330, 0] },
        { frame: 54, value: [256, 346, 0] },
        { frame: 60, value: [256, 170, 0] },
      ]),
      opacity: animatedValue([
        { frame: 0, value: 0 },
        { frame: 7, value: 100 },
        { frame: 48, value: 100 },
        { frame: 56, value: 0 },
        { frame: 60, value: 0 },
      ]),
    },
  });

  const printerBody = shapeLayer({
    index: 1,
    name: 'Printer body',
    shapes: [
      rectangle('Printer shell', [250, 124], [0, 0], 24),
      fill('Printer shell fill', COLOR.indigo),
      stroke('Printer shell highlight', COLOR.lavender, 5),
      rectangle('Control shelf', [212, 42], [0, -29], 12),
      fill('Control shelf fill', COLOR.lavender, 30),
      rectangle('Paper slot', [138, 15], [-14, 9], 7.5),
      fill('Paper slot fill', COLOR.deepSpace),
      ellipse('Status light', [15, 15], [91, -28]),
      fill('Status light fill', COLOR.pink),
      rectangle('Lower lip', [184, 15], [0, 53], 7.5),
      fill('Lower lip fill', COLOR.peach),
    ],
    transform: {
      position: staticValue([256, 234, 0]),
      scale: animatedValue([
        { frame: 0, value: [100, 100, 100] },
        { frame: 14, value: [100, 102, 100] },
        { frame: 26, value: [100, 100, 100] },
        { frame: 60, value: [100, 100, 100] },
      ]),
    },
  });

  const intakePaper = shapeLayer({
    index: 3,
    name: 'Input document',
    shapes: [
      rectangle('Input paper', [156, 124], [0, 0], 10),
      fill('Input paper fill', COLOR.white),
      stroke('Input paper outline', COLOR.lavender, 5),
      rectangle('Input heading', [84, 9], [0, -31], 4.5),
      fill('Input heading fill', COLOR.indigo),
      rectangle('Input line', [102, 7], [0, -10], 3.5),
      fill('Input line fill', COLOR.peach),
    ],
    transform: {
      position: animatedValue([
        { frame: 0, value: [256, 140, 0] },
        { frame: 18, value: [256, 146, 0] },
        { frame: 36, value: [256, 140, 0] },
        { frame: 60, value: [256, 140, 0] },
      ]),
    },
  });

  const floorShadow = shapeLayer({
    index: 4,
    name: 'Grounded shadow',
    shapes: [
      ellipse('Shadow', [236, 35], [0, 0]),
      fill('Shadow fill', COLOR.indigo, 20),
    ],
    transform: {
      position: staticValue([256, 407, 0]),
      scale: animatedValue([
        { frame: 0, value: [88, 88, 100] },
        { frame: 40, value: [104, 104, 100] },
        { frame: 60, value: [88, 88, 100] },
      ]),
      opacity: animatedValue([
        { frame: 0, value: 32 },
        { frame: 40, value: 55 },
        { frame: 60, value: 32 },
      ]),
    },
  });

  return baseAnimation('PrintBit — Printing document journey', [
    printerBody,
    outputPaper,
    intakePaper,
    floorShadow,
  ]);
};

const createCopyingAnimation = () => {
  const originalDocument = shapeLayer({
    index: 2,
    name: 'Original document',
    shapes: paperArtwork(COLOR.peach),
    transform: {
      position: animatedValue([
        { frame: 0, value: [256, 260, 0] },
        { frame: 18, value: [256, 260, 0] },
        { frame: 42, value: [204, 278, 0] },
        { frame: 52, value: [204, 278, 0] },
        { frame: 59, value: [256, 260, 0] },
        { frame: 60, value: [256, 260, 0] },
      ]),
      rotation: animatedValue([
        { frame: 0, value: 0 },
        { frame: 18, value: 0 },
        { frame: 42, value: -5 },
        { frame: 52, value: -5 },
        { frame: 59, value: 0 },
        { frame: 60, value: 0 },
      ]),
      opacity: animatedValue([
        { frame: 0, value: 100 },
        { frame: 50, value: 100 },
        { frame: 57, value: 0 },
        { frame: 59, value: 0 },
        { frame: 60, value: 100 },
      ]),
    },
  });

  const copiedDocument = shapeLayer({
    index: 3,
    name: 'New copied document',
    shapes: paperArtwork(COLOR.indigo),
    transform: {
      position: animatedValue([
        { frame: 0, value: [256, 260, 0] },
        { frame: 19, value: [256, 260, 0] },
        { frame: 42, value: [308, 252, 0] },
        { frame: 52, value: [308, 252, 0] },
        { frame: 60, value: [256, 260, 0] },
      ]),
      rotation: animatedValue([
        { frame: 0, value: 0 },
        { frame: 19, value: 0 },
        { frame: 42, value: 5 },
        { frame: 52, value: 5 },
        { frame: 60, value: 0 },
      ]),
      scale: animatedValue([
        { frame: 0, value: [94, 94, 100] },
        { frame: 19, value: [94, 94, 100] },
        { frame: 42, value: [100, 100, 100] },
        { frame: 60, value: [94, 94, 100] },
      ]),
      opacity: animatedValue([
        { frame: 0, value: 0 },
        { frame: 19, value: 0 },
        { frame: 27, value: 100 },
        { frame: 50, value: 100 },
        { frame: 57, value: 0 },
        { frame: 60, value: 0 },
      ]),
    },
  });

  const copierLight = shapeLayer({
    index: 1,
    name: 'Copy light sweep',
    shapes: [
      rectangle('Illumination bar', [220, 10], [0, 0], 5),
      fill('Illumination fill', COLOR.peach),
      rectangle('Light core', [178, 4], [0, 0], 2),
      fill('Light core fill', COLOR.white),
    ],
    transform: {
      position: animatedValue([
        { frame: 0, value: [256, 164, 0] },
        { frame: 7, value: [256, 164, 0] },
        { frame: 29, value: [256, 350, 0] },
        { frame: 34, value: [256, 350, 0] },
        { frame: 60, value: [256, 164, 0] },
      ]),
      opacity: animatedValue([
        { frame: 0, value: 0 },
        { frame: 7, value: 100 },
        { frame: 29, value: 100 },
        { frame: 35, value: 0 },
        { frame: 60, value: 0 },
      ]),
    },
  });

  const copyShadow = shapeLayer({
    index: 4,
    name: 'Copy grounded shadow',
    shapes: [
      ellipse('Shadow', [282, 44], [0, 0]),
      fill('Shadow fill', COLOR.peach, 18),
    ],
    transform: {
      position: staticValue([256, 405, 0]),
      scale: animatedValue([
        { frame: 0, value: [72, 72, 100] },
        { frame: 42, value: [104, 104, 100] },
        { frame: 60, value: [72, 72, 100] },
      ]),
      opacity: animatedValue([
        { frame: 0, value: 28 },
        { frame: 42, value: 50 },
        { frame: 60, value: 28 },
      ]),
    },
  });

  return baseAnimation('PrintBit — Copying document journey', [
    copierLight,
    originalDocument,
    copiedDocument,
    copyShadow,
  ]);
};

const createPixelLayer = ({ index, name, color, start, middle, end, delay }) =>
  shapeLayer({
    index,
    name,
    shapes: [
      rectangle('Digital pixel', [18, 18], [0, 0], 5),
      fill('Digital pixel fill', color),
      stroke('Digital pixel edge', COLOR.white, 2, 72),
    ],
    transform: {
      position: animatedValue([
        { frame: 0, value: start },
        { frame: delay, value: start },
        { frame: delay + 16, value: middle },
        { frame: delay + 28, value: end },
        { frame: 60, value: start },
      ]),
      rotation: animatedValue([
        { frame: 0, value: 0 },
        { frame: delay, value: 0 },
        { frame: delay + 28, value: 45 },
        { frame: 60, value: 0 },
      ]),
      scale: animatedValue([
        { frame: 0, value: [70, 70, 100] },
        { frame: delay, value: [70, 70, 100] },
        { frame: delay + 16, value: [108, 108, 100] },
        { frame: delay + 28, value: [82, 82, 100] },
        { frame: 60, value: [70, 70, 100] },
      ]),
      opacity: animatedValue([
        { frame: 0, value: 0 },
        { frame: delay, value: 0 },
        { frame: delay + 7, value: 100 },
        { frame: delay + 22, value: 100 },
        { frame: delay + 28, value: 0 },
        { frame: 60, value: 0 },
      ]),
    },
  });

const createScanningAnimation = () => {
  const scanBeam = shapeLayer({
    index: 1,
    name: 'Scanning beam',
    shapes: [
      rectangle('Beam aura', [224, 18], [0, 0], 9),
      fill('Beam aura fill', COLOR.pink, 24),
      rectangle('Beam core', [202, 7], [0, 0], 3.5),
      fill('Beam core fill', COLOR.pink),
      rectangle('Beam highlight', [148, 3], [0, 0], 1.5),
      fill('Beam highlight fill', COLOR.white, 90),
    ],
    transform: {
      position: animatedValue([
        { frame: 0, value: [256, 162, 0] },
        { frame: 6, value: [256, 162, 0] },
        { frame: 36, value: [256, 354, 0] },
        { frame: 52, value: [256, 162, 0] },
        { frame: 60, value: [256, 162, 0] },
      ]),
      opacity: animatedValue([
        { frame: 0, value: 0 },
        { frame: 6, value: 100 },
        { frame: 52, value: 100 },
        { frame: 58, value: 0 },
        { frame: 60, value: 0 },
      ]),
    },
  });

  const scannedDocument = shapeLayer({
    index: 5,
    name: 'Document being digitized',
    shapes: paperArtwork(COLOR.pink),
    transform: {
      position: staticValue([256, 266, 0]),
      scale: animatedValue([
        { frame: 0, value: [100, 100, 100] },
        { frame: 30, value: [102, 102, 100] },
        { frame: 60, value: [100, 100, 100] },
      ]),
    },
  });

  const scannerBed = shapeLayer({
    index: 6,
    name: 'Scanner bed',
    shapes: [
      rectangle('Scanner glass', [236, 300], [0, 0], 26),
      fill('Scanner glass fill', COLOR.indigo, 14),
      stroke('Scanner glass edge', COLOR.lavender, 5, 75),
      rectangle('Scanner footer', [184, 16], [0, 137], 8),
      fill('Scanner footer fill', COLOR.indigo),
    ],
    transform: {
      position: staticValue([256, 266, 0]),
    },
  });

  const pixelOne = createPixelLayer({
    index: 2,
    name: 'Digital particle 1',
    color: COLOR.pink,
    start: [214, 284, 0],
    middle: [196, 214, 0],
    end: [183, 151, 0],
    delay: 19,
  });
  const pixelTwo = createPixelLayer({
    index: 3,
    name: 'Digital particle 2',
    color: COLOR.peach,
    start: [256, 306, 0],
    middle: [274, 226, 0],
    end: [292, 142, 0],
    delay: 23,
  });
  const pixelThree = createPixelLayer({
    index: 4,
    name: 'Digital particle 3',
    color: COLOR.lavender,
    start: [294, 326, 0],
    middle: [326, 246, 0],
    end: [348, 178, 0],
    delay: 27,
  });

  const scanShadow = shapeLayer({
    index: 7,
    name: 'Scanner grounded shadow',
    shapes: [
      ellipse('Shadow', [286, 42], [0, 0]),
      fill('Shadow fill', COLOR.pink, 16),
    ],
    transform: {
      position: staticValue([256, 434, 0]),
      opacity: animatedValue([
        { frame: 0, value: 28 },
        { frame: 34, value: 48 },
        { frame: 60, value: 28 },
      ]),
    },
  });

  return baseAnimation('PrintBit — Scanning document journey', [
    scanBeam,
    pixelOne,
    pixelTwo,
    pixelThree,
    scannedDocument,
    scannerBed,
    scanShadow,
  ]);
};

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createZip = (entries) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(FIXED_DOS_TIME.time, 10);
    localHeader.writeUInt16LE(FIXED_DOS_TIME.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(FIXED_DOS_TIME.time, 12);
    centralHeader.writeUInt16LE(FIXED_DOS_TIME.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
};

const writeAsset = (id, displayName, animation) => {
  const json = `${JSON.stringify(animation, null, 2)}\n`;
  const manifest = {
    version: '2',
    generator: 'PrintBit confirm Lottie generator 1.0',
    initial: { animation: id },
    animations: [{ id, name: displayName }],
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, `${id}.json`), json, 'utf8');
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${id}.lottie`),
    createZip([
      { name: 'manifest.json', data: `${JSON.stringify(manifest, null, 2)}\n` },
      { name: `a/${id}.json`, data: json },
    ]),
  );
};

writeAsset('printing', 'PrintBit — Printing', createPrintingAnimation());
writeAsset('copying', 'PrintBit — Copying', createCopyingAnimation());
writeAsset('scanning', 'PrintBit — Scanning', createScanningAnimation());
