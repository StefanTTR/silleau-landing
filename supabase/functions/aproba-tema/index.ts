const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const SITE             = 'https://www.silleau.com'

const SB       = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_PATCH = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
const CORS     = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const params        = new URL(req.url).searchParams
  const clinicId      = params.get('id') || ''
  const approvalToken = params.get('t')  || ''

  if (!clinicId || !approvalToken) return json({ error: 'Parametri lipsă' }, 400)

  // Citim clinic_branding
  const brandingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clinic_branding?clinic_id=eq.${encodeURIComponent(clinicId)}&select=*`,
    { headers: SB }
  )
  const brandings = await brandingRes.json()
  const branding  = Array.isArray(brandings) ? brandings[0] : null

  if (!branding)                                     return json({ error: 'Nicio aprobare în așteptare' }, 404)
  if (branding.status !== 'pending_approval')        return json({ error: 'Status invalid' }, 400)
  if (branding.approval_token !== approvalToken)     return json({ error: 'Token aprobare invalid' }, 403)

  // Info clinică
  const clinicRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(clinicId)}&select=id,nume,email,plan`,
    { headers: SB }
  )
  const clinics = await clinicRes.json()
  const clinic  = Array.isArray(clinics) ? clinics[0] : null
  if (!clinic) return json({ error: 'Clinica negăsită' }, 404)

  // Reset counter dacă e altă lună
  const thisMonth  = new Date().toISOString().slice(0, 7)
  const resetMonth = branding.reset_modificari_date ? branding.reset_modificari_date.slice(0, 7) : null
  const modCurent  = resetMonth === thisMonth ? (branding.modificari_luna || 0) : 0

  // Actualizează clinic_branding — status approved + increment modificări
  await fetch(`${SUPABASE_URL}/rest/v1/clinic_branding?clinic_id=eq.${encodeURIComponent(clinicId)}`, {
    method:  'PATCH',
    headers: SB_PATCH,
    body:    JSON.stringify({
      status:                'approved',
      approval_token:        null,
      approved_at:           new Date().toISOString(),
      modificari_luna:       modCurent + 1,
      reset_modificari_date: new Date().toISOString().slice(0, 10),
    }),
  })

  // Email confirmare clinică
  if (clinic.email) {
    await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'SILLEAU <noreply@silleau.com>',
        to:      clinic.email,
        subject: `✓ Tema ${clinic.nume} a fost aprobată`,
        html: `
          <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
            <p style="font-size:13px;color:#555;">Bună ziua,</p>
            <p style="font-size:15px;margin:16px 0;">Noua temă pentru <strong>${clinic.nume}</strong> a fost aprobată și este acum activă pe toate paginile pacienților.</p>
            <p style="font-size:13px;color:#555;">Mulțumim pentru colaborare!</p>
            <p style="font-size:11px;color:#999;margin-top:32px;">Echipa SILLEAU</p>
          </div>
        `,
      }),
    }).catch(() => {})
  }

  return Response.redirect(`${SITE}/mesaj.html?tip=confirmat`, 302)
})
