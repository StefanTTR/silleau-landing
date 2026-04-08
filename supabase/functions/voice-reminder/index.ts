/* voice-reminder — apelat de pg_cron la 19:30 ora României.
   Identifică programările de mâine cu reminder netrimis/neconfirmat
   și face apel vocal prin Twilio cu mesaj în română. */

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TWILIO_SID       = Deno.env.get('TWILIO_ACCOUNT_SID')!
const TWILIO_TOKEN     = Deno.env.get('TWILIO_AUTH_TOKEN')!
const TWILIO_FROM      = Deno.env.get('TWILIO_FROM_NUMBER')!   // ex: +40312000000
const WEBHOOK_URL      = Deno.env.get('VOICE_WEBHOOK_URL')!    // URL complet voice-webhook function

const SB_HEADERS = {
  'apikey':        SERVICE_ROLE_KEY,
  'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
}

Deno.serve(async (_req) => {
  try {
    // Mâine în timezone România (adaugă 24h și formatează YYYY-MM-DD)
    const ds = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' })

    // Fetch programări de mâine care au primit reminder dar nu au confirmat
    const url = SUPABASE_URL + '/rest/v1/v_reminder'
      + '?data_programare=eq.' + ds
      + '&reminder_trimis=eq.true'
      + '&confirmat_reminder=eq.false'
      + '&status=in.(neconfirmat,confirmat)'

    const res  = await fetch(url, { headers: SB_HEADERS })
    const rows = await res.json()
    console.log('DEBUG ds:', ds, 'status:', res.status, 'rows:', JSON.stringify(rows))

    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ apeluri: 0, debug_ds: ds, debug_rows: rows }), { status: 200 })
    }

    let apeluri = 0
    const twilioUrl = 'https://api.twilio.com/2010-04-01/Accounts/' + TWILIO_SID + '/Calls.json'
    const twilioAuth = 'Basic ' + btoa(TWILIO_SID + ':' + TWILIO_TOKEN)

    for (const row of rows) {
      if (!row.telefon) continue

      // Normalizează numărul (România: 07XX → +407XX)
      let tel = (row.telefon + '').replace(/\s/g, '')
      if (tel.startsWith('0') && !tel.startsWith('+')) tel = '+4' + tel

      // TwiML cu speech recognition în română
      const webhookAction = WEBHOOK_URL + '?id=' + row.id + '&clinic_id=' + encodeURIComponent(row.clinic_id || '')
      const twiml = '<?xml version="1.0" encoding="UTF-8"?>'
        + '<Response>'
        + '<Gather input="speech" language="ro-RO" speechTimeout="auto" speechModel="phone_call" action="' + webhookAction + '" method="POST">'
        + '<Say language="ro-RO" voice="Polly.Carmen">'
        + 'Bun\u0103 ziua! Ave\u021bi o programare m\u00e2ine la ' + (row.clinic_name || 'clinic\u0103') + '.'
        + ' Confirma\u021bi c\u0103 ve\u021bi veni?'
        + '</Say>'
        + '</Gather>'
        + '<Say language="ro-RO" voice="Polly.Carmen">'
        + 'Nu am auzit r\u0103spunsul. V\u0103 rug\u0103m s\u0103 contacta\u021bi clinica. La revedere!'
        + '</Say>'
        + '</Response>'

      const body = new URLSearchParams({
        To:    tel,
        From:  TWILIO_FROM,
        Twiml: twiml,
      })

      const callRes = await fetch(twilioUrl, {
        method:  'POST',
        headers: {
          'Authorization': twilioAuth,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })

      if (callRes.ok) apeluri++
    }

    return new Response(JSON.stringify({ apeluri, total: rows.length, data: ds }), { status: 200 })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
})
