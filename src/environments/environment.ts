export const environment = {
  production: false,
  version: '1.9.1',
  // Canonical public URL used to build auth-email links (password reset) so
  // they always point at the live PWA — never at a local dev origin
  // (SGC hard-rule #5).
  appUrl: 'https://app.sgcconstructorasd.com',
  // Same Supabase project as SGC web (schema `sgc`, same users/roles/RLS).
  supabaseUrl: 'https://jeeqhgccqefbqilntcpu.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplZXFoZ2NjcWVmYnFpbG50Y3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDI4OTEsImV4cCI6MjA5ODExODg5MX0.YMJQXxZUVZUBMh2TnIAz_0XGgpWEid-JQHbIAyoFqDs',
};
