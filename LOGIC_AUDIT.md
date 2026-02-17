# Chess Time-Travel Game Logic Audit

**Audit Date:** 2026-02-16
**File Reviewed:** `/Users/sven/code/chess/src/game.ts`
**Supporting Files:** `src/types/game.ts`, `src/board3d.ts`

---

## Executive Summary

This audit reviews the game logic for a 6D chess variant with time travel and multiverse branching. The implementation has several critical and medium severity bugs that could lead to game state corruption, invalid moves being allowed, or inconsistent behavior across timelines. The recently fixed issues (king capture prevention and notation) are correctly implemented.

---

## Bugs Found

### Critical Severity

#### 1. Turn Desynchronization After Time Travel
**Location:** `_makeTimeTravelMove()` (lines 1070-1252)

**Issue:** When a piece time travels, the source timeline's turn is flipped (via `_modifyFen`), and a new timeline is created. However, the new timeline inherits the historical FEN's turn (from the snapshot), then the time-traveled piece is placed with `chess.put()` which does NOT flip the turn. The comment at line 1183-1185 acknowledges this but the handling is incomplete.

**Problem:** After time travel:
- Source timeline: Turn is flipped (correct - piece moved away)
- New timeline: Turn is NOT properly set. The FEN has the historical turn, but a "move" was made (piece arrived), so the turn should be the opposite color.

**Impact:** The wrong player might be allowed to move on the new timeline.

**Evidence:**
```typescript
// Line 1183-1185:
// Note: We don't flip the turn here because chess.load() would reject
// the 2-queen FEN. The turn tracking is handled by our moveHistory,
// but the opponent will play next on this timeline.
```
But `moveHistory` is used for notation only, not for determining whose turn it is. The actual turn is determined by `chess.turn()`.

---

#### 2. Cross-Timeline Move Turn Validation Missing
**Location:** `getCrossTimelineTargets()` (lines 882-932) and `makeCrossTimelineMove()` (lines 935-1017)

**Issue:** The target timeline validation only checks if it's the piece's color's turn on the target timeline (line 893), but after the cross-timeline move is made, BOTH timelines have their turns flipped. This means:
- If White moves a queen cross-timeline, both source and target become Black's turn
- But the validation requires target to already be White's turn

This creates a logical inconsistency where a cross-timeline move can only happen when timelines are synchronized but the sync check is too restrictive.

**Impact:** Cross-timeline moves might be impossible in valid situations or allowed in invalid ones depending on how timeline synchronization is defined.

---

#### 3. FEN Modification Can Corrupt Castling Rights
**Location:** `_modifyFen()` (lines 1255-1334)

**Issue:** The `_modifyFen()` function only modifies the board position and turn (fields 0 and 1 of FEN), preserving the rest. However, if a king or rook is removed/added via time travel, the castling rights (field 2) are NOT updated accordingly.

**Example Scenario:**
1. White rook time travels away from a1
2. FEN still shows `KQkq` castling rights
3. chess.js might allow castling with a non-existent rook

**Impact:** Illegal castling could be allowed, or the game could enter an invalid state.

---

#### 4. En Passant Not Reset After Time Travel
**Location:** `_modifyFen()` (lines 1255-1334)

**Issue:** The en passant square (FEN field 3) is preserved when modifying FEN for time travel/cross-timeline moves. If a pawn moved two squares in the historical position, that en passant opportunity would persist incorrectly on the new timeline.

**Impact:** Invalid en passant captures could be allowed on branched timelines.

---

### Medium Severity

#### 5. Halfmove Clock Not Updated
**Location:** `_modifyFen()` (lines 1255-1334)

**Issue:** The halfmove clock (FEN field 4) for the 50-move rule is not reset or updated when a time-travel capture occurs. If a piece time travels and captures, this should reset the halfmove clock to 0.

**Impact:** 50-move rule draws could be incorrectly triggered or not triggered.

---

#### 6. Draw Detection Across Timelines Incomplete
**Location:** `updateStatus()` (lines 1542-1566) and rendering logic

**Issue:** Draw conditions (`in_draw()`, `in_stalemate()`) are only checked on the currently active timeline. In this multiverse chess variant, the game end conditions are ambiguous:
- If one timeline is checkmate but others are active, is the game over?
- If all timelines for one color are in stalemate, is it a draw?

