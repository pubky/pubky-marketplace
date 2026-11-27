# `src/test/mocks/`

**Callable mocks that match the shape of a real module.**

These mocks supply predictable data and behavior for Market components and browser tests.
Use production types for their inputs and outputs.

## Why a separate folder

- **Decouples the data from the contract.** `fixtures/` tells you _what_ exists
  in the test world. `mocks/` tells you _how callers reach that world_. Mixing
  the two in one file makes it impossible to swap the contract layer (e.g.
  changing which module the mock targets, or moving from a hook-level mock to
  an Application-level one) without rewriting fixtures too.
- **Production-type-checked.** `dashboardTableMock` derives its listing type from `toListingTableRow`. That
  causes incompatible changes in the production mapper to break the mock at
  compile time, before any test runs. Loose `vi.fn()` mocks scattered through
  test files don't get this safety.
- **Single source of mock behavior.** When ten tests need the same listing table,
  they all import the same mock — so a fixture change propagates without
  touching ten files.

## Conventions

- File name matches the module being mocked (for example, `dashboard-table.ts`).
- Mutating methods (`commitCreate`, `persist`, etc.) are deliberately omitted
  unless a test exercises them. Reaching an unimplemented method should throw
  loudly so that "I rendered something I didn't mean to" surfaces immediately.
- Mocks read fixtures, not the other way around. A fixture must never import
  from `mocks/`.
