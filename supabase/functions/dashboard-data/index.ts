/**
 * dashboard-data — API tenant-scoped pentru dashboard-ul de recepție (PWA).
 *
 * Flow autentificare:
 *   1. Frontend-ul trimite `Authorization: Bearer <access_token>` (JWT Supabase Auth).
 *   2. Această funcție validează JWT-ul via GET /auth/v1/user și extrage user_id.
 *   3. Derivă `clinic_id` din prioritatea: app_metadata.clinic_id → utilizatori_clinici.clinic_id.
 *   4. Cache clinic_id per-request; TOATE query-urile REST forțează filtru clinic_id=eq.X.
 *
 * Resources (GET ?resource=...):
 *   me              → { clinic_id, clinic_nume, email }
 *   personal        → medicii clinicii (id, prenume, nume, specialitate, titlu)
 *   programari      → programările între [from,to] cu join la pacienți+personal+servicii
 *   pacienti        → toți pacienții clinicii cu total programări + ultima programare
 *   pacient_detalii → un pacient + toate programările lui la această clinică (?pacient_id=X)
 */

const SUPABASE_URL = Deno.env.get('APP_DB_URL') || Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const SB_HEADERS = {
  'apikey':        SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function sbGet<T = unknown>(path: string): Promise<T[]> {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: SB_HEADERS })
  if (!res.ok) {
    console.warn('[dashboard-data] REST error', res.status, await res.text().catch(() => ''))
    return []
  }
  const rows = await res.json()
  return Array.isArray(rows) ? rows : []
}

