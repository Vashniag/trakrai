import { and, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

import { db } from '@/db';
import { device, deviceToken } from '@/db/schema';
import { hashDeviceToken } from '@/lib/device-tokens';

const authenticateDevice = async (
  ctx: { db: typeof db },
  input: { accessToken: string; deviceId: string },
) => {
  const tokenHash = hashDeviceToken(input.accessToken);

  const [match] = await ctx.db
    .select({
      deviceRecordId: device.id,
      name: device.name,
      publicId: device.publicId,
      tokenId: deviceToken.id,
    })
    .from(deviceToken)
    .innerJoin(device, eq(deviceToken.deviceId, device.id))
    .where(
      and(
        eq(device.publicId, input.deviceId),
        eq(deviceToken.tokenHash, tokenHash),
        isNull(deviceToken.revokedAt),
      ),
    )
    .limit(1);

  if (!match) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid device credentials' });
  }

  await ctx.db
    .update(deviceToken)
    .set({
      lastUsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deviceToken.id, match.tokenId));

  await ctx.db
    .update(device)
    .set({
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(device.id, match.deviceRecordId));

  return match;
};

export { authenticateDevice };
