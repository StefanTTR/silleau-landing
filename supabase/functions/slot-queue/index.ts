const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY = Deno.env.get('RESEND_KEY')!
const FROM_EMAIL = 'Clinica Alfa <contact@silleau.com>'
const BASE_URL   = 'https://www.silleau.com'

const SB_HEADERS = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
}

async function sbGet(path: string) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: SB_HEADERS })
  if (!r.ok) throw new Error('Supabase GET ' + r.status + ': ' + await r.text())
  return r.json()
}

async function sbPatch(path: string, body: object, representation = false) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: 'PATCH',
    headers: {
      ...SB_HEADERS,
      'Prefer': representation ? 'return=representation' : 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error('Supabase PATCH ' + r.status + ': ' + await r.text())
  return representation ? r.json() : null
}

type Grup = { programare_anulata_id: string, clinic_id: string }
type Oferta = { id: string, programare_eligibila_id: string, pacient_id: string, clinic_id: string }

Deno.serve(async (_req) => {
  try {
    const grupuri = await sbGet(
      'slot_oferte?slot_ocupat=eq.false&status=eq.pending&select=programare_anulata_id,clinic_id'
    )

    if (!Array.isArray(grupuri) || grupuri.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
    }

    const groupsMap = new Map<string, Grup>()
    for (const g of grupuri) {
      if (!g?.programare_anulata_id || !g?.clinic_id) continue
      groupsMap.set(String(g.clinic_id) + ':' + String(g.programare_anulata_id), {
        programare_anulata_id: String(g.programare_anulata_id),
        clinic_id: String(g.clinic_id),
      })
    }

    let sent = 0
    let failed = 0

    for (const batch of chunk([...groupsMap.values()], 10)) {
      const results = await Promise.allSettled(batch.map(processQueueGroup))
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value === true) sent++
        else if (result.status === 'rejected') {
          failed++
          console.error('[slot-queue] group error:', String(result.reason))
        }
      }
    }

    return new Response(JSON.stringify({ sent, failed }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

async function processQueueGroup(group: Grup): Promise<boolean> {
  const { programare_anulata_id: anulataId, clinic_id: clinicId } = group

  const ocupat = await sbGet(
    'slot_oferte?programare_anulata_id=eq.' + anulataId
    + '&clinic_id=eq.' + clinicId
    + '&slot_ocupat=eq.true&select=id&limit=1'
  )
  if (Array.isArray(ocupat) && ocupat.length > 0) return false

  const ultimTrimis = await sbGet(
    'slot_oferte?programare_anulata_id=eq.' + anulataId
    + '&clinic_id=eq.' + clinicId
    + '&email_trimis_la=not.is.null'
    + '&order=email_trimis_la.desc'
    + '&limit=1'
    + '&select=email_trimis_la'
  )

  if (!Array.isArray(ultimTrimis) || ultimTrimis.length === 0) return false

  const ultimaOra = new Date(ultimTrimis[0].email_trimis_la)
  if (Date.now() - ultimaOra.getTime() < 60 * 60 * 1000) return false

  const urmatoarele = await sbGet(
    'slot_oferte?programare_anulata_id=eq.' + anulataId
    + '&clinic_id=eq.' + clinicId
    + '&status=eq.pending'
    + '&order=pozitie.asc'
    + '&limit=1'
    + '&select=id,programare_eligibila_id,pacient_id,clinic_id'
  )

  if (!Array.isArray(urmatoarele) || urmatoarele.length === 0) return false

  const oferta = await claimOferta(urmatoarele[0])
  if (!oferta) return false

  try {
    const progAnulata = await sbGet(
      'programari?programare_id=eq.' + anulataId
      + '&clinic_id=eq.' + clinicId
      + '&select=data_programare,ora_start,ora_sfarsit,personal_id,clinic_id,serviciu_id'
    )
    if (!Array.isArray(progAnulata) || progAnulata.length === 0) {
      await releaseOferta(oferta.id, clinicId)
      return false
    }
    const pa = progAnulata[0]

    const oraStartStr = (pa.ora_start + '').slice(0, 5)
    const slotDt = new Date(pa.data_programare + 'T' + oraStartStr + ':00')
    if (slotDt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      await sbPatch(
        'slot_oferte?programare_anulata_id=eq.' + anulataId
        + '&clinic_id=eq.' + clinicId
        + '&slot_ocupat=eq.false'
        + '&status=in.(pending,processing)',
        { status: 'expirat' }
      )
      return false
    }

    const pacList = await sbGet('pacienti?id=eq.' + oferta.pacient_id + '&select=email,prenume')
    if (!Array.isArray(pacList) || pacList.length === 0) {
      await releaseOferta(oferta.id, clinicId)
      return false
    }
    const pacient = pacList[0]

    const medList = await sbGet('personal?id=eq.' + pa.personal_id + '&select=prenume,nume,titlu,specialitate')
    if (!Array.isArray(medList) || medList.length === 0) {
      await releaseOferta(oferta.id, clinicId)
      return false
    }
    const med = medList[0]
    const medicNume = ((med.titlu ? med.titlu + ' ' : '') + (med.prenume || '') + ' ' + (med.nume || '')).trim()

    let serviciuNume = ''
    if (pa.serviciu_id) {
      const servList = await sbGet('servicii?id=eq.' + pa.serviciu_id + '&select=nome')
      serviciuNume = servList[0]?.nome || ''
    }

    const progElig = await sbGet(
      'programari?programare_id=eq.' + oferta.programare_eligibila_id
      + '&clinic_id=eq.' + clinicId
      + '&select=data_programare,ora_start'
    )
    const pe = Array.isArray(progElig) && progElig.length > 0 ? progElig[0] : null

    const oraEndStr = (pa.ora_sfarsit + '').slice(0, 5)
    const locUrl = BASE_URL + '/confirmare-loc'
      + '?id='           + oferta.programare_eligibila_id
      + '&clinic_id='    + encodeURIComponent(clinicId)
      + '&sd='           + encodeURIComponent(pa.data_programare)
      + '&so='           + encodeURIComponent(oraStartStr)
      + '&slot_sfarsit=' + encodeURIComponent(oraEndStr)
      + '&medic='        + encodeURIComponent(medicNume)
      + '&oferta_id='    + oferta.id

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: pacient.email,
        subject: 'S-a eliberat un slot mai devreme — ' + pa.data_programare,
        html: buildSlotEmail({
          prenume:      pacient.prenume || '',
          medic:        medicNume,
          specialitate: med.specialitate || '',
          serviciu:     serviciuNume,
          data:         pa.data_programare,
          ora:          oraStartStr,
          curData:      pe ? (pe.data_programare || '') : '',
          curOra:       pe ? (pe.ora_start + '').slice(0, 5) : '',
          locUrl,
        }),
      }),
    })

    if (!emailRes.ok) {
      const txt = await emailRes.text()
      console.error('[slot-queue] Resend error:', emailRes.status, txt)
      await releaseOferta(oferta.id, clinicId)
      return false
    }

    await sbPatch(
      'slot_oferte?id=eq.' + oferta.id + '&clinic_id=eq.' + clinicId + '&status=eq.processing',
      {
        status: 'trimis',
        email_trimis_la: new Date().toISOString(),
      }
    )
    return true
  } catch (e) {
    await releaseOferta(oferta.id, clinicId)
    throw e
  }
}

