/**
 * gestiune-slot — acceptă sau refuză o ofertă de slot mai devreme
 *
 * POST /functions/v1/gestiune-slot
 *
 * Body pentru acceptare:
 * {
 *   action:        'accept',
 *   programare_id: string,   // ID-ul programării care se mută
 *   oferta_id:     string,   // ID-ul ofertei acceptate
 *   clinic_id:     string,
 *   data_noua:     string,   // YYYY-MM-DD
 *   ora_noua:      string,   // HH:MM
 *   ora_sfarsit?:  string,   // HH:MM (opțional)
 *   cur_data?:     string,   // pentru emailul de confirmare
 *   cur_ora?:      string,
 * }
 *
 * Body pentru refuz:
 * {
 *   action:    'decline',
 *   oferta_id: string,
 * }
 *
 * Răspuns: { ok: true } sau { error: string }
 */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// SUPABASE_URL = https://<ref>.supabase.co — derivăm base URL pentru functions
const FUNCTIONS_BASE   = SUPABASE_URL.replace(/\/rest\/v1.*$/, '').replace(/\/$/, '') + '/functions/v1'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SB = {
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
}
const SB_PATCH = {
  ...SB,
  'Content-Type': 'application/json',
  'Prefer':       'return=minimal',
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
    const { action } = body

    /* ── DECLINE ─────────────────────────────────────────────────── */
    if (action === 'decline') {
      const { oferta_id } = body

      if (!oferta_id) {
        return new Response(JSON.stringify({ error: 'oferta_id lipsa' }), {
          status: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      await fetch(
        SUPABASE_URL + '/rest/v1/slot_oferte?id=eq.' + encodeURIComponent(oferta_id),
        { method: 'PATCH', headers: SB_PATCH, body: JSON.stringify({ status: 'expirat' }) }
      )

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    /* ── ACCEPT ──────────────────────────────────────────────────── */
    if (action === 'accept') {
      const { programare_id, oferta_id, clinic_id, data_noua, ora_noua, ora_sfarsit, cur_data, cur_ora } = body

      if (!programare_id || !oferta_id || !clinic_id || !data_noua || !ora_noua) {
        return new Response(JSON.stringify({ error: 'campuri obligatorii lipsa' }), {
          status: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      /* 1. Double-check — slotul să nu fie deja ocupat */
      const ofertaRes = await fetch(
        SUPABASE_URL + '/rest/v1/slot_oferte?id=eq.' + encodeURIComponent(oferta_id)
        + '&select=slot_ocupat,programare_anulata_id',
        { headers: SB }
      )
      const ofertaRows = await ofertaRes.json()
      const oferta = Array.isArray(ofertaRows) ? ofertaRows[0] : null

      if (!oferta) {
        return new Response(JSON.stringify({ error: 'oferta negasita' }), {
          status: 404,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      if (oferta.slot_ocupat) {
        return new Response(JSON.stringify({ slot_ocupat: true }), {
          status: 409,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      const anulataId  = oferta.programare_anulata_id
      const acceptat_la = new Date().toISOString()

      const patchBody: Record<string, string> = {
        data_programare: data_noua,
        ora_start:       ora_noua,
        status:          'confirmat',
        acceptat_la,
      }
      if (ora_sfarsit) patchBody.ora_sfarsit = ora_sfarsit

      /* 2. Mută programarea pe noul slot */
      const p1 = await fetch(
        SUPABASE_URL + '/rest/v1/programari?programare_id=eq.' + encodeURIComponent(programare_id),
        { method: 'PATCH', headers: SB_PATCH, body: JSON.stringify(patchBody) }
      )
      if (!p1.ok) {
        const txt = await p1.text()
        return new Response(JSON.stringify({ error: 'PATCH programari ' + p1.status + ': ' + txt }), {
          status: 500,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        })
      }

      /* 3. Marchează toate ofertele din grup ca slot_ocupat=true */
      await fetch(
        SUPABASE_URL + '/rest/v1/slot_oferte?programare_anulata_id=eq.' + encodeURIComponent(anulataId),
        { method: 'PATCH', headers: SB_PATCH, body: JSON.stringify({ slot_ocupat: true }) }
      )

      /* 4. Marchează această ofertă ca acceptată */
      await fetch(
        SUPABASE_URL + '/rest/v1/slot_oferte?id=eq.' + encodeURIComponent(oferta_id),
        { method: 'PATCH', headers: SB_PATCH, body: JSON.stringify({ status: 'acceptat' }) }
      )

      /* 5. Email confirmare reprogramare — fire and forget */
      fetch(
        FUNCTIONS_BASE + '/acceptare-loc-nou',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ programare_id, clinic_id, cur_data: cur_data || '', cur_ora: cur_ora || '' }),
        }
      ).catch(() => {})

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'action invalid (accept sau decline)' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
