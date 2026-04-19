/**
 * resolve-action — procesează link-urile de confirm / reschedule / cancel din
 * email-urile de reminder (signed tokens).
 *
 * NOTĂ IMPORTANTĂ: Supabase Edge Functions servesc orice răspuns cu
 * `content-type: text/plain` + `CSP: sandbox`, deci nu putem servi HTML direct.
 * Toate flow-urile GET fac redirect (302) către pagini frontend pe silleau.com.
 * Doar POST răspunde JSON (consumat de JS-ul din pagină).
 *
 * GET  /functions/v1/resolve-action?action=confirm&token=<T>&clinic_id=<CID>
 *      → PATCH status=confirmat, redirect la /confirmare.html
 *
 * GET  /functions/v1/resolve-action?action=reschedule&token=<T>&clinic_id=<CID>
 *      → redirect la /programareclinica.html cu reprogramare_id
 *
 * GET  /functions/v1/resolve-action?action=cancel&token=<T>&clinic_id=<CID>
 *      → redirect la /anulare-reminder.html?token=…&clinic_id=…&status=…&when=…
 *
 * POST /functions/v1/resolve-action
 *      body: { action: 'cancel-confirm', token, clinic_id, motiv? }
 *      → apelează intern anuleaza-slot, răspuns JSON
 *
 * Token: 24 caractere alfanumerice (base64url din 18 bytes random).
 * În DB stocăm doar SHA-256(token + TOKEN_HASH_SALT).
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

function cancelPageUrl(token: string, clinicId: string, status: string, when?: string): string {
  const u = new URL(SITE + '/anulare-reminder.html')
  if (token)    u.searchParams.set('token',     token)
  if (clinicId) u.searchParams.set('clinic_id', clinicId)
  if (status)   u.searchParams.set('status',    status)
  if (when)     u.searchParams.set('when',      when)
  return u.toString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  try {
    if (req.method === 'GET') {
      const u       = new URL(req.url)
      const action  = u.searchParams.get('action') ?? ''
      const token   = u.searchParams.get('token')  ?? ''
      const clinic  = u.searchParams.get('clinic_id') ?? ''

      if (!TOKEN_RE.test(token) || !UUID_RE.test(clinic)) {
        return redirect(cancelPageUrl('', '', 'invalid'))
      }

      if (action === 'confirm')            return await handleConfirm(token, clinic)
      if (action === 'reschedule')         return await handleReschedule(token, clinic)
      if (action === 'cancel')             return await handleCancelView(token, clinic)
      if (action === 'reschedule-context') return await handleRescheduleContext(req, token, clinic)

      return redirect(cancelPageUrl('', '', 'invalid'))
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
    return redirect(cancelPageUrl('', '', 'invalid'))
  }
})

/* ────────────────────────── Action handlers ───────────────────────────── */

async function handleConfirm(token: string, clinicId: string): Promise<Response> {
  const hash = await hashToken(token)
  const rows = await fetchByTokenHash('confirm_token_hash', hash, clinicId)
  const prog = rows[0]

  if (!prog) return redirectConfirmErr(clinicId, 'expired')
  if (prog.confirm_token_used_at)            return redirectConfirmSuccess(prog, clinicId, /*already*/ true)
  if (isTokenExpired(prog.tokens_expire_at)) return redirectConfirmErr(clinicId, 'expired')
  if (prog.status === 'anulat')              return redirectConfirmErr(clinicId, 'cancelled')

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
    return redirectConfirmErr(clinicId, 'error')
  }

  return redirectConfirmSuccess(prog, clinicId, /*already*/ false)
}

async function handleReschedule(token: string, clinicId: string): Promise<Response> {
  const hash = await hashToken(token)
  const rows = await fetchByTokenHash('reschedule_token_hash', hash, clinicId)
  const prog = rows[0]

  if (!prog)                                 return redirect(cancelPageUrl('', '', 'expired'))
  if (isTokenExpired(prog.tokens_expire_at)) return redirect(cancelPageUrl('', '', 'expired'))
  if (prog.status === 'anulat')              return redirect(cancelPageUrl('', '', 'already-cancelled'))

  const target = new URL(SITE + '/programareclinica.html')
  target.searchParams.set('reprogramare_id',        prog.programare_id)
  target.searchParams.set('reprogramare_clinic_id', clinicId)
  target.searchParams.set('rt',                     token) // reschedule token pentru context fetch
  return redirect(target.toString())
}

