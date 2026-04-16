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

const SITE = 'https://www.silleau.com'

function redir(tip: string): Response {
  return Response.redirect(SITE + '/mesaj.html?tip=' + tip, 302)
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const id  = url.searchParams.get('id')
  const clinicId = url.searchParams.get('clinic_id')

  if (!id || !clinicId) return redir('invalid')

  /* ── 1. Verifică statusul curent ── */
  const res  = await fetch(
    SUPABASE_URL + '/rest/v1/programari?programare_id=eq.' + id + '&clinic_id=eq.' + clinicId
      + '&select=status,confirmat_reminder,data_programare,ora_start,personal_id',
    { headers: SB_GET }
  )
  const rows = await res.json()
  const row  = Array.isArray(rows) ? rows[0] : null

  if (!row) return redir('negasit')

  /* Deja reprogramată (finalizată) */
  if (row.status === 'reprogramat') {
    return redir('reprogramat')
  }

  /* Deja anulată */
  if (row.status === 'anulat') {
    return redir('anulat')
  }

  /* Deja confirmată — link folosit o singură dată */
  if (row.confirmat_reminder) {
    return redir('confirmat')
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
  await fetch(SUPABASE_URL + '/rest/v1/programari?programare_id=eq.' + id + '&clinic_id=eq.' + clinicId, {
    method:  'PATCH',
    headers: SB_PATCH,
    body:    JSON.stringify({ confirmat_reminder: true, status: 'confirmat' }),
  })

  /* ── 4. Redirect la confirmare.html cu detalii ── */
  const redirectUrl = SITE + '/confirmare.html'
    + '?id='     + encodeURIComponent(id)
    + '&source=reminder'
    + (row.data_programare ? '&data=' + encodeURIComponent(row.data_programare) : '')
    + (row.ora_start       ? '&ora='  + encodeURIComponent(String(row.ora_start).slice(0, 5)) : '')
    + (medicNume           ? '&medic=' + encodeURIComponent(medicNume) : '')

  return Response.redirect(redirectUrl, 302)
})
