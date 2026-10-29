---
name: distributed-systems-review
description: Analyze queues, retries, concurrent writers, replication, caches, and external effects for partial-failure and consistency risks. Use when work crosses process boundaries or can be delivered more than once.
---

# Distributed systems review

Reason about observable state under failure. A broker or database guarantee does
not automatically extend to an external side effect. Produce a review and test
plan; do not inject faults into production or replay real events without scope.

## Define the invariant and delivery path

Read the relevant handlers, persistence code, consumer configuration, and local
instructions. Identify the operation identity, state owner, transaction boundary,
acknowledgment point, retry policy, and external effects. Record what the actual
database/broker configuration guarantees and what remains assumed.

State correctness in business terms: for example, one reservation cannot be
consumed twice. Specify required ordering scope, visibility/staleness tolerance,
and recovery goals. Do not claim “exactly once” without defining its boundary.

## Walk the failure windows

Build a small table: **failure point → durable state → caller/consumer view →
recovery action → invariant test**. Cover the applicable cases:

- Commit succeeds but its response is lost; a caller retries after a timeout.
- A worker dies before or after its effect but before acknowledgment/checkpoint.
- Two workers handle the same intent concurrently; a lease expires while the
  first worker is still alive. Verify fencing at the protected write if needed.
- Events arrive late, duplicated, or out of order; an old event follows a newer
  schema or state transition.
- A dependency slows down; retries at multiple layers amplify load. Account for
  total deadline, capped attempts, backoff with jitter, and cancellation.
- A poison message or hot partition blocks progress. Check bounded concurrency,
  backpressure, dead-letter ownership, and replay behavior.
- Reads hit a stale replica or cache after a write. Identify which decisions
  require authoritative state and how invalidation can race with refill.

Use timelines and concrete identifiers to expose the race. Do not assume a
timeout proves failure or a distributed lock proves exclusive side effects.

## Evaluate the mechanism

For deduplication, check tenant/operation scoping, atomic claim, payload mismatch,
in-progress state, and retention beyond the longest redelivery/replay window.
An external call may still need provider idempotency or reconciliation after an
unknown outcome; a unique row alone does not make that call atomic.

For database-to-broker handoffs, check an atomic intent record such as an outbox,
its publisher recovery, and consumer deduplication. An outbox delivers the intent;
it does not remove duplicates or make every downstream effect transactional.

For coordination or replication, identify authority during partition, leader
change, clock skew assumptions, quorum configuration, and conflict resolution.
Prefer an existing storage primitive over inventing a consensus protocol.

## Deliver evidence and experiments

Return the invariant, verified guarantees, failure-window table, prioritized
risks, and smallest remedies with their costs. Specify deterministic local tests
using barriers, controlled clocks, or fault points where possible. Include
duplicate delivery, concurrent attempts, and crash-after-effect scenarios.

Recommend signals such as oldest pending age, retry amplification, dedupe hits,
and reconciliation failures, with bounded-cardinality dimensions. Separate tests
run from tests proposed and state the remaining uncertainty.
