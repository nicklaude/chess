# 6D Chess - Updated Phased Development Plan

Last Updated: February 2026

---

## Current State Summary

The game has:
- Fully working cross-timeline movement (all pieces except King)
- Time travel mechanics (Q, R, B, N can go back in time)
- CPU auto-play mode with portal awareness
- Move indicators for same-board moves (green/yellow dots)
- Cross-timeline indicators (purple rings) when selecting a piece
- Time travel indicators (cyan-green portals) on history boards

---

## Phase 1: Cross-Board Move Indicators for Human Players

**Priority: HIGH**
**Effort: Medium (3-5 hours)**

### Problem
When a human player selects a piece that can move cross-timeline, the current system only shows:
1. Regular move indicators on the SAME board
2. Cross-timeline target indicators appear on OTHER boards

However, it's not immediately clear to players:
- WHICH boards they can move to
- WHERE on those boards (the purple indicators are easy to miss)
- That cross-timeline moves are even possible

### Solution
Add more prominent visual indicators on adjacent/eligible timelines:

#### 1.1 Highlight Eligible Timeline Boards
When a piece with cross-timeline capability is selected:
- Add a **glowing border effect** around boards that are valid targets
- Use the portal purple color (`0xaa44ff`) consistently
- Animate the border with a subtle pulse

**Technical Approach:**
```typescript
// In TimelineCol class
showCrossTimelineEligible(): void {
  // Add purple glowing outline to the board base
  // Animate with TWEEN or requestAnimationFrame pulse
}

clearCrossTimelineEligible(): void {
  // Remove the glow effect
}
```

**Files to modify:**
- `src/board3d.ts`: Add board-level glow effect methods
- `src/game.ts`: Call these when cross-timeline selection is active

#### 1.2 Larger Cross-Timeline Target Indicators
Make the existing target indicators more visible:
- Increase ring size from 0.28-0.48 to 0.35-0.55
- Add a vertical beam/pillar effect above the target square
- Make the glow more prominent

**Technical Approach:**
```typescript
// In SharedResources, increase sizes:
this.crossTimelineRingSmall = new THREE.RingGeometry(0.35, 0.45, 32);
this.crossTimelineRingLarge = new THREE.RingGeometry(0.45, 0.55, 32);

// Add vertical beam geometry
this.crossTimelineBeam = new THREE.CylinderGeometry(0.08, 0.08, 0.8, 8);
```

#### 1.3 Visual Connection Line Preview
When hovering over a cross-timeline target:
- Show a preview of the portal line that will be drawn
- Dashed/transparent version of the final line

**Files to modify:**
- `src/board3d.ts`: Add hover preview line rendering
- `src/game.ts`: Handle hover events for cross-timeline targets

### Dependencies
- None (builds on existing cross-timeline system)

### Testing
- Select a piece with cross-timeline options
- Verify all eligible boards show purple glow
- Verify target squares are clearly visible
- Verify clicking target executes move correctly

---

## Phase 2: CPU Move Visualization

**Priority: HIGH**
**Effort: Medium (2-4 hours)**

### Problem
When CPU makes cross-board or time-travel moves, they happen instantly with no visual indication of what's about to happen. This makes it hard for players to:
- Understand what the CPU is doing
- Learn the game's cross-timeline mechanics
- Follow the action in CPU vs CPU mode

### Solution
Add a preview phase before CPU executes special moves:

#### 2.1 CPU Move Preview System
```typescript
interface CPUMovePreview {
  type: 'normal' | 'crossTimeline' | 'timeTravel';
  sourceTimelineId: number;
  sourceSquare: Square;
  targetTimelineId?: number;  // For cross-timeline
  targetSquare: Square;
  previewDuration: number;    // ms
}
```

#### 2.2 Preview Animation Sequence
For cross-timeline moves:
1. **Highlight source piece** (0.3s) - pulse/glow the piece
2. **Show target indicators** (0.5s) - display the purple circles on target board
3. **Draw preview line** (0.3s) - animate the portal line
4. **Execute move** - normal move execution
5. **Clear previews** - clean up

For time-travel moves:
1. **Highlight source piece** (0.3s)
2. **Camera pan to history** (0.3s) - if needed
3. **Show portal target** (0.5s) - cyan-green indicators
4. **Execute move** - creates new timeline
5. **Camera follow to new timeline** (0.3s)

**Technical Approach:**
```typescript
// In game.ts, modify _cpuMakeMove:
private async _cpuMakeMoveWithPreview(tlId: number): Promise<boolean> {
  const move = this._selectCPUMove(tlId);
  if (!move) return false;

  if (move.type === 'crossTimeline') {
    await this._showCrossTimelinePreview(move);
    await this._delay(500);  // Preview duration
    this._executeCrossTimelineMove(move);
  } else if (move.type === 'timeTravel') {
    await this._showTimeTravelPreview(move);
    await this._delay(500);
    this._executeTimeTravelMove(move);
  } else {
    // Normal move - can optionally show brief highlight
    this.makeMove(tlId, move.move);
  }
  return true;
}
```

**Files to modify:**
- `src/game.ts`: Add preview methods to CPU system
- `src/board3d.ts`: Add piece highlighting/pulsing methods

#### 2.3 Preview Timing Controls
Add UI controls for preview behavior:
- "Show CPU Move Preview" toggle
- Preview speed slider (0.5x to 2x)

### Dependencies
- Phase 1 indicators (reuse cross-timeline highlighting)

### Testing
- Enable CPU mode
- Watch for cross-timeline moves
- Verify preview shows before execution
- Verify camera follows appropriately
- Test with various speeds

---

## Phase 3: Timeline Navigation Improvements

**Priority: MEDIUM**
**Effort: Medium (3-4 hours)**

