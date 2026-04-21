/**
 * save-booking — gestionează toate scrierile pentru o programare nouă sau reprogramare.
 *
 * POST /functions/v1/save-booking
 *
 * Programare nouă (body):
 *   { slug, email?, prenume, nume?, telefon?,
 *     personal_id, serviciu_id?, data_programare, ora_start, ora_sfarsit,
 *     doreste_loc_mai_devreme? }
 *
 *   `slug` e obligatoriu — clinic_id se derivă server-side din clinici.slug.
 *   `pret_ron` din body este IGNORAT — se derivă din servicii.pret_ron.
 *
 * Reprogramare (body):
 *   { reprogramare_id, reprogramare_cid?, personal_id, serviciu_id?,
 *     data_programare, ora_start, ora_sfarsit }
 *
 *   Rate limiting NU se aplică pe acest path.
 *
 * Răspuns succes: { programare_id }
 */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const IP_HASH_SALT     = Deno.env.get('IP_HASH_SALT') ?? ''
const ALLOWED_ORIGINS  = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://www.silleau.com,https://silleau.com')
  .split(',').map((s) => s.trim()).filter(Boolean)

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG_RE  = /^[a-z0-9-]{1,100}$/
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE  = /^\d{2}:\d{2}(:\d{2})?$/
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/

function isUUID(v: unknown): boolean { return typeof v === 'string' && UUID_RE.test(v) }
function isSlug(v: unknown): boolean { return typeof v === 'string' && SLUG_RE.test(v) }
function isDate(v: unknown): boolean { return typeof v === 'string' && DATE_RE.test(v) && !isNaN(Date.parse(v)) }
function isTime(v: unknown): boolean { return typeof v === 'string' && TIME_RE.test(v) }
function isStr(v: unknown, max = 255): boolean { return typeof v === 'string' && v.trim().length > 0 && v.length <= max }

const DB_HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type':  'application/json',
}

function corsHeaders(req: Request): Record<string, string> {
  const origin  = req.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary':                         'Origin',
  }
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

/* Determină momentul unui slot România (Europe/Bucharest) în UTC, ținând cont de DST. */
function roSlotToUtcMs(dateIso: string, oraStart: string): number | null {
  const [y, m, d] = dateIso.split('-').map(Number)
  const [hh, mm]  = oraStart.slice(0, 5).split(':').map(Number)
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null

  const noonUtc   = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const noonRoStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(noonUtc)
  const [noonH, noonM] = noonRoStr.split(':').map(Number)
  const offsetMs = (noonH * 60 + noonM - 720) * 60_000
  return Date.UTC(y, m - 1, d, hh, mm) - offsetMs
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function getClientIP(req: Request): string {
  return req.headers.get('CF-Connecting-IP')
    ?? req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? req.headers.get('X-Real-IP')
    ?? 'unknown'
}

/** Returnează { allowed } — true dacă e sub prag (5/h). */
async function checkRateLimit(req: Request): Promise<{ allowed: boolean; count?: number }> {
  const ip     = getClientIP(req)
  const ipHash = await sha256Hex(ip + IP_HASH_SALT)

  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/increment_rate_limit', {
    method:  'POST',
    headers: DB_HEADERS,
    body:    JSON.stringify({ p_ip_hash: ipHash }),
  })
  if (!res.ok) {
    // Dacă RPC-ul eșuează, permitem request-ul (fail-open) — logăm pentru alertă.
    console.warn('[save-booking] rate-limit RPC failed', res.status, await res.text().catch(() => ''))
    return { allowed: true }
  }
  const rows = await res.json()
  const count = Array.isArray(rows) ? Number(rows[0]?.count ?? 0) : Number(rows?.count ?? 0)
  return { allowed: count <= 5, count }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return json(req, 405, { error: 'method_not_allowed' })
  }

  try {
    const body = await req.json()

    /* ── Reprogramare: PATCH direct pe programari ─────────────────── */
    if (body.reprogramare_id) {
      return await handleReprogramare(req, body)
    }

    /* ── Programare nouă ─────────────────────────────────────────── */
    return await handleNewBooking(req, body)

  } catch (e) {
    return json(req, 500, { error: 'internal', detail: String(e) })
  }
})

