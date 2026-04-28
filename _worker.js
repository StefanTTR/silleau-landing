/**
 * Cloudflare Workers + Assets entry point pentru silleau.app.
 *
 * silleau.app este dedicat exclusiv produsului CFO Virtual.
 * Toate path-urile vechi (clinic dashboard, booking, redirect-uri) au fost retrase.
 */

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // Root → /cfo/ (utilizatorul Google ajunge direct la login Cloudflare Access)
    if (path === '/' || path === '') {
      return Response.redirect('https://silleau.app/cfo/', 302);
    }

    // Whitelist: CFO + asset-uri de root (favicon, robots, sitemap)
    const allowed = (
      path.startsWith('/cfo') ||
      path === '/favicon.svg' ||
      path === '/favicon.ico' ||
      path === '/robots.txt' ||
      path === '/sitemap.xml' ||
      path.startsWith('/assets/')
    );

    if (allowed) {
      return env.ASSETS.fetch(request);
    }

    // Tot restul → 404 (rute clinic vechi, etc.)
    return new Response('Not Found', { status: 404 });
  },
};
