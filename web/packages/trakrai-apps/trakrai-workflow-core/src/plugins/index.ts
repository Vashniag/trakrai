import { initTRPC, type AnyRouter } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import superjson from 'superjson';
import { treeifyError, ZodError } from 'zod';

type MaybePromise<T> = T | Promise<T>;

/** Context provided to every API request handler, with access to request/response headers. */
export type ApiRequestContext = {
  /** The incoming request headers. */
  requestHeaders: Headers;
  /** Sets a header on the outgoing response. */
  setResponseHeader: (key: string, value: string) => MaybePromise<void>;
};

/** Payload passed to TRPC lifecycle hooks for a single procedure invocation. */
export type ApiHookPayload<Ctx extends object> = {
  ctx: Ctx;
  path: string;
  type: 'query' | 'mutation' | 'subscription';
  input: unknown;
};

/**
 * Lifecycle hooks for TRPC procedure execution.
 *
 * These hooks are applied by `createApiHandler` to TRPC plugins only. HTTP
 * plugins are routed directly to their handlers and do not pass through this hook layer.
 */
export type ApiHooks<Ctx extends object = ApiRequestContext> = {
  /** Called before the procedure executes. */
  preCall?: (payload: ApiHookPayload<Ctx>) => MaybePromise<void>;
  /** Called after a successful procedure execution, with the output. */
  postCall?: (payload: ApiHookPayload<Ctx> & { output: unknown }) => MaybePromise<void>;
  /** Called when a procedure throws an error. */
  onError?: (payload: ApiHookPayload<Ctx> & { error: unknown }) => MaybePromise<void>;
};

const trpc = initTRPC.context<ApiRequestContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError: error.cause instanceof ZodError ? treeifyError(error.cause) : null,
    },
  }),
});

/** Context provided to TRPC plugin `createRouter` functions, containing the TRPC builder primitives. */
export type TrpcApiPluginContext = {
  router: typeof trpc.router;
  procedure: typeof trpc.procedure;
  middleware: typeof trpc.middleware;
};

/**
 * A TRPC-based API plugin that registers a named sub-router.
 *
 * @typeParam Name - The string literal name of the plugin.
 * @typeParam Router - The TRPC router type created by the plugin.
 */
export type TrpcApiPlugin<Name extends string = string, Router extends AnyRouter = AnyRouter> = {
  kind: 'trpc';
  /** Unique name used as the router key and for client-side access via `useTRPCPluginAPIs`. */
  name: Name;
  /** Factory function that receives TRPC primitives and returns a router. */
  createRouter: (context: TrpcApiPluginContext) => Router;
  /** Optional lifecycle hooks scoped to this plugin. */
  hooks?: ApiHooks<ApiRequestContext>;
};

/** Standard HTTP methods supported by HTTP API plugins. */
export type HttpMethod = 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT';

/** Context passed to HTTP plugin handlers with path matching information. */
export type HttpRequestContext = {
  /** The plugin's configured path prefix. */
  path: string;
  /** The fully resolved path including the base path. */
  fullPath: string;
  /** The request's URL pathname. */
  pathname: string;
  /** Returns the URL path segment after the matched prefix, without a leading slash. */
  getRemainingPath: () => string;
};

/** A function that handles an HTTP request and returns a Response. */
export type HttpHandler = (request: Request, context: HttpRequestContext) => MaybePromise<Response>;

/**
 * An HTTP-based API plugin that mounts a handler at a specific path.
 *
 * The path is resolved relative to `createApiHandler({ basePath })`. When
 * multiple HTTP plugins overlap, the longest matching path prefix wins.
 *
 * @typeParam Path - The string literal path prefix for the plugin.
 */
export type HttpApiPlugin<Path extends string = string> = {
  kind: 'http';
  /** Path prefix where this plugin's handlers are mounted. */
  path: Path;
  /** A single handler function, or a map of HTTP methods to handler functions. */
  handler: HttpHandler | Partial<Record<HttpMethod, HttpHandler>>;
};

/** Union type of all supported API plugin kinds. */
export type ApiPlugin = TrpcApiPlugin | HttpApiPlugin;

/** Extracts the router type from a TRPC API plugin. */
export type InferTrpcPluginRouter<Plugin extends TrpcApiPlugin> = ReturnType<
  Plugin['createRouter']
>;
/** Extracts the name string from a TRPC API plugin. */
export type InferTrpcPluginName<Plugin extends TrpcApiPlugin> = Plugin['name'];

