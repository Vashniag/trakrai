import { SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';

import { requestContextStorage } from './request-context';

type SpanAttributeValue = boolean | number | string;

type SpanAttributes = Readonly<Record<string, SpanAttributeValue | null | undefined>>;

type SpanOptions = Readonly<{
  attributes?: SpanAttributes;
  kind?: SpanKind;
  tracerName?: string;
}>;

type InstrumentationOptionsFactory<TArgs extends unknown[]> =
  | SpanOptions
  | ((args: TArgs) => SpanOptions | undefined);

type InstrumentObjectMethodsOptions<TTarget extends object> = Readonly<{
  getAttributes?: (methodName: string, args: unknown[]) => SpanAttributes | undefined;
  getSpanName?: (methodName: string, args: unknown[]) => string;
  includeMethods?: readonly (keyof TTarget | string)[];
  targetName: string;
  tracerName?: string;
}>;

const DEFAULT_TRACER_NAME = 'trakrai';

const isPromise = <TValue>(
  value: TValue | Promise<TValue>,
): value is Extract<TValue | Promise<TValue>, Promise<TValue>> => value instanceof Promise;

const setAttributes = (span: Span, attributes: SpanAttributes | undefined): void => {
  if (attributes === undefined) {
    return;
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) {
      span.setAttribute(key, value);
    }
  }
};

const readRequestAttributes = (): SpanAttributes | undefined => {
  const requestContext = requestContextStorage.getStore();
  if (requestContext === undefined) {
    return undefined;
  }

  return {
    'http.request.method': requestContext.method,
    'request.id': requestContext.requestId,
    'url.path': requestContext.path,
  };
};

export function withSpan<TValue>(
  name: string,
  fn: () => Promise<TValue>,
  options?: SpanOptions,
): Promise<TValue>;

export function withSpan<TValue>(name: string, fn: () => TValue, options?: SpanOptions): TValue;

export function withSpan<TValue>(
  name: string,
  fn: () => TValue | Promise<TValue>,
  options?: SpanOptions,
): TValue | Promise<TValue> {
  const tracer = trace.getTracer(options?.tracerName ?? DEFAULT_TRACER_NAME);

  return tracer.startActiveSpan(name, { kind: options?.kind }, (span) => {
    setAttributes(span, readRequestAttributes());
    setAttributes(span, options?.attributes);

    try {
      const result = fn();
      if (isPromise(result)) {
        return result
          .then((resolvedResult) => {
            span.end();
            return resolvedResult;
          })
          .catch((error: unknown) => {
            span.recordException(error instanceof Error ? error : new Error(String(error)));
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.end();
            throw error;
          });
      }

      span.end();
      return result;
    } catch (error: unknown) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      throw error;
    }
  });
}

export function instrumentedFunction<TArgs extends unknown[], TValue>(
  name: string,
  fn: (...args: TArgs) => Promise<TValue>,
  options?: InstrumentationOptionsFactory<TArgs>,
): (...args: TArgs) => Promise<TValue>;

export function instrumentedFunction<TArgs extends unknown[], TValue>(
  name: string,
  fn: (...args: TArgs) => TValue | Promise<TValue>,
  options?: InstrumentationOptionsFactory<TArgs>,
): (...args: TArgs) => TValue | Promise<TValue>;

export function instrumentedFunction<TArgs extends unknown[], TValue>(
  name: string,
  fn: (...args: TArgs) => TValue | Promise<TValue>,
  options?: InstrumentationOptionsFactory<TArgs>,
) {
  return function instrumented(this: unknown, ...args: TArgs): TValue | Promise<TValue> {
    const resolvedOptions = typeof options === 'function' ? options(args) : options;

    return withSpan(name, () => fn.apply(this, args), resolvedOptions);
  };
}

export const instrumentObjectMethods = <TTarget extends object>(
  target: TTarget,
  options: InstrumentObjectMethodsOptions<TTarget>,
): TTarget => {
  const wrappedMethods = new Map<PropertyKey, unknown>();
  const includedMethods =
    options.includeMethods === undefined
      ? null
      : new Set(options.includeMethods.map((methodName) => String(methodName)));

  return new Proxy(target, {
    get: (originalTarget, propertyKey, receiver) => {
      const value = Reflect.get(originalTarget, propertyKey, receiver);
      if (typeof value !== 'function') {
        return value;
      }

      const methodName = String(propertyKey);
      if (includedMethods !== null && !includedMethods.has(methodName)) {
        return value;
      }

      const cachedMethod = wrappedMethods.get(propertyKey);
      if (cachedMethod !== undefined) {
        return cachedMethod;
      }

      const methodValue = value as (...args: unknown[]) => unknown;
      const wrappedMethod = (...args: unknown[]) =>
        withSpan(
          options.getSpanName?.(methodName, args) ?? `${options.targetName}.${methodName}`,
          () => Reflect.apply(methodValue, originalTarget, args) as unknown,
          {
            attributes: options.getAttributes?.(methodName, args),
            kind: SpanKind.CLIENT,
            tracerName: options.tracerName,
          },
        );

      wrappedMethods.set(propertyKey, wrappedMethod);
      return wrappedMethod;
    },
  });
};
