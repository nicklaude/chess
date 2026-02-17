# 6D Chess Test Plan

## Phase 0: Baseline Health Check

### Test 0.1: Board Rendering
- [ ] Board renders with 64 squares visible
- [ ] Pieces in correct starting positions
- [ ] White pieces on ranks 1-2, black on ranks 7-8
- [ ] Square colors alternate correctly

### Test 0.2: Basic Piece Selection
- [ ] Click white pawn e2 - yellow highlight appears on square
- [ ] Yellow dots show valid move squares (e3, e4)
- [ ] Click elsewhere - highlight clears
- [ ] Cannot select black pieces (opponent's turn)

### Test 0.3: Basic Move Execution
- [ ] Click e2, click e4 - pawn moves
- [ ] History layer appears below current board
- [ ] Move list shows "1. e4"
- [ ] Turn indicator changes to "Black to move"

### Test 0.4: Captures
- [ ] Make moves to set up a capture (e.g., e4, d5, exd5)
- [ ] Captured piece disappears
- [ ] Capturing piece appears on destination square
- [ ] Move notation shows "exd5"

## Phase 1: Time Travel Mechanics

### Test 1.1: Queen Movement Setup
Prerequisites: Start new game, make opening moves to free queen
```
Moves: e4, e5, Qh5
```
- [ ] Queen appears on h5
- [ ] History layers show previous positions

### Test 1.2: Time Travel Target Detection
- [ ] Click queen on h5
- [ ] Yellow dots show normal move squares
- [ ] Cyan portal rings appear on history boards below
- [ ] Portals appear on h5 square in each history layer

### Test 1.3: Time Travel Execution
- [ ] Click a cyan portal (e.g., turn 1 after e4)
- [ ] Console shows "[Time Travel]" logs
- [ ] New timeline (Branch 1) appears to the side
- [ ] Branch 1 board shows position from that turn WITH queen added
- [ ] Main timeline board shows queen REMOVED
- [ ] Cyan time travel line connects the timelines
- [ ] Timeline list shows "Branch 1"

### Test 1.4: Time Travel Edge Cases
- [ ] Time travel from move 1: only initial position portal shows
- [ ] Time travel to capture: red ring on portal if enemy piece there
- [ ] Multiple time travels: can create Branch 2, Branch 3, etc.

## Phase 2: Cross-Timeline Movement

### Test 2.1: Cross-Timeline Setup
Prerequisites: Two timelines at same move count
```
1. Create Branch 1 via time travel
2. Make moves on both timelines until they have equal move count
```

### Test 2.2: Cross-Timeline Target Detection
- [ ] Select queen on one timeline
- [ ] Purple rings appear on same square in other timeline
- [ ] Purple rings only show if:
  - Same move count on both timelines
  - It's your turn on target timeline
  - Square is empty or has enemy piece

### Test 2.3: Cross-Timeline Execution
- [ ] Click purple ring on other timeline
- [ ] Queen moves between timelines
- [ ] Purple line shows cross-timeline movement
- [ ] Move recorded on BOTH timelines

## Phase 3: UI/UX Verification

### Test 3.1: Timeline Navigation
- [ ] Tab key cycles between timelines
- [ ] Clicking timeline in sidebar switches to it
- [ ] Active timeline has visual indicator (glow)

### Test 3.2: Move History Navigation
- [ ] Arrow keys navigate through moves
- [ ] Slider moves through history
- [ ] Home/End go to first/last move

### Test 3.3: Camera Controls
- [ ] WASD pans camera
- [ ] Q/E zooms in/out
- [ ] Mouse drag rotates view
- [ ] Space flips board perspective
- [ ] F focuses on active timeline
- [ ] C resets camera

## Phase 4: Visual Polish & Move List Fix

### Test 4.1: Softer Move Lines
Prerequisites: Make several moves to see move lines
- [ ] In-board move lines (red/blue on current board) are soft and muted
- [ ] Lines use lighter, desaturated colors (not harsh bright blue/red)
- [ ] Lines are thin with minimal glow
- [ ] Lines don't visually overpower the pieces

### Test 4.2: Softer Inter-Layer Lines
- [ ] Vertical lines connecting history layers are visible but not harsh
- [ ] Lines use lighter cyan/orange tones
- [ ] Time travel and branch lines remain bright (those are important)

### Test 4.3: Move List Per Timeline
Prerequisites: Create 2+ timelines via time travel
- [ ] Switch between timelines using Tab key
- [ ] Move list updates correctly for each timeline
- [ ] Move count in timeline panel is accurate per timeline
- [ ] Playing a move on timeline A doesn't reset timeline B's move list
- [ ] Move list shows custom notation for time travel (⟳)

### Test 4.4: State Consistency
- [ ] After time travel, can switch back to original timeline
- [ ] Original timeline state unchanged
- [ ] Can continue playing on both timelines

## Phase 5: CPU Auto-Play Mode

### Test 5.1: CPU UI Controls
- [ ] "Start CPU" button visible in sidebar button row
- [ ] Clicking toggles to "Stop CPU" when active (green highlight)
- [ ] Speed slider visible (100-2000ms range)
- [ ] Portal bias slider visible (0-100% range)
- [ ] "Camera Follow: ON/OFF" toggle button visible

### Test 5.2: Basic CPU Play
- [ ] Click "Start CPU" → moves happen automatically
- [ ] Both white and black move (alternating)
- [ ] Move pace matches speed slider value
- [ ] Click "Stop CPU" → moves stop immediately

### Test 5.3: Speed Control
- [ ] Drag speed slider left (100ms) → moves are very fast
- [ ] Drag speed slider right (2000ms) → moves are slow
- [ ] Speed changes take effect immediately

### Test 5.4: Portal Awareness
- [ ] Set portal bias to 100% → CPU uses time travel frequently
- [ ] Set portal bias to 0% → CPU never uses time travel
- [ ] CPU creates new timelines via queen time travel
- [ ] Timeline limit (10 max) prevents infinite branching
- [ ] Console shows "[CPU] Time traveling!" when portal used

### Test 5.5: Camera Follow
- [ ] Camera Follow ON → camera smoothly animates to active timeline
- [ ] Click "Camera Follow: OFF" → camera stays in place
- [ ] Pan manually (drag) → camera follow auto-disables
- [ ] Camera follow toggle button reflects current state

### Test 5.6: Multi-Timeline Play
- [ ] CPU plays on multiple timelines when they exist
- [ ] CPU switches between timelines (visible in sidebar highlight)
- [ ] Game continues even after checkmate on one timeline
- [ ] All playable timelines get CPU moves

### Test 5.7: Capture Preference
- [ ] CPU tends to capture pieces when available (~70%)
- [ ] CPU doesn't always capture (some randomness)

## Error Handling

### Test 6.1: Invalid FEN Recovery
- [ ] If FEN generation fails, game doesn't crash
- [ ] Console shows error message
- [ ] Game state remains playable

## Console Debug Checklist

When testing time travel, verify these console logs appear:

```
[Time Travel] snapshotIdx: <number>
[Time Travel] targetSnapshot: {...}
[Time Travel] FEN from snapshot: <fen string>
[Time Travel] Creating new timeline: {...}
[_modifyFen] Result: {input: <fen>, output: <fen>, ...}
```

If `[_modifyFen] Generated invalid FEN!` appears, that's the bug.

## Known Issues

1. **Empty board on new timeline** - FEN modification may be producing invalid FEN
   - Check console for `[_modifyFen] Generated invalid FEN!`
   - Check that `[Time Travel] FEN from snapshot:` shows valid FEN

## Test Commands (for programmatic testing)

When text input is added, use these commands:
```
move e2e4     - Make a move
select d1     - Select piece on square
timetravel 2  - Time travel to turn 2
switch 1      - Switch to timeline 1
fen           - Show current FEN
```
