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

const VALID_PLANS = ['core', 'brand', 'premium', 'white']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ── GET: returnează lista de clinici cu status branding ─────────────
  if (req.method === 'GET') {
    const secret = new URL(req.url).searchParams.get('s') || ''
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return json({ error: 'Acces interzis' }, 403)

    const [clinicsRes, brandingRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/clinici?select=id,nume,plan,email&order=plan.asc,nume.asc`, { headers: SB }),
      fetch(`${SUPABASE_URL}/rest/v1/clinic_branding?select=clinic_id,status,modificari_luna,reset_modificari_date,submitted_at,approved_at`, { headers: SB }),
    ])

    const clinics  = await clinicsRes.json()
    const branding = await brandingRes.json()

    const brandMap: Record<string, unknown> = {}
    if (Array.isArray(branding)) {
      for (const b of branding) brandMap[(b as Record<string,string>).clinic_id] = b
    }

    const result = Array.isArray(clinics)
      ? clinics.map((c: Record<string, unknown>) => ({ ...c, branding: brandMap[c.id as string] || null }))
      : []

    return json(result)
  }

  // ── POST: acțiuni admin ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const { s, action, clinic_id, plan } = body

    if (!ADMIN_SECRET || s !== ADMIN_SECRET) return json({ error: 'Acces interzis' }, 403)

    // set_plan
    if (action === 'set_plan') {
      if (!clinic_id || !plan)        return json({ error: 'clinic_id și plan obligatorii' }, 400)
      if (!VALID_PLANS.includes(plan)) return json({ error: 'Plan invalid' }, 400)

      await fetch(`${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(clinic_id)}`, {
        method: 'PATCH', headers: SB_MIN,
        body: JSON.stringify({ plan }),
      })
      return json({ success: true })
    }

    // generate_token
    if (action === 'generate_token') {
      if (!clinic_id) return json({ error: 'clinic_id obligatoriu' }, 400)

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

      const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString()
      const tokRes = await fetch(`${SUPABASE_URL}/rest/v1/tema_tokens`, {
        method: 'POST', headers: SB_POST,
        body: JSON.stringify({ clinic_id, expires_at: expiresAt }),
      })
      if (!tokRes.ok) return json({ error: 'DB error: ' + await tokRes.text() }, 500)

      const toks = await tokRes.json()
      const tok  = Array.isArray(toks) ? toks[0] : toks
      const url  = `${SITE}/setup.html?t=${encodeURIComponent(tok.token)}`

      return json({ url, token: tok.token, clinic_name: clinic.nume, plan: clinic.plan, expires_at: expiresAt })
    }

    return json({ error: 'Acțiune necunoscută' }, 400)
  }

  return json({ error: 'Method not allowed' }, 405)
})
