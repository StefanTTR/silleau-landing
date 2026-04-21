/**
 * resolve-action — procesează link-urile de confirm / reschedule / cancel din
 * email-urile de reminder (signed tokens).
 *
 * Regula unic-răspuns: prima acțiune (confirm / reprogramare / anulare) câștigă.
 * Tentativele ulterioare pe orice link primesc „Deja X" în funcție de ce s-a
 * întâmplat primul:
 *   - status='anulat'             → Deja anulată
 *   - confirmat_reminder=true     → Deja confirmată
 *   - a_fost_reprogramat=true     → Deja reprogramată
 *
 * Paginile UI se servesc de pe frontend (Supabase forțează text/plain pe HTML),
 * deci resolve-action doar face redirect (GET) sau răspunde JSON (POST / context).
 */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TOKEN_HASH_SALT  = Deno.env.get('TOKEN_HASH_SALT') ?? ''
const SITE             = Deno.env.get('SITE_URL') ?? 'https://www.silleau.com'
const ALLOWED_ORIGINS  = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://www.silleau.com,https://silleau.com')
  .split(',').map((s) => s.trim()).filter(Boolean)

const SB_HEADERS = {
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
}
const SB_JSON = { ...SB_HEADERS, 'Content-Type': 'application/json' }

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[A-Za-z0-9_-]{16,48}$/

const CUTOFF_MS = 3 * 60 * 60 * 1000 // 3h

type ProgareRow = {
  programare_id:          string
  clinic_id:              string
  personal_id:            string
  pacient_id:             string
  serviciu_id:            string | null
  status:                 string
  data_programare:        string
  ora_start:              string
  ora_sfarsit:            string
  tokens_expire_at:       string | null
  confirm_token_used_at:  string | null
  cancel_token_used_at:   string | null
  confirmat_reminder:     boolean
  a_fost_reprogramat:     boolean
  numar_reprogramari:     number
}

type ProgDetails = {
  data:         string   // "2026-04-20"
  ora:          string   // "10:00"
  medic:        string   // "Dr. Ionescu Alexandru"
  specialitate: string
  serviciu:     string
}

function corsHeaders(req: Request): Record<string, string> {
  const origin  = req.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary':                         'Origin',
  }
}

function jsonResponse(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { 'Location': url, 'Cache-Control': 'no-store' } })
}

/** URL către /anulare-reminder.html. clinic_id NU mai e în URL — frontend-ul îl obține
 *  din răspunsul cancel-context (branding). */
function cancelPageUrl(opts: {
  token?: string; status: string;
  data?: string; ora?: string; medic?: string;
}): string {
  const u = new URL(SITE + '/anulare-reminder.html')
  u.searchParams.set('status', opts.status)
  if (opts.token) u.searchParams.set('token', opts.token)
  if (opts.data)  u.searchParams.set('data',  opts.data)
  if (opts.ora)   u.searchParams.set('ora',   opts.ora)
  if (opts.medic) u.searchParams.set('medic', opts.medic)
  return u.toString()
}

/** URL către /confirmare.html. id + clinic_id nu mai sunt în URL — frontend-ul
 *  afișează detaliile primite explicit (data/ora/medic) fără lookup-uri. */
