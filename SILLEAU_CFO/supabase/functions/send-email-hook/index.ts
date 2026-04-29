// Supabase Auth — Send Email Hook
// Trimite emailurile de auth (signup, recovery, magic link, etc.) prin Resend.
//
// Configurare în Supabase Dashboard:
//   Authentication → Hooks → Send Email Hook → Enable
//   Hook URL: HTTPS URL al acestei funcții
//
// Secret-uri necesare (supabase secrets set ...):
//   RESEND_API_KEY            — cheie API de la resend.com
//   SEND_EMAIL_HOOK_SECRET    — auto-generat de Supabase la activarea hook-ului
//
// Sender: contact@silleau.com (trebuie să fie pe un domeniu verificat în Resend)

import { Webhook } from 'npm:standardwebhooks@1.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SEND_EMAIL_HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET')!;
const FROM = 'SILLEAU <contact@silleau.com>';

interface SendEmailPayload {
  user: { email: string; user_metadata?: Record<string, unknown> };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  let data: SendEmailPayload;
  try {
    const wh = new Webhook(SEND_EMAIL_HOOK_SECRET);
    data = wh.verify(payload, headers) as SendEmailPayload;
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return jsonError(401, 'Invalid webhook signature');
  }

  const { user, email_data } = data;
  const link = buildActionLink(email_data);
  const { subject, html } = buildEmail(email_data.email_action_type, link);

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [user.email],
        subject,
        html,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Resend error:', resp.status, errText);
      return jsonError(500, `Resend send failed: ${resp.status}`);
    }

    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Send error:', err);
    return jsonError(500, String(err));
  }
});

function jsonError(http_code: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code, message } }), {
    status: http_code,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildActionLink(d: SendEmailPayload['email_data']): string {
  const params = new URLSearchParams({
    token: d.token_hash,
    type: d.email_action_type,
    redirect_to: d.redirect_to,
  });
  return `${d.site_url}/auth/v1/verify?${params.toString()}`;
}

interface EmailParts {
  kicker: string;
  title: string;
  body: string;
  cta: string;
  link: string;
}

function buildEmail(action: string, link: string): { subject: string; html: string } {
  const variants: Record<string, Omit<EmailParts, 'link'> & { subject: string }> = {
    signup: {
      subject: 'Confirmă crearea contului SILLEAU',
      kicker: 'CONFIRMARE CONT',
      title: 'Bun venit în <em>SILLEAU</em>.',
      body: 'Apăsați butonul de mai jos pentru a confirma crearea contului. După confirmare, vă conectăm automat în aplicația deschisă pe celălalt dispozitiv.',
      cta: 'Confirmă contul',
    },
    recovery: {
      subject: 'Resetare parolă SILLEAU',
      kicker: 'RESETARE PAROLĂ',
      title: 'Ați solicitat o <em>parolă nouă</em>.',
      body: 'Apăsați butonul de mai jos pentru a defini o parolă nouă. Dacă nu ați solicitat această acțiune, ignorați acest email.',
      cta: 'Resetează parola',
    },
    magiclink: {
      subject: 'Conectare în SILLEAU',
      kicker: 'AUTENTIFICARE',
      title: 'Link de <em>conectare</em>.',
      body: 'Apăsați butonul de mai jos pentru a vă autentifica direct, fără parolă.',
      cta: 'Conectează-te',
    },
    invite: {
      subject: 'Invitație în SILLEAU',
      kicker: 'INVITAȚIE',
      title: 'Ați fost <em>invitat</em> în SILLEAU.',
      body: 'Apăsați butonul de mai jos pentru a accepta invitația și a vă crea contul.',
      cta: 'Acceptă invitația',
    },
    email_change_current: {
      subject: 'Confirmă schimbarea adresei de email',
      kicker: 'SCHIMBARE EMAIL',
      title: 'Confirmare <em>email actual</em>.',
      body: 'Apăsați butonul de mai jos pentru a confirma că aveți acces la această adresă.',
      cta: 'Confirmă',
    },
    email_change_new: {
      subject: 'Confirmă noua adresă de email',
      kicker: 'SCHIMBARE EMAIL',
      title: 'Confirmare <em>email nou</em>.',
      body: 'Apăsați butonul de mai jos pentru a confirma noua adresă de email.',
      cta: 'Confirmă',
    },
    reauthentication: {
      subject: 'Cod de reautentificare SILLEAU',
      kicker: 'REAUTENTIFICARE',
      title: 'Reconfirmare <em>identitate</em>.',
      body: 'Apăsați butonul de mai jos pentru a vă reconfirma identitatea.',
      cta: 'Continuă',
    },
  };

  const v = variants[action] || {
    subject: 'Notificare SILLEAU',
    kicker: 'NOTIFICARE',
    title: 'Acțiune <em>SILLEAU</em>.',
    body: 'Apăsați butonul de mai jos pentru a continua.',
    cta: 'Continuă',
  };

  return {
    subject: v.subject,
    html: emailTemplate({ kicker: v.kicker, title: v.title, body: v.body, cta: v.cta, link }),
  };
}

function emailTemplate(p: EmailParts): string {
  return `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>SILLEAU</title>
</head>
<body style="margin:0;padding:0;background:#0c1118;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8e6e3">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c1118;width:100%">
    <tr>
      <td align="center" style="padding:48px 24px">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;border:1px solid rgba(232,230,227,.18);background:#0c1118">
          <tr>
            <td style="padding:48px 40px 36px">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;letter-spacing:4px;font-weight:500;color:#e8e6e3;text-align:center;margin-bottom:36px;opacity:0.92">SILLEAU</div>
              <div style="font-size:11px;color:#7f8a96;text-align:center;letter-spacing:3.2px;text-transform:uppercase;margin-bottom:16px">${p.kicker}</div>
              <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:500;color:#e8e6e3;line-height:1.2;text-align:center;margin:0 0 24px">${p.title}</h1>
              <div style="width:60px;height:1px;background:rgba(232,230,227,.2);margin:0 auto 24px;line-height:1">&nbsp;</div>
              <p style="font-size:15px;color:#9aa4af;line-height:1.7;margin:0 0 36px;text-align:center;font-weight:400">${p.body}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto">
                <tr>
                  <td style="background:#e8e6e3">
                    <a href="${p.link}" style="display:inline-block;padding:16px 36px;color:#0c1118;text-decoration:none;font-size:11.5px;letter-spacing:2.6px;text-transform:uppercase;font-weight:600;font-family:'Helvetica Neue',Arial,sans-serif">${p.cta}</a>
                  </td>
                </tr>
              </table>
              <p style="font-size:12px;color:#5b6470;line-height:1.6;margin:36px 0 0;text-align:center">Sau copiați link-ul:<br><a href="${p.link}" style="color:#9aa4af;word-break:break-all;text-decoration:underline">${p.link}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 40px;border-top:1px solid #1a1f27;text-align:center;font-size:10px;color:#5b6470;letter-spacing:2.6px;text-transform:uppercase">Revenue Optimization Systems</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
