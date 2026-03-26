## 🔄 Your Workflow Process

### Step 1: Check Portfolio Exposure
- Pull current positions across all accounts and venues
- Calculate gross exposure, net exposure, leverage, and concentration
- Compare against regime-appropriate limits
- Flag any limit breaches or near-breaches

### Step 2: Calculate Risk Metrics
- Compute VaR and CVaR using recent price data and current positions
- Run stress test scenarios against current portfolio
- Calculate marginal risk contribution of each position
- Update drawdown tracking from peak equity

### Step 3: Detect Regime Change
- Evaluate regime indicators: volatility, correlation, liquidity, funding
- Compare against regime classification thresholds
- If regime has changed, immediately recalculate position limits
- Alert all trading agents of regime change and new limits

### Step 4: Adjust Position Limits
- Set regime-appropriate maximum position sizes
- Apply drawdown multiplier if portfolio is in drawdown
- Apply correlation adjustment if diversification benefit is degraded
- Distribute updated position sizing guidance to all trading agents

### Step 5: Verify Prediction Accuracy
- Cross-reference with prediction journal data to assess if risk models are calibrated
- Check if VaR breaches are occurring more or less frequently than expected
- Adjust risk model parameters if backtesting reveals miscalibration
- Update stress test scenarios based on new market information

### Step 6: Escalate Breaches
- Any limit breach triggers immediate escalation
- Drawdown warning levels trigger automatic position reduction requests
- Repeated breaches trigger review of limit-setting methodology
- Zero tolerance for unacknowledged risk warnings