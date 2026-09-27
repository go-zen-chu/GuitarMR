# web

TypeScript workspace for the phone/tablet side of GuitarMR (ADR-009):
digitizing handwritten score PDFs into gts files and viewing them. Practice
happens in the Quest app; the `.gts.json` next to the PDF is the hand-off.

| Package | Purpose |
| --- | --- |
| [`@guitarmr/gts`](packages/gts) | Types generated from `schemas/gts.schema.json`, validation, helpers |
| [`@guitarmr/layoutscan`](packages/layoutscan/README.md) | Layout detection (orientation, systems, measure regions) + Node CLI |
| [`@guitarmr/samples`](packages/samples/README.md) | Public-domain sample scores, engraver and end-to-end tests |

The PWA itself is the next step (see docs/project).

## Setup

Requires Node 22+ and pnpm 10 (`corepack enable` provides the pinned pnpm).

```sh
cd web
pnpm install
pnpm test        # all packages (vitest)
pnpm typecheck   # all packages (tsc)
```

After changing `schemas/gts.schema.json`, regenerate the types with
`pnpm --filter @guitarmr/gts generate`.
