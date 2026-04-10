const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE             = 'https://www.silleau.com'

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }

function redir(tip: string) {
  return Response.redirect(`${SITE}/mesaj.html?tip=${tip}`, 302)
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const n   = url.searchParams.get('n')

  if (!n) return redir('invalid')

  try {
    const rows = await (await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${n}&select=acceptat,anulat`,
      { headers: SB }
    )).json()

    const not = Array.isArray(rows) ? rows[0] : null
    if (!not) return redir('negasit')

    /* Marchează ca refuzat și anulat */
    await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${n}`,
      { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ refused: true, anulat: true }) }
    )

    return redir('slot_refuzat')
  } catch (err) {
    console.error('refuza-slot error:', err)
    return redir('invalid')
  }
})
