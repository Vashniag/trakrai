import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Client } from 'pg';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5439/trakrai';

const baseUrl = process.env.BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? DEFAULT_BASE_URL;
const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

const hashDeviceToken = (token) => createHash('sha256').update(token).digest('hex');

const nowTag = Date.now();
const runId = `smoke-${nowTag}-${randomBytes(4).toString('hex')}`;
const devicePublicId = `dev_${runId}`;
const deviceName = `Smoke Device ${runId}`;
const accessToken = `dtk_${randomBytes(24).toString('base64url')}`;
const objectKey = `smoke/${runId}/violation-image.jpg`;
const binaryPayload = Buffer.from(`trakrai-smoke-payload:${runId}`, 'utf8');

const requestJson = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(parsed)}`);
  }

  return parsed;
};

const client = new Client({ connectionString: databaseUrl });

let createdDeviceId = null;
let createdTokenId = null;
let uploadedObjectId = null;
let violationMessageId = null;
let violationEventId = null;
let tiltMessageId = null;
let tiltEventId = null;

try {
  await client.connect();

  const createdDevice = await client.query(
    `
      insert into device (id, public_id, name, status, metadata)
      values ($1, $2, $3, 'active', '{}'::jsonb)
      returning id
    `,
    [randomUUID(), devicePublicId, deviceName],
  );
  createdDeviceId = createdDevice.rows[0]?.id ?? null;

  const createdToken = await client.query(
    `
      insert into device_token (id, device_id, label, token_prefix, token_hash)
      values ($1, $2, $3, $4, $5)
      returning id
    `,
    [
      randomUUID(),
      createdDeviceId,
      'Smoke token',
      accessToken.slice(0, 12),
      hashDeviceToken(accessToken),
    ],
  );
  createdTokenId = createdToken.rows[0]?.id ?? null;

  const uploadTicket = await requestJson('/trpc/external/storage/upload-ticket', {
    accessToken,
    contentType: 'image/jpeg',
    deviceId: devicePublicId,
    metadata: {
      purpose: 'smoke-test',
      runId,
    },
    objectKey,
    purpose: 'violation-image',
  });

  uploadedObjectId = uploadTicket.objectId;

  const uploadResponse = await fetch(uploadTicket.uploadUrl, {
    method: uploadTicket.uploadMethod ?? 'PUT',
    headers: {
      'content-type': 'image/jpeg',
    },
    body: binaryPayload,
  });

  if (!uploadResponse.ok) {
    throw new Error(`upload failed with ${uploadResponse.status}: ${await uploadResponse.text()}`);
  }

  const violationResponse = await requestJson('/trpc/external/violations', {
    accessToken,
    attachments: {
      imageObjectKey: objectKey,
      kind: 'smoke-check',
    },
    correlationId: `corr-${runId}`,
    deviceId: devicePublicId,
    imageObjectKey: objectKey,
    payload: {
      eventCode: 'smoke.violation',
      roiId: 'roi-main',
      runId,
    },
    severity: 'high',
    summary: 'Smoke verification event for upload + violation pipeline',
    title: `Smoke violation ${runId}`,
  });

  violationMessageId = violationResponse.messageId;
  violationEventId = violationResponse.eventId;

  const tiltResponse = await requestJson('/trpc/external/tilts', {
    accessToken,
    angle: '17.5',
    attachments: {
      runId,
    },
    correlationId: `corr-tilt-${runId}`,
    deviceId: devicePublicId,
    payload: {
      eventCode: 'smoke.tilt',
      runId,
    },
    severity: 'medium',
    summary: 'Smoke verification tilt event',
    title: `Smoke tilt ${runId}`,
  });

  tiltMessageId = tiltResponse.messageId;
  tiltEventId = tiltResponse.eventId;

  const downloadTicket = await requestJson('/trpc/external/storage/download-ticket', {
    accessToken,
    deviceId: devicePublicId,
    objectKey,
  });

  const downloadResponse = await fetch(downloadTicket.downloadUrl);
  if (!downloadResponse.ok) {
    throw new Error(`download failed with ${downloadResponse.status}: ${await downloadResponse.text()}`);
  }

  const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
  if (!downloaded.equals(binaryPayload)) {
    throw new Error('downloaded payload did not match uploaded payload');
  }

  const storageCount = await client.query(
    'select count(*)::int as total from storage_object where object_key = $1',
    [objectKey],
  );
  const deviceHealth = await client.query(
    `
      select d.last_seen_at, dt.last_used_at
      from device d
      left join device_token dt on dt.id = $2
      where d.id = $1
    `,
    [createdDeviceId, createdTokenId],
  );

  const summary = {
    baseUrl,
    devicePublicId,
    downloadVerified: true,
    messageIds: {
      tilt: tiltMessageId,
      violation: violationMessageId,
    },
    objectId: uploadedObjectId,
    objectKey,
    runId,
    storageRowsForObjectKey: storageCount.rows[0]?.total ?? 0,
    tokenLastUsedAt: deviceHealth.rows[0]?.last_used_at ?? null,
    violationEventId,
    tiltEventId,
    deviceLastSeenAt: deviceHealth.rows[0]?.last_seen_at ?? null,
  };

  if (summary.storageRowsForObjectKey !== 1) {
    throw new Error(`expected exactly one storage row for ${objectKey}, got ${summary.storageRowsForObjectKey}`);
  }
  if (!summary.deviceLastSeenAt || !summary.tokenLastUsedAt) {
    throw new Error('device credential usage timestamps were not updated');
  }

  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (violationEventId) {
    await client.query('delete from violation_event where id = $1', [violationEventId]);
  }
  if (tiltEventId) {
    await client.query('delete from tilt_event where id = $1', [tiltEventId]);
  }
  if (violationMessageId) {
    await client.query('delete from external_message where id = $1', [violationMessageId]);
  }
  if (tiltMessageId) {
    await client.query('delete from external_message where id = $1', [tiltMessageId]);
  }
  if (uploadedObjectId) {
    await client.query('delete from storage_object where id = $1', [uploadedObjectId]);
  } else {
    await client.query('delete from storage_object where object_key = $1', [objectKey]);
  }
  if (createdTokenId) {
    await client.query('delete from device_token where id = $1', [createdTokenId]);
  }
  if (createdDeviceId) {
    await client.query('delete from device where id = $1', [createdDeviceId]);
  }

  await client.end().catch(() => {});
}
