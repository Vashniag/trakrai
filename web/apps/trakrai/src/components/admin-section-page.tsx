import Link from 'next/link';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';
import { cn } from '@trakrai/design-system/lib/utils';
import { ArrowUpRight, Clock3, ShieldAlert } from 'lucide-react';

import { adminCoreSections } from '@/components/admin-section-data-core';
import { adminOpsSections } from '@/components/admin-section-data-ops';
import { toneClasses } from '@/components/admin-types';

import type { ActionNote, AdminMetric, AdminSectionContent, DetailGroup, OperationsRow } from '@/components/admin-types';

const adminSections = {
  ...adminCoreSections,
  ...adminOpsSections,
};

type AdminSectionKey = keyof typeof adminSections;

const SectionMetricCard = ({ metric }: { metric: AdminMetric }) => (
  <Card className="border-primary/10 bg-card/80" size="sm">
    <CardHeader className="border-b border-border/70">
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.26em] text-primary uppercase">
        {metric.label}
      </CardDescription>
      <CardTitle className="text-xl text-foreground">{metric.value}</CardTitle>
    </CardHeader>
    <CardContent className="pt-3 text-xs text-muted-foreground">{metric.detail}</CardContent>
    <CardFooter className="border-border/70 pt-3">
      <span
        className={cn(
          'border px-2 py-1 text-[0.6rem] tracking-[0.18em] uppercase',
          toneClasses[metric.tone],
        )}
      >
        {metric.tone}
      </span>
    </CardFooter>
  </Card>
);

const SectionOperationsCard = ({
  description,
  rows,
  title,
}: {
  description: string;
  rows: OperationsRow[];
  title: string;
}) => (
  <Card className="border-primary/10 bg-card/85">
    <CardHeader className="border-b border-border/70">
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.26em] text-primary uppercase">
        {title}
      </CardDescription>
      <CardTitle className="text-xl text-foreground">Primary lane overview</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="divide-y divide-border/70 px-0">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-3 px-4 py-4 lg:grid-cols-[1.2fr_0.8fr_0.7fr_auto]">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{row.label}</p>
              <span className="border border-border/70 px-2 py-0.5 text-[0.6rem] tracking-[0.18em] text-muted-foreground uppercase">
                {row.meta}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{row.detail}</p>
          </div>
          <div className="flex items-center text-xs text-muted-foreground">{row.status}</div>
          <div className="flex items-center text-sm font-medium text-foreground">{row.value}</div>
          <div className="flex items-center justify-start lg:justify-end">
            <span
              className={cn(
                'border px-2 py-1 text-[0.6rem] tracking-[0.18em] uppercase',
                toneClasses[row.tone],
              )}
            >
              {row.tone}
            </span>
          </div>
        </div>
      ))}
    </CardContent>
  </Card>
);

const SectionActionsCard = ({ notes }: { notes: ActionNote[] }) => (
  <Card className="border-primary/10 bg-card/80">
    <CardHeader className="border-b border-border/70">
      <CardDescription className="text-[0.65rem] font-semibold tracking-[0.26em] text-primary uppercase">
        Operator notes
      </CardDescription>
      <CardTitle className="text-xl text-foreground">What this page is preparing for</CardTitle>
      <CardDescription>
        These notes are intentionally practical so future CRUD, API, and e2e work can land into a stable shell.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 pt-4">
      {notes.map((note) => (
        <div key={note.label} className="border border-border/70 bg-background/55 p-3">
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 size-4 text-primary" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{note.label}</p>
              <p className="text-xs text-muted-foreground">{note.detail}</p>
            </div>
          </div>
        </div>
      ))}
    </CardContent>
  </Card>
);

const SectionDetailRail = ({
  description,
  footerLinks,
  groups,
  note,
  title,
}: {
  description: string;
  footerLinks: AdminSectionContent['footerLinks'];
  groups: DetailGroup[];
  note: string;
  title: string;
}) => (
  <div className="space-y-4 xl:sticky xl:top-30">
    <Card className="border-primary/20 bg-[linear-gradient(180deg,rgba(247,197,60,0.09),rgba(17,19,21,0.95))]">
      <CardHeader className="border-b border-primary/20">
        <CardDescription className="text-[0.65rem] font-semibold tracking-[0.26em] text-primary uppercase">
          {title}
        </CardDescription>
        <CardTitle className="text-xl text-foreground">Detail and handoff</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {groups.map((group) => (
          <div key={group.title} className="space-y-2 border border-border/70 bg-background/60 p-3">
            <p className="text-[0.65rem] font-semibold tracking-[0.24em] text-primary uppercase">
              {group.title}
            </p>
            <div className="space-y-2">
              {group.items.map((item) => (
                <div
                  key={`${group.title}-${item.label}`}
                  className="flex items-start justify-between gap-3 text-xs"
                >
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="max-w-[180px] text-right text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
      <CardFooter className="border-primary/20">
        <div className="flex items-start gap-3 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 text-primary" />
          <p>{note}</p>
        </div>
      </CardFooter>
    </Card>

    <Card className="border-border/80 bg-card/80">
      <CardHeader className="border-b border-border/70">
        <CardDescription className="text-[0.65rem] font-semibold tracking-[0.26em] text-primary uppercase">
          Quick links
        </CardDescription>
        <CardTitle className="text-lg text-foreground">Next routes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {footerLinks.map((link) => (
          <Link
            key={link.href}
            className="flex items-center justify-between border border-border/70 bg-background/55 px-3 py-3 text-sm text-foreground transition-colors hover:border-primary/30 hover:bg-background"
            href={link.href}
          >
            <span>{link.label}</span>
            <ArrowUpRight className="size-4 text-primary" />
          </Link>
        ))}
      </CardContent>
    </Card>
  </div>
);

const AdminSectionPage = ({ section }: { section: AdminSectionKey }) => {
  const content = adminSections[section];

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
        <Card className="border-primary/15 bg-card/85">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.68rem] font-semibold tracking-[0.28em] text-primary uppercase">
              {content.eyebrow}
            </CardDescription>
            <CardTitle className="text-3xl text-foreground sm:text-4xl">{content.title}</CardTitle>
            <CardDescription className="max-w-3xl text-sm">{content.description}</CardDescription>
          </CardHeader>
        </Card>

        <Card className="border-primary/15 bg-card/80">
          <CardHeader className="border-b border-border/70">
            <CardDescription className="text-[0.65rem] font-semibold tracking-[0.26em] text-primary uppercase">
              Console brief
            </CardDescription>
            <CardTitle className="text-lg text-foreground">Why this screen exists</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-sm text-muted-foreground">{content.note}</CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {content.metrics.map((metric) => (
          <SectionMetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.65fr)]">
        <div className="space-y-4">
          <SectionOperationsCard
            description={content.boardDescription}
            rows={content.boardRows}
            title={content.boardTitle}
          />
          <SectionActionsCard notes={content.actionNotes} />
        </div>

        <SectionDetailRail
          description={content.detailDescription}
          footerLinks={content.footerLinks}
          groups={content.detailGroups}
          note={content.note}
          title={content.detailTitle}
        />
      </section>
    </div>
  );
};

export { AdminSectionPage };
export type { AdminSectionKey };
