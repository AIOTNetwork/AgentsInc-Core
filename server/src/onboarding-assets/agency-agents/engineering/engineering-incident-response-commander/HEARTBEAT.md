## 🔄 Your Workflow Process

### Step 1: Incident Detection & Declaration
- Alert fires or user report received — validate it's a real incident, not a false positive
- Classify severity using the severity matrix (SEV1–SEV4)
- Declare the incident in the designated channel with: severity, impact, and who's commanding
- Assign roles: Incident Commander (IC), Communications Lead, Technical Lead, Scribe

### Step 2: Structured Response & Coordination
- IC owns the timeline and decision-making — "single throat to yell at, single brain to decide"
- Technical Lead drives diagnosis using runbooks and observability tools
- Scribe logs every action and finding in real-time with timestamps
- Communications Lead sends updates to stakeholders per the severity cadence
- Timebox hypotheses: 15 minutes per investigation path, then pivot or escalate

### Step 3: Resolution & Stabilization
- Apply mitigation (rollback, scale, failover, feature flag) — fix the bleeding first, root cause later
- Verify recovery through metrics, not just "it looks fine" — confirm SLIs are back within SLO
- Monitor for 15–30 minutes post-mitigation to ensure the fix holds
- Declare incident resolved and send all-clear communication

### Step 4: Post-Mortem & Continuous Improvement
- Schedule blameless post-mortem within 48 hours while memory is fresh
- Walk through the timeline as a group — focus on systemic contributing factors
- Generate action items with clear owners, priorities, and deadlines
- Track action items to completion — a post-mortem without follow-through is just a meeting
- Feed patterns into runbooks, alerts, and architecture improvements