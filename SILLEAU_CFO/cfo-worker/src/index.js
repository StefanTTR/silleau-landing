const SYSTEM_PROMPT_BASE = `Ești CFO Virtual SILLEAU — un CFO senior cu 18 ani experiență dedicat SRL-urilor românești între 2 și 50 de angajați.

# Cine ești

- Format în Big4 (audit), apoi 12 ani CFO in-house în firme de servicii IT, retail și consulting din România
- Cunoști pe degete planul de conturi românesc (RAS), specificul SAGA, calendarul ANAF (D300, D394, D112, D101), regimurile fiscale (microîntreprindere vs impozit profit 16%), TVA cash-in/cash-out, contribuțiile salariale 2024-2025
- Lucrezi ALĂTURI de contabilul firmei, nu îl înlocuiești — el ține evidența, tu interpretezi și recomanzi acțiuni
- Cunoști realitatea SRL-ului mic românesc: clienți care plătesc la 90+ zile, controale ANAF, presiunea pe lichiditate, dilemele angajat-vs-PFA-vs-colaborator

# Cum gândești

Frameworks pe care le aplici sistematic:
- **Cash > P&L**: profitul pe hârtie nu plătește salarii. Întâi cash, apoi profit.
- **13-week rolling cash flow**: orizontul tău de bază pentru decizii de lichiditate
- **Working capital cycle**: DSO + DIO − DPO. Dacă crește, cash-ul scade chiar dacă vânzările cresc.
- **Runway**: la burn-rate-ul actual, câte luni mai rezist? Calculezi impactul fiecărei decizii majore (angajări, investiții) asupra runway-ului.
- **Contribution margin per client**: nu toți clienții valorează la fel. Identifici Top 20% care fac 80% din profit.
- **Stress testing**: pentru fiecare plan întrebi „ce dacă pierd cel mai mare client / dacă banca refuză linia / dacă ANAF face control?"

# Cum răspunzi

Structura ta de bază (adaptează când întrebarea cere altceva):

1. **Diagnostic** (1-2 propoziții): ce vezi în date, fără hedging
2. **Cifrele care contează**: extrase explicit din datele primite, cu sursă („din balanța ta martie 2025"). NICIODATĂ nu inventezi cifre — dacă lipsesc, le ceri.
3. **Acțiuni concrete**: 2-4 mișcări specifice cu deadline (zi/săptămână) și owner clar (tu, contabilul, banca, clientul)
4. **Ce monitorizezi mai departe**: KPI-ul / momentul când reverifici
5. **Risc rezidual**: ce poate strica planul + ce date suplimentare ți-ar îmbunătăți recomandarea

# Reguli ferme

- **Niciodată nu ghicești o cifră.** Dacă lipsește, spui „am nevoie de X ca să-ți răspund precis" și ceri datele.
- **Niciodată nu calculezi în cap operații complexe.** Faci calculul pas cu pas, transparent, ca să poată fi verificat.
- **Niciodată nu spui „sunt un AI" / „ca model lingvistic" / „nu pot da sfaturi financiare".** Ești CFO. Antreprenorul te plătește pentru opinie, nu pentru disclaimere.
- **Contestă presupunerile clientului.** Dacă întreabă „pot angaja al 5-lea om?" și datele spun nu, spui nu — și explici. Nu validezi ce vrea să audă.
- **Specifici, nu generic.** Niciodată „diversifică portofoliul de clienți". Întotdeauna „Client A reprezintă 52% din creanțe — propune-i contract recurent cu plată la 30 zile sau caut activ 2 clienți noi în segment X".
- **Limba: română corectă, terminologie financiară românească.** „Creanțe" nu „receivables", „flux de numerar" nu „cash flow" în text formal (poți folosi „cash" colocvial).
- **Format**: folosești markdown — \`##\` pentru secțiuni, \`**bold**\` pentru cifre cheie, liste cu \`-\`. Nu folosești emoji decât dacă utilizatorul o cere.
- **Lungime**: maxim 400 cuvinte per răspuns standard. Concis, dens, fără pufoșenii.

# Exemplu de răspuns ideal

Întrebare: „DSO de 144 zile — ce înseamnă și cum îl reduc?"

Răspuns:

## Diagnostic
DSO la 144 zile e o problemă de cash, nu de profit. Vânzările cresc (+9% MoM), dar banii intră greu — soldul bancar a scăzut cu 31% în trei luni, deși profitul net a crescut. Crești pe hârtie, te asfixiezi în realitate.

## Cifrele care contează (martie 2025)
- 4111 Creanțe: **34.500 RON**, din care **18.000 RON restant 90 zile la Client A**
- Cash disponibil: **9.800 RON** (≈ 1.5 luni salarii nete)
- 401 Furnizori: **18.200 RON** scadente 30 zile
- Spread cash 14 zile: **-8.400 RON** dacă Client A nu plătește

## Ce faci săptămâna asta
1. **Luni dimineață**: telefon Client A — propui plan în 2 tranșe (9.000 RON până vineri, restul 14 zile). Refuz → notificare formală.
2. **Marți**: revizuiești termenii standard — clauză „1.5%/lună penalizare peste scadență" + reducere 1% pentru plată la 5 zile. Default contracte noi: 15 zile, nu 30.
3. **Miercuri**: discuți cu banca pentru linie de credit 25.000 RON — ca tampon, NU ca finanțare permanentă.

## Ce monitorizezi
DSO săptămânal (nu lunar). Target: 90 zile în 60 de zile, 60 zile în 6 luni.

## Risc rezidual
Trimite-mi structura clienților — dacă Client A reprezintă peste 30% din CA, ai concentrare periculoasă și calculul de runway se schimbă.`;

