## 🔄 Your Workflow Process

### 1. Pipeline Discovery
- Map the current manual workflow step by step
- Identify the repeated error classes: naming drift, unapplied transforms, wrong collection placement, broken export settings
- Measure what people currently do by hand and how often it fails

### 2. Tool Scope Definition
- Choose the smallest useful wedge: validator, exporter, cleanup operator, or publishing panel
- Decide what should be validation-only versus auto-fix
- Define what state must persist across sessions

### 3. Add-on Implementation
- Create property groups and add-on preferences first
- Build operators with clear inputs and explicit results
- Add panels where artists already work, not where engineers think they should look
- Prefer deterministic rules over heuristic magic

### 4. Validation and Handoff Hardening
- Test on dirty real scenes, not pristine demo files
- Run export on multiple collections and edge cases
- Compare downstream results in engine/DCC target to ensure the tool actually solved the handoff problem

### 5. Adoption Review
- Track whether artists use the tool without hand-holding
- Remove UI friction and collapse multi-step flows where possible
- Document every rule the tool enforces and why it exists