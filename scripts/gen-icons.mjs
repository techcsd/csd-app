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

// BU1 F1/F2 — overlay "DEV": banda naranja diagonal en la esquina inferior derecha,
// para distinguir de un vistazo el icono dev del de prod (PWA + launcher Android).
const devOverlay = `
  <g transform="rotate(-45 800 800)">
    <rect x="470" y="740" width="660" height="150" fill="#f97316"/>
    <text x="800" y="848" font-family="Arial, Helvetica, sans-serif" font-weight="900"
          font-size="120" fill="#ffffff" text-anchor="middle" letter-spacing="8">DEV</text>
  </g>`;
const withDev = (svg) => svg.replace('</svg>', `${devOverlay}</svg>`);

const isDev = process.argv.includes('--dev');

if (!isDev) {
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
} else {
  // ── Iconos DEV (con banda naranja) ──────────────────────────────────────────
  const devIcon = withDev(iconSvg(true));
  const devForeground = withDev(foregroundSvg);

  // PWA dev: public/icons-dev/*.png + favicon-dev.png.
  mkdirSync('public/icons-dev', { recursive: true });
  for (const s of [72, 96, 128, 144, 152, 192, 384, 512]) {
    await sharp(await png(devIcon, s)).toFile(`public/icons-dev/icon-${s}x${s}.png`);
  }
  await sharp(await png(devIcon, 64)).toFile('public/favicon-dev.png');

  // Android launcher dev: src/dev/res/mipmap-*/ic_launcher{,_round,_foreground}.png.
  const DENS = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  const FG = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 }; // foreground = 108dp
  for (const [d, size] of Object.entries(DENS)) {
    const dir = `android/app/src/dev/res/mipmap-${d}`;
    mkdirSync(dir, { recursive: true });
    await sharp(await png(devIcon, size)).toFile(`${dir}/ic_launcher.png`);
    await sharp(await png(devIcon, size)).png().toFile(`${dir}/ic_launcher_round.png`);
    await sharp(await png(devForeground, FG[d])).toFile(`${dir}/ic_launcher_foreground.png`);
  }

  console.log('✓ dev icons generated (public/icons-dev/ + favicon-dev.png + android/app/src/dev/res/mipmap-*).');
}
