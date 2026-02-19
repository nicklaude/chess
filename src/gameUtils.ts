/**
 * Game utilities for 6D Chess
 * Provides helper functions for FEN manipulation, validation, and logging
 */

import type { Board, Piece, PieceType, Square, TimelineData, AnySnapshot, Snapshot } from './types';

// ===============================================================
// FEN Utilities
// ===============================================================

/**
 * Expand a FEN row string into an array of piece characters
 * e.g., "r1bqkbnr" -> ["r", "", "b", "q", "k", "b", "n", "r"]
 */
export function expandFenRow(row: string): string[] {
  const result: string[] = [];
  for (const char of row) {
    if (char >= '1' && char <= '8') {
      for (let i = 0; i < parseInt(char); i++) result.push('');
    } else {
      result.push(char);
    }
  }
  return result;
}

/**
 * Compress an array of piece characters back to a FEN row string
 * e.g., ["r", "", "b", "q", "k", "b", "n", "r"] -> "r1bqkbnr"
 */
export function compressFenRow(arr: string[]): string {
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
}

/**
 * Convert a square string to row/column indices
 * e.g., "e4" -> { r: 4, c: 4 }
 */
export function squareToIndices(sq: string): { r: number; c: number } {
  return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
}

/**
 * Convert row/column indices to a square string
 * e.g., { r: 4, c: 4 } -> "e4"
 */
export function indicesToSquare(r: number, c: number): Square {
  return (String.fromCharCode(97 + c) + (8 - r)) as Square;
}

/**
 * Parse a FEN string into its components
 */
export interface FenParts {
  position: string;
  turn: 'w' | 'b';
  castling: string;
  enPassant: string;
  halfmoveClock: number;
  fullmoveNumber: number;
}

export function parseFen(fen: string): FenParts {
  const parts = fen.split(' ');
  return {
    position: parts[0],
    turn: (parts[1] || 'w') as 'w' | 'b',
    castling: parts[2] || '-',
    enPassant: parts[3] || '-',
    halfmoveClock: parseInt(parts[4]) || 0,
    fullmoveNumber: parseInt(parts[5]) || 1,
  };
}

/**
 * Build a FEN string from its components
 */
export function buildFen(parts: FenParts): string {
  return `${parts.position} ${parts.turn} ${parts.castling} ${parts.enPassant} ${parts.halfmoveClock} ${parts.fullmoveNumber}`;
}

/**
 * Update castling rights based on a piece being removed from a square
 */
export function updateCastlingForRemoval(
  castling: string,
  square: string,
  removedPieceChar: string
): string {
  if (castling === '-') return '-';

  const removedPiece = removedPieceChar.toLowerCase();
  const isWhitePiece = removedPieceChar === removedPieceChar.toUpperCase();

  if (removedPiece === 'k') {
    // King removed - remove all castling rights for that color
    castling = isWhitePiece ? castling.replace(/[KQ]/g, '') : castling.replace(/[kq]/g, '');
  } else if (removedPiece === 'r') {
    // Rook removed - check which corner
    if (square === 'a1') castling = castling.replace('Q', '');
    else if (square === 'h1') castling = castling.replace('K', '');
    else if (square === 'a8') castling = castling.replace('q', '');
    else if (square === 'h8') castling = castling.replace('k', '');
  }

  return castling === '' ? '-' : castling;
}

/**
 * Update castling rights based on a piece being placed on a square
 */
export function updateCastlingForPlacement(castling: string, square: string): string {
  if (castling === '-') return '-';

  // Placing a piece on a rook square invalidates that castling
  if (square === 'a1') castling = castling.replace('Q', '');
  else if (square === 'h1') castling = castling.replace('K', '');
  else if (square === 'a8') castling = castling.replace('q', '');
  else if (square === 'h8') castling = castling.replace('k', '');

  return castling === '' ? '-' : castling;
}

