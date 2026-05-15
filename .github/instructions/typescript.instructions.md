---
applyTo: '**/*.ts'
---

# PrintBit — TypeScript conventions

## Overview & Prioritized Checklist

Follow these top-level priorities when adding or modifying TypeScript code:

1. Safety first: prefer explicit types and avoid `any`.
2. Keep imports and module boundaries clear (use path aliases when available).
3. Keep runtime behavior stable: do not change sync I/O behavior without a documented migration plan.
4. Centralize error handling and ensure route handlers surface typed errors.

When rules conflict, resolve by the following precedence (highest → lowest):

1. Safety (prevent security/integrity issues)
2. Type safety (avoid `any`, explicit types)
3. Runtime stability (preserve existing behavior unless migrated)
4. Module/import boundaries
5. Error handling patterns

Example: if safety conflicts with runtime behavior stability, prioritize safety and document the rationale in the project tracker.

## Compiler target

- `tsconfig.json` governs all options. Do not change compiler options inline.
- Flag `--ignoreDeprecations 6.0` is required; this is already in the type-check command.

### Deprecated features

- For deprecated TypeScript features: avoid new usage where possible. If an existing feature is deprecated and cannot be removed immediately, document the usage and file a replacement plan in the project tracker (create an issue or PR that references the code location and proposed replacement). Include the issue/PR link as a comment near the usage.

- For third-party library deprecations: document the impact (which modules/functions are affected), add a risk assessment to the tracking issue, and create a migration plan with an estimated effort and test plan. Flag high-risk deprecations for maintainer review.

## Type safety

- Prefer explicit return types on exported functions and service methods.
- Avoid `any`; use `unknown` with narrowing, or define a proper interface.
- Use `satisfies` where a value must conform to a type without widening.

## Imports and module boundaries

- Use path aliases defined in `tsconfig.json` — do not use relative `../../` chains longer than 2 levels.
- If path aliases are not defined, fall back to relative imports with a maximum of 2 directory levels until aliases are configured, and add a short TODO comment linking to the issue tracking alias configuration.
- Do not import route handler files from `src/routes/` inside `src/services/` or `src/core/`.
  - Importing shared types, interfaces, or helper utilities from `src/routes/` is only allowed after those artifacts have been moved into a shared location such as `src/utils/` or `src/core/types/`.

- If relative imports would exceed two directory levels and path aliases are unavailable, create a tracking issue and consult the team lead for guidance; temporarily adding a clear `// TODO: use path alias` comment pointing to the issue is acceptable until aliases are implemented.

## Async patterns and I/O

- All Express route handlers that perform async work must be wrapped or use an async-aware error handler.
- Prefer `async/await` over raw Promise chains for readability.
- Serial I/O and SQLite queries are synchronous in many current paths — preserve that behavior unless a migration plan is documented and approved in the project tracker. An "explicit migration" means:
- Serial I/O and SQLite queries are synchronous in many current paths — preserve that behavior unless a migration plan is documented and explicitly approved in the project tracker. An "explicit migration" means:

1.  A tracking issue or PR that describes the change, migration steps, and test plan.
2.  Explicit approval by the team lead or a designated maintainer (via PR review/merge or an explicit sign-off comment on the issue/PR).

Only after the above is in place may synchronous behaviors be replaced with async equivalents.

## Error handling

- Service-layer errors should be typed (custom error classes or discriminated unions) — do not throw raw strings.
- Route handlers must not let unhandled rejections surface to Express's default error page in production paths.

## Socket.IO types

- Define event payload types for both server-emitted and client-emitted events.
- Keep event name constants in a shared location rather than inline string literals.

## File placement

- New service → `src/services/<name>.ts`
- New repository → `src/core/database/<name>-repository.ts`
- New route file → `src/routes/<name>.ts`, registered in the central route loader
- New shared utility → `src/utils/<name>.ts`
- New browser TypeScript → `src/public/<page>/` (built via `pnpm run build`)

## Notes

- When adding exceptions to these rules, document the rationale and link to the tracking issue or PR so reviewers can verify the decision.
