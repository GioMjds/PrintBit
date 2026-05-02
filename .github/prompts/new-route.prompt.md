# Scaffold a new PrintBit route

## When to use

Use this prompt when you need to add a new HTTP route (page or API) to PrintBit.

## Instructions

You are scaffolding a new route for PrintBit following its existing conventions.

**Required inputs:**

- Route path (e.g., `/api/scan/status`)
- HTTP method(s) (GET / POST / etc.)
- Whether this is a page route (returns HTML) or an API route (returns JSON)
- What the route does (brief description)

**Steps to follow:**

1. **Read first:**
   - `src/server.ts` to understand route loader registration
   - `src/routes/` to find the right existing file to extend, or confirm a new file is needed
   - The relevant service in `src/services/` if the route calls existing logic

2. **Create or extend the route file** in `src/routes/`:
   - Export a named router
   - Add JSDoc comment describing the route's purpose, params, and response shape
   - Call a service method — do not put business logic in the handler
   - Wrap async handlers with error forwarding

3. **Create or extend a service** in `src/services/` if new logic is needed:
   - Service must not import from `src/routes/`
   - Add explicit return type

4. **Register the route** in the central route loader (check `src/server.ts` or the route index file)

5. **Run validation:**

   ```bash
   pnpm exec tsc --noEmit --ignoreDeprecations 6.0
   ```

6. **Update `API_DOCUMENTATION.md`** with the new route's method, path, auth requirements, request body, and response shape.

## Output format

Produce:

- The route handler code (in `src/routes/<file>.ts`)
- Any new service method code (in `src/services/<file>.ts`)
- The registration line for `src/server.ts` or the route loader
- The `API_DOCUMENTATION.md` entry
