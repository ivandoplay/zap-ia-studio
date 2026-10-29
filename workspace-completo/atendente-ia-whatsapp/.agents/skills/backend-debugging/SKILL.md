---
name: backend-debugging
description: Diagnose backend errors, latency regressions, resource leaks, and intermittent failures using reproductions and falsifiable hypotheses. Use when behavior is broken or slow; separates diagnosis from production incident actions.
---

# Backend debugging

Find the cause with the least invasive experiment that can distinguish competing
explanations. Follow local instructions. Preserve user changes and redact secrets
and customer data from all evidence.

## Define the symptom

Record expected versus observed behavior, a failing request/job/test, affected
version, timing, scope, and relevant recent changes. Read the error path and its
callers. Separate a broken business operation from an unavailable dependency or
incorrect local setup.

If this is an active incident, identify impact and the established incident
process. Recommend a known reversible mitigation where supported by evidence;
production changes, traffic replay, and fault injection require explicit scope.
An urgent mitigation is not proof of root cause.

## Build a useful reproduction

Prefer an existing failing test, then a small local request or harness that
asserts the exact symptom. Record command, fixture, version, result, and any
timing/seed assumptions. Minimize the case while preserving the failure.

For intermittent failures, capture the reproduction rate and use controlled
barriers, clocks, or concurrency where possible. A passing run alone cannot
disprove a race. If reproduction is unavailable, use redacted traces and bounded
read-only observations, explicitly limiting confidence; do not invent a repro.

For latency, establish a representative workload and baseline before changing
code. Separate queue time, handler time, database time, and dependency time.
Inspect query plans, pool saturation, profiles, and allocation/GC evidence as
applicable. Do not replace measurement with speculative caching.

## Test explanations

List a few ranked hypotheses, each with a prediction and the smallest safe probe
that could falsify it. Change one relevant variable at a time and keep a short
record: hypothesis → experiment → result → conclusion.

Use targeted instrumentation at the boundary that distinguishes the hypotheses.
Do not log entire payloads or credentials. Avoid broad dependency upgrades or
refactors while the causal explanation is uncertain.

If a command fails because tooling, access, or test data is missing, report that
prerequisite separately from the application failure. Continue independent
diagnosis; ask only for access or evidence that remains necessary.

## Fix within the requested scope

When a fix is requested, add a regression test at the seam that exercises the
actual failure. Show it failing for the original cause and passing after the
smallest correction. For a race, include the competing operations; for a query
regression, keep the relevant data distribution and inspect the plan.

Re-run the original scenario and affected tests. Remove temporary instrumentation
and unrelated experimental edits. For a performance change, compare like-for-like
workloads and report variability and remaining tradeoffs.

Return cause and confidence, supporting evidence, fix or next experiment, checks
run, and limitations. Say “hypothesis” until the evidence supports causality.
