# Stockfish Integration Plan for 6D Chess

## Overview

This document outlines a plan for integrating Stockfish into the 6D Chess application to provide AI-powered move evaluation and generation. The key challenge is that time travel mechanics can create board states that are "invalid" by standard chess rules (e.g., multiple queens, pieces in unusual configurations).

---

## 1. How to Integrate Stockfish in a Web App

### Option A: stockfish.wasm (Recommended)

The [lichess-org/stockfish.wasm](https://github.com/lichess-org/stockfish.wasm) package provides a WebAssembly port of Stockfish with Web Worker support.

**Files Required:**
- `stockfish.js` - Main entry point
- `stockfish.wasm` - WebAssembly binary
- `stockfish.worker.js` - Web Worker implementation
- Total size: ~400KB (~150KB gzipped)

**Basic Usage:**
```typescript
// Initialize Stockfish
const stockfish = await Stockfish();

// Set up message listener
stockfish.addMessageListener((line: string) => {
  if (line.startsWith('bestmove')) {
    const move = line.split(' ')[1];
    // Handle best move
  }
});

// Send UCI commands
stockfish.postMessage('uci');
stockfish.postMessage('isready');
stockfish.postMessage('position fen <fen-string>');
stockfish.postMessage('go depth 15');
```

**HTTP Headers Required:**
The server must send these headers for SharedArrayBuffer support:
```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

### Option B: stockfish.js (Simpler, Single-Threaded)

The [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) npm package provides a simpler integration with fallback for browsers without WASM threading.

```bash
npm install stockfish
```

```typescript
import stockfish from 'stockfish';

const engine = stockfish();
engine.onmessage = (event: string) => {
  console.log(event);
};
engine.postMessage('uci');
```

### Web Worker Approach for Non-Blocking

To avoid freezing the UI during engine calculations:

```typescript
// stockfish-worker.ts
const worker = new Worker('stockfish.js');

class StockfishEngine {
  private worker: Worker;
  private pendingResolve: ((move: string) => void) | null = null;

  constructor() {
    this.worker = new Worker(
      URL.createObjectURL(new Blob([
        `importScripts('stockfish.js');`
      ], { type: 'application/javascript' }))
    );

    this.worker.onmessage = (e) => this.handleMessage(e.data);
  }

  private handleMessage(line: string): void {
    if (line.startsWith('bestmove') && this.pendingResolve) {
      const move = line.split(' ')[1];
      this.pendingResolve(move);
      this.pendingResolve = null;
    }
  }

  async getBestMove(fen: string, depth: number = 15): Promise<string> {
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  stop(): void {
    this.worker.postMessage('stop');
  }

  terminate(): void {
    this.worker.terminate();
  }
}
```

### UCI Communication Protocol

The Universal Chess Interface (UCI) is a text-based protocol. Key commands:

| Command | Description |
|---------|-------------|
| `uci` | Initialize engine, get options |
| `isready` | Synchronize, wait for `readyok` |
| `ucinewgame` | Clear hash tables for new game |
| `position fen <fen>` | Set board position |
| `position startpos moves e2e4 e7e5` | Set position with move history |
| `go depth <n>` | Search to depth n |
| `go movetime <ms>` | Search for ms milliseconds |
| `stop` | Stop searching immediately |

**Response Format:**
```
info depth 15 score cp 35 nodes 123456 pv e2e4 e7e5 Nf3
bestmove e2e4 ponder e7e5
```

---

## 2. Handling Invalid FEN

### What Makes FEN "Invalid" in 6D Chess Context?

Time travel mechanics create positions that violate standard chess rules:

1. **Multiple queens per side** - Queen travels back in time, creating duplicates
2. **Impossible piece counts** - More pieces than possible from initial setup
3. **Kings in mutual check** - Derived positions from timeline manipulation
4. **Pieces on impossible squares** - Cross-timeline moves place pieces arbitrarily
5. **Wrong turn indicator** - Turn may not match piece positions logically

### Stockfish's FEN Handling

According to [Stockfish FAQ](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html):
> "Stockfish may crash if fed incorrect FENs or FENs with illegal positions."

The engine assumes valid input and provides **undefined behavior** for invalid positions.

### Strategy Options

#### Option A: FEN Sanitization (Recommended First Approach)

Create a sanitization layer that converts invalid FEN to the closest valid position:

```typescript
interface SanitizedResult {
  fen: string;
  wasModified: boolean;
  removedPieces: Piece[];
}

function sanitizeFenForStockfish(fen: string): SanitizedResult {
  const parts = fen.split(' ');
  const position = parts[0];
  const turn = parts[1] || 'w';

  let board = parseFenPosition(position);
  const removed: Piece[] = [];

  // 1. Ensure exactly one king per side
  board = ensureSingleKing(board, removed);

  // 2. Limit piece counts to maximum possible
  // (8 pawns, 2 rooks, 2 knights, 2 bishops, 1 queen max without promotion)
  // Allow more pieces due to promotion, but cap at reasonable limits
  board = limitPieceCounts(board, removed);

  // 3. Ensure kings are not adjacent (illegal in standard chess)
  // If adjacent, move one king to nearest valid square
  board = ensureValidKingPositions(board);

  // 4. Validate castling rights against piece positions
  const castling = validateCastlingRights(board, parts[2] || '-');

  // 5. Validate en passant square
  const enPassant = validateEnPassant(board, parts[3] || '-', turn);

  return {
    fen: `${boardToFen(board)} ${turn} ${castling} ${enPassant} 0 1`,
    wasModified: removed.length > 0,
    removedPieces: removed,
  };
}
```

#### Option B: Fallback Heuristics for Invalid Positions

When Stockfish cannot handle a position, use a simplified evaluation:

```typescript
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

function heuristicEvaluation(board: Board, color: PieceColor): number {
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;

      const value = PIECE_VALUES[piece.type];
      const positionalBonus = getPositionalBonus(piece, r, c);

      if (piece.color === color) {
        score += value + positionalBonus;
      } else {
        score -= value + positionalBonus;
      }
    }
  }

  return score;
}

