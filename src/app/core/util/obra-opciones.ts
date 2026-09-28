import { ObraProyecto } from '../models/obra.model';
import { I18nService } from '../i18n/i18n.service';
import { SelectOption } from '../../shared/ui/select-list/select-list';

/**
 * CA2 — convierte las obras en opciones de selector, poniendo "Mis obras" (es_mia)
 * primero y "Otras obras" debajo (plegable en el selector) para quien ve todas. Si el
 * usuario solo ve las suyas —o solo ve ajenas, como un gerente que no es responsable
 * de ninguna— la lista va PLANA (sin encabezados): agrupar solo aporta cuando hay
 * mezcla de propias y ajenas. Compartida por la pantalla "Mi obra" y "Mi proyecto".
 */
export function obrasComoOpciones(obras: ObraProyecto[], i18n: I18nService): SelectOption[] {
  const hayMias = obras.some((o) => o.es_mia !== false);
  const hayOtras = obras.some((o) => o.es_mia === false);
  const mixto = hayMias && hayOtras;
  const misLabel = i18n.t('Mis obras');
  const otrasLabel = i18n.t('Otras obras');
  return [...obras]
    // Mías primero (es_mia !== false), ajenas después; orden estable dentro de cada grupo.
    .sort((a, b) => Number(b.es_mia !== false) - Number(a.es_mia !== false))
    .map((o) => ({
      id: o.id,
      label: o.nombre,
      group: mixto ? (o.es_mia === false ? otrasLabel : misLabel) : undefined,
    }));
}
