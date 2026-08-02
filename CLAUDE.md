# CLAUDE.md

This file is an **index**, not a manual. It is loaded into context every session,
so it stays small; the detail lives in `docs/`, which you read on demand.

## Keeping the docs true

**A wrong line in `docs/` misleads every future run.** Treat documentation as part
of the work, not a report about it. Before you finish any task:

1. **Re-read whatever `docs/` sections your change touched, and fix what it made
   false.** A subsystem you reworked, a behaviour you inverted, a helper you
   renamed or deleted — if a doc describes it, that doc is now stale. A
   confidently wrong invariant costs more than no invariant at all.
2. **Only add genuinely load-bearing facts.** Invariants that fail silently,
   conventions that bite, decisions whose rationale is not recoverable from the
   code. Not API summaries, not change logs, not anything `git log` or the code
   already says plainly. The bar is high.
3. **Never cite line numbers — name the symbol.** Write `collectRoadJunctionFills`,
   not `GameCanvas.tsx:800`. Any edit above a line invalidates a line number and
   sends the next reader to the wrong code; symbol names survive and are greppable.
4. **Keep this file under 80 lines and each `docs/` file under 250.** If something
   new deserves a place and a file is full, cut what has stopped earning its place.
5. **Prefer a code comment.** This repo leans on long explanatory headers, and a
   fact next to the code it governs cannot drift. `docs/` is for what spans files.

The same duty points outward. **Update code comments your change invalidates** — a
comment describing behaviour the code no longer has is worse than none. **Update
`README.md`** whenever player-facing scope moves: modes, cities, controls, saves,
the asset caveats.

## Commands

```bash
npm run dev          # vinext dev + Miniflare on :3000 (NOT `next dev`)
npm run build        # -> dist/client + dist/server
npm run typecheck    # ~3s
npm run lint         # ~11s, currently 0 errors / 0 warnings — keep it that way
npm test             # 86 files, ~1490 tests, ~2min

# the loop you actually iterate on: everything but the acceptance sweep, ~12s
npx vitest run --exclude "tests/trafficSafetyAcceptance.test.ts" --exclude "**/node_modules/**"
```

Node >= 22.13. **There is no CI** — nothing runs test/lint/typecheck unless you do.

## Two things to know before reading any file

- **`lesson` does not mean a lesson.** The game pivoted from a driving curriculum
  to an open-world gig driver, but the vocabulary survives: `GameCanvasLesson` is
  the runtime scenario contract and the only kind left is `"free_drive"`. Details
  and the surviving vestigial branches: [docs/architecture.md](docs/architecture.md).
- **Dependency arrows only point inward**, and `simulation.ts` imports nothing but
  its own types. Breaking that breaks the determinism the whole design rests on.

## Where to read next

| Read this | When you are about to |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Add a module, move a responsibility between rings, or delete a subsystem |
| [docs/simulation-core.md](docs/simulation-core.md) | Touch `simulation.ts` / `simulationAdapter.ts`, change NPC behaviour, or add/reprice a `RuleCode` or a fine |
| [docs/map-authoring.md](docs/map-authoring.md) | Edit `content.ts` / `londonContent.ts` / `cairoContent.ts`, add a city, or change a road's shape, width or speed limit |
| [docs/economy.md](docs/economy.md) | Change what work appears, what it pays, what anything costs, or what persists to `localStorage` |
| [docs/rendering.md](docs/rendering.md) | Touch `GameCanvas.tsx`, world geometry, water, models, the crowd, the cockpit/mirrors, or anything performance-shaped |
| [docs/greenery.md](docs/greenery.md) | Touch grass, a park lawn, park paths or planting — or add a park |
| [docs/drive-hud.md](docs/drive-hud.md) | Touch `DriveHud` / `TouchDriveControls` / either map, or position any overlay on the drive screen |
| [docs/audio.md](docs/audio.md) | Touch `app/game/audio/`, or anything that starts a drive |
| [docs/testing.md](docs/testing.md) | Write or debug a test — especially a jsdom one, or one that imports `GameCanvas` |
| [docs/build-and-deploy.md](docs/build-and-deploy.md) | Touch `vite.config.ts`, `worker/`, the prerender, `netlify.toml`, or page metadata |
| [CREDITS.md](CREDITS.md) | Add, replace or modify an imported `.glb` — every asset's licence and provenance is logged there |
| [public/map-data/README.md](public/map-data/README.md) | Regenerate the frozen OSM extracts (never hand-edit them) |
