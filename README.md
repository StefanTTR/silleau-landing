# SILLEAU Framework

Sistem de programări medicale cu Supabase (DB + Edge Functions + Auth), Deno/TypeScript,
Resend, Meta WhatsApp API. Landing page static în `SILLEAU_Landing/` (Cloudflare Pages).

## Structură

- `SILLEAU_Landing/` — site public (HTML/CSS/JS vanilla, hostat pe Cloudflare Pages)
- `supabase/functions/` — Edge Functions Deno
- `supabase/migrations/` — schema DB

## Edge Functions cheie

| Funcție | Rol | Auth |
|---|---|---|
| `save-booking` | Creare + reprogramare programari (7 fix-uri securitate) | public |
| `send-reminders` | Cron 24h înainte de consultație — generează tokens, trimite email | cron/JWT |
| `resolve-action` | Procesează link-urile din email (confirm / reschedule / cancel / feedback) | public |
| `anuleaza-slot` | PATCH `status='anulat'` + triggere slot-eliberat | public |
| `confirmare-booking` | Email confirmare imediat după save-booking | public |
| `public-data` | Endpoint public read-only pentru theme clinic, programare_info etc. | public |

## Infrastructure — Reverse Proxy

URL-urile din email-urile SILLEAU folosesc `SITE_URL` (ex: `https://www.silleau.com`)
pentru a nu expune `SUPABASE_URL` clienților și pentru a elimina `clinic_id` din URL-uri.
Reverse proxy-ul traduce cererile către endpoint-urile Supabase corespunzătoare.

### Cloudflare Pages — Pages Functions (deja incluse în `SILLEAU_Landing/functions/`)

`_redirects` cu status 200 **nu** suportă rewrite cross-origin la URL extern.
Pentru proxy silent (URL-ul din browser rămâne `www.silleau.com`) folosim
Pages Functions — file-based Workers care rulează server-side pe CF edge:

```
SILLEAU_Landing/functions/r/[action]/[token].js   → /r/c/*, /r/r/*, /r/x/*
SILLEAU_Landing/functions/f/[token].js            → /f/*
```

Fiecare fișier exportează `onRequestGet(context)` care fetch-uiește Supabase,
curăță `content-security-policy` + `x-content-type-options` din răspuns și
returnează body-ul către browser. 302 redirects de la `resolve-action` sunt
propagate transparent.

**Nu e nevoie de configurare suplimentară în dashboard** — CF Pages detectează
automat folderul `functions/` la deploy.

### Vercel — `vercel.json`

```json
{
  "rewrites": [
    { "source": "/r/c/:token", "destination": "https://YOUR_PROJECT.supabase.co/functions/v1/resolve-action?t=:token" },
    { "source": "/r/r/:token", "destination": "https://YOUR_PROJECT.supabase.co/functions/v1/resolve-action?t=:token" },
    { "source": "/r/x/:token", "destination": "https://YOUR_PROJECT.supabase.co/functions/v1/resolve-action?t=:token" },
    { "source": "/f/:token",   "destination": "https://YOUR_PROJECT.supabase.co/functions/v1/save-feedback?t=:token" }
  ]
}
```

## Flow link-uri email (reminder)

Email-ul generat de `send-reminders` conține 4 URL-uri scurte:

| Acțiune | URL public | Proxy → Edge Function |
|---|---|---|
| Confirmă | `https://www.silleau.com/r/c/TOKEN` | `resolve-action?t=TOKEN` |
| Reprogramează | `https://www.silleau.com/r/r/TOKEN` | `resolve-action?t=TOKEN` |
| Anulează | `https://www.silleau.com/r/x/TOKEN` | `resolve-action?t=TOKEN` |
| Rating feedback | `https://www.silleau.com/f/TOKEN.SIG?rating=N` | `save-feedback?t=TOKEN.SIG&rating=N` |

Token-ul pe path este SHA-256 hash-uit server-side la match; acțiunea se derivă
automat din coloana în care match-uiește hash-ul (confirm/reschedule/cancel).

**Diferența c/r/x**: path-urile scurte evită leak-ul acțiunii în screenshot-uri,
analytics sau forward-uri de email. Backend-ul nu depinde de litera din path —
e doar convenție de routing.

## Backward compatibility

Email-urile trimise înainte de deploy-ul URL-redesign (format legacy
`?action=confirm&token=X&clinic_id=Y`) continuă să funcționeze. Ramura veche
e încă activă în `resolve-action`. Se va elimina după cel mai lung `tokens_expire_at`
valid (≥ 14 zile de la ultimul reminder vechi).

## TODO-uri (follow-up după acest refactor)

1. **`save-feedback` Edge Function** — verifică HMAC pe token-ul `/f/TOKEN.SIG`
   primit (format: `base64url(programareId:clinicId:tsMs).sigHex24`). Verifică
   semnătura cu `FEEDBACK_TOKEN_SECRET`, extrage `programare_id` + `clinic_id`.
2. **`/confirmare.html` frontend refactor** — citește `clinic_id` pentru branding
   din răspunsul unui viitor endpoint `confirm-context` (astăzi nu mai primește
   `clinic_id` în URL).
3. **Tabel audit `action_audit_log`** — tracking confirm / cancel / reschedule
   cu timestamp + IP hash.
4. **Fallback pagini pentru link-uri vechi** — gestionare explicită în
   `/anulare-reminder.html` și `/confirmare.html` a URL-urilor în format legacy.
5. **Faza F** — drop `clinic_id` din body-ul `save-booking` după ce toate clinic
   URL-urile externe folosesc `?slug=`.

## Secrets de setat (Supabase → Edge Functions → Secrets)

```bash
openssl rand -base64 48   # → TOKEN_HASH_SALT
openssl rand -base64 48   # → IP_HASH_SALT
openssl rand -hex 32      # → FEEDBACK_TOKEN_SECRET

supabase secrets set \
  TOKEN_HASH_SALT='...' \
  IP_HASH_SALT='...' \
  FEEDBACK_TOKEN_SECRET='...' \
  SITE_URL='https://www.silleau.com'
```

## Deploy

```bash
supabase db push                                   # migrații
supabase functions deploy resolve-action
supabase functions deploy send-reminders
supabase functions deploy save-booking
git push                                           # auto-deploy frontend via Cloudflare Pages
```