async function claimOferta(oferta: Oferta): Promise<Oferta | null> {
  const rows = await sbPatch(
    'slot_oferte?id=eq.' + oferta.id
    + '&clinic_id=eq.' + oferta.clinic_id
    + '&status=eq.pending'
    + '&slot_ocupat=eq.false',
    { status: 'processing' },
    true
  )

  if (!Array.isArray(rows) || rows.length === 0) return null
  return rows[0] as Oferta
}

async function releaseOferta(ofertaId: string, clinicId: string) {
  await sbPatch(
    'slot_oferte?id=eq.' + ofertaId + '&clinic_id=eq.' + clinicId + '&status=eq.processing&slot_ocupat=eq.false',
    { status: 'pending' }
  )
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
function buildSlotEmail(d: {
  prenume: string, medic: string, specialitate: string, serviciu: string,
  data: string, ora: string, curData: string, curOra: string, locUrl: string
}): string {
  const serviciuRow = d.serviciu
    ? '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;width:42%;font-family:\'Helvetica Neue\',Arial,sans-serif;">Serviciu</td>'
      + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.serviciu + '</td></tr>'
    : ''

  return '<!DOCTYPE html>'
    + '<html lang="ro" xmlns:v="urn:schemas-microsoft-com:vml">'
    + '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<meta name="color-scheme" content="light dark">'
    + '<style>'
    + ':root{color-scheme:light dark;}'
    + 'body,table,td,p,span,div{margin:0;padding:0;}'
    + 'body{font-family:\'Helvetica Neue\',Arial,sans-serif;-webkit-text-size-adjust:100%;}'
    + 'table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}'
    + '.bg-outer{background-color:#ffffff;}'
    + '.bg-card{background-color:#ffffff;border:1px solid #E8E4DC;}'
    + '.text-tag{color:#BBBBBB;}.text-title{color:#111111;}.text-greet{color:#111111;}'
    + '.text-name{color:#111111;}.text-body{color:#888888;}.text-label{color:#BBBBBB;}'
    + '.text-value{color:#111111;}.text-cur{color:#CCCCCC;}.text-note{color:#CCCCCC;}'
    + '.text-note-em{color:#888888;}.text-foot-n{color:#BBBBBB;}.text-foot-s{color:#CCCCCC;}'
    + '.text-brand{color:#DDDDDD;}'
    + '.border-row{border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;}'
    + '.sep{background-color:#F0EDE8;}.border-section{border-top:1px solid #F0EDE8;}'
    + '.btn-accept{background-color:#111111!important;}.btn-accept-txt{color:#ffffff!important;}'
    + '.btn-decline{background-color:#ffffff!important;border:1px solid #E8E4DC!important;}'
    + '.btn-decline-txt{color:#888888!important;}'
    + 'a.link-email{color:#999999!important;text-decoration:underline;text-decoration-style:dotted;}'
    + '@media(prefers-color-scheme:dark){'
    + '.bg-outer{background-color:#111111!important;}'
    + '.bg-card{background-color:#111111!important;border:1px solid #1E1E1E!important;}'
    + '.text-tag{color:#444444!important;}.text-title{color:#E8E4DC!important;}'
    + '.text-greet{color:#C8C4BC!important;}.text-name{color:#E8E4DC!important;}'
    + '.text-body{color:#666666!important;}.text-label{color:#444444!important;}'
    + '.text-value{color:#C8C4BC!important;}.text-cur{color:#333333!important;}'
    + '.text-note{color:#444444!important;}.text-note-em{color:#666666!important;}'
    + '.text-foot-n{color:#555555!important;}.text-foot-s{color:#333333!important;}'
    + '.text-brand{color:#2A2A2A!important;}'
    + '.border-row{border-top:1px solid #1E1E1E!important;border-bottom:1px solid #1E1E1E!important;}'
    + '.sep{background-color:#1E1E1E!important;}'
    + '.btn-accept{background-color:#E8E4DC!important;}.btn-accept-txt{color:#111111!important;}'
    + '.btn-decline{background-color:transparent!important;border:1px solid #2A2A2A!important;}'
    + '.btn-decline-txt{color:#555555!important;}'
    + '}'
    + '@media only screen and (max-width:600px){'
    + '.wrapper{width:100%!important;}.inner{padding:28px 20px 0!important;}'
    + '.footer-td{padding:16px 20px!important;}'
    + '.btn-td{display:block!important;width:100%!important;padding:0 0 8px 0!important;}'
    + '}'
    + '</style></head>'
    + '<body class="bg-outer" style="margin:0;padding:0;background-color:#ffffff;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-outer" style="background-color:#ffffff;">'
    + '<tr><td align="center" style="padding:32px 12px;">'
    + '<table class="wrapper bg-card" width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:4px;border:1px solid #E8E4DC;">'
    + '<tr><td align="center" class="border-section" style="padding:36px 44px 28px;border-top:none;border-bottom:1px solid #F0EDE8;">'
    + '<div class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;margin-bottom:14px;">Loc disponibil</div>'
    + '<div class="text-title" style="font-size:23px;color:#111111;font-weight:300;font-family:\'Helvetica Neue\',Arial,sans-serif;letter-spacing:-0.3px;">Clinica Alfa</div>'
    + '</td></tr>'
    + '<tr><td class="inner" style="padding:36px 44px 0;">'
    + '<p style="font-size:15px;margin:0 0 6px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<span class="text-greet" style="color:#111111;">Bun\u0103 </span>'
    + '<strong class="text-name" style="color:#111111;font-weight:600;">' + d.prenume + '</strong>'
    + '<span class="text-greet" style="color:#111111;">,</span></p>'
    + '<p class="text-body" style="font-size:13px;color:#888888;line-height:1.8;margin:0 0 28px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + 'A ap\u0103rut un loc disponibil mai devreme la <strong style="color:#666666;font-weight:500;">' + d.medic + '</strong>. Dori\u021bi s\u0103 v\u0103 reprograma\u021bi mai devreme \u00een aceast\u0103 s\u0103pt\u0103m\u00e2n\u0103?'
    + '</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">'
    + '<tr><td colspan="2" style="padding:0 0 10px;">'
    + '<span class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Loc disponibil</span>'
    + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;width:42%;font-family:\'Helvetica Neue\',Arial,sans-serif;">Medic</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.medic + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">Specialitate</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.specialitate + '</td></tr>'
    + serviciuRow
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">Data</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.data + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">Ora</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.ora + '</td></tr>'
    + '</table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">'
    + '<tr><td colspan="2" style="padding:10px 0 10px;">'
    + '<span class="text-tag" style="font-size:9px;color:#CCCCCC;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Programarea dumneavoastr\u0103 actual\u0103</span>'
    + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:10px 0;font-size:10px;color:#CCCCCC;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;width:42%;font-family:\'Helvetica Neue\',Arial,sans-serif;">Data</td>'
    + '<td class="text-cur border-row" style="padding:10px 0;font-size:13px;color:#CCCCCC;text-align:right;text-decoration:line-through;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.curData + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:10px 0;font-size:10px;color:#CCCCCC;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">Ora</td>'
    + '<td class="text-cur border-row" style="padding:10px 0;font-size:13px;color:#CCCCCC;text-align:right;text-decoration:line-through;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.curOra + '</td></tr>'
    + '</table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">'
    + '<tr>'
    + '<td class="btn-td" style="width:50%;padding-right:6px;vertical-align:top;">'
    + '<a href="' + d.locUrl + '" style="display:block;text-decoration:none;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td class="btn-accept" align="center" style="background-color:#111111;border-radius:3px;padding:14px 12px;">'
    + '<span class="btn-accept-txt" style="font-size:10px;color:#ffffff;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:500;">\u2713 &nbsp;Da, vreau acest loc</span>'
    + '</td></tr></table></a></td>'
    + '<td class="btn-td" style="width:50%;padding-left:6px;vertical-align:top;">'
    + '<a href="' + d.locUrl + '" style="display:block;text-decoration:none;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td class="btn-decline" align="center" style="background-color:#ffffff;border:1px solid #E8E4DC;border-radius:3px;padding:14px 12px;">'
    + '<span class="btn-decline-txt" style="font-size:10px;color:#888888;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:500;">\u2715 &nbsp;Nu, p\u0103strez</span>'
    + '</td></tr></table></a></td>'
    + '</tr></table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td class="sep" style="height:1px;background-color:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '</table>'
    + '<p class="text-note" style="font-size:12px;color:#CCCCCC;line-height:1.9;margin:0 0 32px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + 'Oferta este valabil\u0103 pentru o perioad\u0103 limitat\u0103. Primul care confirm\u0103 prime\u015fte locul.'
    + '</p>'
    + '</td></tr>'
    + '<tr><td class="footer-td border-section" style="padding:20px 44px;border-top:1px solid #F0EDE8;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td style="vertical-align:middle;">'
    + '<div class="text-foot-n" style="font-size:12px;color:#BBBBBB;margin-bottom:2px;font-family:\'Helvetica Neue\',Arial,sans-serif;">Clinica Alfa</div>'
    + '<div class="text-foot-s" style="font-size:11px;color:#CCCCCC;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<a href="mailto:contact@silleau.com" class="link-email" style="color:#CCCCCC;text-decoration:underline;text-decoration-style:dotted;font-family:\'Helvetica Neue\',Arial,sans-serif;">contact@silleau.com</a>'
    + '</div></td>'
    + '<td style="text-align:right;vertical-align:middle;">'
    + '<div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;margin-bottom:2px;">SILLEAU Framework</div>'
    + '<div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:1px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Revenue Optimisation Systems</div>'
    + '</td></tr></table>'
    + '</td></tr>'
    + '</table></td></tr></table>'
    + '</body></html>'
}