### Problem
With many timelines, it's hard to:
- Understand which timelines are related (parent/child)
- Navigate to specific timelines
- See the "family tree" structure

### Solution

#### 3.1 Timeline Tree Visualization
In the sidebar timeline panel:
- Show indentation for child timelines
- Draw connection lines between parent/child
- Color-code by "family" (all descendants of a branch)

```html
<div class="timeline-tree">
  <div class="timeline-item active" data-id="0">
    Main
    <div class="timeline-children">
      <div class="timeline-item" data-id="1">
        Branch 1
        <div class="timeline-children">
          <div class="timeline-item" data-id="3">Branch 1.1</div>
        </div>
      </div>
      <div class="timeline-item" data-id="2">Branch 2</div>
    </div>
  </div>
</div>
```

#### 3.2 Minimap View
Add a small overhead map showing all timelines:
- Top-down view of timeline arrangement
- Clickable to jump to timeline
- Shows which timelines are playable (same turn)

#### 3.3 Timeline Relationship Lines in 3D
Draw subtle vertical lines connecting:
- Parent timeline to child timeline branch point
- Use timeline-specific colors

**Files to modify:**
- `src/game.ts`: Tree generation logic
- `css/style.css`: Tree styling
- `index.html`: Panel structure
- `src/board3d.ts`: 3D relationship lines

### Dependencies
- None

### Testing
- Create multiple nested branches
- Verify tree structure is accurate
- Test navigation by clicking tree items
- Verify minimap updates correctly

---

## Phase 4: Game State Improvements

**Priority: MEDIUM**
**Effort: Low-Medium (2-3 hours)**

### 4.1 Win/Loss Conditions Across Timelines
Currently unclear when game ends with multiple timelines:
- Add "Victory" overlay when opponent has no playable timelines
- Show which king(s) are checkmated
- Option to continue playing remaining timelines

### 4.2 Move Undo System
- Track full move history with undo stack
- Undo button (or Ctrl+Z)
- Handle cross-timeline undo (restore both affected timelines)

### 4.3 Game Save/Load
- Export game state to JSON
- Import game state
- Store in localStorage for auto-resume

**Files to modify:**
- `src/game.ts`: Win detection, undo system, save/load
- `index.html`: UI buttons
- `css/style.css`: Victory overlay styling

### Dependencies
- None

---

## Phase 5: Visual Polish

**Priority: LOW**
**Effort: Medium (3-4 hours)**

### 5.1 Piece Movement Animations
- Animate pieces sliding from source to target
- For cross-timeline: piece "teleports" with particle effect
- For time-travel: piece "phases out" then "phases in"

### 5.2 Board Effects
- Add subtle ambient particles
- Improve lighting with time of day cycle
- Add board reflection/shadow effects

### 5.3 Sound Effects
- Move sounds
- Capture sounds
- Portal/time-travel sounds
- Check/checkmate sounds

**Files to modify:**
- `src/board3d.ts`: Animation system
- New file: `src/audio.ts` for sound management

### Dependencies
- Audio files (need to source/create)

---

## Phase 6: Multiplayer Foundation

**Priority: LOW**
**Effort: High (8-12 hours)**

### 6.1 Hotseat Mode
- Two-player on same device
- Clear turn indicator with player names
- Optional timer per player

### 6.2 Network Play Preparation
- Abstract game state for serialization
- Define message protocol
- Consider WebRTC for peer-to-peer

**Files to modify:**
- `src/game.ts`: Player abstraction
- New file: `src/network.ts`
- New file: `src/protocol.ts`

### Dependencies
- Phase 4 (save/load for state serialization)

---

## Implementation Order Recommendation

1. **Phase 1** - Cross-board move indicators (immediate UX improvement)
2. **Phase 2** - CPU move visualization (learning aid, spectator mode)
3. **Phase 4.1** - Win conditions (game completeness)
4. **Phase 3** - Timeline navigation (usability for complex games)
5. **Phase 4.2-4.3** - Undo and save/load (quality of life)
6. **Phase 5** - Visual polish (nice-to-have)
7. **Phase 6** - Multiplayer (future expansion)

---

## Technical Notes

### Color Palette Reference
- Portal purple: `0xaa44ff` / `#aa44ff`
- Time-travel cyan-green: `0x44ffaa` / `#44ffaa`
- Capture red: `0xff6666` / `#ff6666`
- Selection gold: `0xbba030` / `#bba030`
- Move indicator: `0xffdd44` / `#ffdd44`
- Last move blue: `0x4488ff` / `#4488ff`

### Existing Infrastructure to Leverage
- `meshPool` for efficient geometry reuse
- `SharedResources` for shared geometries/materials
- TWEEN.js for animations (imported but underutilized)
- Raycaster for click detection

### Performance Considerations
- Limit portal effects to 10 concurrent
- Use InstancedMesh for many similar objects
- Pool sprite/mesh creation
- Debounce hover events (already implemented for highlights)

---

## Open Questions

1. **Should cross-timeline moves be limited to adjacent timelines?**
   - Current: Any synced timeline is valid
   - Consider: Only timelines within 1-2 branches for clarity

2. **Should CPU preview be skippable?**
   - Current: No preview
   - Consider: Click anywhere to skip, or "instant" mode toggle

3. **Timeline limit behavior?**
   - Current: Configurable max timelines (default 20)
   - Consider: Warning when approaching limit, auto-cleanup of dead branches

---

## Appendix: Current File Structure

```
src/
  board3d.ts    # 3D rendering, TimelineCol, Board3DManager
  game.ts       # GameManager, CPU logic, move execution
  gameUtils.ts  # FEN manipulation, validation helpers
  main.ts       # Entry point
  types/
    game.ts     # Type definitions
    board3d.ts  # Board3D types
    index.ts    # Re-exports
```
