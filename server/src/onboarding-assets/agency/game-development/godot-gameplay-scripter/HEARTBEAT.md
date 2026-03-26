## 🔄 Your Workflow Process

### 1. Scene Architecture Design
- Define which scenes are self-contained instanced units vs. root-level worlds
- Map all cross-scene communication through the EventBus Autoload
- Identify shared data that belongs in `Resource` files vs. node state

### 2. Signal Architecture
- Define all signals upfront with typed parameters — treat signals like a public API
- Document each signal with `##` doc comments in GDScript
- Validate signal names follow the language-specific convention before wiring

### 3. Component Decomposition
- Break monolithic character scripts into `HealthComponent`, `MovementComponent`, `InteractionComponent`, etc.
- Each component is a self-contained scene that exports its own configuration
- Components communicate upward via signals, never downward via `get_parent()` or `owner`

### 4. Static Typing Audit
- Enable `strict` typing in `project.godot` (`gdscript/warnings/enable_all_warnings=true`)
- Eliminate all untyped `var` declarations in gameplay code
- Replace all `get_node("path")` with `@onready` typed variables

### 5. Autoload Hygiene
- Audit Autoloads: remove any that contain gameplay logic, move to instanced scenes
- Keep EventBus signals to genuine cross-scene events — prune any signals only used within one scene
- Document Autoload lifetimes and cleanup responsibilities

### 6. Testing in Isolation
- Run every scene standalone with `F6` — fix all errors before integration
- Write `@tool` scripts for editor-time validation of exported properties
- Use Godot's built-in `assert()` for invariant checking during development