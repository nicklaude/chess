# 6D Chess Performance Optimization Plan

## Current Architecture Analysis

### Identified Bottlenecks

1. **Per-Timeline Overhead (Critical)**
   - Each timeline creates full 8x8 board with 64 square meshes + labels
   - Each history layer creates another 64 square meshes + base + sprites
   - With 10 timelines × 12 history layers × 64 squares = 7,680 meshes just for squares
   - Plus pieces, labels, effects, lines

2. **Render Loop Issues**
   - `requestAnimationFrame` loops continuously at 60fps even when nothing changes
   - Every frame traverses all timeline groups to pulse branch lines
   - Particle system updates all 400 particles every frame
   - No batching of draw calls

3. **Memory Pressure**
   - Each texture (piece/label) is unique canvas texture
   - No texture atlas - each sprite is separate material
   - History layers kept indefinitely up to MAX_LAYERS

4. **Object Creation Churn**
   - New Vector3 objects created frequently in `_sqToWorld`, `_fromSq`, etc.
   - New materials created per mesh rather than shared

5. **Raycasting Cost**
   - Click handler collects ALL meshes from all timelines into array
   - Linear search through all square meshes for each click

## Optimization Strategies

### Phase 1: Quick Wins (Low Risk, Measurable Impact)

#### 1.1 Add Render-on-Demand
```typescript
// Only re-render when state changes
private _needsRender = true;

// In animate loop:
if (this._needsRender || this._activeEffects.length > 0 || this._focusTween) {
  this.renderer.render(this.scene, this.camera);
  this._needsRender = false;
}

// Mark dirty when state changes
markDirty() { this._needsRender = true; }
```

#### 1.2 Share Materials
```typescript
// Create once, reuse
private _lightSquareMat: MeshStandardMaterial;
private _darkSquareMat: MeshStandardMaterial;
private _historyLightSquareMat: MeshStandardMaterial;
// etc.
```

#### 1.3 Object Pooling for Vectors
```typescript
// Reusable scratch vectors
private _tempVec3A = new THREE.Vector3();
private _tempVec3B = new THREE.Vector3();
```

#### 1.4 Optimize Piece Textures
- Create texture atlas with all 12 piece types
- Use UV coordinates instead of separate textures

### Phase 2: Structural Improvements (Medium Risk)

#### 2.1 Instanced Rendering for Squares
```typescript
// Instead of 64+ individual meshes per board:
const squareGeometry = new THREE.PlaneGeometry(0.96, 0.96);
const instancedMesh = new THREE.InstancedMesh(squareGeometry, material, 64);
// Set per-instance transforms and colors
```

#### 2.2 Batch Branch/Move Lines
- Create single BufferGeometry with all lines
- Update only changed segments

#### 2.3 LOD for History Layers
- Distant history: single flat plane with baked texture
- Recent history: full detail
- Cull history layers outside camera frustum

#### 2.4 Spatial Index for Raycasting
```typescript
// Organize by screen region or octree
// Only test meshes in relevant spatial cell
```

### Phase 3: Architecture Changes (Higher Risk, Maximum Impact)

#### 3.1 Chunk-Based Dirty Tracking (from clawd)
```typescript
// Track which regions need updates
class DirtyTracker {
  private _dirtyTimelines = new Set<number>();

  markTimelineDirty(id: number) {
    this._dirtyTimelines.add(id);
    this._needsRender = true;
  }

  flushDirty() {
    for (const id of this._dirtyTimelines) {
      this._updateTimeline(id);
    }
    this._dirtyTimelines.clear();
  }
}
```

#### 3.2 OffscreenCanvas for History Thumbnails
- Render history boards to 2D canvas off main thread
- Display as single textured plane

#### 3.3 WebWorker for Chess Logic
- Move chess.js computation to worker
- Post messages for state updates
- Main thread only handles rendering

### Phase 4: ECS Architecture (Optional, Major Refactor)

Based on clawd patterns, could restructure as:
- Components: Position, Piece, BoardMaterial, HistoryLayer, etc.
- Systems: MoveSystem, RenderSystem, AnimationSystem
- Entities: Each square, piece, timeline as entity

Benefits:
- Cache-friendly iteration
- Easy parallel processing
- Clear separation of concerns

Trade-offs:
- Significant rewrite
- Learning curve
- May be overkill for this scale

## Implementation Priority

1. **Immediate (PR #18)**: 1.1 + 1.2 + 1.3
   - Add render-on-demand flag
   - Share materials
   - Pool vectors
   - Expected: 30-50% FPS improvement with many timelines

2. **Short-term (PR #19)**: 1.4 + 2.1
   - Texture atlas
   - Instanced meshes
   - Expected: 2-3x object count reduction

3. **Medium-term**: 2.2 + 2.3 + 2.4
   - Batched lines
   - LOD system
   - Spatial index

4. **Long-term consideration**: 3.x / 4.x
   - Only if needed for scale

## Benchmarking Plan

1. Add FPS counter to UI (show in sidebar)
2. Stress test scenarios:
   - 5 timelines, 50 moves each
   - 10 timelines, 12 history layers each
   - Rapid CPU vs CPU
3. Profile with Chrome DevTools:
   - Timeline: Frame duration
   - Memory: Heap snapshots
   - Performance: Function timing

## Related Files

- `src/board3d.ts` - Main rendering, primary optimization target
- `src/game.ts` - Game logic, potential worker candidate
- `src/types.ts` - May need new types for optimization
- `index.html` - Add FPS counter element

## Notes

- Three.js r128+ has built-in instancing optimizations
- Consider `three-mesh-bvh` for raycasting optimization
- Stats.js can provide quick FPS monitoring during development
