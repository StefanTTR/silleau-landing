const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY = Deno.env.get('RESEND_KEY')!
const FROM_EMAIL = 'contact@silleau.com'
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

async function sbPatch(path: string, body: object) {
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
}

Deno.serve(async (_req) => {
  try {
    // Gaseste grupuri cu oferte pending si slot neocupat
    const grupuri = await sbGet(
      'slot_oferte?slot_ocupat=eq.false&status=eq.pending&select=programare_anulata_id'
    )

    if (!Array.isArray(grupuri) || grupuri.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
    }

    const ids = [...new Set(grupuri.map((g: any) => g.programare_anulata_id))]
    let sent = 0

    for (const anulataId of ids) {
      // Verifica daca slotul a fost deja ocupat
      const ocupat = await sbGet(
        'slot_oferte?programare_anulata_id=eq.' + anulataId
        + '&slot_ocupat=eq.true&select=id&limit=1'
      )
      if (Array.isArray(ocupat) && ocupat.length > 0) continue

      // Verifica daca ultimul email trimis a fost acum cel putin 1h
      // Include si status 'expirat' (pacient refuzat) — tot conteaza ca email trimis
      const ultimTrimis = await sbGet(
        'slot_oferte?programare_anulata_id=eq.' + anulataId
        + '&email_trimis_la=not.is.null'
        + '&order=email_trimis_la.desc'
        + '&limit=1'
        + '&select=email_trimis_la'
      )

      if (!Array.isArray(ultimTrimis) || ultimTrimis.length === 0) continue

      const ultimaOra = new Date(ultimTrimis[0].email_trimis_la)
      if (Date.now() - ultimaOra.getTime() < 60 * 60 * 1000) continue

      // Gaseste urmatoarea oferta pending
      const urmatoarele = await sbGet(
        'slot_oferte?programare_anulata_id=eq.' + anulataId
        + '&status=eq.pending'
        + '&order=pozitie.asc'
        + '&limit=1'
        + '&select=id,programare_eligibila_id,pacient_id'
      )

      if (!Array.isArray(urmatoarele) || urmatoarele.length === 0) continue
      const oferta = urmatoarele[0]

      // Fetch detalii programare anulata
      const progAnulata = await sbGet(
        'programari?id=eq.' + anulataId
        + '&select=data_programare,ora_start,ora_sfarsit,personal_id,clinic_id'
      )
      if (!Array.isArray(progAnulata) || progAnulata.length === 0) continue
      const pa = progAnulata[0]

      // Verifica ca slotul e inca cu cel putin 24h in viitor
      const oraStartStr = (pa.ora_start + '').slice(0, 5)
      const slotDt = new Date(pa.data_programare + 'T' + oraStartStr + ':00')
      if (slotDt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
        await sbPatch(
          'slot_oferte?programare_anulata_id=eq.' + anulataId + '&status=eq.pending',
          { status: 'expirat' }
        )
        continue
      }

      // Fetch pacient
      const pacList = await sbGet('pacienti?id=eq.' + oferta.pacient_id + '&select=email,prenume')
      if (!Array.isArray(pacList) || pacList.length === 0) continue
      const pacient = pacList[0]

      // Fetch medic
      const medList = await sbGet('personal?id=eq.' + pa.personal_id + '&select=prenume,nume,titlu,specialitate')
      if (!Array.isArray(medList) || medList.length === 0) continue
      const med = medList[0]
      const medicNume = ((med.titlu ? med.titlu + ' ' : '') + (med.prenume || '') + ' ' + (med.nume || '')).trim()

      // Construieste link acceptare
      const oraEndStr = (pa.ora_sfarsit + '').slice(0, 5)
      const acceptUrl = BASE_URL + '/confirmare-loc'
        + '?id='           + oferta.programare_eligibila_id
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
            data:         pa.data_programare,
            ora:          oraStartStr,
            acceptUrl,
          }),
        }),
      })

      if (emailRes.ok) {
        await sbPatch('slot_oferte?id=eq.' + oferta.id, {
          status: 'trimis',
          email_trimis_la: new Date().toISOString(),
        })
        sent++
      }
    }

    return new Response(JSON.stringify({ sent }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})

