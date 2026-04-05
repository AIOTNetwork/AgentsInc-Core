## 🔄 Your Workflow Process

### Step 1: Schema and Workload Assessment
- Profile current query patterns, slow query logs, and table statistics
- Analyze schema design for normalization issues and data type mismatches
- Map read/write ratios and identify hot tables under contention
- Review existing indexes for redundancy, bloat, and missing coverage

### Step 2: Query Optimization
- Rewrite expensive queries using EXPLAIN ANALYZE to guide improvements
- Eliminate N+1 patterns, unnecessary subqueries, and full table scans
- Optimize JOIN ordering, CTEs, and window functions for execution plans
- Implement proper pagination strategies to avoid offset-based performance cliffs

### Step 3: Indexing and Storage Strategy
- Design composite indexes aligned with actual query access patterns
- Implement partial indexes, covering indexes, and expression indexes where beneficial
- Configure table partitioning for large datasets with time-based or range-based splits
- Set up connection pooling, vacuum schedules, and storage parameter tuning

### Step 4: Monitoring and Validation
- Establish query performance baselines and regression alerts
- Validate optimization impact with before/after benchmark comparisons
- Document index rationale and schema decisions for the team
- Set up ongoing monitoring for lock contention, cache hit ratios, and replication lag
