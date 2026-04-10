const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const FROM_EMAIL       = 'Clinica Alfa <contact@silleau.com>'
const SITE             = 'https://www.silleau.com'
const FEEDBACK_FN      = 'https://wpxflbwohowigaulhxhk.supabase.co/functions/v1/save-feedback'

const SB = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtOra(t: string): string { return String(t).slice(0, 5) }

function buildRatingHtml(baseUrl: string): string {
  let btns = ''
  for (let i = 1; i <= 5; i++) {
    btns += '<td style="padding:0 3px;">'
      + `<a href="${baseUrl}&rating=${i}" style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;background:#1A1A1A;color:#888888;font-size:13px;font-family:'Helvetica Neue',Arial,sans-serif;font-weight:500;text-decoration:none;border-radius:50%;border:1px solid #333333;">${i}</a>`
      + '</td>'
  }
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:0;">'
    + '<tr><td style="height:1px;background:#2A2A2A;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '</table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td align="center" style="padding:20px 0 10px;">'
    + '<span style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Cum apreciați calitatea sistemului nostru digital?</span>'
    + '</td></tr>'
    + '<tr><td align="center" style="padding-bottom:8px;">'
    + '<table cellpadding="0" cellspacing="0" border="0"><tr>' + btns + '</tr></table>'
    + '</td></tr>'
    + '<tr><td align="center">'
    + '<span style="font-size:10px;color:#555555;font-family:\'Helvetica Neue\',Arial,sans-serif;">1 = Foarte slab &nbsp;·&nbsp; 5 = Excelent</span>'
    + '</td></tr>'
    + '</table>'
}

function buildEmail(p: {
  prenume: string, medicNume: string, serviciuNume: string,
  dataFmt: string, ora: string, bookingUrl: string,
  programareId: string, clinicId: string, notificareId: string,
}): string {
  const F = '"Helvetica Neue",Arial,sans-serif'
  const BG = '#0A0A0A'; const CARD = '#111111'; const BD = '#2A2A2A'
  const ACC = '#E8E4DC'; const DIM = '#888888'; const MUT = '#555555'

  const row = (label: string, val: string) =>
    `<tr><td style="padding:10px 20px;font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:${MUT};font-family:${F};border-bottom:1px solid ${BD};">${label}</td>`
    + `<td style="padding:10px 20px;font-size:13px;color:#FAFAF8;text-align:right;font-family:${F};border-bottom:1px solid ${BD};">${val}</td></tr>`

  const ratingUrl = FEEDBACK_FN
    + '?id=' + encodeURIComponent(p.programareId)
    + '&clinic_id=' + encodeURIComponent(p.clinicId)
    + '&tip=slot_liber&sursa=slot_liber'

  return `<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loc disponibil — SILLEAU</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:${F};">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:40px 0;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

  <tr><td align="center" style="padding-bottom:32px;">
    <span style="font-size:9px;font-weight:500;letter-spacing:3px;text-transform:uppercase;color:${ACC};font-family:${F};">— &nbsp;SILLEAU&nbsp; —</span>
  </td></tr>

  <tr><td style="background:${CARD};border:1px solid ${BD};border-radius:4px;padding:40px 40px 0;">

    <p style="font-size:23px;font-weight:300;color:${ACC};margin:0 0 6px;letter-spacing:-.3px;">S-a eliberat un loc mai devreme</p>
    <p style="font-size:15px;font-weight:300;color:${DIM};margin:0 0 28px;">Bună ziua, <strong style="color:${ACC};font-weight:400;">${p.prenume}</strong>! Am găsit disponibilitate anterioară programării dvs.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#181818;border:1px solid ${BD};border-radius:3px;margin-bottom:24px;">
      ${row('Data', p.dataFmt)}
      ${row('Ora', p.ora)}
      ${row('Medic', p.medicNume)}
      ${row('Serviciu', p.serviciuNume)}
    </table>

    <p style="font-size:13px;color:${DIM};line-height:1.7;margin:0 0 24px;">
      Locul este disponibil acum. Dacă doriți să vă mutați programarea, apăsați butonul de mai jos cât mai curând.
      <br>Programarea dvs. actuală rămâne neschimbată dacă nu acționați.
    </p>

    <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr><td style="background:${ACC};border-radius:2px;">
        <a href="${p.bookingUrl}" style="display:inline-block;padding:14px 32px;font-size:10px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:#111111;text-decoration:none;font-family:${F};">
          Ocupă locul acum
        </a>
      </td></tr>
    </table>

    ${buildRatingHtml(ratingUrl)}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
    <tr><td style="padding:20px 0;border-top:1px solid ${BD};">
      <p style="font-size:11px;color:${MUT};line-height:1.7;margin:0;">
        Dacă nu mai doriți să fiți notificat, ignorați acest mesaj.<br>
        <a href="mailto:contact@silleau.com" style="color:${DIM};text-decoration:underline;text-decoration-style:dotted;">contact@silleau.com</a>
      </p>
    </td></tr>
    </table>

  </td></tr>

  <tr><td align="center" style="padding-top:24px;">
    <span style="font-size:9px;color:#555555;letter-spacing:3px;text-transform:uppercase;font-family:${F};">
      POWERED BY SILLEAU — REVENUE OPTIMISATION SYSTEMS
    </span>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`
}

async function sendEmail(to: string, subject: string, html: string) {
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  })
}

