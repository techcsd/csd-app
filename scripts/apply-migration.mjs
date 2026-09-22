/**
 * BU1 F3.1 — RETIRADO en el hijo (regla 11 / AU1).
 *
 * El hijo (app móvil) ya NO aplica DDL directo. Los SQL del hijo se dejan en
 * `sql-para-sgc/` y **los aplica el PADRE (SGC)** con su ledger y `--env`:
 *
 *   # en el repo del padre (C:\Users\xavie\Desktop\X Dev\dev\SGC)
 *   node scripts/apply-migration.mjs sql/<archivo>.sql --env dev     # probar en dev
 *   node scripts/apply-migration.mjs sql/<archivo>.sql --env prod --yes   # con OK (exige ledger dev)
 *
 * Así se cumple la regla 18 (nada llega a prod sin pasar por dev + ledger) y no
 * hay dos caminos de DDL. Este wrapper solo lo recuerda y sale con error.
 */
console.error(
  '\n🔴 apply-migration.mjs está RETIRADO en el hijo (BU1 F3.1).\n' +
    '   Deja el SQL en sql-para-sgc/ y aplícalo desde el PADRE (SGC) con --env dev|prod\n' +
    '   (su ledger gatea prod). Ver docs/ENTORNOS.md y CLAUDE.md (regla 11 + regla 18).\n',
);
process.exit(1);
