# Style and Conventions

## Language
- TypeScript (Strict types where possible)

## Deno 2.x Patterns
- Use `jsr:` for standard library imports.
- Use `Deno.serve()` for HTTP serving.
- Use `URLPattern` for routing.

## Code Style
- Follow `deno fmt` standards.
- Prefer explicit interfaces for data structures (e.g., `LoadLine`).
- Use `Map` for state management in managers.

## Testing
- Use `Deno.test`.
- Test public interfaces (HTTP handler) as well as internal units.
- Boundary conditions and off-by-one errors are critical for queue logic.
