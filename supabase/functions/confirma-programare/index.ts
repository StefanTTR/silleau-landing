/**
 * confirma-programare — verifică statusul și confirmă o programare
 *
 * POST /functions/v1/confirma-programare
 * Body: { id: string }
 *
 * Răspuns:
 *   { confirmed: true }              — confirmat cu succes
 *   { already: true }                — era deja confirmat (idempotent)
 *   { error: 'anulat' }              — programare anulată, nu se poate confirma
 *   { error: 'negasita' }            — id inexistent
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SB = {
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { id } = await req.json()

    if (!id) {
      return new Response(JSON.stringify({ error: 'id lipsa' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    /* 1. Verifică statusul curent */
    const getRes = await fetch(
      SUPABASE_URL + '/rest/v1/programari?programare_id=eq.' + encodeURIComponent(id) + '&select=status',
      { headers: SB }
    )
    const rows = await getRes.json()
    const row = Array.isArray(rows) ? rows[0] : null

    if (!row) {
      return new Response(JSON.stringify({ error: 'negasita' }), {
        status: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (row.status === 'confirmat') {
      return new Response(JSON.stringify({ already: true }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (row.status === 'anulat') {
      return new Response(JSON.stringify({ error: 'anulat' }), {
        status: 409,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    /* 2. PATCH status → confirmat */
    const patchRes = await fetch(
      SUPABASE_URL + '/rest/v1/programari?programare_id=eq.' + encodeURIComponent(id),
      {
        method:  'PATCH',
        headers: { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          status:      'confirmat',
          acceptat_la: new Date().toISOString(),
        }),
      }
    )

    if (!patchRes.ok) {
      const txt = await patchRes.text()
      return new Response(JSON.stringify({ error: 'PATCH ' + patchRes.status + ': ' + txt }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ confirmed: true }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
