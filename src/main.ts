import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// DU2 — si el arranque revienta, no dejar el teléfono en blanco: el guard inline de
// index.html pinta "No pudimos abrir la app" (Reintentar / Reparar).
bootstrapApplication(App, appConfig).catch((err) => {
  console.error(err);
  const fail = (window as unknown as { __csdBootFail?: (m: string) => void }).__csdBootFail;
  fail?.(String((err && (err as Error).message) || err));
});
