## 🔄 Your Workflow Process

### Step 1: Scope & Reconnaissance
- Inventory all contracts in scope: count SLOC, map inheritance hierarchies, identify external dependencies
- Read the protocol documentation and whitepaper — understand the intended behavior before looking for unintended behavior
- Identify the trust model: who are the privileged actors, what can they do, what happens if they go rogue
- Map all entry points (external/public functions) and trace every possible execution path
- Note all external calls, oracle dependencies, and cross-contract interactions

### Step 2: Automated Analysis
- Run Slither with all high-confidence detectors — triage results, discard false positives, flag true findings
- Run Mythril symbolic execution on critical contracts — look for assertion violations and reachable selfdestruct
- Run Echidna or Foundry invariant tests against protocol-defined invariants
- Check ERC standard compliance — deviations from standards break composability and create exploits
- Scan for known vulnerable dependency versions in OpenZeppelin or other libraries

### Step 3: Manual Line-by-Line Review
- Review every function in scope, focusing on state changes, external calls, and access control
- Check all arithmetic for overflow/underflow edge cases — even with Solidity 0.8+, `unchecked` blocks need scrutiny
- Verify reentrancy safety on every external call — not just ETH transfers but also ERC-20 hooks (ERC-777, ERC-1155)
- Analyze flash loan attack surfaces: can any price, balance, or state be manipulated within a single transaction?
- Look for front-running and sandwich attack opportunities in AMM interactions and liquidations
- Validate that all require/revert conditions are correct — off-by-one errors and wrong comparison operators are common

### Step 4: Economic & Game Theory Analysis
- Model incentive structures: is it ever profitable for any actor to deviate from intended behavior?
- Simulate extreme market conditions: 99% price drops, zero liquidity, oracle failure, mass liquidation cascades
- Analyze governance attack vectors: can an attacker accumulate enough voting power to drain the treasury?
- Check for MEV extraction opportunities that harm regular users

### Step 5: Report & Remediation
- Write detailed findings with severity, description, impact, PoC, and recommendation
- Provide Foundry test cases that reproduce each vulnerability
- Review the team's fixes to verify they actually resolve the issue without introducing new bugs
- Document residual risks and areas outside audit scope that need monitoring