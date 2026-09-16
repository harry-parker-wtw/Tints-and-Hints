import { useEffect, useState } from 'react';
import { SHARED_PACKAGE_READY } from 'shared';

// Static shell for Prompt 1. No game logic yet — Prompts 2-12 replace
// the two placeholder panels below with the real grid, side panel,
// lobby, etc. The connection check at the bottom is temporary too, just
// to prove client <-> server wiring works before any real protocol
// exists (see server/src/index.ts).
//
// Note: the plain <button>/<div> below are hand-styled to sit for the
// real shadcn Button/Card until you run:
//   cd client && npx shadcn@latest add button card
// which will add src/components/ui/button.tsx etc. — swap these
// placeholders for the real components at that point.

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:8787';

type ConnectionStatus = 'connecting' | 'connected' | 'error';

function useServerPing() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  useEffect(() => {
    const socket = new WebSocket(SERVER_URL);

    socket.onopen = () => setStatus('connected');
    socket.onerror = () => setStatus('error');
    socket.onmessage = (event) => {
      console.log('server message:', event.data);
      setLastMessage(event.data);
    };

    return () => socket.close();
  }, []);

  return { status, lastMessage };
}

export default function App() {
  const { status, lastMessage } = useServerPing();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="font-display text-2xl">Tints and Hints</h1>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>Round 1 of 6</span>
          <button className="rounded-md border border-border bg-card px-3 py-1.5 text-foreground hover:bg-accent">
            Scores
          </button>
        </div>
      </header>

      <main className="flex flex-col gap-4 p-6 md:flex-row">
        <div className="flex min-h-[400px] flex-1 items-center justify-center rounded-md border border-dashed border-border md:w-[70%]">
          <p className="text-muted-foreground">the grid goes here</p>
        </div>

        <aside className="rounded-md border border-border bg-card p-4 md:w-[30%]">
          <p className="text-card-foreground">side panel goes here</p>
        </aside>
      </main>

      <footer className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
        shared package ready: {String(SHARED_PACKAGE_READY)} · server:{' '}
        {status}
        {lastMessage ? ` · last message: ${lastMessage}` : ''}
      </footer>
    </div>
  );
}
