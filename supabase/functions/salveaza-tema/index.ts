const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const STEFAN_EMAIL     = Deno.env.get('STEFAN_EMAIL') || 'stefan@silleau.com'
const ADMIN_SECRET     = Deno.env.get('ADMIN_SECRET') || ''
const SITE             = 'https://www.silleau.com'
const FN_BASE          = Deno.env.get('SUPABASE_URL')!.replace('/rest/v1', '') + '/functions/v1'

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_MIN  = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
const CORS    = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function genToken(len = 32): string {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

const MOD_LIMITS: Record<string, number> = { brand: 3, premium: 5 }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await req.json().catch(() => ({}))
  const { token, branding } = body

  if (!token)    return json({ error: 'token lipsă' }, 400)
  if (!branding) return json({ error: 'branding lipsă' }, 400)

  // Validare token
  const tokRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tema_tokens?token=eq.${encodeURIComponent(token)}&select=*`,
    { headers: SB }
  )
  const toks = await tokRes.json()
  const tok  = Array.isArray(toks) ? toks[0] : null

  if (!tok)               return json({ error: 'token_invalid' }, 400)
  if (tok.used_at)        return json({ error: 'token_folosit' }, 400)
  if (tok.invalidated_at) return json({ error: 'token_invalidat' }, 400)
  if (new Date(tok.expires_at) < new Date()) return json({ error: 'token_expirat' }, 400)

  // Info clinică
  const clinicRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(tok.clinic_id)}&select=id,nume,plan,email`,
    { headers: SB }
  )
  const clinics = await clinicRes.json()
  const clinic  = Array.isArray(clinics) ? clinics[0] : null
  if (!clinic) return json({ error: 'clinica_negasita' }, 404)

  // Verifică limita de modificări
  const limit = MOD_LIMITS[clinic.plan]
  if (limit !== undefined) {
    const cbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clinic_branding?clinic_id=eq.${encodeURIComponent(tok.clinic_id)}&select=modificari_luna,reset_modificari_date`,
      { headers: SB }
    )
    const cbData = await cbRes.json()
    const cb = Array.isArray(cbData) ? cbData[0] : null
    if (cb) {
      const thisMonth  = new Date().toISOString().slice(0, 7)
      const resetMonth = cb.reset_modificari_date ? cb.reset_modificari_date.slice(0, 7) : null
      const modLuna    = resetMonth === thisMonth ? (cb.modificari_luna || 0) : 0
      if (modLuna >= limit) return json({ error: 'limita_modificari', limita: limit }, 429)
    }
  }

  const approvalToken = genToken()

  // Upsert clinic_branding (insert sau update dacă există deja)
  const { nume_afisat, slogan, logo_url, favicon_url, tema, email_templates, hide_silleau, silleau_opacity, layout } = branding
  await fetch(`${SUPABASE_URL}/rest/v1/clinic_branding`, {
    method:  'POST',
    headers: { ...SB, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      clinic_id:       tok.clinic_id,
      status:          'pending_approval',
      nume_afisat:     nume_afisat || null,
      slogan:          slogan || null,
      logo_url:        logo_url || null,
      favicon_url:     favicon_url || null,
      tema:            tema || {},
      email_templates: email_templates || {},
      hide_silleau:    hide_silleau || false,
      silleau_opacity: silleau_opacity ?? 1,
      layout:          layout || {},
      approval_token:  approvalToken,
      submitted_at:    new Date().toISOString(),
    }),
  })

  // Marchează tokenul ca folosit
  await fetch(
    `${SUPABASE_URL}/rest/v1/tema_tokens?token=eq.${encodeURIComponent(token)}`,
    { method: 'PATCH', headers: SB_MIN, body: JSON.stringify({ used_at: new Date().toISOString() }) }
  )

  // Citim modificări pentru email
  const cbCheckRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clinic_branding?clinic_id=eq.${encodeURIComponent(tok.clinic_id)}&select=modificari_luna,reset_modificari_date`,
    { headers: SB }
  )
  const cbCheck = await cbCheckRes.json()
  const cb2 = Array.isArray(cbCheck) ? cbCheck[0] : null
  const thisMonth2  = new Date().toISOString().slice(0, 7)
  const resetMonth2 = cb2?.reset_modificari_date ? cb2.reset_modificari_date.slice(0, 7) : null
  const modLuna2    = resetMonth2 === thisMonth2 ? (cb2?.modificari_luna || 0) : 0

  // Construiește URL-urile pentru email
  const approvalUrl = `${FN_BASE}/aproba-tema?id=${encodeURIComponent(tok.clinic_id)}&t=${encodeURIComponent(approvalToken)}`
  const regenUrl    = ADMIN_SECRET
    ? `${FN_BASE}/regenereaza-token?clinic_id=${encodeURIComponent(tok.clinic_id)}&s=${encodeURIComponent(ADMIN_SECRET)}`
    : null

  const planLabel = ({ core: 'Core', brand: 'Brand', premium: 'Premium', white: 'White' } as Record<string,string>)[clinic.plan] || clinic.plan
  const modText   = limit !== undefined
    ? `<p style="color:#888;font-size:12px;margin:0 0 20px;">Modificări luna aceasta: <strong style="color:#E8E4DC;">${modLuna2 + 1}/${limit}</strong></p>`
    : ''
  const regenBlock = regenUrl
    ? `<div style="margin-top:24px;padding-top:20px;border-top:1px solid #2A2A2A;">
        <p style="font-size:11px;color:#555;margin:0 0 10px;">Clinica nu e mulțumită cu rezultatul?</p>
        <a href="${regenUrl}" style="display:inline-block;background:#1A1A1A;color:#888;padding:10px 20px;text-decoration:none;border-radius:4px;font-size:10px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;border:1px solid #333;">🔑 Generează token nou →</a>
      </div>`
    : ''

  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    'SILLEAU Configurator <noreply@silleau.com>',
      to:      STEFAN_EMAIL,
      subject: `🎨 Temă nouă spre aprobare — ${clinic.nume}`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#111;color:#E8E4DC;padding:32px;border-radius:8px;">
          <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#666;margin-bottom:8px;">SILLEAU Configurator</div>
          <h2 style="font-size:24px;font-weight:300;margin:0 0 8px;">${clinic.nume}</h2>
          <p style="color:#888;font-size:13px;margin:0 0 20px;">Plan: <strong style="color:#E8E4DC;">${planLabel}</strong></p>
          ${modText}
          <a href="${approvalUrl}" style="display:inline-block;background:#E8E4DC;color:#111;padding:14px 28px;text-decoration:none;border-radius:4px;font-size:11px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;margin-bottom:8px;">Aprobă tema →</a>
          ${regenBlock}
          <details style="margin-top:24px;">
            <summary style="cursor:pointer;font-size:11px;color:#555;letter-spacing:.1em;">▸ Vezi JSON branding</summary>
            <pre style="background:#0A0A0A;color:#6A9E6A;padding:16px;border-radius:4px;font-size:11px;overflow:auto;margin-top:12px;">${JSON.stringify(branding, null, 2)}</pre>
          </details>
        </div>
      `,
    }),
  })

  return json({ success: true })
})
