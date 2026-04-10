const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const FROM_EMAIL       = 'Clinica Alfa <contact@silleau.com>'
const SITE             = 'https://www.silleau.com'

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtOra(t: string): string { return String(t).slice(0, 5) }

function buildMutareEmail(p: {
  prenume: string, medicNume: string, serviciuNume: string,
  dataNoua: string, oraNoua: string,
}): string {
  const F = "'Helvetica Neue',Arial,sans-serif"
  const CSS = ':root{color-scheme:light dark;}'
    + 'body,table,td,p,span,div{margin:0;padding:0;}'
    + `body{font-family:${F};-webkit-text-size-adjust:100%;}`
    + 'table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}'
    + '.bg-outer{background-color:#ffffff;}'
    + '.bg-card{background-color:#ffffff;border:1px solid #E8E4DC;}'
    + '.text-tag{color:#BBBBBB;}.text-title{color:#111111;}.text-greet{color:#111111;}'
    + '.text-name{color:#111111;}.text-body{color:#888888;}.text-label{color:#BBBBBB;}'
    + '.text-value{color:#111111;}.text-foot-n{color:#BBBBBB;}.text-foot-s{color:#CCCCCC;}'
    + '.text-brand{color:#DDDDDD;}.border-row{border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;}'
    + 'a.link-email{color:#999999!important;text-decoration:underline;text-decoration-style:dotted;}'
    + '@media(prefers-color-scheme:dark){'
    + '.bg-outer{background-color:#0A0A0A!important;}'
    + '.bg-card{background-color:#111111!important;border:1px solid #2A2A2A!important;}'
    + '.text-tag{color:#444444!important;}.text-title{color:#E8E4DC!important;}'
    + '.text-greet{color:#C8C4BC!important;}.text-name{color:#E8E4DC!important;}'
    + '.text-body{color:#666666!important;}.text-label{color:#444444!important;}'
    + '.text-value{color:#C8C4BC!important;}.text-foot-n{color:#555555!important;}'
    + '.text-foot-s{color:#333333!important;}.text-brand{color:#2A2A2A!important;}'
    + '.border-row{border-top:1px solid #1E1E1E!important;border-bottom:1px solid #1E1E1E!important;}'
    + 'a.link-email{color:#555555!important;}'
    + '}'
    + '[data-ogsc] .bg-outer{background-color:#0A0A0A!important;}'
    + '[data-ogsc] .bg-card{background-color:#111111!important;border:1px solid #2A2A2A!important;}'
    + '[data-ogsc] .text-tag{color:#444444!important;}'
    + '[data-ogsc] .text-title{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-greet{color:#C8C4BC!important;}'
    + '[data-ogsc] .text-name{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-value{color:#C8C4BC!important;}'
    + '@media only screen and (max-width:600px){'
    + '.wrapper{width:100%!important;}.inner{padding:28px 20px 0!important;}'
    + '.footer-td{padding:16px 20px!important;}'
    + '}'

  const lS  = `font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;width:42%;font-family:${F};padding:12px 0;`
  const vS  = `font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:${F};padding:12px 0;`
  const lST = lS + 'border-top:1px solid #F0EDE8;'
  const vST = vS + 'border-top:1px solid #F0EDE8;'

  return '<!DOCTYPE html>'
    + '<html lang="ro" xmlns:v="urn:schemas-microsoft-com:vml">'
    + `<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="color-scheme" content="light dark"><style>${CSS}</style></head>`
    + '<body class="bg-outer" style="margin:0;padding:0;background-color:#ffffff;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-outer" style="background-color:#ffffff;">'
    + '<tr><td align="center" style="padding:32px 12px;">'
    + '<table class="wrapper bg-card" width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:4px;border:1px solid #E8E4DC;">'
    // Header
    + '<tr><td align="center" style="padding:36px 44px 28px;border-bottom:1px solid #F0EDE8;">'
    + `<div class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:${F};margin-bottom:14px;">Programare mutată</div>`
    + `<div class="text-title" style="font-size:23px;color:#111111;font-weight:300;font-family:${F};letter-spacing:-0.3px;">Clinica Alfa</div>`
    + '</td></tr>'
    // Body
    + '<tr><td class="inner" style="padding:36px 44px 0;">'
    + `<p style="font-size:15px;margin:0 0 6px;font-family:${F};"><span class="text-greet" style="color:#111111;">Bună </span><strong class="text-name" style="color:#111111;font-weight:600;">${p.prenume}</strong><span class="text-greet" style="color:#111111;">,</span></p>`
    + `<p class="text-body" style="font-size:13px;color:#888888;line-height:1.8;margin:0 0 28px;font-family:${F};">Programarea dumneavoastră a fost mutată mai devreme cu succes. Vă așteptăm la data și ora indicate mai jos.</p>`
    // Detalii
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">'
    + `<tr><td class="text-label border-row" style="${lST}">Medic</td><td class="text-value border-row" style="${vST}">${p.medicNume}</td></tr>`
    + `<tr><td class="text-label border-row" style="${lS}">Serviciu</td><td class="text-value border-row" style="${vS}">${p.serviciuNume}</td></tr>`
    + `<tr><td class="text-label border-row" style="${lS}">Data</td><td class="text-value border-row" style="${vS}">${p.dataNoua}</td></tr>`
    + `<tr><td class="text-label border-row" style="${lS}">Ora</td><td class="text-value border-row" style="${vS}">${p.oraNoua}</td></tr>`
    + '</table>'
    // Separator + notă
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;"><tr><td style="height:1px;background-color:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr></table>'
    + `<p class="text-body" style="font-size:12px;color:#CCCCCC;line-height:1.9;margin:0 0 32px;font-family:${F};">Pentru orice întrebare contactați-ne la <a href="mailto:contact@silleau.com" class="link-email" style="color:#999999;text-decoration:underline;text-decoration-style:dotted;">contact@silleau.com</a>.</p>`
    + '</td></tr>'
    // Footer
    + '<tr><td class="footer-td" style="padding:20px 44px;border-top:1px solid #F0EDE8;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + `<td style="vertical-align:middle;"><div class="text-foot-n" style="font-size:12px;color:#BBBBBB;margin-bottom:2px;font-family:${F};">Clinica Alfa</div><div class="text-foot-s" style="font-size:11px;color:#CCCCCC;font-family:${F};"><a href="mailto:contact@silleau.com" class="link-email" style="color:#CCCCCC;text-decoration:underline;text-decoration-style:dotted;">contact@silleau.com</a></div></td>`
    + `<td style="text-align:right;vertical-align:middle;"><div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:2px;text-transform:uppercase;font-family:${F};margin-bottom:2px;">SILLEAU Framework</div><div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:1px;text-transform:uppercase;font-family:${F};">Revenue Optimisation Systems</div></td>`
    + '</tr></table></td></tr>'
    + '</table></td></tr></table></body></html>'
}