// ===============================================================
// FEN Modification (Comprehensive version for time travel/cross-timeline)
// ===============================================================

export interface ModifyFenOptions {
  fen: string;
  square: Square;
  newPiece: Piece | null;
  whiteToMove: boolean;
  isCapture?: boolean;
  resetEnPassant?: boolean;
}

/**
 * Comprehensive FEN modification for time travel and cross-timeline moves.
 * Handles:
 * - Piece placement/removal
 * - Turn flipping
 * - Castling rights updates
 * - En passant reset
 * - Halfmove clock (reset on capture/pawn, increment otherwise)
 * - Fullmove number increment
 */
export function modifyFen(options: ModifyFenOptions): string {
  const { fen, square, newPiece, whiteToMove, isCapture = false, resetEnPassant = true } = options;

  const parts = parseFen(fen);
  const rows = parts.position.split('/');
  const pos = squareToIndices(square);

  // Validate row index
  if (!rows[pos.r]) {
    console.error('[modifyFen] Invalid row index:', pos.r, 'FEN rows:', rows);
    return fen;
  }

  const rowArr = expandFenRow(rows[pos.r]);
  const oldPieceChar = rowArr[pos.c];

  // Update the square
  if (newPiece) {
    const pieceChar = newPiece.color === 'w'
      ? newPiece.type.toUpperCase()
      : newPiece.type.toLowerCase();
    rowArr[pos.c] = pieceChar;
  } else {
    rowArr[pos.c] = '';
  }
  rows[pos.r] = compressFenRow(rowArr);

  // Update position
  parts.position = rows.join('/');

  // Flip turn
  parts.turn = whiteToMove ? 'w' : 'b';

  // Update castling rights
  if (parts.castling !== '-') {
    // If a piece is being removed (either emptying square or capturing via replacement),
    // check if the removed piece affects castling (e.g., rook on h1 captured by cross-timeline move)
    if (oldPieceChar) {
      parts.castling = updateCastlingForRemoval(parts.castling, square, oldPieceChar);
    }
    // If a piece is being placed, check if it affects castling
    // (this handles cases where a non-rook piece moves to a rook starting square)
    if (newPiece) {
      parts.castling = updateCastlingForPlacement(parts.castling, square);
    }
  }

  // Reset en passant on timeline branches/time travel
  if (resetEnPassant) {
    parts.enPassant = '-';
  }

  // Halfmove clock: reset on capture or pawn move, increment otherwise
  const isPawnMove = newPiece && newPiece.type === 'p';
  if (isCapture || isPawnMove) {
    parts.halfmoveClock = 0;
  } else {
    parts.halfmoveClock++;
  }

  // Fullmove number: increment when it becomes white's turn (after black moved)
  if (whiteToMove) {
    parts.fullmoveNumber++;
  }

  return buildFen(parts);
}

// ===============================================================
// FEN Logging System
// ===============================================================

export interface BoardDebugInfo {
  timelineId: number;
  timelineName: string;
  currentFen: string;
  turn: 'w' | 'b';
  moveCount: number;
  lastMove: string | null;
  isCheckmate: boolean;
  isDraw: boolean;
  isCheck: boolean;
  castlingRights: string;
  enPassant: string;
  halfmoveClock: number;
  fullmoveNumber: number;
}

export interface GameDebugState {
  timestamp: string;
  boards: BoardDebugInfo[];
  activeTimelineId: number;
  totalTimelines: number;
  globalGameOver: boolean;
}

/**
 * Get debug info for a single timeline
 */
export function getTimelineDebugInfo(
  tl: TimelineData,
  isCheckmate: boolean,
  isDraw: boolean,
  isCheck: boolean
): BoardDebugInfo {
  const fen = tl.chess.fen();
  const fenParts = parseFen(fen);
  const lastMove = tl.moveHistory.length > 0
    ? tl.moveHistory[tl.moveHistory.length - 1].san
    : null;

  return {
    timelineId: tl.id,
    timelineName: tl.name,
    currentFen: fen,
    turn: fenParts.turn,
    moveCount: tl.moveHistory.length,
    lastMove,
    isCheckmate,
    isDraw,
    isCheck,
    castlingRights: fenParts.castling,
    enPassant: fenParts.enPassant,
    halfmoveClock: fenParts.halfmoveClock,
    fullmoveNumber: fenParts.fullmoveNumber,
  };
}

