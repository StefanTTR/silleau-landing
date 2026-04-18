const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM_EMAIL       = 'Clinica Alfa <contact@silleau.com>'
const FEEDBACK_FN     = 'https://wpxflbwohowigaulhxhk.supabase.co/functions/v1/save-feedback'
const SITE            = 'https://www.silleau.com'
const META_WA_TOKEN   = Deno.env.get('META_WA_TOKEN')!
const META_WA_PHONE_ID = Deno.env.get('META_WA_PHONE_ID')!

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }
  try {
    const body = await req.json()
    const {
      tip,
      canal,
      email,
      telefon,
      prenume,
      medic,
      specialitate,
      serviciu,
      data,
      data_iso,
      ora,
      rechemare,
      programare_id,
      clinic_id,
      sub24h,
    } = body
    const isReprogramare = tip === 'reprogramare'

    if (!isNonEmptyString(prenume) || !isNonEmptyString(medic) || !isValidDate(data) || !isValidTime(ora)) {
      return new Response(JSON.stringify({ error: 'date incomplete sau invalide' }), { status: 400, headers: CORS })
    }

    const canalFinal = canal === 'whatsapp' ? 'whatsapp' : canal === 'email' || canal == null ? 'email' : ''
    if (!canalFinal) {
      return new Response(JSON.stringify({ error: 'canal invalid' }), { status: 400, headers: CORS })
    }

    if (canalFinal === 'whatsapp') {
      if (!isNonEmptyString(telefon)) {
        return new Response(JSON.stringify({ error: 'telefon lipsa pentru whatsapp' }), { status: 400, headers: CORS })
      }
      if (!isNonEmptyString(programare_id) || !isNonEmptyString(clinic_id)) {
        return new Response(JSON.stringify({ error: 'programare_id si clinic_id sunt obligatorii pentru whatsapp' }), { status: 400, headers: CORS })
      }

      const to = normalizePhone(telefon)
      if (!to) {
        return new Response(JSON.stringify({ error: 'telefon invalid' }), { status: 400, headers: CORS })
      }

      await sendWhatsApp(to, {
        prenume,
        medic,
        specialitate: specialitate || '',
        serviciu: serviciu || '',
        data,
        ora,
        rechemare: rechemare || '',
        programareId: programare_id,
        clinicId: clinic_id,
      })
    } else {
      if (!isValidEmail(email)) {
        return new Response(JSON.stringify({ error: 'email lipsa sau invalid' }), { status: 400, headers: CORS })
      }
      const theme = await fetchClinicTheme(clinic_id)
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: email,
          subject: (isReprogramare ? 'Confirmare reprogramare — ' : 'Confirmare programare — ') + fmtData(data),
          html: buildEmail({ prenume, medic, specialitate: specialitate || '', serviciu: serviciu || '', data: fmtData(data), data_iso: data_iso || data, ora, rechemare: rechemare || '', programare_id, clinic_id, isReprogramare, sub24h: isWithin24h(data_iso || data, ora), email: email || '', telefon: telefon || '', theme }),
        }),
      })
      if (!emailRes.ok) {
        const txt = await emailRes.text()
        return new Response(JSON.stringify({ error: 'Resend ' + emailRes.status + ': ' + txt }), { status: 500, headers: CORS })
      }
    }

    return new Response(JSON.stringify({ sent: true }), { status: 200, headers: CORS })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS })
  }
})

type ClinicTheme = {
  acc:          string   // culoare accent (borduri, separator, buton dark)
  accLight:     string   // versiune deschisă pentru separator rânduri
  btnBg:        string   // fundal buton Confirmă (light mode)
  clinicName:   string   // nume afișat în mail
  emailContact: string   // email contact afișat în footer
  hideBrand:    boolean  // ascunde branding SILLEAU din footer email
}

const THEME_DEFAULT: ClinicTheme = {
  acc:          '#E8E4DC',
  accLight:     '#F0EDE8',
  btnBg:        '#111111',
  clinicName:   'Clinica',
  emailContact: 'contact@silleau.com',
  hideBrand:    false,
}

