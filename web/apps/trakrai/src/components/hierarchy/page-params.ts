import { parseAsArrayOf, parseAsInteger, parseAsString } from 'nuqs/server';

const DEFAULT_PAGE_SIZE = 20;
const ARRAY_SEPARATOR = ',';

export const paginatedNameSearchParsers = {
  name: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
};

export const paginatedHierarchySearchParsers = {
  ...paginatedNameSearchParsers,
  departmentId: parseAsArrayOf(parseAsString, ARRAY_SEPARATOR).withDefault([]),
  factoryId: parseAsArrayOf(parseAsString, ARRAY_SEPARATOR).withDefault([]),
};
