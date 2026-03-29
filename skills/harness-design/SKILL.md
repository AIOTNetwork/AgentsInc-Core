---
name: harness-design
description: >
  Multi-agent harness design for long-running autonomous work. Implements
  Planner-Generator-Evaluator (PGE) architecture with sprint contracts,
  grading criteria, and structured handoffs. Use when orchestrating complex,
  multi-step work across agents — decomposing goals into sprints, negotiating
  done-criteria, running generator-evaluator feedback loops, and managing
  context across sessions.
---

# PGE Harness Design

Decompose complex work into three roles. Never let the same agent generate and evaluate.

## Roles

### Planner

Expand a brief goal (1–4 sentences) into a structured spec. Output to `SPEC.md`.

- Be ambitious about scope — push for completeness
- Constrain **deliverables**, not implementation paths
- Stay at product/design level — over-specified technical details cascade errors downstream
- Look for opportunities to add value beyond the literal request

### Generator

Implement work in **sprints** — one feature/deliverable at a time.

- Self-evaluate before handing off to the Evaluator
- Checkpoint each sprint with git
- On evaluation feedback: **refine** if scores trend well, **pivot** to a different approach if not

### Evaluator

Judge the Generator's work. Must be a **separate agent** — never the same one that produced the work.

- Test actual output with tools (browse, run, click through) — not descriptions
- Grade against explicit criteria with hard thresholds
- Fail the sprint if any criterion is below threshold; return detailed feedback
- Be skeptical by default — calibrate with few-shot score breakdowns

## Sprint Contracts

Before each sprint, Generator and Evaluator negotiate what "done" looks like.

1. Generator proposes scope + verification method
2. Evaluator reviews — is this the right thing to build?
3. Iterate until agreed
4. Generator builds against the contract
5. Evaluator grades against the contract

Without a contract, evaluators grade against vague expectations and pass everything.

## Grading Criteria

Turn subjective quality into concrete, gradable dimensions. Each criterion: specific (two evaluators would agree), weighted by importance, calibrated with few-shot examples.

**Emphasize criteria where agents are weakest.** Models already score well on craft and functionality — push on taste, depth, and originality.

### Software Quality

| Criterion | Weight | Measures |
|---|---|---|
| Product depth | High | Works end-to-end as a real user would use it |
| Functionality | High | Users complete tasks without errors or confusion |
| Visual design | Medium | Coherent aesthetic, not generic templates |
| Code quality | Medium | Clean architecture, no obvious anti-patterns |

### Design Quality

| Criterion | Weight | Measures |
|---|---|---|
| Design quality | High | Coherent mood and identity, not assembled parts |
| Originality | High | Deliberate creative choices, not defaults |
| Craft | Low | Typography, spacing, contrast |
| Functionality | Low | Usability independent of aesthetics |

## Generator-Evaluator Loop

3–10 iterations per sprint (more for subjective tasks, fewer for functional).

```
for each sprint:
  1. Negotiate sprint contract (Generator <> Evaluator)
  2. Generator implements
  3. Evaluator tests + grades
  4. All criteria pass thresholds -> sprint complete
  5. Any criterion fails -> detailed feedback, loop to step 2
  6. Stuck after 3 attempts -> escalate or re-plan
```

Expect non-linear improvement — later iterations trend better overall, but a middle iteration may be preferred. This is normal.

## Context Management

**Reset context when:** agent wraps up prematurely (context anxiety), coherence degrades, or switching between fundamentally different work phases.

**Use compaction when:** continuity matters more than a clean slate, mid-sprint work where losing thread is costly.

**Every reset produces a handoff artifact:**
- What was completed
- Current state (file paths, git branch, running services)
- What comes next (next sprint, known issues, open questions)
- Decisions made and their rationale

## File-Based Communication

Agents communicate through files — explicit, auditable, resumable.

| File | Writer | Reader | Purpose |
|---|---|---|---|
| `SPEC.md` | Planner | Generator, Evaluator | Product specification |
| `SPRINT-CONTRACT.md` | Generator + Evaluator | Both | Agreed done-criteria |
| `EVALUATION.md` | Evaluator | Generator | Grades + feedback |
| `HANDOFF.md` | Any agent | Next agent | State transfer on reset |
| `STATUS.md` | Generator | Evaluator, Planner | Progress and blockers |

## Planner Checklist

When you are the Planner orchestrating an initiative:

- [ ] Write or commission a spec
- [ ] Decompose into sprints — one feature each
- [ ] Assign a Generator and Evaluator per sprint (never the same agent)
- [ ] Ensure sprint contract is negotiated before work begins
- [ ] Review evaluator scores — intervene if stuck after 3 iterations
- [ ] Checkpoint with git after each passing sprint
- [ ] Write handoff artifact on context resets

## Anti-Patterns

| Pattern | Why it fails |
|---|---|
| Self-review | Bias is structural, not fixable by prompting |
| Over-specifying upfront | Technical specs before implementation cascade errors |
| Skipping the contract | Evaluator grades against vague expectations, passes everything |
| Ignoring plateaus | 3+ iterations at same score = pivot or re-scope, not more of the same |
| Single-pass execution | Even first iterations improve when criteria exist — criteria steer away from defaults |

## Reference

Based on: [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) — Anthropic Engineering, March 2026.
