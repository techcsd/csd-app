// DX4 — `functions.invoke` NO rechaza la promesa cuando la edge falla: devuelve `{ data, error }`.
// El patrón `.invoke(...).catch(() => {})` era código muerto y los fallos del correo de
// requisiciones eran 100 % silenciosos. Esta función clasifica el resultado de verdad.
export type ResultadoNotificar =
  | { estado: 'enviado' }
  | { estado: 'omitido'; motivo: string } // `data.skipped` es legítimo (sin destinatarios, sin clave…)
  | { estado: 'fallo'; motivo: string };

export function evaluarRespuestaNotificar(res: { data?: unknown; error?: unknown } | null | undefined): ResultadoNotificar {
  if (!res) return { estado: 'fallo', motivo: 'sin respuesta' };
  if (res.error) {
    const e = res.error as { message?: string };
    return { estado: 'fallo', motivo: e?.message || String(res.error) };
  }
  const d = (res.data ?? {}) as { error?: unknown; skipped?: unknown };
  if (d.error) return { estado: 'fallo', motivo: typeof d.error === 'string' ? d.error : JSON.stringify(d.error) };
  if (d.skipped) return { estado: 'omitido', motivo: typeof d.skipped === 'string' ? d.skipped : 'omitido' };
  return { estado: 'enviado' };
}
