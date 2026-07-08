/**
 * Generate the CSD App icon set from inline SVG:
 *  - assets/{icon,icon-foreground,icon-background}.png  (for @capacitor/assets → Android)
 *  - public/icons/icon-*.png                            (PWA manifest sizes)
 *  - public/favicon.png                                 (browser tab)
 *
 * Run: node scripts/gen-icons.mjs  (then: npx @capacitor/assets generate --android)
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const NAVY = '#1e3a5f';
const ORANGE = '#f97316';

// Full-bleed icon (navy bg + white "CSD" monogram + orange bar).
const iconSvg = (bg) => `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${bg ? `<rect width="1024" height="1024" rx="205" fill="${NAVY}"/>` : ''}
  <g font-family="Arial, Helvetica, sans-serif" font-weight="800" text-anchor="middle">
    <text x="512" y="500" font-size="300" fill="#ffffff" letter-spacing="6">CSD</text>
  </g>
  <rect x="322" y="600" width="380" height="46" rx="23" fill="${ORANGE}"/>
  <path d="M512 690 l70 0 a70 70 0 0 1 -140 0 z" fill="${ORANGE}" opacity="0"/>
</svg>`;

// Adaptive foreground: transparent, content kept inside the ~66% safe zone.
const foregroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g font-family="Arial, Helvetica, sans-serif" font-weight="800" text-anchor="middle">
    <text x="512" y="500" font-size="230" fill="#ffffff" letter-spacing="4">CSD</text>
  </g>
  <rect x="366" y="560" width="292" height="38" rx="19" fill="${ORANGE}"/>
</svg>`;

const backgroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${NAVY}"/></svg>`;

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

mkdirSync('assets', { recursive: true });
mkdirSync('public/icons', { recursive: true });

// Source images for @capacitor/assets (Android).
await sharp(Buffer.from(iconSvg(true))).resize(1024, 1024).png().toFile('assets/icon.png');
await sharp(Buffer.from(foregroundSvg)).resize(1024, 1024).png().toFile('assets/icon-foreground.png');
await sharp(Buffer.from(backgroundSvg)).resize(1024, 1024).png().toFile('assets/icon-background.png');

// PWA manifest icons.
for (const s of [72, 96, 128, 144, 152, 192, 384, 512]) {
  await sharp(await png(iconSvg(true), s)).toFile(`public/icons/icon-${s}x${s}.png`);
}
await sharp(await png(iconSvg(true), 64)).toFile('public/favicon.png');

console.log('✓ icons generated (assets/ + public/icons/ + favicon.png)');
