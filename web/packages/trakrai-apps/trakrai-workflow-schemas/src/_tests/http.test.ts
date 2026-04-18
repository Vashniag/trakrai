import { describe, expect, it } from 'vitest';

import { HttpNodeFunctions } from '../nodes/http';

const TEST_URL = 'https://jsonplaceholder.typicode.com/posts/1';
const HTTP_OK = 200;
const HTTP_CREATED = 201;

const mockEvents = {};

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
const defaultNode = { id: 'node1', type: 'httpRequest', position: { x: 0, y: 0 }, data: {} };
describe('HttpNodeFunctions', () => {
  describe('httpRequest', () => {
    it('should make a successful GET request', async () => {
      const result = await HttpNodeFunctions.httpRequest(
        {
          url: TEST_URL,
          method: 'GET',
        },
        {},
        mockEvents,
        mockLogger,
        defaultNode,
      );

      expect(result.status).toBe(HTTP_OK);
      expect(result.statusText).toBe('OK');
      expect(result.data).toHaveProperty('id');
      expect(result.data).toHaveProperty('title');
    });

    it('should make a successful POST request', async () => {
      const result = await HttpNodeFunctions.httpRequest(
        {
          url: 'https://jsonplaceholder.typicode.com/posts',
          method: 'POST',
          body: {
            title: 'Test Post',
            body: 'This is a test',
            userId: 1,
          },
        },
        {},
        mockEvents,
        mockLogger,
        defaultNode,
      );

      expect(result.status).toBe(HTTP_CREATED);
      expect(result.data).toHaveProperty('id');
    });

    it('should handle query parameters', async () => {
      const result = await HttpNodeFunctions.httpRequest(
        {
          url: 'https://jsonplaceholder.typicode.com/posts',
          method: 'GET',
          queryParams: {
            userId: '1',
          },
        },
        {},
        mockEvents,
        mockLogger,
        defaultNode,
      );

      expect(result.status).toBe(HTTP_OK);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should handle custom headers', async () => {
      const result = await HttpNodeFunctions.httpRequest(
        {
          url: TEST_URL,
          method: 'GET',
          headers: {
            'X-Custom-Header': 'test-value',
          },
        },
        {},
        mockEvents,
        mockLogger,
        defaultNode,
      );

      expect(result.status).toBe(HTTP_OK);
      expect(result.headers).toHaveProperty('content-type');
    });

    it('should handle different HTTP methods', async () => {
      const putResult = await HttpNodeFunctions.httpRequest(
        {
          url: TEST_URL,
          method: 'PUT',
          body: {
            id: 1,
            title: 'Updated Title',
            body: 'Updated body',
            userId: 1,
          },
        },
        {},
        mockEvents,
        mockLogger,
        defaultNode,
      );

      expect(putResult.status).toBe(HTTP_OK);
      expect(putResult.data).toHaveProperty('id');
    });

    it('should handle PATCH requests', async () => {
      const result = await HttpNodeFunctions.httpRequest(
        {
          url: TEST_URL,
          method: 'PATCH',
          body: {
            title: 'Patched Title',
          },
        },
        {},
        mockEvents,
        mockLogger,
        defaultNode,
      );

      expect(result.status).toBe(HTTP_OK);
    });
  });
});