function confirmPageUrl(opts: {
  status: string;
  data?: string; ora?: string; medic?: string;
}): string {
  const u = new URL(SITE + '/confirmare.html')
  u.searchParams.set('source', 'reminder')
  u.searchParams.set('status', opts.status)
  if (opts.data)  u.searchParams.set('data',  opts.data)
  if (opts.ora)   u.searchParams.set('ora',   opts.ora)
  if (opts.medic) u.searchParams.set('medic', opts.medic)
  return u.toString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  try {
    if (req.method === 'GET') {
      const u      = new URL(req.url)
      const action = u.searchParams.get('action') ?? ''
      // Noul path: /resolve-action?t=TOKEN (din reverse proxy /r/{c|r|x}/TOKEN).
      // Vechiul path: /resolve-action?action=…&token=…&clinic_id=… (backward compat).
      const token  = u.searchParams.get('t') ?? u.searchParams.get('token') ?? ''
      const clinic = u.searchParams.get('clinic_id') ?? ''

      if (!TOKEN_RE.test(token)) {
        return redirect(cancelPageUrl({ status: 'invalid' }))
      }

      // Ramură nouă: doar token — derivăm acțiunea din coloana în care match-uiește hash-ul
      if (!action && !clinic) {
        return await handleUnifiedAction(token)
      }

      // Context endpoints (JSON responses): token suficient, clinic_id derivat din DB
      if (action === 'reschedule-context') return await handleRescheduleContext(req, token)
      if (action === 'cancel-context')     return await handleCancelContext(req, token)

      // Ramuri vechi: action + clinic_id obligatorii pentru backward compat
      if (!UUID_RE.test(clinic)) {
        return redirect(cancelPageUrl({ status: 'invalid' }))
      }

      if (action === 'confirm')            return await handleConfirm(token, clinic)
      if (action === 'reschedule')         return await handleReschedule(token, clinic)
      if (action === 'cancel')             return await handleCancelView(token, clinic)

      return redirect(cancelPageUrl({ status: 'invalid' }))
    }

    if (req.method === 'POST') {
      const body   = await req.json().catch(() => null) as Record<string, unknown> | null
      const action = body?.action
      const token  = body?.token as string | undefined
      const clinic = body?.clinic_id as string | undefined

      if (!token || !clinic || !TOKEN_RE.test(token) || !UUID_RE.test(clinic)) {
        return jsonResponse(req, 400, { error: 'invalid_request' })
      }

      if (action === 'cancel-confirm') {
        const motiv = (body?.motiv as string | undefined) ?? 'anulat_de_pacient'
        return await handleCancelConfirm(req, token, clinic, motiv)
      }
      if (action === 'pivot-reschedule') {
        return await handlePivotReschedule(req, token, clinic)
      }

      return jsonResponse(req, 400, { error: 'invalid_action' })
    }

    return jsonResponse(req, 405, { error: 'method_not_allowed' })
  } catch (e) {
    console.error('[resolve-action] fatal', e)
    return redirect(cancelPageUrl({ status: 'invalid' }))
  }
})

/* ────────────────────────── Action handlers ───────────────────────────── */

