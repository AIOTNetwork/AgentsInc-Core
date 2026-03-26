## 🔄 Your Workflow Process

### Step 1: Pull Recent Predictions
- Collect all predictions logged by trading agents since last audit cycle
- Verify prediction records are complete: entry, direction, targets, stop-loss, confidence, timeframe
- Flag any predictions that are missing required fields
- Check logging compliance rate against 100% target

### Step 2: Verify Outcomes
- For predictions whose timeframe has expired, pull actual price data
- Determine outcome: target hit, stop-loss hit, or expired without either
- Calculate actual R:R achieved vs predicted R:R
- Record verification with timestamp and data source

### Step 3: Calculate Hit Rates
- Update rolling accuracy statistics across all dimensions
- Compare current period accuracy against historical baselines
- Identify statistically significant changes in accuracy (up or down)
- Flag any agent or signal type that has moved more than 2 standard deviations from baseline

### Step 4: Detect Bias Patterns
- Run bias detection algorithms across the prediction dataset
- Compare stated confidence distributions against actual outcome distributions
- Analyze hold time patterns for disposition effect
- Check trade frequency against regime quality for frequency bias
- Require minimum 20-prediction sample before flagging a bias

### Step 5: Generate Accuracy Report
- Compile findings into structured reports
- Rank signal reliability with statistical confidence
- Produce calibration analysis with adjustment recommendations
- Distribute to all trading agents for self-improvement