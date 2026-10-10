/**
 * CL2 — base de movimiento reutilizable de la app (directivas + tokens). Todas son
 * standalone y tree-shakeable: importa solo la que uses, o `MOTION_DIRECTIVES` para el
 * paquete completo. Cada directiva respeta `MotionService.reducido()` (reduce-motion →
 * estado final sin movimiento) y anima solo `transform`/`opacity` con los tokens CJ1.
 *
 * Paridad web (regla 5): mismos ids, mismos tiempos/curvas que el `src/shared/motion`
 * de SGC (ver `core/motion/catalogo-movimiento.ts`).
 */
import { CountUpDirective } from './count-up.directive';
import { EstadoPulseDirective } from './estado-pulse.directive';
import { FadeInDirective } from './fade-in.directive';
import { ShakeDirective } from './shake.directive';
import { StaggerDirective } from './stagger.directive';
import { TabIndicatorDirective } from './tab-indicator.directive';
import { TapScaleDirective } from './tap-scale.directive';
import { WizardStepDirective } from './wizard-step.directive';

export { CountUpDirective } from './count-up.directive';
export { EstadoPulseDirective } from './estado-pulse.directive';
export { FadeInDirective } from './fade-in.directive';
export { ShakeDirective } from './shake.directive';
export { StaggerDirective } from './stagger.directive';
export { TabIndicatorDirective } from './tab-indicator.directive';
export { TapScaleDirective } from './tap-scale.directive';
export { WizardStepDirective } from './wizard-step.directive';
export * from './motion-tokens';

/** Paquete para `imports: [...MOTION_DIRECTIVES]` en un componente standalone. */
export const MOTION_DIRECTIVES = [
  StaggerDirective,
  CountUpDirective,
  FadeInDirective,
  TabIndicatorDirective,
  EstadoPulseDirective,
  WizardStepDirective,
  ShakeDirective,
  TapScaleDirective,
] as const;

/**
 * CL2 — ids de catálogo de cada directiva (selector → id de `movimiento_catalogo`).
 * La prueba unitaria cuadra estos ids con el registro (id-usado ↔ registrado).
 */
export const DIRECTIVE_MOTION_IDS = [
  'lista', // appStagger
  'kpi-countup', // appCountUp
  'skeleton-fade', // appFadeIn
  'tab-indicator', // appTabIndicator
  'estado-pulse', // appEstadoPulse
  'wizard-step', // appWizardStep
  'error-shake', // appShake
  'tap-scale', // appTapScale
] as const;
export type DirectiveMotionId = (typeof DIRECTIVE_MOTION_IDS)[number];
