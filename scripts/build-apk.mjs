/**
 * V5 — one-command signed release build.
 *   npm run apk
 * Runs: Angular prod build → cap sync android → gradlew assembleRelease (signed
 * with the stable keystore in android/keystore.properties) → prints the APK path
 * and its certificate so you can confirm it matches production before publishing.
 *
 * Requires (see scripts/build-apk.md):
 *   JAVA_HOME   → Android Studio JBR (JDK 21)   [auto-detected if unset]
 *   ANDROID_HOME→ Android SDK                    [auto-detected if unset]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const isWin = process.platform === 'win32';

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p));
}

const JAVA_HOME =
  process.env.JAVA_HOME ||
  firstExisting([
    'C:/Program Files/Android/Android Studio/jbr',
    'C:/Program Files/Android/Android Studio1/jbr',
  ]);
const ANDROID_HOME =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  firstExisting([
    `${process.env.LOCALAPPDATA || ''}/Android/Sdk`,
    `${process.env.HOME || process.env.USERPROFILE || ''}/AppData/Local/Android/Sdk`,
  ]);

if (!JAVA_HOME) {
  console.error('✗ JAVA_HOME not set and Android Studio JBR not found. See scripts/build-apk.md.');
  process.exit(1);
}
if (!ANDROID_HOME) {
  console.error('✗ ANDROID_HOME not set and Android SDK not found. See scripts/build-apk.md.');
  process.exit(1);
}

const env = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME };

function run(cmd, args, opts = {}) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', env, shell: isWin, ...opts });
  if (res.status !== 0) {
    console.error(`✗ command failed (${res.status}): ${cmd} ${args.join(' ')}`);
    process.exit(res.status || 1);
  }
}

run('npx', ['ng', 'build']);
run('npx', ['cap', 'sync', 'android']);

// cmd.exe does not search the cwd for executables — prefix with .\ so the
// batch launcher in android/ is found (works with spaces in the repo path).
const gradlew = isWin ? '.\\gradlew.bat' : './gradlew';
run(gradlew, ['assembleRelease', '--no-daemon'], { cwd: 'android' });

const apk = 'android/app/build/outputs/apk/release/app-release.apk';
console.log(`\n✓ Signed APK: ${apk}`);

// Print the signing cert so you can eyeball it matches the production SHA-256
// (3C:53:16:D8:...:65) before publishing — a mismatch would break install-over.
const apksigner = firstExisting([
  ...['36.0.0', '35.0.0', '34.0.0'].map((v) => `${ANDROID_HOME}/build-tools/${v}/apksigner.bat`),
]);
if (apksigner) {
  run(apksigner, ['verify', '--print-certs', apk]);
} else {
  console.log('(apksigner not auto-found; verify manually per scripts/build-apk.md)');
}

console.log('\nNext: node scripts/release-apk.mjs   # publish to the app-releases bucket');
