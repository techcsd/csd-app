import { markdownAPlano, previewNota } from './markdown';

describe('markdown — imágenes de notas (EA8)', () => {
  it('reemplaza la sintaxis de imagen por [imagen] en el texto plano', () => {
    const md = 'Antes\n\n![image.png](nota-img:4b19cc4b/abc.png)\n\nDespués';
    const plano = markdownAPlano(md);
    expect(plano).not.toContain('nota-img');
    expect(plano).not.toContain('![');
    expect(plano).toContain('[imagen]');
    expect(plano).toContain('Antes');
    expect(plano).toContain('Después');
  });

  it('no rompe los enlaces normales', () => {
    expect(markdownAPlano('[doc](https://x.dev)')).toBe('doc (https://x.dev)');
  });

  it('previewNota: una línea, sin Markdown crudo y recortada', () => {
    const md = '# Ronda 24112026\n\n![{598D1869-AAAA}](nota-img:u/1.png)\n\n' + 'palabra '.repeat(40);
    const p = previewNota(md, 60);
    expect(p).not.toContain('nota-img');
    expect(p).not.toContain('\n');
    expect(p.startsWith('Ronda 24112026 [imagen] palabra')).toBe(true);
    expect(p.length).toBeLessThanOrEqual(60);
    expect(p.endsWith('…')).toBe(true);
  });

  it('previewNota de nota vacía → cadena vacía', () => {
    expect(previewNota('')).toBe('');
  });
});