/**
 * GET context pentru pre-fill formular reschedule — validează token și întoarce
 * datele pacientului + programării. Apelat de programareclinica.html după ce
 * utilizatorul a aterizat pe pagină via redirect-ul handleReschedule.
 */
async function handleRescheduleContext(req: Request, token: string, clinicId: string): Promise<Response> {
  const hash = await hashToken(token)
  const url  = SUPABASE_URL + '/rest/v1/programari'
    + '?reschedule_token_hash=eq.' + encodeURIComponent(hash)
    + '&clinic_id=eq.' + encodeURIComponent(clinicId)
    + '&select=programare_id,personal_id,serviciu_id,pacient_id,status,tokens_expire_at'

  const res = await fetch(url, { headers: SB_HEADERS })
  if (!res.ok) return jsonResponse(req, 500, { error: 'db_error' })
  const rows = await res.json()
  const prog = Array.isArray(rows) ? rows[0] : null

  if (!prog)                                 return jsonResponse(req, 404, { error: 'token_invalid' })
  if (isTokenExpired(prog.tokens_expire_at)) return jsonResponse(req, 410, { error: 'token_expired' })
  if (prog.status === 'anulat')              return jsonResponse(req, 410, { error: 'already_cancelled' })

  // Fetch pacient pentru pre-fill formular
  const pacRes = await fetch(
    SUPABASE_URL + '/rest/v1/pacienti?id=eq.' + encodeURIComponent(prog.pacient_id) + '&select=prenume,nume,email,telefon',
    { headers: SB_HEADERS }
  )
  const pacRows = pacRes.ok ? await pacRes.json() : []
  const pac     = Array.isArray(pacRows) ? pacRows[0] : null

  return jsonResponse(req, 200, {
    programare_id: prog.programare_id,
    personal_id:   prog.personal_id,
    serviciu_id:   prog.serviciu_id,
    prenume:       pac?.prenume ?? '',
    nume:          pac?.nume ?? '',
    email:         pac?.email ?? '',
    telefon:       pac?.telefon ?? '',
  })
}

/**
 * POST pivot de la cancel → reschedule. Apelat din anulare-reminder.html când
 * utilizatorul alege „Reprogramează" în loc să anuleze. Validează cancel token
 * (nu îl consumă — poate reveni la cancel mai târziu), regenerează reschedule
 * token și întoarce URL-ul de redirect către resolve-action.
 */
async function handlePivotReschedule(req: Request, cancelToken: string, clinicId: string): Promise<Response> {
  const cancelHash = await hashToken(cancelToken)
  const rows       = await fetchByTokenHash('cancel_token_hash', cancelHash, clinicId)
  const prog       = rows[0]

  if (!prog)                                 return jsonResponse(req, 404, { error: 'token_invalid' })
  if (prog.cancel_token_used_at)             return jsonResponse(req, 410, { error: 'token_used' })
  if (isTokenExpired(prog.tokens_expire_at)) return jsonResponse(req, 410, { error: 'token_expired' })
  if (prog.status === 'anulat')              return jsonResponse(req, 410, { error: 'already_cancelled' })

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

  const redirectUrl = SUPABASE_URL
    + '/functions/v1/resolve-action?action=reschedule'
    + '&token='     + encodeURIComponent(newToken)
    + '&clinic_id=' + encodeURIComponent(clinicId)

  return jsonResponse(req, 200, { redirect_url: redirectUrl })
}

