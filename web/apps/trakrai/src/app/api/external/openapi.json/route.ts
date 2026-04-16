import { generateOpenApiDocument } from 'trpc-to-openapi';

import { getBaseUrl } from '@/lib/getBaseUrl';
import { appRouter } from '@/server/routers';

export const GET = async () => {
  const openApiDocument = generateOpenApiDocument(appRouter, {
    title: 'TrakrAI API',
    version: '1.0.0',
    baseUrl: `${getBaseUrl()}/trpc/external`,
  });
  return Response.json(openApiDocument);
};
