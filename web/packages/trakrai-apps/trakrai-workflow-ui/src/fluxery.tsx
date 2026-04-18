'use client';

/**
 * Focused shell-only entrypoint for `@trakrai-workflow/ui/fluxery`.
 *
 * This subpath intentionally re-exports the visual editor layout components without
 * the broader root surface, which keeps consumer imports narrow when they only need
 * the shell composition primitives.
 */
export * from './ui/fluxery';
