# web

TypeScript workspace for the phone/tablet side of GuitarMR (ADR-009):
digitizing handwritten score PDFs into gts files and viewing them. Practice
happens in the Quest app; the `.gts.json` next to the PDF is the hand-off.

| Package | Purpose |
| --- | --- |
| [`@guitarmr/gts`](packages/gts) | Types generated from `schemas/gts.schema.json`, validation, helpers |
| [`@guitarmr/layoutscan`](packages/layoutscan/README.md) | Layout detection (orientation, systems, measure regions) + Node CLI |
| [`@guitarmr/samples`](packages/samples/README.md) | Public-domain sample scores, engraver and end-to-end tests |
| [`@guitarmr/demo`](packages/demo/README.md) | Single-file browser demo: pick a PDF, detect measures on the device, save the layout layer |

The PWA itself is the next step (see docs/project).

## Setup

Requires Node 26 (the latest stable line; the exact version is pinned in
`.node-version` for nvm/fnm/volta/setup-node) and pnpm 10 (`corepack
enable` provides the pinned pnpm). TypeScript runs directly on Node (type
stripping); `engine-strict` makes `pnpm install` refuse older Node.

```sh
cd web
pnpm install
pnpm test        # all packages (Node's built-in test runner, node:test)
pnpm typecheck   # all packages (tsc)
```

After changing `schemas/gts.schema.json`, regenerate the types with
`pnpm --filter @guitarmr/gts generate` (fetches json-schema-to-typescript
on demand through `pnpm dlx`; it is not a dependency).

## Dependency policy

Every dependency is a vulnerability-maintenance cost, so the workspace
keeps them to what cannot reasonably be written by hand:

| Dependency | Where | Why |
| --- | --- | --- |
| `pdfjs-dist` | runtime (the only one the PWA ships) | Rendering PDFs to pixels in the browser |
| `@napi-rs/canvas` | dev (Node tools and tests only) | A canvas for pdf.js and for drawing samples in Node |
| `ajv` | dev (`@guitarmr/gts/validate`, tests and tools) | Schema validation |
| `typescript`, `@types/node` | dev | Type checking |

Tests use `node:test`/`node:assert` and scripts run with plain `node`
(no test framework, no TS runner). Versions are pinned exactly
(`save-exact`), `minimumReleaseAge` only accepts versions published at
least 7 days ago, and no dependency may run install scripts
(`onlyBuiltDependencies: []`). When the pinned `@types/node` or others are
bumped, pick a version older than 7 days or the install is rejected;
`@types/node` follows the Node major in `.node-version`.
