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

    // Slotul trebuie sa fie cel putin 24h in viitor
    const oraStartStr = (ora_start + '').slice(0, 5)
    const slotDatetime = new Date(data_programare + 'T' + oraStartStr + ':00')
    if (slotDatetime.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      return new Response(JSON.stringify({ skipped: 'slot sub 24h' }), { status: 200 })
    }

    // Calculeaza limitele saptamanii (Luni-Duminica)
    const d = new Date(data_programare + 'T00:00:00')
    const day = d.getDay()
    const diffMon = day === 0 ? -6 : 1 - day
    const monday = new Date(d); monday.setDate(d.getDate() + diffMon)
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const weekStart = monday.toISOString().slice(0, 10)
    const weekEnd   = sunday.toISOString().slice(0, 10)

    // Gaseste programarile eligibile
    let eligUrl = 'programari'
      + '?clinic_id=eq.'    + clinic_id
      + '&personal_id=eq.'  + personal_id
      + '&status=in.(neconfirmat,confirmat)'
      + '&data_programare=gte.' + weekStart
      + '&data_programare=lte.' + weekEnd
      + '&select=id,pacient_id,data_programare,ora_start,ora_sfarsit'

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

    // Calculeaza prioritatea fiecarui pacient (ultimele 6 luni)
    const sixAgo = new Date(); sixAgo.setMonth(sixAgo.getMonth() - 6)
    const sixAgoStr = sixAgo.toISOString().slice(0, 10)

    const prioritizati: any[] = []
    for (const c of candidati) {
      const hist = await sbGet(
        'programari?pacient_id=eq.' + c.pacient_id
        + '&clinic_id=eq.' + clinic_id
        + '&status=in.(finalizat,confirmat)'
        + '&data_programare=gte.' + sixAgoStr
        + '&select=pret_ron'
      )
      const vizite      = Array.isArray(hist) ? hist.length : 0
      const totalPlatit = Array.isArray(hist) ? hist.reduce((s: number, r: any) => s + (r.pret_ron || 0), 0) : 0
      prioritizati.push({ ...c, prioritate: vizite * 10 + totalPlatit })
    }

    prioritizati.sort((a, b) => b.prioritate - a.prioritate)

    // Fetch detalii medic
    const medicList = await sbGet('personal?id=eq.' + personal_id + '&select=prenume,nume,titlu,specialitate')
    const med       = medicList[0] || {}
    const medicNume = ((med.titlu ? med.titlu + ' ' : '') + (med.prenume || '') + ' ' + (med.nume || '')).trim()

    // Salveaza coada in slot_oferte
    const oferte = prioritizati.map((c: any, i: number) => ({
      programare_anulata_id:  programare_id,
      programare_eligibila_id: c.id,
      pacient_id:  c.pacient_id,
      clinic_id,
      prioritate:  c.prioritate,
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

    // Gaseste oferta #1 si trimite emailul
    const oferta1 = Array.isArray(insertate) ? insertate.find((o: any) => o.pozitie === 1) : null
    const pac1    = prioritizati[0]

    if (oferta1 && pac1) {
      const pacList = await sbGet('pacienti?id=eq.' + pac1.pacient_id + '&select=email,prenume')
      const pacient = pacList[0]

      if (pacient) {
        const oraEndStr = (ora_sfarsit + '').slice(0, 5)
        const acceptUrl = BASE_URL + '/confirmare-loc'
          + '?id='         + pac1.id
          + '&sd='         + encodeURIComponent(data_programare)
          + '&so='         + encodeURIComponent(oraStartStr)
          + '&slot_sfarsit=' + encodeURIComponent(oraEndStr)
          + '&medic='      + encodeURIComponent(medicNume)
          + '&oferta_id='  + oferta1.id

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: pacient.email,
            subject: 'S-a eliberat un slot mai devreme — ' + data_programare,
            html: buildSlotEmail({
              prenume:      pacient.prenume || '',
              medic:        medicNume,
              specialitate: med.specialitate || '',
              data:         data_programare,
              ora:          oraStartStr,
              acceptUrl,
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
