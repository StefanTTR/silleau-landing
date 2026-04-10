/* Verifică atomic dacă un slot din notificari_slot este disponibil
   și îl marchează ca acceptat dacă da.
   Apelat din programareclinica.html înainte de confirm. */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { notificare_id } = await req.json()
    if (!notificare_id) return json({ success: false, reason: 'notificare_id lipsa' }, 400)

    /* 1. Fetch notificarea */
    const notRes  = await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${notificare_id}&select=programare_id,acceptat,anulat`,
      { headers: SB }
    )
    const notRows = await notRes.json()
    const not     = Array.isArray(notRows) ? notRows[0] : null

    if (!not)        return json({ success: false, reason: 'negasit' })
    if (not.anulat)  return json({ success: false, reason: 'slot_ocupat' })
    if (not.acceptat) return json({ success: true })  // deja acceptat de același pacient

    /* 2. Verifică dacă alt pacient a acceptat deja același slot */
    const existRes  = await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${not.programare_id}&acceptat=eq.true&select=id&limit=1`,
      { headers: SB }
    )
    const existing = await existRes.json()
    if (Array.isArray(existing) && existing.length > 0) {
      return json({ success: false, reason: 'slot_ocupat' })
    }

    /* 3. Marchează ca acceptat */
    await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${notificare_id}`,
      { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ acceptat: true }) }
    )

    /* 4. Anulează toate celelalte notificări pentru același slot */
    await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${not.programare_id}&id=neq.${notificare_id}&trimis=eq.false`,
      { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ anulat: true }) }
    )

    return json({ success: true })
  } catch (err) {
    console.error('claim-slot error:', err)
    return json({ success: false, reason: 'eroare_interna' }, 500)
  }
})
