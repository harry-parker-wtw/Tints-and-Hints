# Tints and Hints

A real-time, online color-guessing party game. Monorepo with three npm
workspaces:

```
/client   Vite + React + TypeScript + Tailwind + shadcn/ui (dark theme)
/server   Node + TypeScript + ws — the authoritative game server
/shared   Game types + the pure reducer, imported by both
```

This is the Prompt 1 scaffold from the build plan — folder structure,
config, and a minimal "does it connect" check between client and server.
Everything from Prompt 2 onward (the actual game logic, grid, pawns,
card stack, etc.) gets built on top of this in Claude Code.

## First-time setup

This environment can't reach the npm registry, so `node_modules` has
not been installed anywhere in here yet. On your own machine, with
normal internet access:

```bash
npm install
```

at the repo root will install all three workspaces via npm workspaces.

Then, one extra manual step for shadcn/ui (its CLI needs to fetch
component source, which this environment also can't do):

```bash
cd client
npx shadcn@latest add button card input badge sheet alert
```

`components.json` is already set up (dark theme, correct aliases), so
`shadcn add` will drop components straight into `src/components/ui`
matching our token setup.

## Running it locally

```bash
npm run dev
```

runs the client (Vite dev server) and the server (ws server, via
tsx watch) side by side. Open the client's printed localhost URL.

## Deploying

- **client → Vercel.** Connect the GitHub repo, set the project root to
  `client/`. `vercel.json` is already configured for a static Vite
  build. Add one environment variable, `VITE_SERVER_URL`, pointing at
  the deployed server's `wss://` URL once that exists.
- **server → Render.** Connect the same GitHub repo as a new Web
  Service, set the root to `server/`. `render.yaml` describes the
  build/start commands. Render's free tier can cold-sleep after
  inactivity — the first connection after a quiet spell will take a
  few extra seconds.
