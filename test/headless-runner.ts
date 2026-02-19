/**
 * Headless game test runner for 6D Chess
 * Runs games without Three.js rendering, tracking FEN state to detect bugs
 */

// Use chess.js v0.10.3 (same as CDN version)
const Chess = require('chess.js').Chess;

// Types
type Color = 'w' | 'b';
type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Square = string;

interface Piece {
  type: PieceType;
  color: Color;
}

interface Move {
  from: Square;
  to: Square;
  piece: PieceType;
  captured: PieceType | null;
  san: string;
  isWhite: boolean;
  promotion?: PieceType;
}

interface Timeline {
  id: number;
  name: string;
  chess: any;  // Chess instance
  snapshots: any[];
  moveHistory: Move[];
  parentId: number | null;
  branchPoint: number;
}

interface GameState {
  timelines: Record<number, Timeline>;
  nextTimelineId: number;
  activeTimelineId: number;
  globalTurn: Color;
}

interface TestResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalMoves: number;
    timelinesBranched: number;
    capturesMade: number;
    timeTravelMoves: number;
    crossTimelineMoves: number;
  };
  finalState: {
    timelines: number;
    fens: Record<number, string>;
  };
}

// ===============================================================
// Game Logic (headless version)
// ===============================================================

class HeadlessGame {
  private state: GameState;
  private logs: string[] = [];
  private errors: string[] = [];
  private warnings: string[] = [];

  // Stats
  private stats = {
    totalMoves: 0,
    timelinesBranched: 0,
    capturesMade: 0,
    timeTravelMoves: 0,
    crossTimelineMoves: 0,
  };

  constructor() {
    this.state = {
      timelines: {},
      nextTimelineId: 0,
      activeTimelineId: 0,
      globalTurn: 'w',
    };
    this._createTimeline(0, null, -1, null);
  }

  private log(msg: string): void {
    this.logs.push(msg);
  }

  private error(msg: string): void {
    this.errors.push(msg);
    console.error('[ERROR]', msg);
  }

  private warn(msg: string): void {
    this.warnings.push(msg);
  }

  private _createTimeline(id: number, parentId: number | null, branchPoint: number, fen: string | null): Timeline {
    const chess = new Chess(fen || undefined);
    const tl: Timeline = {
      id,
      name: `T${id}`,
      chess,
      snapshots: [this._cloneBoard(chess)],
      moveHistory: [],
      parentId,
      branchPoint,
    };
    this.state.timelines[id] = tl;
    if (id >= this.state.nextTimelineId) {
      this.state.nextTimelineId = id + 1;
    }
    if (parentId !== null) {
      this.stats.timelinesBranched++;
    }
    return tl;
  }

  private _cloneBoard(chess: any): any {
    return {
      fen: chess.fen(),
      board: JSON.parse(JSON.stringify(chess.board())),
    };
  }

  /** Validate game state for bugs */
  validateState(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    for (const [idStr, tl] of Object.entries(this.state.timelines)) {
      const id = parseInt(idStr);
      const fen = tl.chess.fen();
      const board = tl.chess.board();

      // Check 1: Snapshot/moveHistory consistency
      if (tl.snapshots.length !== tl.moveHistory.length + 1) {
        issues.push(`Timeline ${id}: Snapshot/moveHistory mismatch (${tl.snapshots.length} vs ${tl.moveHistory.length})`);
      }

      // Check 2: Count pieces on each square (should be 0 or 1)
      const squareCounts: Record<string, number> = {};
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = board[r][c];
          if (piece) {
            const sq = String.fromCharCode(97 + c) + (8 - r);
            squareCounts[sq] = (squareCounts[sq] || 0) + 1;
          }
        }
      }
      for (const [sq, count] of Object.entries(squareCounts)) {
        if (count > 1) {
          issues.push(`Timeline ${id}: ${count} pieces on square ${sq}! FEN: ${fen}`);
        }
      }

      // Check 3: Valid FEN
      const testChess = new Chess();
      if (!testChess.load(fen)) {
        issues.push(`Timeline ${id}: Invalid FEN: ${fen}`);
      }