**Impact:** No global game-over detection exists. The game continues indefinitely even if all meaningful play has ended.

---

#### 7. Snapshot Index Calculation Inverted
**Location:** `_getTimeTravelTargets()` (lines 1022-1067) and `_makeTimeTravelMove()` (line 1084)

**Issue:** The mapping between `turnIndex` and `snapshotIdx` is confusing and potentially error-prone:
```typescript
// _getTimeTravelTargets: turnIndex = snapshots.length - 2 - snapshotIdx
// _makeTimeTravelMove:   snapshotIdx = snapshots.length - 2 - targetTurnIndex
```

This inversion relationship is correct mathematically but fragile. Any off-by-one error would cause time travel to target the wrong historical state.

**Impact:** If the relationship breaks, pieces would arrive at wrong points in time.

---

#### 8. Promotion Piece Type Not Validated in Time Travel
**Location:** Move replay in `_forkTimeline()` (lines 717-804) and `_makeTimeTravelMove()` (lines 1098-1111)

**Issue:** When replaying moves to rebuild FEN (fallback path), the code does:
```typescript
forkChess.move({ from: histMove.from, to: histMove.to, promotion: histMove.promotion || undefined });
```

If `histMove.promotion` is `null` (not `undefined`), this could cause issues. The type definition shows `promotion?: PieceType | null`, so `null` is possible.

**Impact:** Rare edge case where promotion moves might fail during timeline forking.

---

#### 9. Cross-Timeline Selection State Persists After Failed Move
**Location:** `_handleBoardClick()` (lines 640-708)

**Issue:** If a cross-timeline selection exists but the user clicks on an invalid target, the selection state (`crossTimelineSelection`) is not cleared. The user would need to deselect manually or click their own piece.

**Impact:** Confusing UX - purple highlight targets remain visible after clicking elsewhere.

---

### Low Severity

#### 10. Piece Character Lookup Inconsistency
**Location:** `_makeTimeTravelMove()` line 1127 and `makeCrossTimelineMove()` line 974

**Issue:** Time travel notation uses `piece.type.toUpperCase()` to get the piece character:
```typescript
const pieceChar = piece.type.toUpperCase();  // 'Q' for queen
```

But cross-timeline notation hardcodes 'Q':
```typescript
san: `Q${square}→T${targetTimelineId}`,  // Always 'Q' regardless of piece type
```

Currently only queens can move cross-timeline, but if this is extended to other pieces, the notation would be wrong.

**Impact:** Incorrect notation if non-queen pieces are allowed to cross timelines in the future.

---

#### 11. History Layer Limit Could Lose Critical State
**Location:** `TimelineCol.addSnapshot()` in `board3d.ts` (lines 396-408)

**Issue:** History layers are capped at `MAX_LAYERS = 12`. When exceeded, old layers are removed. This is a visual limit, but time travel targets are calculated from the game state snapshots, not the visual layers.

However, the visual turn index mapping (`turnIndex`) is based on visual history layers, not game snapshots. If a game has 20 moves but only 12 visual layers, clicking on visual layer 11 might not map to the correct snapshot.

**Impact:** Long games might have broken time travel UI targeting.

---

#### 12. Race Condition in Promotion Flow
**Location:** `makeMove()` (lines 807-872)

**Issue:** When a promotion move is detected, `pendingPromotion` is set and execution returns early. If another move is attempted before the user picks a promotion piece, `pendingPromotion` would be overwritten without proper cleanup.

**Impact:** Edge case - rapid clicking could lose promotion state.

---

#### 13. CPU Mode Can Overflow Timeline Limit
**Location:** `_cpuTick()` (lines 1878-1917) and `_cpuMakeMove()` (lines 1937-1984)

**Issue:** The timeline limit check is:
```typescript
if (Object.keys(this.timelines).length < this.maxTimelines) {
  const timeTravelMove = this._cpuCheckTimeTravel(tlId);
```

This is checked before calling `_makeTimeTravelMove()`, but `_makeTimeTravelMove()` creates a new timeline. If exactly at `maxTimelines - 1`, this will create timeline `maxTimelines`. There's no issue here, but if `_makeTimeTravelMove` is called from elsewhere without this check, it could exceed limits.

