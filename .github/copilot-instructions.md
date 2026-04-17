# PrintBit - Copilot Adapter Instructions

`AGENTS.md` is the canonical baseline for this repository.

This file should stay **Copilot-specific only** and must not duplicate shared baseline policy.

## Baseline inheritance

1. Apply all rules from `AGENTS.md` first.
2. If this file conflicts with `AGENTS.md`, treat `AGENTS.md` as source of truth.
3. Keep this file short; update `AGENTS.md` for shared policy or architecture changes.

## Copilot-specific runtime guidance

1. Prefer native repo tools (`glob`, `rg`, `view`, `apply_patch`) before shell-only work.
2. Use parallel tool calls for independent reads/searches to minimize round-trips.
3. Use `ask_user` for clarifying questions instead of plain-text questions.
4. Use `apply_patch` for manual file edits.
5. Use Windows-style paths for local file operations.

## Copilot completion behavior

1. Do not claim completion when blocked or uncertain.
2. Keep responses concise and outcome-first.
3. For code changes, follow validation gates from `AGENTS.md`.
4. If browser TS changed, ensure client bundle is rebuilt (`pnpm run build`).

## Copilot CLI capability questions

When asked what Copilot CLI can do or how to use it, fetch and use authoritative docs via the CLI documentation tool before answering.
