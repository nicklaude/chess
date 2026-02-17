// ===============================================================
// Chess piece and board types
// ===============================================================

export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
export type PieceColor = 'w' | 'b';

export interface Piece {
  type: PieceType;
  color: PieceColor;
}

/** 8x8 board representation - row 0 is rank 8, col 0 is file a */
export type Board = (Piece | null)[][];

/** Template literal type for valid chess squares (a1-h8) */
export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export type Square = `${File}${Rank}`;

// ===============================================================
// Move types
// ===============================================================

export interface Move {
  from: Square;
  to: Square;
  piece: PieceType;
  captured?: PieceType | null;
  san: string;           // Standard Algebraic Notation, e.g., "Nf3"
  isWhite: boolean;
  promotion?: PieceType | null;
}

/** Verbose move from chess.js - includes flags for promotion detection */
export interface ChessMove {
  from: string;  // Use string to match chess.js return type
  to: string;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  flags: string;  // Required for promotion detection ('p' = promotion)
  san: string;
  color: PieceColor;
}

// ===============================================================
// Snapshot types (for history/time travel)
// ===============================================================

/** New format: contains both FEN (for game state) and board (for rendering) */
export interface Snapshot {
  fen: string;
  board: Board;
}

/** Old format for backward compatibility */
export type LegacySnapshot = Board;

/** Union type for handling both formats */
export type AnySnapshot = Snapshot | LegacySnapshot;

// ===============================================================
// Timeline types (multiverse branching)
// ===============================================================

export interface TimelineData {
  id: number;
  chess: ChessInstance;   // chess.js instance
  moveHistory: Move[];
  snapshots: AnySnapshot[];  // Can contain both old and new format
  parentId: number | null;
  branchTurn: number;     // Move index where this timeline branched (-1 for main)
  xOffset: number;        // 3D world X position
  name: string;           // Display name, e.g., "Main" or "Branch 2"
}

export interface BranchPoint {
  childId: number;
  moveIndex: number;
  name: string;
}

// ===============================================================
// Cross-Timeline Movement types
// ===============================================================

/** A move that crosses timeline boundaries */
export interface CrossTimelineMove {
  from: Square;
  to: Square;
  piece: PieceType;
  sourceTimelineId: number;
  targetTimelineId: number;
  captured?: PieceType | null;
  isWhite: boolean;
}

/** Valid cross-timeline target info */
export interface CrossTimelineMoveTarget {
  targetTimelineId: number;
  targetSquare: Square;
  isCapture: boolean;
  capturedPiece?: Piece | null;
}

/** Selection state when a cross-timeline capable piece is selected */
export interface CrossTimelineSelection {
  sourceTimelineId: number;
  sourceSquare: Square;
  piece: Piece;
  validTargets: CrossTimelineMoveTarget[];
}

// ===============================================================
// Time Travel types (backward movement through time)
// ===============================================================

/** A valid time travel target (queen moving back in time to create new timeline) */
export interface TimeTravelTarget {
  sourceTimelineId: number;
  targetTurnIndex: number;      // Which historical snapshot to arrive at
  targetSquare: Square;
  isCapture: boolean;
  capturedPiece?: Piece | null;
}

/** Selection state when time travel is available */
export interface TimeTravelSelection {
  sourceTimelineId: number;
  sourceSquare: Square;
  piece: Piece;
  validTargets: TimeTravelTarget[];
}

// ===============================================================
// Click/interaction types
// ===============================================================

export interface SquareClickInfo {
  timelineId: number;
  square: string;  // Use string for flexibility with user data
  turn: number;          // -1 for current board, 0+ for history layers
  isHistory: boolean;
}

export interface PendingPromotion {
  tlId: number;
  move: ChessMove;
}

// ===============================================================
// chess.js type stubs
// ===============================================================

export interface ChessInstance {
  fen(): string;
  board(): Board;
  turn(): PieceColor;
  get(square: string): Piece | null;
  put(piece: Piece, square: string): boolean;
  remove(square: string): Piece | null;
  move(move: string | { from: string; to: string; promotion?: PieceType }): ChessMove | null;
  moves(options?: { square?: string; verbose?: boolean }): ChessMove[] | string[];
  history(options?: { verbose?: boolean }): string[] | ChessMove[];
  in_check(): boolean;
  in_checkmate(): boolean;
  in_draw(): boolean;
  in_stalemate(): boolean;
  load(fen: string): boolean;
}

// Declare the global Chess constructor from CDN
declare global {
  const Chess: new (fen?: string) => ChessInstance;
}
