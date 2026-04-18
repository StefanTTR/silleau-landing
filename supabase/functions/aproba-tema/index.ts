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

  const clinicRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(clinicId)}&select=id,nume,email,plan,tema_draft,approval_token,modificari_luna,reset_modificari_date`,
    { headers: SB }
  )
  const clinics = await clinicRes.json()
  const clinic  = Array.isArray(clinics) ? clinics[0] : null

  if (!clinic)                                         return json({ error: 'Clinica negăsită' }, 404)
  if (!clinic.approval_token)                          return json({ error: 'Nicio aprobare în așteptare' }, 400)
  if (clinic.approval_token !== approvalToken)         return json({ error: 'Token aprobare invalid' }, 403)
  if (!clinic.tema_draft)                              return json({ error: 'Draft lipsă' }, 400)

  // Reset counter dacă e altă lună
  const thisMonth  = new Date().toISOString().slice(0, 7)
  const resetMonth = clinic.reset_modificari_date ? clinic.reset_modificari_date.slice(0, 7) : null
  const modCurent  = resetMonth === thisMonth ? (clinic.modificari_luna || 0) : 0

  // Aplică draft-ul ca temă activă
  await fetch(`${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(clinicId)}`, {
    method:  'PATCH',
    headers: SB_PATCH,
    body:    JSON.stringify({
      tema:                   clinic.tema_draft,
      tema_draft:             null,
      approval_token:         null,
      modificari_luna:        modCurent + 1,
      reset_modificari_date:  new Date().toISOString().slice(0, 10),
    }),
  })

  // Șterge cache localStorage din browser-ul clinicii la următoarea vizită
  // (se face automat — fetch-ul fresh va returna tema nouă)

  // Email confirmare clinică (dacă are email)
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