/**
 * Format a board debug info as a compact string for console logging
 */
export function formatBoardDebug(info: BoardDebugInfo): string {
  const status = info.isCheckmate ? 'CHECKMATE'
    : info.isDraw ? 'DRAW'
    : info.isCheck ? 'CHECK'
    : 'active';
  const turnStr = info.turn === 'w' ? 'White' : 'Black';
  return `[T${info.timelineId}:${info.timelineName}] ${turnStr} to move | Moves: ${info.moveCount} | Status: ${status} | FEN: ${info.currentFen}`;
}

/**
 * Log full game state (all boards) for debugging
 */
export function logGameState(state: GameDebugState): void {
  console.group(`[6D Chess Debug] ${state.timestamp}`);
  console.log(`Active: T${state.activeTimelineId} | Total Timelines: ${state.totalTimelines} | Game Over: ${state.globalGameOver}`);
  console.log('---');
  for (const board of state.boards) {
    console.log(formatBoardDebug(board));
  }
  console.groupEnd();
}

// ===============================================================
// FEN Notation Documentation
// ===============================================================

/**
 * NOTATION FORMAT DOCUMENTATION
 *
 * Standard FEN Components:
 * 1. Piece placement (rank 8 to rank 1, files a-h)
 *    - Uppercase = White pieces (KQRBNP)
 *    - Lowercase = Black pieces (kqrbnp)
 *    - Numbers = consecutive empty squares
 *    - / = rank separator
 *
 * 2. Active color: 'w' (white to move) or 'b' (black to move)
 *
 * 3. Castling availability:
 *    - K = White can castle kingside
 *    - Q = White can castle queenside
 *    - k = Black can castle kingside
 *    - q = Black can castle queenside
 *    - '-' = no castling available
 *
 * 4. En passant target square:
 *    - e.g., 'e3' if pawn just moved e2-e4
 *    - '-' = no en passant possible
 *
 * 5. Halfmove clock: Moves since last capture or pawn advance (for 50-move rule)
 *
 * 6. Fullmove number: Starts at 1, increments after Black's move
 *
 *
 * Extended Notation for 6D Chess (in move SAN):
 *
 * Cross-Timeline Moves:
 *   Qd4→T2   = Queen on d4 moves to Timeline 2 (same square)
 *   Qd4←T1   = Queen arrived on d4 from Timeline 1
 *
 * Time Travel Moves:
 *   Qd4⟳T3   = Queen on d4 time travels to turn 3 (departure)
 *   Qd4⟳←T1  = Queen arrived on d4 via time travel from Timeline 1
 *
 *
 * Example Starting FEN:
 *   rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
 *   ^position                                    ^ ^ ^  ^ ^ ^
 *                                          turn--|   |  | | |
 *                                          castling--+  | | |
 *                                          en passant---+ | |
 *                                          halfmove-------+ |
 *                                          fullmove---------+
 */

// ===============================================================
// Validation Utilities
// ===============================================================

/**
 * Validate that a FEN string is well-formed
 */