function selectMoveWithHeuristics(
  chess: ChessInstance,
  color: PieceColor
): ChessMove | null {
  const moves = chess.moves({ verbose: true }) as ChessMove[];
  if (moves.length === 0) return null;

  // Score each move
  const scoredMoves = moves.map(move => {
    const testChess = new Chess(chess.fen(), { skipValidation: true });
    testChess.move({ from: move.from, to: move.to, promotion: move.promotion });
    return {
      move,
      score: heuristicEvaluation(testChess.board(), color),
    };
  });

  // Sort and pick best (with some randomness for variety)
  scoredMoves.sort((a, b) => b.score - a.score);
  const topMoves = scoredMoves.slice(0, 3);
  return topMoves[Math.floor(Math.random() * topMoves.length)].move;
}
```

#### Option C: Detection and Graceful Degradation

Try Stockfish first, fall back to heuristics if it fails:

```typescript
async function getBestMove(fen: string): Promise<string> {
  // Check if FEN is likely valid
  if (!isLikelyValidFen(fen)) {
    console.log('[AI] FEN appears invalid, using heuristics');
    return getHeuristicMove(fen);
  }

  try {
    const sanitized = sanitizeFenForStockfish(fen);
    if (sanitized.wasModified) {
      console.log('[AI] FEN was sanitized:', sanitized.removedPieces);
    }

    const move = await stockfishEngine.getBestMove(sanitized.fen, 15);

    // Validate the move is legal in the original position
    if (isMoveLegalInOriginal(fen, move)) {
      return move;
    }

    // Move not legal in original, fall back
    console.log('[AI] Stockfish move not legal in original, using heuristics');
    return getHeuristicMove(fen);

  } catch (error) {
    console.error('[AI] Stockfish error:', error);
    return getHeuristicMove(fen);
  }
}
```

---

## 3. Integration Points in the Codebase

### Current CPU Logic Location

The CPU AI logic is in `/Users/sven/code/chess/src/game.ts` within the `GameManager` class:

| Method | Line | Description |
|--------|------|-------------|
| `_cpuTick()` | ~2314 | Main game loop, called repeatedly |
| `_cpuMakeMove(tlId)` | ~2390 | Decision-making for a single timeline |
| `_cpuCheckTimeTravel(tlId)` | ~2467 | Check for time travel opportunities |
| `_cpuCheckCrossTimeline(tlId)` | ~2524 | Check for cross-timeline moves |

### Current Move Selection (Random + Capture Preference)

```typescript
// Current implementation (lines ~2452-2462)
const captures = moves.filter(m => m.captured);
let move: ChessMove;

