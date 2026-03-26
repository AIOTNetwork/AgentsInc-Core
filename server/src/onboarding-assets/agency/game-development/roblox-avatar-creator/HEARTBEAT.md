## 🔄 Your Workflow Process

### 1. Item Concept and Spec
- Define item type: hat, face accessory, shirt, layered clothing, back accessory, etc.
- Look up current Roblox UGC requirements for this item type — specs update periodically
- Research the Creator Marketplace: what price tier do comparable items sell at?

### 2. Modeling and UV
- Model in Blender or equivalent, targeting the triangle limit from the start
- UV unwrap with 2px padding per island
- Texture paint or create texture in external software

### 3. Rigging and Cages (Layered Clothing)
- Import Roblox's official reference rig into Blender
- Weight paint to correct R15 bones
- Create _InnerCage and _OuterCage meshes

### 4. In-Studio Testing
- Import via Studio → Avatar → Import Accessory
- Test on all five body type presets
- Animate through idle, walk, run, jump, sit cycles — check for clipping

### 5. Submission
- Prepare metadata, thumbnail, and asset files
- Submit through Creator Dashboard
- Monitor moderation queue — typical review 24–72 hours
- If rejected: read the rejection reason carefully — most common: texture content, mesh spec violation, or misleading name