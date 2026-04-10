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

function buildEmail(p: {
  prenume: string, medicNume: string, serviciuNume: string,
  dataSlot: string, oraSlot: string,
  dataPac: string, oraPac: string,
  bookingUrl: string,
  programareId: string, clinicId: string,
}): string {
  const F = '\'Helvetica Neue\',Arial,sans-serif'

  const CSS = ':root{color-scheme:light dark;}'
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
    + '.sep{background-color:#F0EDE8;}'
    + '.btn-slot{background-color:#111111!important;}'
    + '.btn-slot-txt{color:#ffffff!important;}'
    + '.old-label{color:#DDDDDD;}.old-value{color:#DDDDDD;}'
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
    + '.sep{background-color:#1E1E1E!important;}'
    + '.btn-slot{background-color:#E8E4DC!important;}.btn-slot-txt{color:#111111!important;}'
    + '.old-label{color:#3A3A3A!important;}.old-value{color:#3A3A3A!important;}'
    + 'a.link-email{color:#555555!important;}'
    + '}'
    + '[data-ogsc] .bg-outer{background-color:#111111!important;}'
    + '[data-ogsc] .bg-card{background-color:#111111!important;border:1px solid #1E1E1E!important;}'
    + '[data-ogsc] .text-tag{color:#444444!important;}.text-title{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-greet{color:#C8C4BC!important;}'
    + '[data-ogsc] .text-name{color:#E8E4DC!important;}'
    + '[data-ogsc] .text-value{color:#C8C4BC!important;}'
    + '[data-ogsc] .btn-slot{background-color:#E8E4DC!important;}'
    + '[data-ogsc] .btn-slot-txt{color:#111111!important;}'
    + '[data-ogsc] a.link-email{color:#555555!important;}'
    + '@media only screen and (max-width:600px){'
    + '.wrapper{width:100%!important;}.inner{padding:28px 20px 0!important;}'
    + '.footer-td{padding:16px 20px!important;}'
    + '}'

  const labelStyle = `font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;width:42%;font-family:${F};padding:12px 0;`
  const valueStyle = `font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:${F};padding:12px 0;`
  const labelStyleTop = labelStyle + 'border-top:1px solid #F0EDE8;'
  const valueStyleTop = valueStyle + 'border-top:1px solid #F0EDE8;'

  const ratingUrl = FEEDBACK_FN
    + '?id=' + encodeURIComponent(p.programareId)
    + '&clinic_id=' + encodeURIComponent(p.clinicId)
    + '&tip=slot_liber&sursa=slot_liber'

  let ratingBtns = ''
  for (let i = 1; i <= 5; i++) {
    ratingBtns += `<td style="padding:0 3px;"><a href="${ratingUrl}&rating=${i}" style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;background:#F5F4F2;color:#555555;font-size:13px;font-family:${F};font-weight:500;text-decoration:none;border-radius:50%;border:1px solid #E0DDD8;">${i}</a></td>`
  }

  const ratingHtml = '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:0;">'
    + '<tr><td class="sep" style="height:1px;background-color:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '</table>'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td align="center" style="padding:20px 0 10px;">'
    + `<span class="text-label" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:${F};">Cum apreciați calitatea sistemului nostru digital?</span>`
    + '</td></tr>'
    + '<tr><td align="center" style="padding-bottom:8px;">'
    + `<table cellpadding="0" cellspacing="0" border="0"><tr>${ratingBtns}</tr></table>`
    + '</td></tr>'
    + '<tr><td align="center">'
    + `<span class="text-note" style="font-size:10px;color:#CCCCCC;font-family:${F};">1 = Foarte slab &nbsp;·&nbsp; 5 = Excelent</span>`
    + '</td></tr>'
    + '</table>'

  return '<!DOCTYPE html>'
    + '<html lang="ro" xmlns:v="urn:schemas-microsoft-com:vml">'
    + `<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">`
    + '<meta name="color-scheme" content="light dark">'
    + `<style>${CSS}</style></head>`
    + '<body class="bg-outer" style="margin:0;padding:0;background-color:#ffffff;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-outer" style="background-color:#ffffff;">'
    + '<tr><td align="center" style="padding:32px 12px;">'
    + '<table class="wrapper bg-card" width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:4px;border:1px solid #E8E4DC;">'

    // ── Header ──
    + '<tr><td align="center" style="padding:36px 44px 28px;border-bottom:1px solid #F0EDE8;">'
    + `<div class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:${F};margin-bottom:14px;">Loc disponibil mai devreme</div>`
    + `<div class="text-title" style="font-size:23px;color:#111111;font-weight:600;font-family:${F};letter-spacing:-0.5px;">Clinica Alfa</div>`
    + '</td></tr>'

    // ── Body ──
    + '<tr><td class="inner" style="padding:36px 44px 0;">'
    + `<p style="font-size:15px;margin:0 0 6px;font-family:${F};">`
    + `<span class="text-greet" style="color:#111111;">Bună </span>`
    + `<strong class="text-name" style="color:#111111;font-weight:700;">${p.prenume}</strong>`
    + `<span class="text-greet" style="color:#111111;">,</span></p>`
    + `<p class="text-body" style="font-size:13px;color:#888888;line-height:1.8;margin:0 0 28px;font-family:${F};">`
    + `Am identificat un loc disponibil înaintea programării dumneavoastră la <strong style="color:#555555;">${p.medicNume}</strong>. Locul este disponibil acum. Dacă doriți să îl ocupați, acționați cât mai curând.`
    + '</p>'

    // ── Detalii slot nou ──
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">'
    + '<tr><td colspan="2" style="padding:0 0 10px;">'
    + `<span class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:${F};">Loc disponibil</span>`
    + '</td></tr>'
    + `<tr><td class="text-label border-row" style="${labelStyleTop}">Data</td><td class="text-value border-row" style="${valueStyleTop}">${p.dataSlot}</td></tr>`
    + `<tr><td class="text-label border-row" style="${labelStyle}">Ora</td><td class="text-value border-row" style="${valueStyle}">${p.oraSlot}</td></tr>`
    + `<tr><td class="text-label border-row" style="${labelStyle}">Medic</td><td class="text-value border-row" style="${valueStyle}">${p.medicNume}</td></tr>`
    + `<tr><td class="text-label border-row" style="${labelStyle}">Serviciu</td><td class="text-value border-row" style="${valueStyle}">${p.serviciuNume}</td></tr>`
    + '</table>'

    // ── Programare curentă (tăiată) ──
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;margin-top:16px;">'
    + '<tr><td colspan="2" style="padding:0 0 8px;">'
    + `<span class="old-label" style="font-size:9px;color:#DDDDDD;letter-spacing:3px;text-transform:uppercase;font-family:${F};">Programarea dvs. actuală</span>`
    + '</td></tr>'
    + `<tr><td style="font-size:10px;color:#DDDDDD;text-transform:uppercase;letter-spacing:1px;font-family:${F};padding:8px 0;border-bottom:1px solid #F8F6F3;" class="old-label">Data</td>`
    + `<td style="font-size:13px;color:#DDDDDD;text-align:right;font-family:${F};padding:8px 0;border-bottom:1px solid #F8F6F3;text-decoration:line-through;" class="old-value">${p.dataPac}</td></tr>`
    + `<tr><td style="font-size:10px;color:#DDDDDD;text-transform:uppercase;letter-spacing:1px;font-family:${F};padding:8px 0;" class="old-label">Ora</td>`
    + `<td style="font-size:13px;color:#DDDDDD;text-align:right;font-family:${F};padding:8px 0;text-decoration:line-through;" class="old-value">${p.oraPac}</td></tr>`
    + '</table>'

    // ── CTA ──
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">'
    + '<tr><td class="btn-slot" bgcolor="#111111" style="background-color:#111111;border-radius:3px;">'
    + `<a href="${p.bookingUrl}" class="btn-slot-txt" style="display:block;padding:16px 12px;font-size:11px;color:#ffffff;letter-spacing:2px;text-transform:uppercase;font-family:${F};font-weight:600;text-decoration:none;text-align:center;">→ &nbsp;Ocupă locul acum</a>`
    + '</td></tr></table>'

    // ── Rating ──
    + ratingHtml

    // ── Notă ──
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">'
    + '<tr><td class="sep" style="height:1px;background-color:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr>'
    + '</table>'
    + `<p class="text-note" style="font-size:12px;color:#CCCCCC;line-height:1.9;margin:0 0 32px;font-family:${F};">`
    + `Programarea dumneavoastră actuală rămâne <span class="text-note-em" style="color:#888888;">neschimbată</span> dacă nu acționați. Pentru orice întrebare contactați-ne la `
    + `<a href="mailto:contact@silleau.com" class="link-email" style="color:#999999;text-decoration:underline;text-decoration-style:dotted;font-family:${F};">contact@silleau.com</a>.`
    + '</p>'
    + '</td></tr>'

    // ── Footer ──
    + '<tr><td class="footer-td" style="padding:20px 44px;border-top:1px solid #F0EDE8;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td style="vertical-align:middle;">'
    + `<div class="text-foot-n" style="font-size:12px;color:#BBBBBB;margin-bottom:2px;font-family:${F};">Clinica Alfa</div>`
    + `<div class="text-foot-s" style="font-size:11px;color:#CCCCCC;font-family:${F};"><a href="mailto:contact@silleau.com" class="link-email" style="color:#CCCCCC;text-decoration:underline;text-decoration-style:dotted;">contact@silleau.com</a></div>`
    + '</td>'
    + '<td style="text-align:right;vertical-align:middle;">'
    + `<div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:2px;text-transform:uppercase;font-family:${F};margin-bottom:2px;">SILLEAU Framework</div>`
    + `<div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:1px;text-transform:uppercase;font-family:${F};">Revenue Optimisation Systems</div>`
    + '</td></tr></table>'
    + '</td></tr>'
    + '</table></td></tr></table>'
    + '</body></html>'
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
    const prog = (await (await fetch(
      `${SUPABASE_URL}/rest/v1/programari?id=eq.${programare_id}&clinic_id=eq.${clinic_id}&select=personal_id,serviciu_id,data_programare,ora_start`,
      { headers: SB }
    )).json())[0]
    if (!prog) return new Response(JSON.stringify({ skipped: 'programare negasita' }), { status: 200 })

    const { personal_id, serviciu_id, data_programare, ora_start } = prog

    /* 2. Verifică >= 24h */
    if (new Date(data_programare + 'T' + ora_start) < new Date(Date.now() + 24 * 3600 * 1000)) {
      return new Response(JSON.stringify({ skipped: 'slot < 24h' }), { status: 200 })
    }

    /* 3. Fetch medic & serviciu */
    const med = (await (await fetch(
      `${SUPABASE_URL}/rest/v1/personal?id=eq.${personal_id}&select=prenume,nume,titlu,specialitate`, { headers: SB }
    )).json())[0]
    const medicNume    = med ? ((med.titlu ? med.titlu + ' ' : '') + (med.prenume || '') + ' ' + (med.nume || '')).trim() : 'medicul dvs.'
    const specialitate = med?.specialitate || ''

    let serviciuNume = 'consultație'
    if (serviciu_id) {
      const srv = (await (await fetch(`${SUPABASE_URL}/rest/v1/servicii?id=eq.${serviciu_id}&select=denumire`, { headers: SB })).json())[0]
      if (srv) serviciuNume = srv.denumire
    }

    /* 4. Pacienți eligibili */
    let eligibilUrl = `${SUPABASE_URL}/rest/v1/programari?doreste_loc_mai_devreme=eq.true&personal_id=eq.${personal_id}&data_programare=gt.${data_programare}&status=neq.anulat&id=neq.${programare_id}&select=id,pacient_id,clinic_id,data_programare,ora_start`
    if (serviciu_id) eligibilUrl += `&serviciu_id=eq.${serviciu_id}`

    const eligibili = await (await fetch(eligibilUrl, { headers: SB })).json()
    if (!Array.isArray(eligibili) || eligibili.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'niciun pacient eligibil' }), { status: 200 })
    }

    /* 5. Fetch date pacienți + sortare alfabetică */
    type PacInfo = {
      programareId: string, clinicId: string, pacientId: string,
      prenume: string, email: string,
      dataPac: string, oraPac: string,
    }
    const lista: PacInfo[] = []

    for (const el of eligibili) {
      const pac = (await (await fetch(
        `${SUPABASE_URL}/rest/v1/pacienti?id=eq.${el.pacient_id}&select=prenume,email`, { headers: SB }
      )).json())[0]
      if (!pac?.email) continue
      lista.push({
        programareId: el.id,
        clinicId:     el.clinic_id || clinic_id,
        pacientId:    el.pacient_id,
        prenume:      pac.prenume || '',
        email:        pac.email,
        dataPac:      fmtData(el.data_programare),
        oraPac:       fmtOra(el.ora_start),
      })
    }

    lista.sort((a, b) => a.prenume.localeCompare(b.prenume, 'ro'))

    /* 6. Inserează coada cu delay de 1h */
    const now = Date.now()
    const dataSlot = fmtData(data_programare)
    const oraSlot  = fmtOra(ora_start)

    const rows = lista.map((p, i) => ({
      programare_id, clinic_id,
      pacient_id:       p.pacientId,
      programare_pac_id: p.programareId,
      prenume:          p.prenume,
      email:            p.email,
      medic_id:         personal_id,
      medic_nume:       medicNume,
      serviciu_id:      serviciu_id || null,
      serviciu_nume:    serviciuNume,
      specialitate,
      data_slot:        data_programare,
      ora_slot:         ora_start,
      data_pac:         lista[i].dataPac,
      ora_pac:          lista[i].oraPac,
      trimite_la:       new Date(now + i * 3600 * 1000).toISOString(),
      trimis:           i === 0,
    }))

    await fetch(`${SUPABASE_URL}/rest/v1/notificari_slot`, {
      method: 'POST',
      headers: { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(rows),
    })

    /* 7. Trimite primul email imediat */
    const first = lista[0]
    const notRow = (await (await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${programare_id}&email=eq.${encodeURIComponent(first.email)}&select=id&order=creat_la.asc&limit=1`,
      { headers: SB }
    )).json())[0]

    const bookingUrl = SITE + '/programareclinica.html'
      + '?medic_pref='        + encodeURIComponent(medicNume)
      + '&specialitate_pref=' + encodeURIComponent(specialitate)
      + '&serviciu_pref='     + encodeURIComponent(serviciuNume)
      + '&slot_programare_id='+ encodeURIComponent(programare_id)
      + (notRow?.id ? '&slot_notificare_id=' + encodeURIComponent(notRow.id) : '')

    const html = buildEmail({
      prenume: first.prenume, medicNume, serviciuNume,
      dataSlot, oraSlot,
      dataPac: first.dataPac, oraPac: first.oraPac,
      bookingUrl,
      programareId: first.programareId,
      clinicId:     first.clinicId,
    })

    await sendEmail(first.email, `Loc disponibil pe ${dataSlot} la ora ${oraSlot} — SILLEAU`, html)

    return new Response(JSON.stringify({ queued: lista.length, first_sent: first.email }), { status: 200 })
  } catch (err) {
    console.error('notifica-slot-liber error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