async function handleConfirm(token: string, clinicId: string): Promise<Response> {
  const hash = await hashToken(token)
  const rows = await fetchByTokenHash('confirm_token_hash', hash)
  const prog = rows[0]

  if (!prog) {
    return redirect(confirmPageUrl({ status: 'expired' }))
  }

  const details = await fetchProgDetails(prog)

  // Regula unic-răspuns
  if (prog.status === 'anulat') {
    return redirect(confirmPageUrl({ status: 'already-cancelled', ...details }))
  }
  if (prog.a_fost_reprogramat) {
    return redirect(confirmPageUrl({ status: 'already-rescheduled', ...details }))
  }
  if (isTokenExpired(prog.tokens_expire_at) && !prog.confirm_token_used_at) {
    return redirect(confirmPageUrl({ status: 'expired' }))
  }
  if (prog.confirm_token_used_at) {
    // Deja confirmat prin acest link — idempotent, arătăm success cu flag
    return redirect(confirmPageUrl({ status: 'already-confirmed', ...details }))
  }

  const now = new Date().toISOString()
  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/programari?programare_id=eq.${encodeURIComponent(prog.programare_id)}&clinic_id=eq.${encodeURIComponent(clinicId)}`,
    {
      method:  'PATCH',
      headers: { ...SB_JSON, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        status:                'confirmat',
        confirmat_reminder:    true,
        confirmed_at:          now,
        confirmed_via:         'email_link',
        confirm_token_used_at: now,
      }),
    }
  )
  if (!patchRes.ok) {
    console.error('[resolve-action] confirm PATCH failed', patchRes.status, await patchRes.text().catch(() => ''))
    return redirect(confirmPageUrl({ status: 'error' }))
  }

  return redirect(confirmPageUrl({ status: 'success', ...details }))
}

async function handleReschedule(token: string, clinicId: string): Promise<Response> {
  const hash = await hashToken(token)
  const rows = await fetchByTokenHash('reschedule_token_hash', hash)
  const prog = rows[0]

  if (!prog) {
    return redirect(cancelPageUrl({ status: 'expired' }))
  }

  const details = await fetchProgDetails(prog)

  if (prog.status === 'anulat') {
    return redirect(cancelPageUrl({ status: 'already-cancelled', ...details }))
  }
  if (prog.confirmat_reminder) {
    return redirect(cancelPageUrl({ status: 'already-confirmed', ...details }))
  }
  if (prog.a_fost_reprogramat) {
    return redirect(cancelPageUrl({ status: 'already-rescheduled', ...details }))
  }
  if (isTokenExpired(prog.tokens_expire_at)) {
    return redirect(cancelPageUrl({ status: 'expired' }))
  }

  // URL curat — doar token-ul de reschedule. Frontend-ul derivă programare_id +
  // clinic_id + detalii pacient din răspunsul reschedule-context (gated pe token).
  const target = new URL(SITE + '/programareclinica.html')
  target.searchParams.set('rt', token)
  return redirect(target.toString())
}

/** Redirect la /anulare-reminder. Decizia de state e luată client-side pe baza cancel-context.
 *  clinicId primit e neutilizat azi — rămâne în signature pentru backward compat ramurei vechi. */
async function handleCancelView(token: string, _clinicId: string): Promise<Response> {
  return redirect(cancelPageUrl({ token, status: 'loading' }))
}

async function handleCancelContext(req: Request, token: string): Promise<Response> {
  const hash = await hashToken(token)
  const rows = await fetchByTokenHash('cancel_token_hash', hash)
  const prog = rows[0]

  if (!prog)                                 return jsonResponse(req, 404, { error: 'token_invalid' })
  if (isTokenExpired(prog.tokens_expire_at) && !prog.cancel_token_used_at) {
    return jsonResponse(req, 410, { error: 'token_expired' })
  }

  const details = await fetchProgDetails(prog)
  const cid     = prog.clinic_id

  // Regula unic-răspuns
  if (prog.status === 'anulat')    return jsonResponse(req, 200, { state: 'already-cancelled',   clinic_id: cid, ...details })
  if (prog.confirmat_reminder)     return jsonResponse(req, 200, { state: 'already-confirmed',   clinic_id: cid, ...details })
  if (prog.a_fost_reprogramat)     return jsonResponse(req, 200, { state: 'already-rescheduled', clinic_id: cid, ...details })
  if (prog.cancel_token_used_at)   return jsonResponse(req, 200, { state: 'already-cancelled',   clinic_id: cid, ...details })

  const slotMs = roSlotToUtcMs(prog.data_programare, prog.ora_start)
  if (slotMs == null) return jsonResponse(req, 500, { error: 'invalid_slot' })
  if (slotMs - Date.now() < CUTOFF_MS) {
    return jsonResponse(req, 200, { state: 'cutoff', clinic_id: cid, ...details })
  }

  return jsonResponse(req, 200, {
    state: 'pending',
    clinic_id: cid,
    numar_reprogramari: prog.numar_reprogramari || 0,
    ...details,
  })
}

async function handleRescheduleContext(req: Request, token: string): Promise<Response> {
  const hash = await hashToken(token)
  const rows = await fetchByTokenHash('reschedule_token_hash', hash)
  const prog = rows[0]

  if (!prog)                                 return jsonResponse(req, 404, { error: 'token_invalid' })
  if (isTokenExpired(prog.tokens_expire_at)) return jsonResponse(req, 410, { error: 'token_expired' })
  if (prog.status === 'anulat')              return jsonResponse(req, 410, { error: 'already_cancelled' })
  if (prog.confirmat_reminder)               return jsonResponse(req, 410, { error: 'already_confirmed' })

  const pacRes = await fetch(
    SUPABASE_URL + '/rest/v1/pacienti?id=eq.' + encodeURIComponent(prog.pacient_id) + '&select=prenume,nume,email,telefon',
    { headers: SB_HEADERS }
  )
  const pacRows = pacRes.ok ? await pacRes.json() : []
  const pac     = Array.isArray(pacRows) ? pacRows[0] : null

  return jsonResponse(req, 200, {
    programare_id: prog.programare_id,
    clinic_id:     prog.clinic_id,
    personal_id:   prog.personal_id,
    serviciu_id:   prog.serviciu_id,
    prenume:       pac?.prenume ?? '',
    nume:          pac?.nume ?? '',
    email:         pac?.email ?? '',
    telefon:       pac?.telefon ?? '',
  })
}

async function handleCancelConfirm(req: Request, token: string, clinicId: string, motiv: string): Promise<Response> {
  const hash = await hashToken(token)
  const rows = await fetchByTokenHash('cancel_token_hash', hash)
  const prog = rows[0]

  if (!prog)                                 return jsonResponse(req, 404, { error: 'token_invalid' })
  if (prog.cancel_token_used_at)             return jsonResponse(req, 410, { error: 'token_used' })
  if (isTokenExpired(prog.tokens_expire_at)) return jsonResponse(req, 410, { error: 'token_expired' })
  if (prog.status === 'anulat')              return jsonResponse(req, 200, { ok: true, already: true })
  if (prog.confirmat_reminder)               return jsonResponse(req, 409, { error: 'already_confirmed' })
  if (prog.a_fost_reprogramat)               return jsonResponse(req, 409, { error: 'already_rescheduled' })

  const slotMs = roSlotToUtcMs(prog.data_programare, prog.ora_start)
  if (slotMs == null || slotMs - Date.now() < CUTOFF_MS) {
    return jsonResponse(req, 403, { error: 'cutoff_3h' })
  }

  // Mark-as-used atomic (WHERE used_at IS NULL) pentru anti-replay
  const markRes = await fetch(
    `${SUPABASE_URL}/rest/v1/programari?programare_id=eq.${encodeURIComponent(prog.programare_id)}&clinic_id=eq.${encodeURIComponent(clinicId)}&cancel_token_used_at=is.null`,
    {
      method:  'PATCH',
      headers: { ...SB_JSON, 'Prefer': 'return=representation' },
      body: JSON.stringify({ cancel_token_used_at: new Date().toISOString() }),
    }
  )
  if (!markRes.ok) return jsonResponse(req, 500, { error: 'mark_used_failed' })
  const markRows = await markRes.json().catch(() => [])
  if (!Array.isArray(markRows) || markRows.length === 0) {
    return jsonResponse(req, 200, { ok: true, already: true })
  }

  const anulRes = await fetch(`${SUPABASE_URL}/functions/v1/anuleaza-slot`, {
    method:  'POST',
    headers: SB_JSON,
    body:    JSON.stringify({
      programare_id: prog.programare_id,
      clinic_id:     clinicId,
      motiv,
    }),
  })
  if (!anulRes.ok) {
    console.error('[resolve-action] anuleaza-slot failed', anulRes.status, await anulRes.text().catch(() => ''))
    return jsonResponse(req, 500, { error: 'cancel_failed' })
  }

  return jsonResponse(req, 200, { ok: true })
}

async function handlePivotReschedule(req: Request, cancelToken: string, clinicId: string): Promise<Response> {
  const cancelHash = await hashToken(cancelToken)
  const rows       = await fetchByTokenHash('cancel_token_hash', cancelHash)
  const prog       = rows[0]

  if (!prog)                                 return jsonResponse(req, 404, { error: 'token_invalid' })
  if (prog.cancel_token_used_at)             return jsonResponse(req, 410, { error: 'token_used' })
  if (isTokenExpired(prog.tokens_expire_at)) return jsonResponse(req, 410, { error: 'token_expired' })
  if (prog.status === 'anulat')              return jsonResponse(req, 409, { error: 'already_cancelled' })
  if (prog.confirmat_reminder)               return jsonResponse(req, 409, { error: 'already_confirmed' })
  if (prog.a_fost_reprogramat)               return jsonResponse(req, 409, { error: 'already_rescheduled' })

  const newToken = genRandomToken()
  const newHash  = await hashToken(newToken)

  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/programari?programare_id=eq.${encodeURIComponent(prog.programare_id)}&clinic_id=eq.${encodeURIComponent(clinicId)}`,
    {
      method:  'PATCH',
      headers: { ...SB_JSON, 'Prefer': 'return=minimal' },
      body:    JSON.stringify({ reschedule_token_hash: newHash }),
    }
  )
  if (!patchRes.ok) return jsonResponse(req, 500, { error: 'pivot_failed' })

  // Redirect public la /r/r/TOKEN — reverse proxy rezolvă la Supabase.
  const redirectUrl = SITE + '/r/r/' + encodeURIComponent(newToken)
  return jsonResponse(req, 200, { redirect_url: redirectUrl })
}

