import { createHash } from 'node:crypto';

import {
  AUTHZ_TYPE_DEPARTMENT,
  AUTHZ_TYPE_DEVICE,
  AUTHZ_TYPE_DEVICE_COMPONENT,
  AUTHZ_TYPE_FACTORY,
  AUTHZ_TYPE_USER,
} from './constants';

import type {
  AuthorizationModel,
  TypeDefinition,
  Userset,
  WriteAuthorizationModelRequest,
} from '@openfga/sdk';

const createDirectUserset = (): Userset => ({ this: {} });

const createComputedUserset = (relation: string): Userset => ({
  computedUserset: {
    object: '',
    relation,
  },
});

const createParentUserset = (relation: string): Userset => ({
  tupleToUserset: {
    tupleset: {
      object: '',
      relation: 'parent',
    },
    computedUserset: {
      object: '',
      relation,
    },
  },
});

const createUnionUserset = (...children: Userset[]): Userset => ({
  union: {
    child: children,
  },
});

const directRelationMetadata = (type: string, relation?: string) => ({
  type,
  ...(relation === undefined ? {} : { relation }),
});

const createTypeDefinitions = (): TypeDefinition[] => [
  {
    type: AUTHZ_TYPE_USER,
  },
  {
    type: AUTHZ_TYPE_FACTORY,
    relations: {
      admin: createDirectUserset(),
      can_manage_users: createComputedUserset('admin'),
      can_read: createComputedUserset('viewer'),
      viewer: createUnionUserset(createDirectUserset(), createComputedUserset('admin')),
    },
    metadata: {
      relations: {
        admin: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_USER)],
        },
        viewer: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_USER)],
        },
      },
    },
  },
  {
    type: AUTHZ_TYPE_DEPARTMENT,
    relations: {
      admin: createUnionUserset(createDirectUserset(), createParentUserset('admin')),
      can_manage_users: createComputedUserset('admin'),
      can_read: createComputedUserset('viewer'),
      parent: createDirectUserset(),
      viewer: createUnionUserset(
        createDirectUserset(),
        createComputedUserset('admin'),
        createParentUserset('viewer'),
      ),
    },
    metadata: {
      relations: {
        admin: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_USER)],
        },
        parent: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_FACTORY)],
        },
        viewer: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_USER)],
        },
      },
    },
  },
  {
    type: AUTHZ_TYPE_DEVICE,
    relations: {
      admin: createParentUserset('admin'),
      can_manage_users: createComputedUserset('admin'),
      can_read: createComputedUserset('viewer'),
      parent: createDirectUserset(),
      viewer: createUnionUserset(
        createDirectUserset(),
        createComputedUserset('admin'),
        createParentUserset('viewer'),
      ),
    },
    metadata: {
      relations: {
        parent: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_DEPARTMENT)],
        },
        viewer: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_USER)],
        },
      },
    },
  },
  {
    type: AUTHZ_TYPE_DEVICE_COMPONENT,
    relations: {
      can_manage_users: createParentUserset('admin'),
      can_read: createComputedUserset('reader'),
      can_write: createComputedUserset('writer'),
      parent: createDirectUserset(),
      reader: createUnionUserset(
        createDirectUserset(),
        createComputedUserset('writer'),
        createParentUserset('viewer'),
      ),
      writer: createDirectUserset(),
    },
    metadata: {
      relations: {
        parent: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_DEVICE)],
        },
        reader: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_USER)],
        },
        writer: {
          directly_related_user_types: [directRelationMetadata(AUTHZ_TYPE_USER)],
        },
      },
    },
  },
];

export const AUTHORIZATION_MODEL: WriteAuthorizationModelRequest = {
  schema_version: '1.1',
  type_definitions: createTypeDefinitions(),
};

export const serializeAuthorizationModelForHash = (
  authorizationModel: Pick<
    AuthorizationModel,
    'conditions' | 'schema_version' | 'type_definitions'
  >,
): string =>
  JSON.stringify({
    conditions: authorizationModel.conditions ?? {},
    schema_version: authorizationModel.schema_version,
    type_definitions: authorizationModel.type_definitions,
  });

export const createAuthorizationModelHash = (
  authorizationModel: Pick<
    AuthorizationModel,
    'conditions' | 'schema_version' | 'type_definitions'
  >,
): string =>
  createHash('sha256').update(serializeAuthorizationModelForHash(authorizationModel)).digest('hex');

export const AUTHORIZATION_MODEL_HASH = createAuthorizationModelHash(AUTHORIZATION_MODEL);
