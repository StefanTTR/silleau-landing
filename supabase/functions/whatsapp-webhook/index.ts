/* whatsapp-webhook
   GET  — verificare webhook Meta (hub.challenge)
   POST — primește răspunsuri Quick Reply (rating 1-5 / confirmare) și salvează în programari */

const VERIFY_TOKEN = Deno.env.get('META_WA_VERIFY_TOKEN')!
const META_APP_SECRET = Deno.env.get('META_WA_APP_SECRET') || Deno.env.get('META_APP_SECRET') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SB = {
  'apikey': SERVICE_KEY,
  'Authorization': 'Bearer ' + SERVICE_KEY,
}

const SB_PATCH = {
  ...SB,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
}

Deno.serve(async (req) => {

  /* ── GET — verificare webhook Meta ── */
  if (req.method === 'GET') {
    const p = new URL(req.url).searchParams
    if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === VERIFY_TOKEN) {
      return new Response(p.get('hub.challenge'), { status: 200 })
    }
    return new Response('Forbidden', { status: 403 })
  }

  /* ── POST — mesaj primit ── */
  if (req.method === 'POST') {
    try {
      const rawBody = await req.text()

      if (!(await verifyMetaSignature(req.headers, rawBody))) {
        console.warn('[WA-webhook] semnatura Meta invalida')
        return new Response('Forbidden', { status: 403 })
      }

      const body = JSON.parse(rawBody)
      const msg  = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]

      if (!msg) {
        return new Response('ok', { status: 200 })
      }

      const fromRaw = String(msg.from || '')
      if (!fromRaw) return new Response('ok', { status: 200 })

      const telefon = fromRaw.startsWith('40') ? '0' + fromRaw.slice(2) : fromRaw
      const inboundText = extractInboundText(msg)
      const buttonPayload = extractPayload(msg)
      const contextProgramare = await resolveProgramareContext(msg, buttonPayload, inboundText, telefon)

      if (!contextProgramare) {
        console.warn('[WA-webhook] context programare lipsa pentru telefon:', telefon, 'payload:', buttonPayload)
        return new Response('ok', { status: 200 })
      }

      const { programare_id, clinic_id } = contextProgramare

      if (buttonPayload?.startsWith('CONFIRM|') || /^confirm$/i.test(inboundText)) {
        await patchProgramare(programare_id, clinic_id, { confirmat_reminder: true })
        console.log('[WA-webhook] confirmat_reminder=true pentru programare', programare_id, 'clinic', clinic_id)
        return new Response('ok', { status: 200 })
      }

      const rating = extractRating(buttonPayload, inboundText)
      if (rating < 1 || rating > 5) {
        return new Response('ok', { status: 200 })
      }

      await patchProgramare(programare_id, clinic_id, { feedback_ces: rating })
      console.log('[WA-webhook] feedback', rating, 'salvat pentru programare', programare_id, 'clinic', clinic_id)
    } catch (e) {
      console.error('[WA-webhook] eroare:', String(e))
    }

    return new Response('ok', { status: 200 })
  }

  return new Response('Method Not Allowed', { status: 405 })
})