/* ──────────────────────────────── Reprogramare ────────────────────────── */

async function handleReprogramare(req: Request, body: Record<string, unknown>): Promise<Response> {
  const reprogramare_id  = body.reprogramare_id
  const reprogramare_cid = body.reprogramare_cid
  const personal_id      = body.personal_id
  const serviciu_id      = body.serviciu_id ?? null
  const data_programare  = body.data_programare
  const ora_start        = body.ora_start
  const ora_sfarsit      = body.ora_sfarsit

  if (!isUUID(reprogramare_id) || !isUUID(personal_id) || !isDate(data_programare) || !isTime(ora_start) || !isTime(ora_sfarsit)) {
    return json(req, 400, { error: 'invalid_fields', message: 'câmpuri obligatorii lipsă sau format invalid pentru reprogramare' })
  }
  if ((ora_sfarsit as string) <= (ora_start as string)) {
    return json(req, 400, { error: 'invalid_time', message: 'ora_sfarsit trebuie să fie după ora_start' })
  }
  if (reprogramare_cid && !isUUID(reprogramare_cid)) {
    return json(req, 400, { error: 'invalid_cid', message: 'reprogramare_cid format invalid' })
  }
  if (serviciu_id && !isUUID(serviciu_id)) {
    return json(req, 400, { error: 'invalid_serviciu', message: 'serviciu_id format invalid' })
  }

  // Aflăm clinic_id-ul real din DB (pentru validări tenant) — nu avem încredere în reprogramare_cid.
  const existing = await sbGet('programari', `?programare_id=eq.${encodeURIComponent(reprogramare_id as string)}&select=programare_id,clinic_id,numar_reprogramari`)
  if (!existing[0]) return json(req, 404, { error: 'programare_not_found' })
  const clinicId = existing[0].clinic_id as string
  if (reprogramare_cid && reprogramare_cid !== clinicId) {
    return json(req, 403, { error: 'cross_tenant', field: 'reprogramare_cid' })
  }

  // Validare cross-tenant pentru personal + serviciu + pret server-side
  const tenant = await validateTenant(clinicId, personal_id as string, serviciu_id as string | null)
  if ('error' in tenant) return json(req, tenant.status, { error: tenant.error, field: tenant.field })
  const pret_ron = tenant.pret_ron

  // Check data viitoare ≥ 30 min
  const futureErr = validateFutureSlot(data_programare as string, ora_start as string)
  if (futureErr) return json(req, 400, futureErr)

  // Check conflict slot (excluzând programarea curentă pe care o reprogramăm)
  const conflictErr = await checkSlotConflict(personal_id as string, data_programare as string, ora_start as string, ora_sfarsit as string, reprogramare_id as string)
  if (conflictErr) return json(req, 409, conflictErr)

  const curNr = Number(existing[0].numar_reprogramari || 0)

  const rpRes = await fetch(
    SUPABASE_URL + '/rest/v1/programari?programare_id=eq.' + encodeURIComponent(reprogramare_id as string) + '&clinic_id=eq.' + encodeURIComponent(clinicId),
    {
      method:  'PATCH',
      headers: { ...DB_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        personal_id,
        serviciu_id,
        data_programare,
        ora_start,
        ora_sfarsit,
        status:             'neconfirmat',
        pret_ron,
        reminder_trimis:    false,
        confirmat_reminder: false,
        a_fost_reprogramat: true,
        numar_reprogramari: curNr + 1,
        // Notă: NU nullify-uim token-urile — a_fost_reprogramat=true e folosit
        // de resolve-action să afișeze „Deja reprogramată" la vechile link-uri.
        // Următorul send-reminders va regenera tokens (suprascrie hash-urile)
        // pentru noua programare.
      }),
    }
  )
  if (!rpRes.ok) {
    const txt = await rpRes.text()
    return json(req, 500, { error: 'db_patch_failed', detail: rpRes.status + ': ' + txt })
  }

  return json(req, 200, { programare_id: reprogramare_id })
}

/* ──────────────────────────────── Programare nouă ─────────────────────── */

