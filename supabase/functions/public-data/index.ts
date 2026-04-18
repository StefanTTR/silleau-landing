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

const SUPABASE_URL      = Deno.env.get('APP_DB_URL') || Deno.env.get('SUPABASE_URL')!
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
  'programare_status',   // GET status single booking by id
  'programare_info',     // GET status+confirmat_reminder+motiv_anulare+a_fost_reprogramat by id
  'slot_oferta',         // GET slot_oferte by id
  'programare_cur',      // GET data_programare, ora_start by id
  'clinic_theme',        // GET tema + nume_afisat + logo_url + favicon_url din clinic_branding (status=approved) by clinic_id
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

    const clinicId     = url.searchParams.get('clinic_id') || ''
    const specialitate = url.searchParams.get('specialitate') || ''
    const id           = url.searchParams.get('id') || ''

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
          + '&select=personal_id,data_start,data_sfarsit'
        break

      case 'programare_status':
        if (!id) {
          return new Response(JSON.stringify({ error: 'id lipsa' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        restUrl = SUPABASE_URL
          + '/rest/v1/programari'
          + '?programare_id=eq.' + encodeURIComponent(id)
          + '&select=status'
        break

      case 'programare_info':
        if (!id) {
          return new Response(JSON.stringify({ error: 'id lipsa' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        restUrl = SUPABASE_URL
          + '/rest/v1/programari'
          + '?programare_id=eq.' + encodeURIComponent(id)
          + '&select=status,confirmat_reminder,motiv_anulare,a_fost_reprogramat,numar_reprogramari'
        if (clinicId) restUrl += '&clinic_id=eq.' + encodeURIComponent(clinicId)
        break

      case 'slot_oferta':
        if (!id) {
          return new Response(JSON.stringify({ error: 'id lipsa' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        restUrl = SUPABASE_URL
          + '/rest/v1/slot_oferte'
          + '?id=eq.' + encodeURIComponent(id)
          + '&select=slot_ocupat,programare_anulata_id'
        break

      case 'programare_cur':
        if (!id) {
          return new Response(JSON.stringify({ error: 'id lipsa' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        restUrl = SUPABASE_URL
          + '/rest/v1/programari'
          + '?programare_id=eq.' + encodeURIComponent(id)
          + '&select=data_programare,ora_start'
        break

      case 'clinic_theme': {
        if (!clinicId) {
          return new Response(JSON.stringify({ error: 'clinic_id lipsa' }), {
            status: 400,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        const brandingUrl = SUPABASE_URL
          + '/rest/v1/clinic_branding'
          + '?clinic_id=eq.' + encodeURIComponent(clinicId)
          + '&status=eq.approved'
          + '&select=tema,nume_afisat,slogan,logo_url,favicon_url,hide_silleau,silleau_opacity,layout'
        const clinicUrl = SUPABASE_URL
          + '/rest/v1/clinici'
          + '?id=eq.' + encodeURIComponent(clinicId)
          + '&select=nume'

        const [bRes, cRes] = await Promise.all([
          fetch(brandingUrl, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }),
          fetch(clinicUrl,   { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }),
        ])
        if (!cRes.ok) {
          const err = await cRes.json().catch(() => ({}))
          return new Response(JSON.stringify({ error: 'eroare baza de date', details: err }), {
            status: cRes.status,
            headers: { ...CORS, 'Content-Type': 'application/json' },
          })
        }
        const bRows = bRes.ok ? await bRes.json() : []
        const cRows = await cRes.json()
        const b = Array.isArray(bRows) ? bRows[0] : null
        const c = Array.isArray(cRows) ? cRows[0] : null
        const merged = {
          tema:            b?.tema || {},
          nume:            c?.nume || null,
          nume_afisat:     b?.nume_afisat || null,
          slogan:          b?.slogan || null,
          logo_url:        b?.logo_url || null,
          favicon_url:     b?.favicon_url || null,
          hide_silleau:    !!b?.hide_silleau,
          silleau_opacity: b?.silleau_opacity ?? 1,
          layout:          b?.layout || {},
        }
        return new Response(JSON.stringify([merged]), {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

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
