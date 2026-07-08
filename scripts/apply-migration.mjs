/**
 * Apply a .sql migration to the shared SGC Supabase project via the Management
 * API (runs as postgres, so DDL works). Reads SUPABASE_ACCESS_TOKEN from the
 * environment; project ref defaults to the SGC project.
 *
 * Usage: node scripts/apply-migration.mjs sql/<file>.sql
 */
import { readFileSync } from 'node:fs';

const REF = process.env.SUPABASE_PROJECT_REF || 'jeeqhgccqefbqilntcpu';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const file = process.argv[2];

if (!TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN in the environment.');
  process.exit(1);
}
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <path-to.sql>');
  process.exit(1);
}

const query = readFileSync(file, 'utf8');

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`❌ ${res.status} ${res.statusText}\n${text}`);
  process.exit(1);
}
console.log(`✅ Applied ${file}`);
console.log(text.slice(0, 500));
