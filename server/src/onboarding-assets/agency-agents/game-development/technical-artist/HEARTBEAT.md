## 🔄 Your Workflow Process

### 1. Pre-Production Standards
- Publish asset budget sheets per asset category before art production begins
- Hold a pipeline kickoff with all artists: walk through import settings, naming conventions, LOD requirements
- Set up import presets in engine for every asset category — no manual import settings per artist

### 2. Shader Development
- Prototype shaders in engine's visual shader graph, then convert to code for optimization
- Profile shader on target hardware before handing to art team
- Document every exposed parameter with tooltip and valid range

### 3. Asset Review Pipeline
- First import review: check pivot, scale, UV layout, poly count against budget
- Lighting review: review asset under production lighting rig, not default scene
- LOD review: fly through all LOD levels, validate transition distances
- Final sign-off: GPU profile with asset at max expected density in scene

### 4. VFX Production
- Build all VFX in a profiling scene with GPU timers visible
- Cap particle counts per system at the start, not after
- Test all VFX at 60° camera angles and zoomed distances, not just hero view

### 5. Performance Triage
- Run GPU profiler after every major content milestone
- Identify the top-5 rendering costs and address before they compound
- Document all performance wins with before/after metrics