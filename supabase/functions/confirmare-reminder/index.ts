const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SB_GET = {
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
}
const SB_PATCH = {
  ...SB_GET,
  'Content-Type': 'application/json',
  'Prefer':       'return=minimal',
}

const CSS = 'body{margin:0;font-family:"Helvetica Neue",Arial,sans-serif;background:#0A0A0A;color:#E8E4DC;'
  + 'display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;}'
  + '.box{max-width:420px;}'
  + '.mark{font-size:36px;margin-bottom:20px;}'
  + 'h1{font-size:22px;font-weight:300;letter-spacing:-.3px;margin:0 0 10px;color:#E8E4DC;}'
  + 'p{font-size:13px;color:#888;line-height:1.8;margin:0;}'

function page(mark: string, title: string, body: string): Response {
  return new Response(
    '<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + title + '</title>'
    + '<style>' + CSS + '</style></head>'
    + '<body><div class="box">'
    + '<div class="mark">' + mark + '</div>'
    + '<h1>' + title + '</h1>'
    + '<p>' + body + '</p>'
    + '</div></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const id  = url.searchParams.get('id')
  const clinicId = url.searchParams.get('clinic_id')

  if (!id || !clinicId) return page('✕', 'Link invalid', 'ID-ul programării sau clinicii lipsește.')

  /* ── 1. Verifică statusul curent ── */
  const res  = await fetch(
    SUPABASE_URL + '/rest/v1/programari?id=eq.' + id + '&clinic_id=eq.' + clinicId
      + '&select=status,confirmat_reminder,a_fost_reprogramat,data_programare,ora_start,personal_id',
    { headers: SB_GET }
  )
  const rows = await res.json()
  const row  = Array.isArray(rows) ? rows[0] : null

  if (!row) return page('✕', 'Programare negăsită', 'Link-ul nu mai este valid.')

  /* Deja reprogramată (în proces sau finalizată) */
  if (row.status === 'reprogramat' || row.a_fost_reprogramat) {
    return page('↺', 'Deja reprogramată', 'Ați solicitat deja reprogramarea acestei consultații.<br>Verificați e-mailul pentru confirmarea noii programări.')
  }

  /* Deja anulată */
  if (row.status === 'anulat') {
    return page('✕', 'Programare anulată', 'Această programare a fost deja anulată.<br>Contactați clinica dacă doriți o nouă programare.')
  }

  /* Deja confirmată — link folosit o singură dată */
  if (row.confirmat_reminder) {
    return page('✓', 'Deja confirmată', 'Ați confirmat deja această programare.<br>Vă așteptăm!')
  }

  /* ── 2. Fetch medic ── */
  let medicNume = ''
  if (row.personal_id) {
    const medRes  = await fetch(
      SUPABASE_URL + '/rest/v1/personal?id=eq.' + row.personal_id + '&select=prenume,nume,titlu',
      { headers: SB_GET }
    )
    const medRows = await medRes.json()
    const med     = Array.isArray(medRows) ? medRows[0] : null
    if (med) {
      medicNume = ((med.titlu ? med.titlu + ' ' : '') + (med.prenume || '') + ' ' + (med.nume || '')).trim()
    }
  }

  /* ── 3. Confirmă ── */
  await fetch(SUPABASE_URL + '/rest/v1/programari?id=eq.' + id + '&clinic_id=eq.' + clinicId, {
    method:  'PATCH',
    headers: SB_PATCH,
    body:    JSON.stringify({ confirmat_reminder: true, status: 'confirmat' }),
  })

  /* ── 4. Redirect la confirmare.html cu detalii ── */
  const redirectUrl = 'https://www.silleau.com/confirmare.html'
    + '?id='     + encodeURIComponent(id)
    + '&source=reminder'
    + (row.data_programare ? '&data=' + encodeURIComponent(row.data_programare) : '')
    + (row.ora_start       ? '&ora='  + encodeURIComponent(String(row.ora_start).slice(0, 5)) : '')
    + (medicNume           ? '&medic=' + encodeURIComponent(medicNume) : '')

  return Response.redirect(redirectUrl, 302)
})
