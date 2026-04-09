const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const META_WA_TOKEN    = Deno.env.get('META_WA_TOKEN')!
const META_WA_PHONE_ID = Deno.env.get('META_WA_PHONE_ID')!
const FROM_EMAIL       = 'Clinica Alfa <contact@silleau.com>'
const FEEDBACK_FN      = 'https://wpxflbwohowigaulhxhk.supabase.co/functions/v1/save-feedback'

const SB_HEADERS = {
  'apikey': SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
}

const SB_PATCH_HEADERS = {
  ...SB_HEADERS,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
}

type ReminderRow = Record<string, any>
type ProgramareMeta = { id: string, clinic_id: string, canal_comunicare: string }

Deno.serve(async (_req) => {
  try {
    const now = new Date()
    const windowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const windowEnd   = new Date(now.getTime() + 25 * 60 * 60 * 1000)
    const windowStartIso = windowStart.toISOString()
    const windowEndIso   = windowEnd.toISOString()

    const rows = await fetchReminderRows(windowStartIso, windowEndIso)

    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({
        sent: 0,
        total: 0,
        window_start: windowStartIso,
        window_end: windowEndIso,
      }), { status: 200 })
    }

    const metaMap = await fetchProgramariMeta(rows.map((row) => String(row.id || '')))

    let sent = 0
    let failed = 0

    for (const batch of chunk(rows, 10)) {
      const results = await Promise.allSettled(
        batch.map((row) => processReminder(row, metaMap[String(row.id || '')] || null))
      )

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value === true) sent++
        else failed++
      }
    }

    return new Response(JSON.stringify({
      sent,
      failed,
      total: rows.length,
      window_start: windowStartIso,
      window_end: windowEndIso,
    }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

async function fetchReminderRows(windowStartIso: string, windowEndIso: string): Promise<ReminderRow[]> {
  const baseSelect = [
    'id',
    'prenume',
    'email',
    'telefon',
    'medic',
    'specialitate',
    'serviciu',
    'data_programare',
    'ora_start',
    'status',
    'reminder_trimis',
  ].join(',')

  const timestampColumns = ['programare_ts', 'programare_at', 'slot_start', 'appointment_at', 'start_at']

  for (const column of timestampColumns) {
    const url = SUPABASE_URL + '/rest/v1/v_reminder'
      + '?select=' + encodeURIComponent(baseSelect + ',' + column)
      + '&' + column + '=gte.' + encodeURIComponent(windowStartIso)
      + '&' + column + '=lt.' + encodeURIComponent(windowEndIso)
      + '&reminder_trimis=eq.false'
      + '&status=in.(neconfirmat,confirmat)'

    const res = await fetch(url, { headers: SB_HEADERS })
    if (!res.ok) {
      const txt = await res.text()
      console.warn('[send-reminders] timestamp column', column, 'not available:', res.status, txt)
      continue
    }

    const rows = await res.json()
    if (Array.isArray(rows)) return rows
  }

  const fallbackDate = windowStartIso.slice(0, 10)
  const fallbackUrl = SUPABASE_URL + '/rest/v1/v_reminder'
    + '?select=' + encodeURIComponent(baseSelect)
    + '&data_programare=eq.' + fallbackDate
    + '&reminder_trimis=eq.false'
    + '&status=in.(neconfirmat,confirmat)'

  const fallbackRes = await fetch(fallbackUrl, { headers: SB_HEADERS })
  if (!fallbackRes.ok) {
    const txt = await fallbackRes.text()
    throw new Error('Supabase fetch error ' + fallbackRes.status + ': ' + txt)
  }

  const fallbackRows = await fallbackRes.json()
  if (!Array.isArray(fallbackRows)) return []

  return fallbackRows.filter((row) => {
    const slotIso = buildApproxSlotIso(row.data_programare, row.ora_start)
    if (!slotIso) return false
    return slotIso >= windowStartIso && slotIso < windowEndIso
  })
}

async function fetchProgramariMeta(ids: string[]): Promise<Record<string, ProgramareMeta>> {
  const cleanIds = ids.filter(Boolean)
  const map: Record<string, ProgramareMeta> = {}

  for (const batch of chunk(cleanIds, 100)) {
    const url = SUPABASE_URL + '/rest/v1/programari'
      + '?id=in.(' + batch.join(',') + ')'
      + '&select=id,clinic_id,canal_comunicare'

    const res = await fetch(url, { headers: SB_HEADERS })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error('Supabase meta fetch error ' + res.status + ': ' + txt)
    }

    const rows = await res.json()
    if (!Array.isArray(rows)) continue

    for (const row of rows) {
      if (!row?.id || !row?.clinic_id) continue
      map[String(row.id)] = {
        id: String(row.id),
        clinic_id: String(row.clinic_id),
        canal_comunicare: String(row.canal_comunicare || 'email'),
      }
    }
  }

  return map
}

async function processReminder(row: ReminderRow, meta: ProgramareMeta | null): Promise<boolean> {
  if (!row?.id || !meta?.clinic_id) {
    console.warn('[send-reminders] lipseste contextul clinic/programare pentru row:', row?.id)
    return false
  }

  let ok = false

  if (meta.canal_comunicare === 'whatsapp') {
    ok = await sendWhatsAppReminder(row, meta)
  } else {
    const dataEncoded         = encodeURIComponent(row.data_programare || '')
    const oraEncoded          = encodeURIComponent(String(row.ora_start || '').slice(0, 5))
    const medicEncoded        = encodeURIComponent(row.medic || '')
    const specialitateEncoded = encodeURIComponent(row.specialitate || '')
    const serviciuEncoded     = encodeURIComponent(row.serviciu || '')
    const prenumeEncoded      = encodeURIComponent(row.prenume || '')
    const emailEncoded        = encodeURIComponent(row.email || '')
    const telefonEncoded      = encodeURIComponent(row.telefon || '')
    const baseUrl             = 'https://www.silleau.com'
    const confirmUrl          = SUPABASE_URL + '/functions/v1/confirmare-reminder?id=' + row.id + '&clinic_id=' + meta.clinic_id
    const reprogramareUrl     = baseUrl + '/anulare?id=' + row.id
      + '&clinic_id=' + encodeURIComponent(meta.clinic_id)
      + '&action=reprogrameaza&medic=' + medicEncoded
      + '&specialitate=' + specialitateEncoded + '&serviciu=' + serviciuEncoded
      + '&prenume=' + prenumeEncoded + '&email=' + emailEncoded + '&telefon=' + telefonEncoded
    const anulareUrl          = baseUrl + '/anulare?id=' + row.id
      + '&clinic_id=' + encodeURIComponent(meta.clinic_id)
      + '&data=' + dataEncoded + '&ora=' + oraEncoded + '&medic=' + medicEncoded
      + '&specialitate=' + specialitateEncoded + '&serviciu=' + serviciuEncoded
      + '&prenume=' + prenumeEncoded + '&email=' + emailEncoded + '&telefon=' + telefonEncoded

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: row.email,
        subject: 'Reminder programare — ' + row.data_programare,
        html: buildEmail({
          prenume:         row.prenume         || '',
          medic:           row.medic           || '',
          specialitate:    row.specialitate    || '',
          serviciu:        row.serviciu        || '',
          data:            row.data_programare || '',
          ora:             String(row.ora_start || '').slice(0, 5),
          confirmUrl,
          reprogramareUrl,
          anulareUrl,
          programareId: row.id,
          clinicId:     meta.clinic_id,
        }),
      }),
    })

    if (!emailRes.ok) {
      const txt = await emailRes.text()
      console.error('[send-reminders] Resend error:', emailRes.status, txt)
    }

    ok = emailRes.ok
  }

  if (!ok) return false

  const patchRes = await fetch(
    SUPABASE_URL + '/rest/v1/programari?id=eq.' + row.id + '&clinic_id=eq.' + meta.clinic_id,
    {
      method: 'PATCH',
      headers: SB_PATCH_HEADERS,
      body: JSON.stringify({
        reminder_trimis: true,
        reminder_trimis_la: new Date().toISOString(),
      }),
    }
  )

  if (!patchRes.ok) {
    const txt = await patchRes.text()
    console.error('[send-reminders] PATCH error:', patchRes.status, txt)
    return false
  }

  return true
}

