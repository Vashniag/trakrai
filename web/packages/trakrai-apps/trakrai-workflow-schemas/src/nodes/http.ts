import {
  defineNodeFunctions,
  defineNodeSchema,
  defineNodeSchemaRegistry,
} from '@trakrai-workflow/core/utils';
import { z } from 'zod';

/**
 * Built-in schema pack for network requests performed through `fetch`.
 */
export const HttpNodeSchemas = defineNodeSchemaRegistry({
  httpRequest: defineNodeSchema({
    input: z.object({
      url: z.string(),
      method: z
        .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
        .optional()
        .default('GET'),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
      queryParams: z.record(z.string(), z.string()).optional(),
      timeout: z.number().optional(),
    }),
    output: z.object({
      status: z.number(),
      statusText: z.string(),
      headers: z.record(z.string(), z.string()),
      data: z.unknown(),
    }),
    category: 'HTTP',
    description:
      'Makes an HTTP request with full control over method, headers, body, and query parameters',
  }),
});

/**
 * Runtime implementations for {@link HttpNodeSchemas}.
 *
 * `input.url` must be accepted by the runtime `URL` constructor. The request defaults to
 * `Content-Type: application/json` unless callers override it in `headers`, appends any provided
 * query params, only sends `body` for `POST`, `PUT`, and `PATCH`, parses JSON responses when the
 * content type advertises JSON, and aborts with a timeout error when `timeout` is greater than
 * zero.
 */
export const HttpNodeFunctions = defineNodeFunctions<typeof HttpNodeSchemas>({
  httpRequest: async (input) => {
    const url = new URL(input.url);

    // Add query parameters if provided
    if (input.queryParams !== undefined) {
      for (const [key, value] of Object.entries(input.queryParams)) {
        url.searchParams.append(key, value);
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...input.headers,
    };

    const requestOptions: RequestInit = {
      method: input.method,
      headers,
    };

    // Add body for methods that support it
    const hasBody = input.body !== undefined;
    if (hasBody && ['POST', 'PUT', 'PATCH'].includes(input.method)) {
      if (typeof input.body === 'string') {
        requestOptions.body = input.body;
      } else {
        requestOptions.body = JSON.stringify(input.body);
      }
    }

    // Add timeout using AbortController
    const controller = new AbortController();
    const timeoutId =
      input.timeout !== undefined && input.timeout > 0
        ? setTimeout(() => {
            controller.abort();
          }, input.timeout)
        : null;

    try {
      requestOptions.signal = controller.signal;
      const response = await fetch(url.toString(), requestOptions);

      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      // Parse response data
      let data: unknown;
      const contentType = response.headers.get('content-type');
      const isJson = contentType?.includes('application/json') ?? false;
      if (isJson) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      // Convert headers to plain object
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data,
      };
    } catch (error) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`HTTP request timed out after ${input.timeout ?? 0}ms`, { cause: error });
        }
        throw new Error(`HTTP request failed: ${error.message}`, { cause: error });
      }
      throw error;
    }
  },
});