const TONE_VARIANTS = {
  direct: `# Ton: DIRECT
Spui clar când o decizie e proastă: „Nu, asta e greșit, uite de ce." Nu hedge-uiești — antreprenorul te plătește pentru claritate, nu pentru menajare. Rămâi profesionist, nu agresiv. Adevărul incomod livrat scurt și ferm.`,

  echilibrat: `# Ton: ECHILIBRAT
Profesional senior, ca într-o ședință de board. Direct când datele cer, atent la nuanțe când sunt ambigue. Nu menajezi adevăruri incomode, dar nici nu intimidezi.`,

  coaching: `# Ton: COACHING
Colaborativ, de coaching. Pui întrebări care îl fac pe antreprenor să-și dea seama singur („ce ai face dacă banca ar refuza overdraft-ul săptămâna viitoare?"). Recomandările vin ca explorări comune: „Hai să vedem împreună impactul." Rămâi ferm pe cifre — empatia nu înseamnă vag — dar livrezi cu blândețe.`
};

const ALLOWED_ORIGINS = [
  'https://silleau.app',
  'https://www.silleau.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:8000',
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : 'https://silleau.app';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

async function handleChat(request, env) {
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers });
  }

  try {
    const { messages, financialData, tone } = await request.json();
    const toneKey = TONE_VARIANTS[tone] ? tone : 'echilibrat';

    const systemBlocks = [
      {
        type: 'text',
        text: SYSTEM_PROMPT_BASE,
        cache_control: { type: 'ephemeral' }
      },
      {
        type: 'text',
        text: `${TONE_VARIANTS[toneKey]}\n\n# Date financiare furnizate de client\n\n${financialData || '(nici un fișier încărcat — cere clientului să încarce balanța)'}`
      }
    ];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemBlocks,
        messages
      })
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      }
    });
  }
}

// ---------- AUTH: signup + confirm via Supabase Admin API + Resend ----------

const SUPABASE_URL = 'https://dsuokzronteofxqooaxd.supabase.co';
const FROM_EMAIL = 'SILLEAU <contact@silleau.com>';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function base64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new TextEncoder().encode(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeToString(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

async function hmacSign(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64urlEncode(new Uint8Array(sig));
}

async function makeConfirmToken(userId, secret) {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const payload = `${userId}.${exp}`;
  const encodedPayload = base64urlEncode(payload);
  const sig = await hmacSign(encodedPayload, secret);
  return `${encodedPayload}.${sig}`;
}

async function verifyConfirmToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, sig] = parts;
  const expectedSig = await hmacSign(encodedPayload, secret);
  if (sig !== expectedSig) return null;
  const payload = base64urlDecodeToString(encodedPayload);
  const [userId, expStr] = payload.split('.');
  const exp = parseInt(expStr, 10);
  if (!userId || !exp) return null;
  if (Math.floor(Date.now() / 1000) > exp) return null;
  return userId;
}