/**
 * handleUnifiedAction — primește doar token-ul, derivă acțiunea din coloana în care
 * match-uiește hash-ul. Chemat din ramura GET ?t=TOKEN (reverse proxy /r/{c|r|x}/TOKEN).
 * Priority: confirm > reschedule > cancel (deterministă în caz teoretic de coliziune).
 */
async function handleUnifiedAction(token: string): Promise<Response> {
  const hash = await hashToken(token)

  const [confirmRows, rescheduleRows, cancelRows] = await Promise.all([
    fetchByTokenHash('confirm_token_hash',    hash),
    fetchByTokenHash('reschedule_token_hash', hash),
    fetchByTokenHash('cancel_token_hash',     hash),
  ])

  if (confirmRows[0])    return await handleConfirm(token,    confirmRows[0].clinic_id)
  if (rescheduleRows[0]) return await handleReschedule(token, rescheduleRows[0].clinic_id)
  if (cancelRows[0])     return await handleCancelView(token, cancelRows[0].clinic_id)

  return redirect(cancelPageUrl({ status: 'invalid' }))
}

/* ────────────────────────── DB helpers ────────────────────────────────── */

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token + TOKEN_HASH_SALT)
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function fetchByTokenHash(column: string, hash: string): Promise<ProgareRow[]> {
  // SHA-256(token + salt) cu 18-byte random → ~2^144 entropie; filtrul pe clinic_id e
  // redundant (zero coliziuni cross-tenant). clinic_id se derivă din rows[0].clinic_id.
  const url = SUPABASE_URL + '/rest/v1/programari'
    + '?' + column + '=eq.' + encodeURIComponent(hash)
    + '&select=programare_id,clinic_id,personal_id,pacient_id,serviciu_id,status,data_programare,ora_start,ora_sfarsit,'
    + 'tokens_expire_at,confirm_token_used_at,cancel_token_used_at,confirmat_reminder,a_fost_reprogramat,numar_reprogramari'

  const res = await fetch(url, { headers: SB_HEADERS })
  if (!res.ok) return []
  const rows = await res.json()
  return Array.isArray(rows) ? rows : []
}

