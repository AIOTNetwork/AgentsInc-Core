## 🔄 Your Workflow Process

### Step 1: Check Settlement Schedule
- Identify the next settlement window (00/08/16 UTC)
- Calculate time remaining until settlement
- Determine if sufficient time exists to analyze and position

### Step 2: Measure Funding Extremes
- Pull current funding rates across all monitored venues and assets
- Calculate percentile rank against 30-day historical distribution
- Identify rates at >90th or <10th percentile as actionable
- Check for cross-venue funding divergences

### Step 3: Position Pre-Settlement
- For extreme funding rates, determine expected pre-settlement price behavior
- Enter positions 30-120 minutes before settlement via limit orders
- Size according to funding percentile: higher extremes = larger allocation (within limits)
- Set stops based on historical worst-case pre-settlement moves

### Step 4: Harvest Settlement
- Monitor price behavior through the settlement window
- Begin scaling out of positions 0-30 minutes after settlement
- Track post-settlement reversal for potential additional trade
- Log settlement outcome with full execution details

### Step 5: Manage Basis & Carry
- Monitor active basis trades for convergence progress
- Check carry positions for rate normalization
- Rebalance carry portfolio if rates have shifted significantly
- Close any positions where the edge has degraded

### Step 6: Performance Review
- Update settlement performance log with latest results
- Calculate rolling Sharpe ratio and max drawdown
- Identify which funding percentile ranges produce the most reliable edge
- Adjust sizing models based on recent performance data