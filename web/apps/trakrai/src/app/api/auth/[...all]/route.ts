import { withRequestContext } from '@trakrai/backend/lib/request-context';
import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

const { POST: RAW_POST, GET: RAW_GET } = toNextJsHandler(auth);

export const POST = withRequestContext(RAW_POST);
export const GET = withRequestContext(RAW_GET);