async function fetchProgDetails(prog: ProgareRow): Promise<ProgDetails> {
  const [persRes, servRes] = await Promise.all([
    fetch(
      SUPABASE_URL + '/rest/v1/personal?id=eq.' + encodeURIComponent(prog.personal_id) + '&select=prenume,nume,specialitate',
      { headers: SB_HEADERS }
    ),
    prog.serviciu_id
      ? fetch(
          SUPABASE_URL + '/rest/v1/servicii?id=eq.' + encodeURIComponent(prog.serviciu_id) + '&select=denumire',
          { headers: SB_HEADERS }
        )
      : Promise.resolve(null as Response | null),
  ])

  const persRows = persRes.ok ? await persRes.json() : []
  const servRows = servRes && servRes.ok ? await servRes.json() : []
  const pers     = Array.isArray(persRows) ? persRows[0] : null
  const serv     = Array.isArray(servRows) ? servRows[0] : null

  const medicParts: string[] = []
  if (pers?.prenume) medicParts.push(String(pers.prenume))
  if (pers?.nume)    medicParts.push(String(pers.nume))
  const medic = medicParts.length ? 'Dr. ' + medicParts.join(' ') : ''

  return {
    data:         fmtDataRo(prog.data_programare),
    ora:          String(prog.ora_start || '').slice(0, 5),
    medic,
    specialitate: pers?.specialitate ?? '',
    serviciu:     serv?.denumire ?? '',
  }
}

function isTokenExpired(iso: unknown): boolean {
  if (!iso || typeof iso !== 'string') return true
  const t = Date.parse(iso)
  return Number.isNaN(t) || t < Date.now()
}

function roSlotToUtcMs(dateIso: unknown, oraStart: unknown): number | null {
  const data = String(dateIso || '').slice(0, 10)
  const ora  = String(oraStart || '').slice(0, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(ora)) return null

  const [y, m, d]  = data.split('-').map(Number)
  const [hh, mm]   = ora.split(':').map(Number)
  const noonUtc    = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const noonRoStr  = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(noonUtc)
  const [noonH, noonM] = noonRoStr.split(':').map(Number)
  const offsetMs = (noonH * 60 + noonM - 720) * 60_000
  return Date.UTC(y, m - 1, d, hh, mm) - offsetMs
}

function fmtDataRo(dateIso: string): string {
  try {
    const d = new Date(dateIso + 'T12:00:00')
    return d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return dateIso }
}

function genRandomToken(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
