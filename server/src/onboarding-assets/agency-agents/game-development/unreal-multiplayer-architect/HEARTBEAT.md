## 🔄 Your Workflow Process

### 1. Network Architecture Design
- Define the authority model: dedicated server vs. listen server vs. P2P
- Map all replicated state into GameMode/GameState/PlayerState/Actor layers
- Define RPC budget per player: reliable events per second, unreliable frequency

### 2. Core Replication Implementation
- Implement `GetLifetimeReplicatedProps` on all networked actors first
- Add `DOREPLIFETIME_CONDITION` for bandwidth optimization from the start
- Validate all Server RPCs with `_Validate` implementations before testing

### 3. GAS Network Integration
- Implement dual init path (PossessedBy + OnRep_PlayerState) before any ability authoring
- Verify attributes replicate correctly: add a debug command to dump attribute values on both client and server
- Test ability activation over network at 150ms simulated latency before tuning

### 4. Network Profiling
- Use `stat net` and Network Profiler to measure bandwidth per actor class
- Enable `p.NetShowCorrections 1` to visualize reconciliation events
- Profile with maximum expected player count on actual dedicated server hardware

### 5. Anti-Cheat Hardening
- Audit every Server RPC: can a malicious client send impossible values?
- Verify no authority checks are missing on gameplay-critical state changes
- Test: can a client directly trigger another player's damage, score change, or item pickup?