async function sendWhatsAppReminder(row: ReminderRow, meta: ProgramareMeta): Promise<boolean> {
  const to  = normalizePhoneRO(String(row.telefon || ''))
  const ora = String(row.ora_start || '').slice(0, 5)

  if (!to) {
    console.warn('[send-reminders] telefon invalid pentru programare', row.id)
    return false
  }

  const payload = 'CONFIRM|' + meta.clinic_id + '|' + row.id

  const res = await fetch(`https://graph.facebook.com/v18.0/${META_WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + META_WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'reminder_programare',
        language: { code: 'ro' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: row.prenume || '' },
              { type: 'text', text: row.medic || '' },
              { type: 'text', text: row.specialitate || '' },
              { type: 'text', text: row.data_programare || '' },
              { type: 'text', text: ora },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: '0',
            parameters: [{ type: 'payload', payload }],
          },
        ],
      },
    }),
  })

  if (!res.ok) {
    const txt = await res.text()
    console.error('[send-reminders] Meta WA error:', res.status, txt)
  }
  return res.ok
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

function buildApproxSlotIso(dataProgramare: unknown, oraStart: unknown): string | null {
  const data = String(dataProgramare || '').slice(0, 10)
  const ora  = String(oraStart || '').slice(0, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(ora)) return null

  // Conversia din ora locală România (Europe/Bucharest) în UTC.
  // Folosim noon UTC al zilei respective ca referință pentru a afla offset-ul DST.
  const [year, month, day] = data.split('-').map(Number)
  const [hours, minutes]   = ora.split(':').map(Number)

  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const noonRoStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(noonUtc)

  const [noonRoHour, noonRoMin] = noonRoStr.split(':').map(Number)
  const offsetMs = (noonRoHour * 60 + noonRoMin - 12 * 60) * 60_000

  const localMs = Date.UTC(year, month - 1, day, hours, minutes)
  return new Date(localMs - offsetMs).toISOString()
}

function normalizePhoneRO(telefon: string): string {
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
    const digits = '4' + normalized.replace(/^0/, '')
    return /^40\d{8,10}$/.test(digits) ? digits : ''
  }
  return /^\d{8,15}$/.test(normalized) ? normalized : ''
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
  serviciu: string, data: string, ora: string,
  confirmUrl: string, reprogramareUrl: string, anulareUrl: string,
  programareId: string, clinicId: string
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
    + '.btn-reprogram{background-color:#ffffff!important;border:1px solid #C8C4BC!important;}.btn-reprogram-txt{color:#555555!important;}'
    + '.btn-cancel{background-color:#ffffff!important;border:1px solid #E8E4DC!important;}'
    + '.btn-cancel-txt{color:#BBBBBB!important;}'
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
    + '.btn-reprogram{background-color:transparent!important;border:1px solid #3A3A3A!important;}.btn-reprogram-txt{color:#888888!important;}'
    + '.btn-cancel{background-color:transparent!important;border:1px solid #222222!important;}'
    + '.btn-cancel-txt{color:#444444!important;}'
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
    + '[data-ogsc] .btn-confirm{background-color:#E8E4DC!important;}'
    + '[data-ogsc] .btn-confirm-txt{color:#111111!important;}'
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
    + '<div class="text-title" style="font-size:23px;color:#111111;font-weight:600;font-family:\'Helvetica Neue\',Arial,sans-serif;letter-spacing:-0.5px;">Clinica Alfa</div>'
    + '</td></tr>'
    + '<tr><td class="inner" style="padding:36px 44px 0;">'
    + '<p style="font-size:15px;margin:0 0 6px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + '<span class="text-greet" style="color:#111111;">Bună </span>'
    + '<strong class="text-name" style="color:#111111;font-weight:700;">' + d.prenume + '</strong>'
    + '<span class="text-greet" style="color:#111111;">,</span></p>'
    + '<p class="text-body" style="font-size:13px;color:#888888;line-height:1.8;margin:0 0 28px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + 'Vă reamintim că aveți o programare <strong style="color:#666666;font-weight:500;">mâine</strong>. Sunteți rugați să confirmați prezența sau să anulați din timp dacă nu mai puteți ajunge.'
    + '</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">'
    + '<tr><td colspan="2" style="padding:0 0 10px;">'
    + '<span class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;">Detalii consultație</span>'
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
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">'
    + '<tr><td class="btn-confirm" bgcolor="#111111" style="background-color:#111111;border-radius:3px;">'
    + '<a href="' + d.confirmUrl + '" style="display:block;padding:16px 12px;font-size:11px;color:#ffffff;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:600;text-decoration:none;text-align:center;">'
    + '✓ &nbsp;Confirmă programarea'
    + '</a>'
    + '</td></tr></table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">'
    + '<tr>'
    + '<td class="btn-td" style="width:50%;padding-right:5px;vertical-align:top;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td class="btn-reprogram" style="background-color:#ffffff;border:1px solid #C8C4BC;border-radius:3px;">'
    + '<a href="' + d.reprogramareUrl + '" style="display:block;padding:13px 10px;font-size:10px;color:#555555;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:500;text-decoration:none;text-align:center;">'
    + '↺ &nbsp;Reprogramează'
    + '</a></td></tr></table></td>'
    + '<td class="btn-td" style="width:50%;padding-left:5px;vertical-align:top;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td class="btn-cancel" style="background-color:#ffffff;border:1px solid #E8E4DC;border-radius:3px;">'
    + '<a href="' + d.anulareUrl + '" style="display:block;padding:13px 10px;font-size:10px;color:#BBBBBB;letter-spacing:2px;text-transform:uppercase;font-family:\'Helvetica Neue\',Arial,sans-serif;font-weight:500;text-decoration:none;text-align:center;">'
    + '✕ &nbsp;Anulează'
    + '</a></td></tr></table></td>'
    + '</tr></table>'
    + buildRatingHtml(
        FEEDBACK_FN + '?id=' + encodeURIComponent(d.programareId) + '&clinic_id=' + encodeURIComponent(d.clinicId) + '&tip=reminder',
        'Cum apreciați calitatea sistemului nostru digital?',
        '1 = Foarte slab &nbsp;·&nbsp; 5 = Excelent'
      )
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td style="height:1px;background:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '</table>'
    + '<p class="text-note" style="font-size:12px;color:#CCCCCC;line-height:1.9;margin:0 0 32px;font-family:\'Helvetica Neue\',Arial,sans-serif;">'
    + 'Vă rugăm să ajungeți cu <span class="text-note-em" style="color:#888888;">10 minute înainte</span> de ora programată.'
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