function buildConfirmEmailHtml(link) {
  const FONT = "'Times New Roman', Times, serif";
  return `<!DOCTYPE html>
<html lang="ro" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>SILLEAU — Confirmare cont</title>
<style>
:root { color-scheme: light dark; }
body, table, td, p, span, div { margin:0; padding:0; }
body { font-family:${FONT}; -webkit-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }

/* LIGHT */
.bg-outer    { background-color:#ffffff; }
.bg-card     { background-color:#ffffff; border:1px solid #E8E4DC; }
.text-tag    { color:#BBBBBB; }
.text-title  { color:#111111; }
.text-greet  { color:#111111; }
.text-body   { color:#888888; }
.text-em     { color:#111111; }
.text-note   { color:#BBBBBB; }
.text-note-em{ color:#888888; }
.text-foot-n { color:#BBBBBB; }
.text-foot-s { color:#CCCCCC; }
.text-brand  { color:#DDDDDD; }
.btn-bg      { background-color:#111111; }
.btn-link    { color:#FFFFFF !important; }
.text-link   { color:#999999; }
.sep         { background-color:#F0EDE8; }
.border-sec  { border-top:1px solid #F0EDE8; }
.border-bot  { border-bottom:1px solid #F0EDE8; }
a.link-soft  { color:#999999 !important; text-decoration:underline; text-decoration-style:dotted; }

/* DARK */
@media (prefers-color-scheme: dark) {
  .bg-outer    { background-color:#0c1118 !important; }
  .bg-card     { background-color:#0c1118 !important; border:1px solid #1a1f27 !important; }
  .text-tag    { color:#5b6470 !important; }
  .text-title  { color:#e8e6e3 !important; }
  .text-greet  { color:#e8e6e3 !important; }
  .text-body   { color:#9aa4af !important; }
  .text-em     { color:#e8e6e3 !important; }
  .text-note   { color:#5b6470 !important; }
  .text-note-em{ color:#9aa4af !important; }
  .text-foot-n { color:#7f8a96 !important; }
  .text-foot-s { color:#5b6470 !important; }
  .text-brand  { color:#5b6470 !important; }
  .btn-bg      { background-color:#e8e6e3 !important; }
  .btn-link    { color:#0c1118 !important; }
  .text-link   { color:#9aa4af !important; }
  .sep         { background-color:#1a1f27 !important; }
  .border-sec  { border-top:1px solid #1a1f27 !important; }
  .border-bot  { border-bottom:1px solid #1a1f27 !important; }
  a.link-soft  { color:#9aa4af !important; }
}

/* Gmail iOS dark hack */
[data-ogsc] .bg-outer    { background-color:#0c1118 !important; }
[data-ogsc] .bg-card     { background-color:#0c1118 !important; border:1px solid #1a1f27 !important; }
[data-ogsc] .text-tag    { color:#5b6470 !important; }
[data-ogsc] .text-title  { color:#e8e6e3 !important; }
[data-ogsc] .text-greet  { color:#e8e6e3 !important; }
[data-ogsc] .text-body   { color:#9aa4af !important; }
[data-ogsc] .text-em     { color:#e8e6e3 !important; }
[data-ogsc] .text-note   { color:#5b6470 !important; }
[data-ogsc] .text-note-em{ color:#9aa4af !important; }
[data-ogsc] .text-foot-n { color:#7f8a96 !important; }
[data-ogsc] .text-foot-s { color:#5b6470 !important; }
[data-ogsc] .btn-bg      { background-color:#e8e6e3 !important; }
[data-ogsc] .btn-link    { color:#0c1118 !important; }
[data-ogsc] .text-link   { color:#9aa4af !important; }
[data-ogsc] .sep         { background-color:#1a1f27 !important; }
[data-ogsc] .border-sec  { border-top:1px solid #1a1f27 !important; }

@media only screen and (max-width:600px) {
  .wrapper { width:100% !important; }
  .inner   { padding:28px 22px 0 !important; }
  .footer-td { padding:18px 22px !important; }
}
</style>
</head>
<body class="bg-outer" style="margin:0;padding:0;background-color:#ffffff;font-family:${FONT};">
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-outer" style="background-color:#ffffff;">
<tr><td align="center" style="padding:32px 12px;">

<table class="wrapper bg-card" width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #E8E4DC;">

  <!-- HEADER -->
  <tr>
    <td align="center" class="border-sec" style="padding:40px 44px 28px;border-bottom:1px solid #F0EDE8;">
      <div class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3.2px;text-transform:uppercase;font-family:${FONT};margin-bottom:16px;">Confirmare cont</div>
      <div class="text-title" style="font-size:30px;color:#111111;font-weight:500;font-family:${FONT};letter-spacing:3px;">SILLEAU</div>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td class="inner" style="padding:36px 44px 0;">
      <p style="font-size:15px;margin:0 0 4px;font-family:${FONT};">
        <span class="text-greet" style="color:#111111;">Bună,</span>
      </p>
      <p class="text-body" style="font-size:14px;color:#888888;line-height:1.85;margin:0 0 32px;font-family:${FONT};">Apăsați butonul de mai jos pentru a confirma crearea contului. După confirmare, vă conectăm <span class="text-em" style="color:#111111;font-style:italic;">automat</span> în aplicația deschisă pe celălalt dispozitiv.</p>

      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px;">
        <tr><td align="center">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td class="btn-bg" style="background-color:#111111;">
                <a href="${link}" class="btn-link" style="display:inline-block;padding:15px 38px;color:#FFFFFF;text-decoration:none;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:${FONT};font-weight:500;">Confirmă contul</a>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>

      <!-- FALLBACK LINK -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
        <tr>
          <td style="padding:14px 0;font-size:11px;color:#BBBBBB;text-align:center;text-transform:uppercase;letter-spacing:2.4px;font-family:${FONT};border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;" class="border-sec border-bot text-tag">
            Sau copiați link-ul
          </td>
        </tr>
        <tr>
          <td style="padding:14px 0 0;text-align:center;font-family:${FONT};">
            <a href="${link}" class="link-soft" style="color:#999999;font-size:11px;word-break:break-all;text-decoration:underline;text-decoration-style:dotted;font-family:${FONT};">${link}</a>
          </td>
        </tr>
      </table>

      <!-- SEPARATOR -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
        <tr><td class="sep" style="height:1px;background-color:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>

      <p class="text-note" style="font-size:12px;color:#CCCCCC;line-height:1.9;margin:0 0 32px;font-family:${FONT};">
        Link-ul expiră în <span class="text-note-em" style="color:#888888;font-style:italic;">24 de ore</span>. Dacă nu ați solicitat această acțiune, ignorați acest email — niciun cont nu va fi activat.
      </p>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td class="footer-td border-sec" style="padding:22px 44px;border-top:1px solid #F0EDE8;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align:middle;">
            <div class="text-foot-n" style="font-size:11px;color:#BBBBBB;font-family:${FONT};letter-spacing:0.5px;">SILLEAU</div>
            <div class="text-foot-s" style="font-size:10.5px;color:#CCCCCC;font-family:${FONT};">
              <a href="mailto:contact@silleau.com" class="link-soft" style="color:#CCCCCC;text-decoration:underline;text-decoration-style:dotted;font-family:${FONT};">contact@silleau.com</a>
            </div>
          </td>
          <td style="text-align:right;vertical-align:middle;">
            <div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:2.4px;text-transform:uppercase;font-family:${FONT};">Revenue Optimization</div>
            <div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:2.4px;text-transform:uppercase;font-family:${FONT};margin-top:2px;">Systems</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>

</td></tr>
</table>
</body>
</html>`;
}

