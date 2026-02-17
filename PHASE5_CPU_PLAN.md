# Phase 5: CPU Auto-Play Mode

## Overview

Add a CPU vs CPU mode where the computer plays against itself, with awareness of time travel portals and cross-timeline moves. The goal is to create an interesting auto-playing system that uses the 6D mechanics to spawn multiple queens and create complex multiverse games.

## Key Challenges

1. **Weird FEN positions**: Time travel creates boards with 2+ queens, pieces appearing/disappearing
2. **Multiple timelines**: CPU needs to decide which timeline to play on
3. **Portal awareness**: CPU should recognize and sometimes use time travel portals
4. **Cross-timeline moves**: CPU should consider jumping between timelines

## Solution: chess.js skipValidation

```typescript
// chess.js accepts ANY FEN with skipValidation
const chess = new Chess(weirdFen, { skipValidation: true })
chess.load(twoQueensFen, { skipValidation: true })
```

This bypasses all validation, allowing:
- Multiple queens per side
- Pieces appearing/disappearing
- Any arbitrary board state from time travel

## Architecture

### CPU Manager Class

```typescript
class CPUManager {
  private enabled: boolean = false
  private moveDelay: number = 800 // ms between moves
  private portalBias: number = 0.3 // 30% chance to use portal when available

  // Entry point - called from UI
  start(): void
  stop(): void
  toggle(): void

  // Main loop
  private tick(): void

  // Decision making
  private selectTimeline(): number  // Which timeline to play on
  private selectMove(tlId: number): CPUMove  // What move to make

  // Move types
  private getNormalMoves(tlId: number): CPUMove[]
  private getTimeTravelMoves(tlId: number): CPUMove[]
  private getCrossTimelineMoves(tlId: number): CPUMove[]
}

interface CPUMove {
  type: 'normal' | 'timeTravel' | 'crossTimeline'
  timelineId: number
  move?: ChessMove  // for normal
  portal?: TimeTravelTarget  // for time travel
  crossTarget?: CrossTimelineMoveTarget  // for cross-timeline
  score: number
}
```

### Decision Flow

```
tick()
  ├─ Check if game over on all timelines
  ├─ selectTimeline() → pick a timeline where it's CPU's turn
  ├─ selectMove(tlId)
  │    ├─ Get all normal moves
  │    ├─ Get all time travel moves (if queen selected)
  │    ├─ Get all cross-timeline moves (if conditions met)
  │    ├─ Evaluate each move
  │    └─ Pick best (or weighted random for variety)
  └─ Execute the move
```

## Implementation Plan

### Step 1: Basic Infrastructure

1. Add `CPUManager` class to `game.ts` or new `cpu.ts`
2. Add "CPU Mode" button to sidebar
3. Add move delay slider (100ms - 2000ms)
4. Wire up start/stop/toggle

### Step 2: Timeline Selection

```typescript
private selectTimeline(): number {
  const playable: number[] = []
  const color = this.getCurrentColor() // whose turn globally

  for (const tlId in Game.timelines) {
    const tl = Game.timelines[tlId]
    if (tl.chess.turn() === color) {
      playable.push(parseInt(tlId))
    }
  }

  if (playable.length === 0) return -1

  // Prefer timelines with more activity, or random
  return playable[Math.floor(Math.random() * playable.length)]
}
```

### Step 3: Move Evaluation

Simple evaluation function (piece values + position):

```typescript
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }

private evaluateBoard(chess: ChessInstance): number {
  let score = 0
  const board = chess.board()

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c]
      if (!piece) continue
      const value = PIECE_VALUES[piece.type]
      score += piece.color === 'w' ? value : -value
    }
  }
  return score
}
```

### Step 4: Portal Awareness

```typescript
private getTimeTravelMoves(tlId: number): CPUMove[] {
  const moves: CPUMove[] = []
  const tl = Game.timelines[tlId]

  // Find all queens
  const board = tl.chess.board()
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c]
      if (piece?.type === 'q' && piece.color === tl.chess.turn()) {
        const square = toSquare(r, c)
        const targets = Game.getTimeTravelTargets(tlId, square, piece)

        for (const target of targets) {
          moves.push({
            type: 'timeTravel',
            timelineId: tlId,
            portal: target,
            score: this.scoreTimeTravel(target)
          })
        }
      }
    }
  }
  return moves
}

private scoreTimeTravel(target: TimeTravelTarget): number {
  let score = 50 // Base bonus for time travel (exciting!)
  if (target.isCapture) score += PIECE_VALUES[target.capturedPiece.type]
  // Prefer going further back (more disruption)
  score += target.targetTurnIndex * 10
  return score
}
```

### Step 5: Move Selection

```typescript
private selectMove(tlId: number): CPUMove | null {
  const normalMoves = this.getNormalMoves(tlId)
  const timeTravelMoves = this.getTimeTravelMoves(tlId)
  const crossTimelineMoves = this.getCrossTimelineMoves(tlId)

  const allMoves = [...normalMoves, ...timeTravelMoves, ...crossTimelineMoves]
  if (allMoves.length === 0) return null

  // Sort by score
  allMoves.sort((a, b) => b.score - a.score)

  // Sometimes pick portal even if not best (for fun)
  if (timeTravelMoves.length > 0 && Math.random() < this.portalBias) {
    return timeTravelMoves[Math.floor(Math.random() * timeTravelMoves.length)]
  }

  // Pick from top moves with some randomness
  const topMoves = allMoves.slice(0, 3)
  return topMoves[Math.floor(Math.random() * topMoves.length)]
}
```

### Step 6: UI Integration

```html
<!-- Add to sidebar -->
<div id="cpu-panel">
  <button id="cpu-toggle">Start CPU Mode</button>
  <div id="cpu-controls" style="display:none">
    <label>Speed: <input type="range" id="cpu-speed" min="100" max="2000" value="800"></label>
    <label>Portal Bias: <input type="range" id="cpu-portal-bias" min="0" max="100" value="30"></label>
  </div>
</div>
```

## Edge Cases

1. **No legal moves**: Check for checkmate/stalemate per timeline
2. **All timelines blocked**: Game ends when no timeline has legal moves
3. **Infinite loops**: Detect repetition, prefer new moves
4. **Performance**: Limit evaluation depth, use requestAnimationFrame

## Testing

1. Start CPU mode → moves happen automatically
2. Watch for time travel usage (should use portals ~30% when available)
3. Multiple timelines form → CPU plays on all of them
4. Multiple queens spawn → game continues with weird positions
5. Eventually reaches checkmate or draw

## Future Enhancements

- Difficulty levels (1-ply, 2-ply, random)
- Opening book
- Endgame tables
- Human vs CPU mode
- Network multiplayer

## Files to Modify

1. `src/game.ts` - Add CPUManager, expose methods
2. `src/types/game.ts` - Add CPUMove interface
3. `index.html` - Add CPU panel to sidebar
4. `css/style.css` - Style CPU controls
5. `TEST_PLAN.md` - Add CPU tests
