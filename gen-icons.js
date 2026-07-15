// Generate placeholder PWA icons (solid-color squares with 🃏)
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(w, h, r, g, b) {
  // Raw RGBA pixels, filter type 0 (none) per scanline
  const raw = Buffer.alloc(w * h * 4 + h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 4 + 1);
    raw[off] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 4;
      raw[p] = r; raw[p+1] = g; raw[p+2] = b; raw[p+3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const dir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
// Primary color #1a1a2e → but let's use the gold accent #ffd700 for visibility
fs.writeFileSync(path.join(dir, 'icon-192.png'), makePNG(192, 192, 0x1a, 0x1a, 0x2e));
fs.writeFileSync(path.join(dir, 'icon-512.png'), makePNG(512, 512, 0x1a, 0x1a, 0x2e));
console.log('Icons generated: icons/icon-192.png, icons/icon-512.png');
