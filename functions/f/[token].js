/**
 * Cloudflare Pages Function — proxy către Supabase save-feedback.
 *
 * Matches: /f/TOKEN (cu query ?rating=N de pe butoanele din email)
 */
export const onRequestGet = async (context) => {
  const { token } = context.params;
  const srcUrl = new URL(context.request.url);

  const qs = new URLSearchParams();
  qs.set('t', token);
  const rating = srcUrl.searchParams.get('rating');
  if (rating) qs.set('rating', rating);

  const url = 'https://wpxflbwohowigaulhxhk.supabase.co/functions/v1/save-feedback?' + qs.toString();
  const origin = await fetch(url, { redirect: 'manual' });

  const headers = new Headers(origin.headers);
  headers.delete('content-security-policy');
  headers.delete('x-content-type-options');

  return new Response(origin.body, {
    status:     origin.status,
    statusText: origin.statusText,
    headers,
  });
};
