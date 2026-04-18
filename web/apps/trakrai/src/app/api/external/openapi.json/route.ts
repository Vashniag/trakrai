import { appRouter } from '@trakrai/backend/server/routers';
import { generateOpenApiDocument } from 'trpc-to-openapi';

import { getBaseUrl } from '@/lib/getBaseUrl';

export const GET = async () => {
  const openApiDocument = generateOpenApiDocument(appRouter, {
    title: 'TrakrAI API',
    version: '1.0.0',
    baseUrl: `${getBaseUrl()}/api/external`,
  });
  return Response.json(openApiDocument);
};
