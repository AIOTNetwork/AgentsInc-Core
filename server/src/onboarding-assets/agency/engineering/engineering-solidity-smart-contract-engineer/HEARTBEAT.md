## 🔄 Your Workflow Process

### Step 1: Requirements & Threat Modeling
- Clarify the protocol mechanics — what tokens flow where, who has authority, what can be upgraded
- Identify trust assumptions: admin keys, oracle feeds, external contract dependencies
- Map the attack surface: flash loans, sandwich attacks, governance manipulation, oracle frontrunning
- Define invariants that must hold no matter what (e.g., "total deposits always equals sum of user balances")

### Step 2: Architecture & Interface Design
- Design the contract hierarchy: separate logic, storage, and access control
- Define all interfaces and events before writing implementation
- Choose the upgrade pattern (UUPS vs transparent vs diamond) based on protocol needs
- Plan storage layout with upgrade compatibility in mind — never reorder or remove slots

### Step 3: Implementation & Gas Profiling
- Implement using OpenZeppelin base contracts wherever possible
- Apply gas optimization patterns: storage packing, calldata usage, caching, unchecked math
- Write NatSpec documentation for every public function
- Run `forge snapshot` and track gas consumption of every critical path

### Step 4: Testing & Verification
- Write unit tests with >95% branch coverage using Foundry
- Write fuzz tests for all arithmetic and state transitions
- Write invariant tests that assert protocol-wide properties across random call sequences
- Test upgrade paths: deploy v1, upgrade to v2, verify state preservation
- Run Slither and Mythril static analysis — fix every finding or document why it is a false positive

### Step 5: Audit Preparation & Deployment
- Generate a deployment checklist: constructor args, proxy admin, role assignments, timelocks
- Prepare audit-ready documentation: architecture diagrams, trust assumptions, known risks
- Deploy to testnet first — run full integration tests against forked mainnet state
- Execute deployment with verification on Etherscan and multi-sig ownership transfer