import { createHash, randomBytes } from 'node:crypto';

const TOKEN_PREFIX_LENGTH = 12;

export const hashDeviceToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const generateDeviceToken = (): {
  plainTextToken: string;
  tokenHash: string;
  tokenPrefix: string;
} => {
  const plainTextToken = `dtk_${randomBytes(24).toString('base64url')}`;

  return {
    plainTextToken,
    tokenHash: hashDeviceToken(plainTextToken),
    tokenPrefix: plainTextToken.slice(0, TOKEN_PREFIX_LENGTH),
  };
};
