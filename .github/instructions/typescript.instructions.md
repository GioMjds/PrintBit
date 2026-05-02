---
applyTo: '**/*.ts'
---

# PrintBit — TypeScript conventions

## Compiler target

- `tsconfig.json` governs all options. Do not change compiler options inline.
- Flag `--ignoreDeprecations 6.0` is required; this is already in the type-check command.

## Type safety

- Prefer explicit return types on exported functions and service methods.
- Avoid `any`; use `unknown` with narrowing, or define a proper interface.
- Use `satisfies` where a value must conform to a type without widening.

## Imports

- Use path aliases defined in `tsconfig.json` — do not use relative `../../` chains longer than 2 levels.
- Do not import from `src/routes/` inside `src/services/` or `src/core/`.

## Async patterns

- All Express route handlers that perform async work must be wrapped or use an async-aware error handler.
- Prefer `async/await` over raw Promise chains for readability.
- Serial I/O and SQLite queries are synchronous in many current paths — preserve that unless explicitly migrating.

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
