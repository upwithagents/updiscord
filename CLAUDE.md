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
- **No Prisma, no dotenv** in this library. Storage goes through the
  `HubStore` interface (`src/types.ts`); config is passed in by the host.
- Tests: vitest, colocated `*.test.ts`. `npm test` and `npm run typecheck`
  must both pass before any push.
- The adapter's stdout is reserved for MCP — adapter logging goes to stderr.
