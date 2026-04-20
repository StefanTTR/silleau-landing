/**
 * Cloudflare Pages Function — proxy către Supabase resolve-action.
 *
 * Matches: /r/c/TOKEN, /r/r/TOKEN, /r/x/TOKEN
 * [action] e captat dar ignorat; backend-ul derivă acțiunea din coloana
 * în care match-uiește hash-ul tokenului (handleUnifiedAction).
 *
 * Status 200 rewrite cross-origin nu e suportat de _redirects, de aceea
 * folosim Pages Functions.
 */
export const onRequestGet = async (context) => {
  const { token } = context.params;
  const url = 'https://wpxflbwohowigaulhxhk.supabase.co/functions/v1/resolve-action?t=' + encodeURIComponent(token);

  const origin = await fetch(url, { redirect: 'manual' });

  // Copiem răspunsul dar curățăm header-ele care pot strica UX-ul
  // (Supabase forțează `content-type: text/plain` + `CSP: sandbox` pe response-uri
  //  generate de Edge Functions — pentru 302 nu e relevant, dar prevenim).
  const headers = new Headers(origin.headers);
  headers.delete('content-security-policy');
  headers.delete('x-content-type-options');

  return new Response(origin.body, {
    status:     origin.status,
    statusText: origin.statusText,
    headers,
  });
};