**Impact:** Minor - limit is advisory, not enforced at creation.

---

## Edge Cases Needing Attention

### 1. Check/Checkmate Detection Across Timelines
When a piece time travels and lands on a new timeline, the code does not verify whether this puts the opponent in check. The `chess.js` library will handle check detection on subsequent move attempts, but the status UI won't immediately show "Check!" after a time travel move that creates check.

### 2. Stalemate by Time Travel Departure
If a player time travels their only mobile piece away, leaving them in stalemate, this is not immediately detected or announced.

### 3. Multiple Queens Legal Position
The code correctly uses `chess.put()` instead of `chess.load()` to allow positions with multiple queens after time travel. However, `chess.put()` does no validation - you could theoretically place 9 queens this way.

### 4. Snapshot Format Migration
The code handles both old (array) and new (object with FEN) snapshot formats via `_getSnapshotBoard()` and `_getSnapshotFen()`. However, if a game is saved with old format snapshots and loaded later, time travel to those snapshots would use the fallback FEN reconstruction path, which could fail if move history is incomplete.

### 5. Empty Timeline After Departure
After a cross-timeline move or time travel departure, if the piece was the only piece on the source timeline, the timeline continues to exist with just a king (if any). No cleanup or game-over detection occurs.

### 6. Self-Capture Prevention
The code correctly prevents capturing your own pieces in time travel targets (line 1051):
```typescript
if (!targetPiece || (targetPiece.color !== piece.color && targetPiece.type !== 'k')) {
```
However, the logic for cross-timeline is:
```typescript
if (targetPiece && targetPiece.color === sourceColor) continue;  // Can't move if own piece
if (targetPiece && targetPiece.type === 'k') continue;           // Can't capture kings
```
These are correctly separate checks.

---

## Recommended Fixes

### High Priority

1. **Fix turn handling in time travel:** After placing the time-traveled piece on the new timeline, explicitly set the turn to the opposite color using a modified FEN or by calling an internal chess.js method if available.

2. **Update castling rights in `_modifyFen()`:** When removing/adding kings or rooks, update the castling rights field accordingly.

3. **Reset en passant in time travel:** Clear the en passant field when creating FEN for a new timeline branch.

4. **Add global game-over detection:** Implement logic to check if the game is over across all timelines (e.g., if all of one color's kings are checkmated or all timelines are drawn).

### Medium Priority

5. **Update halfmove clock on time travel captures:** Reset to 0 when a capture occurs via time travel.

6. **Add validation for snapshot index calculations:** Add assertions or runtime checks to verify that turnIndex/snapshotIdx mappings are within bounds.

7. **Clear cross-timeline selection on invalid click:** Add explicit cleanup when user clicks on non-target squares.

### Low Priority

8. **Generalize cross-timeline notation:** Use the actual piece type in SAN notation instead of hardcoded 'Q'.

9. **Add timeline creation guard:** Enforce `maxTimelines` at the `_createTimeline()` level, not just in CPU mode.

10. **Consider snapshot persistence:** Store FEN in all snapshots to eliminate the fallback reconstruction path.

---

## Verification Checklist

- [ ] Time travel correctly switches turns on both source and destination timelines
- [ ] Cross-timeline moves correctly handle turn synchronization
- [ ] Castling rights are invalidated when relevant pieces time travel
- [ ] En passant is properly reset on timeline branches
- [ ] 50-move rule is tracked correctly with time travel captures
- [ ] Game-over conditions are detected across all timelines
- [ ] Long games (>12 moves) have correct time travel targeting
- [ ] Promotion works correctly in all time travel scenarios
- [ ] Check/checkmate is immediately detected after time travel

---

## Appendix: Code Quality Notes

### Positive Observations
- Good separation of concerns between `GameManager` and `Board3D`
- Comprehensive type definitions in `types/game.ts`
- Snapshot consistency validation via `_validateSnapshotConsistency()`
- Defensive FEN validation in `_modifyFen()`
- Clear debug logging throughout time travel logic

### Areas for Improvement
- Consider extracting FEN manipulation into a dedicated utility class
- Add unit tests for edge cases documented above
- Consider using a state machine for selection/move phases
- Move CPU logic into a separate module