      // Check 4: Exactly one king per side
      let whiteKings = 0, blackKings = 0;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = board[r][c];
          if (piece?.type === 'k') {
            if (piece.color === 'w') whiteKings++;
            else blackKings++;
          }
        }
      }
      if (whiteKings !== 1) {
        issues.push(`Timeline ${id}: ${whiteKings} white kings (expected 1)`);
      }
      if (blackKings !== 1) {
        issues.push(`Timeline ${id}: ${blackKings} black kings (expected 1)`);
      }
    }

    return { valid: issues.length === 0, issues };
  }

  /** Make a random legal move on a timeline */
  makeRandomMove(tlId: number): boolean {
    const tl = this.state.timelines[tlId];
    if (!tl) return false;

    const chess = tl.chess;
    const moves = chess.moves({ verbose: true });

    if (moves.length === 0) {
      return false; // No legal moves (checkmate/stalemate)
    }

    // Pick random move
    const move = moves[Math.floor(Math.random() * moves.length)];
    const result = chess.move(move);

    if (result) {
      this.stats.totalMoves++;
      if (result.captured) this.stats.capturesMade++;

      tl.moveHistory.push({
        from: result.from,
        to: result.to,
        piece: result.piece,
        captured: result.captured || null,
        san: result.san,
        isWhite: result.color === 'w',
        promotion: result.promotion,
      });
      tl.snapshots.push(this._cloneBoard(chess));

      return true;
    }

    return false;
  }

  /** Simulate a time travel move (piece goes back in time) */
  makeTimeTravelMove(tlId: number): boolean {
    const tl = this.state.timelines[tlId];
    if (!tl) return false;

    const chess = tl.chess;
    const board = chess.board();
    const turn = chess.turn();

    // Find pieces that can time travel (Q, R, B, N)
    const timeTravelers: { sq: Square; piece: Piece }[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.color === turn && ['q', 'r', 'b', 'n'].includes(piece.type)) {
          const sq = String.fromCharCode(97 + c) + (8 - r);
          timeTravelers.push({ sq, piece });
        }
      }
    }

    if (timeTravelers.length === 0 || tl.snapshots.length < 2) {
      return false;
    }

    // Pick random piece and random past snapshot
    const { sq: sourceSquare, piece } = timeTravelers[Math.floor(Math.random() * timeTravelers.length)];
    const targetSnapshotIdx = Math.floor(Math.random() * (tl.snapshots.length - 1));
    const targetSnapshot = tl.snapshots[targetSnapshotIdx];

    // Check if target square is valid (empty or enemy, not king)
    const targetBoard = targetSnapshot.board;
    const sourcePos = { r: 8 - parseInt(sourceSquare[1]), c: sourceSquare.charCodeAt(0) - 97 };
    const targetPiece = targetBoard[sourcePos.r][sourcePos.c];

    if (targetPiece && (targetPiece.color === piece.color || targetPiece.type === 'k')) {
      return false; // Can't capture own piece or king
    }

    // Execute time travel
    // 1. Remove piece from source timeline
    const isWhite = piece.color === 'w';
    const sourceFen = chess.fen();
    const newSourceFen = this._modifyFen(sourceFen, sourceSquare, null, !isWhite);
    chess.load(newSourceFen);

    tl.moveHistory.push({
      from: sourceSquare,
      to: sourceSquare,
      piece: piece.type,
      captured: null,
      san: `${piece.type.toUpperCase()}${sourceSquare}⟳T${targetSnapshotIdx}`,
      isWhite,
    });
    tl.snapshots.push(this._cloneBoard(chess));

    // 2. Create new timeline from target snapshot
    const newId = this.state.nextTimelineId++;
    const targetFen = targetSnapshot.fen;
    const newTl = this._createTimeline(newId, tlId, targetSnapshotIdx, targetFen);

    // 3. Place time-traveled piece on new timeline
    const existingPiece = newTl.chess.get(sourceSquare);
    if (existingPiece) {
      newTl.chess.remove(sourceSquare);
    }
    newTl.chess.put(piece, sourceSquare);

    // 4. Fix turn on new timeline
    const currentFen = newTl.chess.fen();
    const fenParts = currentFen.split(' ');
    fenParts[1] = isWhite ? 'b' : 'w';  // Opponent's turn
    fenParts[3] = '-';  // Reset en passant
    newTl.chess.load(fenParts.join(' '));

    // Copy snapshots
    newTl.snapshots = [];
    for (let s = 0; s <= targetSnapshotIdx; s++) {
      newTl.snapshots.push(JSON.parse(JSON.stringify(tl.snapshots[s])));
    }
    newTl.snapshots.push(this._cloneBoard(newTl.chess));

    // Copy move history
    newTl.moveHistory = [];
    for (let m = 0; m < targetSnapshotIdx && m < tl.moveHistory.length; m++) {
      newTl.moveHistory.push(JSON.parse(JSON.stringify(tl.moveHistory[m])));
    }
    newTl.moveHistory.push({
      from: sourceSquare,
      to: sourceSquare,
      piece: piece.type,
      captured: targetPiece?.type || null,
      san: `${piece.type.toUpperCase()}${sourceSquare}⟳←T${tlId}`,
      isWhite,
    });

    this.stats.timeTravelMoves++;
    return true;
  }

  /** Simulate a cross-timeline move */
  makeCrossTimelineMove(sourceTlId: number, targetTlId: number): boolean {
    const sourceTl = this.state.timelines[sourceTlId];
    const targetTl = this.state.timelines[targetTlId];
    if (!sourceTl || !targetTl) return false;

    const sourceChess = sourceTl.chess;
    const targetChess = targetTl.chess;
    const turn = sourceChess.turn();

    // Only queens can cross timelines
    const board = sourceChess.board();
    const queens: Square[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.color === turn && piece.type === 'q') {
          const sq = String.fromCharCode(97 + c) + (8 - r);
          queens.push(sq);
        }
      }
    }

    if (queens.length === 0) return false;

    // Pick random queen
    const sq = queens[Math.floor(Math.random() * queens.length)];
    const piece = sourceChess.get(sq);
    const targetPiece = targetChess.get(sq);

    // Validate target (must be target's turn, same color, can't capture own or king)
    if (targetChess.turn() !== turn) return false;
    if (targetPiece && (targetPiece.color === turn || targetPiece.type === 'k')) return false;

    // Execute cross-timeline move
    const isWhite = piece.color === 'w';

    // Remove from source
    const sourceFen = sourceChess.fen();
    const newSourceFen = this._modifyFen(sourceFen, sq, null, !isWhite);
    sourceChess.load(newSourceFen);

    // Add to target
    const targetFen = targetChess.fen();
    const newTargetFen = this._modifyFen(targetFen, sq, piece, !isWhite);
    targetChess.load(newTargetFen);

    // Record moves
    const pieceChar = piece.type.toUpperCase();
    sourceTl.moveHistory.push({
      from: sq, to: sq,
      piece: piece.type,
      captured: null,
      san: `${pieceChar}${sq}→T${targetTlId}`,
      isWhite,
    });
    sourceTl.snapshots.push(this._cloneBoard(sourceChess));

    targetTl.moveHistory.push({
      from: sq, to: sq,
      piece: piece.type,
      captured: targetPiece?.type || null,
      san: `${pieceChar}${sq}←T${sourceTlId}`,
      isWhite,
    });
    targetTl.snapshots.push(this._cloneBoard(targetChess));

    this.stats.crossTimelineMoves++;
    return true;
  }

  /** Modify FEN to change a square's piece and flip turn */
  private _modifyFen(fen: string, square: string, newPiece: Piece | null, whiteToMove: boolean): string {
    const parts = fen.split(' ');
    const rows = parts[0].split('/');
    const pos = { r: 8 - parseInt(square[1]), c: square.charCodeAt(0) - 97 };

    const expandRow = (row: string): string[] => {
      const result: string[] = [];
      for (const char of row) {
        if (char >= '1' && char <= '8') {
          for (let i = 0; i < parseInt(char); i++) result.push('');
        } else {
          result.push(char);
        }
      }
      return result;
    };

    const compressRow = (arr: string[]): string => {
      let result = '';
      let emptyCount = 0;
      for (const char of arr) {
        if (char === '') {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            result += emptyCount;
            emptyCount = 0;
          }
          result += char;
        }
      }
      if (emptyCount > 0) result += emptyCount;
      return result;
    };

    const rowArr = expandRow(rows[pos.r]);
    const oldPieceChar = rowArr[pos.c];

    if (newPiece) {
      rowArr[pos.c] = newPiece.color === 'w' ? newPiece.type.toUpperCase() : newPiece.type.toLowerCase();
    } else {
      rowArr[pos.c] = '';
    }
    rows[pos.r] = compressRow(rowArr);

    parts[0] = rows.join('/');
    parts[1] = whiteToMove ? 'w' : 'b';

    // Update castling rights
    let castling = parts[2] || '-';
    if (castling !== '-') {
      // If a piece is being removed (either emptying square or capturing via replacement),
      // check if the removed piece affects castling (e.g., rook on h1 captured by cross-timeline move)
      if (oldPieceChar) {
        const removedPiece = oldPieceChar.toLowerCase();
        const isWhitePiece = oldPieceChar === oldPieceChar.toUpperCase();
        if (removedPiece === 'k') {
          castling = isWhitePiece ? castling.replace(/[KQ]/g, '') : castling.replace(/[kq]/g, '');
        } else if (removedPiece === 'r') {
          if (square === 'a1') castling = castling.replace('Q', '');
          else if (square === 'h1') castling = castling.replace('K', '');
          else if (square === 'a8') castling = castling.replace('q', '');
          else if (square === 'h8') castling = castling.replace('k', '');
        }
        if (castling === '') castling = '-';
      }
      // If a piece is being placed, check if it affects castling
      // (this handles cases where a non-rook piece moves to a rook starting square)
      if (newPiece) {
        if (square === 'a1') castling = castling.replace('Q', '');
        else if (square === 'h1') castling = castling.replace('K', '');
        else if (square === 'a8') castling = castling.replace('q', '');
        else if (square === 'h8') castling = castling.replace('k', '');
        if (castling === '') castling = '-';
      }
    }
    parts[2] = castling;
    parts[3] = '-';  // Reset en passant

    return parts.join(' ');
  }

  /** Run a random game for N moves */
  runRandomGame(maxMoves: number, timeTravelChance: number = 0.1): TestResult {
    this.log(`Starting random game with ${maxMoves} max moves, ${timeTravelChance * 100}% time travel chance`);

    for (let i = 0; i < maxMoves; i++) {
      // Validate state periodically
      if (i % 10 === 0) {
        const validation = this.validateState();
        if (!validation.valid) {
          for (const issue of validation.issues) {
            this.error(issue);
          }
        }
      }

      // Get active timelines
      const tlIds = Object.keys(this.state.timelines).map(Number);
      if (tlIds.length === 0) break;

      // Pick a timeline that can move
      const shuffledTlIds = tlIds.sort(() => Math.random() - 0.5);
      let moveMade = false;

      for (const tlId of shuffledTlIds) {
        const tl = this.state.timelines[tlId];
        if (tl.chess.game_over()) continue;

        // Decide move type
        const rand = Math.random();

        if (rand < timeTravelChance && tl.snapshots.length > 2) {
          // Try time travel
          if (this.makeTimeTravelMove(tlId)) {
            moveMade = true;
            break;
          }
        }

        if (rand < timeTravelChance * 2 && tlIds.length > 1) {
          // Try cross-timeline
          const otherTlIds = tlIds.filter(id => id !== tlId);
          const targetTlId = otherTlIds[Math.floor(Math.random() * otherTlIds.length)];
          if (this.makeCrossTimelineMove(tlId, targetTlId)) {
            moveMade = true;
            break;
          }
        }

        // Normal move
        if (this.makeRandomMove(tlId)) {
          moveMade = true;
          break;
        }
      }

      if (!moveMade) {
        this.log(`No valid moves at iteration ${i}`);
        break;
      }
    }

    // Final validation
    const finalValidation = this.validateState();
    for (const issue of finalValidation.issues) {
      this.error(issue);
    }

    // Build result
    const fens: Record<number, string> = {};
    for (const [id, tl] of Object.entries(this.state.timelines)) {
      fens[parseInt(id)] = tl.chess.fen();
    }

    return {
      passed: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      stats: this.stats,
      finalState: {
        timelines: Object.keys(this.state.timelines).length,
        fens,
      },
    };
  }
}

// ===============================================================
// Test Runner
// ===============================================================

function runTests(numGames: number = 10, movesPerGame: number = 100): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log('6D Chess Headless Test Runner');
  console.log(`${'='.repeat(60)}\n`);
  console.log(`Running ${numGames} games with up to ${movesPerGame} moves each...\n`);

  let passed = 0;
  let failed = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < numGames; i++) {
    const game = new HeadlessGame();
    const result = game.runRandomGame(movesPerGame, 0.15);

    if (result.passed) {
      passed++;
      process.stdout.write('.');
    } else {
      failed++;
      process.stdout.write('F');
      allErrors.push(`Game ${i + 1}:`);
      for (const err of result.errors) {
        allErrors.push(`  - ${err}`);
      }
    }
  }

  console.log('\n');
  console.log(`${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(60)}\n`);

  if (allErrors.length > 0) {
    console.log('Errors:\n');
    for (const err of allErrors) {
      console.log(err);
    }
    process.exit(1);
  }
}

// Run tests
const args = process.argv.slice(2);
const numGames = parseInt(args[0]) || 10;
const movesPerGame = parseInt(args[1]) || 100;

runTests(numGames, movesPerGame);
