type MetricTone = 'critical' | 'nominal' | 'warning';

type AdminMetric = {
  detail: string;
  label: string;
  tone: MetricTone;
  value: string;
};

type OperationsRow = {
  detail: string;
  label: string;
  meta: string;
  status: string;
  tone: MetricTone;
  value: string;
};

type ActionNote = {
  detail: string;
  label: string;
};

type DetailGroup = {
  items: Array<{
    label: string;
    value: string;
  }>;
  title: string;
};

type AdminSectionContent = {
  actionNotes: ActionNote[];
  boardDescription: string;
  boardRows: OperationsRow[];
  boardTitle: string;
  description: string;
  detailDescription: string;
  detailGroups: DetailGroup[];
  detailTitle: string;
  eyebrow: string;
  footerLinks: Array<{
    href: string;
    label: string;
  }>;
  metrics: AdminMetric[];
  note: string;
  title: string;
};

const toneClasses: Record<MetricTone, string> = {
  critical: 'border-rose-500/25 bg-rose-500/10 text-rose-200',
  nominal: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
  warning: 'border-primary/25 bg-primary/10 text-primary',
};

export { toneClasses };
export type { ActionNote, AdminMetric, AdminSectionContent, DetailGroup, MetricTone, OperationsRow };
