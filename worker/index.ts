interface Env {
  DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route API requests
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // Serve static SPA assets
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Health check endpoint
    if (url.pathname === '/api/health') {
      let dbStatus = 'connected';
      try {
        await env.DB.prepare('SELECT 1').first();
      } catch (err) {
        dbStatus = `error: ${(err as Error).message}`;
      }

      return new Response(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          database: dbStatus,
        }),
        { headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Endpoint not found' }),
      { status: 404, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || 'Internal Server Error' }),
      { status: 500, headers: corsHeaders }
    );
  }
}
