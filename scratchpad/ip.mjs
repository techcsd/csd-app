const REF=process.env.SUPABASE_PROJECT_REF||'jeeqhgccqefbqilntcpu';const T=process.env.SUPABASE_ACCESS_TOKEN;
async function q(s){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${T}`,'Content-Type':'application/json'},body:JSON.stringify({query:s})});const t=await r.text();return r.ok?JSON.parse(t):{ERR:r.status+t.slice(0,200)};}
const def = await q(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sgc' and proname='conduce_detalle_app'`);
const body = def[0].d;
const i = body.indexOf('detalle');
console.log("mentions detalle_id:", /detalle_id/.test(body), " es_libre:", /es_libre/.test(body), " cantidad:", /cantidad/.test(body), " nombre_libre:", /nombre_libre/.test(body));
// find the items json build
const j = body.search(/jsonb_build_object[^;]*detalle_id|'detalle_id'|"detalle_id"/);
console.log(body.slice(Math.max(0,j-150), j+600));
