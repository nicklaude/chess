import type * as THREE from 'three';
import type { Board, ChessMove, PieceType } from './game';

// ===============================================================
// OrbitControls interface for CDN-loaded THREE.OrbitControls
// ===============================================================

export interface OrbitControlsLike {
  enableDamping: boolean;
  dampingFactor: number;
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
  target: THREE.Vector3;
  screenSpacePanning: boolean;
  update(): void;
}

// ===============================================================
// THREE.js mesh user data
// ===============================================================

export interface SquareUserData {
  square: string;
  row: number;
  col: number;
  origColor: number;      // Hex color
  timelineId: number;
  turn: number;           // -1 for main board, 0+ for history
  isHistory?: boolean;
}

export interface HighlightEntry {
  type: 'sq' | 'ind';
  mesh: THREE.Mesh;
}

// ===============================================================
// Timeline column (3D board visualization)
// ===============================================================

export interface HistoryLayerData {
  moveFrom: string;
  moveTo: string;
  isWhite: boolean;
  sqMeshes?: THREE.Mesh[];
}

export interface TimelineColConfig {
  scene: THREE.Scene;
  id: number;
  xOffset: number;
  tintColor: number;
  texCache: TextureCache;
  pieceChars: PieceCharMap;
  pieceTex: (char: string, isWhite: boolean) => THREE.Texture;
}

// ===============================================================
// Texture and piece rendering
// ===============================================================

export type TextureCache = Record<string, THREE.Texture>;

export type PieceCharMap = Record<string, string>;

// ===============================================================
// Camera animation
// ===============================================================

export interface FocusTween {
  start: THREE.Vector3;
  end: THREE.Vector3;
  startTime: number;
  duration: number;
}

// ===============================================================
// Keyboard state
// ===============================================================

export interface PanKeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  q: boolean;
  e: boolean;
}

// ===============================================================
// TimelineCol class interface
// ===============================================================

export interface ITimelineCol {
  id: number;
  xOffset: number;
  group: THREE.Group;
  interLayerGroup: THREE.Group;

  render(position: Board): void;
  select(sq: string): void;
  showLegalMoves(moves: ChessMove[], position: Board): void;
  showLastMove(from: string, to: string): void;
  clearHighlights(): void;
  addMoveLine(from: string, to: string, isWhite: boolean): void;
  addSnapshot(position: Board, moveFrom: string, moveTo: string, isWhite: boolean): void;
  setActive(active: boolean): void;
  setHighlighted(highlighted: boolean): void;
  setBoardGlow(state: 'checkmate' | 'draw' | 'none'): void;
  getAllSquareMeshes(): THREE.Mesh[];
  clearAll(): void;
  destroy(): void;
  markBranchDrawn(snapshotIndex: number): void;
  hasBranchDrawn(snapshotIndex: number): boolean;
  showCrossTimelineTarget(sq: string, isCapture: boolean): void;
  clearCrossTimelineTargets(): void;
  /**
   * Validates that no duplicate sprites exist at MAIN_PIECE_Y height.
   * If duplicates are found, logs an error with details and removes the extras.
   * @returns true if no duplicates were found, false if duplicates were detected and fixed
   */
  validateNoDuplicates(): boolean;
}

// ===============================================================
// Board3D module interface
// ===============================================================

export interface IBoard3D {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  controls: OrbitControlsLike | null;

  timelineCols: Record<number, ITimelineCol>;

  PIECE_CHARS: PieceCharMap;
  TIMELINE_COLORS: number[];
  TIMELINE_SPACING: number;

  init(containerId: string, onSquareClick: (info: { timelineId: number; square: string; turn: number; isHistory: boolean }) => void): void;
  createTimeline(id: number, xOffset: number): ITimelineCol;
  getTimeline(id: number): ITimelineCol | undefined;
  removeTimeline(id: number): void;
  setActiveTimeline(id: number): void;
  focusTimeline(id: number, animate: boolean): void;
  addBranchLine(fromTlId: number, fromTurn: number, toTlId: number): void;
  notifySnapshotAdded(timelineId: number): void;
  spawnPortalEffect(timelineId: number, square: string): void;
  spawnCaptureEffect(timelineId: number, square: string): void;
  clearAll(): void;

  // Board navigation methods
  selectBoard(index: number): void;
  cycleBoard(direction: 1 | -1): void;
  zoomInOnSelected(): void;
  zoomOut(): void;
  toggleZoom(): void;
  getTimelineCount(): number;
  getSelectedBoardIndex(): number | null;
}
