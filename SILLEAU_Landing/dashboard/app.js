/**
 * SILLEAU · Dashboard de recepție — Logica aplicației PWA.
 *
 * Auth: Supabase Auth (email + parolă, doar login — conturile sunt create manual).
 * Date: edge function `dashboard-data` (tenant-scoped via clinic_id derivat din user).
 * Realtime: Supabase Realtime pe tabela `programari` cu filtru clinic_id, plus polling
 *           la 20s ca fallback pentru medii unde RLS-ul blochează canalele Realtime.
 */

(() => {
  'use strict';

  // ─── Config: populate la deploy ─────────────────────────────────────────
  const SUPABASE_URL      = 'https://wpxflbwohowigaulhxhk.supabase.co';
  const SUPABASE_ANON_KEY = window.SILLEAU_ANON_KEY || '__SUPABASE_ANON_KEY__';
  const FN_DASHBOARD_DATA = SUPABASE_URL + '/functions/v1/dashboard-data';

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  // ─── State ───────────────────────────────────────────────────────────────
  const state = {
    session:       null,
    clinic_id:     null,
    clinic_nume:   null,
    email:         null,
    medici:        [],         // [{ id, prenume, nume, specialitate, titlu }]
    medic_sel_id:  null,
    data_sel:      null,       // 'YYYY-MM-DD'
    programari:    [],         // programări pentru ziua selectată + medic selectat
    tab:           'calendar',
    pacienti:      [],
    pacienti_sort: 'alfabetic',
    pacienti_q:    '',
    realtime_ch:   null,
    poll_timer:    null,
  };

  // ─── Utilitare ───────────────────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function addDays(iso, delta) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  }
  function formatDateRo(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function timeToMinutes(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  function trimSec(t) { return t ? t.slice(0, 5) : ''; }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }
  function statusClass(status) {
    const map = {
      confirmat:   'st-confirmat',
      neconfirmat: 'st-neconfirmat',
      anulat:      'st-anulat',
      'no-show':   'st-noshow',
      noshow:      'st-noshow',
      reprogramat: 'st-reprogramat',
    };
    return map[status] || 'st-neconfirmat';
  }
  function statusLabel(status) {
    const map = {
      confirmat:   'Confirmată',
      neconfirmat: 'În așteptare',
      anulat:      'Anulată',
      'no-show':   'No-show',
      noshow:      'No-show',
      reprogramat: 'Reprogramată',
    };
    return map[status] || status || '—';
  }

  function toast(msg, ms = 2200) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ─── API layer ───────────────────────────────────────────────────────────
  async function api(resource, params = {}) {
    if (!state.session) throw new Error('Neautentificat');
    const qs = new URLSearchParams({ resource, ...params });
    const res = await fetch(`${FN_DASHBOARD_DATA}?${qs}`, {
      headers: {
        'Authorization': 'Bearer ' + state.session.access_token,
        'apikey':        SUPABASE_ANON_KEY,
      },
    });
    if (res.status === 401) {
      await logout();
      throw new Error('Sesiune expirată');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('API eroare: ' + res.status + ' ' + body.slice(0, 200));
    }
    return res.json();
  }

  // ─── Auth ────────────────────────────────────────────────────────────────
  async function login(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    state.session = data.session;
    await bootstrap();
  }

  async function logout() {
    stopRealtime();
    stopPolling();
    await sb.auth.signOut().catch(() => {});
    state.session     = null;
    state.clinic_id   = null;
    state.clinic_nume = null;
    state.medici      = [];
    state.programari  = [];
    state.pacienti    = [];
    showLogin();
  }

  async function restoreSession() {
    const { data } = await sb.auth.getSession();
    if (data?.session) {
      state.session = data.session;
      try {
        await bootstrap();
        return true;
      } catch (e) {
        console.warn('[silleau] restore fail', e);
      }
    }
    return false;
  }

  // ─── Bootstrap după login ────────────────────────────────────────────────
  async function bootstrap() {
    const me = await api('me');
    state.clinic_id   = me.clinic_id;
    state.clinic_nume = me.clinic_nume;
    state.email       = me.email;
    $('#clinic-nume').textContent = me.clinic_nume || 'Clinică';

    state.medici = await api('personal');
    if (state.medici.length && !state.medici.some(m => m.id === state.medic_sel_id)) {
      state.medic_sel_id = state.medici[0].id;
    }
    state.data_sel = state.data_sel || todayISO();

    showApp();
    renderMediciChips();
    await loadProgramari();
    startRealtime();
    startPolling();
  }

  // ─── Realtime ────────────────────────────────────────────────────────────
  function startRealtime() {
    stopRealtime();
    try {
      const ch = sb
        .channel('programari-' + state.clinic_id)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'programari', filter: 'clinic_id=eq.' + state.clinic_id },
          () => { loadProgramari({ silent: true }); },
        )
        .subscribe();
      state.realtime_ch = ch;
    } catch (e) {
      console.warn('[silleau] realtime unavailable', e);
    }
  }
  function stopRealtime() {
    if (state.realtime_ch) {
      try { sb.removeChannel(state.realtime_ch); } catch {}
      state.realtime_ch = null;
    }
  }
  function startPolling() {
    stopPolling();
    state.poll_timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadProgramari({ silent: true });
    }, 20000);
  }
  function stopPolling() {
    if (state.poll_timer) { clearInterval(state.poll_timer); state.poll_timer = null; }
  }

  // ─── View switching ──────────────────────────────────────────────────────
  function showLogin() {
    $('#view-login').hidden = false;
    $('#view-app').hidden   = true;
  }
  function showApp() {
    $('#view-login').hidden = true;
    $('#view-app').hidden   = false;
    activateTab(state.tab);
  }
  function activateTab(tab) {
    state.tab = tab;
    $$('.tab-pane').forEach(p => { p.hidden = true; });
    $('#tab-' + tab).hidden = false;
    $$('.nav-tab').forEach(b => {
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });
    if (tab === 'pacienti' && state.pacienti.length === 0) {
      loadPacienti();
    }
  }

  // ─── CALENDAR: medici + programări + grid ────────────────────────────────
  function renderMediciChips() {
    const host = $('#medic-selector');
    if (!state.medici.length) {
      host.innerHTML = '<div class="medic-chip" style="cursor:default">Niciun medic activ</div>';
      return;
    }
    host.innerHTML = state.medici.map(m => {
      const name = [m.titlu, m.prenume, m.nume].filter(Boolean).join(' ');
      const sp   = m.specialitate ? `<span class="sp">${escapeHtml(m.specialitate)}</span>` : '';
      const act  = m.id === state.medic_sel_id ? ' active' : '';
      return `<button type="button" class="medic-chip${act}" data-medic="${escapeHtml(m.id)}">${escapeHtml(name)}${sp}</button>`;
    }).join('');
    $$('.medic-chip[data-medic]', host).forEach(btn => {
      btn.addEventListener('click', () => {
        state.medic_sel_id = btn.dataset.medic;
        renderMediciChips();
        renderCalendar();
      });
    });
  }

  async function loadProgramari(opts = {}) {
    if (!state.clinic_id) return;
    const from = state.data_sel;
    const to   = state.data_sel;
    try {
      state.programari = await api('programari', { from, to });
      renderCalendar();
    } catch (e) {
      if (!opts.silent) toast('Nu am putut încărca programările');
      console.warn('[silleau] loadProgramari', e);
    }
  }

  function renderCalendar() {
    $('#cal-date-label').textContent = formatDateRo(state.data_sel);

    const grid  = $('#cal-grid');
    const empty = $('#cal-empty');

    if (!state.medici.length) {
      grid.innerHTML = '<div class="cal-empty">Nu există medici activi pentru această clinică.</div>';
      return;
    }
    if (!state.medic_sel_id) {
      grid.innerHTML = '<div class="cal-empty">Selectează un medic.</div>';
      return;
    }

    const progs = state.programari.filter(p => p.personal_id === state.medic_sel_id);

    // Ore afișate: 8 → 21 (13 sloturi de 60 min). Ajustăm automat dacă programări ies în afară.
    let hStart = 8, hEnd = 21;
    for (const p of progs) {
      const h0 = Math.floor(timeToMinutes(p.ora_start) / 60);
      const h1 = Math.ceil(timeToMinutes(p.ora_sfarsit) / 60);
      if (h0 < hStart) hStart = Math.max(0, h0);
      if (h1 > hEnd)   hEnd   = Math.min(24, h1);
    }
    const hours = [];
    for (let h = hStart; h <= hEnd; h++) hours.push(h);

    const hoursHtml = hours.map(h => `<div class="cal-hour">${String(h).padStart(2, '0')}:00</div>`).join('');
    const slotsHtml = hours.map(() => `<div class="cal-slot"></div>`).join('');

    const pxPerMin = 60 / 60; // 60px per oră = 1px / min
    const baseMin  = hStart * 60;

    const eventsHtml = progs.map(p => {
      const top    = (timeToMinutes(p.ora_start) - baseMin) * pxPerMin;
      const height = Math.max(24, (timeToMinutes(p.ora_sfarsit) - timeToMinutes(p.ora_start)) * pxPerMin);
      const name   = p.pacient ? [p.pacient.prenume, p.pacient.nume].filter(Boolean).join(' ') : 'Pacient necunoscut';
      const serv   = p.serviciu?.nume || '';
      const flag   = p.doreste_loc_mai_devreme ? '<span class="ev-flag" title="Dorește loc mai devreme">★</span>' : '';
      return `
        <div class="cal-event ${statusClass(p.status)}" style="top:${top}px;height:${height - 2}px" data-progr="${escapeHtml(p.programare_id)}">
          ${flag}
          <div class="ev-name">${escapeHtml(name)}</div>
          <div class="ev-sub">${escapeHtml(trimSec(p.ora_start))}–${escapeHtml(trimSec(p.ora_sfarsit))}${serv ? ' · ' + escapeHtml(serv) : ''}</div>
        </div>`;
    }).join('');

    grid.innerHTML = `
      <div class="cal-hours">${hoursHtml}</div>
      <div class="cal-day" style="min-height:${hours.length * 60}px">
        ${slotsHtml}
        ${eventsHtml || ''}
      </div>
    `;

    $$('.cal-event[data-progr]', grid).forEach(el => {
      el.addEventListener('click', () => openProgrammareDrawer(el.dataset.progr));
    });
  }

  function openProgrammareDrawer(progId) {
    const p = state.programari.find(x => x.programare_id === progId);
    if (!p) return;

    const pacient = p.pacient || {};
    const medic   = p.medic   || {};
    const serv    = p.serviciu || {};
    const numePac = [pacient.prenume, pacient.nume].filter(Boolean).join(' ') || '—';
    const numeMed = [medic.titlu, medic.prenume, medic.nume].filter(Boolean).join(' ') || '—';

    const telHtml = pacient.telefon
      ? `<a href="tel:${escapeHtml(pacient.telefon)}">${escapeHtml(pacient.telefon)}</a>`
      : '—';
    const emHtml  = pacient.email
      ? `<a href="mailto:${escapeHtml(pacient.email)}">${escapeHtml(pacient.email)}</a>`
      : '—';

    const flagHtml = p.doreste_loc_mai_devreme ? `
      <div class="dr-flag">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 8.5 22 9.3 17 14 18.2 21 12 17.8 5.8 21 7 14 2 9.3 9 8.5 12 2"/></svg>
        Pacientul dorește loc mai devreme, dacă se eliberează.
      </div>` : '';

    const html = `
      <div class="dr-kicker">Programare</div>
      <h2>${escapeHtml(numePac)}<span class="dr-status ${statusClass(p.status)}">${escapeHtml(statusLabel(p.status))}</span></h2>
      <div class="dr-row"><span class="dr-label">Data</span><span class="dr-value">${escapeHtml(formatDateRo(p.data_programare))}</span></div>
      <div class="dr-row"><span class="dr-label">Ora</span><span class="dr-value">${escapeHtml(trimSec(p.ora_start))} – ${escapeHtml(trimSec(p.ora_sfarsit))}</span></div>
      <div class="dr-row"><span class="dr-label">Medic</span><span class="dr-value">${escapeHtml(numeMed)}</span></div>
      <div class="dr-row"><span class="dr-label">Serviciu</span><span class="dr-value">${escapeHtml(serv.nume || '—')}${serv.durata_min ? ` · ${serv.durata_min} min` : ''}</span></div>
      <div class="dr-row"><span class="dr-label">Telefon</span><span class="dr-value">${telHtml}</span></div>
      <div class="dr-row"><span class="dr-label">Email</span><span class="dr-value">${emHtml}</span></div>
      ${p.motiv_anulare ? `<div class="dr-row"><span class="dr-label">Motiv anulare</span><span class="dr-value">${escapeHtml(p.motiv_anulare)}</span></div>` : ''}
      ${p.numar_reprogramari ? `<div class="dr-row"><span class="dr-label">Reprogramări</span><span class="dr-value">${p.numar_reprogramari}</span></div>` : ''}
      ${flagHtml}
    `;
    openDrawer(html);
  }

  // ─── PACIENTI ────────────────────────────────────────────────────────────
  async function loadPacienti() {
    const host = $('#pac-list');
    host.innerHTML = '<div class="pac-empty">Se încarcă pacienții…</div>';
    try {
      state.pacienti = await api('pacienti');
      renderPacienti();
    } catch (e) {
      host.innerHTML = '<div class="pac-empty">Eroare la încărcare.</div>';
      console.warn('[silleau] loadPacienti', e);
    }
  }

  function renderPacienti() {
    const host = $('#pac-list');
    const q = state.pacienti_q.trim().toLowerCase();

    let rows = state.pacienti.slice();
    if (q) {
      rows = rows.filter(p => {
        const name = `${p.prenume || ''} ${p.nume || ''}`.toLowerCase();
        const tel  = (p.telefon || '').toLowerCase();
        return name.includes(q) || tel.includes(q);
      });
    }
    if (state.pacienti_sort === 'recent') {
      rows.sort((a, b) => {
        const da = a.ultima ? (a.ultima.data + ' ' + (a.ultima.ora || '')) : '';
        const db = b.ultima ? (b.ultima.data + ' ' + (b.ultima.ora || '')) : '';
        return db.localeCompare(da);
      });
    } else {
      rows.sort((a, b) => {
        const an = `${a.nume || ''} ${a.prenume || ''}`.toLowerCase();
        const bn = `${b.nume || ''} ${b.prenume || ''}`.toLowerCase();
        return an.localeCompare(bn, 'ro');
      });
    }

    if (!rows.length) {
      host.innerHTML = `<div class="pac-empty">${q ? 'Niciun rezultat.' : 'Niciun pacient în clinică.'}</div>`;
      return;
    }

    host.innerHTML = rows.map(p => {
      const name = [p.nume, p.prenume].filter(Boolean).join(' ');
      const tel  = p.telefon || '';
      const email = p.email || '';
      const meta = [tel, email].filter(Boolean).join(' · ');
      const ultima = p.ultima
        ? `Ultima: ${formatDateRo(p.ultima.data)}${p.ultima.serviciu ? ' · ' + escapeHtml(p.ultima.serviciu) : ''}`
        : 'Nicio programare';
      return `
        <div class="pac-item" data-pac="${escapeHtml(p.id)}">
          <div>
            <div class="pi-name">${escapeHtml(name)}</div>
            <div class="pi-meta">${escapeHtml(meta)}</div>
          </div>
          <div class="pi-stats"><strong>${p.total_programari}</strong><br/>programări</div>
          <div class="pi-last">${ultima}</div>
        </div>`;
    }).join('');

    $$('.pac-item[data-pac]', host).forEach(el => {
      el.addEventListener('click', () => openPacientDrawer(el.dataset.pac));
    });
  }

  async function openPacientDrawer(pacId) {
    openDrawer('<div class="dr-kicker">Pacient</div><h2>Se încarcă…</h2>');
    try {
      const detail = await api('pacient_detalii', { pacient_id: pacId });
      const p = detail.pacient;
      const programari = Array.isArray(detail.programari) ? detail.programari : [];
      const name = [p.nume, p.prenume].filter(Boolean).join(' ');
      const telHtml = p.telefon ? `<a href="tel:${escapeHtml(p.telefon)}">${escapeHtml(p.telefon)}</a>` : '—';
      const emHtml  = p.email   ? `<a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a>` : '—';

      const histHtml = programari.length ? programari.map(pr => {
        const medName = pr.medic ? [pr.medic.titlu, pr.medic.prenume, pr.medic.nume].filter(Boolean).join(' ') : '';
        const servName = pr.serviciu?.nume || '';
        const sub = [servName, medName].filter(Boolean).join(' · ');
        return `
          <div class="dr-history-item">
            <div class="dh-left">
              <div class="dh-date">${escapeHtml(formatDateRo(pr.data_programare))} · ${escapeHtml(trimSec(pr.ora_start))}</div>
              <div class="dh-serv">${escapeHtml(sub || '—')}</div>
            </div>
            <span class="dh-st ${statusClass(pr.status)}">${escapeHtml(statusLabel(pr.status))}</span>
          </div>`;
      }).join('') : '<div class="pac-empty" style="padding:20px 0">Niciun istoric.</div>';

      const html = `
        <div class="dr-kicker">Pacient</div>
        <h2>${escapeHtml(name)}</h2>
        <div class="dr-row"><span class="dr-label">Telefon</span><span class="dr-value">${telHtml}</span></div>
        <div class="dr-row"><span class="dr-label">Email</span><span class="dr-value">${emHtml}</span></div>
        <div class="dr-row"><span class="dr-label">Total programări</span><span class="dr-value">${programari.length}</span></div>
        <div class="dr-history">
          <h3>Istoric</h3>
          ${histHtml}
        </div>
      `;
      setDrawerContent(html);
    } catch (e) {
      setDrawerContent('<div class="dr-kicker">Pacient</div><h2>Eroare</h2><div class="pi-meta">Nu am putut încărca detaliile.</div>');
      console.warn('[silleau] pacient detalii', e);
    }
  }

  // ─── Drawer ──────────────────────────────────────────────────────────────
  function openDrawer(html) {
    setDrawerContent(html);
    const d = $('#drawer');
    d.hidden = false;
    d.setAttribute('aria-hidden', 'false');
  }
  function setDrawerContent(html) { $('#drawer-content').innerHTML = html; }
  function closeDrawer() {
    const d = $('#drawer');
    d.hidden = true;
    d.setAttribute('aria-hidden', 'true');
  }

  // ─── Event listeners ─────────────────────────────────────────────────────
  function wireEvents() {
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const btn  = $('#login-submit');
      const err  = $('#login-error');
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Se autentifică…';
      try {
        const email    = form.email.value.trim();
        const password = form.password.value;
        await login(email, password);
      } catch (e) {
        err.textContent = e?.message === 'Invalid login credentials' ? 'Email sau parolă incorecte.' : (e?.message || 'Autentificare eșuată.');
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Intră';
      }
    });

    $('#btn-logout').addEventListener('click', () => { logout(); });

    $$('.nav-tab').forEach(b => {
      b.addEventListener('click', () => activateTab(b.dataset.tab));
    });

    $('#cal-prev').addEventListener('click', () => {
      state.data_sel = addDays(state.data_sel, -1);
      loadProgramari();
    });
    $('#cal-next').addEventListener('click', () => {
      state.data_sel = addDays(state.data_sel, 1);
      loadProgramari();
    });
    $('#cal-today').addEventListener('click', () => {
      state.data_sel = todayISO();
      loadProgramari();
    });

    $('#pac-search').addEventListener('input', (e) => {
      state.pacienti_q = e.target.value;
      renderPacienti();
    });
    $('#pac-sort').addEventListener('change', (e) => {
      state.pacienti_sort = e.target.value;
      renderPacienti();
    });

    $('#drawer').addEventListener('click', (e) => {
      if (e.target.dataset.close === '1') closeDrawer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });

    // Reactivăm polling când tab-ul devine vizibil.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.clinic_id) {
        loadProgramari({ silent: true });
      }
    });

    // Service worker registration.
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/dashboard/sw.js', { scope: '/dashboard/' }).catch(err => {
          console.warn('[silleau] SW failed', err);
        });
      });
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────────
  async function init() {
    wireEvents();
    const restored = await restoreSession();
    if (!restored) showLogin();

    sb.auth.onAuthStateChange((_event, session) => {
      if (!session && state.session) { logout(); }
    });
  }

  init();
})();
