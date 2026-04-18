const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_SECRET     = Deno.env.get('ADMIN_SECRET') || ''
const SITE             = 'https://www.silleau.com'

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
const CORS    = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8' } })
}

function page(title: string, content: string) {
  return `<!DOCTYPE html><html lang="ro"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — SILLEAU</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Inter',sans-serif;background:#0D0D0D;color:#E8E4DC;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
    .card{background:#141414;border:1px solid #272727;border-radius:6px;padding:40px;max-width:480px;width:100%;text-align:center;}
    .logo{font-size:9px;letter-spacing:.25em;text-transform:uppercase;color:#666;margin-bottom:24px;}
    .icon{font-size:32px;margin-bottom:16px;}
    .title{font-size:22px;font-weight:300;margin-bottom:8px;}
    .title em{font-style:italic;}
    .sub{font-size:13px;color:#666;line-height:1.7;margin-bottom:28px;}
    .clinic{font-size:15px;color:#E8E4DC;margin-bottom:24px;padding:12px 16px;background:#1A1A1A;border:1px solid #333;border-radius:4px;}
    .url-box{display:flex;gap:8px;margin-bottom:12px;}
    .url-input{flex:1;background:#0A0A0A;border:1px solid #333;border-radius:4px;padding:10px 12px;color:#E8E4DC;font-size:11px;font-family:monospace;outline:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .copy-btn{padding:10px 16px;background:#E8E4DC;color:#111;border:none;border-radius:4px;font-size:10px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:opacity .2s;}
    .copy-btn:hover{opacity:.85;}
    .copy-btn.copied{background:#5A8C5A;color:#fff;}
    .note{font-size:10px;color:#444;margin-top:8px;}
    .err{color:#C45C5C;}
  </style>
  </head><body><div class="card">${content}</div>
  <script>
  function copyUrl(){
    var inp = document.getElementById('urlInp');
    if(!inp) return;
    navigator.clipboard.writeText(inp.value).then(function(){
      var btn = document.getElementById('copyBtn');
      btn.textContent = '✓ Copiat';
      btn.classList.add('copied');
      setTimeout(function(){ btn.textContent = 'Copiază'; btn.classList.remove('copied'); }, 2000);
    });
  }
  </script>
  </body></html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const params   = new URL(req.url).searchParams
  const clinicId = params.get('clinic_id') || ''
  const secret   = params.get('s')         || ''

  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return html(page('Acces interzis',
      '<div class="icon">✕</div>'
      + '<div class="title" style="color:#C45C5C">Acces <em>interzis</em></div>'
      + '<div class="sub">Secret invalid.</div>'
    ), 403)
  }

  if (!clinicId) {
    return html(page('Eroare',
      '<div class="icon">⚠️</div>'
      + '<div class="title">Parametru <em>lipsă</em></div>'
      + '<div class="sub">clinic_id lipsește din URL.</div>'
    ), 400)
  }

  // Verifică clinica
  const clinicRes = await fetch(
    `${SUPABASE_URL}/rest/v1/clinici?id=eq.${encodeURIComponent(clinicId)}&select=id,nume,plan`,
    { headers: SB }
  )
  const clinics = await clinicRes.json()
  const clinic  = Array.isArray(clinics) ? clinics[0] : null

  if (!clinic) {
    return html(page('Eroare',
      '<div class="icon">⚠️</div>'
      + '<div class="title">Clinică <em>negăsită</em></div>'
      + '<div class="sub">ID-ul clinicii nu există în baza de date.</div>'
    ), 404)
  }

  // Generează token nou (7 zile)
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000).toISOString()
  const tokRes    = await fetch(`${SUPABASE_URL}/rest/v1/tema_tokens`, {
    method:  'POST',
    headers: SB_POST,
    body:    JSON.stringify({ clinic_id: clinicId, expires_at: expiresAt }),
  })

  if (!tokRes.ok) {
    return html(page('Eroare',
      '<div class="icon">⚠️</div>'
      + '<div class="title">Eroare <em>internă</em></div>'
      + '<div class="sub">Nu s-a putut genera tokenul. Reîncercați.</div>'
    ), 500)
  }

  const toks = await tokRes.json()
  const tok  = Array.isArray(toks) ? toks[0] : toks
  const url  = `${SITE}/configurator.html?t=${encodeURIComponent(tok.token)}`

  return html(page('Token generat',
    '<div class="logo">SILLEAU Admin</div>'
    + '<div class="icon">🔑</div>'
    + '<div class="title">Token <em>generat</em></div>'
    + '<div class="sub">Trimite link-ul de mai jos clinicii.<br>Valabil 7 zile.</div>'
    + '<div class="clinic">🏥 ' + clinic.nume + ' &nbsp;·&nbsp; ' + ({starter:'Starter',pro:'Pro',white_label:'White Label'}[clinic.plan as string]||clinic.plan) + '</div>'
    + '<div class="url-box">'
    + '<input id="urlInp" class="url-input" type="text" readonly value="' + url + '">'
    + '<button id="copyBtn" class="copy-btn" onclick="copyUrl()">Copiază</button>'
    + '</div>'
    + '<div class="note">Expiră: ' + new Date(expiresAt).toLocaleDateString('ro-RO', {day:'numeric',month:'long',year:'numeric'}) + '</div>'
  ))
})
