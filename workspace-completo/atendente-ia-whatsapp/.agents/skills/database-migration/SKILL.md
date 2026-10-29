---
name: database-migration
description: Plan a safe database schema change, data backfill, or storage migration with mixed-version compatibility, lock analysis, verification, and recovery. Use before deploying a change to persistent data.
---

# Database migration

Treat a migration as a deployment across application versions and durable state.
Produce a plan or review by default. Creating migration files is appropriate
when requested; executing against a shared or production database is separate
scope. Do not infer permission from possession of credentials.

## Inspect before choosing a procedure

Read repository instructions, migration tooling and history, schema, affected
queries, writers, and deployment process. Establish database engine and version,
table/index size, write rate, replication, tenant distribution, and available
maintenance window. Mark missing production measurements as prerequisites.

Validate transformation semantics before planning the backfill. Try ambiguous
inputs, nulls, units, and time zones; splitting a display name, for example, is
not necessarily a lossless mapping to given and family names.

Check the engine/version's actual behavior for locking, table rewrites,
transactional DDL, online index creation, constraint validation, and rollback.
Use authoritative documentation when available; do not transfer a procedure from
another database dialect or disable verification to install tooling.

## Write the change sequence

Prefer compatible stages when old and new code must coexist:

1. **Expand:** add compatible schema and deploy code that tolerates both shapes.
   Specify defaults, null behavior, lock exposure, and whether old writers still
   produce valid rows.
2. **Migrate:** run a bounded, restartable backfill. Define stable scan order,
   durable progress, per-batch transaction limits, concurrency with live writes,
   throttling, and retry behavior. Prevent a stale backfill overwriting fresh data.
3. **Switch:** compare old/new reads using explicit equivalence rules, then move
   readers/writers in a stated order. Explain dual-write divergence recovery if
   dual writes are necessary; naming the pattern does not make them atomic.
4. **Contract:** remove old fields or paths only after old application versions,
   jobs, integrations, and retention/replay windows no longer depend on them.

Use a simpler atomic change for a small local system when the measured risk and
deployment constraints allow it. Do not force four releases for every new table.

## Define gates and recovery

For each stage specify an owner or owner-to-confirm, command/tool, prerequisites,
success checks, stop conditions, and recovery action. Choose thresholds from the
system's SLOs or label them as proposed; do not invent accepted operational limits.

Check lock wait and replica lag as well as application errors, affected row
counts, nulls, uniqueness, and business invariants. Use aggregate comparisons or
redacted samples; do not expose customer data in a plan or logs.

Distinguish rolling application code back from undoing new writes. A destructive
down migration may lose data. Document the last reversible stage, when restore
or forward repair is required, and backup/restore verification prerequisites.

## Deliver the plan

Return current/target schema behavior, compatibility by application version,
ordered stages, backfill algorithm, validation queries, and recovery limits.
Validate migration syntax and behavior on an isolated representative database
when available. Report exact checks run, dataset limitations, and untested engine
or production-scale assumptions. Never describe a proposed procedure as executed.
