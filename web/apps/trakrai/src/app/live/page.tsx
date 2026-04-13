import { LiveView } from './_components/live-view';

const LivePage = () => (
  <main className="min-h-screen bg-[linear-gradient(180deg,#f7f7f2_0%,#ffffff_26%,#f3f4f6_100%)] px-6 py-8 md:px-10">
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="space-y-2">
        <p className="text-xs font-medium tracking-[0.24em] text-neutral-500 uppercase">
          TrakrAI Cloud Operations
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">
              Live camera feed
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-neutral-600">
              Hardened live view for device testing, quick camera switching, and real-time WebRTC
              diagnostics.
            </p>
          </div>
        </div>
      </section>

      <LiveView />
    </div>
  </main>
);

export default LivePage;
