import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/app-db';
import { I18nService } from '../i18n/i18n.service';
import { SyncService } from '../sync/sync.service';
import { ErrorReportService } from './error-report.service';
import { NavGuardService } from './nav-guard.service';
import { ToastService } from './toast.service';
import { UpdateService } from './update.service';

// DT6 — la auto-reparación (chunk perdido / SW roto) NUNCA toca IndexedDB: ahí vive el outbox
// (conteos pendientes de Raykler incluidos). Solo desregistra el SW y borra `caches`.
describe('UpdateService.autoRepair — no destruye el outbox (DT6)', () => {
  const unregister = vi.fn(async () => true);
  const cachesDelete = vi.fn(async () => true);
  let service: UpdateService;
  let deleteDatabase: ReturnType<typeof vi.fn>;
  let dexieDelete: ReturnType<typeof vi.spyOn>;
  let outboxClear: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers(); // el reload() real queda en un setTimeout que no se dispara
    sessionStorage.clear();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistrations: async () => [{ unregister }] },
    });
    vi.stubGlobal('caches', { keys: async () => ['ngsw:a', 'ngsw:b'], delete: cachesDelete });
    // el entorno de test no trae IndexedDB: se simula solo para detectar que NO se llame
    const fakeIdb = { deleteDatabase: vi.fn() };
    vi.stubGlobal('indexedDB', fakeIdb);
    deleteDatabase = fakeIdb.deleteDatabase;
    dexieDelete = vi.spyOn(db, 'delete');
    outboxClear = vi.spyOn(db.outbox, 'clear');

    TestBed.configureTestingModule({
      providers: [
        UpdateService,
        { provide: SwUpdate, useValue: { isEnabled: false } },
        { provide: ToastService, useValue: { show: vi.fn() } },
        { provide: NavGuardService, useValue: { formActivo: false } },
        { provide: SyncService, useValue: { syncing: () => false } },
        { provide: Router, useValue: { events: EMPTY } },
        { provide: ErrorReportService, useValue: { report: vi.fn(async () => undefined) } },
        { provide: I18nService, useValue: { t: (s: string) => s } },
      ],
    });
    service = TestBed.inject(UpdateService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    unregister.mockClear();
    cachesDelete.mockClear();
  });

  it('chunk_perdido: desregistra el SW y borra caches, sin borrar IndexedDB ni vaciar el outbox', async () => {
    await service.autoRepair('chunk_perdido');
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(cachesDelete).toHaveBeenCalledTimes(2);
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(dexieDelete).not.toHaveBeenCalled();
    expect(outboxClear).not.toHaveBeenCalled();
  });

  it('"Reparar la app" manual tampoco toca IndexedDB', async () => {
    await service.reparar();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(dexieDelete).not.toHaveBeenCalled();
    expect(outboxClear).not.toHaveBeenCalled();
  });
});