async function verifyMetaSignature(headers: Headers, body: string): Promise<boolean> {
  if (!META_APP_SECRET) {
    console.warn('[WA-webhook] META_WA_APP_SECRET lipseste; resping POST pentru siguranta')
    return false
  }

  const provided = headers.get('x-hub-signature-256') || headers.get('X-Hub-Signature-256') || ''
  if (!provided.startsWith('sha256=')) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(META_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const expected = 'sha256=' + toHex(signature)
  return timingSafeEqual(provided, expected)
}

function extractPayload(msg: any): string {
  if (msg?.button?.payload) return String(msg.button.payload)
  if (msg?.interactive?.button_reply?.id) return String(msg.interactive.button_reply.id)
  if (msg?.interactive?.list_reply?.id) return String(msg.interactive.list_reply.id)
  return ''
}

function extractInboundText(msg: any): string {
  if (msg?.text?.body) return String(msg.text.body).trim()
  if (msg?.button?.text) return String(msg.button.text).trim()
  if (msg?.interactive?.button_reply?.title) return String(msg.interactive.button_reply.title).trim()
  if (msg?.interactive?.list_reply?.title) return String(msg.interactive.list_reply.title).trim()
  return ''
}

function extractRating(payload: string, inboundText: string): number {
  const fromPayload = payload.match(/(?:^|\|)([1-5])(?:\||$)/)
  if (fromPayload) return parseInt(fromPayload[1])

  const cleanText = inboundText.trim()
  if (/^[1-5]$/.test(cleanText)) return parseInt(cleanText)

  return NaN
}

async function resolveProgramareContext(msg: any, payload: string, inboundText: string, telefon: string): Promise<{ programare_id: string, clinic_id: string } | null> {
  const fromPayload = parseProgramareContextFromText(payload)
  if (fromPayload) return fromPayload

  const fromText = parseProgramareContextFromText(inboundText)
  if (fromText) return fromText

  const contextId = msg?.context?.id ? String(msg.context.id) : ''
  if (contextId) {
    const fromLog = await findProgramareFromWhatsappLog(contextId, telefon)
    if (fromLog) return fromLog
  }

  return null
}

function parseProgramareContextFromText(value: string): { programare_id: string, clinic_id: string } | null {
  if (!value) return null

  const parts = value.split('|').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 3 && looksLikeUuid(parts[1]) && looksLikeUuid(parts[2])) {
    return { clinic_id: parts[1], programare_id: parts[2] }
  }

  const programareMatch = value.match(/programare[_-]?id[:=]([0-9a-f-]{8,})/i)
  const clinicMatch = value.match(/clinic[_-]?id[:=]([0-9a-f-]{8,})/i)
  if (programareMatch && clinicMatch) {
    return { programare_id: programareMatch[1], clinic_id: clinicMatch[1] }
  }

  return null
}

async function findProgramareFromWhatsappLog(messageId: string, telefon: string): Promise<{ programare_id: string, clinic_id: string } | null> {
  const tableCandidates = ['whatsapp_mesaje', 'whatsapp_outbox', 'whatsapp_conversatii']
  const selectClause = 'programare_id,clinic_id,pacient_telefon,meta_message_id'

  for (const table of tableCandidates) {
    const url = SUPABASE_URL + '/rest/v1/' + table
      + '?meta_message_id=eq.' + encodeURIComponent(messageId)
      + '&select=' + encodeURIComponent(selectClause)
      + '&limit=1'

    const res = await fetch(url, { headers: SB })
    if (!res.ok) {
      const txt = await res.text()
      console.warn('[WA-webhook] tabela context indisponibila', table, res.status, txt)
      continue
    }

    const rows = await res.json()
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row?.programare_id || !row?.clinic_id) continue

    if (row.pacient_telefon && normalizePhoneRO(String(row.pacient_telefon)) !== normalizePhoneRO(telefon)) {
      continue
    }

    return {
      programare_id: String(row.programare_id),
      clinic_id: String(row.clinic_id),
    }
  }

  return null
}

async function patchProgramare(programareId: string, clinicId: string, body: Record<string, unknown>) {
  const res = await fetch(
    SUPABASE_URL + '/rest/v1/programari?programare_id=eq.' + programareId + '&clinic_id=eq.' + clinicId,
    {
      method: 'PATCH',
      headers: SB_PATCH,
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const txt = await res.text()
    throw new Error('Supabase PATCH error ' + res.status + ': ' + txt)
  }
}

function normalizePhoneRO(telefon: string): string {
  const digits = telefon.replace(/[^\d]/g, '')
  if (digits.startsWith('40')) return '0' + digits.slice(2)
  return digits
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}
