import type { AdminSectionContent } from '@/components/admin-types';

const adminOpsSections = {
  devices: {
    actionNotes: [
      {
        detail:
          'Every device needs a first-class identity and token lifecycle that lives independently from workflow packets and upload requests.',
        label: 'Treat registration, provisioning, and cloud upload as separate concerns in the UI and the backend.',
      },
      {
        detail:
          'Future inspectors should surface workflow schema version, runtime version, and last upload or download activity in one rail.',
        label: 'Operators need a complete deployment picture before they click into a detail page.',
      },
    ],
    boardDescription:
      'Device registration and management placeholders for the rebuilt fleet pipeline.',
    boardRows: [
      {
        detail: 'Device identities should be immutable enough for audit and stable routing.',
        label: 'Device identifier',
        meta: 'Identity',
        status: 'Required',
        tone: 'nominal',
        value: 'Structured ID',
      },
      {
        detail:
          'Access tokens should be rotatable without requiring application-level payload changes.',
        label: 'Access token',
        meta: 'Credential',
        status: 'Lifecycle-managed',
        tone: 'warning',
        value: 'Rotatable',
      },
      {
        detail:
          'Cloud communication for metadata and file movement must stay visibly distinct.',
        label: 'Cloud lanes',
        meta: 'Transport',
        status: 'Metadata + signed URL',
        tone: 'warning',
        value: 'Separated',
      },
      {
        detail:
          'Video generation, upload retries, and local retention will need explicit surface area here later.',
        label: 'Recorder pipeline',
        meta: 'Media ops',
        status: 'Pending service work',
        tone: 'critical',
        value: 'Queue-backed',
      },
    ],
    boardTitle: 'Fleet control board',
    description:
      'The device page is prepared for registration, token management, deployment posture, and future upload or recorder diagnostics.',
    detailDescription:
      'Once the backend is ready, this inspector can show runtime versions, schema hashes, token age, and recent media-transfer activity.',
    detailGroups: [
      {
        items: [
          { label: 'Identity', value: 'Device ID + token' },
          { label: 'Media transfer', value: 'Signed URL over HTTP' },
          { label: 'Metadata path', value: 'MQTT via cloud-comm' },
        ],
        title: 'Planned contract',
      },
      {
        items: [
          { label: 'Future queues', value: 'Upload retry + recorder jobs' },
          { label: 'Retention hints', value: 'SQLite-backed job ledger' },
          { label: 'UI role', value: 'Provision + observe + recover' },
        ],
        title: 'Operational intent',
      },
    ],
    detailTitle: 'Fleet rail',
    eyebrow: 'Devices and provisioning',
    footerLinks: [
      { href: '/workflows', label: 'Open workflow distribution' },
      { href: '/events', label: 'Open event transport lane' },
      { href: '/live', label: 'Open shared live view' },
    ],
    metrics: [
      {
        detail: 'Core identity fields requested for the new device model.',
        label: 'Required credentials',
        tone: 'nominal',
        value: '2',
      },
      {
        detail: 'Cloud channels the UI should keep visually distinct.',
        label: 'Transfer planes',
        tone: 'warning',
        value: 'HTTP + MQTT',
      },
      {
        detail: 'Media work that will likely need the first deeper operations inspector.',
        label: 'Heavy queue',
        tone: 'critical',
        value: 'Recorder / upload',
      },
      {
        detail:
          'Expected relationship with the hierarchy page once scope wiring exists.',
        label: 'Placement source',
        tone: 'warning',
        value: 'Department-bound',
      },
    ],
    note:
      'The UI is framing device management as identity plus transport posture, not as a hidden side effect of workflow logic.',
    title: 'Fleet identity and deployment state',
  },
  apps: {
    actionNotes: [
      {
        detail:
          'Users at higher levels will eventually assign who can access which product surfaces from one screen.',
        label: 'Keep app entitlements visible as their own management concern.',
      },
      {
        detail:
          'The eventual policy editor should show both scope inheritance and app-level overrides at the same time.',
        label: 'App access is where RBAC and ABAC will feel real to operators.',
      },
    ],
    boardDescription:
      'Preview of app-entitlement management for the multi-app device and cloud ecosystem.',
    boardRows: [
      {
        detail: 'Primary cloud page for operations, scope management, and service posture.',
        label: 'Cloud admin',
        meta: 'Cloud app',
        status: 'Current focus',
        tone: 'nominal',
        value: 'Core shell',
      },
      {
        detail: 'Real-time browser or device workspace using the shared bridge contract.',
        label: 'Live workspace',
        meta: 'Cloud app',
        status: 'Already wired',
        tone: 'warning',
        value: 'Shared package',
      },
      {
        detail:
          'Future destination for device workflow authoring, validation, and distribution.',
        label: 'Workflow studio',
        meta: 'Cloud app',
        status: 'Pending port',
        tone: 'warning',
        value: 'Cloud + edge',
      },
      {
        detail:
          'Business-focused event surfaces like tilt and violation should remain apps, not gateway behaviors.',
        label: 'Event portals',
        meta: 'Domain apps',
        status: 'First endpoints next',
        tone: 'critical',
        value: 'Extensible',
      },
    ],
    boardTitle: 'App entitlements',
    description:
      'This page is a placeholder for the future catalog of product surfaces and the grants that determine who can open each one.',
    detailDescription:
      'The right rail is reserved for future app descriptions, default roles, and hierarchy constraints so grants stay understandable.',
    detailGroups: [
      {
        items: [
          { label: 'Grant basis', value: 'User + scope + app' },
          { label: 'Default shell', value: 'Cloud admin + live' },
          { label: 'Future inventory', value: 'More device apps expected' },
        ],
        title: 'Access model',
      },
      {
        items: [
          { label: 'Gateway stance', value: 'Forward, do not interpret' },
          { label: 'Workflow stance', value: 'Business meaning stays at edges' },
          { label: 'UI stance', value: 'Expose app access explicitly' },
        ],
        title: 'System principle',
      },
    ],
    detailTitle: 'Entitlement rail',
    eyebrow: 'Apps and modules',
    footerLinks: [
      { href: '/', label: 'Back to command posture' },
      { href: '/users', label: 'Review user grants' },
    ],
    metrics: [
      {
        detail: 'App families already implied by the current repositories and roadmap.',
        label: 'Visible app lanes',
        tone: 'nominal',
        value: '4+',
      },
      {
        detail:
          'Where access logic becomes business-facing instead of purely infrastructural.',
        label: 'Policy crossover',
        tone: 'warning',
        value: 'High',
      },
      {
        detail: 'First principle that must survive future growth.',
        label: 'Coupling risk',
        tone: 'critical',
        value: 'Do not hardcode business packets in intermediates',
      },
      {
        detail: 'UI pattern selected for future app policy review.',
        label: 'Review surface',
        tone: 'warning',
        value: 'Catalog + inspector',
      },
    ],
    note:
      'App access is treated as a first-class operator concern now so future ACL work has a visible home.',
    title: 'Application access catalog',
  },
  workflows: {
    actionNotes: [
      {
        detail:
          'Cloud and device workflows share concepts but not execution models, so the UI needs clear separation without fragmenting the experience.',
        label: 'Use one shell for both, but keep their responsibilities explicit.',
      },
      {
        detail:
          'Schema-hash distribution, cloud runtime plugins, and business nodes should all feel related without becoming the same page.',
        label: 'Prepare for multiple workflow surfaces from the start.',
      },
    ],
    boardDescription:
      'Workflow placeholders spanning cloud authoring, edge distribution, and business-node evolution.',
    boardRows: [
      {
        detail:
          'Future cloud authoring lane built around the cleaner Fluxery package architecture.',
        label: 'Cloud workflows',
        meta: 'Execution in cloud',
        status: 'Platform import planned',
        tone: 'nominal',
        value: 'Author + run',
      },
      {
        detail:
          'Device workflows remain schema-driven artifacts downloaded and executed on edge runtimes.',
        label: 'Device workflows',
        meta: 'Execution on edge',
        status: 'Schema hash model',
        tone: 'warning',
        value: 'Author + distribute',
      },
      {
        detail:
          'Violation and tilt stay defined in workflow or business nodes, not in intermediate services.',
        label: 'Business nodes',
        meta: 'Domain layer',
        status: 'Selective port',
        tone: 'warning',
        value: 'Extensible',
      },
      {
        detail:
          'Object storage and metadata rows should remain separated from editor and runtime concerns.',
        label: 'Workflow storage',
        meta: 'Persistence',
        status: 'Needs schema',
        tone: 'critical',
        value: 'JSON + metadata',
      },
    ],
    boardTitle: 'Workflow lanes',
    description:
      'This page is reserved for the dual workflow system: cloud execution on one side, device authoring and schema distribution on the other.',
    detailDescription:
      'The inspector can later show graph version, schema hash, trigger type, and distribution status without collapsing cloud and device concepts together.',
    detailGroups: [
      {
        items: [
          { label: 'Cloud base', value: 'Fluxery-style packages' },
          { label: 'Device base', value: 'Schema hash distribution' },
          { label: 'Domain nodes', value: 'Port only what business needs' },
        ],
        title: 'Adoption path',
      },
      {
        items: [
          { label: 'Cloud runtime', value: 'Plugin-driven' },
          { label: 'Edge runtime', value: 'Device-managed' },
          { label: 'Storage stance', value: 'JSON outside relational core' },
        ],
        title: 'System boundaries',
      },
    ],
    detailTitle: 'Workflow rail',
    eyebrow: 'Workflow systems',
    footerLinks: [
      { href: '/events', label: 'Open event intake lane' },
      { href: '/devices', label: 'Open device distribution lane' },
    ],
    metrics: [
      {
        detail: 'Workflow tracks explicitly called out in the roadmap.',
        label: 'Execution models',
        tone: 'nominal',
        value: '2',
      },
      {
        detail: 'Main design principle for keeping the ecosystem extensible.',
        label: 'Coupling rule',
        tone: 'warning',
        value: 'Intermediates stay generic',
      },
      {
        detail: 'Most important workflow artifact for edge compatibility.',
        label: 'Distribution key',
        tone: 'critical',
        value: 'Schema hash',
      },
      {
        detail: 'Operator pattern selected for future workflow operations.',
        label: 'Future UI',
        tone: 'warning',
        value: 'Board + inspector',
      },
    ],
    note:
      'The shell makes room for both workflow systems now so the future migration does not have to fight the page structure.',
    title: 'Cloud and edge workflow lanes',
  },
  events: {
    actionNotes: [
      {
        detail:
          'Violation and tilt should be the first external endpoints, but every intermediate service must stay unaware of their internal schema.',
        label: 'Keep business meaning at the workflow node and cloud endpoint edges only.',
      },
      {
        detail:
          'This page should later surface retry ledgers, upload posture, endpoint intent, and recent outcomes for operators.',
        label: 'Make queue state and delivery health obvious without exposing low-level packet coupling.',
      },
    ],
    boardDescription:
      'Placeholder view for external metadata intake, upload posture, and retriable media flow.',
    boardRows: [
      {
        detail:
          'Workflow or service prepares payload intent and target path without the gateway interpreting the body.',
        label: 'Metadata forwarder',
        meta: 'MQTT gateway',
        status: 'Thin router',
        tone: 'nominal',
        value: '/trpc/external/... intent',
      },
      {
        detail:
          'Signed-url negotiation and actual file transfer remain HTTP responsibilities, separate from metadata publishing.',
        label: 'Cloud file transfer',
        meta: 'HTTP plane',
        status: 'Retry-friendly',
        tone: 'warning',
        value: 'Upload / download',
      },
      {
        detail:
          'Recorder service can later generate raw, boxed, or composite clips from past or future windows.',
        label: 'Video generation',
        meta: 'Media service',
        status: 'Queue-backed',
        tone: 'warning',
        value: 'Raw / boxed / grid',
      },
      {
        detail:
          'Retries, deadlines, and connectivity windows need durable tracking so delivery can resume later.',
        label: 'Retry ledger',
        meta: 'Operational DB',
        status: 'SQLite-managed',
        tone: 'critical',
        value: 'Network-aware',
      },
    ],
    boardTitle: 'Event transport board',
    description:
      'This page is the cloud-side placeholder for the new event ingestion model: generic forwarding, direct HTTP file transfer, and durable retry state.',
    detailDescription:
      'The inspector is reserved for queue health, retry deadlines, and endpoint intent once the service work lands.',
    detailGroups: [
      {
        items: [
          { label: 'Business endpoints', value: 'Violation + tilt first' },
          { label: 'Gateway behavior', value: 'Forward only' },
          { label: 'Upload behavior', value: 'HTTP with signed URLs' },
        ],
        title: 'Core rules',
      },
      {
        items: [
          { label: 'Durable state', value: 'SQLite retry ledger' },
          { label: 'Media source', value: 'Recorder-owned frame store' },
          { label: 'Future UI', value: 'Queue + failure inspector' },
        ],
        title: 'Operational plan',
      },
    ],
    detailTitle: 'Event rail',
    eyebrow: 'Metadata and uploads',
    footerLinks: [
      { href: '/workflows', label: 'Review workflow producers' },
      { href: '/devices', label: 'Review device transport posture' },
    ],
    metrics: [
      {
        detail: 'First business routes mentioned for the rebuilt cloud app.',
        label: 'Initial endpoints',
        tone: 'nominal',
        value: '2',
      },
      {
        detail: 'Major transport split the UI should reinforce.',
        label: 'Transfer modes',
        tone: 'warning',
        value: 'Metadata / file',
      },
      {
        detail: 'Persistence layer expected to carry retry durability.',
        label: 'Retry store',
        tone: 'critical',
        value: 'SQLite',
      },
      {
        detail: 'Maximum intended media lookback or lookahead called out in the roadmap.',
        label: 'Recorder window',
        tone: 'warning',
        value: '10 min past + future',
      },
    ],
    note:
      'This placeholder keeps the system principle visible: gateways route, services upload, endpoints decide meaning.',
    title: 'Event intake and delivery posture',
  },
} satisfies Record<'devices' | 'apps' | 'workflows' | 'events', AdminSectionContent>;

export { adminOpsSections };
