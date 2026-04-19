import { parseAsInteger, parseAsString } from 'nuqs/server';

const DEFAULT_PAGE_SIZE = 20;

export const paginatedNameSearchParsers = {
  name: parseAsString.withDefault(''),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
};
