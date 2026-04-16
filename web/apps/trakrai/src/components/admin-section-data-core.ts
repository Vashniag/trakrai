import type { AdminSectionContent } from '@/components/admin-types';

const adminCoreSections = {
  overview: {
    actionNotes: [
      {
        detail:
          'Finish the admin primitives first so device registration and scoped access sit on a stable shell.',
        label: 'Lock navigation, list views, and detail-rail patterns before the CRUD wave lands.',
      },
      {
        detail:
          'Use the live console as the first cross-link from cloud admin into operator workflows.',
        label: 'Keep the bridge visible from the shell, but leave transport logic in shared packages.',
      },
      {
        detail:
          'Treat signed-url upload and metadata forwarding as separate planes everywhere in the UI.',
        label: 'The shell should hint at the architecture boundary instead of hiding it.',
      },
    ],
    boardDescription: 'Compact command readout for the initial cloud rebuild lanes.',
    boardRows: [
      {
        detail:
          'Baseline shell, placeholder routes, and shared visual language now exist for the admin plane.',
        label: 'Cloud admin shell',
        meta: 'UI layer',
        status: 'Ready for CRUD wiring',
        tone: 'nominal',
        value: 'Phase 1',
      },
      {
        detail:
          'Future hierarchy screens can plug into one consistent list-plus-inspector pattern.',
        label: 'Org hierarchy model',
        meta: 'Access scope',
        status: 'Needs schema',
        tone: 'warning',
        value: '3 levels',
      },
      {
        detail:
          'Devices will own IDs and access tokens, while cloud file transfer stays decoupled from MQTT metadata.',
        label: 'Fleet registration',
        meta: 'Device ops',
        status: 'Awaiting API',
        tone: 'warning',
        value: 'Token-based',
      },
      {
        detail:
          'Violation and tilt are the first business endpoints expected on the rebuilt cloud side.',
        label: 'External event intake',
        meta: 'tRPC external',
        status: 'First adapters next',
        tone: 'critical',
        value: '2 lanes',
      },
    ],
    boardTitle: 'Operational board',
    description:
      'The front door for the new cloud app: compact, industrial, and structured around future hierarchy, device, workflow, and event operations.',
    detailDescription:
      'Right-side context for whoever is driving the rebuild. Think of this as the future drawer or inspector lane once data wiring is live.',
    detailGroups: [
      {
        items: [
          { label: 'Auth base', value: 'Better Auth retained' },
          { label: 'Route posture', value: 'Auth + live preserved' },
          { label: 'Visual source', value: 'Drivesafe-inspired shell' },
        ],
        title: 'Current footing',
      },
      {
        items: [
          { label: 'Next screen', value: 'Admin CRUD + permissions' },
          { label: 'Shared boundary', value: 'Thin gateway, generic packets' },
          { label: 'Future testing', value: 'Add route-level helpers + e2e' },
        ],
        title: 'Immediate handoff',
      },
    ],
    detailTitle: 'Operator rail',
    eyebrow: 'Cloud overview',
    footerLinks: [
      { href: '/devices', label: 'Inspect fleet placeholders' },
      { href: '/events', label: 'Inspect event intake' },
      { href: '/live', label: 'Jump to live workspace' },
    ],
    metrics: [
      {
        detail: 'Primary sections staged inside the new shell.',
        label: 'Admin lanes online',
        tone: 'nominal',
        value: '7',
      },
      {
        detail:
          'Current high-level model expected to map into RBAC and scoped policy controls.',
        label: 'Hierarchy bands',
        tone: 'warning',
        value: 'HQ / Factory / Dept',
      },
      {
        detail: 'Initial business endpoints to carry through the new cloud intake path.',
        label: 'External payload lanes',
        tone: 'critical',
        value: 'Violation + Tilt',
      },
      {
        detail:
          'Cloud and edge workflow tracks that will later share the same shell affordances.',
        label: 'Workflow surfaces',
        tone: 'warning',
        value: 'Cloud + Device',
      },
    ],
    note:
      'This shell is intentionally thin on data and heavy on structure so the next agents can attach the real schema, authz, and workflows without rewriting the UI frame.',
    title: 'Admin command posture',
  },
  hierarchy: {
    actionNotes: [
      {
        detail:
          'This page should later become the place where org lineage, inherited permissions, and device placement are managed together.',
        label: 'Use one source of truth for hierarchy assignment and keep access derivation inspectable.',
      },
      {
        detail:
          'The right rail should eventually explain how a headquarter-level grant fans out to factories and departments.',
        label: 'Future admins need visibility into inheritance, not just a successful save.',
      },
    ],
    boardDescription:
      'Proposed hierarchy lanes for headquarters, factories, departments, and their devices.',
    boardRows: [
      {
        detail: 'Top-level ownership boundary for business policy and platform governance.',
        label: 'Headquarters',
        meta: 'Root scope',
        status: 'Primary admins',
        tone: 'nominal',
        value: 'Global control',
      },
      {
        detail: 'Operational sites roll up here with policy overlays and shared app access.',
        label: 'Factories',
        meta: 'Mid scope',
        status: 'Delegated admins',
        tone: 'warning',
        value: 'Regional lanes',
      },
      {
        detail: 'Smallest managed human scope before device-level ownership begins.',
        label: 'Departments',
        meta: 'Leaf scope',
        status: 'Supervisor access',
        tone: 'warning',
        value: 'Team-level',
      },
      {
        detail: 'Devices inherit from placement but keep their own identity and token lifecycle.',
        label: 'Devices',
        meta: 'Asset node',
        status: 'Ops-managed',
        tone: 'critical',
        value: 'Token-bound',
      },
    ],
    boardTitle: 'Scope blueprint',
    description:
      'Hierarchy management is where the cloud data model turns into usable operations: placement, delegation, inheritance, and device ownership.',
    detailDescription:
      'This rail is ready for future creation flows, policy explainers, and audit snippets once the database model lands.',
    detailGroups: [
      {
        items: [
          { label: 'Ownership root', value: 'Headquarters' },
          { label: 'Operational tier', value: 'Factories' },
          { label: 'Team tier', value: 'Departments' },
        ],
        title: 'Managed lineage',
      },
      {
        items: [
          { label: 'Access model', value: 'Inherited with overrides' },
          { label: 'Asset placement', value: 'Device attached to dept' },
          { label: 'Future UI', value: 'List + inspector + audit' },
        ],
        title: 'Design intent',
      },
    ],
    detailTitle: 'Hierarchy rail',
    eyebrow: 'Org structure',
    footerLinks: [
      { href: '/users', label: 'Open scoped users' },
      { href: '/devices', label: 'Open device staging' },
    ],
    metrics: [
      {
        detail: 'Core structure the cloud app needs to re-establish.',
        label: 'Hierarchy levels',
        tone: 'nominal',
        value: '4',
      },
      {
        detail: 'Expected inheritance paths that later feed RBAC and ABAC decisions.',
        label: 'Permission cascades',
        tone: 'warning',
        value: 'Multi-tier',
      },
      {
        detail: 'Likely places where fine-grained overrides will matter first.',
        label: 'Override hotspots',
        tone: 'critical',
        value: 'Factories + apps',
      },
      {
        detail: 'Target UI interaction pattern for hierarchy editing.',
        label: 'Primary affordance',
        tone: 'warning',
        value: 'Drawer-driven',
      },
    ],
    note:
      'Hierarchy needs to be inspectable and comprehensible, not just editable. This placeholder is organized around that future requirement.',
    title: 'Placement and delegation map',
  },
  users: {
    actionNotes: [
      {
        detail:
          'Better Auth covers session and identity, but the permission model here still needs app-level and hierarchy-level controls.',
        label: 'Add scoped roles and grants without fighting the auth foundation.',
      },
      {
        detail:
          'The list should later support entitlement changes, app access toggles, and inheritance previews in one place.',
        label: 'Avoid separate screens for identity, scope, and app access if the operator loses context.',
      },
    ],
    boardDescription:
      'Operator roster placeholders for system admins and delegated hierarchy managers.',
    boardRows: [
      {
        detail: 'Platform-wide administrator with full control across hierarchy, apps, and policy.',
        label: 'System admin',
        meta: 'Global role',
        status: 'Full scope',
        tone: 'nominal',
        value: 'Root access',
      },
      {
        detail: 'Can manage users and app grants beneath a headquarter boundary.',
        label: 'HQ manager',
        meta: 'Scoped role',
        status: 'Delegated',
        tone: 'warning',
        value: 'Regional',
      },
      {
        detail:
          'Operational factory owner who should see only the apps and devices in that lane.',
        label: 'Factory manager',
        meta: 'Scoped role',
        status: 'Delegated',
        tone: 'warning',
        value: 'Site-specific',
      },
      {
        detail:
          'Department-level user with focused views into assigned apps and workflows.',
        label: 'Department operator',
        meta: 'Scoped user',
        status: 'Restricted',
        tone: 'critical',
        value: 'Least privilege',
      },
    ],
    boardTitle: 'Access roster',
    description:
      'This page is shaped for the future user-management workflow: list of people, scoped access, app grants, and a right-side summary of what their permissions actually mean.',
    detailDescription:
      'When the permission system arrives, this rail can show effective grants, inheritance sources, and change history without leaving the page.',
    detailGroups: [
      {
        items: [
          { label: 'Auth source', value: 'Better Auth + plugins' },
          { label: 'Future grants', value: 'RBAC + ABAC hybrid' },
          { label: 'App entitlement', value: 'Scoped per user' },
        ],
        title: 'Identity plan',
      },
      {
        items: [
          { label: 'Fast actions', value: 'Grant / revoke / inspect' },
          { label: 'Expected UX', value: 'Table + side inspector' },
          { label: 'Audit posture', value: 'Explain every inherited grant' },
        ],
        title: 'Operator needs',
      },
    ],
    detailTitle: 'Identity rail',
    eyebrow: 'Users and access',
    footerLinks: [
      { href: '/hierarchy', label: 'Review scope map' },
      { href: '/apps', label: 'Review app entitlements' },
    ],
    metrics: [
      {
        detail: 'Primary management bands requested in the new cloud app.',
        label: 'Admin bands',
        tone: 'nominal',
        value: 'System / HQ / Factory / Dept',
      },
      {
        detail: 'Future access decision ingredients beyond simple roles.',
        label: 'Policy dimensions',
        tone: 'warning',
        value: 'Role + scope + app',
      },
      {
        detail: 'Expected high-friction area once CRUD work begins.',
        label: 'Hardest problem',
        tone: 'critical',
        value: 'Effective grant explainability',
      },
      {
        detail: 'Visual interaction direction carried over from the new shell.',
        label: 'Management style',
        tone: 'warning',
        value: 'Dense operator console',
      },
    ],
    note:
      'The shell leaves room for a serious permission model instead of pretending user administration is just a profile list.',
    title: 'Identity, scope, and app access',
  },
} satisfies Record<'overview' | 'hierarchy' | 'users', AdminSectionContent>;

export { adminCoreSections };
