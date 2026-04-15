/**
 * save-booking — gestionează toate scrierile pentru o programare nouă sau reprogramare
 *
 * Înlocuiește apelurile directe REST din frontend care necesitau SUPABASE_KEY.
 * Cheia este stocată ca secret pe server (SUPABASE_SERVICE_KEY).
 *
 * POST /functions/v1/save-booking
 *
 * Body pentru programare nouă:
 * {
 *   email, prenume, nume, telefon,          // date pacient
 *   clinic_id, personal_id, serviciu_id,   // referințe
 *   data_programare, ora_start, ora_sfarsit,
 *   pret_ron, doreste_loc_mai_devreme
 * }
 *
 * Body pentru reprogramare (PATCH):
 * {
 *   reprogramare_id,                        // obligatoriu pentru reprogramare
 *   reprogramare_cid?,                      // clinic_id pentru filter PATCH
 *   personal_id, serviciu_id,
 *   data_programare, ora_start, ora_sfarsit,
 *   pret_ron
 * }
 *
 * Răspuns: { programare_id: string }
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DB_HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type':  'application/json',
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
    const body = await req.json()

    /* ── Reprogramare: PATCH direct pe programari ─────────────────── */
    if (body.reprogramare_id) {
      const {
        reprogramare_id,
        reprogramare_cid,
        personal_id,
        serviciu_id,
        data_programare,
        ora_start,
        ora_sfarsit,
        pret_ron,
      } = body

      if (!reprogramare_id || !personal_id || !data_programare || !ora_start || !ora_sfarsit) {
        return new Response(JSON.stringify({ error: 'câmpuri obligatorii lipsă pentru reprogramare' }), {
          status: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      let rpUrl = SUPABASE_URL + '/rest/v1/programari?id=eq.' + encodeURIComponent(reprogramare_id)
      if (reprogramare_cid) rpUrl += '&clinic_id=eq.' + encodeURIComponent(reprogramare_cid)

      const rpRes = await fetch(rpUrl, {
        method:  'PATCH',
        headers: { ...DB_HEADERS, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          personal_id,
          serviciu_id:        serviciu_id ?? null,
          data_programare,
          ora_start,
          ora_sfarsit,
          status:             'neconfirmat',
          pret_ron:           pret_ron ?? null,
          reminder_trimis:    false,
          confirmat_reminder: false,
          a_fost_reprogramat: true,
        }),
      })

      if (!rpRes.ok) {
        const txt = await rpRes.text()
        return new Response(JSON.stringify({ error: 'programari PATCH ' + rpRes.status + ': ' + txt }), {
          status: 500,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ programare_id: reprogramare_id }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    /* ── Programare nouă: upsert pacienti → pacienti_clinici → insert programari ── */
    const {
      email,
      prenume,
      nume,
      telefon,
      clinic_id,
      personal_id,
      serviciu_id,
      data_programare,
      ora_start,
      ora_sfarsit,
      pret_ron,
      doreste_loc_mai_devreme,
    } = body

    if (!prenume || !clinic_id || !personal_id || !data_programare || !ora_start || !ora_sfarsit) {
      return new Response(JSON.stringify({ error: 'câmpuri obligatorii lipsă' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    /* 1. Upsert pacienti */
    const pacRes = await fetch(SUPABASE_URL + '/rest/v1/pacienti?on_conflict=telefon', {
      method:  'POST',
      headers: { ...DB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ email, prenume, nume, telefon }),
    })
    if (!pacRes.ok) {
      const txt = await pacRes.text()
      return new Response(JSON.stringify({ error: 'pacienti ' + pacRes.status + ': ' + txt }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const pacRows = await pacRes.json()
    const pacient_id: string = Array.isArray(pacRows) ? pacRows[0].id : pacRows.id

    /* 2. Upsert pacienti_clinici */
    const pcRes = await fetch(SUPABASE_URL + '/rest/v1/pacienti_clinici', {
      method:  'POST',
      headers: { ...DB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ pacient_id, clinic_id, activ: true }),
    })
    if (!pcRes.ok) {
      const txt = await pcRes.text()
      return new Response(JSON.stringify({ error: 'pacienti_clinici ' + pcRes.status + ': ' + txt }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    /* 3. Insert programari */
    const prRes = await fetch(SUPABASE_URL + '/rest/v1/programari', {
      method:  'POST',
      headers: { ...DB_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        clinic_id,
        pacient_id,
        personal_id,
        serviciu_id:             serviciu_id ?? null,
        data_programare,
        ora_start,
        ora_sfarsit,
        status:                  'neconfirmat',
        pret_ron:                pret_ron ?? null,
        sursa:                   'formular',
        reminder_trimis:         false,
        doreste_loc_mai_devreme: doreste_loc_mai_devreme ?? false,
      }),
    })
    if (!prRes.ok) {
      const txt = await prRes.text()
      return new Response(JSON.stringify({ error: 'programari ' + prRes.status + ': ' + txt }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const prRows = await prRes.json()
    const programare_id: string = Array.isArray(prRows) ? prRows[0].id : prRows.id

    return new Response(JSON.stringify({ programare_id }), {
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
