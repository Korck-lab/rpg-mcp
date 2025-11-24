# Unified MCP Simulation Server

A deterministic, schema-driven RPG simulation server built with TypeScript and Test-Driven Development.

## Features

- **Deterministic World Generation**: Reproducible worlds from seeds
- **Schema-Driven Development**: All data validated with Zod schemas
- **SQLite Persistence**: Robust storage layer with full CRUD operations
- **Test-Driven**: Every feature built test-first
- **Type-Safe**: Strict TypeScript with comprehensive type checking

## Project Structure

```
src/
  schema/          # Zod schemas for all data types
  storage/         # SQLite persistence layer
    migrations/    # Database schema definitions
    repos/         # Repository pattern implementations
tests/
  schema/          # Schema validation tests
  storage/         # Storage layer tests
reference/
  azgaar/          # Reference implementation (not our code)
```

## Development

### Setup

```bash
npm install
```

### Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

### Building

```bash
npm run build
```

## Principles

1. **Determinism First**: Identical seeds produce identical outputs
2. **Schema-Driven**: All boundaries validated via Zod
3. **TDD-Driven**: Tests before implementation
4. **Zero Hidden State**: All state explicit and serializable
5. **Replayable**: Every operation logged deterministically

## License

ISC
