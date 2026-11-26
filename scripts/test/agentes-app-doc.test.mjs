// Verifica que docs/AGENTES-APP.md refleje el estado real del carril de agentes (activo en dev desde 2026-11-26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = readFileSync(new URL('../../docs/AGENTES-APP.md', import.meta.url), 'utf8');

test('AGENTES-APP.md no dice que el carril está inerte', () => {
  assert.doesNotMatch(doc, /INERTE/);
  assert.match(doc, /activo en dev/);
});

test('AGENTES-APP.md registra corridas reales y lo que falta verificar', () => {
  assert.doesNotMatch(doc, /ninguna corrida real/);
  assert.match(doc, /corridas reales/);
  assert.match(doc, /Falta verificar/);
});
