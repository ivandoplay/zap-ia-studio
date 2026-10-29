---
name: architecture-design
description: Compare architecture options for applications, libraries, tools, or services against user needs, invariants, workload, and change cost. Use when the technical approach or module boundaries are undecided.
---

# Architecture design

Turn an idea into a decision a team can challenge. Start with the existing
system, not a preferred technology. This workflow proposes a design; implementing
it or provisioning infrastructure requires that scope from the user.

## Establish the problem

Read local instructions, existing design records, relevant code, and deployment
configuration. Follow one representative request, interaction, or library/CLI
call through state changes and effects. Cite evidence for the current behavior.

Choose the right scale: a component state model, package interface, build tool,
or distributed service. Include runtime, browser/platform, offline, accessibility,
and distribution constraints where relevant. A local library needs no invented
deployment topology. Read existing domain terms and clarify overloaded concepts.

Write a compact design brief:

- User outcome and the limitation that motivates a change.
- Workload: request/event rate, burst shape, payload size, data growth, and hot
  keys. Label estimates and assumptions; do not invent traffic measurements.
- Invariants: what must remain true about ownership, money, permissions, order,
  or state transitions, including under failure.
- Constraints: latency and availability goals, acceptable data loss/staleness,
  team capacity, budget, residency, and existing platform commitments.
- Non-goals and decisions still reversible within this task.

Infer routine details from the repository. Ask only for an unknown that could
change the recommendation. Continue with explicit assumptions where useful.

## Compare realistic options

Consider keeping the current design with a smaller improvement, plus one or two
credible alternatives. Reject options that cannot satisfy a hard constraint.
For each remaining option describe:

1. Boundaries and who owns each piece of state. Show a small component or sequence
   diagram only if it makes the critical path clearer.
2. Reads, writes, synchronous dependencies, and the exact points where work can
   partially succeed. Include tenant isolation and authorization boundaries.
3. Expected bottleneck, rough capacity/cost arithmetic with units and inputs, and
   operating burden. An unknown input should produce a range or an experiment.
4. Evolution: compatibility with current clients, migration steps, mixed-version
   behavior, and what remains recoverable after new writes begin.

Choose technology only after these differences are clear. Do not prescribe
microservices, a broker, caching, or multi-region deployment without a workload
or failure requirement that pays for the complexity.

Compare interface designs as well as technologies. Work through two concrete
caller examples: what must callers know, which invariants can the module own,
and where will a future change spread? Use a small disposable prototype to answer
one uncertain interaction or state question when authorized; label its limits
and record the finding without treating prototype code as production-ready.

## Deliver the decision

Return a brief proposal with problem, evidence, constraints, option comparison,
recommendation, and consequences. Separate accepted facts from assumptions and
open decisions. A recommendation may be “keep the current boundary.”

List the smallest experiment that could overturn the recommendation, its success
and failure thresholds, and a first independently verifiable implementation
slice. Include a rollout signal and a recovery path. When the user requests a
saved document, follow the repository's RFC/ADR location and template; leave its
status proposed until the decision owner accepts it.

Example: for slow exports, compare query/index improvements, an async job in the
existing service, and a separate worker. Decide using duration, memory pressure,
freshness needs, and operational ownership rather than “we need a queue.”
