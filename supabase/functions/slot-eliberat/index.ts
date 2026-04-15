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
  return r.json()
}

Deno.serve(async (req) => {
  try {
    const body = await req.json()
    const {
      programare_id, clinic_id, personal_id, serviciu_id,
      data_programare, ora_start, ora_sfarsit
    } = body

    if (!programare_id || !clinic_id || !personal_id || !data_programare || !ora_start) {
      return new Response(JSON.stringify({ error: 'date incomplete' }), { status: 400 })
    }

    const oraStartStr = (ora_start + '').slice(0, 5)
    const slotDatetime = new Date(data_programare + 'T' + oraStartStr + ':00')
    if (slotDatetime.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      return new Response(JSON.stringify({ skipped: 'slot sub 24h' }), { status: 200 })
    }

    // Calculeaza limitele saptamanii
    const d = new Date(data_programare + 'T00:00:00')
    const day = d.getDay()
    const diffMon = day === 0 ? -6 : 1 - day
    const monday = new Date(d); monday.setDate(d.getDate() + diffMon)
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const weekStart = monday.toISOString().slice(0, 10)
    const weekEnd   = sunday.toISOString().slice(0, 10)

    // Gaseste programarile eligibile (doar pacienti cu opt-in)
    let eligUrl = 'programari'
      + '?clinic_id=eq.'               + clinic_id
      + '&personal_id=eq.'             + personal_id
      + '&status=in.(neconfirmat,confirmat)'
      + '&doreste_loc_mai_devreme=eq.true'
      + '&data_programare=gte.'        + weekStart
      + '&data_programare=lte.'        + weekEnd
      + '&select=programare_id,pacient_id,data_programare,ora_start,ora_sfarsit'

    if (serviciu_id) eligUrl += '&serviciu_id=eq.' + serviciu_id

    const candidati = (await sbGet(eligUrl)).filter((c: any) => {
      const cOra = (c.ora_start + '').slice(0, 5)
      if (c.data_programare > data_programare) return true
      if (c.data_programare === data_programare && cOra > oraStartStr) return true
      return false
    })

    if (!candidati.length) {
      return new Response(JSON.stringify({ eligibili: 0 }), { status: 200 })
    }

    // Fetch numele pacientilor pentru sortare alfabetica
    const pacIds = candidati.map((c: any) => c.pacient_id).join(',')
    const pacientiList = await sbGet('pacienti?id=in.(' + pacIds + ')&select=id,prenume,nume')
    const pacMap: Record<string, any> = {}
    if (Array.isArray(pacientiList)) {
      for (const p of pacientiList) pacMap[p.id] = p
    }

    // Sorteaza alfabetic dupa prenume + nume; aceasta ordine ramane intentionat alfabetica.
    const prioritizati = candidati.slice().sort((a: any, b: any) => {
      const na = ((pacMap[a.pacient_id]?.prenume || '') + ' ' + (pacMap[a.pacient_id]?.nume || '')).trim().toLowerCase()
      const nb = ((pacMap[b.pacient_id]?.prenume || '') + ' ' + (pacMap[b.pacient_id]?.nume || '')).trim().toLowerCase()
      return na.localeCompare(nb, 'ro', { sensitivity: 'base' })
    })

    // Fetch detalii medic
    const medicList = await sbGet('personal?id=eq.' + personal_id + '&select=prenume,nume,titlu,specialitate')
    const med       = medicList[0] || {}
    const medicNume = ((med.titlu ? med.titlu + ' ' : '') + (med.prenume || '') + ' ' + (med.nume || '')).trim()

    // Fetch serviciu
    let serviciuNume = ''
    if (serviciu_id) {
      const servList = await sbGet('servicii?id=eq.' + serviciu_id + '&select=nome')
      serviciuNume = servList[0]?.nome || ''
    }

    // Salveaza coada in slot_oferte
    const oferte = prioritizati.map((c: any, i: number) => ({
      programare_anulata_id:   programare_id,
      programare_eligibila_id: c.programare_id,
      pacient_id:  c.pacient_id,
      clinic_id,
      pozitie:     i + 1,
      status:      i === 0 ? 'trimis' : 'pending',
      email_trimis_la: i === 0 ? new Date().toISOString() : null,
      slot_ocupat: false,
    }))

    const insRes = await fetch(SUPABASE_URL + '/rest/v1/slot_oferte', {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify(oferte),
    })
    const insertate = await insRes.json()

    const oferta1 = Array.isArray(insertate) ? insertate.find((o: any) => o.pozitie === 1) : null
    const pac1    = prioritizati[0]

    if (oferta1 && pac1) {
      const pacList = await sbGet('pacienti?id=eq.' + pac1.pacient_id + '&select=email,prenume')
      const pacient = pacList[0]

      if (pacient) {
        const oraEndStr = (ora_sfarsit + '').slice(0, 5)
        const locUrl    = BASE_URL + '/confirmare-loc'
          + '?id='           + pac1.id
          + '&clinic_id='    + encodeURIComponent(clinic_id)
          + '&sd='           + encodeURIComponent(data_programare)
          + '&so='           + encodeURIComponent(oraStartStr)
          + '&slot_sfarsit=' + encodeURIComponent(oraEndStr)
          + '&medic='        + encodeURIComponent(medicNume)
          + '&oferta_id='    + oferta1.id

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: pacient.email,
            subject: 'S-a eliberat un slot mai devreme \u2014 ' + data_programare,
            html: buildSlotEmail({
              prenume:      pacient.prenume || '',
              medic:        medicNume,
              specialitate: med.specialitate || '',
              serviciu:     serviciuNume,
              data:         data_programare,
              ora:          oraStartStr,
              curData:      (pac1.data_programare || ''),
              curOra:       (pac1.ora_start || '').slice(0, 5),
              locUrl,
            }),
          }),
        })
      }
    }

    return new Response(JSON.stringify({ queued: prioritizati.length, sent: 1 }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

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
