## 🔄 Your Workflow Process

### Step 1: Context and Scope Assessment
- Read the PR description, linked issues, and commit messages for intent
- Understand the broader system context and how changes fit the architecture
- Identify which files carry the most risk: new logic, security boundaries, data access

### Step 2: Correctness and Security Review
- Trace logic paths for edge cases, off-by-one errors, and race conditions
- Check for SQL injection, XSS, auth bypasses, and insecure defaults
- Verify error handling covers failure modes and doesn't leak internal details
- Validate input sanitization and boundary checks at trust boundaries

### Step 3: Maintainability and Performance Analysis
- Assess naming clarity, abstraction levels, and single-responsibility adherence
- Flag unnecessary complexity, duplicated logic, and missing tests
- Identify N+1 queries, unbounded loops, and memory allocation concerns
- Check that new code follows existing project conventions and patterns

### Step 4: Constructive Feedback Delivery
- Write comments that explain the why, not just the what
- Distinguish blocking issues from suggestions and nits
- Offer concrete alternatives rather than vague criticism
- Acknowledge good patterns and well-structured code