/** Decode JWT payload fără validare criptografică (validarea o face /auth/v1/user). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch { return null }
}

async function resolveUser(req: Request): Promise<{ user_id: string; email: string; clinic_id: string } | null> {
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  const token = m[1]

  // Validare token via endpoint-ul auth. Acesta întoarce 401 dacă token-ul e invalid/expirat.
  const userRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + token },
  })
  if (!userRes.ok) return null
  const user = await userRes.json().catch(() => null) as Record<string, unknown> | null
  if (!user || typeof user.id !== 'string') return null

  const email   = typeof user.email === 'string' ? user.email : ''
  const appMeta = (user.app_metadata || {}) as Record<string, unknown>

  // 1. Preferă clinic_id din app_metadata (setat de admin cu service role la crearea contului).
  let clinic_id: string | null = typeof appMeta.clinic_id === 'string' ? appMeta.clinic_id : null

  // 2. Fallback: caută în tabela utilizatori_clinici.
  if (!clinic_id) {
    const rows = await sbGet<{ clinic_id: string }>(
      `utilizatori_clinici?user_id=eq.${encodeURIComponent(user.id)}&select=clinic_id&limit=1`,
    )
    if (rows.length && typeof rows[0].clinic_id === 'string') clinic_id = rows[0].clinic_id
  }

  // 3. Fallback final: jwt claim direct (dacă e configurat access-token-hook).
  if (!clinic_id) {
    const payload = decodeJwtPayload(token)
    if (payload && typeof payload.clinic_id === 'string') clinic_id = payload.clinic_id
  }

  if (!clinic_id) return null
  return { user_id: user.id, email, clinic_id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET')     return json({ error: 'method_not_allowed' }, 405)

  const url      = new URL(req.url)
  const resource = url.searchParams.get('resource') || ''

  const user = await resolveUser(req)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const clinicId = user.clinic_id
  const qClinic  = 'clinic_id=eq.' + encodeURIComponent(clinicId)

  switch (resource) {
    case 'me': {
      const clinics = await sbGet<{ nume: string }>(
        `clinici?id=eq.${encodeURIComponent(clinicId)}&select=nume`,
      )
      return json({
        clinic_id:   clinicId,
        clinic_nume: clinics[0]?.nume || 'Clinica',
        email:       user.email,
      })
    }

    case 'personal': {
      const rows = await sbGet(
        `personal?${qClinic}&activ=eq.true&select=id,prenume,nume,specialitate,titlu&order=nume.asc`,
      )
      return json(rows)
    }

    case 'programari': {
      const from = url.searchParams.get('from') || ''
      const to   = url.searchParams.get('to')   || ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return json({ error: 'invalid_range', message: 'from/to trebuie YYYY-MM-DD' }, 400)
      }

      // Join embedded la pacienti + personal + servicii (PostgREST foreign table).
      const sel = [
        'programare_id',
        'clinic_id',
        'personal_id',
        'pacient_id',
        'serviciu_id',
        'data_programare',
        'ora_start',
        'ora_sfarsit',
        'status',
        'doreste_loc_mai_devreme',
        'confirmat_reminder',
        'motiv_anulare',
        'a_fost_reprogramat',
        'numar_reprogramari',
        'pacient:pacienti(id,prenume,nume,telefon,email)',
        'medic:personal(id,prenume,nume,titlu,specialitate)',
        'serviciu:servicii(id,nume,durata_min,pret_ron)',
      ].join(',')

      const rows = await sbGet(
        `programari?${qClinic}` +
        `&data_programare=gte.${encodeURIComponent(from)}` +
        `&data_programare=lte.${encodeURIComponent(to)}` +
        `&select=${encodeURIComponent(sel)}` +
        `&order=data_programare.asc,ora_start.asc`,
      )
      return json(rows)
    }

    case 'pacienti': {
      // Listă pacienți clinic cu stats (total programări + ultima programare).
      // Folosim join invers: pacienti_clinici → pacienti + agregate pe programari.
      const sel = [
        'pacient_id',
        'activ',
        'pacient:pacienti(id,prenume,nume,telefon,email)',
      ].join(',')
      const pcRows = await sbGet<{
        pacient_id: string
        pacient: { id: string; prenume: string; nume: string; telefon: string | null; email: string | null } | null
      }>(
        `pacienti_clinici?${qClinic}&activ=eq.true&select=${encodeURIComponent(sel)}`,
      )

      // Pentru fiecare pacient, fetch ultima programare + total programări.
      // Optimizare: o singură interogare pentru toate programările din clinică, apoi agregăm.
      const progs = await sbGet<{
        pacient_id: string
        data_programare: string
        ora_start: string
        serviciu_id: string | null
        serviciu: { nume: string } | null
      }>(
        `programari?${qClinic}&select=${encodeURIComponent('pacient_id,data_programare,ora_start,serviciu:servicii(nume)')}&order=data_programare.desc,ora_start.desc`,
      )

      const statsByPacient: Record<string, { total: number; ultima: { data: string; ora: string; serviciu: string | null } | null }> = {}
      for (const p of progs) {
        const cur = statsByPacient[p.pacient_id] || { total: 0, ultima: null }
        cur.total += 1
        if (!cur.ultima) {
          cur.ultima = { data: p.data_programare, ora: p.ora_start, serviciu: p.serviciu?.nume ?? null }
        }
        statsByPacient[p.pacient_id] = cur
      }

      const result = pcRows
        .filter(r => r.pacient)
        .map(r => ({
          id:               r.pacient!.id,
          prenume:          r.pacient!.prenume,
          nume:             r.pacient!.nume,
          telefon:          r.pacient!.telefon,
          email:            r.pacient!.email,
          total_programari: statsByPacient[r.pacient_id]?.total ?? 0,
          ultima:           statsByPacient[r.pacient_id]?.ultima ?? null,
        }))

      return json(result)
    }

    case 'pacient_detalii': {
      const pacientId = url.searchParams.get('pacient_id') || ''
      if (!/^[0-9a-f-]{36}$/i.test(pacientId)) return json({ error: 'invalid_pacient_id' }, 400)

      // Validare tenant: pacientul trebuie să fie în pacienti_clinici al acestei clinici.
      const pc = await sbGet(
        `pacienti_clinici?${qClinic}&pacient_id=eq.${encodeURIComponent(pacientId)}&select=pacient_id&limit=1`,
      )
      if (pc.length === 0) return json({ error: 'not_found' }, 404)

      const pacientRows = await sbGet(
        `pacienti?id=eq.${encodeURIComponent(pacientId)}&select=id,prenume,nume,telefon,email`,
      )
      if (pacientRows.length === 0) return json({ error: 'not_found' }, 404)

      const sel = [
        'programare_id',
        'data_programare',
        'ora_start',
        'ora_sfarsit',
        'status',
        'serviciu:servicii(nume,pret_ron)',
        'medic:personal(prenume,nume,titlu)',
      ].join(',')
      const progs = await sbGet(
        `programari?${qClinic}&pacient_id=eq.${encodeURIComponent(pacientId)}&select=${encodeURIComponent(sel)}&order=data_programare.desc,ora_start.desc`,
      )

      return json({
        pacient:    pacientRows[0],
        programari: progs,
      })
    }

    default:
      return json({ error: 'resource_invalid' }, 400)
  }
})
