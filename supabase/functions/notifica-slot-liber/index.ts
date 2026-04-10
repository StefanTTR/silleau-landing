const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const FROM_EMAIL       = 'Clinica Alfa <contact@silleau.com>'
const SITE             = 'https://www.silleau.com'

const SB = {
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
}

/* ─── Helpers ────────────────────────────────────────────────── */
function fmtData(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtOra(t: string): string {
  return String(t).slice(0, 5)
}

function buildEmail(
  prenume: string,
  medicNume: string,
  serviciu: string,
  dataFmt: string,
  ora: string,
  bookingUrl: string,
): string {
  const FONT    = '"Helvetica Neue", Arial, sans-serif'
  const BG      = '#0A0A0A'
  const CARD    = '#111111'
  const BORDER  = '#2A2A2A'
  const ACC     = '#E8E4DC'
  const DIM     = '#888888'
  const MUT     = '#555555'

  const row = (label: string, val: string) =>
    `<tr><td style="padding:10px 20px;font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:${MUT};font-family:${FONT};border-bottom:1px solid ${BORDER};">${label}</td>`
    + `<td style="padding:10px 20px;font-size:13px;color:#FAFAF8;text-align:right;font-family:${FONT};border-bottom:1px solid ${BORDER};">${val}</td></tr>`

  return `<!DOCTYPE html>
<html lang="ro">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loc disponibil mai devreme — SILLEAU</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:40px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

  <!-- Brand -->
  <tr><td align="center" style="padding-bottom:32px;">
    <span style="font-size:9px;font-weight:500;letter-spacing:3px;text-transform:uppercase;color:${ACC};font-family:${FONT};">
      — &nbsp; SILLEAU &nbsp; —
    </span>
  </td></tr>

  <!-- Card -->
  <tr><td style="background:${CARD};border:1px solid ${BORDER};border-radius:4px;padding:40px 40px 32px;">

    <p style="font-size:23px;font-weight:300;color:${ACC};margin:0 0 6px;letter-spacing:-.3px;">S-a eliberat un loc mai devreme</p>
    <p style="font-size:15px;font-weight:300;color:${DIM};margin:0 0 32px;">Bună ziua, <strong style="color:${ACC};font-weight:400;">${prenume}</strong>! Am găsit disponibilitate anterioară programării dvs.</p>

    <!-- Detalii -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#181818;border:1px solid ${BORDER};border-radius:3px;margin-bottom:28px;">
      ${row('Data', dataFmt)}
      ${row('Ora', ora)}
      ${row('Medic', medicNume)}
      ${row('Serviciu', serviciu)}
    </table>

    <p style="font-size:13px;color:${DIM};line-height:1.7;margin:0 0 28px;">
      Locul este disponibil acum și poate fi ocupat de oricine. Dacă doriți să vă mutați programarea la această dată și oră, apăsați mai jos cât mai repede.
    </p>

    <!-- CTA -->
    <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td style="background:${ACC};border-radius:2px;">
        <a href="${bookingUrl}" style="display:inline-block;padding:14px 32px;font-size:10px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:#111111;text-decoration:none;font-family:${FONT};">
          Ocupă locul acum
        </a>
      </td></tr>
    </table>

    <p style="font-size:11px;color:${MUT};line-height:1.7;margin:0;border-top:1px solid ${BORDER};padding-top:20px;">
      Dacă nu mai doriți să fiți notificat despre locuri disponibile mai devreme, ignorați acest mesaj.
      Programarea dvs. actuală rămâne neschimbată.<br><br>
      <a href="mailto:contact@silleau.com" style="color:${DIM};text-decoration:underline;text-decoration-style:dotted;">contact@silleau.com</a>
    </p>

  </td></tr>

  <!-- Footer -->
  <tr><td align="center" style="padding-top:24px;">
    <span style="font-size:9px;color:#555555;letter-spacing:3px;text-transform:uppercase;font-family:${FONT};">
      POWERED BY SILLEAU — REVENUE OPTIMISATION SYSTEMS
    </span>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

/* ─── Main ───────────────────────────────────────────────────── */
Deno.serve(async (req) => {
  try {
    const { programare_id, clinic_id } = await req.json()
    if (!programare_id || !clinic_id) {
      return new Response(JSON.stringify({ error: 'programare_id si clinic_id sunt necesare' }), { status: 400 })
    }

    /* 1. Fetch programarea anulată */
    const progRes = await fetch(
      `${SUPABASE_URL}/rest/v1/programari?id=eq.${programare_id}&clinic_id=eq.${clinic_id}`
      + `&select=personal_id,serviciu_id,data_programare,ora_start`,
      { headers: SB }
    )
    const progRows = await progRes.json()
    const prog = Array.isArray(progRows) ? progRows[0] : null
    if (!prog) return new Response(JSON.stringify({ skipped: 'programare negasita' }), { status: 200 })

    const { personal_id, serviciu_id, data_programare, ora_start } = prog

    /* 2. Verifică că slotul e cel puțin 24h în viitor */
    const slotTime = new Date(data_programare + 'T' + ora_start)
    const minTime  = new Date(Date.now() + 24 * 60 * 60 * 1000)
    if (slotTime < minTime) {
      return new Response(JSON.stringify({ skipped: 'slot prea aproape (< 24h)' }), { status: 200 })
    }

    /* 3. Fetch medic */
    const medRes  = await fetch(
      `${SUPABASE_URL}/rest/v1/personal?id=eq.${personal_id}&select=prenume,nume,titlu,specialitate`,
      { headers: SB }
    )
    const medRows = await medRes.json()
    const med     = Array.isArray(medRows) ? medRows[0] : null
    const medicNume = med
      ? ((med.titlu ? med.titlu + ' ' : '') + (med.prenume || '') + ' ' + (med.nume || '')).trim()
      : 'medicul dvs.'
    const specialitate = med?.specialitate || ''

    /* 4. Fetch serviciu */
    let serviciuNume = 'consultație'
    if (serviciu_id) {
      const srvRes  = await fetch(
        `${SUPABASE_URL}/rest/v1/servicii?id=eq.${serviciu_id}&select=denumire`,
        { headers: SB }
      )
      const srvRows = await srvRes.json()
      if (Array.isArray(srvRows) && srvRows[0]) serviciuNume = srvRows[0].denumire
    }

    /* 5. Găsește pacienți eligibili:
       - doreste_loc_mai_devreme = true
       - același medic (personal_id)
       - același serviciu (serviciu_id) — dacă e null, oricare serviciu la același medic
       - programarea lor e mai TÂRZIE decât slotul eliberat
       - status activ (neconfirmat sau confirmat)
    */
    let eligibilUrl = `${SUPABASE_URL}/rest/v1/programari`
      + `?doreste_loc_mai_devreme=eq.true`
      + `&personal_id=eq.${personal_id}`
      + `&data_programare=gt.${data_programare}`
      + `&status=neq.anulat`
      + `&id=neq.${programare_id}`
      + `&select=id,pacient_id,data_programare,clinic_id`

    if (serviciu_id) {
      eligibilUrl += `&serviciu_id=eq.${serviciu_id}`
    }

    const eligRes  = await fetch(eligibilUrl, { headers: SB })
    const eligibili = await eligRes.json()

    if (!Array.isArray(eligibili) || eligibili.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'niciun pacient eligibil' }), { status: 200 })
    }

    /* 6. Trimite email fiecărui pacient eligibil */
    const dataFmt = fmtData(data_programare)
    const ora     = fmtOra(ora_start)

    let sent = 0
    for (const el of eligibili) {
      /* Fetch date pacient */
      const pacRes  = await fetch(
        `${SUPABASE_URL}/rest/v1/pacienti?id=eq.${el.pacient_id}&select=prenume,email`,
        { headers: SB }
      )
      const pacRows = await pacRes.json()
      const pac     = Array.isArray(pacRows) ? pacRows[0] : null
      if (!pac?.email) continue

      /* URL pre-completat la formularul de programare */
      const bookingUrl = SITE + '/programareclinica.html'
        + '?medic_pref='        + encodeURIComponent(medicNume)
        + '&specialitate_pref=' + encodeURIComponent(specialitate)
        + '&serviciu_pref='     + encodeURIComponent(serviciuNume)

      const html = buildEmail(
        pac.prenume || 'Pacient',
        medicNume,
        serviciuNume,
        dataFmt,
        ora,
        bookingUrl,
      )

      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    FROM_EMAIL,
          to:      [pac.email],
          subject: `S-a eliberat un loc pe ${dataFmt} la ora ${ora} — SILLEAU`,
          html,
        }),
      })

      sent++
    }

    return new Response(JSON.stringify({ sent, eligibili: eligibili.length }), { status: 200 })
  } catch (err) {
    console.error('notifica-slot-liber error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
