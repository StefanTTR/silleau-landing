# SILLEAU · Dashboard de recepție (PWA)

App web instalabilă pentru recepția clinicii. **Strict MVP**: login + calendar medici
în timp real + listă pacienți. Fără editare programări, fără rapoarte, fără register.

- Rută publică: `https://silleau.app/dashboard/`
- Mobile-first, dark theme, consistent cu identitatea SILLEAU (Playfair + Inter).
- Multi-tenant strict: datele sunt filtrate pe `clinic_id` la server (edge function
  `dashboard-data`), niciodată la client.

## Arhitectură

```
SILLEAU_Landing/dashboard/
  index.html            SPA shell (login + calendar + pacienti)
  styles.css            design system
  app.js                auth, calendar, realtime, pacienti
  config.js             anon key Supabase (înlocuit la deploy)
  manifest.webmanifest  PWA manifest
  sw.js                 service worker (offline shell, online data)
  icon.svg / icon-*.png assets PWA

supabase/functions/dashboard-data/index.ts
  Tenant-scoped API: `?resource=me|personal|programari|pacienti|pacient_detalii`
  Validează JWT-ul userului, derivă clinic_id, forțează filtru clinic_id=eq.X.

supabase/migrations/20260424_dashboard_auth.sql
  - Tabela `utilizatori_clinici` (user_id ↔ clinic_id)
  - Funcție hook `dashboard_inject_clinic_id_claim` (injectează clinic_id în JWT)
```

## Deploy

### 1. Pune anon key-ul Supabase

Anon key-ul este public by design (protejat de RLS). Se găsește în Supabase Dashboard
→ Project Settings → API → **anon public key**.

Editează `SILLEAU_Landing/dashboard/config.js` și înlocuiește `__SUPABASE_ANON_KEY__`
cu valoarea reală, SAU injectează valoarea în CI (de exemplu cu `sed` înainte de
`wrangler deploy`):

```bash
sed -i '' "s|__SUPABASE_ANON_KEY__|$SUPABASE_ANON_KEY|" \
  SILLEAU_Landing/dashboard/config.js
```

### 2. Aplică migrația DB

```bash
supabase db push   # va include 20260424_dashboard_auth.sql
```

### 3. Activează Custom Access Token Hook

Supabase Dashboard → **Authentication → Hooks → Custom Access Token**:
selectează `public.dashboard_inject_clinic_id_claim`.

Acest hook adaugă `clinic_id` ca top-level claim în JWT la fiecare login. Este
**obligatoriu** pentru Supabase Realtime — canalele `postgres_changes` respectă
RLS-ul, iar RLS-urile existente (`(clinic_id)::text = (auth.jwt() ->> 'clinic_id'::text)`)
depind de prezența claim-ului în JWT.

### 4. Deploy edge function

```bash
supabase functions deploy dashboard-data
```

### 5. Deploy frontend (Cloudflare Workers + Assets)

```bash
git push   # Cloudflare Pages/Workers auto-deploy
```

## Crearea unui cont de recepție

**1. Creează userul în Supabase Auth.**
Supabase Dashboard → Authentication → Users → *Add user* → *Create new user*
(auto-confirm email). Reține user_id-ul.

Sau din CLI:
```bash
supabase auth admin create-user \
  --email receptie@clinica-x.ro \
  --password 'ParolaGenerata123!' \
  --email-confirm
```

**2. Asociază userul cu clinica.**

```sql
insert into public.utilizatori_clinici (user_id, clinic_id, rol)
values (
  '<uuid-user-creat>',
  '<uuid-clinic-destinatie>',
  'receptie'
);
```

Alternativ, setează direct `app_metadata.clinic_id` (funcționează fără să mai fie
nevoie de utilizatori_clinici — hook-ul preferă app_metadata):

```sql
update auth.users
   set raw_app_meta_data = raw_app_meta_data
                         || jsonb_build_object('clinic_id', '<uuid-clinic>')
 where id = '<uuid-user>';
```

**3. Trimite clinicii link-ul + credențialele.**

```
URL:     https://silleau.app/dashboard/
Email:   receptie@clinica-x.ro
Parola:  ParolaGenerata123!
```

Pe telefon, după login, browser-ul propune "Adaugă pe ecranul principal" →
devine aplicație standalone fără bară de adresă.

## Comportament real-time

1. **Realtime Supabase** (preferat): abonează pe `postgres_changes` pentru tabela
   `programari` cu filtru `clinic_id=eq.X`. Necesită JWT cu `clinic_id` claim
   (via hook-ul din pasul 3). Latency: <1s.

2. **Polling fallback**: dacă Realtime nu ajunge, app-ul interoghează
   `dashboard-data?resource=programari` la 20s. Dezactivat când tab-ul e ascuns
   pentru a economisi resurse / baterie.

## Status-uri programări (culori)

| Status              | Culoare CSS      | Label UI         |
|---------------------|------------------|------------------|
| `confirmat`         | verde            | Confirmată       |
| `neconfirmat`       | galben/portocaliu| În așteptare     |
| `anulat`            | roșu             | Anulată          |
| `no-show`           | gri              | No-show          |
| `reprogramat`       | albastru         | Reprogramată     |

Statusul `doreste_loc_mai_devreme = true` apare ca stea ★ în colțul blocului.

## Dezvoltare locală

Cloudflare Workers + Assets:
```bash
npx wrangler dev
# Deschide http://127.0.0.1:8787/dashboard/
```

Supabase edge functions (rulează separat pentru ca fetch-urile din dashboard să
lovească funcția locală — schimbă temporar `FN_DASHBOARD_DATA` în `app.js`):
```bash
supabase functions serve dashboard-data --env-file .env.local
```

## Ce NU face (scope MVP)

- Nu creează / editează / șterge programări (vin doar din formularul pacient).
- Nu are register, forgot-password, invitări de useri.
- Nu are setări, rapoarte, statistici, notificări, chat.
- Nu propune slot-uri, nu trimite mesaje — doar read-only.