async function fetchClinicTheme(clinicId: string | undefined): Promise<ClinicTheme> {
  if (!clinicId) return THEME_DEFAULT
  try {
    const headers = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
    const [bRes, cRes] = await Promise.all([
      fetch(SUPABASE_URL + '/rest/v1/clinic_branding?clinic_id=eq.' + encodeURIComponent(clinicId) + '&status=eq.approved&select=tema,nume_afisat,hide_silleau', { headers }),
      fetch(SUPABASE_URL + '/rest/v1/clinici?id=eq.' + encodeURIComponent(clinicId) + '&select=nume,email', { headers }),
    ])
    const bRows = bRes.ok ? await bRes.json() : []
    const cRows = cRes.ok ? await cRes.json() : []
    const b = Array.isArray(bRows) ? bRows[0] : null
    const c = Array.isArray(cRows) ? cRows[0] : null
    const t = b?.tema || {}
    return {
      acc:          t.acc           || THEME_DEFAULT.acc,
      accLight:     t.acc_light     || THEME_DEFAULT.accLight,
      btnBg:        t.bg            || THEME_DEFAULT.btnBg,
      clinicName:   b?.nume_afisat  || c?.nume  || THEME_DEFAULT.clinicName,
      emailContact: t.email_contact || c?.email || THEME_DEFAULT.emailContact,
      hideBrand:    !!b?.hide_silleau,
    }
  } catch {
    return THEME_DEFAULT
  }
}

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/* Verifică dacă ora_start a programării (timezone România) e la mai puțin de 24h față de acum. */
function isWithin24h(dataIso: string, oraStart: string): boolean {
  try {
    const [year, month, day] = dataIso.split('-').map(Number)
    const [hours, minutes]   = oraStart.slice(0, 5).split(':').map(Number)
    // Determinăm offset-ul României la acea dată prin conversia prânzului UTC
    const noonUtc   = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
    const noonRoStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(noonUtc)
    const [noonH, noonM] = noonRoStr.split(':').map(Number)
    const offsetMs  = (noonH * 60 + noonM - 720) * 60_000
    const slotUtcMs = Date.UTC(year, month - 1, day, hours, minutes) - offsetMs
    return (slotUtcMs - Date.now()) < 24 * 60 * 60 * 1_000
  } catch {
    return false
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isValidEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

function isValidDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

function isValidTime(v: unknown): v is string {
  return typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)
}

function normalizePhone(telefon: string): string {
  const normalized = telefon.replace(/[^\d+]/g, '')
  if (!normalized) return ''
  if (normalized.startsWith('+')) {
    const digits = normalized.slice(1)
    return /^\d{8,15}$/.test(digits) ? digits : ''
  }
  if (normalized.startsWith('00')) {
    const digits = normalized.slice(2)
    return /^\d{8,15}$/.test(digits) ? digits : ''
  }
  if (normalized.startsWith('40')) {
    return /^40\d{8,10}$/.test(normalized) ? normalized : ''
  }
  if (normalized.startsWith('0')) {
    const ro = '4' + normalized.replace(/^0/, '')
    return /^40\d{8,10}$/.test(ro) ? ro : ''
  }
  return /^\d{8,15}$/.test(normalized) ? normalized : ''
}

async function sendWhatsApp(to: string, d: {
  prenume: string, medic: string, specialitate: string,
  serviciu: string, data: string, ora: string, rechemare: string,
  programareId: string, clinicId: string,
}) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${META_WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + META_WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'confrimare_programare',
        language: { code: 'ro' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: d.prenume },
            { type: 'text', text: d.medic },
            { type: 'text', text: d.specialitate },
            { type: 'text', text: d.serviciu || '—' },
            { type: 'text', text: d.data },
            { type: 'text', text: d.ora },
            { type: 'text', text: d.rechemare || '—' },
          ]
        }]
      }
    })
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error('Meta WA ' + res.status + ': ' + txt)
  }

  const contextMessage = [
    'Pentru confirmări și feedback, păstrați acest mesaj ca referință.',
    'programare_id=' + d.programareId,
    'clinic_id=' + d.clinicId,
  ].join('\n')

  const contextRes = await fetch(`https://graph.facebook.com/v18.0/${META_WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + META_WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: contextMessage,
      },
    })
  })

  if (!contextRes.ok) {
    const txt = await contextRes.text()
    throw new Error('Meta WA context ' + contextRes.status + ': ' + txt)
  }
}

function buildWhatsApp(d: {
  prenume: string, medic: string, specialitate: string,
  serviciu: string, data: string, ora: string, rechemare: string
}): string {
  const lines = [
    `Bun\u0103 ${d.prenume},`,
    '',
    'Programarea dumneavoastr\u0103 a fost confirmat\u0103 \u2714',
    '',
    '\ud83d\udccb Detalii consulta\u021bie:',
    `\u2022 Medic: ${d.medic}${d.specialitate ? ' \u2014 ' + d.specialitate : ''}`,
  ]
  if (d.serviciu) lines.push(`\u2022 Serviciu: ${d.serviciu}`)
  lines.push(`\u2022 Data: ${d.data}`)
  lines.push(`\u2022 Ora: ${d.ora}`)
  if (d.rechemare) lines.push(`\u2022 Urm\u0103toarea consulta\u021bie: ${d.rechemare}`)
  lines.push('')
  lines.push('V\u0103 rug\u0103m s\u0103 ajunge\u021bi cu 10 minute \u00eenainte.')
  lines.push('Reprogramare: contact@silleau.com')
  lines.push('')
  lines.push('\u2014 Clinica Alfa')
  return lines.join('\n')
}

function buildActionButtons(
  programareId: string, clinicId: string, dataIso: string, ora: string,
  medic: string, specialitate: string, serviciu: string,
  prenume: string, email: string, telefon: string
): string {
  const confirmUrl     = SUPABASE_URL + '/functions/v1/confirmare-reminder?id=' + encodeURIComponent(programareId) + '&clinic_id=' + encodeURIComponent(clinicId)
  const reprogramareUrl = SITE + '/anulare?id=' + encodeURIComponent(programareId)
    + '&clinic_id=' + encodeURIComponent(clinicId)
    + '&action=reprogrameaza'
    + '&medic=' + encodeURIComponent(medic)
    + '&specialitate=' + encodeURIComponent(specialitate)
    + '&serviciu=' + encodeURIComponent(serviciu)
    + '&prenume=' + encodeURIComponent(prenume)
    + '&email=' + encodeURIComponent(email)
    + '&telefon=' + encodeURIComponent(telefon)
  const anulareUrl     = SITE + '/anulare?id=' + encodeURIComponent(programareId)
    + '&clinic_id=' + encodeURIComponent(clinicId)
    + '&data=' + encodeURIComponent(dataIso)
    + '&ora=' + encodeURIComponent(ora.slice(0, 5))
    + '&medic=' + encodeURIComponent(medic)
    + '&specialitate=' + encodeURIComponent(specialitate)
    + '&serviciu=' + encodeURIComponent(serviciu)
    + '&prenume=' + encodeURIComponent(prenume)
    + '&email=' + encodeURIComponent(email)
    + '&telefon=' + encodeURIComponent(telefon)

  return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">'
    + '<tr><td bgcolor="#111111" style="background-color:#111111;border-radius:3px;">'
    + '<a href="' + confirmUrl + '" style="display:block;padding:16px 12px;font-size:11px;color:#ffffff;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:600;text-decoration:none;text-align:center;">'
    + '\u2713 &nbsp;Confirm\u0103 programarea'
    + '</a></td></tr></table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">'
    + '<tr><td style="background-color:#ffffff;border:1px solid #C8C4BC;border-radius:3px;">'
    + '<a href="' + reprogramareUrl + '" style="display:block;padding:13px 10px;font-size:10px;color:#555555;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:500;text-decoration:none;text-align:center;">'
    + '\u21ba &nbsp;Reprogrameaz\u0103'
    + '</a></td></tr></table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">'
    + '<tr><td style="background-color:#ffffff;border:1px solid #E8E4DC;border-radius:3px;">'
    + '<a href="' + anulareUrl + '" style="display:block;padding:13px 10px;font-size:10px;color:#BBBBBB;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:500;text-decoration:none;text-align:center;">'
    + '\u2715 &nbsp;Anuleaz\u0103'
    + '</a></td></tr></table>'
}

function buildRatingHtml(baseUrl: string, question: string, legend: string): string {
  let btns = ''
  for (let i = 1; i <= 5; i++) {
    btns += '<td style="padding:0 3px;">'
      + '<a href="' + baseUrl + '&rating=' + i + '" style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;background:#F5F4F2;color:#555555;font-size:13px;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:500;text-decoration:none;border-radius:50%;border:1px solid #E0DDD8;">' + i + '</a>'
      + '</td>'
  }
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:0;">'
    + '<tr><td style="height:1px;background:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '</table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td align="center" style="padding:20px 0 10px;">'
    + '<span style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + question + '</span>'
    + '</td></tr>'
    + '<tr><td align="center" style="padding-bottom:8px;">'
    + '<table cellpadding="0" cellspacing="0" border="0"><tr>' + btns + '</tr></table>'
    + '</td></tr>'
    + '<tr><td align="center">'
    + '<span style="font-size:10px;color:#CCCCCC;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + legend + '</span>'
    + '</td></tr>'
    + '</table>'
}

function buildEmail(d: {
  prenume: string, medic: string, specialitate: string,
  serviciu: string, data: string, data_iso: string, ora: string, rechemare: string,
  email: string, telefon: string,
  programare_id?: string, clinic_id?: string, isReprogramare?: boolean, sub24h?: boolean,
  theme?: ClinicTheme
}): string {
  const th = d.theme || THEME_DEFAULT
  const acc          = th.acc
  const accLight     = th.accLight
  const btnBg        = th.btnBg
  const clinicName   = th.clinicName
  const emailContact = th.emailContact
  const serviciuRow = d.serviciu
    ? '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">Serviciu</td>'
      + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.serviciu + '</td></tr>'
    : ''

  const rechemareRow = d.rechemare
    ? '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-top:1px solid ' + accLight + ';border-bottom:1px solid ' + accLight + ';width:55%;font-family:\'Helvetica Neue\',Arial,sans-serif;">Urm\u0103toarea consulta\u021bie</td>'
      + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-top:1px solid ' + accLight + ';border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.rechemare + '</td></tr>'
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
    + '.bg-card{background-color:#ffffff;border:1px solid ' + acc + ';}'
    + '.text-tag{color:#BBBBBB;}.text-title{color:#111111;}.text-greet{color:#111111;}'
    + '.text-name{color:#111111;}.text-body{color:#888888;}.text-label{color:#BBBBBB;}'
    + '.text-value{color:#111111;}.text-note{color:#CCCCCC;}.text-note-em{color:#888888;}'
    + '.text-foot-n{color:#BBBBBB;}.text-foot-s{color:#CCCCCC;}.text-brand{color:#DDDDDD;}'
    + '.border-row{border-top:1px solid ' + accLight + ';border-bottom:1px solid ' + accLight + ';}'
    + '.sep{background-color:' + accLight + ';}'
    + 'a.link-email{color:#999999!important;text-decoration:underline;text-decoration-style:dotted;}'
    + '@media(prefers-color-scheme:dark){'
    + '.bg-outer{background-color:#111111!important;}'
    + '.bg-card{background-color:#111111!important;border:1px solid #1E1E1E!important;}'
    + '.text-tag{color:#444444!important;}'
    + '.text-title{color:' + acc + '!important;}'
    + '.text-greet{color:#C8C4BC!important;}'
    + '.text-name{color:' + acc + '!important;}'
    + '.text-body{color:#666666!important;}'
    + '.text-label{color:#444444!important;}'
    + '.text-value{color:#C8C4BC!important;}'
    + '.text-note{color:#444444!important;}'
    + '.text-note-em{color:#666666!important;}'
    + '.text-foot-n{color:#555555!important;}'
    + '.text-foot-s{color:#333333!important;}'
    + '.text-brand{color:#2A2A2A!important;}'
    + '.border-row{border-top:1px solid #1E1E1E!important;border-bottom:1px solid #1E1E1E!important;}'
    + '.sep{background-color:#1E1E1E!important;}'
    + 'a.link-email{color:#555555!important;}'
    + '}'
    + '[data-ogsc] .bg-outer{background-color:#111111!important;}'
    + '[data-ogsc] .bg-card{background-color:#111111!important;border:1px solid #1E1E1E!important;}'
    + '[data-ogsc] .text-tag{color:#444444!important;}'
    + '[data-ogsc] .text-title{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-greet{color:#C8C4BC!important;}'
    + '[data-ogsc] .text-name{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-body{color:#666666!important;}'
    + '[data-ogsc] .text-label{color:#444444!important;}'
    + '[data-ogsc] .text-value{color:#C8C4BC!important;}'
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
    + '<table class="wrapper bg-card" width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:4px;border:1px solid ' + acc + ';">'
    + '<tr><td align="center" style="padding:36px 44px 28px;border-bottom:1px solid ' + accLight + ';">'
    + '<div class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;margin-bottom:14px;">' + (d.isReprogramare ? 'Confirmare reprogramare' : 'Confirmare programare') + '</div>'
    + '<div class="text-title" style="font-size:23px;color:#111111;font-weight:300;font-family:\'Helvetica Neue\',Arial,sans-serif;letter-spacing:-0.3px;">' + clinicName + '</div>'
    + '</td></tr>'
    + '<tr><td class="inner" style="padding:36px 44px 0;">'
    + '<p style="font-size:15px;margin:0 0 6px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<span class="text-greet" style="color:#111111;">Bună </span>'
    + '<strong class="text-name" style="color:#111111;font-weight:600;">' + d.prenume + '</strong>'
    + '<span class="text-greet" style="color:#111111;">,</span></p>'
    + '<p class="text-body" style="font-size:13px;color:#888888;line-height:1.8;margin:0 0 28px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + (d.isReprogramare ? 'Reprogramarea dumneavoastr\u0103 a fost confirmat\u0103 cu succes. Mai jos g\u0103si\u021bi detaliile.' : 'Programarea dumneavoastr\u0103 a fost confirmat\u0103 cu succes. Mai jos g\u0103si\u021bi detaliile consulta\u021biei.')
    + '</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">'
    + '<tr><td colspan="2" style="padding:0 0 10px;">'
    + '<span class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Detalii consulta\u021bie</span>'
    + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-top:1px solid ' + accLight + ';border-bottom:1px solid ' + accLight + ';width:42%;font-family:\'Helvetica Neue\',Arial,sans-serif;">Medic</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-top:1px solid ' + accLight + ';border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.medic + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">Specialitate</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.specialitate + '</td></tr>'
    + serviciuRow
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">Data</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.data + '</td></tr>'
    + '<tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">Ora</td>'
    + '<td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid ' + accLight + ';font-family:\'Helvetica Neue\',Arial,sans-serif;">' + d.ora + '</td></tr>'
    + '</table>'
    + (rechemareRow
      ? '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">' + rechemareRow + '</table>'
      : '')
    + (d.sub24h && d.programare_id && d.clinic_id ? buildActionButtons(d.programare_id, d.clinic_id, d.data_iso, d.ora, d.medic, d.specialitate, d.serviciu, d.prenume, d.email, d.telefon) : '')
    + (d.programare_id ? buildRatingHtml(
        FEEDBACK_FN + '?id=' + encodeURIComponent(d.programare_id) + '&clinic_id=' + encodeURIComponent(d.clinic_id) + '&sursa=' + (d.isReprogramare ? 'reprogramare' : 'booking'),
        d.isReprogramare ? 'Cât de ușor ați făcut reprogramarea?' : 'Cât de ușor ați făcut programarea?',
        '1 = Foarte greu &nbsp;·&nbsp; 5 = Foarte ușor'
      ) : '')
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td class="sep" style="height:1px;background-color:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '</table>'
    + '<p class="text-note" style="font-size:12px;color:#CCCCCC;line-height:1.9;margin:0 0 32px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + 'V\u0103 rug\u0103m s\u0103 ajunge\u021bi cu <span class="text-note-em" style="color:#888888;">10 minute \u00eenainte</span> de ora stabilit\u0103. Pentru alte informa\u021bii contacta\u021bi-ne la '
    + '<a href="mailto:' + emailContact + '" class="link-email" style="color:#999999;text-decoration:underline;text-decoration-style:dotted;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + emailContact + '</a>.'
    + '</p>'
    + '</td></tr>'
    + '<tr><td class="footer-td" style="padding:20px 44px;border-top:1px solid #F0EDE8;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td style="vertical-align:middle;">'
    + '<div class="text-foot-n" style="font-size:12px;color:#BBBBBB;margin-bottom:2px;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + clinicName + '</div>'
    + '<div class="text-foot-s" style="font-size:11px;color:#CCCCCC;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<a href="mailto:' + emailContact + '" class="link-email" style="color:#CCCCCC;text-decoration:underline;text-decoration-style:dotted;font-family:\'Helvetica Neue\',Arial,sans-serif;">' + emailContact + '</a>'
    + '</div></td>'
    + (th.hideBrand ? '' :
        '<td style="text-align:right;vertical-align:middle;">'
        + '<div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;margin-bottom:2px;">SILLEAU Framework</div>'
        + '<div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:1px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Revenue Optimisation Systems</div>'
        + '</td>')
    + '</tr></table>'
    + '</td></tr>'
    + '</table></td></tr></table>'
    + '</body></html>'
}
