---
name: harness-design
description: >
  Multi-agent harness design methodology for long-running autonomous work.
  Implements the Planner-Generator-Evaluator (PGE) architecture with sprint
  contracts, grading criteria, and structured handoffs. Use this skill when
  orchestrating complex, multi-step work across agents — decomposing goals
  into sprints, negotiating done-criteria, running generator-evaluator loops,
  and managing context across sessions.
---

# Harness Design for Long-Running Autonomous Work

This skill encodes the methodology from Anthropic's research on harness design for long-running application development. It gives you a structured approach to orchestrating complex work across multiple agents over extended sessions.

## Core Principle

**Naive single-agent execution fails on complex tasks.** Two failure modes dominate:

1. **Context degradation** — As the context window fills, agents lose coherence and may exhibit "context anxiety" (wrapping up prematurely). Solution: context resets with structured handoffs, or compaction when the model handles it well.
2. **Self-evaluation bias** — Agents grade their own work too generously, even when quality is obviously mediocre. Solution: separate the agent doing the work from the agent judging it.

## The Three-Agent Architecture (PGE)

Every complex initiative should be decomposed into three roles:

### 1. Planner

The Planner takes a brief goal (1–4 sentences) and expands it into a full specification.

**Rules:**
- Be ambitious about scope — push for completeness
- Stay focused on **product context and high-level technical design**, not granular implementation details
- If the planner over-specifies technical details and gets something wrong, errors cascade into downstream implementation
- Constrain agents on **deliverables to produce**, let them figure out the path
- Look for opportunities to add value beyond the literal request

**Output:** A structured spec document saved to a known file path that downstream agents can read.

### 2. Generator

The Generator implements work in **sprints**, picking up one feature/deliverable at a time from the spec.

**Rules:**
- Work one feature at a time — never parallelize within a sprint
- Self-evaluate at the end of each sprint before handing off to QA
- Use version control (git) to checkpoint each sprint
- When evaluation feedback arrives, make a strategic decision:
  - **Refine** the current direction if scores are trending well
  - **Pivot** to an entirely different approach if the current one isn't working

### 3. Evaluator

The Evaluator judges the Generator's work against concrete criteria. It must be a separate agent — never the same agent that produced the work.

**Rules:**
- Test the actual output, not the description of it (use tools: browse, run, click through)
- Grade against explicit criteria with hard thresholds
- If any criterion falls below its threshold, the sprint **fails** and returns detailed feedback
- Be skeptical by default — tuning a standalone evaluator to be critical is far more tractable than making a generator critical of its own work
- Use few-shot examples with detailed score breakdowns to calibrate judgment

## Sprint Contracts

Before each sprint, the Generator and Evaluator **negotiate a sprint contract**: an explicit agreement on what "done" looks like for that chunk of work.

**Why:** The product spec is intentionally high-level. The sprint contract bridges the gap between user stories and testable implementation.

**Process:**
1. Generator proposes what it will build and how success will be verified
2. Evaluator reviews the proposal — is the Generator building the right thing?
3. They iterate until they agree
4. Generator builds against the agreed contract
5. Evaluator grades against the agreed contract

**Communication:** Use files. One agent writes a file, another reads and responds. This keeps handoffs explicit and auditable.

## Grading Criteria

Turn subjective quality into concrete, gradable dimensions. Each criterion should be:
- **Specific** enough that two evaluators would reach similar scores
- **Weighted** by importance — emphasize the dimensions where agents are weakest
- **Calibrated** with few-shot examples showing what each score level looks like

### Example: Software Quality Criteria

| Criterion | Weight | What it measures |
|---|---|---|
| Product depth | High | Does the feature work end-to-end as a real user would use it? |
| Functionality | High | Can users complete tasks without errors or confusion? |
| Visual design | Medium | Coherent aesthetic, not generic templates or AI-default patterns |
| Code quality | Medium | Clean architecture, no obvious tech debt or anti-patterns |

### Example: Design Quality Criteria

