import { routes } from './app.routes';

// Smoke test that stays green without booting the full DI graph (Dexie/IndexedDB
// isn't available under jsdom). Real flow tests live per-feature.
describe('app routes', () => {
  it('defines the auth + home entry points', () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('auth/login');
    expect(paths).toContain('home');
  });

  it('gates every field module route with guards', () => {
    for (const p of ['bitacora', 'transporte', 'inventario', 'solicitudes']) {
      const route = routes.find((r) => r.path === p);
      expect(route?.canActivate?.length).toBeGreaterThanOrEqual(3);
    }
  });
});
