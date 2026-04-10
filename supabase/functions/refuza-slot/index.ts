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

    const rows = await (await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${notificare_id}&select=acceptat,anulat,refused`,
      { headers: SB }
    )).json()

    const not = Array.isArray(rows) ? rows[0] : null
    if (!not) return json({ success: false, reason: 'negasit' })

    if (not.acceptat) return json({ success: false, reason: 'slot_acceptat' })
    if (not.refused)  return json({ success: false, reason: 'deja_procesat' })
    if (not.anulat)   return json({ success: false, reason: 'slot_ocupat' })

    await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${notificare_id}`,
      { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ refused: true, anulat: true }) }
    )

    return json({ success: true })
  } catch (err) {
    console.error('refuza-slot error:', err)
    return json({ success: false, reason: 'eroare_interna' }, 500)
  }
})