async function sendEmail(to: string, subject: string, html: string) {
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { notificare_id } = await req.json()
    if (!notificare_id) return json({ success: false, reason: 'notificare_id lipsa' }, 400)

    /* 1. Fetch notificarea */
    const notRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${notificare_id}&select=programare_id,programare_pac_id,data_slot,ora_slot,prenume,email,medic_nume,serviciu_nume,acceptat,anulat`,
      { headers: SB }
    )
    const notRows = await notRes.json()
    const not = Array.isArray(notRows) ? notRows[0] : null

    if (!not)       return json({ success: false, reason: 'negasit' })
    if (not.anulat) return json({ success: false, reason: 'slot_ocupat' })
    if (not.acceptat) return json({ success: true }) // deja acceptat de același pacient

    /* 2. Verifică dacă alt pacient a acceptat deja același slot */
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${not.programare_id}&acceptat=eq.true&select=id&limit=1`,
      { headers: SB }
    )
    const existing = await existRes.json()
    if (Array.isArray(existing) && existing.length > 0) {
      return json({ success: false, reason: 'slot_ocupat' })
    }

    /* 3. Marchează ca acceptat */
    await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${notificare_id}`,
      { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ acceptat: true }) }
    )

    /* 4. Anulează toate celelalte notificări netrimise pentru același slot */
    await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${not.programare_id}&id=neq.${notificare_id}&trimis=eq.false`,
      { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ anulat: true }) }
    )

    /* 5. Actualizează programarea pacientului cu noul slot */
    await fetch(
      `${SUPABASE_URL}/rest/v1/programari?id=eq.${not.programare_pac_id}`,
      {
        method:  'PATCH',
        headers: SB_POST,
        body:    JSON.stringify({ data_programare: not.data_slot, ora_start: not.ora_slot }),
      }
    )

    /* 6. Trimite email de confirmare mutare */
    const dataNoua = fmtData(not.data_slot)
    const oraNoua  = fmtOra(not.ora_slot)

    const html = buildMutareEmail({
      prenume:      not.prenume || 'Pacient',
      medicNume:    not.medic_nume || '',
      serviciuNume: not.serviciu_nume || '',
      dataNoua, oraNoua,
    })

    await sendEmail(
      not.email,
      `Programarea dumneavoastră a fost mutată pe ${dataNoua} la ora ${oraNoua}`,
      html
    )

    return json({ success: true })
  } catch (err) {
    console.error('accepta-slot error:', err)
    return json({ success: false, reason: 'eroare_interna' }, 500)
  }
})
