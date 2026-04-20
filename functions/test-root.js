export const onRequestGet = () =>
  new Response('functions-at-repo-root', { headers: { 'content-type': 'text/plain' } });
