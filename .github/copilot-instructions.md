# GitHub Copilot Instructions

Follow [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

Key rules:

- Spec first: create/update `specs/NNN-*.md` before behavior changes.
- Server-authoritative: game rules live in `server/`, not `src/`.
- Validate external input with zod; never trust client fields.
- Keep private data per-player; do not broadcast words, hands, or photos.
- Tests: `tests/*.test.ts`; protocol smoke: `scripts/smoke.mjs`; UI e2e: `e2e/run.mjs`.
- Run `pnpm verify` before proposing a change.
- Do not edit generated output (`dist/`, `release/`, `electron/app/`).
