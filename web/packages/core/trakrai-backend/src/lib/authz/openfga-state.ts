import {
  OpenFgaClient,
  type AuthorizationModel,
  type ReadResponse,
  type Tuple,
  type TupleKey,
  type TupleKeyWithoutCondition,
} from '@openfga/sdk';

import { DEFAULT_OPENFGA_STORE_NAME, normalizeOptionalString, sortTupleKeys } from './constants';
import {
  AUTHORIZATION_MODEL,
  AUTHORIZATION_MODEL_HASH,
  createAuthorizationModelHash,
} from './model';

export type AuthzState = Readonly<{
  authorizationModelId: string;
  client: OpenFgaClient;
  storeId: string;
}>;

let authzStatePromise: Promise<AuthzState> | null = null;

const readRequiredOpenFgaApiUrl = (): string => {
  const apiUrl = normalizeOptionalString(process.env.OPENFGA_API_URL);
  if (apiUrl === null) {
    throw new Error('OPENFGA_API_URL is required.');
  }

  return apiUrl;
};

const readOpenFgaStoreName = (): string =>
  normalizeOptionalString(process.env.OPENFGA_STORE_NAME) ?? DEFAULT_OPENFGA_STORE_NAME;

const createBaseOpenFgaClient = (): OpenFgaClient =>
  new OpenFgaClient({
    apiUrl: readRequiredOpenFgaApiUrl(),
  });

const createScopedOpenFgaClient = (storeId: string, authorizationModelId?: string): OpenFgaClient =>
  new OpenFgaClient({
    apiUrl: readRequiredOpenFgaApiUrl(),
    authorizationModelId,
    storeId,
  });

const findStoreIdByName = async (
  client: OpenFgaClient,
  storeName: string,
): Promise<string | null> => {
  let continuationToken: string | undefined;

  do {
    const response = await client.listStores({
      continuationToken,
      name: storeName,
      pageSize: 100,
    });

    const matchedStore = response.stores.find(
      (store) => normalizeOptionalString(store.name) === storeName,
    );
    if (matchedStore !== undefined) {
      return matchedStore.id;
    }

    continuationToken = normalizeOptionalString(response.continuation_token) ?? undefined;
  } while (continuationToken !== undefined);

  return null;
};

const ensureStoreId = async (): Promise<string> => {
  const baseClient = createBaseOpenFgaClient();
  const storeName = readOpenFgaStoreName();
  const existingStoreId = await findStoreIdByName(baseClient, storeName);
  if (existingStoreId !== null) {
    return existingStoreId;
  }

  const createdStore = await baseClient.createStore({
    name: storeName,
  });

  const storeId = normalizeOptionalString(createdStore.id);
  if (storeId === null) {
    throw new Error('OpenFGA store creation did not return an id.');
  }

  return storeId;
};

const readAuthorizationModelHash = (
  authorizationModel: AuthorizationModel | undefined,
): string | null => {
  if (authorizationModel === undefined) {
    return null;
  }

  return createAuthorizationModelHash({
    conditions: authorizationModel.conditions,
    schema_version: authorizationModel.schema_version,
    type_definitions: authorizationModel.type_definitions,
  });
};

const ensureAuthorizationModelId = async (storeId: string): Promise<string> => {
  const client = createScopedOpenFgaClient(storeId);

  try {
    const response = await client.readLatestAuthorizationModel();
    const currentAuthorizationModel = response.authorization_model;
    const currentAuthorizationModelId = normalizeOptionalString(currentAuthorizationModel?.id);
    const currentAuthorizationModelHash = readAuthorizationModelHash(currentAuthorizationModel);

    if (
      currentAuthorizationModelId !== null &&
      currentAuthorizationModelHash === AUTHORIZATION_MODEL_HASH
    ) {
      return currentAuthorizationModelId;
    }
  } catch {
    // Empty stores or bootstrap races fall back to writing the model below.
  }

  const modelWriteResponse = await client.writeAuthorizationModel(AUTHORIZATION_MODEL);
  const authorizationModelId = normalizeOptionalString(modelWriteResponse.authorization_model_id);
  if (authorizationModelId === null) {
    throw new Error('OpenFGA authorization model creation did not return an id.');
  }

  return authorizationModelId;
};

const createAuthzState = async (): Promise<AuthzState> => {
  const storeId = await ensureStoreId();
  const authorizationModelId = await ensureAuthorizationModelId(storeId);

  return {
    authorizationModelId,
    client: createScopedOpenFgaClient(storeId, authorizationModelId),
    storeId,
  };
};

export const ensureAuthzState = async (): Promise<AuthzState> => {
  authzStatePromise ??= createAuthzState().catch((error) => {
    authzStatePromise = null;
    throw error;
  });

  return authzStatePromise;
};

export const resetAuthzStateCache = (): void => {
  authzStatePromise = null;
};

export const readAllTuples = async (client: OpenFgaClient): Promise<TupleKey[]> => {
  const tuples: TupleKey[] = [];
  let continuationToken: string | undefined;

  do {
    const response: ReadResponse = await client.read(
      {},
      {
        continuationToken,
        pageSize: 100,
      },
    );

    tuples.push(...response.tuples.map((tuple: Tuple): TupleKey => tuple.key));

    continuationToken = normalizeOptionalString(response.continuation_token) ?? undefined;
  } while (continuationToken !== undefined);

  return sortTupleKeys(tuples);
};

export const readTuplesForObject = async (
  client: OpenFgaClient,
  object: string,
): Promise<TupleKeyWithoutCondition[]> => {
  const tuples: TupleKeyWithoutCondition[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.read(
      { object },
      {
        continuationToken,
        pageSize: 100,
      },
    );

    tuples.push(
      ...response.tuples.map((tuple) => ({
        object: tuple.key.object,
        relation: tuple.key.relation,
        user: tuple.key.user,
      })),
    );

    continuationToken = normalizeOptionalString(response.continuation_token) ?? undefined;
  } while (continuationToken !== undefined);

  return tuples;
};

export const getAuthzDebugState = async (): Promise<
  Readonly<{
    authorizationModelId: string;
    storeId: string;
  }>
> => {
  const authzState = await ensureAuthzState();
  return {
    authorizationModelId: authzState.authorizationModelId,
    storeId: authzState.storeId,
  };
};
