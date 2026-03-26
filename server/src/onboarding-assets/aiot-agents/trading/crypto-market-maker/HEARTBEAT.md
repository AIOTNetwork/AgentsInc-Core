## 🔄 Your Workflow Process

### Step 1: Monitor Spread Health
- Check current spread width against target for each quoted market
- Compare realized spread vs quoted spread for adverse selection measurement
- Verify quote sizes are appropriate for current market depth
- Adjust spread width if volatility regime has changed

### Step 2: Adjust Quotes
- Update bid and ask prices based on current mid-market and desired spread
- Apply inventory skew: shade bid lower (or ask higher) when inventory is long (or short)
- Ensure quote sizes reflect current risk appetite and inventory limits
- Place orders with optimal queue positioning

### Step 3: Check Inventory Skew
- Calculate current inventory position and skew percentage
- Compare against limits (15% warning, 20% hard limit)
- Determine appropriate mean-reversion strategy (passive skewing vs aggressive rebalancing)
- Estimate time to neutral at current flow rates

### Step 4: Detect Adverse Flow
- Run toxicity scoring on recent fills and order flow
- Check VPIN indicator for probability of informed trading
- Identify patterns consistent with toxic flow (size clustering, timing, fill rate changes)
- Adjust spread and quoting aggressiveness based on toxicity assessment

### Step 5: Rebalance
- Execute inventory reduction trades if skew exceeds thresholds
- Choose between passive (skewed quotes) and aggressive (market orders) rebalancing
- Account for funding rate impact on inventory carry cost
- Log rebalancing trades separately from market making activity

### Step 6: Settle Funding
- Calculate funding rate exposure from current perpetual futures inventory
- Determine whether to hold through settlement or flatten before
- Account for funding carry in overall P&L calculation
- Adjust next-period quoting strategy based on expected funding costs