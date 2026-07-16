# Testing Without Mocks

This repository forbids mocks. Exercise behavior through public interfaces using
real implementations, including at system boundaries.

Use:

- Real test databases or locally runnable database engines
- Real temporary directories and filesystems
- Real owned services started for the test
- Real third-party sandbox environments where available
- Deterministic inputs and explicit configuration

Do not use:

- Mocking frameworks
- Stubbed or fake collaborators
- In-memory adapters that behave differently from production
- Recorded responses presented as a live dependency
- Assertions about collaborator calls, counts, or ordering

## External systems

Prefer an integration test against the provider's real sandbox. If no safe,
repeatable sandbox exists, test the code up to the external seam with real local
components and document that the provider interaction needs a separate contract
or smoke check. Do not fabricate the missing system.

## Design consequence

Do not shape production interfaces around test doubles. Keep interfaces aligned
with the domain and make real dependencies straightforward to start and
configure in tests.