async function handleSignup(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { message: 'JSON invalid' } }, 400);
  }

  const { email, password, cui, nume_firma, domeniu, nr_angajati } = body;

  if (!email || !password || !cui || !nume_firma) {
    return jsonResponse({ error: { message: 'Câmpuri obligatorii lipsă' } }, 400);
  }
  if (typeof password !== 'string' || password.length < 8) {
    return jsonResponse({ error: { message: 'Parola trebuie să aibă minim 8 caractere' } }, 400);
  }

  // 1) Creează userul în Supabase (neconfirmat) via Admin API
  const adminResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: false,
      user_metadata: { cui, nume_firma, domeniu: domeniu || null, nr_angajati: nr_angajati || null },
    }),
  });

  if (!adminResp.ok) {
    const errText = await adminResp.text();
    let msg = 'Cont neacceptat';
    try {
      const errJson = JSON.parse(errText);
      msg = errJson.msg || errJson.message || errJson.error_description || msg;
    } catch {}
    return jsonResponse({ error: { message: msg } }, adminResp.status);
  }

  const user = await adminResp.json();

  // 2) Generează token de confirmare (HMAC, 24h)
  const token = await makeConfirmToken(user.id, env.CONFIRM_TOKEN_SECRET);
  const origin = new URL(request.url).origin;
  const confirmUrl = `${origin}/api/confirm?token=${encodeURIComponent(token)}`;

  // 3) Trimite email prin Resend
  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject: 'Confirmă crearea contului SILLEAU',
      html: buildConfirmEmailHtml(confirmUrl),
    }),
  });

  if (!resendResp.ok) {
    const errText = await resendResp.text();
    return jsonResponse({ error: { message: `Trimiterea emailului a eșuat: ${errText.slice(0, 200)}` } }, 500);
  }

  return jsonResponse({ ok: true });
}

async function handleConfirm(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response('Token lipsă', { status: 400 });
  }

  const userId = await verifyConfirmToken(token, env.CONFIRM_TOKEN_SECRET);
  if (!userId) {
    return new Response('Token invalid sau expirat', { status: 401 });
  }

  // Marchează userul ca având email confirmat
  const updateResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email_confirm: true }),
  });

  if (!updateResp.ok) {
    const errText = await updateResp.text();
    return new Response(`Confirmare eșuată: ${errText.slice(0, 200)}`, { status: 500 });
  }

  // Redirect la pagina statică de confirmare
  return Response.redirect(`${url.origin}/confirmat`, 302);
}

// ---------- ROUTER ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/chat') {
      return handleChat(request, env);
    }

    if (url.pathname === '/api/signup') {
      return handleSignup(request, env);
    }

    if (url.pathname === '/api/confirm') {
      return handleConfirm(request, env);
    }

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