function genRandomToken(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function handleCancelView(token: string, clinicId: string): Promise<Response> {
  const hash = await hashToken(token)
  const rows = await fetchByTokenHash('cancel_token_hash', hash, clinicId)
  const prog = rows[0]

  if (!prog)                                 return redirect(cancelPageUrl('', '', 'expired'))
  if (prog.cancel_token_used_at)             return redirect(cancelPageUrl('', '', 'used'))
  if (isTokenExpired(prog.tokens_expire_at)) return redirect(cancelPageUrl('', '', 'expired'))
  if (prog.status === 'anulat')              return redirect(cancelPageUrl('', '', 'already-cancelled'))

  const slotMs = roSlotToUtcMs(prog.data_programare, prog.ora_start)
  if (slotMs == null) return redirect(cancelPageUrl('', '', 'invalid'))

  const when = fmtDataRo(prog.data_programare, prog.ora_start)

  if (slotMs - Date.now() < CUTOFF_MS) {
    return redirect(cancelPageUrl('', '', 'cutoff', when))
  }

  return redirect(cancelPageUrl(token, clinicId, 'ok', when))
}

async function handleCancelConfirm(req: Request, token: string, clinicId: string, motiv: string): Promise<Response> {
  const hash = await hashToken(token)
  const rows = await fetchByTokenHash('cancel_token_hash', hash, clinicId)
  const prog = rows[0]

  if (!prog)                                 return jsonResponse(req, 404, { error: 'token_invalid' })
  if (prog.cancel_token_used_at)             return jsonResponse(req, 410, { error: 'token_used' })
  if (isTokenExpired(prog.tokens_expire_at)) return jsonResponse(req, 410, { error: 'token_expired' })
  if (prog.status === 'anulat')              return jsonResponse(req, 200, { ok: true, already: true })

  const slotMs = roSlotToUtcMs(prog.data_programare, prog.ora_start)
  if (slotMs == null || slotMs - Date.now() < CUTOFF_MS) {
    return jsonResponse(req, 403, { error: 'cutoff_3h' })
  }

  // Marchează tokenul folosit ÎNAINTE de apelul anuleaza-slot (anti-replay idempotent)
  const markRes = await fetch(
    `${SUPABASE_URL}/rest/v1/programari?programare_id=eq.${encodeURIComponent(prog.programare_id)}&clinic_id=eq.${encodeURIComponent(clinicId)}&cancel_token_used_at=is.null`,
    {
      method:  'PATCH',
      headers: { ...SB_JSON, 'Prefer': 'return=representation' },
      body: JSON.stringify({ cancel_token_used_at: new Date().toISOString() }),
    }
  )
  if (!markRes.ok) {
    return jsonResponse(req, 500, { error: 'mark_used_failed' })
  }
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

/* ────────────────────────── Redirect helpers ──────────────────────────── */

function redirectConfirmSuccess(prog: any, clinicId: string, already: boolean): Response {
  const target = new URL(SITE + '/confirmare.html')
  target.searchParams.set('id',        prog.programare_id)
  target.searchParams.set('clinic_id', clinicId)
  target.searchParams.set('source',    'reminder')
  if (already) target.searchParams.set('already', '1')
  return redirect(target.toString())
}

function redirectConfirmErr(_clinicId: string, reason: string): Response {
  const target = new URL(SITE + '/confirmare.html')
  target.searchParams.set('source', 'reminder')
  target.searchParams.set('error',  reason)
  return redirect(target.toString())
}

/* ────────────────────────── DB helpers ────────────────────────────────── */

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token + TOKEN_HASH_SALT)
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function fetchByTokenHash(column: string, hash: string, clinicId: string): Promise<any[]> {
  const url = SUPABASE_URL + '/rest/v1/programari'
    + '?' + column + '=eq.' + encodeURIComponent(hash)
    + '&clinic_id=eq.' + encodeURIComponent(clinicId)
    + '&select=programare_id,clinic_id,personal_id,pacient_id,status,data_programare,ora_start,ora_sfarsit,tokens_expire_at,confirm_token_used_at,cancel_token_used_at'

  const res = await fetch(url, { headers: SB_HEADERS })
  if (!res.ok) return []
  const rows = await res.json()
  return Array.isArray(rows) ? rows : []
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

function fmtDataRo(dateIso: string, oraStart: string): string {
  try {
    const d = new Date(dateIso + 'T' + oraStart.slice(0, 5) + ':00')
    const datePart = d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return datePart + ' la ' + oraStart.slice(0, 5)
  } catch { return dateIso + ' ' + oraStart }
}
