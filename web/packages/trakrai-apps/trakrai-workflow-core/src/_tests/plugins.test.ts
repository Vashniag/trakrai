import { describe, expect, it, vi } from 'vitest';

import { createApiHandler, defineHttpPlugin, type HttpRequestContext } from '../plugins';

const AI_ENDPOINT = '/ai';
const API_ENDPOINT = '/api/plugins';
const GENERATE_WORKFLOW_URL = 'https://example.com/api/plugins/ai/generate-workflow';
const OK_STATUS = 200;
const NOT_FOUND_STATUS = 404;

describe('createApiHandler HTTP plugin routing', () => {
  it('routes nested paths to the matching HTTP plugin endpoint prefix', async () => {
    const handlerSpy = vi.fn(async () => new Response('ok'));
    const { handler } = createApiHandler({
      basePath: API_ENDPOINT,
      plugins: [
        defineHttpPlugin({
          path: AI_ENDPOINT,
          handler: handlerSpy,
        }),
      ],
      createContext: ({ req }) => ({
        requestHeaders: req.headers,
        setResponseHeader: async () => undefined,
      }),
    });

    const response = await handler(new Request(GENERATE_WORKFLOW_URL, { method: 'POST' }));

    expect(response.status).toBe(OK_STATUS);
    expect(await response.text()).toBe('ok');
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it('exposes the remaining path relative to the matched HTTP plugin endpoint', async () => {
    const handlerSpy = vi.fn(async (_request: Request, context: HttpRequestContext) =>
      Response.json(context.getRemainingPath()),
    );
    const { handler } = createApiHandler({
      basePath: API_ENDPOINT,
      plugins: [
        defineHttpPlugin({
          path: AI_ENDPOINT,
          handler: handlerSpy,
        }),
      ],
      createContext: ({ req }) => ({
        requestHeaders: req.headers,
        setResponseHeader: async () => undefined,
      }),
    });

    const response = await handler(new Request(GENERATE_WORKFLOW_URL, { method: 'POST' }));

    expect(response.status).toBe(OK_STATUS);
    expect(await response.json()).toBe('generate-workflow');
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it('does not match partial path segments for HTTP plugin endpoints', async () => {
    const handlerSpy = vi.fn(async () => new Response('ok'));
    const { handler } = createApiHandler({
      basePath: API_ENDPOINT,
      plugins: [
        defineHttpPlugin({
          path: AI_ENDPOINT,
          handler: handlerSpy,
        }),
      ],
      createContext: ({ req }) => ({
        requestHeaders: req.headers,
        setResponseHeader: async () => undefined,
      }),
    });

    const response = await handler(
      new Request('https://example.com/api/plugins/air', { method: 'GET' }),
    );

    expect(response.status).toBe(NOT_FOUND_STATUS);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('prefers the most specific HTTP plugin endpoint for overlapping prefixes', async () => {
    const baseHandler = vi.fn(async () => new Response('base'));
    const nestedHandler = vi.fn(async () => new Response('nested'));
    const { handler } = createApiHandler({
      basePath: API_ENDPOINT,
      plugins: [
        defineHttpPlugin({
          path: AI_ENDPOINT,
          handler: baseHandler,
        }),
        defineHttpPlugin({
          path: '/ai/generate-workflow',
          handler: nestedHandler,
        }),
      ],
      createContext: ({ req }) => ({
        requestHeaders: req.headers,
        setResponseHeader: async () => undefined,
      }),
    });

    const response = await handler(
      new Request('https://example.com/api/plugins/ai/generate-workflow/stream', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(OK_STATUS);
    expect(await response.text()).toBe('nested');
    expect(baseHandler).not.toHaveBeenCalled();
    expect(nestedHandler).toHaveBeenCalledTimes(1);
  });
});
