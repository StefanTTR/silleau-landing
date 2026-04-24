-- ─────────────────────────────────────────────────────────────────────────
-- Dashboard de recepție SILLEAU — infrastructura de autentificare.
--
-- 1. Tabela `utilizatori_clinici` leagă un user Supabase Auth de o clinică.
--    Conturile sunt create manual de admin (via `supabase auth admin create-user`
--    sau din Dashboard → Authentication → Users). După creare, se inserează
--    un rând aici cu (user_id, clinic_id).
--
-- 2. Custom Access Token Hook — injectează `clinic_id` ca top-level claim în JWT
--    la fiecare autentificare / refresh, pentru ca RLS-urile existente
--    (`(clinic_id)::text = (auth.jwt() ->> 'clinic_id'::text)`) să funcționeze
--    cu userii normali (nu doar cu service_role). Necesar și pentru Supabase
--    Realtime, care respectă RLS la canalele `postgres_changes`.
--
-- După aplicarea migrației, activează hook-ul în Supabase Dashboard:
--   Authentication → Hooks → Custom Access Token → selectează
--   `public.dashboard_inject_clinic_id_claim`.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.utilizatori_clinici (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  clinic_id   uuid        not null references public.clinici (id) on delete cascade,
  rol         text        not null default 'receptie',
  activ       boolean     not null default true,
  creat_la    timestamptz not null default now(),
  unique (user_id, clinic_id)
);

create index if not exists idx_utilizatori_clinici_user on public.utilizatori_clinici (user_id);
create index if not exists idx_utilizatori_clinici_clinic on public.utilizatori_clinici (clinic_id);

alter table public.utilizatori_clinici enable row level security;

-- RLS: un user poate citi DOAR propriile rânduri (și doar service_role scrie).
drop policy if exists "uc_self_read" on public.utilizatori_clinici;
create policy "uc_self_read"
  on public.utilizatori_clinici
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "uc_service_all" on public.utilizatori_clinici;
create policy "uc_service_all"
  on public.utilizatori_clinici
  for all
  to service_role
  using (true)
  with check (true);

-- ─────────────────────────────────────────────────────────────────────────
-- Custom Access Token Hook — adaugă clinic_id în JWT.
-- Supabase apelează această funcție la fiecare signIn / refresh și merge
-- rezultatul în claims-urile tokenului.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.dashboard_inject_clinic_id_claim(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  claims   jsonb;
  v_user   uuid;
  v_clinic uuid;
begin
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_user := (event ->> 'user_id')::uuid;

  -- 1) preferă app_metadata.clinic_id (poate fi setat de admin cu service_role).
  v_clinic := nullif(claims #>> '{app_metadata,clinic_id}', '')::uuid;

  -- 2) fallback: utilizatori_clinici.
  if v_clinic is null then
    select uc.clinic_id
      into v_clinic
      from public.utilizatori_clinici uc
     where uc.user_id = v_user and uc.activ = true
     limit 1;
  end if;

  if v_clinic is not null then
    claims := claims || jsonb_build_object('clinic_id', v_clinic::text);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Permite hook-ului Supabase Auth să apeleze funcția.
grant execute on function public.dashboard_inject_clinic_id_claim(jsonb) to supabase_auth_admin;
revoke execute on function public.dashboard_inject_clinic_id_claim(jsonb) from authenticated, anon, public;
