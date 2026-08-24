// AW3 — parseo numérico a prueba de "dedazos" y del locale dominicano.
//
// En RD el separador de MILES es el punto y el DECIMAL la coma, pero los
// teclados de Android/iOS y `type="number"` mezclan convenciones: una echada de
// "34.118" gal (34 galones con 118 milésimas) se interpretaba como 34118 al
// "perder" el punto decimal — la causa raíz del registro imposible de 34,118 gal.
//
// Este parser respeta lo que el usuario ve, sin depender del locale del equipo:
//   · Si aparecen AMBOS separadores, el ÚLTIMO es el decimal y el otro, de miles.
//   · Un mismo separador REPETIDO (1.234.567) es de miles → entero.
//   · Un separador ÚNICO:
//       - modo 'decimal' (galones/lecturas): SIEMPRE decimal → "34.118" = 34.118.
//       - modo 'monto' (pesos enteros): con EXACTAMENTE 3 dígitos detrás es de
//         miles ("10.000" = 10000); si no, decimal ("10.5" = 10.5).
// El servidor sigue siendo la última palabra (valida y bloquea igual).

export type NumeroModo = 'decimal' | 'monto';

export function parseNumeroFlexible(
  raw: string | number | null | undefined,
  modo: NumeroModo = 'decimal',
): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = raw.trim();
  if (!s) return null;
  const neg = /^-/.test(s);
  // Deja solo dígitos y separadores; descarta espacios, RD$, letras, etc.
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let norm: string;

  if (dots && commas) {
    // Ambos presentes: el último en aparecer es el decimal; el otro, de miles.
    const decSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    norm = s.split(thouSep).join('').replace(decSep, '.');
  } else if (dots || commas) {
    const sep = dots ? '.' : ',';
    const count = dots || commas;
    const parts = s.split(sep);
    if (count > 1) {
      norm = parts.join(''); // separador repetido = miles → entero
    } else {
      const decimals = parts[1] ?? '';
      const esMiles = modo === 'monto' && decimals.length === 3;
      norm = esMiles ? parts.join('') : parts.join('.');
    }
  } else {
    norm = s;
  }

  const n = parseFloat(norm);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}
