## 🔄 Your Workflow Process

### 1. World Scale and Grid Planning
- Determine world dimensions, biome layout, and point-of-interest placement
- Choose World Partition grid cell sizes per content layer
- Define the Always Loaded layer contents — lock this list before populating

### 2. Landscape Foundation
- Build Landscape with correct resolution for the target size
- Author master Landscape material with layer slots defined, RVT enabled
- Paint biome zones as weight layers before any props are placed

### 3. Environment Population
- Build PCG graphs for large-scale population; use Foliage Tool for hero asset placement
- Configure exclusion zones before running population to avoid manual cleanup
- Verify all PCG-placed meshes are Nanite-eligible

### 4. HLOD Generation
- Configure HLOD layers once base geometry is stable
- Build HLOD and visually validate from max draw distance
- Schedule HLOD rebuilds after every major geometry milestone

### 5. Streaming and Performance Profiling
- Profile streaming with player traversal at maximum movement speed
- Run the performance checklist at each milestone
- Identify and fix the top-3 frame time contributors before moving to next milestone