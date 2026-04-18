import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import { transform } from 'sucrase';
import { z } from 'zod';

const DEFAULT_MEMORY_LIMIT_MB = 128;
const BYTES_PER_KB = 1024;
const KB_PER_MB = 1024;
const MB_TO_BYTES = BYTES_PER_KB * KB_PER_MB;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Configuration options for the TypeScript executor
 */
interface TypeScriptExecutorOptions {
  /**
   * Memory limit in bytes (default: 128MB)
   */
  memoryLimitBytes?: number;

  /**
   * Timeout in milliseconds (default: 5000ms)
   */
  timeoutMs?: number;
}

/**
 * Result of executing TypeScript code
 */
interface TypescriptExecutionResult<T = unknown> {
  /**
   * Whether the execution was successful
   */
  success: boolean;

  /**
   * The output data from the execution (if successful)
   */
  data?: T;

  /**
   * Error message (if execution failed)
   */
  error?: string;

  /**
   * Execution time in milliseconds
   */
  executionTimeMs: number;
}

export class TypeScriptExecutor {
  private readonly memoryLimitBytes: number;
  private readonly timeoutMs: number;

  constructor(options: TypeScriptExecutorOptions = {}) {
    this.memoryLimitBytes = options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_MB * MB_TO_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private transpileTypeScript(code: string): string {
    const result = transform(code, {
      transforms: ['typescript'],
      disableESTransforms: true,
    });
    return result.code;
  }

  private buildExecutableCode(code: string): string {
    const transpiledCode = this.transpileTypeScript(code);
    const expressionSource = JSON.stringify(`"use strict"; return (${transpiledCode});`);

    return `
      (function() {
        'use strict';

        let __expressionResult;
        let __expressionFailed = false;

        try {
          __expressionResult = Function(${expressionSource})();
        } catch (_error) {
          __expressionFailed = true;
        }

        if (!__expressionFailed) {
          if (typeof __expressionResult === 'function') {
            return __expressionResult(input);
          }

          if (__expressionResult !== undefined) {
            return __expressionResult;
          }
        }

        return (function(input) {
          'use strict';

          const module = { exports: {} };

          ${transpiledCode}

          if (typeof module.exports === 'function') {
            return module.exports(input);
          }

          if (
            module.exports !== null &&
            typeof module.exports === 'object' &&
            'default' in module.exports
          ) {
            const defaultExport = module.exports.default;
            if (typeof defaultExport === 'function') {
              return defaultExport(input);
            }
            return defaultExport;
          }

          if (typeof run === 'function') {
            return run(input);
          }

          if (typeof main === 'function') {
            return main(input);
          }

          if (module.exports !== null && module.exports !== undefined) {
            if (typeof module.exports !== 'object' || Object.keys(module.exports).length > 0) {
              return module.exports;
            }
          }

          return undefined;
        })(input);
      })()
    `;
  }

  async execute<TInput = unknown, TOutput = unknown>(
    code: string,
    input: TInput,
    inputSchema: z.core.JSONSchema.JSONSchema,
    outputSchema: z.core.JSONSchema.JSONSchema,
    _logger?: unknown,
  ): Promise<TypescriptExecutionResult<TOutput>> {
    const startTime = Date.now();

    try {
      const inputValidator = z.fromJSONSchema(inputSchema);
      const validatedInput = inputValidator.parse(input);

      const QuickJS = await getQuickJS();

      const vm = QuickJS.newContext();
      vm.runtime.setMemoryLimit(this.memoryLimitBytes);
      let executionResult: unknown;
      try {
        const deadline = Date.now() + this.timeoutMs;
        const interruptHandler = shouldInterruptAfterDeadline(deadline);
        vm.runtime.setInterruptHandler(interruptHandler);

        const jsonHandle = vm.newObject();
        vm.setProp(vm.global, 'JSON', jsonHandle);

        const parseHandle = vm.newFunction(
          'parse',
          (strHandle: Parameters<typeof vm.getString>[0]) => {
            const str = vm.getString(strHandle);
            const obj: unknown = JSON.parse(str);
            return vm.unwrapResult(vm.evalCode(`(${JSON.stringify(obj)})`));
          },
        );
        vm.setProp(jsonHandle, 'parse', parseHandle);

        const stringifyHandle = vm.newFunction(
          'stringify',
          (objHandle: Parameters<typeof vm.dump>[0]) => {
            const obj: unknown = vm.dump(objHandle);
            return vm.newString(JSON.stringify(obj));
          },
        );
        vm.setProp(jsonHandle, 'stringify', stringifyHandle);

        parseHandle.dispose();
        stringifyHandle.dispose();
        jsonHandle.dispose();

        const inputHandle = vm.unwrapResult(vm.evalCode(`(${JSON.stringify(validatedInput)})`));
        vm.setProp(vm.global, 'input', inputHandle);
        inputHandle.dispose();

        const wrappedCode = this.buildExecutableCode(code);
        // Execute the code
        const resultHandle = vm.unwrapResult(vm.evalCode(wrappedCode));
        executionResult = vm.dump(resultHandle);
        resultHandle.dispose();

        // Dispose of the VM
        vm.dispose();
      } catch (error) {
        // Make sure to dispose of the VM even if there's an error
        vm.dispose();
        throw error;
      }

      const outputValidator = z.fromJSONSchema(outputSchema);
      const validatedOutput = outputValidator.parse(executionResult) as TOutput;
      const executionTimeMs = Date.now() - startTime;

      return {
        success: true,
        data: validatedOutput,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      if (error instanceof z.ZodError) {
        return {
          success: false,
          error: `Validation error: ${error.message}`,
          executionTimeMs,
        };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        error: errorMessage,
        executionTimeMs,
      };
    }
  }

  async executeWithZod<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
    code: string,
    input: z.infer<TInput>,
    inputSchema: TInput,
    outputSchema: TOutput,
    logger?: unknown,
  ): Promise<TypescriptExecutionResult<z.infer<TOutput>>> {
    const inputJsonSchema = z.toJSONSchema(inputSchema);
    const outputJsonSchema = z.toJSONSchema(outputSchema);
    return this.execute<z.infer<TInput>, z.infer<TOutput>>(
      code,
      input,
      inputJsonSchema,
      outputJsonSchema,
      logger,
    );
  }
}
