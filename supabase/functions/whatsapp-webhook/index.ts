/* whatsapp-webhook
   GET  — verificare webhook Meta (hub.challenge)
   POST — primește răspunsuri Quick Reply (rating 1-5) și salvează în programari.feedback_ces */

const VERIFY_TOKEN = Deno.env.get('META_WA_VERIFY_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SB = { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY }

Deno.serve(async (req) => {

  /* ── GET — verificare webhook Meta ── */
  if (req.method === 'GET') {
    const p = new URL(req.url).searchParams
    if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === VERIFY_TOKEN) {
      return new Response(p.get('hub.challenge'), { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  /* ── POST — mesaj primit ── */
  if (req.method === 'POST') {
    try {
      const body  = await req.json()
      const msg   = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]

      /* ignoră orice nu e Quick Reply */
      if (!msg || msg.type !== 'button') {
        return new Response('ok', { status: 200 })
      }

      const payload = msg.button?.payload as string || ''
      const fromRaw = msg.from as string   // ex: "40741234567"

      if (!fromRaw) return new Response('ok', { status: 200 })

      /* Normalizare număr: 407XXXXXXXX → 07XXXXXXXX */
      const telefon = fromRaw.startsWith('40') ? '0' + fromRaw.slice(2) : fromRaw

      /* ── 1. Găsește pacientul după telefon ── */
      const pRes  = await fetch(
        SUPABASE_URL + '/rest/v1/pacienti?telefon=eq.' + encodeURIComponent(telefon) + '&select=id&limit=1',
        { headers: SB }
      )
      const pRows = await pRes.json()
      if (!Array.isArray(pRows) || !pRows.length) {
        console.warn('[WA-webhook] pacient negăsit pentru telefon:', telefon)
        return new Response('ok', { status: 200 })
      }
      const pacient_id = pRows[0].id

      /* ── 2. Găsește cea mai recentă programare a pacientului ── */
      const prRes  = await fetch(
        SUPABASE_URL + '/rest/v1/programari?pacient_id=eq.' + pacient_id
          + '&order=creat_la.desc&limit=1&select=id',
        { headers: SB }
      )
      const prRows = await prRes.json()
      if (!Array.isArray(prRows) || !prRows.length) {
        console.warn('[WA-webhook] programare negăsită pentru pacient:', pacient_id)
        return new Response('ok', { status: 200 })
      }
      const programare_id = prRows[0].id

      /* ── 3a. Buton "Confirma" din reminder ── */
      if (payload === 'CONFIRM') {
        await fetch(
          SUPABASE_URL + '/rest/v1/programari?id=eq.' + programare_id,
          {
            method:  'PATCH',
            headers: { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body:    JSON.stringify({ confirmat_reminder: true }),
          }
        )
        console.log('[WA-webhook] confirmat_reminder=true pentru programare', programare_id)
        return new Response('ok', { status: 200 })
      }

      /* ── 3b. Rating 1-5 din mesajul de confirmare booking ── */
      const rating = parseInt(payload)
      if (isNaN(rating) || rating < 1 || rating > 5) {
        return new Response('ok', { status: 200 })
      }

      await fetch(
        SUPABASE_URL + '/rest/v1/programari?id=eq.' + programare_id,
        {
          method:  'PATCH',
          headers: { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body:    JSON.stringify({ feedback_ces: rating }),
        }
      )

      console.log('[WA-webhook] feedback', rating, 'salvat pentru programare', programare_id)
    } catch (e) {
      console.error('[WA-webhook] eroare:', String(e))
    }

    return new Response('ok', { status: 200 })
  }

  return new Response('Method Not Allowed', { status: 405 })
})
