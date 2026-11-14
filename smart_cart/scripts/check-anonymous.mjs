import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!base || !key) throw new Error('Missing public configuration.');
for (const path of ['products?select=id&limit=1', 'shopping_lists?select=id&limit=1', 'rpc/search_product_groups']) {
  const rpc = path.startsWith('rpc/');
  const response = await fetch(`${base}/rest/v1/${path}`, { method: rpc ? 'POST' : 'GET',
    headers: { apikey: key, 'Content-Type': 'application/json' }, ...(rpc ? { body: '{}' } : {}), signal: AbortSignal.timeout(15000) });
  assert.ok([401, 403].includes(response.status), `Guest access unexpectedly allowed: ${response.status}`);
  console.log(`${path.split('?')[0]}: anonymous denied (${response.status})`);
}
