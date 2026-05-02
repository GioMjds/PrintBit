# Scaffold a new PrintBit domain service

## When to use

Use this prompt when you need a new service module in `src/services/` — e.g., a new hardware integration,
a new business flow, or extracting logic from an existing bloated service.

## Instructions

You are creating a new domain service for PrintBit.

**Required inputs:**

- Service name (e.g., `ink-monitor`, `copy-session`, `scan-queue`)
- What domain problem it solves
- What existing services or repositories it depends on

**Steps to follow:**

1. **Read first:**
   - `src/services/` — find the closest existing service for pattern reference
   - `src/core/database/` — identify which repositories this service will use
   - `src/server.ts` — understand service initialization order (some services are singletons)

2. **Create `src/services/<name>.ts`:**
   - Export a class or a set of named functions (match the pattern of adjacent services)
   - Add JSDoc on each exported function/method
   - Use explicit TypeScript return types
   - Import only from `src/core/`, `src/utils/`, or other `src/services/` — never from `src/routes/`

3. **If the service emits Socket.IO events:**
   - Accept the `io` instance as a constructor param or function param
   - Document event names and payload shapes in a comment block

4. **If the service manages serial/hardware state:**
   - Guard against concurrent access (serial port is shared)
   - Do not open a new serial port connection; use the existing `src/services/serial*.ts` pattern

5. **Wire up the service** in `src/server.ts` or the relevant initializer — follow existing singleton patterns

6. **Run validation:**

   ```bash
   pnpm exec tsc --noEmit --ignoreDeprecations 6.0
   ```

7. **Update `ARCHITECTURE.md`** if this service introduces a new flow or owns a new domain boundary.

## Output format

Produce:

- `src/services/<name>.ts` (full implementation)
- Wiring snippet for `src/server.ts`
- `ARCHITECTURE.md` delta (if applicable)