| Criterion | Weight | What it measures |
|---|---|---|
| Design quality | High | Coherent mood and identity, not just assembled parts |
| Originality | High | Evidence of deliberate creative choices, not defaults |
| Craft | Low | Typography, spacing, contrast — technical competence |
| Functionality | Low | Usability independent of aesthetics |

**Key insight:** Emphasize the criteria where the model is weakest. Models already score well on craft and functionality by default — push hard on the dimensions that require taste and judgment.

## Generator-Evaluator Loop

Run 3–10 iterations per sprint (more for subjective tasks like design, fewer for functional tasks).

```
for each sprint:
  1. Negotiate sprint contract (Generator ↔ Evaluator)
  2. Generator implements
  3. Evaluator tests + grades against criteria
  4. If all criteria pass thresholds → sprint complete, move to next
  5. If any criterion fails → Generator gets detailed feedback, loops back to step 2
  6. If stuck after 3 attempts → escalate (flag for human review or re-plan)
```

**Expect non-linear improvement.** Later iterations tend to be better overall, but you'll regularly see cases where a middle iteration is preferred. Implementation complexity also increases across rounds. This is normal.

## Context Management

### When to use context resets
- Agent exhibits "context anxiety" (wrapping up prematurely)
- Context window is filling and coherence is degrading
- Switching between fundamentally different phases of work

### When to use compaction
- Model handles long contexts well (Opus-class)
- Continuity matters more than a clean slate
- Mid-sprint work where losing thread would be costly

### Structured handoffs between sessions
Every context reset must produce a **handoff artifact** containing:
- What was completed
- Current state of the work (file paths, git branch, running services)
- What comes next (next sprint, known issues, open questions)
- Any decisions made and their rationale

## File-Based Communication Protocol

Agents communicate through files, not conversation. This keeps handoffs explicit, auditable, and resumable.

| File | Written by | Read by | Purpose |
|---|---|---|---|
| `SPEC.md` | Planner | Generator, Evaluator | Product specification |
| `SPRINT-CONTRACT.md` | Generator + Evaluator | Both | Agreed "done" criteria for current sprint |
| `EVALUATION.md` | Evaluator | Generator | Grades + detailed feedback |
| `HANDOFF.md` | Any agent | Next agent | State transfer on context reset |
| `STATUS.md` | Generator | Evaluator, Planner | Current progress and blockers |

## Applying This as CEO

As CEO, you are the **Planner**. Your role in this architecture:

1. **Decompose goals into sprints** — Break company objectives into tractable chunks with clear deliverables
2. **Assign Generator roles** — Delegate sprints to the right specialist agents
3. **Assign Evaluator roles** — Ensure every piece of work has a separate agent reviewing it
4. **Enforce sprint contracts** — Don't let generators start work without agreed-upon done criteria
5. **Monitor the loop** — Track iteration count, score trends, and escalations
6. **Decide when to ship** — Aggregate evaluator signals to decide when quality is sufficient

### CEO Checklist for Each Initiative

- [ ] Write or commission a spec (Planner output)
- [ ] Decompose spec into sprints with one feature each
- [ ] For each sprint: assign a generator agent and an evaluator agent (never the same agent)
- [ ] Ensure sprint contract is negotiated before work begins
- [ ] Review evaluator scores — intervene if stuck after 3 iterations
- [ ] Checkpoint with git after each passing sprint
- [ ] Write handoff artifact if context resets are needed

## Anti-Patterns

- **Self-review** — Never let the agent that built something evaluate it. The bias is structural, not fixable by prompting.
- **Over-specifying upfront** — Detailed technical specs written before implementation cascade errors. Keep specs at product level.
- **Skipping the contract** — Without agreed done-criteria, the evaluator grades against vague expectations and passes everything.
- **Ignoring plateaus** — If scores plateau below threshold after 3+ iterations, pivot the approach or re-scope. More iterations of the same approach won't help.
- **Single-pass execution** — Even the first iteration improves when criteria exist. The criteria and associated language steer the model away from generic defaults before any feedback loop begins.

## Reference

Based on: [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) — Anthropic Engineering, March 2026.
