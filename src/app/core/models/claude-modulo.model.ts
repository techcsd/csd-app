/** DM1 (ronda DM, PROMPT 140/141) — módulo Claude: biblioteca de skills por rol,
 *  paquetes de arranque, progreso del Setup y encuesta de auditoría. */

export type ClaudeSkillTipo = 'skill' | 'instrucciones' | 'plantilla' | 'documento';
export type ClaudeSkillAmbito = 'personal' | 'rol' | 'empresa';
export type ClaudeSkillEstado = 'borrador' | 'propuesta' | 'publicada' | 'archivada' | 'requiere_revision';

export interface ClaudeSkill {
  id: string;
  slug: string;
  nombre: string;
  descripcion: string;
  tipo: ClaudeSkillTipo;
  ambito: ClaudeSkillAmbito;
  estado: ClaudeSkillEstado;
  roles: string[];
  tags: string[];
  owner_id: string;
  version_actual: number;
  tiene_codigo_ejecutable: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClaudePack {
  id: string;
  slug: string;
  nombre: string;
  descripcion: string | null;
  tipo: 'setup' | 'rol' | 'personalizado';
  rol: string | null;
}

export interface ClaudeProgreso {
  conecto_sgc: boolean;
  descargo_setup: boolean;
  subio_primera_skill: boolean;
  probo_pregunta: boolean;
}

export interface ClaudeEncuestaRespuesta {
  usa_hoy: string | null;
  tareas: string | null;
  tarea_repetida: string | null;
  que_frena: string | null;
  documento_semanal: string | null;
  que_deberia_hacer: string | null;
  updated_at?: string;
}

/** Campo del formulario guiado "Crear" — se combinan en el SKILL.md generado. */
export interface ClaudeSkillBorrador {
  titulo: string;
  queHace: string;
  cuandoUsarla: string;
  pasos: string;
  ejemplo: string;
}
