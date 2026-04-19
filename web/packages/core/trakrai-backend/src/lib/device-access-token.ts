import { randomBytes } from 'node:crypto';

const DEVICE_ACCESS_TOKEN_BYTES = 24;

export const createDeviceAccessToken = (): string =>
  `trd_${randomBytes(DEVICE_ACCESS_TOKEN_BYTES).toString('hex')}`;
