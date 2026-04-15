const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY = Deno.env.get('RESEND_KEY')!
const FROM_EMAIL = 'Clinica Alfa <contact@silleau.com>'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }
  try {
    const body = await req.json()
    const { programare_id, clinic_id, cur_data, cur_ora } = body

    if (!programare_id || !clinic_id) {
      return new Response(JSON.stringify({ error: 'programare_id sau clinic_id lipsa' }), { status: 400, headers: CORS })
    }

    const progList = await sbGet(
      'programari?programare_id=eq.' + programare_id
      + '&clinic_id=eq.' + clinic_id
      + '&select=data_programare,ora_start,clinic_id,'
      + 'pacient:pacienti!programari_pacient_id_fkey(email,prenume),'
      + 'medic:personal!programari_personal_id_fkey(prenume,nume,titlu,specialitate),'
      + 'serviciu:servicii!programari_serviciu_id_fkey(nome)'
    )
    if (!Array.isArray(progList) || progList.length === 0) {
      return new Response(JSON.stringify({ error: 'programare negasita' }), { status: 404, headers: CORS })
    }
    const prog = progList[0]
    const pacient = prog.pacient
    const med = prog.medic

    if (!pacient?.email) {
      return new Response(JSON.stringify({ error: 'pacient negasit' }), { status: 404, headers: CORS })
    }
    if (!med) {
      return new Response(JSON.stringify({ error: 'medic negasit' }), { status: 404, headers: CORS })
    }

    const medicNume = ((med.titlu ? med.titlu + ' ' : '') + (med.prenume || '') + ' ' + (med.nume || '')).trim()
    const serviciuNume = prog.serviciu?.nome || ''

    const slotData = (prog.data_programare || '').slice(0, 10)
    const slotOra  = (prog.ora_start || '').slice(0, 5)

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: pacient.email,
        subject: 'Programare reprogramat\u0103 \u2014 ' + slotData,
        html: buildEmail({
          prenume:      pacient.prenume || '',
          medic:        medicNume,
          specialitate: med.specialitate || '',
          serviciu:     serviciuNume,
          slotData,
          slotOra,
          curData:      cur_data || '',
          curOra:       cur_ora  || '',
        }),
      }),
    })

    if (!emailRes.ok) {
      const txt = await emailRes.text()
      return new Response(JSON.stringify({ error: 'Resend ' + emailRes.status + ': ' + txt }), { status: 500, headers: CORS })
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200, headers: CORS })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS })
  }
})

