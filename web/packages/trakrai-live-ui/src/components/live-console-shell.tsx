'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@trakrai/design-system/components/card';

type LiveConsoleDetail = Readonly<{
  label: string;
  value: string;
}>;

export type LiveConsoleShellProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  bridgeLabel: string;
  bridgeDescription: string;
  bridgeStatus: string;
  detailItems: readonly LiveConsoleDetail[];
  contractNotes: readonly string[];
  children: React.ReactNode;
}>;

export const LiveConsoleShell = ({
  bridgeDescription,
  bridgeLabel,
  bridgeStatus,
  children,
  contractNotes,
  description,
  detailItems,
  eyebrow,
  title,
}: LiveConsoleShellProps) => (
  <main className="bg-background min-h-screen px-6 py-8 md:px-10">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.24em] uppercase">
          {eyebrow}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-foreground text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{description}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl">{bridgeLabel}</CardTitle>
                <CardDescription className="mt-2 max-w-2xl text-sm leading-6">
                  {bridgeDescription}
                </CardDescription>
              </div>
              <div className="bg-muted text-muted-foreground border px-3 py-2 text-[11px] tracking-[0.2em] uppercase">
                {bridgeStatus}
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 py-6 sm:grid-cols-2 xl:grid-cols-4">
            {detailItems.map((detail) => (
              <div key={detail.label} className="bg-card border p-4">
                <div className="text-muted-foreground text-[11px] tracking-[0.18em] uppercase">
                  {detail.label}
                </div>
                <div className="text-foreground mt-2 text-sm font-medium break-all">
                  {detail.value}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border">
          <CardHeader className="border-b">
            <CardTitle className="text-xl tracking-[-0.03em]">Shared client contract</CardTitle>
            <CardDescription>
              The same React workspace, transport abstraction, and WebRTC flow runs on both cloud
              and edge.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 py-6">
            {contractNotes.map((note) => (
              <div key={note} className="bg-muted border p-4 text-sm leading-6">
                {note}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {children}
    </div>
  </main>
);
