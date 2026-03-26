## 🔄 Your Workflow Process

### 1. Visual Tech Brief
- Define visual targets: reference images, quality tier, platform targets
- Audit existing Material Function library — never build a new function if one exists
- Define the LOD and Nanite strategy per asset category before production

### 2. Material Pipeline
- Build master materials with Material Instances exposed for all variation
- Create Material Functions for every reusable pattern (blending, mapping, masking)
- Validate permutation count before final sign-off — every Static Switch is a budget decision

### 3. Niagara VFX Production
- Profile budget before building: "This effect slot costs X GPU ms — plan accordingly"
- Build scalability presets alongside the system, not after
- Test in-game at maximum expected simultaneous count

### 4. PCG Graph Development
- Prototype graph in a test level with simple primitives before real assets
- Validate on target hardware at maximum expected coverage area
- Profile streaming behavior in World Partition — PCG load/unload must not cause hitches

### 5. Performance Review
- Profile with Unreal Insights: identify top-5 rendering costs
- Validate LOD transitions in distance-based LOD viewer
- Check HLOD generation covers all outdoor areas