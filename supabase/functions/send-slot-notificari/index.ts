/* Cron: rulează la fiecare oră
   Trimite urmatoarea notificare din coada notificari_slot
   dacă nimeni nu a acceptat slotul pentru programarea respectivă. */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const FROM_EMAIL       = 'Clinica Alfa <contact@silleau.com>'
const SITE             = 'https://www.silleau.com'
const FEEDBACK_FN      = 'https://wpxflbwohowigaulhxhk.supabase.co/functions/v1/save-feedback'

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
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
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0">'
    + '<tr><td style="height:1px;background:#2A2A2A;font-size:0;">&nbsp;</td></tr>'
    + '</table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td align="center" style="padding:20px 0 10px;">'
    + '<span style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Cum apreciați calitatea sistemului nostru digital?</span>'
    + '</td></tr>'
    + '<tr><td align="center" style="padding-bottom:8px;">'
    + '<table cellpadding="0" cellspacing="0"><tr>' + btns + '</tr></table>'
    + '</td></tr>'
    + '<tr><td align="center">'
    + '<span style="font-size:10px;color:#555555;font-family:\'Helvetica Neue\',Arial,sans-serif;">1 = Foarte slab &nbsp;·&nbsp; 5 = Excelent</span>'
    + '</td></tr>'
    + '</table>'
}

function buildEmail(p: {
  prenume: string, medicNume: string, serviciuNume: string,
  dataFmt: string, ora: string, bookingUrl: string,
  programareId: string, clinicId: string,
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
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 0;border-top:1px solid ${BD};">
      <p style="font-size:11px;color:${MUT};line-height:1.7;margin:0;">
        Dacă nu mai doriți să fiți notificat, ignorați acest mesaj.<br>
        <a href="mailto:contact@silleau.com" style="color:${DIM};text-decoration:underline;text-decoration-style:dotted;">contact@silleau.com</a>
      </p>
    </td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding-top:24px;">
    <span style="font-size:9px;color:#555555;letter-spacing:3px;text-transform:uppercase;font-family:${F};">POWERED BY SILLEAU — REVENUE OPTIMISATION SYSTEMS</span>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

Deno.serve(async (_req) => {
  try {
    const nowIso = new Date().toISOString()

    /* 1. Găsește notificări de trimis (trimite_la <= acum, netrimise, neanulate) */
    const pendingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot`
      + `?trimite_la=lte.${encodeURIComponent(nowIso)}`
      + `&trimis=eq.false&anulat=eq.false`
      + `&select=id,programare_id,programare_pac_id,clinic_id,pacient_id,prenume,email,medic_id,medic_nume,serviciu_id,serviciu_nume,specialitate,data_slot,ora_slot`
      + `&order=trimite_la.asc`,
      { headers: SB }
    )
    const pending = await pendingRes.json()
    if (!Array.isArray(pending) || pending.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { status: 200 })
    }

    let sent = 0; let skipped = 0

    for (const not of pending) {
      /* 2. Verifică dacă cineva a acceptat deja pentru acest slot */
      const acceptatRes = await fetch(
        `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${not.programare_id}&acceptat=eq.true&select=id&limit=1`,
        { headers: SB }
      )
      const acceptat = await acceptatRes.json()

      if (Array.isArray(acceptat) && acceptat.length > 0) {
        /* Cineva a acceptat — anulează toate restante */
        await fetch(
          `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${not.programare_id}&trimis=eq.false`,
          { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ anulat: true }) }
        )
        skipped++
        continue
      }

      /* 3. Trimite email */
      const bookingUrl = SITE + '/programareclinica.html'
        + '?medic_pref='        + encodeURIComponent(not.medic_nume || '')
        + '&specialitate_pref=' + encodeURIComponent(not.specialitate || '')
        + '&serviciu_pref='     + encodeURIComponent(not.serviciu_nume || '')
        + '&slot_programare_id='+ encodeURIComponent(not.programare_id)
        + '&slot_notificare_id='+ encodeURIComponent(not.id)

      const dataFmt = fmtData(not.data_slot)
      const ora     = fmtOra(not.ora_slot)

      const html = buildEmail({
        prenume:      not.prenume || 'Pacient',
        medicNume:    not.medic_nume || '',
        serviciuNume: not.serviciu_nume || '',
        dataFmt, ora,
        bookingUrl,
        programareId: not.programare_pac_id || not.programare_id,
        clinicId:     not.clinic_id || '',
      })

      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          from: FROM_EMAIL,
          to:   [not.email],
          subject: `S-a eliberat un loc pe ${dataFmt} la ora ${ora} — SILLEAU`,
          html,
        }),
      })

      /* 4. Marchează ca trimis */
      await fetch(
        `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${not.id}`,
        { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ trimis: true }) }
      )
      sent++
    }

    return new Response(JSON.stringify({ sent, skipped }), { status: 200 })
  } catch (err) {
    console.error('send-slot-notificari error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