if (captures.length > 0 && Math.random() < capturePreference) {
  move = captures[Math.floor(Math.random() * captures.length)];
} else {
  move = moves[Math.floor(Math.random() * moves.length)];
}
```

### Proposed Integration Architecture

```typescript
// New file: src/stockfish-engine.ts
export class StockfishEngine {
  private worker: Worker | null = null;
  private ready: boolean = false;

  async initialize(): Promise<void> { ... }
  async getBestMove(fen: string, options: SearchOptions): Promise<string> { ... }
  async evaluatePosition(fen: string): Promise<number> { ... }
  stop(): void { ... }
}

// Modified game.ts
class GameManager {
  private stockfishEngine: StockfishEngine | null = null;
  private useStockfish: boolean = false;  // Toggle between random and Stockfish

  async initStockfish(): Promise<void> {
    this.stockfishEngine = new StockfishEngine();
    await this.stockfishEngine.initialize();
  }

  private async _cpuMakeMove(tlId: number): Promise<boolean> {
    // ... existing time travel / cross-timeline checks ...

    if (this.useStockfish && this.stockfishEngine) {
      const move = await this._getStockfishMove(tlId);
      if (move) {
        this.makeMove(tlId, move);
        return true;
      }
    }

    // Fall back to existing random selection
    // ...
  }

  private async _getStockfishMove(tlId: number): Promise<ChessMove | null> {
    const tl = this.timelines[tlId];
    const fen = tl.chess.fen();

    try {
      const uciMove = await this.stockfishEngine!.getBestMove(fen, { depth: 12 });
      // Convert UCI move (e.g., "e2e4") to ChessMove object
      return this._uciToChessMove(tl, uciMove);
    } catch (error) {
      console.error('[Stockfish] Error:', error);
      return null;
    }
  }
}
```

### UI Integration

Add Stockfish toggle to existing CPU controls:

```html
<!-- In index.html, alongside existing CPU controls -->
<div class="cpu-setting">
  <label>AI Engine:</label>
  <select id="cpu-engine">
    <option value="random">Random (Fast)</option>
    <option value="stockfish-easy">Stockfish Easy (Depth 5)</option>
    <option value="stockfish-medium">Stockfish Medium (Depth 10)</option>
    <option value="stockfish-hard">Stockfish Hard (Depth 15)</option>
  </select>
</div>
```

---

## 4. Challenges Specific to Time Travel Chess

### Multiple Timelines = Multiple Board States

Each timeline has its own chess.js instance with independent state:

```typescript
// Current structure (from types/game.ts)
interface TimelineData {
  id: number;
  chess: ChessInstance;   // Independent game state
  moveHistory: Move[];
  snapshots: AnySnapshot[];
  parentId: number | null;
  branchTurn: number;
  xOffset: number;
  name: string;
}
```

**Challenge:** Stockfish evaluates a single position. It has no concept of "this move in timeline A affects timeline B."

**Solution:** Evaluate each timeline independently, but weight moves based on cross-timeline impact:

```typescript
interface MultiTimelineEvaluation {
  timelineId: number;
  stockfishScore: number;
  crossTimelineImpact: number;
  combinedScore: number;
}

