#!/usr/bin/env node
// Generate placeholder app art (icon / splash / hero) with zero dependencies.
// Writes solid Base-blue PNGs with the title text + a simple Toby toad mark.
// Replace these with real artwork before launch — they exist so the mini-app embed/manifest
// have valid, correctly-sized images. Run: node scripts/gen-placeholder-art.mjs
//
// PNGs are 8-bit truecolor RGB (color type 2, no alpha) so the icon satisfies the
// "1024x1024, no alpha channel" requirement.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ---------- tiny 5x7 bitmap font ----------
const F = {
  'A':['.###.','#...#','#...#','#####','#...#','#...#','#...#'],
  'B':['####.','#...#','#...#','####.','#...#','#...#','####.'],
  'C':['.####','#....','#....','#....','#....','#....','.####'],
  'D':['####.','#...#','#...#','#...#','#...#','#...#','####.'],
  'E':['#####','#....','#....','####.','#....','#....','#####'],
  'H':['#...#','#...#','#...#','#####','#...#','#...#','#...#'],
  'I':['#####','..#..','..#..','..#..','..#..','..#..','#####'],
  'L':['#....','#....','#....','#....','#....','#....','#####'],
  'N':['#...#','##..#','##..#','#.#.#','#..##','#..##','#...#'],
  'O':['.###.','#...#','#...#','#...#','#...#','#...#','.###.'],
  'P':['####.','#...#','#...#','####.','#....','#....','#....'],
  'R':['####.','#...#','#...#','####.','#.#..','#..#.','#...#'],
  'S':['.####','#....','#....','.###.','....#','....#','####.'],
  'T':['#####','..#..','..#..','..#..','..#..','..#..','..#..'],
  'W':['#...#','#...#','#...#','#.#.#','#.#.#','##.##','#...#'],
  'Y':['#...#','#...#','.#.#.','..#..','..#..','..#..','..#..'],
  ' ':['.....','.....','.....','.....','.....','.....','.....'],
  ',':['.....','.....','.....','.....','..##.','..#..','.#...'],
  '.':['.....','.....','.....','.....','.....','.##..','.##..'],
  '-':['.....','.....','.....','#####','.....','.....','.....'],
};
const GW = 5, GH = 7;

// ---------- image buffer ----------
function img(w, h, [r, g, b]) {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { px[i * 3] = r; px[i * 3 + 1] = g; px[i * 3 + 2] = b; }
  return { w, h, px };
}
function setPx(im, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const i = (y * im.w + x) * 3;
  im.px[i] = r; im.px[i + 1] = g; im.px[i + 2] = b;
}
function fillRect(im, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(im, x, y, c);
}
function fillCircle(im, cx, cy, r, c) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r * r) setPx(im, x, y, c);
  }
}
// vertical gradient background
function gradient(im, top, bot) {
  for (let y = 0; y < im.h; y++) {
    const t = y / (im.h - 1);
    const c = [0, 1, 2].map(k => Math.round(top[k] + (bot[k] - top[k]) * t));
    for (let x = 0; x < im.w; x++) setPx(im, x, y, c);
  }
}
function textWidth(str, scale) { return str.length * (GW + 1) * scale - scale; }
function drawText(im, str, x, y, scale, c) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = F[ch] || F[' '];
    for (let ry = 0; ry < GH; ry++) for (let rx = 0; rx < GW; rx++) {
      if (g[ry][rx] === '#') fillRect(im, cx + rx * scale, y + ry * scale, scale, scale, c);
    }
    cx += (GW + 1) * scale;
  }
}
function drawCentered(im, str, y, scale, c) {
  drawText(im, str, Math.round((im.w - textWidth(str, scale)) / 2), y, scale, c);
}

// ---------- PNG encode (truecolor RGB) ----------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(im) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(im.w, 0); ihdr.writeUInt32BE(im.h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type 2 = truecolor RGB (no alpha)
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(im.h * (1 + im.w * 3));
  for (let y = 0; y < im.h; y++) {
    raw[y * (1 + im.w * 3)] = 0;
    im.px.copy(raw, y * (1 + im.w * 3) + 1, y * im.w * 3, (y + 1) * im.w * 3);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- colors ----------
const NAVY = [0, 26, 77];      // #001a4d
const BLUE = [0, 51, 166];     // #0033a6
const BRIGHT = [31, 100, 255]; // #1f64ff
const BASEBLUE = [0, 82, 255]; // #0052ff
const TOAD = [46, 194, 87];    // green
const GOLD = [255, 216, 74];
const WHITE = [238, 244, 255];

// simple Toby toad mark centered at (cx, cy) with body radius r
function drawToad(im, cx, cy, r) {
  fillCircle(im, cx, cy, r, TOAD);                                  // body
  fillCircle(im, cx - Math.round(r * 0.5), cy - Math.round(r * 0.7), Math.round(r * 0.34), TOAD); // eye bump L
  fillCircle(im, cx + Math.round(r * 0.5), cy - Math.round(r * 0.7), Math.round(r * 0.34), TOAD); // eye bump R
  fillCircle(im, cx - Math.round(r * 0.5), cy - Math.round(r * 0.7), Math.round(r * 0.18), WHITE);
  fillCircle(im, cx + Math.round(r * 0.5), cy - Math.round(r * 0.7), Math.round(r * 0.18), WHITE);
  fillCircle(im, cx - Math.round(r * 0.5), cy - Math.round(r * 0.7), Math.round(r * 0.08), NAVY);
  fillCircle(im, cx + Math.round(r * 0.5), cy - Math.round(r * 0.7), Math.round(r * 0.08), NAVY);
  fillRect(im, cx - Math.round(r * 0.45), cy + Math.round(r * 0.25), Math.round(r * 0.9), Math.max(2, Math.round(r * 0.08)), NAVY); // smile
}

// ---------- icon.png 1024x1024 ----------
{
  const im = img(1024, 1024, BLUE);
  fillRect(im, 0, 0, 1024, 1024, BLUE);
  fillCircle(im, 512, 470, 360, BRIGHT);
  drawToad(im, 512, 460, 250);
  drawCentered(im, 'HOPPY TOADS', 830, 18, WHITE);
  writeFileSync(join(OUT, 'icon.png'), encodePNG(im));
  console.log('wrote public/icon.png (1024x1024)');
}

// ---------- splash.png 1024x1024 ----------
{
  const im = img(1024, 1024, NAVY);
  gradient(im, BRIGHT, NAVY);
  drawToad(im, 512, 420, 180);
  drawCentered(im, 'HOPPY TOADS', 660, 20, WHITE);
  drawCentered(im, 'TOBYWORLD ON BASE', 760, 8, GOLD);
  writeFileSync(join(OUT, 'splash.png'), encodePNG(im));
  console.log('wrote public/splash.png (1024x1024)');
}

// ---------- hero.png 1200x630 ----------
{
  const im = img(1200, 630, NAVY);
  gradient(im, BRIGHT, BLUE);
  drawToad(im, 200, 300, 140);
  drawText(im, 'HOPPY TOADS', 400, 180, 9, WHITE);
  drawText(im, 'TOBYWORLD ON BASE', 400, 300, 6, GOLD);
  drawText(im, 'PATIENCE, TOBY.', 400, 380, 6, WHITE);
  fillRect(im, 0, 600, 1200, 30, BASEBLUE);
  writeFileSync(join(OUT, 'hero.png'), encodePNG(im));
  console.log('wrote public/hero.png (1200x630)');
}
