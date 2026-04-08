/* voice-webhook — apelat de Twilio după ce pacientul răspunde vocal.
   Folosește Claude Haiku pentru a detecta intenția din vorbire liberă în română.
   confirm → confirmat_reminder=true
   cancel  → status='anulat' */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY') || ''
const FROM_EMAIL       = 'Clinica Alfa <contact@silleau.com>'

const SB_GET = {
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
}

const SB_PATCH = {
  ...SB_GET,
  'Content-Type':  'application/json',
  'Prefer':        'return=minimal',
}

function twimlReply(msg: string): Response {
  const xml = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Response>'
    + '<Say language="ro-RO" voice="Polly.Carmen">' + msg + '</Say>'
    + '</Response>'
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

async function classifyIntent(speech: string): Promise<'confirm' | 'cancel' | 'unknown'> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system:     'Ești un clasificator de intenții pentru programări medicale. '
                + 'Primești transcrieri telefonice în română și răspunzi cu exact un cuvânt: '
                + '"confirm" dacă pacientul confirmă că vine, '
                + '"cancel" dacă pacientul anulează sau nu poate veni, '
                + '"unknown" în orice alt caz.',
      messages: [{ role: 'user', content: speech }],
    }),
  })

  if (!res.ok) {
    throw new Error('Anthropic ' + res.status + ': ' + await res.text())
  }

  const data = await res.json()
  const text = (data.content?.[0]?.text ?? '').toLowerCase().trim()
  if (text.startsWith('confirm')) return 'confirm'
  if (text.startsWith('cancel'))  return 'cancel'
  return 'unknown'
}

type ProgramareContext = {
  id: string
  clinic_id: string
  data_programare: string
  ora_start: string
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const id  = url.searchParams.get('id')
    const clinicIdParam = url.searchParams.get('clinic_id')

    if (!id) return twimlReply('Eroare de sistem. Vă rugăm să contactați clinica.')

    let speech = ''
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const form = await req.formData()
      speech = (form.get('SpeechResult') ?? '').toString().trim()
    } else {
      try {
        const json = await req.json()
        speech = (json.SpeechResult ?? json.speech ?? '').toString().trim()
      } catch { /* ignore */ }
    }

    if (!speech) {
      return twimlReply(
        'Nu am auzit răspunsul. Vă rugăm să contactați clinica direct. La revedere!'
      )
    }

    const ctx = await fetchProgramareContext(id, clinicIdParam)
    if (!ctx?.clinic_id) {
      console.warn('[voice-webhook] context programare lipsa pentru id', id, 'clinic param', clinicIdParam)
      return twimlReply('Eroare de sistem. Vă rugăm să contactați clinica.')
    }

    const intent = await classifyIntent(speech)

    if (intent === 'confirm') {
      await patchProgramare(id, ctx.clinic_id, { confirmat_reminder: true })
      return twimlReply(
        'Programarea dumneavoastră a fost confirmată. Vă așteptăm! La revedere!'
      )
    }

    if (intent === 'cancel') {
      await patchProgramare(id, ctx.clinic_id, {
        status:             'anulat',
        confirmat_reminder: true,
        motiv_anulare:      'anulat_telefon_bot',
      })
      return twimlReply(
        'Programarea dumneavoastră a fost anulată. Dacă doriți o reprogramare, ne puteți contacta oricând. La revedere!'
      )
    }

    await logAndNotifyUnknown(ctx, speech)
    return twimlReply(
      'Nu am înţeles răspunsul. Vă rugăm să contactați clinica direct pentru a confirma sau anula programarea. La revedere!'
    )
  } catch (e) {
    console.error('voice-webhook error:', e)
    return twimlReply('Eroare de sistem. Vă rugăm să contactați clinica.')
  }
})

async function fetchProgramareContext(id: string, clinicIdParam: string | null): Promise<ProgramareContext | null> {
  let url = SUPABASE_URL + '/rest/v1/programari?id=eq.' + encodeURIComponent(id)
  if (clinicIdParam) url += '&clinic_id=eq.' + encodeURIComponent(clinicIdParam)
  url += '&select=id,clinic_id,data_programare,ora_start&limit=1'

  const res = await fetch(url, { headers: SB_GET })
  if (!res.ok) {
    throw new Error('Supabase GET ' + res.status + ': ' + await res.text())
  }

  const rows = await res.json()
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row?.id || !(row?.clinic_id || clinicIdParam)) return null

  return {
    id: String(row.id),
    clinic_id: String(row.clinic_id || clinicIdParam || ''),
    data_programare: String(row.data_programare || ''),
    ora_start: String(row.ora_start || ''),
  }
}

async function patchProgramare(id: string, clinicId: string, body: Record<string, unknown>) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/programari?id=eq.' + encodeURIComponent(id) + '&clinic_id=eq.' + encodeURIComponent(clinicId),
    {
      method:  'PATCH',
      headers: SB_PATCH,
      body:    JSON.stringify(body),
    }
  )

  if (!res.ok) {
    throw new Error('Supabase PATCH ' + res.status + ': ' + await res.text())
  }
}

async function logAndNotifyUnknown(ctx: ProgramareContext, speech: string) {
  console.warn('[voice-webhook] unknown intent', {
    programare_id: ctx.id,
    clinic_id: ctx.clinic_id,
    data_programare: ctx.data_programare,
    ora_start: ctx.ora_start,
    speech,
  })

  if (!RESEND_KEY) {
    console.warn('[voice-webhook] RESEND_KEY lipseste; notificarea clinicii a fost omisa')
    return
  }

  const clinic = await findClinicContact(ctx.clinic_id)
  if (!clinic?.email) {
    console.warn('[voice-webhook] contact clinic indisponibil pentru clinic_id', ctx.clinic_id)
    return
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: clinic.email,
      subject: 'Acțiune manuală necesară — răspuns vocal neclar',
      html: '<p>Salut,</p>'
        + '<p>Asistentul vocal nu a putut clasifica răspunsul unui pacient.</p>'
        + '<p><strong>Programare:</strong> ' + ctx.id + '<br>'
        + '<strong>Clinică:</strong> ' + escapeHtml(clinic.name || ctx.clinic_id) + '<br>'
        + '<strong>Data:</strong> ' + escapeHtml(ctx.data_programare || '—') + '<br>'
        + '<strong>Ora:</strong> ' + escapeHtml((ctx.ora_start || '').slice(0, 5) || '—') + '</p>'
        + '<p><strong>Transcriere:</strong><br>' + escapeHtml(speech) + '</p>'
        + '<p>Vă rugăm să contactați pacientul pentru confirmare sau anulare.</p>',
    }),
  })

  if (!emailRes.ok) {
    console.warn('[voice-webhook] notificarea clinicii a eșuat', emailRes.status, await emailRes.text())
  }
}

async function findClinicContact(clinicId: string): Promise<{ name: string, email: string } | null> {
  const tableCandidates = ['clinici', 'clinics']

  for (const table of tableCandidates) {
    const url = SUPABASE_URL + '/rest/v1/' + table
      + '?id=eq.' + encodeURIComponent(clinicId)
      + '&select=id,nume,name,email,contact_email,notification_email'
      + '&limit=1'

    const res = await fetch(url, { headers: SB_GET })
    if (!res.ok) {
      console.warn('[voice-webhook] tabela clinica indisponibila', table, res.status)
      continue
    }

    const rows = await res.json()
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) continue

    const email = String(row.notification_email || row.contact_email || row.email || '')
    const name = String(row.nume || row.name || 'Clinica')
    return { name, email }
  }

  return null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

