'use client';

import type { ReactNode } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

export type LiveConsoleShellDetailItem = Readonly<{
  label: string;
  value: ReactNode;
}>;

export type LiveConsoleShellProps = Readonly<{
  bridgeDescription: string;
  bridgeLabel: string;
  bridgeStatus: string;
  children: ReactNode;
  contractNotes: readonly string[];
  controls?: ReactNode;
  description: string;
  detailItems: readonly LiveConsoleShellDetailItem[];
  eyebrow: string;
  navigation?: ReactNode;
  title: string;
}>;

export const LiveConsoleShell = ({
  bridgeDescription,
  bridgeLabel,
  bridgeStatus,
  children,
  contractNotes,
  controls,
  description,
  detailItems,
  eyebrow,
  navigation,
  title,
}: LiveConsoleShellProps) => (
  <main className="bg-background min-h-screen px-6 py-8 md:px-10">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.24em] uppercase">
              {eyebrow}
            </p>
            <h1 className="text-foreground mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{description}</p>
          </div>
          <div className="space-y-2 text-right">
            <div className="border-primary/30 bg-primary/10 text-primary inline-flex px-3 py-2 text-[11px] tracking-[0.2em] uppercase">
              {bridgeLabel}
            </div>
            <div className="text-muted-foreground text-xs">{bridgeStatus}</div>
          </div>
        </div>
      </section>

      {navigation}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">{children}</div>

        <aside className="space-y-4">
          <Card className="border">
            <CardHeader className="border-b">
              <CardTitle>Transport bridge</CardTitle>
              <CardDescription>{bridgeDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 py-4">
              {detailItems.map((item) => (
                <div
                  key={item.label}
                  className="border-border/80 flex items-start justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                    {item.label}
                  </div>
                  <div className="max-w-[14rem] text-right text-sm break-all">{item.value}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          {controls}

          <Card className="border">
            <CardHeader className="border-b">
              <CardTitle>Contract notes</CardTitle>
              <CardDescription>
                Shared expectations for transport and route behavior.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 py-4">
              {contractNotes.map((note) => (
                <p key={note} className="text-muted-foreground text-sm">
                  {note}
                </p>
              ))}
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  </main>
);
