/**
 * upload-branding — primește logo sau favicon prin multipart/form-data
 * din setup.html / configurator.html (după validarea tokenului), urcă
 * fișierul în bucketul Storage `clinic-logos` și returnează public URL-ul.
 *
 * POST /functions/v1/upload-branding
 * Form fields:
 *   t    — token temă valid (neconsumat)
 *   kind — 'logo' sau 'favicon'
 *   file — File (image/*)
 *
 * Salvează URL-ul direct în clinic_branding (upsert pe clinic_id) și îl
 * returnează și clientului. Statusul devine `pending_approval`, astfel
 * orice schimbare de logo/favicon reintră în fluxul de aprobare — același
 * tratament ca pentru culori/fonturi modificate prin salveaza-tema.
 */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET           = 'clinic-logos'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const LOGO_MIME    = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
const FAVICON_MIME = new Set(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'])
const MAX_LOGO     = 2 * 1024 * 1024   // 2 MB
const MAX_FAVICON  = 128 * 1024        // 128 KB

function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/png':                    return 'png'
    case 'image/jpeg':                   return 'jpg'
    case 'image/svg+xml':                return 'svg'
    case 'image/webp':                   return 'webp'
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':     return 'ico'
    default:                             return 'bin'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ error: 'multipart_invalid' }, 400)
  }

  const token = String(form.get('t')    || '')
  const kind  = String(form.get('kind') || '')
  const file  = form.get('file')

  if (!token)                              return json({ error: 'token_lipsa' }, 400)
  if (kind !== 'logo' && kind !== 'favicon') return json({ error: 'kind_invalid' }, 400)
  if (!(file instanceof File))             return json({ error: 'file_lipsa' }, 400)

  // Validare token
  const tokRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tema_tokens?token=eq.${encodeURIComponent(token)}&select=clinic_id,used_at,invalidated_at,expires_at`,
    { headers: { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY } }
  )
  const toks = await tokRes.json()
  const tok  = Array.isArray(toks) ? toks[0] : null
  if (!tok)                                         return json({ error: 'token_invalid' }, 400)
  if (tok.used_at)                                  return json({ error: 'token_folosit' }, 400)
  if (tok.invalidated_at)                           return json({ error: 'token_invalidat' }, 400)
  if (new Date(tok.expires_at) < new Date())        return json({ error: 'token_expirat' }, 400)

  // Validare fișier
  const mime = file.type || ''
  const size = file.size || 0
  if (kind === 'logo') {
    if (!LOGO_MIME.has(mime)) return json({ error: 'tip_invalid_logo' }, 400)
    if (size > MAX_LOGO)      return json({ error: 'fisier_prea_mare', max: MAX_LOGO }, 400)
  } else {
    if (!FAVICON_MIME.has(mime)) return json({ error: 'tip_invalid_favicon' }, 400)
    if (size > MAX_FAVICON)      return json({ error: 'fisier_prea_mare', max: MAX_FAVICON }, 400)
  }

  const ext  = extFromMime(mime)
  const path = `${tok.clinic_id}/${kind}.${ext}`

  // Upload în Storage (upsert)
  const buf = new Uint8Array(await file.arrayBuffer())
  const upRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: 'POST',
      headers: {
        'apikey':        SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
        'Content-Type':  mime,
        'x-upsert':      'true',
        'Cache-Control': '3600',
      },
      body: buf,
    }
  )

  if (!upRes.ok) {
    const txt = await upRes.text()
    return json({ error: 'upload_esuat', details: txt }, 500)
  }

  // Curăță alte extensii rămase de la upload-uri anterioare (ex: logo.png apoi logo.svg)
  try {
    const listRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`,
      {
        method: 'POST',
        headers: {
          'apikey':        SERVICE_ROLE_KEY,
          'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ prefix: `${tok.clinic_id}/`, limit: 100 }),
      }
    )
    if (listRes.ok) {
      const list = await listRes.json() as Array<{ name: string }>
      const stale = list
        .filter(o => o?.name?.startsWith(`${kind}.`) && o.name !== `${kind}.${ext}`)
        .map(o => `${tok.clinic_id}/${o.name}`)
      if (stale.length > 0) {
        await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
          method: 'DELETE',
          headers: {
            'apikey':        SERVICE_ROLE_KEY,
            'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ prefixes: stale }),
        })
      }
    }
  } catch { /* best-effort cleanup */ }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}?v=${Date.now()}`

  // Persistă URL-ul în clinic_branding (upsert) și marchează statusul ca pending_approval
  const urlColumn = kind === 'logo' ? 'logo_url' : 'favicon_url'
  const upsertBody: Record<string, unknown> = {
    clinic_id:    tok.clinic_id,
    status:       'pending_approval',
    submitted_at: new Date().toISOString(),
  }
  upsertBody[urlColumn] = publicUrl

  const persistRes = await fetch(`${SUPABASE_URL}/rest/v1/clinic_branding`, {
    method: 'POST',
    headers: {
      'apikey':        SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(upsertBody),
  })
  if (!persistRes.ok) {
    const txt = await persistRes.text()
    return json({ error: 'persistenta_esuata', details: txt }, 500)
  }

  return json({ url: publicUrl, path, kind, size, mime })
})
