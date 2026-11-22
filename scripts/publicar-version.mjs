// scripts/publicar-version.mjs — marca una versión móvil ya subida/registrada como la vigente (publicada).
// Útil cuando se corrió `release-apk.mjs --no-publicar` o para corregir/rollback a una versión anterior.
//
//   node scripts/publicar-version.mjs --env dev  --version 2.71.7
//   node scripts/publicar-version.mjs --env prod --version 2.71.7 --yes     (prod exige OK válido en qa/release-<v>.md)
//
// Lógica en scripts/lib/publicar-version.mjs (la misma que usa release-apk.mjs).
import './lib/load-env.mjs';
import { resolverEnv } from './lib/entorno.mjs';
import { publicarVersion } from './lib/publicar-version.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--version');
const version = i === -1 ? '' : argv[i + 1];
if (!version) { console.error('Falta --version X.Y.Z'); process.exit(1); }
const env = await resolverEnv(argv);
try {
  await publicarVersion({ entorno: env.entorno, url: env.url, serviceKey: env.serviceKey, version });
} catch (e) {
  console.error('✗ ' + (e instanceof Error ? e.message : e));
  process.exit(1);
}