function buildSlotEmail(d: {
  prenume: string, medic: string, specialitate: string,
  data: string, ora: string, acceptUrl: string
}): string {
  return '<!DOCTYPE html>'
    + '<html lang="ro"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<style>'
    + 'body{margin:0;padding:0;background:#F4F2EE;font-family:\'Helvetica Neue\',Arial,sans-serif;}'
    + '.wrap{max-width:560px;margin:32px auto;background:#fff;border:1px solid #E8E4DC;border-radius:4px;}'
    + '.hdr{padding:36px 44px 28px;border-bottom:1px solid #F0EDE8;text-align:center;}'
    + '.tag{font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;margin-bottom:14px;}'
    + '.clinic{font-size:23px;color:#111;font-weight:300;letter-spacing:-0.3px;}'
    + '.body{padding:36px 44px 0;}'
    + '.greet{font-size:15px;color:#111;margin:0 0 6px;}'
    + '.sub{font-size:13px;color:#888;line-height:1.8;margin:0 0 28px;}'
    + '.highlight{background:#FAFAF8;border:1px solid #E8E4DC;border-radius:3px;padding:20px 24px;margin-bottom:28px;}'
    + '.hl-label{font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px;}'
    + 'table.det{width:100%;border-collapse:collapse;}'
    + '.det td{padding:10px 0;font-size:13px;border-top:1px solid #F0EDE8;}'
    + '.det .k{color:#BBBBBB;font-size:10px;text-transform:uppercase;letter-spacing:1px;width:42%;}'
    + '.det .v{color:#111;text-align:right;}'
    + '.btn-accept{display:block;background:#111;color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:3px;font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;}'
    + '.note{font-size:11px;color:#CCC;line-height:1.9;margin-bottom:32px;}'
    + '.ftr{padding:20px 44px;border-top:1px solid #F0EDE8;font-size:11px;color:#CCC;}'
    + '</style></head><body>'
    + '<div class="wrap">'
    + '<div class="hdr"><div class="tag">Slot disponibil</div><div class="clinic">Clinica Alfa</div></div>'
    + '<div class="body">'
    + '<p class="greet">Bun\u0103 <strong>' + d.prenume + '</strong>,</p>'
    + '<p class="sub">S-a eliberat un slot mai devreme dec\u00e2t programarea dumneavoastr\u0103 actual\u0103, la acela\u015fi medic \u015fi serviciu. Dori\u021bi s\u0103 \u00eel prelua\u021bi?</p>'
    + '<div class="highlight">'
    + '<div class="hl-label">Slot disponibil</div>'
    + '<table class="det">'
    + '<tr><td class="k">Medic</td><td class="v">' + d.medic + '</td></tr>'
    + '<tr><td class="k">Specialitate</td><td class="v">' + d.specialitate + '</td></tr>'
    + '<tr><td class="k">Data</td><td class="v">' + d.data + '</td></tr>'
    + '<tr><td class="k">Ora</td><td class="v">' + d.ora + '</td></tr>'
    + '</table>'
    + '</div>'
    + '<a href="' + d.acceptUrl + '" class="btn-accept">\u2192 &nbsp;Preia slotul mai devreme</a>'
    + '<p class="note">Oferta este valabil\u0103 p\u00e2n\u0103 la ocuparea slotului. Primul care confirm\u0103 prime\u015fte locul. Programarea dumneavoastr\u0103 actual\u0103 va fi \u00eenlocuit\u0103 automat.</p>'
    + '</div>'
    + '<div class="ftr">Clinica Alfa &nbsp;\u00b7&nbsp; contact@silleau.com</div>'
    + '</div></body></html>'
}
