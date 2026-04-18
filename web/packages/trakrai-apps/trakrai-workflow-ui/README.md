# @trakrai-workflow/ui

React UI primitives for rendering and wiring Fluxery editors.

## Install

```bash
pnpm add @trakrai-workflow/ui @trakrai/design-system
```

Install the required peers in your app as well: `react`, `react-dom`, `@xyflow/react`, `@tanstack/react-query`, `@trpc/client`, `@trpc/tanstack-react-query`, `superjson`, `lucide-react`, and `zod`.

## Exports

- `@trakrai-workflow/ui`
- `@trakrai-workflow/ui/fluxery`
- `@trakrai-workflow/ui/styles.css`

The root entrypoint exports the providers, editor shell components, sidebar/schema helpers, and the `jsonEditorSpecialField` helper. `@trakrai-workflow/ui/fluxery` is a focused subpath that re-exports only the shell components from `src/ui/fluxery.tsx`.

## Example

```tsx
import '@trakrai/design-system/globals.css';
import {
  FluxeryProvider,
  FluxeryContainer,
  FluxeryCore,
  FluxeryTopRightPanel,
} from '@trakrai-workflow/ui';
import '@trakrai-workflow/ui/styles.css';

export function EditorScreen() {
  return (
    <FluxeryProvider {...flowContext}>
      <FluxeryContainer>
        <FluxeryCore>
          <FluxeryTopRightPanel>{null}</FluxeryTopRightPanel>
        </FluxeryCore>
      </FluxeryContainer>
    </FluxeryProvider>
  );
}
```

If your app uses Tailwind v4, import the Fluxery CSS files from the root layout or entrypoint instead of re-importing them through your own Tailwind stylesheet. That keeps the package utilities from being pruned during the consumer build.