Deno.serve(async (req) => {
  try {
    const { programare_id, clinic_id } = await req.json()
    if (!programare_id || !clinic_id) {
      return new Response(JSON.stringify({ error: 'programare_id si clinic_id necesare' }), { status: 400 })
    }

    /* 1. Fetch programarea anulată */
    const progRes  = await fetch(
      `${SUPABASE_URL}/rest/v1/programari?id=eq.${programare_id}&clinic_id=eq.${clinic_id}`
      + `&select=personal_id,serviciu_id,data_programare,ora_start`,
      { headers: SB }
    )
    const prog = (await progRes.json())[0]
    if (!prog) return new Response(JSON.stringify({ skipped: 'programare negasita' }), { status: 200 })

    const { personal_id, serviciu_id, data_programare, ora_start } = prog

    /* 2. Verifică >= 24h */
    const slotTime = new Date(data_programare + 'T' + ora_start)
    if (slotTime < new Date(Date.now() + 24 * 3600 * 1000)) {
      return new Response(JSON.stringify({ skipped: 'slot < 24h' }), { status: 200 })
    }

    /* 3. Fetch medic & serviciu */
    const medRows = await (await fetch(`${SUPABASE_URL}/rest/v1/personal?id=eq.${personal_id}&select=prenume,nume,titlu,specialitate`, { headers: SB })).json()
    const med = medRows[0]
    const medicNume    = med ? ((med.titlu ? med.titlu + ' ' : '') + (med.prenume || '') + ' ' + (med.nume || '')).trim() : 'medicul dvs.'
    const specialitate = med?.specialitate || ''

    let serviciuNume = 'consultație'
    if (serviciu_id) {
      const srvRows = await (await fetch(`${SUPABASE_URL}/rest/v1/servicii?id=eq.${serviciu_id}&select=denumire`, { headers: SB })).json()
      if (srvRows[0]) serviciuNume = srvRows[0].denumire
    }

    /* 4. Găsește pacienți eligibili */
    let eligibilUrl = `${SUPABASE_URL}/rest/v1/programari`
      + `?doreste_loc_mai_devreme=eq.true`
      + `&personal_id=eq.${personal_id}`
      + `&data_programare=gt.${data_programare}`
      + `&status=neq.anulat`
      + `&id=neq.${programare_id}`
      + `&select=id,pacient_id,clinic_id`
      + `&order=id.asc`  // sortat după id, prenume vine din join

    if (serviciu_id) eligibilUrl += `&serviciu_id=eq.${serviciu_id}`

    const eligibili = await (await fetch(eligibilUrl, { headers: SB })).json()
    if (!Array.isArray(eligibili) || eligibili.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'niciun pacient eligibil' }), { status: 200 })
    }

    /* 5. Fetch date pacienți + sortare alfabetică după prenume */
    type PacientInfo = { programareId: string, clinicId: string, pacientId: string, prenume: string, email: string }
    const lista: PacientInfo[] = []

    for (const el of eligibili) {
      const pacRows = await (await fetch(`${SUPABASE_URL}/rest/v1/pacienti?id=eq.${el.pacient_id}&select=prenume,email`, { headers: SB })).json()
      const pac = pacRows[0]
      if (!pac?.email) continue
      lista.push({
        programareId: el.id,
        clinicId:     el.clinic_id || clinic_id,
        pacientId:    el.pacient_id,
        prenume:      pac.prenume || '',
        email:        pac.email,
      })
    }

    lista.sort((a, b) => a.prenume.localeCompare(b.prenume, 'ro'))

    /* 6. Inserează în coada notificari_slot cu delay de 1h */
    const now = Date.now()
    const dataFmt = fmtData(data_programare)
    const ora     = fmtOra(ora_start)

    const rows = lista.map((p, i) => ({
      programare_id:  programare_id,
      clinic_id:      clinic_id,
      pacient_id:     p.pacientId,
      programare_pac_id: p.programareId,
      prenume:        p.prenume,
      email:          p.email,
      medic_id:       personal_id,
      medic_nume:     medicNume,
      serviciu_id:    serviciu_id || null,
      serviciu_nume:  serviciuNume,
      specialitate:   specialitate,
      data_slot:      data_programare,
      ora_slot:       ora_start,
      trimite_la:     new Date(now + i * 3600 * 1000).toISOString(),
      trimis:         i === 0,  // primul se trimite imediat
    }))

    await fetch(`${SUPABASE_URL}/rest/v1/notificari_slot`, {
      method:  'POST',
      headers: { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body:    JSON.stringify(rows),
    })

    /* 7. Trimite primul email imediat */
    const first = lista[0]
    const bookingUrl = SITE + '/programareclinica.html'
      + '?medic_pref='        + encodeURIComponent(medicNume)
      + '&specialitate_pref=' + encodeURIComponent(specialitate)
      + '&serviciu_pref='     + encodeURIComponent(serviciuNume)
      + '&slot_programare_id='+ encodeURIComponent(programare_id)

    /* Trebuie notificare_id — fetch primul row inserat */
    const notRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${programare_id}&email=eq.${encodeURIComponent(first.email)}&select=id&order=creat_la.asc&limit=1`,
      { headers: SB }
    )
    const notRow = (await notRes.json())[0]
    const notificareId = notRow?.id || ''

    const urlCuId = bookingUrl + (notificareId ? '&slot_notificare_id=' + encodeURIComponent(notificareId) : '')
    const html = buildEmail({
      prenume: first.prenume, medicNume, serviciuNume, dataFmt, ora,
      bookingUrl: urlCuId,
      programareId: first.programareId,
      clinicId:     first.clinicId,
      notificareId,
    })

    await sendEmail(first.email, `S-a eliberat un loc pe ${dataFmt} la ora ${ora} — SILLEAU`, html)

    return new Response(JSON.stringify({ queued: lista.length, first_sent: first.email }), { status: 200 })
  } catch (err) {
    console.error('notifica-slot-liber error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
