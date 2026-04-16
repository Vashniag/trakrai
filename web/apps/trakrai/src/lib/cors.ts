import { env } from '@/lib/env';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://127.0.0.1:18080',
  'http://localhost:18080',
  'http://127.0.0.1:3001',
  'http://localhost:3001',
  'http://127.0.0.1:3002',
  'http://localhost:3002',
  'http://127.0.0.1:3003',
  'http://localhost:3003',
  'http://127.0.0.1:3004',
  'http://localhost:3004',
  'http://127.0.0.1:3005',
  'http://localhost:3005',
] as const;

const parseAllowedOrigins = (): Set<string> => {
  const configuredOrigins = (env.TRAKRAI_CLOUD_API_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
};

const allowedOrigins = parseAllowedOrigins();

const setVaryHeader = (headers: Headers, nextValue: string) => {
  const current = headers.get('Vary');
  if (current === null || current === '') {
    headers.set('Vary', nextValue);
    return;
  }
  if (
    !current
      .split(',')
      .map((value) => value.trim())
      .includes(nextValue)
  ) {
    headers.set('Vary', `${current}, ${nextValue}`);
  }
};

export const applyCorsHeaders = (request: Request, response: Response): Response => {
  const origin = request.headers.get('Origin');
  if (origin === null || origin === '' || !allowedOrigins.has(origin)) {
    return response;
  }

  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-trpc-source',
  );
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Origin', origin);
  setVaryHeader(response.headers, 'Origin');
  return response;
};

export const createCorsPreflightResponse = (request: Request): Response =>
  applyCorsHeaders(request, new Response(null, { status: 204 }));
