/* voice-webhook — apelat de Twilio după ce pacientul răspunde vocal.
   Folosește Claude Haiku pentru a detecta intenția din vorbire liberă în română.
   confirm → confirmat_reminder=true
   cancel  → status='anulat' */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_KEY    = Deno.env.get('ANTHROPIC_API_KEY')!

const SB_HEADERS = {
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
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
  const data = await res.json()
  const text = (data.content?.[0]?.text ?? '').toLowerCase().trim()
  if (text.startsWith('confirm')) return 'confirm'
  if (text.startsWith('cancel'))  return 'cancel'
  return 'unknown'
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const id  = url.searchParams.get('id')

    if (!id) return twimlReply('Eroare de sistem. V\u0103 rug\u0103m s\u0103 contacta\u021bi clinica.')

    // Extrage SpeechResult din form data Twilio
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
        'Nu am auzit r\u0103spunsul. V\u0103 rug\u0103m s\u0103 contacta\u021bi clinica direct. La revedere!'
      )
    }

    const intent = await classifyIntent(speech)

    if (intent === 'confirm') {
      await fetch(SUPABASE_URL + '/rest/v1/programari?id=eq.' + id, {
        method:  'PATCH',
        headers: SB_HEADERS,
        body:    JSON.stringify({ confirmat_reminder: true }),
      })
      return twimlReply(
        'Programarea dumneavoastr\u0103 a fost confirmat\u0103. V\u0103 a\u015ftept\u0103m! La revedere!'
      )
    }

    if (intent === 'cancel') {
      await fetch(SUPABASE_URL + '/rest/v1/programari?id=eq.' + id, {
        method:  'PATCH',
        headers: SB_HEADERS,
        body:    JSON.stringify({
          status:             'anulat',
          confirmat_reminder: true,
          motiv_anulare:      'anulat_telefon_bot',
        }),
      })
      return twimlReply(
        'Programarea dumneavoastr\u0103 a fost anulat\u0103. Dac\u0103 dori\u021bi o reprogramare, ne pute\u021bi contacta oricând. La revedere!'
      )
    }

    // Răspuns neclar — nu modificăm DB, rugăm să sune clinica
    return twimlReply(
      'Nu am \u00een\u0163eles r\u0103spunsul. V\u0103 rug\u0103m s\u0103 contacta\u021bi clinica direct pentru a confirma sau anula programarea. La revedere!'
    )
  } catch (e) {
    console.error('voice-webhook error:', e)
    return twimlReply('Eroare de sistem. V\u0103 rug\u0103m s\u0103 contacta\u021bi clinica.')
  }
})
