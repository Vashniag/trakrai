import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { storageObject } from '@/db/schema';
import { writeStoredObject } from '@/lib/local-object-storage';

const uploadHandler = async (
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

  if (metadata.uploadToken !== token) {
    return new Response('Invalid upload token', { status: 403 });
  }

  if (
    typeof metadata.uploadTokenExpiresAt === 'string' &&
    Date.parse(metadata.uploadTokenExpiresAt) < Date.now()
  ) {
    return new Response('Upload token expired', { status: 403 });
  }

  const arrayBuffer = await request.arrayBuffer();
  const body = new Uint8Array(arrayBuffer);
  const filePath = await writeStoredObject(objectRecord.id, objectRecord.objectKey, body);

  await db
    .update(storageObject)
    .set({
      metadata: {
        ...metadata,
        localPath: filePath,
      },
      sizeBytes: String(body.byteLength),
      status: 'uploaded',
      updatedAt: new Date(),
      uploadedAt: new Date(),
    })
    .where(eq(storageObject.id, objectRecord.id));

  return Response.json({
    objectId: objectRecord.id,
    objectKey: objectRecord.objectKey,
    status: 'uploaded',
  });
};

export { uploadHandler as POST, uploadHandler as PUT };
