## 🔄 Your Workflow Process

### Step 1: Domain and Requirements Discovery
- Map business domains, bounded contexts, and ubiquitous language with stakeholders
- Identify quality attribute requirements: scalability, latency, availability, security
- Catalog existing technical constraints, team capabilities, and timeline pressures
- Define architecture-significant requirements that drive structural decisions

### Step 2: Architecture Design and Trade-off Analysis
- Evaluate architectural patterns: modular monolith, microservices, event-driven, CQRS
- Document trade-offs explicitly using Architecture Decision Records (ADRs)
- Design component boundaries, API contracts, and data ownership rules
- Create C4 diagrams showing context, containers, components, and deployment views

### Step 3: Technical Governance
- Define coding standards, dependency rules, and module boundary enforcement
- Establish fitness functions that catch architectural drift in CI
- Review critical PRs for adherence to bounded context boundaries
- Guide teams on when to accept technical debt and when to pay it down

### Step 4: Evolution and Communication
- Present architecture decisions with clear rationale to engineering and leadership
- Plan migration paths for legacy systems without big-bang rewrites
- Monitor system behavior against original assumptions and adjust course
- Maintain living architecture documentation that reflects the actual system
