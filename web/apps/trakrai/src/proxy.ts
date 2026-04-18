import { randomUUID } from 'node:crypto';

import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/lib/auth';

const publicPaths: Array<RegExp> = [
  /^\/auth(\/|$)/,
  /^\/_next(\/|$)/,
  /^\/api\/trpc(\/|$)/,
  /^\/api\/auth(\/|$)/,
  /^\/api\/external(\/|$)/,
  /^\/public\//,
  /^\/favicon.ico$/,
];

const matchesAny = (path: string, patterns: Array<RegExp>) => patterns.some((rx) => rx.test(path));

export const proxy = async (request: NextRequest) => {
  const requestId = randomUUID();
  const path = request.nextUrl.pathname;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('x-request-method', request.method);
  requestHeaders.set('x-request-path', path);

  const isPublic = matchesAny(path, publicPaths) || path === '/';
  if (isPublic) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (session === null) {
    const redirectUri = encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(new URL(`/auth/login?redirect=${redirectUri}`, request.url));
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
};
