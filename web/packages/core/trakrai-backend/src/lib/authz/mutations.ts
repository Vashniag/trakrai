import {
  ClientWriteRequestOnDuplicateWrites,
  ClientWriteRequestOnMissingDeletes,
  type OpenFgaClient,
  type TupleKey,
  type TupleKeyWithoutCondition,
} from '@openfga/sdk';

import {
  AUTHZ_RELATION_CHILD,
  AUTHZ_RELATION_PARENT,
  createAuthzObject,
  createAuthzUser,
  type AuthzDirectUserRelation,
  type AuthzObjectType,
} from './constants';
import { ensureAuthzState, readTuplesForObject } from './openfga-state';

const DEFAULT_WRITE_OPTIONS = {
  conflict: {
    onDuplicateWrites: ClientWriteRequestOnDuplicateWrites.Ignore,
    onMissingDeletes: ClientWriteRequestOnMissingDeletes.Ignore,
  },
} as const;

const MAX_TUPLES_PER_WRITE = 50;
const MAX_PARALLEL_REQUESTS = 4;

const chunkArray = <TValue>(values: readonly TValue[], size: number): TValue[][] => {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

const writeTupleChunks = async (
  client: OpenFgaClient,
  chunkedWrites: readonly Readonly<{
    deletes?: readonly TupleKeyWithoutCondition[];
    writes?: readonly TupleKey[];
  }>[],
) => {
  for (const requestBatch of chunkArray(chunkedWrites, MAX_PARALLEL_REQUESTS)) {
    await Promise.all(
      requestBatch.map((requestChunk) =>
        client.write(
          {
            ...(requestChunk.deletes === undefined ? {} : { deletes: [...requestChunk.deletes] }),
            ...(requestChunk.writes === undefined ? {} : { writes: [...requestChunk.writes] }),
          },
          DEFAULT_WRITE_OPTIONS,
        ),
      ),
    );
  }
};

const normalizeTupleKeysForDelete = (
  tupleKeys: readonly TupleKeyWithoutCondition[],
): TupleKeyWithoutCondition[] =>
  tupleKeys.map((tupleKey) => ({
    object: tupleKey.object,
    relation: tupleKey.relation,
    user: tupleKey.user,
  }));

export const createObjectParentTupleKeys = (
  objectType: AuthzObjectType,
  objectId: string,
  parentType: AuthzObjectType,
  parentId: string,
): readonly [TupleKey, TupleKey] => {
  const object = createAuthzObject(objectType, objectId);
  const parentObject = createAuthzObject(parentType, parentId);

  return [
    {
      object,
      relation: AUTHZ_RELATION_PARENT,
      user: parentObject,
    },
    {
      object: parentObject,
      relation: AUTHZ_RELATION_CHILD,
      user: object,
    },
  ] as const;
};

export const writeAuthzTuples = async (tupleKeys: readonly TupleKey[]): Promise<void> => {
  if (tupleKeys.length === 0) {
    return;
  }

  const { client } = await ensureAuthzState();
  await writeTupleChunks(
    client,
    chunkArray(tupleKeys, MAX_TUPLES_PER_WRITE).map((writes) => ({
      writes,
    })),
  );
};

export const deleteAuthzTuples = async (
  tupleKeys: readonly TupleKeyWithoutCondition[],
): Promise<void> => {
  if (tupleKeys.length === 0) {
    return;
  }

  const { client } = await ensureAuthzState();
  await writeTupleChunks(
    client,
    chunkArray(normalizeTupleKeysForDelete(tupleKeys), MAX_TUPLES_PER_WRITE).map((deletes) => ({
      deletes,
    })),
  );
};

export const setObjectParentRelation = async (
  objectType: AuthzObjectType,
  objectId: string,
  parentType: AuthzObjectType,
  parentId: string,
): Promise<void> => {
  const { client } = await ensureAuthzState();
  const object = createAuthzObject(objectType, objectId);
  const [expectedParentTuple, expectedChildTuple] = createObjectParentTupleKeys(
    objectType,
    objectId,
    parentType,
    parentId,
  );

  const existingParentTuples = (await readTuplesForObject(client, object)).filter(
    (tupleKey) => tupleKey.relation === AUTHZ_RELATION_PARENT,
  );
  const existingChildTuples = existingParentTuples.map((tupleKey) => ({
    object: tupleKey.user,
    relation: AUTHZ_RELATION_CHILD,
    user: object,
  }));
  const deletes = existingParentTuples.filter(
    (tupleKey) =>
      tupleKey.user !== expectedParentTuple.user || tupleKey.object !== expectedParentTuple.object,
  );
  const childDeletes = existingChildTuples.filter(
    (tupleKey) =>
      tupleKey.object !== expectedChildTuple.object || tupleKey.user !== expectedChildTuple.user,
  );
  const hasExpectedParent = existingParentTuples.some(
    (tupleKey) => tupleKey.user === expectedParentTuple.user,
  );
  const hasExpectedChild = existingChildTuples.some(
    (tupleKey) =>
      tupleKey.object === expectedChildTuple.object && tupleKey.user === expectedChildTuple.user,
  );

  if (deletes.length === 0 && childDeletes.length === 0 && hasExpectedParent && hasExpectedChild) {
    return;
  }

  await client.write(
    {
      deletes: normalizeTupleKeysForDelete([...deletes, ...childDeletes]),
      writes: [
        ...(hasExpectedParent ? [] : [expectedParentTuple]),
        ...(hasExpectedChild ? [] : [expectedChildTuple]),
      ],
    },
    DEFAULT_WRITE_OPTIONS,
  );
};

export const replaceDirectUserRelation = async (
  objectType: AuthzObjectType,
  objectId: string,
  userId: string,
  nextRelation: AuthzDirectUserRelation | null,
  candidateRelations: readonly AuthzDirectUserRelation[],
): Promise<void> => {
  const { client } = await ensureAuthzState();
  const object = createAuthzObject(objectType, objectId);
  const authzUser = createAuthzUser(userId);
  const existingTuples = (await readTuplesForObject(client, object)).filter(
    (tupleKey) =>
      tupleKey.user === authzUser &&
      candidateRelations.some((candidateRelation) => candidateRelation === tupleKey.relation),
  );

  const deletes = existingTuples.filter((tupleKey) => tupleKey.relation !== nextRelation);
  const hasExpectedTuple =
    nextRelation !== null && existingTuples.some((tupleKey) => tupleKey.relation === nextRelation);

  if (deletes.length === 0 && (nextRelation === null || hasExpectedTuple)) {
    return;
  }

  await client.write(
    {
      deletes: normalizeTupleKeysForDelete(deletes),
      writes:
        nextRelation === null || hasExpectedTuple
          ? []
          : [
              {
                object,
                relation: nextRelation,
                user: authzUser,
              },
            ],
    },
    DEFAULT_WRITE_OPTIONS,
  );
};

export const deleteObjectAuthzRelations = async (
  objectType: AuthzObjectType,
  objectId: string,
): Promise<void> => {
  const { client } = await ensureAuthzState();
  const object = createAuthzObject(objectType, objectId);
  const existingTuples = await readTuplesForObject(client, object);

  if (existingTuples.length === 0) {
    return;
  }

  const parentChildDeletes = existingTuples
    .filter((tupleKey) => tupleKey.relation === AUTHZ_RELATION_PARENT)
    .map((tupleKey) => ({
      object: tupleKey.user,
      relation: AUTHZ_RELATION_CHILD,
      user: object,
    }));

  await client.write(
    {
      deletes: normalizeTupleKeysForDelete([...existingTuples, ...parentChildDeletes]),
    },
    DEFAULT_WRITE_OPTIONS,
  );
};
