import { ClaudeSkillBorrador } from '../models/claude-modulo.model';

/**
 * DM1/DM-09 — genera un slug válido para `sgc.claude_skills.slug`
 * (`^[a-z0-9-]{1,64}$`, sin "claude"/"anthropic"): minúsculas, guiones, sin las
 * palabras reservadas (el check de la BD las prohíbe por completo, no solo como
 * palabra exacta — se quitan como substring).
 */
export function generarSlug(titulo: string): string {
  const base = titulo
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // quita acentos (combining marks tras normalize('NFD'))
    .toLowerCase()
    .replace(/claude|anthropic/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return base || 'mi-skill';
}

/** DM-05 — descripción sin tags XML (`<`/`>`), máx. 1024 caracteres. */
export function limpiarDescripcion(texto: string): string {
  return texto.replace(/[<>]/g, '').trim().slice(0, 1024);
}

/**
 * DM-09 — arma el `SKILL.md` (frontmatter + cuerpo) a partir del formulario
 * guiado "Qué hace · Cuándo usarla · Pasos · Ejemplo". El frontmatter sigue el
 * formato vigente de Claude releído en F0 (ver docs/CLAUDE-MODULO.md): `name`
 * (slug) + `description` (qué hace + cuándo usarla, en una sola frase).
 */
export function generarSkillMd(slug: string, b: ClaudeSkillBorrador): string {
  const descripcion = limpiarDescripcion(`${b.queHace.trim()} Úsala cuando ${b.cuandoUsarla.trim()}`);
  const frontmatter = ['---', `name: ${slug}`, `description: ${descripcion.replace(/\n/g, ' ')}`, '---', ''].join('\n');
  const cuerpo = [
    `# ${b.titulo.trim()}`,
    '',
    '## Qué hace',
    b.queHace.trim(),
    '',
    '## Cuándo usarla',
    b.cuandoUsarla.trim(),
    '',
    '## Pasos',
    b.pasos.trim(),
    '',
    '## Ejemplo',
    b.ejemplo.trim(),
    '',
  ].join('\n');
  return frontmatter + '\n' + cuerpo;
}
