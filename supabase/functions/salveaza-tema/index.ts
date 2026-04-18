const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const STEFAN_EMAIL     = Deno.env.get('STEFAN_EMAIL') || 'stefan@silleau.com'
const SITE             = 'https://www.silleau.com'

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
const CORS    = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function genToken(len = 32): string {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await req.json().catch(() => ({}))
  const { token, tema_draft } = body

  if (!token)      return json({ error: 'token lipsă' }, 400)
  if (!tema_draft) return json({ error: 'tema_draft lipsă' }, 400)

  // Validare token
  const tokRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tema_tokens?token=eq.${encodeURIComponent(token)}&select=*`,
    { headers: SB }
  )
  const toks = await tokRes.json()
  const tok  = Array.isArray(toks) ? toks[0] : null

  if (!tok)        return json({ error: 'token_invalid' }, 400)
  if (tok.used_at) return json({ error: 'token_folosit' }, 400)
  if (new Date(tok.expires_at) < new Date()) return json({ error: 'token_expirat' }, 400)

  // Info clinică
  const clinicRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(tok.clinic_id)}&select=id,nume,plan,email,modificari_luna,reset_modificari_date`,
    { headers: SB }
  )
  const clinics = await clinicRes.json()
  const clinic  = Array.isArray(clinics) ? clinics[0] : null
  if (!clinic) return json({ error: 'clinica_negasita' }, 404)

  const approvalToken = genToken()

  // Salvează draft + approval token
  await fetch(
    `${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(tok.clinic_id)}`,
    { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ tema_draft, approval_token: approvalToken }) }
  )

  // Marchează tokenul ca folosit
  await fetch(
    `${SUPABASE_URL}/rest/v1/tema_tokens?token=eq.${encodeURIComponent(token)}`,
    { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ used_at: new Date().toISOString() }) }
  )

  // Calcul modificări lună curentă
  const thisMonth  = new Date().toISOString().slice(0, 7)
  const resetMonth = clinic.reset_modificari_date ? clinic.reset_modificari_date.slice(0, 7) : null
  const modLuna    = resetMonth === thisMonth ? (clinic.modificari_luna || 0) : 0

  // Email notificare Stefan
  const approvalUrl  = `${SITE}/aproba-tema.html?id=${encodeURIComponent(tok.clinic_id)}&t=${encodeURIComponent(approvalToken)}`
  const planLabel    = { starter: 'Starter', pro: 'Pro', white_label: 'White Label' }[clinic.plan as string] || clinic.plan
  const modText      = clinic.plan === 'white_label' ? `<p style="color:#888;font-size:12px;">Modificări luna aceasta: <strong>${modLuna + 1}/3</strong></p>` : ''

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
          <p style="color:#888;font-size:13px;margin:0 0 24px;">Plan: <strong style="color:#E8E4DC;">${planLabel}</strong></p>
          ${modText}
          <a href="${approvalUrl}" style="display:inline-block;background:#E8E4DC;color:#111;padding:14px 28px;text-decoration:none;border-radius:4px;font-size:11px;font-weight:500;letter-spacing:.15em;text-transform:uppercase;margin-bottom:24px;">Aprobă tema →</a>
          <details style="margin-top:16px;">
            <summary style="cursor:pointer;font-size:11px;color:#666;letter-spacing:.1em;">Vezi JSON temă</summary>
            <pre style="background:#0A0A0A;color:#6A9E6A;padding:16px;border-radius:4px;font-size:11px;overflow:auto;margin-top:12px;">${JSON.stringify(tema_draft, null, 2)}</pre>
          </details>
          <p style="font-size:11px;color:#444;margin-top:24px;">Link direct: ${approvalUrl}</p>
        </div>
      `,
    }),
  })

  return json({ success: true })
})
