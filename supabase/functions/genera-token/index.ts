const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_SECRET     = Deno.env.get('ADMIN_SECRET') || ''
const SITE             = 'https://www.silleau.com'

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
const SB_MIN  = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
const CORS    = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await req.json().catch(() => ({}))
  const { clinic_id, expires_hours = 168, s } = body

  if (!ADMIN_SECRET || s !== ADMIN_SECRET) return json({ error: 'Acces interzis' }, 403)
  if (!clinic_id) return json({ error: 'clinic_id lipsă' }, 400)

  const clinicRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(clinic_id)}&select=id,nume,plan`,
    { headers: SB }
  )
  const clinics = await clinicRes.json()
  const clinic  = Array.isArray(clinics) ? clinics[0] : null
  if (!clinic) return json({ error: 'Clinica negăsită' }, 404)
  if (clinic.plan === 'core') return json({ error: 'Planul CORE nu include configuratorul' }, 400)

  // Invalidează tokenele vechi nefolosite
  await fetch(
    `${SUPABASE_URL}/rest/v1/tema_tokens?clinic_id=eq.${encodeURIComponent(clinic_id)}&used_at=is.null&invalidated_at=is.null`,
    { method: 'PATCH', headers: SB_MIN, body: JSON.stringify({ invalidated_at: new Date().toISOString() }) }
  )

  const expiresAt = new Date(Date.now() + Number(expires_hours) * 3_600_000).toISOString()

  const tokRes = await fetch(`${SUPABASE_URL}/rest/v1/tema_tokens`, {
    method: 'POST', headers: SB_POST,
    body: JSON.stringify({ clinic_id, expires_at: expiresAt }),
  })
  if (!tokRes.ok) return json({ error: 'DB error: ' + await tokRes.text() }, 500)

  const toks = await tokRes.json()
  const tok  = Array.isArray(toks) ? toks[0] : toks
  const url  = `${SITE}/setup.html?t=${encodeURIComponent(tok.token)}`

  return json({ url, token: tok.token, clinic_name: clinic.nume, plan: clinic.plan, expires_at: expiresAt })
})
