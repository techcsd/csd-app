// scripts/test/publicar-version.test.mjs — la lógica que marca una versión como vigente (publicada=true).
// fetch simulado: no toca ningún entorno.   node scripts/test/publicar-version.test.mjs
import { publicarVersion } from '../lib/publicar-version.mjs';
import { strict as assert } from 'node:assert';

function fakeApi({ filas = [{ id: 1, apk_url: 'https://x/a.apk', publicada: false }], vigente = '9.9.9', usuarios = [{ id: 'u1' }] } = {}) {
  const llamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET';
    llamadas.push({ method, url: u, body: init.body });
    const json = (b, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.includes('/rpc/version_publicada')) return json({ version_publicada: vigente });
    if (u.includes('/usuarios?')) return json(usuarios);
    if (u.includes('/app_versiones?select=id') ) return json(filas);
    if (u.includes('/app_versiones?') && method === 'PATCH') return json([{ version: '0.0.0' }]);
    return json([]);
  };
  return llamadas;
}
const base = { entorno: 'dev', url: 'https://t.supabase.co', serviceKey: 'k', version: '9.9.9', log: () => {} };
let ok = 0; const caso = async (nombre, fn) => { try { await fn(); ok++; console.log('✓', nombre); } catch (e) { console.error('✗', nombre, '\n  ', e.message); process.exitCode = 1; } };

await caso('dev: despublica la anterior, publica la nueva y verifica version_publicada', async () => {
  const l = fakeApi();
  await publicarVersion(base);
  const patches = l.filter((c) => c.method === 'PATCH');
  assert.equal(patches.length, 2);
  assert.match(patches[0].url, /publicada=eq\.true&version=neq\.9\.9\.9/);
  assert.equal(JSON.parse(patches[0].body).publicada, false);
  assert.equal(JSON.parse(patches[1].body).publicada, true);
});

await caso('versión inexistente: falla y NO escribe', async () => {
  const l = fakeApi({ filas: [] });
  await assert.rejects(() => publicarVersion(base), /no existe en app_versiones/);
  assert.equal(l.filter((c) => c.method === 'PATCH').length, 0);
});

await caso('sin apk_url: falla y NO escribe', async () => {
  const l = fakeApi({ filas: [{ id: 1, apk_url: null }] });
  await assert.rejects(() => publicarVersion(base), /no tiene apk_url/);
  assert.equal(l.filter((c) => c.method === 'PATCH').length, 0);
});

await caso('prod sin qa/release-<v>.md con OK válido: falla y NO escribe', async () => {
  const l = fakeApi();
  await assert.rejects(() => publicarVersion({ ...base, entorno: 'prod', version: '9.9.9' }), /no tiene una línea OK válida/);
  assert.equal(l.length, 0);
});

await caso('si version_publicada no coincide tras publicar: falla (no miente "listo")', async () => {
  fakeApi({ vigente: '1.0.0' });
  await assert.rejects(() => publicarVersion(base), /devuelve 1\.0\.0/);
});

await caso('versión con formato inválido se rechaza', async () => {
  fakeApi();
  await assert.rejects(() => publicarVersion({ ...base, version: '2.71' }), /Versión inválida/);
});

console.log(`\n${ok}/6 casos OK`);
