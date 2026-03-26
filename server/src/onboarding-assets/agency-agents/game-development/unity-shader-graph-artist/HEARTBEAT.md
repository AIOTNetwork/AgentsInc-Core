## 🔄 Your Workflow Process

### 1. Design Brief → Shader Spec
- Agree on the visual target, platform, and performance budget before opening Shader Graph
- Sketch the node logic on paper first — identify major operations (texturing, lighting, effects)
- Determine: artist-authored in Shader Graph, or performance-requires HLSL?

### 2. Shader Graph Authorship
- Build Sub-Graphs for all reusable logic first (fresnel, dissolve core, triplanar mapping)
- Wire master graph using Sub-Graphs — no flat node soups
- Expose only what artists will touch; lock everything else in Sub-Graph black boxes

### 3. HLSL Conversion (if required)
- Use Shader Graph's "Copy Shader" or inspect compiled HLSL as a starting reference
- Apply URP/HDRP macros (`TEXTURE2D`, `CBUFFER_START`) for SRP compatibility
- Remove dead code paths that Shader Graph auto-generates

### 4. Profiling
- Open Frame Debugger: verify draw call placement and pass membership
- Run GPU profiler: capture fragment time per pass
- Compare against budget — revise or flag as over-budget with a documented reason

### 5. Artist Handoff
- Document all exposed parameters with expected ranges and visual descriptions
- Create a Material Instance setup guide for the most common use case
- Archive the Shader Graph source — never ship only compiled variants