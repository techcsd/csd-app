import { TecProveedorRow } from '../models/tec-proveedor.model';

/** EA1 — minúsculas sin tildes (espeja `sgc.tec_norm_busqueda` del padre). */
export function normalizarBusqueda(txt: string | null | undefined): string {
  return (txt ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * EA1 — filtro LOCAL de la última lista guardada (lectura offline). Todas las palabras
 * deben aparecer en nombre/servicio/categoría/etiquetas/contacto. Sin conexión no se
 * pueden buscar palabras de trabajos/cotizaciones (eso lo hace la RPC en línea).
 */
export function filtrarProveedoresLocal(rows: TecProveedorRow[], q: string): TecProveedorRow[] {
  const tokens = normalizarBusqueda(q).split(/\s+/).filter((t) => t.length >= 2);
  if (!tokens.length) return rows;
  return rows.filter((r) => {
    const h = normalizarBusqueda(
      [r.nombre, r.nombre_comercial, r.categoria, r.servicio, (r.etiquetas ?? []).join(' '), r.contacto_nombre, r.contacto_correo, r.contacto_telefono]
        .filter(Boolean)
        .join(' '),
    );
    return tokens.every((t) => h.includes(t));
  });
}

function soloDigitos(tel: string | null | undefined): string {
  return (tel ?? '').replace(/\D+/g, '');
}

/** `tel:` para llamar. Devuelve '' si no hay número usable. */
export function telUrl(tel: string | null | undefined): string {
  const d = soloDigitos(tel);
  if (d.length < 7) return '';
  return `tel:${(tel ?? '').trim().startsWith('+') ? '+' : ''}${d}`;
}

/** `https://wa.me/<digitos>`. Número RD de 10 dígitos → antepone el 1 (+1). */
export function whatsappUrl(tel: string | null | undefined): string {
  let d = soloDigitos(tel);
  if (d.length < 7) return '';
  if (d.length === 10) d = `1${d}`;
  return `https://wa.me/${d}`;
}

export function correoUrl(correo: string | null | undefined): string {
  const c = (correo ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? `mailto:${c}` : '';
}
