import { LiveView } from './_components/live-view';

const LivePage = () => (
  <main className="flex min-h-screen flex-col items-center p-8">
    <h1 className="mb-8 text-3xl font-bold">Live Camera Feed</h1>
    <LiveView />
  </main>
);

export default LivePage;
