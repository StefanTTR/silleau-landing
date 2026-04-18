const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE             = 'https://www.silleau.com'

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
const CORS    = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await req.json().catch(() => ({}))
  const { clinic_id, expires_hours = 168 } = body   // default 7 zile

  if (!clinic_id) return json({ error: 'clinic_id lipsă' }, 400)

  // Verifică că clinica există
  const clinicRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(clinic_id)}&select=id,nume,plan`,
    { headers: SB }
  )
  const clinics = await clinicRes.json()
  const clinic  = Array.isArray(clinics) ? clinics[0] : null
  if (!clinic) return json({ error: 'Clinica negăsită' }, 404)

  const expiresAt = new Date(Date.now() + Number(expires_hours) * 3_600_000).toISOString()

  const tokRes = await fetch(`${SUPABASE_URL}/rest/v1/tema_tokens`, {
    method:  'POST',
    headers: SB_POST,
    body:    JSON.stringify({ clinic_id, expires_at: expiresAt }),
  })
  if (!tokRes.ok) return json({ error: 'DB error: ' + await tokRes.text() }, 500)

  const toks  = await tokRes.json()
  const tok   = Array.isArray(toks) ? toks[0] : toks
  const url   = `${SITE}/configurator.html?t=${encodeURIComponent(tok.token)}`

  return json({ url, token: tok.token, clinic_name: clinic.nume, plan: clinic.plan || 'starter', expires_at: expiresAt })
})
