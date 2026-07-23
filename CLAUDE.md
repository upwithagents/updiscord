# updiscord

Discord control-plane library for the up-ecosystem apps. See README.md for
what it does and the consumer API.

## Conventions

- **Identity**: this repo commits and pushes as `upwithagents`
  (repo-local git config; remote via the `github-upwithagents` SSH alias).
  Never use the `gh` CLI here — it authenticates as a different user.
- **Branches**: `up/<max-3-word-kebab>`.
- **No build step**: TS source is the published artifact; consumers run tsx.
  Keep `exports` in package.json pointing at `src/*.ts`.
- **No Prisma, no dotenv** in `src/*.ts` (the importable library — everything
  reachable through `package.json`'s `exports`). Storage goes through the
  `HubStore` interface (`src/types.ts`); config is passed in by the host.
  `bin/*.ts` is the exception: it's the CLI that runs self-hosted instances
  (`instances/<id>.json` + `.env.<id>`), so it plays the "host" role and is
  the one place in this repo allowed to depend on `dotenv`.
- Tests: vitest, colocated `*.test.ts`. `npm test` and `npm run typecheck`
  must both pass before any push.
- The adapter's stdout is reserved for MCP — adapter logging goes to stderr.
