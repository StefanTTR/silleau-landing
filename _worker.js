/**
 * Cloudflare Workers + Assets entry point.
 *
 * Handlers custom pentru /r/{c|r|x}/TOKEN și /f/TOKEN (proxy către Supabase
 * Edge Functions). Orice altă cerere cade pe static assets (SILLEAU_Landing/).
 */

const SUPABASE_FN = 'https://wpxflbwohowigaulhxhk.supabase.co/functions/v1';

/** Copiere răspuns cu strip pe header-ele care pot rupe UX-ul (CSP sandbox etc.) */
function cloneWithoutRestrictiveHeaders(origin) {
  const headers = new Headers(origin.headers);
  headers.delete('content-security-policy');
  headers.delete('x-content-type-options');
  return new Response(origin.body, {
    status:     origin.status,
    statusText: origin.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // /r/c/TOKEN, /r/r/TOKEN, /r/x/TOKEN → resolve-action?t=TOKEN
    const rMatch = path.match(/^\/r\/[crx]\/([A-Za-z0-9_-]+)\/?$/);
    if (rMatch) {
      const target = SUPABASE_FN + '/resolve-action?t=' + encodeURIComponent(rMatch[1]);
      const origin = await fetch(target, { redirect: 'manual' });
      return cloneWithoutRestrictiveHeaders(origin);
    }

    // /f/TOKEN?rating=N → save-feedback?t=TOKEN&rating=N
    const fMatch = path.match(/^\/f\/([A-Za-z0-9_.-]+)\/?$/);
    if (fMatch) {
      const qs = new URLSearchParams();
      qs.set('t', fMatch[1]);
      const rating = url.searchParams.get('rating');
      if (rating) qs.set('rating', rating);
      const target = SUPABASE_FN + '/save-feedback?' + qs.toString();
      const origin = await fetch(target, { redirect: 'manual' });
      return cloneWithoutRestrictiveHeaders(origin);
    }

    // Fallback → static assets din SILLEAU_Landing/
    return env.ASSETS.fetch(request);
  },
};
