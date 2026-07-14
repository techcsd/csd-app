/**
 * Mirror of sgc.homologar_texto (R18): trim, collapse inner whitespace, and
 * upper-case the first letter of each word. The DB trigger guarantees the final
 * stored value; this is only for immediate feedback in the forms.
 */
export function homologarTexto(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase('es') + w.slice(1) : w))
    .join(' ');
}
