# Repository Guidelines

## Project Structure & Module Organization
- `app.ts` hosts the UI logic for parsing and rendering DTs; treat it as the entrypoint for bundling.
- `dts.ts` exposes parser utilities consumed by both the app and tests; keep shared logic here.
- `dts.test.ts` contains Bun-driven unit tests; mirror new parser features with targeted specs.
- `scripts/bundle.ts` assembles the self-contained `dist/index.html` and copies assets like `favicon.ico`.
- `.github/workflows/pages.yml` defines the Pages + preview pipeline; deploy output must remain in `dist/`.

## Build, Test, and Development Commands
- `bun run bundle` – build the minified, self-contained `dist/index.html` plus `favicon.ico`.
- `bun test` – run unit tests in `dts.test.ts` via `bun:test`; add `--watch` locally while iterating.
- `bun run server.ts` – serve `index.html` on http://localhost:6555 for manual checks.

## Coding Style & Naming Conventions
- Stick to TypeScript with Bun ESM imports; prefer descriptive function names (`parseDeviceTree`, etc.).
- Use 4-space indentation (existing files follow this) and trailing commas for multiline literals.
- Export shared types from `dts.ts`, and keep UI-only helpers scoped within `app.ts`.
- Inline comments sparingly; prefer self-explanatory code and update docstrings when behavior changes.

## Testing Guidelines
- Co-locate parser-focused tests in `dts.test.ts`; name cases with intent (e.g., `"captures phandle references"`).
- Cover new syntax branches before merging; aim for parity between parser features and tests.
- Run `bun test` before every PR; CI treats failures as blockers for deploy previews.

## Commit & Pull Request Guidelines
- Follow the existing short imperative style (e.g., `Inline bundle for PR previews`).
- Reference related issues in the body (`Closes #123`) and describe UI-facing changes with screenshots or preview links.
- Verify `bun run bundle` passes and attach the Pages preview URL in the PR description.
- Leave CI green; rerun failed jobs caused by intermittent Pages deploys before requesting review.
