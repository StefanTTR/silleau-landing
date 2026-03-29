const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY = Deno.env.get('RESEND_KEY')!
const FROM_EMAIL = 'contact@silleau.com'

Deno.serve(async (_req) => {
  try {
    const now = new Date()

    // Fereastra: 24h-25h de acum (1 oră, cron rulează orar)
    const target    = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const targetEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000)

    // Data și ora în timezone România (gestionează automat ora de vară)
    const ds        = target.toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })
    const hourStart = target.toLocaleTimeString('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' })
    const hourEnd   = targetEnd.toLocaleTimeString('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' })

    const url = SUPABASE_URL + '/rest/v1/v_reminder'
      + '?data_programare=eq.' + ds
      + '&ora_start=gte.' + hourStart
      + '&ora_start=lt.'  + hourEnd
      + '&reminder_trimis=eq.false'
      + '&status=in.(neconfirmat,confirmat)'

    const res = await fetch(url, {
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
      },
    })

    if (!res.ok) {
      const txt = await res.text()
      throw new Error('Supabase fetch error ' + res.status + ': ' + txt)
    }

    const rows = await res.json()

    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ sent: 0, window: ds + ' ' + hourStart + '-' + hourEnd }), { status: 200 })
    }

    let sent = 0
    for (const row of rows) {
      const dataEncoded  = encodeURIComponent(row.data_programare)
      const oraEncoded   = encodeURIComponent((row.ora_start || '').slice(0, 5))
      const medicEncoded = encodeURIComponent(row.medic || '')
      const baseUrl      = 'https://www.silleau.com'

      const confirmUrl = baseUrl + '/confirmare?id=' + row.id + '&data=' + dataEncoded + '&ora=' + oraEncoded + '&medic=' + medicEncoded
      const anulareUrl = baseUrl + '/anulare?id='    + row.id + '&data=' + dataEncoded + '&ora=' + oraEncoded + '&medic=' + medicEncoded

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + RESEND_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: row.email,
          subject: 'Reminder programare — ' + row.data_programare,
          html: buildEmail({
            prenume:      row.prenume      || '',
            medic:        row.medic        || '',
            specialitate: row.specialitate || '',
            serviciu:     row.serviciu     || '',
            data:         row.data_programare || '',
            ora:          (row.ora_start   || '').slice(0, 5),
            confirmUrl,
            anulareUrl,
          }),
        }),
      })

      if (emailRes.ok) {
        await fetch(
          SUPABASE_URL + '/rest/v1/programari?id=eq.' + row.id,
          {
            method: 'PATCH',
            headers: {
              'apikey': SERVICE_ROLE_KEY,
              'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ reminder_trimis: true, reminder_trimis_la: new Date().toISOString() }),
          }
        )
        sent++
      }
    }

    return new Response(JSON.stringify({ sent, total: rows.length, window: ds + ' ' + hourStart + '-' + hourEnd }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

function buildEmail(d: {
  prenume: string, medic: string, specialitate: string,
  serviciu: string, data: string, ora: string,
  confirmUrl: string, anulareUrl: string
}): string {
  const serviciuRow = d.serviciu
    ? '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:\'Helvetica Neue\',Arial,sans-serif;">Serviciu</td>'
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
    + '.text-value{color:#111111;}.text-note{color:#CCCCCC;}.text-note-em{color:#888888;}'
    + '.text-foot-n{color:#BBBBBB;}.text-foot-s{color:#CCCCCC;}.text-brand{color:#DDDDDD;}'
    + '.border-row{border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;}'
    + '.btn-confirm{background-color:#111111!important;}.btn-confirm-txt{color:#ffffff!important;}'
    + '.btn-cancel{background-color:#ffffff!important;border:1px solid #E8E4DC!important;}'
    + '.btn-cancel-txt{color:#888888!important;}'
    + 'a.link-email{color:#999999!important;text-decoration:underline;text-decoration-style:dotted;}'
    + '@media(prefers-color-scheme:dark){'
    + '.bg-outer{background-color:#111111!important;}'
    + '.bg-card{background-color:#111111!important;border:1px solid #1E1E1E!important;}'
    + '.text-tag{color:#444444!important;}.text-title{color:#E8E4DC!important;}'
    + '.text-greet{color:#C8C4BC!important;}.text-name{color:#E8E4DC!important;}'
    + '.text-body{color:#666666!important;}.text-label{color:#444444!important;}'
    + '.text-value{color:#C8C4BC!important;}.text-note{color:#444444!important;}'
    + '.text-note-em{color:#666666!important;}.text-foot-n{color:#555555!important;}'
    + '.text-foot-s{color:#333333!important;}.text-brand{color:#2A2A2A!important;}'
    + '.border-row{border-top:1px solid #1E1E1E!important;border-bottom:1px solid #1E1E1E!important;}'
    + '.btn-confirm{background-color:#E8E4DC!important;}.btn-confirm-txt{color:#111111!important;}'
    + '.btn-cancel{background-color:transparent!important;border:1px solid #2A2A2A!important;}'
    + '.btn-cancel-txt{color:#555555!important;}'
    + 'a.link-email{color:#555555!important;}'
    + '}'
    + '[data-ogsc] .bg-outer{background-color:#111111!important;}'
    + '[data-ogsc] .bg-card{background-color:#111111!important;border:1px solid #1E1E1E!important;}'
    + '[data-ogsc] .text-tag{color:#444444!important;}.text-title{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-greet{color:#C8C4BC!important;}.text-name{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-body{color:#666666!important;}.text-label{color:#444444!important;}'
    + '[data-ogsc] .text-value{color:#C8C4BC!important;}.text-note{color:#444444!important;}'
    + '[data-ogsc] .btn-confirm{background-color:#E8E4DC!important;}.btn-confirm-txt{color:#111111!important;}'
    + '[data-ogsc] a.link-email{color:#555555!important;}'
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
    + '<tr><td align="center" style="padding:36px 44px 28px;border-bottom:1px solid #F0EDE8;">'
    + '<div class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;margin-bottom:14px;">Reminder programare</div>'
    + '<div class="text-title" style="font-size:23px;color:#111111;font-weight:300;font-family:\'Helvetica Neue\',Arial,sans-serif;letter-spacing:-0.3px;">Clinica Alfa</div>'
    + '</td></tr>'
    + '<tr><td class="inner" style="padding:36px 44px 0;">'
    + '<p style="font-size:15px;margin:0 0 6px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<span class="text-greet" style="color:#111111;">Bun\u0103 </span>'
    + '<strong class="text-name" style="color:#111111;font-weight:600;">' + d.prenume + '</strong>'
    + '<span class="text-greet" style="color:#111111;">,</span></p>'
    + '<p class="text-body" style="font-size:13px;color:#888888;line-height:1.8;margin:0 0 28px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + 'V\u0103 reamintim c\u0103 ave\u021bi o programare <strong style="color:#666666;font-weight:500;">m\u00e2ine</strong>. Sunte\u021bi ruga\u021bi s\u0103 confirma\u021bi prezen\u021ba sau s\u0103 anula\u021bi din timp dac\u0103 nu mai pute\u021bi ajunge.'
    + '</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">'
    + '<tr><td colspan="2" style="padding:0 0 10px;">'
    + '<span class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Detalii consulta\u021bie</span>'
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
    + '<tr>'
    + '<td class="btn-td" style="width:50%;padding-right:6px;vertical-align:top;">'
    + '<a href="' + d.confirmUrl + '" style="display:block;text-decoration:none;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td class="btn-confirm" align="center" style="background-color:#111111;border-radius:3px;padding:14px 12px;">'
    + '<span class="btn-confirm-txt" style="font-size:10px;color:#ffffff;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:500;">\u2713 &nbsp;Confirm\u0103 programarea</span>'
    + '</td></tr></table></a></td>'
    + '<td class="btn-td" style="width:50%;padding-left:6px;vertical-align:top;">'
    + '<a href="' + d.anulareUrl + '" style="display:block;text-decoration:none;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td class="btn-cancel" align="center" style="background-color:#ffffff;border:1px solid #E8E4DC;border-radius:3px;padding:14px 12px;">'
    + '<span class="btn-cancel-txt" style="font-size:10px;color:#888888;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:500;">\u2715 &nbsp;Anuleaz\u0103</span>'
    + '</td></tr></table></a></td>'
    + '</tr></table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td style="height:1px;background:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '</table>'
    + '<p class="text-note" style="font-size:12px;color:#CCCCCC;line-height:1.9;margin:0 0 32px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + 'V\u0103 rug\u0103m s\u0103 ajunge\u021bi cu <span class="text-note-em" style="color:#888888;">10 minute \u00eenainte</span> de ora programat\u0103.'
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
