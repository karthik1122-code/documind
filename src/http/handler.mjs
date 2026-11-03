import { json } from './respond.mjs';
import { askRoutes } from './routes/ask.routes.mjs';
import { collectionsRoutes } from './routes/collections.routes.mjs';
import { infoRoutes } from './routes/info.routes.mjs';
import { staticRoutes } from './routes/static.routes.mjs';

// Each route returns true when it replied, false to pass the request on.
const ROUTES = [infoRoutes, collectionsRoutes, askRoutes, staticRoutes];

/** Builds the request handler used by the local server and by the Vercel functions in api/. */
export function createHandler(deps) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      for (const route of ROUTES) if (await route(req, res, url, deps)) return;
      json(res, 404, { error: 'not_found' });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) json(res, 500, { error: 'internal_error' }); else res.end();
    }
  };
}
