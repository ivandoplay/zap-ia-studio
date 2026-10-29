---
name: api-design
description: Design or evolve public interfaces for libraries, CLIs, HTTP, RPC, or events, including errors and compatibility. Use when defining caller-visible behavior before implementation.
---

# API design

Design the consumer-visible behavior before choosing handler structure. Inspect
local instructions, existing schemas, callers, SDKs, and versioning conventions.
Reuse the protocol and naming the project already uses unless there is a reason
to change them. Produce a contract; do not implement it unless asked.

## Capture the operation

Identify the caller, tenant/resource scope, business operation, and invariant.
Determine whether it completes synchronously, starts a job, or publishes a fact.
Ask only for missing requirements that change the contract. State assumed volume,
latency, ordering, and compatibility constraints explicitly.

## Specify the observable behavior

Select checks appropriate to the actual interface; transport-specific conventions
belong to that transport, not every public function or command.

- Inputs, types, units, required/optional/nullable distinctions, validation, and
  limits. Define unknown-field and enum-extension behavior for real consumers.
- Success shape and stable identifiers. For async work include acceptance,
  status lookup, terminal states, cancellation semantics, and result retention.
- Error categories and protocol-native representation. Say what is retryable,
  how clients correlate an error, and what information must stay private.
- Authentication and resource-level authorization, including cross-tenant
  negative cases. Authentication alone does not establish access to an object.
- Bounded list operations: maximum size, deterministic ordering and tie-breaker,
  cursor validity, and behavior when rows change between pages.
- Deadlines, rate limits, concurrency conflicts, and caching semantics where
  relevant. Do not promise atomicity or read-after-write behavior the store lacks.

For retryable mutations define a stable operation identity, its scope and
retention, mismatched-payload response, and behavior while an attempt is pending.
Account for unknown external outcomes. For event contracts also define the
partition/ordering key, schema identity, producer ownership, and replay semantics.

## Plan compatibility

Read existing consumers before calling a change additive. A new enum value,
stricter validation, default, or error code can break old clients. Describe the
old/new client and server matrix, deprecation signal, migration period, and
rollback behavior. Avoid a new version when a compatible evolution is sufficient.

## Return a usable contract

Use the repository's existing OpenAPI, protobuf, JSON Schema, or contract format
when available. Include representative request/response or event examples and a
small matrix of success, invalid input, forbidden resource, retry, conflict, and
compatibility cases. Clearly label examples that have not been schema-validated.

Finish with unresolved decisions and contract tests needed at provider and
consumer boundaries. If implementation is in scope, run the project's contract
validation and relevant tests and report the actual results.

For a library, specify public exports, types, supported runtimes, resource
ownership, cancellation, and error semantics; test from a consumer package.
For a CLI, specify flags, defaults, exit codes, stdout versus stderr, machine
output, and file overwrite behavior. Treat documented output used by scripts as
a compatibility contract. Avoid imposing HTTP conventions on local interfaces.

Example: “create export” should explain whether a retry returns the same job,
what another tenant can see, and when a result expires, not just its POST path.
