/* Apelat din anulare.html (reprogramare sau anulare definitiva).
   Primeste programare_id + clinic_id, face PATCH status='anulat',
   apoi triggereste ambele fluxuri de slot eliberat:
   - slot-eliberat   → coada slot_oferte
   - notifica-slot-liber → coada notificari_slot              */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SB = {
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
}
const SB_PATCH = {
  ...SB,
  'Content-Type': 'application/json',
  'Prefer':       'return=minimal',
}
const SB_JSON = { ...SB, 'Content-Type': 'application/json' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { programare_id, clinic_id, motiv } = await req.json()

    if (!programare_id || !clinic_id) {
      return json({ error: 'programare_id si clinic_id sunt obligatorii' }, 400)
    }

    /* 1. Fetch detalii programare */
    const progRes = await fetch(
      `${SUPABASE_URL}/rest/v1/programari?programare_id=eq.${programare_id}&clinic_id=eq.${clinic_id}`
      + `&select=programare_id,status,personal_id,serviciu_id,data_programare,ora_start,ora_sfarsit`,
      { headers: SB }
    )
    const progRows = await progRes.json()
    const prog = Array.isArray(progRows) ? progRows[0] : null

    if (!prog) return json({ error: 'programare negasita' }, 404)
    if (prog.status === 'anulat') return json({ skipped: 'deja anulata' })

    /* 2. PATCH status anulat */
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/programari?programare_id=eq.${programare_id}&clinic_id=eq.${clinic_id}`,
      {
        method:  'PATCH',
        headers: SB_PATCH,
        body:    JSON.stringify({
          status:         'anulat',
          slot_rezervat:  false,
          motiv_anulare:  motiv || 'anulat_de_pacient',
          anulat_la:      new Date().toISOString(),
        }),
      }
    )
    if (!patchRes.ok) {
      const txt = await patchRes.text()
      return json({ error: 'PATCH anulare esuata: ' + patchRes.status + ' ' + txt }, 500)
    }

    /* 2b. Dacă pacientul acceptase un slot eliberat anterior, eliberează-l înapoi */
    await fetch(
      `${SUPABASE_URL}/rest/v1/slot_oferte?programare_eligibila_id=eq.${programare_id}&slot_ocupat=eq.true`,
      { method: 'PATCH', headers: SB_PATCH, body: JSON.stringify({ slot_ocupat: false }) }
    )

    /* 3. Slot sub 24h — nu are sens sa notificam */
    const slotDatetime = new Date(prog.data_programare + 'T' + String(prog.ora_start).slice(0, 5) + ':00')
    if (slotDatetime.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      return json({ ok: true, slot_notificat: false, motiv: 'sub_24h' })
    }

    const slotPayload = {
      programare_id:   prog.programare_id,
      clinic_id,
      personal_id:     prog.personal_id,
      serviciu_id:     prog.serviciu_id,
      data_programare: prog.data_programare,
      ora_start:       prog.ora_start,
      ora_sfarsit:     prog.ora_sfarsit,
    }

    /* 4. Triggereaza ambele fluxuri de slot in paralel */
    const [r1, r2] = await Promise.allSettled([
      fetch(`${SUPABASE_URL}/functions/v1/slot-eliberat`, {
        method:  'POST',
        headers: { ...SB_JSON, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY },
        body:    JSON.stringify(slotPayload),
      }),
      fetch(`${SUPABASE_URL}/functions/v1/notifica-slot-liber`, {
        method:  'POST',
        headers: { ...SB_JSON, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY },
        body:    JSON.stringify(slotPayload),
      }),
    ])

    return json({
      ok:                  true,
      slot_eliberat:       r1.status === 'fulfilled' && r1.value.ok,
      notifica_slot_liber: r2.status === 'fulfilled' && r2.value.ok,
    })
  } catch (e) {
    console.error('anuleaza-slot error:', e)
    return json({ error: String(e) }, 500)
  }
})
