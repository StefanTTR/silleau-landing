const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SB = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = new URL(req.url)
  const n   = url.searchParams.get('n')
  if (!n) return json({ error: 'lipsa n' }, 400)

  try {
    const rows = await (await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${n}&select=acceptat,refused,anulat`,
      { headers: SB }
    )).json()

    const not = Array.isArray(rows) ? rows[0] : null
    if (!not) return json({ error: 'negasit' }, 404)

    return json({ acceptat: not.acceptat, refused: not.refused, anulat: not.anulat })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
