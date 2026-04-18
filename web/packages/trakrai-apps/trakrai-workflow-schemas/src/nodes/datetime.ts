import {
  defineNodeFunctions,
  defineNodeSchema,
  defineNodeSchemaRegistry,
} from '@trakrai-workflow/core/utils';
import { z } from 'zod';

const CATEGORY = 'Date & Time';

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;
const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY;

/**
 * Built-in date and time node schemas that operate on Unix timestamps in milliseconds.
 */
export const DateTimeNodeSchemas = defineNodeSchemaRegistry({
  getCurrentTime: defineNodeSchema({
    input: z.object({}),
    output: z.object({ timestamp: z.number() }),
    category: CATEGORY,
    description: 'Returns the current time in milliseconds',
  }),
  getInvokeTime: defineNodeSchema({
    input: z.object({}),
    output: z.object({ timestamp: z.number() }),
    category: CATEGORY,
    description: 'Returns the workflow invocation time in milliseconds',
  }),
  addMilliseconds: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      milliseconds: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Adds milliseconds to a timestamp',
  }),
  addSeconds: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      seconds: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Adds seconds to a timestamp',
  }),
  addMinutes: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      minutes: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Adds minutes to a timestamp',
  }),
  addHours: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      hours: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Adds hours to a timestamp',
  }),
  addDays: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      days: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Adds days to a timestamp',
  }),
  subtractMilliseconds: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      milliseconds: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Subtracts milliseconds from a timestamp',
  }),
  subtractSeconds: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      seconds: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Subtracts seconds from a timestamp',
  }),
  subtractMinutes: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      minutes: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Subtracts minutes from a timestamp',
  }),
  subtractHours: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      hours: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Subtracts hours from a timestamp',
  }),
  subtractDays: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
      days: z.number(),
    }),
    output: z.object({ result: z.number() }),
    category: CATEGORY,
    description: 'Subtracts days from a timestamp',
  }),
  getTimeDifference: defineNodeSchema({
    input: z.object({
      timestamp1: z.number(),
      timestamp2: z.number(),
    }),
    output: z.object({ difference: z.number() }),
    category: CATEGORY,
    description:
      'Returns the difference between two timestamps in milliseconds (timestamp1 - timestamp2)',
  }),
  formatToISO: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
    }),
    output: z.object({ formatted: z.string() }),
    category: CATEGORY,
    description: 'Formats a timestamp to ISO 8601 string',
  }),
  parseFromISO: defineNodeSchema({
    input: z.object({
      isoString: z.string(),
    }),
    output: z.object({ timestamp: z.number() }),
    category: CATEGORY,
    description: 'Parses an ISO 8601 string to timestamp in milliseconds',
  }),
  getYear: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
    }),
    output: z.object({ year: z.number() }),
    category: CATEGORY,
    description: 'Extracts the year from a timestamp',
  }),
  getMonth: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
    }),
    output: z.object({ month: z.number() }),
    category: CATEGORY,
    description: 'Extracts the month (1-12) from a timestamp',
  }),
  getDay: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
    }),
    output: z.object({ day: z.number() }),
    category: CATEGORY,
    description: 'Extracts the day of month (1-31) from a timestamp',
  }),
  getHour: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
    }),
    output: z.object({ hour: z.number() }),
    category: CATEGORY,
    description: 'Extracts the hour (0-23) from a timestamp',
  }),
  getMinute: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
    }),
    output: z.object({ minute: z.number() }),
    category: CATEGORY,
    description: 'Extracts the minute (0-59) from a timestamp',
  }),
  getSecond: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
    }),
    output: z.object({ second: z.number() }),
    category: CATEGORY,
    description: 'Extracts the second (0-59) from a timestamp',
  }),
  getDayOfWeek: defineNodeSchema({
    input: z.object({
      timestamp: z.number(),
    }),
    output: z.object({ dayOfWeek: z.number() }),
    category: CATEGORY,
    description: 'Returns the day of week (0-6, where 0 is Sunday)',
  }),
});

/**
 * Runtime implementations for {@link DateTimeNodeSchemas}.
 *
 * All timestamps are milliseconds since the Unix epoch. `getInvokeTime` reads
 * `context.invokeTimestamp`, and the field extractors use the host environment's local timezone.
 * `parseFromISO` throws when the input cannot be parsed into a valid date, and `formatToISO`
 * inherits `Date#toISOString()` behavior for invalid timestamps.
 */
export const DateTimeNodeFunctions = defineNodeFunctions<
  typeof DateTimeNodeSchemas,
  { invokeTimestamp: Date }
>({
  getCurrentTime: () => ({ timestamp: Date.now() }),
  getInvokeTime: (_input, context) => ({ timestamp: context.invokeTimestamp.getTime() }),
  addMilliseconds: (input) => ({ result: input.timestamp + input.milliseconds }),
  addSeconds: (input) => ({ result: input.timestamp + input.seconds * MS_PER_SECOND }),
  addMinutes: (input) => ({ result: input.timestamp + input.minutes * MS_PER_MINUTE }),
  addHours: (input) => ({ result: input.timestamp + input.hours * MS_PER_HOUR }),
  addDays: (input) => ({ result: input.timestamp + input.days * MS_PER_DAY }),
  subtractMilliseconds: (input) => ({ result: input.timestamp - input.milliseconds }),
  subtractSeconds: (input) => ({ result: input.timestamp - input.seconds * MS_PER_SECOND }),
  subtractMinutes: (input) => ({ result: input.timestamp - input.minutes * MS_PER_MINUTE }),
  subtractHours: (input) => ({ result: input.timestamp - input.hours * MS_PER_HOUR }),
  subtractDays: (input) => ({ result: input.timestamp - input.days * MS_PER_DAY }),
  getTimeDifference: (input) => ({ difference: input.timestamp1 - input.timestamp2 }),
  formatToISO: (input) => ({ formatted: new Date(input.timestamp).toISOString() }),
  parseFromISO: (input) => {
    const timestamp = new Date(input.isoString).getTime();
    if (isNaN(timestamp)) throw new Error('Invalid ISO date string');
    return { timestamp };
  },
  getYear: (input) => ({ year: new Date(input.timestamp).getFullYear() }),
  getMonth: (input) => ({ month: new Date(input.timestamp).getMonth() + 1 }),
  getDay: (input) => ({ day: new Date(input.timestamp).getDate() }),
  getHour: (input) => ({ hour: new Date(input.timestamp).getHours() }),
  getMinute: (input) => ({ minute: new Date(input.timestamp).getMinutes() }),
  getSecond: (input) => ({ second: new Date(input.timestamp).getSeconds() }),
  getDayOfWeek: (input) => ({ dayOfWeek: new Date(input.timestamp).getDay() }),
});
