const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SB   = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const token = new URL(req.url).searchParams.get('t') || ''
  if (!token) return json({ valid: false, reason: 'token_lipsa' })

  const tokRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tema_tokens?token=eq.${encodeURIComponent(token)}&select=*`,
    { headers: SB }
  )
  const toks = await tokRes.json()
  const tok  = Array.isArray(toks) ? toks[0] : null

  if (!tok)               return json({ valid: false, reason: 'token_invalid' })
  if (tok.used_at)        return json({ valid: false, reason: 'token_folosit' })
  if (tok.invalidated_at) return json({ valid: false, reason: 'token_invalidat' })
  if (new Date(tok.expires_at) < new Date()) return json({ valid: false, reason: 'token_expirat' })

  const [clinicRes, brandingRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(tok.clinic_id)}&select=id,nume,plan,email`, { headers: SB }),
    fetch(`${SUPABASE_URL}/rest/v1/clinic_branding?clinic_id=eq.${encodeURIComponent(tok.clinic_id)}&select=*`, { headers: SB }),
  ])

  const clinics  = await clinicRes.json()
  const clinic   = Array.isArray(clinics) ? clinics[0] : null
  if (!clinic) return json({ valid: false, reason: 'clinica_negasita' })

  const brandings = await brandingRes.json()
  const branding  = Array.isArray(brandings) ? brandings[0] : null

  // Reset counter dacă e altă lună (doar clinic_branding păstrează contorul acum)
  const thisMonth      = new Date().toISOString().slice(0, 7)
  const resetMonth     = branding?.reset_modificari_date ? branding.reset_modificari_date.slice(0, 7) : null
  const modificariLuna = resetMonth === thisMonth ? (branding?.modificari_luna || 0) : 0

  return json({
    valid:           true,
    clinic_id:       clinic.id,
    clinic_name:     clinic.nume,
    plan:            clinic.plan || 'core',
    tema:            branding?.tema || {},
    branding:        branding
      ? {
          nume_afisat:     branding.nume_afisat,
          slogan:          branding.slogan,
          logo_url:        branding.logo_url,
          favicon_url:     branding.favicon_url,
          email_templates: branding.email_templates,
          hide_silleau:    branding.hide_silleau,
          silleau_opacity: branding.silleau_opacity,
          layout:          branding.layout || {},
          status:          branding.status,
        }
      : null,
    email:           clinic.email || null,
    modificari_luna: modificariLuna,
  })
})
