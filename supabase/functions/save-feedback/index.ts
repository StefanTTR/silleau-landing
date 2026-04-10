const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SB_GET  = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB_GET, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }

const SITE = 'https://www.silleau.com'

function redirect(status: string, rating?: number): Response {
  const url = SITE + '/feedback.html?status=' + status + (rating ? '&rating=' + rating : '')
  return Response.redirect(url, 302)
}

Deno.serve(async (req) => {
  try {
    const url      = new URL(req.url)
    const id       = url.searchParams.get('id')
    const clinicId = url.searchParams.get('clinic_id')
    const tip      = url.searchParams.get('tip')
    const sursa    = url.searchParams.get('sursa') || tip || ''
    const rating   = parseInt(url.searchParams.get('rating') || '0')

    if (!id || !tip || rating < 1 || rating > 5) {
      return redirect('invalid')
    }

    /* Verifică dacă a mai dat feedback */
    const checkRes = await fetch(
      SUPABASE_URL + '/rest/v1/feedback?programare_id=eq.' + id + '&tip=eq.' + tip + '&select=id',
      { headers: SB_GET }
    )

    if (!checkRes.ok) {
      console.error('feedback check error:', checkRes.status, await checkRes.text())
      return redirect('error')
    }

    const existing = await checkRes.json()
    if (Array.isArray(existing) && existing.length > 0) {
      return redirect('already')
    }

    /* Salvează */
    const saveRes = await fetch(SUPABASE_URL + '/rest/v1/feedback', {
      method:  'POST',
      headers: SB_POST,
      body:    JSON.stringify({ programare_id: id, clinic_id: clinicId, tip, sursa, rating }),
    })

    if (!saveRes.ok) {
      console.error('feedback save error:', saveRes.status, await saveRes.text())
      return redirect('error')
    }

    return redirect('ok', rating)
  } catch (err) {
    console.error('save-feedback unhandled error:', err)
    return redirect('error')
  }
})
