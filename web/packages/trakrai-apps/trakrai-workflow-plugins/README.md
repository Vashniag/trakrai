# @trakrai-workflow/plugins

Optional Fluxery features published as focused subpath modules. Import the specific subpaths you
use; this package does not expose a root entrypoint.

## Install

```bash
pnpm add @trakrai-workflow/plugins @trakrai-workflow/ui @trakrai/design-system
```

Install the required peers in your app as well: `react`, `react-dom`, `@xyflow/react`, `@tanstack/react-query`, `lucide-react`, and `zod`. The `/ai` subpath also expects `ai` and `@ai-sdk/react`.

## Subpaths

- `@trakrai-workflow/plugins/ai`
- `@trakrai-workflow/plugins/backup-restore`
- `@trakrai-workflow/plugins/blocks`
- `@trakrai-workflow/plugins/code-runner`
- `@trakrai-workflow/plugins/cron-builder`
- `@trakrai-workflow/plugins/layout`
- `@trakrai-workflow/plugins/runs`
- `@trakrai-workflow/plugins/triggers`
- `@trakrai-workflow/plugins/styles.css`

## Example

```ts
import { AutoLayoutButton } from '@trakrai-workflow/plugins/layout';
import { runsPlugin } from '@trakrai-workflow/plugins/runs';
```
