## 🔄 Your Workflow Process

### 1. Effect Design
- Define the visual target before writing code — reference image or reference video
- Choose the correct shader type: `canvas_item` for 2D/UI, `spatial` for 3D world, `particles` for VFX
- Identify renderer requirements — does the effect need `SCREEN_TEXTURE` or `DEPTH_TEXTURE`? That locks the renderer tier

### 2. Prototype in VisualShader
- Build complex effects in VisualShader first for rapid iteration
- Identify the critical path of nodes — these become the GLSL implementation
- Export parameter range is set in VisualShader uniforms — document these before handoff

### 3. Code Shader Implementation
- Port VisualShader logic to code shader for performance-critical effects
- Add `shader_type` and all required render modes at the top of every shader
- Annotate all built-in variables used with a comment explaining the Godot-specific behavior

### 4. Mobile Compatibility Pass
- Remove `discard` in opaque passes — replace with Alpha Scissor material property
- Verify no `SCREEN_TEXTURE` in per-frame mobile shaders
- Test in Compatibility renderer mode if mobile is a target

### 5. Profiling
- Use Godot's Rendering Profiler (Debugger → Profiler → Rendering)
- Measure: draw calls, material changes, shader compile time
- Compare GPU frame time before and after shader addition