/**
 * Creates a typed TRPC API plugin definition.
 *
 * @typeParam Name - The plugin's unique name (inferred from `opts.name`).
 * @typeParam Router - The TRPC router type (inferred from `opts.createRouter`).
 * @param opts.name - Unique plugin name used as the router key.
 * @param opts.createRouter - Factory receiving TRPC primitives, returns a router.
 * @param opts.hooks - Optional lifecycle hooks scoped to this plugin.
 * @returns A `TrpcApiPlugin` instance.
 *
 * @example
 * ```ts
 * const myPlugin = defineTrpcPlugin({
 *   name: 'myPlugin',
 *   createRouter: ({ router, procedure }) =>
 *     router({ hello: procedure.query(() => 'world') }),
 * });
 * ```
 */
export const defineTrpcPlugin = <const Name extends string, Router extends AnyRouter>(opts: {
  name: Name;
  createRouter: (context: TrpcApiPluginContext) => Router;
  hooks?: ApiHooks<ApiRequestContext>;
}): TrpcApiPlugin<Name, Router> => {
  return {
    kind: 'trpc',
    name: opts.name,
    createRouter: opts.createRouter,
    hooks: opts.hooks,
  };
};

/**
 * Creates a typed HTTP API plugin definition.
 *
 * @typeParam Path - The path prefix (inferred from `opts.path`).
 * @param opts.path - URL path prefix where the handler is mounted.
 * @param opts.handler - A handler function or a map of HTTP methods to handlers.
 * @returns An `HttpApiPlugin` instance.
 *
 * @example
 * ```ts
 * const webhookPlugin = defineHttpPlugin({
 *   path: '/webhooks',
 *   handler: async (req) => new Response('OK'),
 * });
 * ```
 */
export const defineHttpPlugin = <const Path extends string>(opts: {
  path: Path;
  handler: HttpHandler | Partial<Record<HttpMethod, HttpHandler>>;
}): HttpApiPlugin<Path> => {
  return {
    kind: 'http',
    path: opts.path,
    handler: opts.handler,
  };
};

type HttpPluginRoute = {
  fullPath: string;
  plugin: HttpApiPlugin;
};

const normalizePath = (path: string) => {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  const collapsedSlashes = withLeadingSlash.replace(/\/{2,}/g, '/');
  if (collapsedSlashes.length > 1 && collapsedSlashes.endsWith('/')) {
    return collapsedSlashes.slice(0, -1);
  }
  return collapsedSlashes;
};

const joinPaths = (base: string, suffix: string) => {
  const normalizedBase = normalizePath(base);
  const normalizedSuffix = normalizePath(suffix);

  if (normalizedSuffix === '/') {
    return normalizedBase;
  }

  if (normalizedBase === '/') {
    return normalizedSuffix;
  }

  return `${normalizedBase}${normalizedSuffix}`;
};

const matchesHttpPluginPath = (pluginPath: string, pathname: string) => {
  if (pluginPath === pathname) {
    return true;
  }

  if (pluginPath === '/') {
    return pathname.startsWith('/');
  }

  return pathname.startsWith(`${pluginPath}/`);
};

const getRemainingHttpPluginPath = (pluginPath: string, pathname: string) => {
  if (pluginPath === pathname) {
    return '';
  }

  if (pluginPath === '/') {
    return pathname.slice(1);
  }

  return pathname.slice(pluginPath.length + 1);
};

const isPluginGroup = (
  plugin: ApiPlugin | ReadonlyArray<ApiPlugin>,
): plugin is ReadonlyArray<ApiPlugin> => Array.isArray(plugin);

const flattenPlugins = (
  plugins: ReadonlyArray<ApiPlugin | ReadonlyArray<ApiPlugin>> | undefined,
): ApiPlugin[] => {
  if (plugins === undefined) {
    return [];
  }

  const flattened: ApiPlugin[] = [];
  for (const plugin of plugins) {
    if (isPluginGroup(plugin)) {
      flattened.push(...plugin);
    } else {
      flattened.push(plugin);
    }
  }

  return flattened;
};

const withHooks = (
  procedure: typeof trpc.procedure,
  hooks: ApiHooks<ApiRequestContext> | undefined,
) => {
  if (hooks === undefined) {
    return procedure;
  }

  return procedure.use(
    trpc.middleware(async ({ ctx, path, type, input, next }) => {
      const payload: ApiHookPayload<ApiRequestContext> = {
        ctx,
        path,
        type,
        input,
      };

      await hooks.preCall?.(payload);

      try {
        const result = await next();
        if (result.ok) {
          await hooks.postCall?.({
            ...payload,
            output: result.data,
          });
        }
        return result;
      } catch (error) {
        await hooks.onError?.({
          ...payload,
          error,
        });
        throw error;
      }
    }),
  );
};