async function handleNewBooking(req: Request, body: Record<string, unknown>): Promise<Response> {
  const {
    email,
    prenume,
    nume,
    telefon,
    slug,
    personal_id,
    serviciu_id,
    data_programare,
    ora_start,
    ora_sfarsit,
    doreste_loc_mai_devreme,
  } = body as Record<string, unknown>

  // Validări de bază
  if (!isStr(prenume as string, 100) || !isUUID(personal_id) || !isDate(data_programare) || !isTime(ora_start) || !isTime(ora_sfarsit)) {
    return json(req, 400, { error: 'invalid_fields', message: 'câmpuri obligatorii lipsă sau format invalid' })
  }
  if ((ora_sfarsit as string) <= (ora_start as string)) {
    return json(req, 400, { error: 'invalid_time', message: 'ora_sfarsit trebuie să fie după ora_start' })
  }
  if (email && !EMAIL_RE.test(email as string)) {
    return json(req, 400, { error: 'invalid_email' })
  }
  if (nume && !isStr(nume as string, 100)) {
    return json(req, 400, { error: 'invalid_nume' })
  }
  if (telefon && (typeof telefon !== 'string' || telefon.length > 20)) {
    return json(req, 400, { error: 'invalid_telefon' })
  }
  if (serviciu_id && !isUUID(serviciu_id)) {
    return json(req, 400, { error: 'invalid_serviciu' })
  }

  // Derivă clinic_id din slug (obligatoriu). Branch-ul clinic_id a fost eliminat în Faza F.
  if (!isSlug(slug)) return json(req, 400, { error: 'invalid_slug', message: 'slug obligatoriu' })
  const clinicRows = await sbGet('clinici', `?slug=eq.${encodeURIComponent(slug as string)}&select=id`)
  if (!clinicRows[0]?.id) return json(req, 404, { error: 'clinic_not_found' })
  const clinicId = clinicRows[0].id as string

  // Fix 5: data_programare în viitor, minim 30 min
  const futureErr = validateFutureSlot(data_programare as string, ora_start as string)
  if (futureErr) return json(req, 400, futureErr)

  // Fix 2: validare cross-tenant (personal + serviciu) + pret server-side
  const tenant = await validateTenant(clinicId, personal_id as string, (serviciu_id as string | null) ?? null)
  if ('error' in tenant) return json(req, tenant.status, { error: tenant.error, field: tenant.field })
  const pret_ron = tenant.pret_ron

  // Fix 3: rate limiting 5/h per IP (doar pe path-ul de programare nouă)
  const rl = await checkRateLimit(req)
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'rate_limit_exceeded', message: 'prea multe programări; încercați peste 1 oră' }), {
      status: 429,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json', 'Retry-After': '3600' },
    })
  }

  // Fix 4: conflict slot
  const conflictErr = await checkSlotConflict(personal_id as string, data_programare as string, ora_start as string, ora_sfarsit as string, null)
  if (conflictErr) return json(req, 409, conflictErr)

  /* 1. Upsert pacienti */
  const pacRes = await fetch(SUPABASE_URL + '/rest/v1/pacienti?on_conflict=telefon', {
    method:  'POST',
    headers: { ...DB_HEADERS, 'Prefer': 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ email, prenume, nume, telefon }),
  })
  if (!pacRes.ok) {
    return json(req, 500, { error: 'pacienti_upsert_failed', detail: pacRes.status + ': ' + await pacRes.text() })
  }
  const pacRows = await pacRes.json()
  let pacient_id: string
  if (Array.isArray(pacRows) && pacRows.length === 0) {
    // Pacient existent — fetch după telefon
    const exRows = await sbGet('pacienti', `?telefon=eq.${encodeURIComponent(telefon as string)}&select=id`)
    if (!exRows[0]?.id) return json(req, 500, { error: 'pacient_lookup_failed' })
    pacient_id = exRows[0].id as string
  } else {
    pacient_id = Array.isArray(pacRows) ? pacRows[0].id : pacRows.id
  }

  /* 2. Upsert pacienti_clinici */
  const pcRes = await fetch(SUPABASE_URL + '/rest/v1/pacienti_clinici', {
    method:  'POST',
    headers: { ...DB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ pacient_id, clinic_id: clinicId, activ: true }),
  })
  if (!pcRes.ok) {
    return json(req, 500, { error: 'pacienti_clinici_failed', detail: pcRes.status + ': ' + await pcRes.text() })
  }

  /* 3. Insert programari */
  const prRes = await fetch(SUPABASE_URL + '/rest/v1/programari', {
    method:  'POST',
    headers: { ...DB_HEADERS, 'Prefer': 'return=representation' },
    body: JSON.stringify({
      clinic_id:                clinicId,
      pacient_id,
      personal_id,
      serviciu_id:              (serviciu_id as string | null) ?? null,
      data_programare,
      ora_start,
      ora_sfarsit,
      status:                   'neconfirmat',
      pret_ron,
      sursa:                    'formular',
      reminder_trimis:          false,
      doreste_loc_mai_devreme:  doreste_loc_mai_devreme ?? false,
    }),
  })
  if (!prRes.ok) {
    return json(req, 500, { error: 'programari_insert_failed', detail: prRes.status + ': ' + await prRes.text() })
  }
  const prRows = await prRes.json()
  const programare_id: string = Array.isArray(prRows) ? prRows[0].programare_id : prRows.programare_id

  return json(req, 200, { programare_id })
}