function buildEmail(d: {
  prenume: string, medic: string, specialitate: string, serviciu: string,
  slotData: string, slotOra: string, curData: string, curOra: string
}): string {
  const serviciuRow = d.serviciu
    ? '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">Serviciu</td>'
      + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.serviciu + '</td></tr>'
    : ''

  const oldDataSpan = d.curData
    ? ' &nbsp;<span class="old-val" style="font-size:11px;color:#CCCCCC;text-decoration:line-through;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.curData + '</span>'
    : ''
  const oldOraSpan = d.curOra
    ? ' &nbsp;<span class="old-val" style="font-size:11px;color:#CCCCCC;text-decoration:line-through;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.curOra + '</span>'
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
    + '.text-value{color:#111111;}.old-val{color:#CCCCCC;text-decoration:line-through;}'
    + '.text-note{color:#CCCCCC;}.text-note-em{color:#888888;}'
    + '.text-foot-n{color:#BBBBBB;}.text-foot-s{color:#CCCCCC;}.text-brand{color:#DDDDDD;}'
    + '.border-row{border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;}'
    + '.sep{background-color:#F0EDE8;}'
    + 'a.link-email{color:#999999!important;text-decoration:underline;text-decoration-style:dotted;}'
    + '@media(prefers-color-scheme:dark){'
    + '.bg-outer{background-color:#111111!important;}'
    + '.bg-card{background-color:#111111!important;border:1px solid #1E1E1E!important;}'
    + '.text-tag{color:#444444!important;}.text-title{color:#E8E4DC!important;}'
    + '.text-greet{color:#C8C4BC!important;}.text-name{color:#E8E4DC!important;}'
    + '.text-body{color:#666666!important;}.text-label{color:#444444!important;}'
    + '.text-value{color:#C8C4BC!important;}.old-val{color:#333333!important;}'
    + '.text-note{color:#444444!important;}.text-note-em{color:#666666!important;}'
    + '.text-foot-n{color:#555555!important;}.text-foot-s{color:#333333!important;}'
    + '.text-brand{color:#2A2A2A!important;}'
    + '.border-row{border-top:1px solid #1E1E1E!important;border-bottom:1px solid #1E1E1E!important;}'
    + '.sep{background-color:#1E1E1E!important;}'
    + 'a.link-email{color:#555555!important;}'
    + '}'
    + '[data-ogsc] .bg-outer{background-color:#111111!important;}'
    + '[data-ogsc] .bg-card{background-color:#111111!important;border:1px solid #1E1E1E!important;}'
    + '[data-ogsc] .text-tag{color:#444444!important;}.text-title{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-greet{color:#C8C4BC!important;}.text-name{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-body{color:#666666!important;}.text-label{color:#444444!important;}'
    + '[data-ogsc] .text-value{color:#C8C4BC!important;}.old-val{color:#333333!important;}'
    + '[data-ogsc] .text-note{color:#444444!important;}'
    + '[data-ogsc] a.link-email{color:#555555!important;}'
    + '@media only screen and (max-width:600px){'
    + '.wrapper{width:100%!important;}.inner{padding:28px 20px 0!important;}'
    + '.footer-td{padding:16px 20px!important;}'
    + '}'
    + '</style></head>'
    + '<body class="bg-outer" style="margin:0;padding:0;background-color:#ffffff;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-outer" style="background-color:#ffffff;">'
    + '<tr><td align="center" style="padding:32px 12px;">'
    + '<table class="wrapper bg-card" width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:4px;border:1px solid #E8E4DC;">'
    + '<tr><td align="center" style="padding:36px 44px 28px;border-bottom:1px solid #F0EDE8;">'
    + '<div class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;margin-bottom:14px;">Confirmare reprogramare</div>'
    + '<div class="text-title" style="font-size:23px;color:#111111;font-weight:300;font-family:\'Helvetica Neue\',Arial,sans-serif;letter-spacing:-0.3px;">Clinica Alfa</div>'
    + '</td></tr>'
    + '<tr><td class="inner" style="padding:36px 44px 0;">'
    + '<p style="font-size:15px;margin:0 0 6px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<span class="text-greet" style="color:#111111;">Bun\u0103 </span>'
    + '<strong class="text-name" style="color:#111111;font-weight:600;">' + d.prenume + '</strong>'
    + '<span class="text-greet" style="color:#111111;">,</span></p>'
    + '<p class="text-body" style="font-size:13px;color:#888888;line-height:1.8;margin:0 0 28px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + 'Programarea dumneavoastr\u0103 a fost reprogramat\u0103 cu succes la un loc disponibil mai devreme. Mai jos g\u0103si\u021bi noile detalii ale consulta\u021biei.'
    + '</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">'
    + '<tr><td colspan="2" style="padding:0 0 10px;">'
    + '<span class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Noua programare</span>'
    + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;width:42%;font-family:\'Helvetica Neue\',Arial,sans-serif;">Medic</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.medic + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">Specialitate</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.specialitate + '</td></tr>'
    + serviciuRow
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">Data</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<span class="text-value" style="color:#111111;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.slotData + '</span>' + oldDataSpan
    + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">Ora</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<span class="text-value" style="color:#111111;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.slotOra + '</span>' + oldOraSpan
    + '</td></tr>'
    + '</table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td class="sep" style="height:1px;background-color:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '</table>'
    + '<p class="text-note" style="font-size:12px;color:#CCCCCC;line-height:1.9;margin:0 0 32px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + 'V\u0103 rug\u0103m s\u0103 ajunge\u021bi cu <span class="text-note-em" style="color:#888888;">10 minute \u00eenainte</span> de ora programat\u0103. Pentru informa\u021bii suplimentare contacta\u021bi-ne la '
    + '<a href="mailto:contact@silleau.com" class="link-email" style="color:#999999;text-decoration:underline;text-decoration-style:dotted;font-family:\'Helvetica Neue\',Arial,sans-serif;">contact@silleau.com</a>.'
    + '</p>'
    + '</td></tr>'
    + '<tr><td class="footer-td" style="padding:20px 44px;border-top:1px solid #F0EDE8;">'
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
