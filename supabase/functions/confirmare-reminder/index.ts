const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SB_HEADERS = {
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
  'Content-Type':  'application/json',
  'Prefer':        'return=minimal',
}

Deno.serve(async (req) => {
  const url  = new URL(req.url)
  const id   = url.searchParams.get('id')

  if (!id) {
    return new Response('ID lipsă', { status: 400 })
  }

  // Marchează reminder ca confirmat
  await fetch(SUPABASE_URL + '/rest/v1/programari?id=eq.' + id, {
    method:  'PATCH',
    headers: SB_HEADERS,
    body:    JSON.stringify({ confirmat_reminder: true }),
  })

  // Returnează pagina HTML de confirmare
  return new Response(
    '<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Programare confirmată</title>'
    + '<style>'
    + 'body{margin:0;font-family:"Helvetica Neue",Arial,sans-serif;background:#0A0A0A;color:#E8E4DC;'
    + 'display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;}'
    + '.box{max-width:420px;}'
    + '.mark{font-size:40px;margin-bottom:16px;color:#C8B89A;}'
    + 'h1{font-size:22px;font-weight:300;letter-spacing:-.3px;margin:0 0 10px;}'
    + 'p{font-size:13px;color:#888;line-height:1.8;margin:0;}'
    + '</style></head>'
    + '<body><div class="box">'
    + '<div class="mark">✓</div>'
    + '<h1>Programare confirmată</h1>'
    + '<p>Vă mulțumim! Programarea dumneavoastră a fost confirmată.<br>'
    + 'Ne vedem la consultație.</p>'
    + '</div></body></html>',
    {
      status:  200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  )
})
