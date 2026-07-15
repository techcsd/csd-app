# Building & releasing the CSD App APK

The signed release APK is built locally with the JDK bundled in Android Studio
and the Android SDK. No Play Store — direct install.

## Signing keystore (V5 — READ THIS)
Every release **must** be signed with the SAME certificate, or Android refuses to
install the new APK over the old one ("app not installed" / signature conflict)
and the user has to uninstall first (losing their offline queue). The stable
keystore lives **outside the repo**:

- Keystore : `C:/Users/xavie/keystores/constructorasd.keystore`
- Alias    : `constructorasd`
- Cert SHA-256 : `3C:53:16:D8:B0:6C:6D:BE:E0:0E:77:BF:3A:37:C5:73:75:B5:9A:5F:17:44:27:03:83:55:0C:D4:04:DF:50:65`
- Passwords: `android/keystore.properties` (gitignored — points Gradle at the
  keystore above). `signingConfigs.release` in `android/app/build.gradle` reads it.

> This is the exact same key/certificate every production build (1.0.x–1.5.0) has
> used — it started life as `android/csd-release.keystore` alias `csd`; only the
> file name and alias were changed (via `keytool -changealias`), so the cert is
> byte-identical and updates keep installing on top. The original
> `android/csd-release.keystore` is kept as a backup source.

**⚠️ BACK UP** `constructorasd.keystore` + `keystore.properties` off this machine
(password manager / cloud / USB). Losing them = no user can ever update again.

**Play Protect note:** consistent signing + `targetSdk 36` + a clean manifest
reduce the "unknown developer / install anyway" warning on *updates*, but a
sideloaded APK can't remove it entirely — only distributing through the Play
Store does. That's a distribution choice, not a code fix.

## One-time setup
- Android Studio installed (provides `jbr` JDK 21 + SDK). Confirm:
  - `JAVA_HOME` → `C:/Program Files/Android/Android Studio/jbr`
  - `ANDROID_HOME` → `C:/Users/<you>/AppData/Local/Android/Sdk`

## Build a signed release APK (one command)
```bash
npm run apk        # ng build → cap sync android → gradlew assembleRelease → prints cert
```
This auto-detects JAVA_HOME/ANDROID_HOME and prints the signing certificate so you
can confirm the SHA-256 matches the one above before publishing.

Manual equivalent:
```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease --no-daemon
# → android/app/build/outputs/apk/release/app-release.apk  (signed)
```

## Publish (internal distribution)
`versionCode` is **auto-derived** from the version name now (major*1e6 + minor*1e3
+ patch), so you only bump the name in two places: `appVersionName` in
`android/app/build.gradle`, `VERSION` in `scripts/release-apk.mjs`, and `version`
in `src/environments/*`. Then:
```bash
npm run apk:publish   # uploads APK + version.json to the app-releases bucket + registers in SGC history
```
The SGC web page **CSD App (móvil)** reads `version.json` and shows the download
link + QR. The app checks `version.json` on sync and can force-update when
`min_version` exceeds the installed version.

## Install on a device
Android: open the download page, tap **Descargar APK**, allow "install from
unknown sources", install. iPhone: open `app.sgcconstructorasd.com` in Safari →
Share → "Añadir a pantalla de inicio" (installable PWA).