async function evaluateAcrossTimelines(
  timelines: Record<number, TimelineData>,
  color: PieceColor
): Promise<MultiTimelineEvaluation[]> {
  const evaluations: MultiTimelineEvaluation[] = [];

  for (const tlId in timelines) {
    const tl = timelines[parseInt(tlId)];
    if (tl.chess.turn() !== color) continue;

    const stockfishScore = await stockfishEngine.evaluatePosition(tl.chess.fen());
    const crossImpact = calculateCrossTimelineImpact(tl, timelines);

    evaluations.push({
      timelineId: parseInt(tlId),
      stockfishScore,
      crossTimelineImpact: crossImpact,
      combinedScore: stockfishScore * 0.7 + crossImpact * 0.3,
    });
  }

  return evaluations.sort((a, b) => b.combinedScore - a.combinedScore);
}
```

### Cross-Timeline Moves Cannot Be Evaluated by Stockfish

When a queen jumps from timeline A to timeline B, Stockfish cannot evaluate this because:
1. It only sees one board at a time
2. The move isn't a legal chess move in standard terms

**Solution:** Use a hybrid evaluation:

```typescript
async function evaluateCrossTimelineMove(
  sourceTimeline: TimelineData,
  targetTimeline: TimelineData,
  piece: Piece,
  targetSquare: Square
): Promise<number> {
  let score = 0;

  // 1. Evaluate target timeline after piece arrival
  const targetChess = new Chess(targetTimeline.chess.fen(), { skipValidation: true });

  // Check if it's a capture
  const capturedPiece = targetChess.get(targetSquare);
  if (capturedPiece && capturedPiece.color !== piece.color) {
    score += PIECE_VALUES[capturedPiece.type];
  }

  // Place piece on target
  targetChess.put(piece, targetSquare);

  // 2. Get Stockfish evaluation of resulting position
  const sanitizedFen = sanitizeFenForStockfish(targetChess.fen());
  const positionScore = await stockfishEngine.evaluatePosition(sanitizedFen.fen);
  score += positionScore;

  // 3. Penalize leaving source timeline weaker
  const sourceWithout = new Chess(sourceTimeline.chess.fen(), { skipValidation: true });
  sourceWithout.remove(/* piece's current square */);
  const sourceScore = await stockfishEngine.evaluatePosition(
    sanitizeFenForStockfish(sourceWithout.fen()).fen
  );
  score -= sourceScore * 0.5;  // Weigh source timeline impact

  return score;
}
```

### Time Travel Creates Paradoxical Positions

When a queen travels back in time:
1. A new timeline branches from the past
2. The queen appears at the target turn
3. The original timeline continues without the queen

**Challenge:** This creates a board state that never existed in standard play.

**Solution:** Accept that some positions are beyond Stockfish's ability to evaluate meaningfully. Use heuristics for:
- Positions with > 2 queens per side
- Positions where piece count exceeds 16 per side
- Positions with both kings in check

```typescript
function shouldUseHeuristics(fen: string): boolean {
  const pieces = countPieces(fen);

  return (
    pieces.whiteQueens > 2 ||
    pieces.blackQueens > 2 ||
    pieces.totalWhite > 16 ||
    pieces.totalBlack > 16 ||
    pieces.whiteKings !== 1 ||
    pieces.blackKings !== 1
  );
}
```

---

## 5. Implementation Phases

### Phase 1: Basic Stockfish Integration (1-2 days)

**Goal:** Get Stockfish working for standard chess positions.

**Tasks:**
1. Add stockfish npm package or set up stockfish.wasm
2. Create `StockfishEngine` wrapper class
3. Add Web Worker communication
4. Add UI toggle between "Random" and "Stockfish" CPU mode
5. Integrate with `_cpuMakeMove()` for standard positions only
6. Add depth selector (5/10/15/20)

**Files to Create/Modify:**
- `src/stockfish-engine.ts` (new)
- `src/game.ts` (modify CPU methods)
- `index.html` (add UI controls)
- `package.json` (add stockfish dependency)

**Acceptance Criteria:**
- CPU can play using Stockfish on a fresh game
- Stockfish moves are noticeably stronger than random
- UI allows switching between Random and Stockfish modes

### Phase 2: Handle Edge Cases / Invalid FEN (2-3 days)

**Goal:** Make Stockfish work with time-travel-affected positions.

**Tasks:**
1. Implement FEN validation function
2. Implement FEN sanitization logic
3. Create heuristic fallback evaluator
4. Add detection for "beyond repair" positions
5. Implement hybrid decision system (try Stockfish, fall back to heuristics)
6. Add logging/debugging for sanitization decisions

**Files to Create/Modify:**
- `src/fen-utils.ts` (new) - FEN validation and sanitization
- `src/heuristic-eval.ts` (new) - Fallback evaluation
- `src/stockfish-engine.ts` (add error handling)
- `src/game.ts` (integrate fallback logic)

**Acceptance Criteria:**
- CPU continues playing after time travel creates weird positions
- No crashes or hangs from invalid FEN
- Console logs explain when/why heuristics are used

### Phase 3: Multi-Timeline Awareness (3-5 days)

**Goal:** CPU makes intelligent decisions across multiple timelines.

**Tasks:**
1. Implement cross-timeline evaluation scoring
2. Weight Stockfish evaluations by timeline importance
3. Implement time travel move evaluation (is branching worth it?)
4. Implement cross-timeline move evaluation
5. Add configurable "aggressiveness" for portal usage
6. Balance evaluation time (don't slow down game too much)

**Files to Create/Modify:**
- `src/multi-timeline-eval.ts` (new)
- `src/game.ts` (replace random timeline selection)
- Add caching for repeated evaluations

**Acceptance Criteria:**
- CPU considers all timelines when deciding where to move
- CPU uses time travel/cross-timeline moves strategically (not randomly)
- Game remains responsive (<500ms per CPU decision)

### Phase 4: Performance Optimization (Optional, 2-3 days)

**Goal:** Make Stockfish-powered CPU fast enough for rapid auto-play.

**Tasks:**
1. Implement position caching (hash table)
2. Add progressive deepening (start shallow, deepen if time permits)
3. Limit evaluation to "important" timelines only
4. Add WebWorker pool for parallel evaluation
5. Implement move ordering to speed up search

**Acceptance Criteria:**
- 10+ timelines don't noticeably slow down CPU play
- CPU can run at 100ms delay without lag

---

## Appendix: Useful References

- [Stockfish.wasm GitHub](https://github.com/lichess-org/stockfish.wasm) - WebAssembly implementation
- [Stockfish.js GitHub](https://github.com/nmrugg/stockfish.js) - JavaScript implementation
- [UCI Commands Documentation](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-&-Commands.html) - Protocol reference
- [Stockfish FAQ](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html) - Includes FEN handling notes
- [chess.js skipValidation](https://github.com/jhlywa/chess.js) - The app already uses this for weird positions

---

## Summary

| Phase | Focus | Complexity | Time Estimate |
|-------|-------|------------|---------------|
| 1 | Basic Stockfish | Low | 1-2 days |
| 2 | Invalid FEN Handling | Medium | 2-3 days |
| 3 | Multi-Timeline AI | High | 3-5 days |
| 4 | Performance | Medium | 2-3 days (optional) |

**Recommended Approach:**
1. Start with Phase 1 to prove the integration works
2. Phase 2 is critical - most games will hit invalid FEN quickly
3. Phase 3 makes the AI truly "6D-aware"
4. Phase 4 only if performance becomes an issue

The key insight is that Stockfish is a powerful tool for individual board evaluation, but the "6D" aspects (multiple timelines, time travel, cross-timeline moves) require custom logic wrapped around Stockfish's single-position evaluations.
