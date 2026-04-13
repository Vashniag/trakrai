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
  <main className="min-h-screen bg-[linear-gradient(180deg,#f7f7f2_0%,#ffffff_26%,#f3f4f6_100%)] px-6 py-8 md:px-10">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="space-y-2">
        <p className="text-xs font-medium tracking-[0.24em] text-neutral-500 uppercase">
          {eyebrow}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-neutral-600">{description}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="border-black/10 bg-white/90 shadow-[0_20px_70px_-45px_rgba(15,23,42,0.45)]">
          <CardHeader className="border-b border-black/10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl text-slate-950">{bridgeLabel}</CardTitle>
                <CardDescription className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  {bridgeDescription}
                </CardDescription>
              </div>
              <div className="border border-black/10 bg-slate-950 px-3 py-2 text-[11px] tracking-[0.2em] text-white uppercase">
                {bridgeStatus}
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 py-6 sm:grid-cols-2 xl:grid-cols-4">
            {detailItems.map((detail) => (
              <div key={detail.label} className="border border-black/10 bg-white p-4">
                <div className="text-[11px] tracking-[0.18em] text-slate-500 uppercase">
                  {detail.label}
                </div>
                <div className="mt-2 text-sm font-medium break-all text-slate-900">
                  {detail.value}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-black/10 bg-slate-950 text-white shadow-[0_18px_60px_-42px_rgba(15,23,42,0.8)]">
          <CardHeader className="border-b border-white/10">
            <CardTitle className="text-xl tracking-[-0.03em]">Shared client contract</CardTitle>
            <CardDescription className="text-white/65">
              The same React workspace, transport abstraction, and WebRTC flow runs on both cloud
              and edge.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 py-6">
            {contractNotes.map((note) => (
              <div
                key={note}
                className="border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/75"
              >
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
