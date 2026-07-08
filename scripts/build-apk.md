# Building & releasing the CSD App APK

The signed release APK is built locally with the JDK bundled in Android Studio
and the Android SDK. No Play Store — direct install.

## One-time setup
- Android Studio installed (provides `jbr` JDK 21 + SDK). Confirm:
  - `JAVA_HOME` → `C:/Program Files/Android/Android Studio/jbr`
  - `ANDROID_HOME` → `C:/Users/<you>/AppData/Local/Android/Sdk`
- Signing keystore: `android/csd-release.keystore` + `android/keystore.properties`
  (both gitignored). **Back these up somewhere safe** — losing the keystore or
  its password means users must uninstall/reinstall to get future updates
  (Deployment doc). The keystore was generated with:
  ```
  keytool -genkeypair -v -keystore csd-release.keystore -alias csd \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Constructora SD, ..."
  ```

## Build a release APK
```bash
cd csd-app
npm run build                 # Angular production build
npx cap sync android          # copy web build into the native project

cd android
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="C:/Users/<you>/AppData/Local/Android/Sdk"
./gradlew assembleRelease --no-daemon
# → android/app/build/outputs/apk/release/app-release.apk  (signed)
```
Verify the signature:
```
"$ANDROID_HOME/build-tools/<ver>/apksigner.bat" verify --print-certs app-release.apk
```

## Publish (internal distribution)
Bump `versionCode`/`versionName` in `android/app/build.gradle`, `VERSION*` in
`scripts/release-apk.mjs`, and `version` in `src/environments/*`. Then:
```bash
node scripts/release-apk.mjs   # uploads APK + version.json to the app-releases bucket
```
The SGC web page **CSD App (móvil)** reads `version.json` and shows the download
link + QR. The app checks `version.json` on sync and can force-update when
`min_version` exceeds the installed version.

## Install on a device
Android: open the download page, tap **Descargar APK**, allow "install from
unknown sources", install. iPhone: open `app.sgcconstructorasd.com` in Safari →
Share → "Añadir a pantalla de inicio" (installable PWA).
