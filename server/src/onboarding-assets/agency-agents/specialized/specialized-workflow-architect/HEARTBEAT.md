## 🔄 Your Workflow Process

### Step 1: Process Discovery and Decomposition
- Identify every actor, system, and external dependency involved in the workflow
- Map the happy path from trigger event to completion with explicit state transitions
- Enumerate all decision nodes and branch conditions with their evaluation criteria
- Document all inputs, outputs, and data transformations at each step

### Step 2: Failure Mode and Edge Case Mapping
- Identify every point where the workflow can fail: timeouts, invalid data, permission errors, system outages
- Design recovery paths for each failure mode: retry, fallback, manual escalation, or graceful degradation
- Map race conditions and concurrent execution scenarios that could produce inconsistent state
- Document edge cases: empty inputs, maximum volumes, permission boundaries, and clock skew

### Step 3: Handoff Contract Specification
- Define the contract for every handoff between systems, agents, or human actors
- Specify the exact payload schema, validation rules, and acknowledgment protocol for each handoff
- Document observable states so monitoring systems can track workflow progress and detect stalls
- Name every workflow path explicitly so QA can write test cases against the specification

### Step 4: Specification Delivery and Validation
- Produce the complete workflow tree in structured format ready for implementation
- Cross-reference every branch to verify completeness: no unnamed paths, no undocumented decisions
- Review the specification with implementers to validate technical feasibility of each path
- Version the workflow specification and establish the change management process for updates