/* ──────────────────────────────── Helpers ─────────────────────────────── */

async function sbGet(table: string, query: string): Promise<any[]> {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + table + query, { headers: DB_HEADERS })
  if (!res.ok) return []
  const rows = await res.json()
  return Array.isArray(rows) ? rows : []
}

type TenantOk  = { pret_ron: number | null }
type TenantErr = { error: string; field: string; status: number }

async function validateTenant(clinicId: string, personalId: string, serviciuId: string | null): Promise<TenantOk | TenantErr> {
  const [persRows, servRows] = await Promise.all([
    sbGet('personal', `?id=eq.${encodeURIComponent(personalId)}&select=id,clinic_id`),
    serviciuId
      ? sbGet('servicii', `?id=eq.${encodeURIComponent(serviciuId)}&select=id,clinic_id,pret_ron`)
      : Promise.resolve([] as any[]),
  ])

  if (!persRows[0] || persRows[0].clinic_id !== clinicId) {
    return { error: 'cross_tenant', field: 'personal_id', status: 403 }
  }
  if (serviciuId) {
    if (!servRows[0] || servRows[0].clinic_id !== clinicId) {
      return { error: 'cross_tenant', field: 'serviciu_id', status: 403 }
    }
    return { pret_ron: servRows[0].pret_ron ?? null }
  }
  return { pret_ron: null }
}

/** Verifică dacă slotul e ≥ 30 min în viitor (timezone RO). */
function validateFutureSlot(dateIso: string, oraStart: string): { error: string; message: string } | null {
  const slotMs = roSlotToUtcMs(dateIso, oraStart)
  if (slotMs == null) return { error: 'invalid_date', message: 'data sau ora invalidă' }
  if (slotMs < Date.now() + 30 * 60_000) {
    return { error: 'invalid_date', message: 'programarea trebuie să fie cu minim 30 minute în viitor' }
  }
  return null
}

/** Returnează conflict error dacă există programare suprapusă (exclude excludeId dacă e dat). */
async function checkSlotConflict(
  personalId: string, dateIso: string, oraStart: string, oraSfarsit: string, excludeId: string | null
): Promise<{ error: string } | null> {
  let url = SUPABASE_URL + '/rest/v1/programari'
    + '?personal_id=eq.' + encodeURIComponent(personalId)
    + '&data_programare=eq.' + encodeURIComponent(dateIso)
    + '&status=in.(neconfirmat,confirmat)'
    + '&ora_start=lt.' + encodeURIComponent(oraSfarsit)
    + '&ora_sfarsit=gt.' + encodeURIComponent(oraStart)
    + '&select=programare_id'
  if (excludeId) url += '&programare_id=neq.' + encodeURIComponent(excludeId)

  const res = await fetch(url, { headers: DB_HEADERS })
  if (!res.ok) return null // fail-open; DB constraints mai sunt o plasă
  const rows = await res.json()
  if (Array.isArray(rows) && rows.length > 0) return { error: 'slot_unavailable' }
  return null
}
