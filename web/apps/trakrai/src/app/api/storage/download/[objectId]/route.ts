import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { storageObject } from '@/db/schema';
import { readStoredObject } from '@/lib/local-object-storage';

export const GET = async (
  request: Request,
  context: { params: Promise<{ objectId: string }> },
) => {
  const { objectId } = await context.params;
  const token = new URL(request.url).searchParams.get('token');

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  const [objectRecord] = await db
    .select()
    .from(storageObject)
    .where(eq(storageObject.id, objectId))
    .limit(1);

  if (!objectRecord) {
    return new Response('Object not found', { status: 404 });
  }

  const metadata =
    objectRecord.metadata && typeof objectRecord.metadata === 'object' && !Array.isArray(objectRecord.metadata)
      ? (objectRecord.metadata as Record<string, unknown>)
      : {};

  if (metadata.downloadToken !== token) {
    return new Response('Invalid download token', { status: 403 });
  }

  if (
    typeof metadata.downloadTokenExpiresAt === 'string' &&
    Date.parse(metadata.downloadTokenExpiresAt) < Date.now()
  ) {
    return new Response('Download token expired', { status: 403 });
  }

  const { data } = await readStoredObject(objectRecord.id, objectRecord.objectKey);

  return new Response(data, {
    headers: {
      'content-length': String(data.byteLength),
      'content-type': objectRecord.contentType ?? 'application/octet-stream',
    },
  });
};
