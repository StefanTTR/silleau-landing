// Cron: rulează la fiecare ora (recomandat: "*/15 * * * *")
// Trimite urmatoarea notificare din coada notificari_slot
// daca nimeni nu a acceptat slotul pentru programarea respectiva.

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY       = Deno.env.get('RESEND_KEY')!
const FROM_EMAIL       = 'Clinica Alfa <contact@silleau.com>'
const SITE             = 'https://www.silleau.com'
const REFUZA_FN        = 'https://wpxflbwohowigaulhxhk.supabase.co/functions/v1/refuza-slot'

const SB      = { 'apikey': SERVICE_ROLE_KEY, 'Authorization': 'Bearer ' + SERVICE_ROLE_KEY }
const SB_POST = { ...SB, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtOra(t: string): string { return String(t).slice(0, 5) }

const SLOT_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="ro" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Language" content="ro">
<meta name="language" content="Romanian">
<meta name="supported-color-schemes" content="light dark">
<style>
:root { color-scheme: light dark; }
body, table, td, p, span, div { margin:0; padding:0; }
body { font-family:'Helvetica Neue',Arial,sans-serif; -webkit-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
.bg-outer       { background-color:#ffffff; }
.bg-card        { background-color:#ffffff; border:1px solid #E8E4DC; }
.text-tag       { color:#BBBBBB; }
.text-title     { color:#111111; }
.text-greet     { color:#111111; }
.text-name      { color:#111111; }
.text-body      { color:#888888; }
.text-label     { color:#BBBBBB; }
.text-value     { color:#111111; }
.text-cur       { color:#CCCCCC; }
.text-note      { color:#CCCCCC; }
.text-note-em   { color:#888888; }
.text-foot-n    { color:#BBBBBB; }
.text-foot-s    { color:#CCCCCC; }
.text-brand     { color:#DDDDDD; }
.border-row     { border-top:1px solid #F0EDE8; border-bottom:1px solid #F0EDE8; }
.sep            { background-color:#F0EDE8; }
.border-section { border-top:1px solid #F0EDE8; }
.btn-accept     { background-color:#111111 !important; }
.btn-decline    { background-color:#ffffff !important; border:1px solid #E8E4DC !important; }
.btn-accept-txt { color:#ffffff !important; }
.btn-decline-txt{ color:#888888 !important; }
a.link-email    { color:#999999 !important; text-decoration:underline; text-decoration-style:dotted; }
@media (prefers-color-scheme: dark) {
  .bg-outer       { background-color:#0A0A0A !important; }
  .bg-card        { background-color:#111111 !important; border:1px solid #2A2A2A !important; }
  .text-tag       { color:#444444 !important; }
  .text-title     { color:#E8E4DC !important; }
  .text-greet     { color:#C8C4BC !important; }
  .text-name      { color:#E8E4DC !important; }
  .text-body      { color:#666666 !important; }
  .text-label     { color:#444444 !important; }
  .text-value     { color:#C8C4BC !important; }
  .text-cur       { color:#333333 !important; }
  .text-note      { color:#444444 !important; }
  .text-note-em   { color:#666666 !important; }
  .text-foot-n    { color:#555555 !important; }
  .text-foot-s    { color:#333333 !important; }
  .text-brand     { color:#2A2A2A !important; }
  .border-row     { border-top:1px solid #1E1E1E !important; border-bottom:1px solid #1E1E1E !important; }
  .sep            { background-color:#1E1E1E !important; }
  .border-section { border-top:1px solid #1E1E1E !important; }
  .btn-accept     { background-color:#E8E4DC !important; }
  .btn-decline    { background-color:transparent !important; border:1px solid #2A2A2A !important; }
  .btn-accept-txt { color:#111111 !important; }
  .btn-decline-txt{ color:#555555 !important; }
  a.link-email    { color:#555555 !important; }
}
[data-ogsc] .bg-outer       { background-color:#0A0A0A !important; }
[data-ogsc] .bg-card        { background-color:#111111 !important; border:1px solid #2A2A2A !important; }
[data-ogsc] .text-tag       { color:#444444 !important; }
[data-ogsc] .text-title     { color:#E8E4DC !important; }
[data-ogsc] .text-greet     { color:#C8C4BC !important; }
[data-ogsc] .text-name      { color:#E8E4DC !important; }
[data-ogsc] .text-body      { color:#666666 !important; }
[data-ogsc] .text-label     { color:#444444 !important; }
[data-ogsc] .text-value     { color:#C8C4BC !important; }
[data-ogsc] .text-cur       { color:#333333 !important; }
[data-ogsc] .text-note      { color:#444444 !important; }
[data-ogsc] .border-row     { border-top:1px solid #1E1E1E !important; border-bottom:1px solid #1E1E1E !important; }
[data-ogsc] .sep            { background-color:#1E1E1E !important; }
[data-ogsc] .border-section { border-top:1px solid #1E1E1E !important; }
[data-ogsc] .btn-accept     { background-color:#E8E4DC !important; }
[data-ogsc] .btn-accept-txt { color:#111111 !important; }
[data-ogsc] a.link-email    { color:#555555 !important; }
@media only screen and (max-width:600px) {
  .wrapper   { width:100% !important; }
  .inner     { padding:28px 20px 0 !important; }
  .footer-td { padding:16px 20px !important; }
  .btn-td    { display:block !important; width:100% !important; padding:0 0 8px 0 !important; }
}
</style>
</head>
<body class="bg-outer" style="margin:0;padding:0;background-color:#ffffff;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-outer" style="background-color:#ffffff;">
<tr><td align="center" style="padding:32px 12px;">
<table class="wrapper bg-card" width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:4px;border:1px solid #E8E4DC;">
  <tr>
    <td align="center" class="border-section" style="padding:36px 44px 28px;border-top:none;border-bottom:1px solid #F0EDE8;">
      <div class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;margin-bottom:14px;">Loc disponibil</div>
      <div class="text-title" style="font-size:23px;color:#111111;font-weight:300;font-family:'Helvetica Neue',Arial,sans-serif;letter-spacing:-0.3px;">{{NUME_CLINICA}}</div>
    </td>
  </tr>
  <tr>
    <td class="inner" style="padding:36px 44px 0;">
      <p style="font-size:15px;margin:0 0 6px;font-family:'Helvetica Neue',Arial,sans-serif;">
        <span class="text-greet" style="color:#111111;">Bună </span><strong class="text-name" style="color:#111111;font-weight:600;">{{NUME_PACIENT}}</strong><span class="text-greet" style="color:#111111;">,</span>
      </p>
      <p class="text-body" style="font-size:13px;color:#888888;line-height:1.8;margin:0 0 28px;font-family:'Helvetica Neue',Arial,sans-serif;">
        A apărut un loc disponibil mai devreme la <strong style="color:#666666;font-weight:500;">{{MEDIC}}</strong>. Doriți să vă reprogramați mai devreme?
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
        <tr><td colspan="2" style="padding:0 0 10px;"><span class="text-tag" style="font-size:9px;color:#BBBBBB;letter-spacing:3px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;">Loc disponibil</span></td></tr>
        <tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;width:42%;font-family:'Helvetica Neue',Arial,sans-serif;">Medic</td><td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">{{MEDIC}}</td></tr>
        <tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">Specialitate</td><td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">{{SPECIALITATE}}</td></tr>
        <tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">Serviciu</td><td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">{{SERVICIU}}</td></tr>
        <tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">Data</td><td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">{{SLOT_DATA}}</td></tr>
        <tr><td class="text-label border-row" style="padding:12px 0;font-size:10px;color:#BBBBBB;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">Ora</td><td class="text-value border-row" style="padding:12px 0;font-size:13px;color:#111111;text-align:right;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">{{SLOT_ORA}}</td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
        <tr><td colspan="2" style="padding:10px 0 10px;"><span class="text-tag" style="font-size:9px;color:#CCCCCC;letter-spacing:3px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;">Programarea dumneavoastră actuală</span></td></tr>
        <tr><td class="text-label border-row" style="padding:10px 0;font-size:10px;color:#CCCCCC;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;width:42%;font-family:'Helvetica Neue',Arial,sans-serif;">Data</td><td class="text-cur border-row" style="padding:10px 0;font-size:13px;color:#CCCCCC;text-align:right;text-decoration:line-through;border-top:1px solid #F0EDE8;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">{{CUR_DATA}}</td></tr>
        <tr><td class="text-label border-row" style="padding:10px 0;font-size:10px;color:#CCCCCC;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">Ora</td><td class="text-cur border-row" style="padding:10px 0;font-size:13px;color:#CCCCCC;text-align:right;text-decoration:line-through;border-bottom:1px solid #F0EDE8;font-family:'Helvetica Neue',Arial,sans-serif;">{{CUR_ORA}}</td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
        <tr>
          <td class="btn-td" style="width:50%;padding-right:6px;vertical-align:top;">
            <a href="{{LINK_ACCEPT}}" style="display:block;text-decoration:none;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td class="btn-accept" align="center" style="background-color:#111111;border-radius:3px;padding:14px 12px;">
                  <span class="btn-accept-txt" style="font-size:10px;color:#ffffff;letter-spacing:2px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;font-weight:500;">&#10003; &nbsp;Da, vreau acest loc</span>
                </td>
              </tr></table>
            </a>
          </td>
          <td class="btn-td" style="width:50%;padding-left:6px;vertical-align:top;">
            <a href="{{LINK_DECLINE}}" style="display:block;text-decoration:none;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td class="btn-decline" align="center" style="background-color:#ffffff;border:1px solid #E8E4DC;border-radius:3px;padding:14px 12px;">
                  <span class="btn-decline-txt" style="font-size:10px;color:#888888;letter-spacing:2px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;font-weight:500;">&#10005; &nbsp;Nu, păstrez programarea</span>
                </td>
              </tr></table>
            </a>
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;"><tr><td class="sep" style="height:1px;background-color:#F0EDE8;font-size:0;line-height:0;">&nbsp;</td></tr></table>
      <p class="text-note" style="font-size:12px;color:#CCCCCC;line-height:1.9;margin:0 0 32px;font-family:'Helvetica Neue',Arial,sans-serif;">
        Oferta este valabilă pentru o perioadă limitată. Dacă doriți mai multe informații contactați-ne la
        <a href="mailto:{{EMAIL_CLINICA}}" class="link-email" style="color:#999999;text-decoration:underline;text-decoration-style:dotted;font-family:'Helvetica Neue',Arial,sans-serif;">{{EMAIL_CLINICA}}</a>.
      </p>
    </td>
  </tr>
  <tr>
    <td class="footer-td border-section" style="padding:20px 44px;border-top:1px solid #F0EDE8;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;">
          <div class="text-foot-n" style="font-size:12px;color:#BBBBBB;margin-bottom:2px;font-family:'Helvetica Neue',Arial,sans-serif;">{{NUME_CLINICA}}</div>
          <div class="text-foot-s" style="font-size:11px;color:#CCCCCC;font-family:'Helvetica Neue',Arial,sans-serif;">
            <a href="mailto:{{EMAIL_CLINICA}}" class="link-email" style="color:#CCCCCC;text-decoration:underline;text-decoration-style:dotted;font-family:'Helvetica Neue',Arial,sans-serif;">{{EMAIL_CLINICA}}</a>
            &nbsp;&#183;&nbsp;
            {{TELEFON_CLINICA}}
          </div>
        </td>
        <td style="text-align:right;vertical-align:middle;">
          <div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:2px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;margin-bottom:2px;">SILLEAU Framework</div>
          <div class="text-brand" style="font-size:8px;color:#DDDDDD;letter-spacing:1px;text-transform:uppercase;font-family:'Helvetica Neue',Arial,sans-serif;">Revenue Optimisation Systems</div>
        </td>
      </tr></table>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`

function buildEmail(vars: Record<string, string>): string {
  let h = SLOT_EMAIL_TEMPLATE
  for (const [k, v] of Object.entries(vars)) {
    h = h.split(`{{${k}}}`).join(v)
  }
  return h
}

function buildAcceptUrl(notId: string, p: { medicNume: string, serviciuNume: string, specialitate: string, dataSlot: string, oraSlot: string, dataPac: string, oraPac: string }): string {
  return SITE + '/accepta-slot.html'
    + '?n='  + encodeURIComponent(notId)
    + '&m='  + encodeURIComponent(p.medicNume)
    + '&s='  + encodeURIComponent(p.serviciuNume)
    + '&d='  + encodeURIComponent(p.dataSlot)
    + '&o='  + encodeURIComponent(p.oraSlot)
    + '&dp=' + encodeURIComponent(p.dataPac)
    + '&op=' + encodeURIComponent(p.oraPac)
}

Deno.serve(async (_req) => {
  try {
    const nowIso = new Date().toISOString()

    const pending = await (await fetch(
      `${SUPABASE_URL}/rest/v1/notificari_slot`
      + `?trimite_la=lte.${encodeURIComponent(nowIso)}`
      + `&trimis=eq.false&anulat=eq.false`
      + `&select=id,programare_id,programare_pac_id,clinic_id,prenume,email,medic_nume,serviciu_nume,specialitate,data_slot,ora_slot,data_pac,ora_pac`
      + `&order=trimite_la.asc`,
      { headers: SB }
    )).json()

    if (!Array.isArray(pending) || pending.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { status: 200 })
    }

    let sent = 0; let skipped = 0

    for (const not of pending) {
      /* Verifică dacă cineva a acceptat deja */
      const acceptat = await (await fetch(
        `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${not.programare_id}&acceptat=eq.true&select=id&limit=1`,
        { headers: SB }
      )).json()

      if (Array.isArray(acceptat) && acceptat.length > 0) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/notificari_slot?programare_id=eq.${not.programare_id}&trimis=eq.false`,
          { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ anulat: true }) }
        )
        skipped++
        continue
      }

      const dataSlot = fmtData(not.data_slot)
      const oraSlot  = fmtOra(not.ora_slot)
      const dataPac  = not.data_pac || '—'
      const oraPac   = not.ora_pac ? fmtOra(not.ora_pac) : '—'

      const linkAccept  = buildAcceptUrl(not.id, {
        medicNume:    not.medic_nume || '',
        serviciuNume: not.serviciu_nume || '',
        specialitate: not.specialitate || '',
        dataSlot, oraSlot, dataPac, oraPac,
      })
      const linkDecline = `${REFUZA_FN}?n=${encodeURIComponent(not.id)}`

      const html = buildEmail({
        NUME_CLINICA:    'Clinica Alfa',
        NUME_PACIENT:    not.prenume || 'Pacient',
        MEDIC:           not.medic_nume || '',
        SPECIALITATE:    not.specialitate || '',
        SERVICIU:        not.serviciu_nume || '',
        SLOT_DATA:       dataSlot,
        SLOT_ORA:        oraSlot,
        CUR_DATA:        dataPac,
        CUR_ORA:         oraPac,
        LINK_ACCEPT:     linkAccept,
        LINK_DECLINE:    linkDecline,
        EMAIL_CLINICA:   'contact@silleau.com',
        TELEFON_CLINICA: '—',
      })

      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          from: FROM_EMAIL, to: [not.email],
          subject: `Loc disponibil pe ${dataSlot} la ora ${oraSlot} — SILLEAU`,
          html,
        }),
      })

      await fetch(
        `${SUPABASE_URL}/rest/v1/notificari_slot?id=eq.${not.id}`,
        { method: 'PATCH', headers: SB_POST, body: JSON.stringify({ trimis: true }) }
      )
      sent++
    }

    return new Response(JSON.stringify({ sent, skipped }), { status: 200 })
  } catch (err) {
    console.error('send-slot-notificari error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