const resolveHttpMethodHandler = (
  plugin: HttpApiPlugin,
  requestMethod: string,
): HttpHandler | undefined => {
  if (typeof plugin.handler === 'function') {
    return plugin.handler;
  }

  const method = requestMethod.toUpperCase() as HttpMethod;
  return plugin.handler[method];
};

/**
 * Creates a unified API request handler that routes to TRPC and HTTP plugins.
 *
 * TRPC plugins are merged into a single router and receive global/plugin-scoped
 * `ApiHooks`. HTTP plugins are matched by path prefix (longest match wins) and
 * bypass the TRPC hook layer entirely. Duplicate names or resolved HTTP paths
 * throw during initialization.
 *
 * @param opts.basePath - The base URL path for the API (e.g. `'/api'`).
 * @param opts.plugins - Array of API plugins (TRPC and/or HTTP), optionally nested.
 * @param opts.createContext - Factory to create the request context from the incoming request.
 * @param opts.hooks - Optional global lifecycle hooks applied to all TRPC procedures.
 * @returns An object with a `handler` function suitable for use as a fetch handler.
 *
 * @example
 * ```ts
 * const api = createApiHandler({
 *   basePath: '/api',
 *   plugins: [myTrpcPlugin, myHttpPlugin],
 *   createContext: ({ req, resHeaders }) => ({ requestHeaders: req.headers, setResponseHeader: (k, v) => resHeaders.set(k, v) }),
 * });
 * ```
 */
export const createApiHandler = (opts: {
  basePath: string;
  plugins?: ReadonlyArray<ApiPlugin | ReadonlyArray<ApiPlugin>>;
  createContext: (opts: { req: Request; resHeaders: Headers }) => MaybePromise<ApiRequestContext>;
  hooks?: ApiHooks<ApiRequestContext>;
}): { handler: (request: Request) => Promise<Response> } => {
  const plugins = flattenPlugins(opts.plugins);
  const trpcPlugins = plugins.filter((plugin): plugin is TrpcApiPlugin => plugin.kind === 'trpc');
  const httpPlugins = plugins.filter((plugin): plugin is HttpApiPlugin => plugin.kind === 'http');

  const routerEntries = new Map<string, AnyRouter>();
  for (const plugin of trpcPlugins) {
    if (routerEntries.has(plugin.name)) {
      throw new Error(`Duplicate tRPC plugin name '${plugin.name}'`);
    }

    const scopedProcedure = withHooks(withHooks(trpc.procedure, opts.hooks), plugin.hooks);
    routerEntries.set(
      plugin.name,
      plugin.createRouter({
        router: trpc.router,
        procedure: scopedProcedure,
        middleware: trpc.middleware,
      }),
    );
  }

  const httpPluginRoutes: HttpPluginRoute[] = [];
  for (const plugin of httpPlugins) {
    const fullPath = joinPaths(opts.basePath, plugin.path);
    if (httpPluginRoutes.some((route) => route.fullPath === fullPath)) {
      throw new Error(`Duplicate HTTP plugin path '${fullPath}'`);
    }
    httpPluginRoutes.push({ fullPath, plugin });
  }

  httpPluginRoutes.sort((left, right) => right.fullPath.length - left.fullPath.length);
  const router = trpc.router(Object.fromEntries(routerEntries));

  const handler = async (request: Request): Promise<Response> => {
    const pathname = normalizePath(new URL(request.url).pathname);
    const matchedRoute = httpPluginRoutes.find((route) =>
      matchesHttpPluginPath(route.fullPath, pathname),
    );

    if (matchedRoute !== undefined) {
      const requestContext: HttpRequestContext = {
        path: matchedRoute.plugin.path,
        fullPath: matchedRoute.fullPath,
        pathname,
        getRemainingPath: () => getRemainingHttpPluginPath(matchedRoute.fullPath, pathname),
      };
      const httpHandler = resolveHttpMethodHandler(matchedRoute.plugin, request.method);
      if (httpHandler === undefined) {
        return new Response('Method Not Allowed', { status: 405 });
      }

      return httpHandler(request, requestContext);
    }

    return fetchRequestHandler({
      router,
      req: request,
      endpoint: opts.basePath,
      createContext: ({ resHeaders }) => opts.createContext({ req: request, resHeaders }),
    });
  };

  return { handler };
};
