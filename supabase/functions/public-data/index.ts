/**
 * public-data — proxy public pentru citiri din Supabase
 *
 * Înlocuiește apelurile directe REST din frontend care necesitau SUPABASE_KEY.
 * Cheia este stocată ca secret pe server (SUPABASE_SERVICE_KEY).
 *
 * GET /functions/v1/public-data?resource=<resource>[&<filtre>]
 *
 * Resources suportate:
 *   personal          → /rest/v1/personal?clinic_id=eq.X&activ=eq.true&select=id,prenume,nume,specialitate,titlu&order=specialitate.asc
 *   program_personal  → /rest/v1/program_personal?select=personal_id,zi_saptamana,ora_start,ora_sfarsit
 *   servicii          → /rest/v1/servicii?clinic_id=eq.X&specialitate=eq.Y&select=id,nume,durata_min,pauza_dupa_min,pret_ron,zile_rechemare&order=pret_ron.desc
 *   programari        → /rest/v1/programari?clinic_id=eq.X&status=in.(neconfirmat,confirmat)&select=personal_id,data_programare,ora_start,ora_sfarsit
 *   zile_blocate      → /rest/v1/zile_blocate?clinic_id=eq.X&select=personal_id,data
 */

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ALLOWED_RESOURCES = new Set([
  'personal',
  'program_personal',
  'servicii',
  'programari',
  'zile_blocate',
])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const url      = new URL(req.url)
    const resource = url.searchParams.get('resource')

    if (!resource || !ALLOWED_RESOURCES.has(resource)) {
      return new Response(JSON.stringify({ error: 'resource invalid sau lipsa' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const clinicId    = url.searchParams.get('clinic_id') || ''
    const specialitate = url.searchParams.get('specialitate') || ''

    let restUrl: string

    switch (resource) {
      case 'personal':
        if (!clinicId) {
          return new Response(JSON.stringify({ error: 'clinic_id lipsa' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        restUrl = SUPABASE_URL
          + '/rest/v1/personal'
          + '?clinic_id=eq.' + encodeURIComponent(clinicId)
          + '&activ=eq.true'
          + '&select=id,prenume,nume,specialitate,titlu'
          + '&order=specialitate.asc'
        break

      case 'program_personal':
        restUrl = SUPABASE_URL
          + '/rest/v1/program_personal'
          + '?select=personal_id,zi_saptamana,ora_start,ora_sfarsit'
        break

      case 'servicii':
        if (!clinicId || !specialitate) {
          return new Response(JSON.stringify({ error: 'clinic_id si specialitate sunt obligatorii' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        restUrl = SUPABASE_URL
          + '/rest/v1/servicii'
          + '?clinic_id=eq.' + encodeURIComponent(clinicId)
          + '&specialitate=eq.' + encodeURIComponent(specialitate)
          + '&select=id,nume,durata_min,pauza_dupa_min,pret_ron,zile_rechemare'
          + '&order=pret_ron.desc'
        break

      case 'programari':
        if (!clinicId) {
          return new Response(JSON.stringify({ error: 'clinic_id lipsa' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        restUrl = SUPABASE_URL
          + '/rest/v1/programari'
          + '?clinic_id=eq.' + encodeURIComponent(clinicId)
          + '&status=in.(neconfirmat,confirmat)'
          + '&select=personal_id,data_programare,ora_start,ora_sfarsit'
        break

      case 'zile_blocate':
        if (!clinicId) {
          return new Response(JSON.stringify({ error: 'clinic_id lipsa' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        restUrl = SUPABASE_URL
          + '/rest/v1/zile_blocate'
          + '?clinic_id=eq.' + encodeURIComponent(clinicId)
          + '&select=personal_id,data'
        break

      default:
        return new Response(JSON.stringify({ error: 'resource necunoscut' }), {
          status: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
    }

    const dbRes = await fetch(restUrl, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
      },
    })

    const data = await dbRes.json()

    if (!dbRes.ok) {
      return new Response(JSON.stringify({ error: 'eroare baza de date', details: data }), {
        status: dbRes.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(data), {
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
