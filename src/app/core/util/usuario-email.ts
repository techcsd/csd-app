import { formatCedula } from './cedula';

/**
 * BH4 — Correos sintéticos del acceso por cédula. El alta sin correo genera un email
 * técnico que ES el identificador de Supabase Auth (cap-<cedula>@personal…,
 * c-<cedula>@conductores…, t-<n>@test…). Ese correo NUNCA debe verse en pantalla:
 * donde la app muestre "correo", enseña la cédula (o "Usuario de prueba").
 * Mismo criterio que la web (PROMPT-30 FASE 4).
 */
const SYNTH = /@(?:personal|conductores|test)\.constructorasd\.local$/i;

export function esEmailSintetico(email: string | null | undefined): boolean {
  return !!email && SYNTH.test(email);
}

/**
 * Texto a mostrar en lugar de un correo. Si es sintético: la cédula formateada
 * (extraída del local-part `cap-<cedula>` / `c-<cedula>`), "Usuario de prueba" para
 * el dominio de test, o "Acceso por cédula" si no se puede extraer. Si es un correo
 * real, lo devuelve tal cual. Null si no hay correo.
 */
export function emailParaMostrar(email: string | null | undefined): string | null {
  if (!email) return null;
  if (!SYNTH.test(email)) return email;
  if (/@test\./i.test(email)) return 'Usuario de prueba';
  const local = email.split('@')[0] ?? '';
  const m = local.match(/(\d{6,})/); // cap-00112345678 / c-00112345678 → dígitos = cédula
  if (m) return `Cédula ${formatCedula(m[1])}`;
  return 'Acceso por cédula';
}
