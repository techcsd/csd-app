/**
 * CI9 — Prepara el proyecto iOS generado por `npx cap add ios` (corre en el runner
 * macOS, DESPUÉS de cap add y ANTES de cap sync). Idempotente:
 *  · Info.plist: textos de permiso en español, UIBackgroundModes, orientación vertical,
 *    ITSAppUsesNonExemptEncryption=NO.
 *  · Copia PrivacyInfo.xcprivacy y fastlane/Fastfile desde ios-templates/.
 *
 * UNTESTED hasta que exista el proyecto iOS (requiere cuenta Apple). Usa `plutil`
 * (solo macOS). No se ejecuta en el build de Windows/Vercel.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

const PLIST = 'ios/App/App/Info.plist';
if (!existsSync(PLIST)) {
  console.error(`✗ No existe ${PLIST}. ¿Corriste 'npx cap add ios' antes?`);
  process.exit(1);
}

function set(key, type, value) {
  // -replace falla si la clave no existe → intenta insert primero.
  try { execSync(`plutil -insert ${key} -${type} "${value}" "${PLIST}"`, { stdio: 'ignore' }); }
  catch { execSync(`plutil -replace ${key} -${type} "${value}" "${PLIST}"`, { stdio: 'inherit' }); }
}

// Textos de permiso (guía Apple 5.1.1(ii): claros, en español).
set('NSCameraUsageDescription', 'string', 'La CSD App usa la cámara para tomar fotos de evidencias de obra, recibos y conduces.');
set('NSMicrophoneUsageDescription', 'string', 'La CSD App usa el micrófono para grabar notas de voz de incidentes.');
set('NSPhotoLibraryUsageDescription', 'string', 'La CSD App accede a tus fotos para adjuntar evidencias desde la galería.');
set('NSPhotoLibraryAddUsageDescription', 'string', 'La CSD App guarda documentos (p. ej. carnets y PDFs) en tus fotos.');
set('NSLocationWhenInUseUsageDescription', 'string', 'La CSD App usa tu ubicación para registrar rutas y validar acciones de transporte.');
set('NSLocationAlwaysAndWhenInUseUsageDescription', 'string', 'La CSD App comparte tu ubicación con Flota durante tu jornada, también en segundo plano, mientras tu estado no sea Inactivo. Se apaga al marcar Inactivo o cerrar sesión.');
set('NSFaceIDUsageDescription', 'string', 'La CSD App usa Face ID para desbloquear la app de forma segura.');
set('ITSAppUsesNonExemptEncryption', 'bool', 'NO');

// UIBackgroundModes = [location, remote-notification]
try { execSync(`plutil -remove UIBackgroundModes "${PLIST}"`, { stdio: 'ignore' }); } catch { /* no existía */ }
execSync(`plutil -insert UIBackgroundModes -array "${PLIST}"`, { stdio: 'inherit' });
execSync(`plutil -insert UIBackgroundModes.0 -string location "${PLIST}"`, { stdio: 'inherit' });
execSync(`plutil -insert UIBackgroundModes.1 -string remote-notification "${PLIST}"`, { stdio: 'inherit' });

// Solo iPhone, vertical.
try { execSync(`plutil -remove UISupportedInterfaceOrientations "${PLIST}"`, { stdio: 'ignore' }); } catch { /* */ }
execSync(`plutil -insert UISupportedInterfaceOrientations -array "${PLIST}"`, { stdio: 'inherit' });
execSync(`plutil -insert UISupportedInterfaceOrientations.0 -string UIInterfaceOrientationPortrait "${PLIST}"`, { stdio: 'inherit' });

// PrivacyInfo.xcprivacy
copyFileSync('ios-templates/PrivacyInfo.xcprivacy', 'ios/App/App/PrivacyInfo.xcprivacy');
console.log('✓ PrivacyInfo.xcprivacy copiado');

// fastlane/Fastfile
mkdirSync('ios/App/fastlane', { recursive: true });
copyFileSync('ios-templates/Fastfile', 'ios/App/fastlane/Fastfile');
console.log('✓ fastlane/Fastfile copiado');

console.log('✓ Info.plist preparado (permisos, background modes, orientación, cifrado).');
