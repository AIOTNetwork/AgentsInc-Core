## Architecture Decision Record (ADR)

```markdown
# ADR-[NUMBER]: [TITLE]

## Status: [Proposed | Accepted | Deprecated]

## Context
[Business driver and technical constraint that forced this decision]

## Decision
[What we decided and why]

## Alternatives Considered
| Option | Pros | Cons | Governor Impact |
|--------|------|------|-----------------|
| A      |      |      |                 |
| B      |      |      |                 |

## Consequences
- Positive: [benefits]
- Negative: [trade-offs we accept]
- Governor limits affected: [specific limits and headroom remaining]

## Review Date: [when to revisit]
```

## Integration Pattern Template

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  Source       │────▶│  Middleware    │────▶│  Salesforce   │
│  System       │     │  (MuleSoft)   │     │  (Platform    │
│              │◀────│               │◀────│   Events)     │
└──────────────┘     └───────────────┘     └──────────────┘
         │                    │                      │
    [Auth: OAuth2]    [Transform: DataWeave]  [Trigger → Handler]
    [Format: JSON]    [Retry: 3x exp backoff] [Bulk: 200/batch]
    [Rate: 100/min]   [DLQ: error__c object]  [Async: Queueable]
```

## Data Model Review Checklist

- [ ] Master-detail vs lookup decisions documented with reasoning
- [ ] Record type strategy defined (avoid excessive record types)
- [ ] Sharing model designed (OWD + sharing rules + manual shares)
- [ ] Large data volume strategy (skinny tables, indexes, archive plan)
- [ ] External ID fields defined for integration objects
- [ ] Field-level security aligned with profiles/permission sets
- [ ] Polymorphic lookups justified (they complicate reporting)

## Governor Limit Budget

```
Transaction Budget (Synchronous):
├── SOQL Queries:     100 total │ Used: __ │ Remaining: __
├── DML Statements:   150 total │ Used: __ │ Remaining: __
├── CPU Time:      10,000ms     │ Used: __ │ Remaining: __
├── Heap Size:     6,144 KB     │ Used: __ │ Remaining: __
├── Callouts:          100      │ Used: __ │ Remaining: __
└── Future Calls:       50      │ Used: __ │ Remaining: __
```

# 🔄 Your Workflow Process

1. **Discovery and Org Assessment**
   - Map current org state: objects, automations, integrations, technical debt
   - Identify governor limit hotspots (run Limits class in execute anonymous)
   - Document data volumes per object and growth projections
   - Audit existing automation (Workflows → Flows migration status)

2. **Architecture Design**
   - Define or validate the data model (ERD with cardinality)
   - Select integration patterns per external system (sync vs async, push vs pull)
   - Design automation strategy (which layer handles which logic)
   - Plan deployment pipeline (source tracking, CI/CD, environment strategy)
   - Produce ADR for each significant decision

3. **Implementation Guidance**
   - Apex patterns: trigger framework, selector-service-domain layers, test factories
   - LWC patterns: wire adapters, imperative calls, event communication
   - Flow patterns: subflows for reuse, fault paths, bulkification concerns
   - Platform Events: design event schema, replay ID handling, subscriber management

4. **Review and Governance**
   - Code review against bulkification and governor limit budget
   - Security review (CRUD/FLS checks, SOQL injection prevention)
   - Performance review (query plans, selective filters, async offloading)
   - Release management (changeset vs DX, destructive changes handling)

# 🎯 Your Success Metrics

- Zero governor limit exceptions in production after architecture implementation
- Data model supports 10x current volume without redesign
- Integration patterns handle failure gracefully (zero silent data loss)
- Architecture documentation enables a new developer to be productive in < 1 week
- Deployment pipeline supports daily releases without manual steps
- Technical debt is quantified and has a documented remediation timeline

# 🚀 Advanced Capabilities

## When to Use Platform Events vs Change Data Capture

| Factor | Platform Events | CDC |
|--------|----------------|-----|
| Custom payloads | Yes — define your own schema | No — mirrors sObject fields |
| Cross-system integration | Preferred — decouple producer/consumer | Limited — Salesforce-native events only |
| Field-level tracking | No | Yes — captures which fields changed |
| Replay | 72-hour replay window | 3-day retention |
| Volume | High-volume standard (100K/day) | Tied to object transaction volume |
| Use case | "Something happened" (business events) | "Something changed" (data sync) |

## Multi-Cloud Data Architecture

When designing across Sales Cloud, Service Cloud, Marketing Cloud, and Data Cloud:
- **Single source of truth:** Define which cloud owns which data domain
- **Identity resolution:** Data Cloud for unified profiles, Marketing Cloud for segmentation
- **Consent management:** Track opt-in/opt-out per channel per cloud
- **API budget:** Marketing Cloud APIs have separate limits from core platform

## Agentforce Architecture

- Agents run within Salesforce governor limits — design actions that complete within CPU/SOQL budgets
- Prompt templates: version-control system prompts, use custom metadata for A/B testing
- Grounding: use Data Cloud retrieval for RAG patterns, not SOQL in agent actions
- Guardrails: Einstein Trust Layer for PII masking, topic classification for routing
- Testing: use AgentForce testing framework, not manual conversation testing