export function isValidFen(fen: string): boolean {
  const parts = fen.split(' ');
  if (parts.length !== 6) return false;

  const [position, turn, castling, enPassant, halfmove, fullmove] = parts;

  // Check position has 8 ranks
  const ranks = position.split('/');
  if (ranks.length !== 8) return false;

  // Check each rank has 8 squares
  for (const rank of ranks) {
    let count = 0;
    for (const char of rank) {
      if (char >= '1' && char <= '8') {
        count += parseInt(char);
      } else if ('kqrbnpKQRBNP'.includes(char)) {
        count++;
      } else {
        return false; // Invalid character
      }
    }
    if (count !== 8) return false;
  }

  // Check turn
  if (turn !== 'w' && turn !== 'b') return false;

  // Check castling
  if (!/^(-|[KQkq]+)$/.test(castling)) return false;

  // Check en passant
  if (enPassant !== '-' && !/^[a-h][36]$/.test(enPassant)) return false;

  // Check halfmove and fullmove are numbers
  if (isNaN(parseInt(halfmove)) || isNaN(parseInt(fullmove))) return false;

  return true;
}

/**
 * Count pieces on a board from FEN
 */
export function countPiecesInFen(fen: string): { white: number; black: number; total: number } {
  const position = fen.split(' ')[0];
  let white = 0;
  let black = 0;

  for (const char of position) {
    if ('KQRBNP'.includes(char)) white++;
    else if ('kqrbnp'.includes(char)) black++;
  }

  return { white, black, total: white + black };
}

/**
 * Check if FEN has exactly one king per side
 */
export function validateKings(fen: string): { valid: boolean; whiteKings: number; blackKings: number } {
  const position = fen.split(' ')[0];
  let whiteKings = 0;
  let blackKings = 0;

  for (const char of position) {
    if (char === 'K') whiteKings++;
    else if (char === 'k') blackKings++;
  }

  return {
    valid: whiteKings === 1 && blackKings === 1,
    whiteKings,
    blackKings,
  };
}

/**
 * Validate that after FEN modification, the side that JUST MOVED
 * does NOT have their own king in check. This catches illegal teleport
 * positions where a piece teleports away and leaves its own king exposed,
 * or lands in a way that exposes its own king.
 *
 * @param fen - The FEN string to validate (AFTER turn has been flipped)
 * @param movingPlayerColor - The color of the player who just moved ('w' or 'b')
 * @returns Object with valid boolean and optional reason string
 *
 * Note: Uses the global Chess constructor (from chess.js CDN)
 * The check is performed by:
 * 1. Loading the FEN into a temporary chess instance
 * 2. Temporarily switching the turn to the moving player
 * 3. Checking if they are in check (meaning their king is under attack)
 * 4. If so, the teleport was illegal - you can't leave your king in check
 *
 * IMPORTANT: The FEN passed in should already have the turn flipped
 * (i.e., it's now the opponent's turn). We flip it back temporarily
 * to check if the player who just moved left their king in check.
 */
export function validateNoSelfCheck(
  fen: string,
  movingPlayerColor: 'w' | 'b'
): { valid: boolean; reason?: string } {
  // Create a temporary chess instance to check the position
  const tempChess = new Chess();
  const loaded = tempChess.load(fen);

  if (!loaded) {
    return {
      valid: false,
      reason: `Invalid FEN: could not load "${fen}"`,
    };
  }

  // The FEN has the turn set to the opponent (after the move).
  // We need to temporarily flip the turn back to check if the
  // player who just moved left their own king in check.
  const fenParts = fen.split(' ');
  fenParts[1] = movingPlayerColor;
  const fenWithMovingPlayerTurn = fenParts.join(' ');

  const checkChess = new Chess();
  const checkLoaded = checkChess.load(fenWithMovingPlayerTurn);

  if (!checkLoaded) {
    // This shouldn't happen if the original FEN was valid
    return {
      valid: false,
      reason: `Invalid FEN after turn flip: could not load "${fenWithMovingPlayerTurn}"`,
    };
  }

  // Now check if the moving player's king is in check
  // This would mean they made an illegal move (left their king in check)
  if (checkChess.in_check()) {
    const playerName = movingPlayerColor === 'w' ? 'White' : 'Black';
    return {
      valid: false,
      reason: `Illegal move: ${playerName}'s king would be in check after teleport`,
    };
  }

  return { valid: true };
}
