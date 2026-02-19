/* Three.js 6D Chess - multiverse with timeline branching */

// THREE.js is loaded from CDN as a global - we just use the types from @types/three
import type {
  Scene, PerspectiveCamera, WebGLRenderer, Raycaster, Vector2, Vector3, Clock,
  Group, Mesh, Sprite, Points, Material, MeshStandardMaterial, SpriteMaterial,
  Texture, Object3D, BufferAttribute, Color, BoxGeometry, Curve, BufferGeometry
} from 'three';

import type {
  Board,
  ChessMove,
  HighlightEntry,
  PieceCharMap,
  TextureCache,
  FocusTween,
  PanKeyState,
  ITimelineCol,
  IBoard3D,
} from './types';

// OrbitControls from CDN is attached to global THREE
interface OrbitControlsInstance {
  enableDamping: boolean;
  dampingFactor: number;
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  minDistance: number;
  maxDistance: number;
  maxPolarAngle: number;
  target: Vector3;
  screenSpacePanning: boolean;
  update(): void;
}

// Declare THREE as a global (loaded from CDN)
declare const THREE: typeof import('three') & {
  OrbitControls: new (camera: PerspectiveCamera, domElement: HTMLElement) => OrbitControlsInstance;
};

// ===============================================================
// Module-level constants - accessible to all classes in this file
// ===============================================================

// Debug mode for piece overlap investigation
// Set to true to enable detailed render logging
const DEBUG_MODE = true;

// ===============================================================
// SharedResources - singleton for shared geometries and materials
// Performance optimization: create once, reuse everywhere
// ===============================================================

class SharedResources {
  private static _instance: SharedResources | null = null;

  // Shared geometries (created once, reused everywhere)
  squareGeometry: InstanceType<typeof THREE.PlaneGeometry> | null = null;
  historySquareGeometry: InstanceType<typeof THREE.BoxGeometry> | null = null;
  boardBaseGeometry: InstanceType<typeof THREE.BoxGeometry> | null = null;
  boardTrimGeometry: InstanceType<typeof THREE.BoxGeometry> | null = null;
  historyBaseGeometry: InstanceType<typeof THREE.BoxGeometry> | null = null;

  // Move indicator geometries
  moveIndicatorCircle: InstanceType<typeof THREE.CircleGeometry> | null = null;
  moveIndicatorRing: InstanceType<typeof THREE.RingGeometry> | null = null;
  lastMoveHighlightGeometry: InstanceType<typeof THREE.PlaneGeometry> | null = null;

  // Cross-timeline indicator geometries
  crossTimelineRingSmall: InstanceType<typeof THREE.RingGeometry> | null = null;
  crossTimelineRingLarge: InstanceType<typeof THREE.RingGeometry> | null = null;
  crossTimelineGlowGeometry: InstanceType<typeof THREE.CircleGeometry> | null = null;

  // Time travel portal geometries
  portalOuterRing: InstanceType<typeof THREE.TorusGeometry> | null = null;
  portalInnerGlow: InstanceType<typeof THREE.CircleGeometry> | null = null;
  portalCaptureRing: InstanceType<typeof THREE.TorusGeometry> | null = null;

  // Shared materials (not cloned - for objects that don't need per-instance color changes)
  boardBaseMat: MeshStandardMaterial | null = null;
  boardTrimMat: MeshStandardMaterial | null = null;
  historyBaseMat: MeshStandardMaterial | null = null;
  moveIndicatorMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  lastMoveHighlightMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  crossTimelineRingMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  crossTimelineGlowMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  portalRingMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  portalGlowMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  portalGlowCaptureMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;
  portalCaptureRingMat: InstanceType<typeof THREE.MeshBasicMaterial> | null = null;

  // Shared history square materials - use clones for per-layer opacity
  // PERFORMANCE: 2 base materials instead of 64+ per layer (768+ for 12 layers)
  historySquareLightMat: MeshStandardMaterial | null = null;
  historySquareDarkMat: MeshStandardMaterial | null = null;

  static getInstance(): SharedResources {
    if (!SharedResources._instance) {
      SharedResources._instance = new SharedResources();
      SharedResources._instance._init();
    }
    return SharedResources._instance;
  }

  private _init(): void {
    // === Geometries ===
    this.squareGeometry = new THREE.PlaneGeometry(0.96, 0.96);
    this.historySquareGeometry = new THREE.BoxGeometry(0.93, 0.025, 0.93);
    this.boardBaseGeometry = new THREE.BoxGeometry(8.6, 0.18, 8.6);
    this.boardTrimGeometry = new THREE.BoxGeometry(8.8, 0.06, 8.8);
    this.historyBaseGeometry = new THREE.BoxGeometry(8.2, 0.03, 8.2);

    // Move indicators
    this.moveIndicatorCircle = new THREE.CircleGeometry(0.14, 32);
    this.moveIndicatorRing = new THREE.RingGeometry(0.34, 0.44, 32);
    this.lastMoveHighlightGeometry = new THREE.PlaneGeometry(0.96, 0.96);

    // Cross-timeline indicators
    this.crossTimelineRingSmall = new THREE.RingGeometry(0.28, 0.38, 32);
    this.crossTimelineRingLarge = new THREE.RingGeometry(0.38, 0.48, 32);
    this.crossTimelineGlowGeometry = new THREE.CircleGeometry(0.5, 32);

    // Time travel portals
    this.portalOuterRing = new THREE.TorusGeometry(0.42, 0.06, 8, 32);
    this.portalInnerGlow = new THREE.CircleGeometry(0.36, 32);
    this.portalCaptureRing = new THREE.TorusGeometry(0.48, 0.04, 8, 32);

    // === Shared Materials ===
    this.boardBaseMat = new THREE.MeshStandardMaterial({
      color: 0x15152a,
      metalness: 0.7,
      roughness: 0.3,
    });
    this.boardTrimMat = new THREE.MeshStandardMaterial({
      color: 0x333366,
      metalness: 0.9,
      roughness: 0.2,
    });
    this.historyBaseMat = new THREE.MeshStandardMaterial({
      color: 0x15152a,
      transparent: true,
      opacity: 0.25,
      metalness: 0.5,
      roughness: 0.5,
    });

    // History square materials - shared base materials for cloning
    // Using clone() allows per-layer opacity while sharing the base material properties
    this.historySquareLightMat = new THREE.MeshStandardMaterial({
      color: 0x5a5a88,  // Darker colors for history squares
      transparent: true,
      opacity: 0.15,
      metalness: 0.15,
      roughness: 0.8,
    });
    this.historySquareDarkMat = new THREE.MeshStandardMaterial({
      color: 0x38385a,
      transparent: true,
      opacity: 0.15,
      metalness: 0.15,
      roughness: 0.8,
    });

    this.moveIndicatorMat = new THREE.MeshBasicMaterial({
      color: 0xffdd44,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.lastMoveHighlightMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.crossTimelineRingMat = new THREE.MeshBasicMaterial({
      color: 0xaa44ff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.crossTimelineGlowMat = new THREE.MeshBasicMaterial({
      color: 0xaa44ff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.portalRingMat = new THREE.MeshBasicMaterial({
      color: 0x44ffaa,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    this.portalGlowMat = new THREE.MeshBasicMaterial({
      color: 0x44ffaa,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.portalGlowCaptureMat = new THREE.MeshBasicMaterial({
      color: 0x44ffaa,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.portalCaptureRingMat = new THREE.MeshBasicMaterial({
      color: 0xff6666,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
  }

  /** Dispose all shared resources (call on game shutdown) */
  dispose(): void {
    this.squareGeometry?.dispose();
    this.historySquareGeometry?.dispose();
    this.boardBaseGeometry?.dispose();
    this.boardTrimGeometry?.dispose();
    this.historyBaseGeometry?.dispose();
    this.moveIndicatorCircle?.dispose();
    this.moveIndicatorRing?.dispose();
    this.lastMoveHighlightGeometry?.dispose();
    this.crossTimelineRingSmall?.dispose();
    this.crossTimelineRingLarge?.dispose();
    this.crossTimelineGlowGeometry?.dispose();
    this.portalOuterRing?.dispose();
    this.portalInnerGlow?.dispose();
    this.portalCaptureRing?.dispose();

    this.boardBaseMat?.dispose();
    this.boardTrimMat?.dispose();
    this.historyBaseMat?.dispose();
    this.historySquareLightMat?.dispose();
    this.historySquareDarkMat?.dispose();
    this.moveIndicatorMat?.dispose();
    this.lastMoveHighlightMat?.dispose();
    this.crossTimelineRingMat?.dispose();
    this.crossTimelineGlowMat?.dispose();
    this.portalRingMat?.dispose();
    this.portalGlowMat?.dispose();
    this.portalGlowCaptureMat?.dispose();
    this.portalCaptureRingMat?.dispose();

    SharedResources._instance = null;
  }
}

// ===============================================================
// MeshPool - object pooling for frequently created/destroyed objects
// Reduces GC pressure and allocation overhead for 100+ timelines
// ===============================================================

interface PooledMesh extends Mesh {
  _poolType?: string;
}

class MeshPool {
  private pools: Map<string, PooledMesh[]> = new Map();
  private maxPoolSize = 200;  // Allow more pooled objects for 100+ timelines

  /** Get a mesh from the pool or create a new one */
  acquire(
    type: string,
    geometry: BufferGeometry,
    material: Material
  ): PooledMesh {
    const pool = this.pools.get(type);
    if (pool && pool.length > 0) {
      const mesh = pool.pop()!;
      mesh.visible = true;
      return mesh;
    }
    const mesh = new THREE.Mesh(geometry, material) as PooledMesh;
    mesh._poolType = type;
    mesh.frustumCulled = true;  // Enable frustum culling for performance
    return mesh;
  }

  /** Return a mesh to the pool */
  release(mesh: PooledMesh): void {
    const type = mesh._poolType;
    if (!type) return;

    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
    mesh.visible = false;

    let pool = this.pools.get(type);
    if (!pool) {
      pool = [];
      this.pools.set(type, pool);
    }
    if (pool.length < this.maxPoolSize) {
      pool.push(mesh);
    }
    // If pool is full, let it be garbage collected (don't dispose shared geometry/material)
  }

  /** Clear all pools */
  clear(): void {
    this.pools.clear();
  }
}

// Global pool instance
const meshPool = new MeshPool();

// ===============================================================
// SpritePool - object pooling for piece sprites
// Reduces GC pressure from destroying/creating 32 sprites per move
// ===============================================================

interface PooledSprite extends Sprite {
  _pooled?: boolean;
}

class SpritePool {
  private pool: PooledSprite[] = [];
  private maxPoolSize = 128;  // Enough for 4 boards worth of pieces
  private static readonly WARNING_THRESHOLD = 64;  // Log when pool exceeds this
  private _totalCreated = 0;  // Track total sprites ever created for monitoring

  /** Get a sprite from the pool or create a new one */
  acquire(material: SpriteMaterial): PooledSprite {
    if (this.pool.length > 0) {
      const sprite = this.pool.pop()!;
      sprite.visible = true;
      // Update material - dispose old one and assign new
      if (sprite.material && sprite.material !== material) {
        (sprite.material as SpriteMaterial).dispose();
      }
      sprite.material = material;
      return sprite;
    }
    const sprite = new THREE.Sprite(material) as PooledSprite;
    sprite._pooled = true;
    sprite.frustumCulled = true;
    this._totalCreated++;

    // Monitor: warn if we've created many sprites (potential memory leak indicator)
    if (this._totalCreated > 0 && this._totalCreated % 100 === 0) {
      console.warn('[SpritePool] Created', this._totalCreated, 'sprites total. Pool size:', this.pool.length);
    }

    return sprite;
  }

  /** Return a sprite to the pool */
  release(sprite: PooledSprite): void {
    if (!sprite._pooled) return;

    if (sprite.parent) {
      sprite.parent.remove(sprite);
    }
    sprite.visible = false;

    if (this.pool.length < this.maxPoolSize) {
      this.pool.push(sprite);
    } else {
      // Pool is full - dispose this sprite
      if (sprite.material) {
        (sprite.material as SpriteMaterial).dispose();
      }
    }

    // Monitor: warn if pool grows beyond expected size
    if (this.pool.length > SpritePool.WARNING_THRESHOLD && this.pool.length % 16 === 0) {
      console.warn('[SpritePool] Pool size exceeds threshold:', this.pool.length, '/', this.maxPoolSize);
    }
  }

  /**
   * Trim the pool to reduce memory usage.
   * Destroys excess sprites if pool size exceeds the target.
   * Call periodically (e.g., after major state changes) to prevent unbounded growth.
   *
   * @param targetSize - Target pool size to trim to (default: half of max)
   */
  trim(targetSize?: number): void {
    const target = targetSize ?? Math.floor(this.maxPoolSize / 2);
    let trimmed = 0;

    while (this.pool.length > target) {
      const sprite = this.pool.pop();
      if (sprite?.material) {
        (sprite.material as SpriteMaterial).dispose();
      }
      trimmed++;
    }

    if (trimmed > 0) {
      console.log('[SpritePool] Trimmed', trimmed, 'sprites. Pool size now:', this.pool.length);
    }
  }

  /** Get current pool size (for monitoring) */
  size(): number {
    return this.pool.length;
  }

  /** Get total sprites created (for monitoring memory leaks) */
  totalCreated(): number {
    return this._totalCreated;
  }

  /** Clear all pooled sprites */
  clear(): void {
    for (const sprite of this.pool) {
      if (sprite.material) {
        (sprite.material as SpriteMaterial).dispose();
      }
    }
    this.pool = [];
  }
}

// Global sprite pool instance
const spritePool = new SpritePool();

// ===============================================================
// TimelineCol - one per timeline
// ===============================================================

export class TimelineCol implements ITimelineCol {
  static readonly LAYER_GAP = 2.8;
  static readonly MAX_LAYERS = 12;
  // Y positions for pieces - main board at 0.22, history at 0.12
  // These MUST be different to prevent visual overlap
  static readonly MAIN_PIECE_Y = 0.22;
  static readonly HISTORY_PIECE_Y = 0.12;
  // Board bounds for piece position validation (8x8 board centered at origin).
  // Pieces are placed at positions col-3.5 (from -3.5 to 3.5), but we use
  // slightly wider bounds (-4 to 4) to account for floating-point tolerance.
  // This excludes file/rank labels which are positioned at +/-4.4.
  private static readonly BOARD_MIN = -4;
  private static readonly BOARD_MAX = 4;

  private scene: Scene;
  private shared: SharedResources;
  id: number;
  xOffset: number;
  private tint: number;
  private _texCache: TextureCache;
  private _pieceChars: PieceCharMap;
  private _pieceTex: (char: string, isWhite: boolean) => Texture;

  group: Group;
  private squareMeshes: Mesh[] = [];
  private pieceMeshes: Sprite[] = [];
  private highlightMeshes: HighlightEntry[] = [];
  private lastMoveHL: Mesh[] = [];
  historyLayers: Group[] = [];  // Public for branch line rebuilding
  private historySquareMeshes: Mesh[] = [];
  private moveLineGroup: Group;
  interLayerGroup: Group;
  private crossTimelineTargets: Mesh[] = [];  // Purple highlights for cross-timeline moves
  private timeTravelTargets: Mesh[] = [];     // Cyan-green portals for time travel moves
  private drawnBranchIndices: Set<number> = new Set();  // Track which snapshot indices have branches drawn

  // Performance: track previous board state for diff-based rendering
  // Store as map of "row,col" -> "type,color" to detect what changed
  private _prevBoardState: Map<string, string> = new Map();
  // Map sprite position key to the sprite at that position for efficient updates
  private _spriteMap: Map<string, Sprite> = new Map();
  // Debug: track if render is currently executing to detect reentrant calls
  private _renderInProgress = false;

  constructor(
    scene: Scene,
    id: number,
    xOffset: number,
    tintColor: number,
    texCache: TextureCache,
    pieceChars: PieceCharMap,
    pieceTex: (char: string, isWhite: boolean) => Texture
  ) {
    this.scene = scene;
    this.shared = SharedResources.getInstance();
    this.id = id;
    this.xOffset = xOffset;
    this.tint = tintColor;
    this._texCache = texCache;
    this._pieceChars = pieceChars;
    this._pieceTex = pieceTex;

    this.group = new THREE.Group();
    this.group.position.x = xOffset;

    this.moveLineGroup = new THREE.Group();
    this.interLayerGroup = new THREE.Group();
    this.group.add(this.moveLineGroup);
    this.group.add(this.interLayerGroup);

    this._buildBoard();
    scene.add(this.group);
  }

  private _toSq(r: number, c: number): string {
    return String.fromCharCode(97 + c) + (8 - r);
  }

  private _fromSq(sq: string): { r: number; c: number } {
    return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
  }

  /**
   * Type guard for checking if an Object3D is a main board piece sprite.
   * Used to identify piece sprites that need cleanup during render(),
   * distinguishing them from history layer sprites and UI elements.
   *
   * Criteria:
   * - Must be a Sprite (has isSprite property)
   * - Y position within 0.01 of MAIN_PIECE_Y (tolerance for floating point)
   * - X/Z within board bounds (excludes file/rank labels positioned at +/-4.4)
   *
   * @param obj - The Object3D to check
   * @returns true if obj is a main board piece sprite, false otherwise
   */
  private _isMainBoardSprite(obj: Object3D): obj is Sprite {
    // Guard against null/undefined
    if (!obj) return false;
    // Check if it's a Sprite
    if (!(obj as Sprite).isSprite) return false;
    // Check Y position tolerance (pieces at MAIN_PIECE_Y vs history at HISTORY_PIECE_Y)
    if (Math.abs(obj.position.y - TimelineCol.MAIN_PIECE_Y) >= 0.01) return false;
    // Check X/Z bounds (pieces from -3.5 to 3.5, labels at +/-4.4)
    const { x, z } = obj.position;
    return x >= TimelineCol.BOARD_MIN && x <= TimelineCol.BOARD_MAX &&
           z >= TimelineCol.BOARD_MIN && z <= TimelineCol.BOARD_MAX;
  }

  private _sqToWorld(sq: string, y?: number): Vector3 {
    const p = this._fromSq(sq);
    return new THREE.Vector3(p.c - 3.5 + this.xOffset, y || 0, p.r - 3.5);
  }

  /* board base + squares */
  private _buildBoard(): void {
    // Base board - using shared geometry and material
    const base = new THREE.Mesh(
      this.shared.boardBaseGeometry!,
      this.shared.boardBaseMat!
    );
    base.position.y = -0.16;
    base.receiveShadow = true;
    base.frustumCulled = true;
    this.group.add(base);

    const trim = new THREE.Mesh(
      this.shared.boardTrimGeometry!,
      this.shared.boardTrimMat!
    );
    trim.position.y = -0.28;
    trim.frustumCulled = true;
    this.group.add(trim);

    // Squares need per-instance materials for highlighting, but share geometry
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isLight = (r + c) % 2 === 0;
        // Clone material for per-square color changes (highlights)
        const mat = new THREE.MeshStandardMaterial({
          color: isLight ? 0x7575a8 : 0x44446e,
          metalness: 0.15,
          roughness: 0.75,
          side: THREE.FrontSide,
        });
        // Use shared PlaneGeometry
        const mesh = new THREE.Mesh(this.shared.squareGeometry!, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(c - 3.5, 0.035, r - 3.5);
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;  // Enable frustum culling
        mesh.userData = {
          square: this._toSq(r, c),
          row: r,
          col: c,
          origColor: mat.color.getHex(),
          timelineId: this.id,
          turn: -1,
        };
        this.squareMeshes.push(mesh);
        this.group.add(mesh);
      }
    }

    this._addLabels();
  }

  private _addLabels(): void {
    const files = 'abcdefgh';
    for (let i = 0; i < 8; i++) {
      const f = Board3DManager._textSprite(files[i], '#7777aa');
      f.position.set(i - 3.5, 0.05, 4.4);
      f.scale.set(0.35, 0.35, 0.35);
      this.group.add(f);
      const rk = Board3DManager._textSprite(String(8 - i), '#7777aa');
      rk.position.set(-4.4, 0.05, i - 3.5);
      rk.scale.set(0.35, 0.35, 0.35);
      this.group.add(rk);
    }
  }

  /* render pieces on current board - OPTIMIZED with diff-based updates and sprite pooling */
  render(position: Board): void {
    const timestamp = Date.now();

    // ALWAYS LOG: This log appears even when DEBUG_MODE is false to help debug overlap issues
    // Count pieces in position array for comparison
    let pieceCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (position[r][c]) pieceCount++;
      }
    }
    console.log(`[Board3D.render] tl=${this.id} meshes=${this.pieceMeshes.length} map=${this._spriteMap.size} prev=${this._prevBoardState.size} pieces=${pieceCount}`);

    // REENTRANT CALL DETECTION: Catch overlapping render calls that could cause duplicates
    if (this._renderInProgress) {
      console.error(`[Board3D.render] REENTRANT_CALL_BUG: render() called while already executing!`, {
        timeline: this.id,
        timestamp,
        stack: new Error().stack,
      });
      // Don't return - still try to render, but log the error
    }
    this._renderInProgress = true;

    // DEBUG: Log render entry with stack trace to identify caller
    if (DEBUG_MODE) {
      const stackLines = new Error().stack?.split('\n').slice(1, 5).join('\n') || '';
      console.log(`[Board3D.render] ENTRY timeline=${this.id} ts=${timestamp}`, {
        prevStateSize: this._prevBoardState.size,
        spriteMapSize: this._spriteMap.size,
        pieceMeshesCount: this.pieceMeshes.length,
        caller: stackLines,
      });
    }

    // Build new board state map for comparison
    const newBoardState = new Map<string, string>();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = position[r][c];
        if (piece) {
          const posKey = `${r},${c}`;
          const pieceKey = `${piece.type},${piece.color}`;
          newBoardState.set(posKey, pieceKey);
        }
      }
    }

    // Find what changed: removed, added, and unchanged positions
    const toRemove: string[] = [];
    const toAdd: string[] = [];

    // Check old positions - what was removed or changed
    this._prevBoardState.forEach((pieceKey, posKey) => {
      const newPieceKey = newBoardState.get(posKey);
      if (!newPieceKey || newPieceKey !== pieceKey) {
        toRemove.push(posKey);
      }
    });

    // Check new positions - what was added or changed
    newBoardState.forEach((pieceKey, posKey) => {
      const oldPieceKey = this._prevBoardState.get(posKey);
      if (!oldPieceKey || oldPieceKey !== pieceKey) {
        toAdd.push(posKey);
      }
    });

    // PERFORMANCE: Skip if nothing changed
    if (toRemove.length === 0 && toAdd.length === 0 && this._prevBoardState.size === newBoardState.size) {
      if (DEBUG_MODE) {
        console.log(`[Board3D.render] SKIP (no changes) timeline=${this.id}`);
      }
      this._renderInProgress = false;  // Reset flag on early return
      return;
    }

    // DEBUG: Log what's changing
    if (DEBUG_MODE) {
      console.log(`[Board3D.render] CHANGES timeline=${this.id}`, {
        toRemove,
        toAdd,
        prevSize: this._prevBoardState.size,
        newSize: newBoardState.size,
      });
    }

    // Remove sprites for positions that changed or are now empty
    for (const posKey of toRemove) {
      const sprite = this._spriteMap.get(posKey) as PooledSprite | undefined;
      if (sprite) {
        // Return to pool for reuse
        spritePool.release(sprite);
        this._spriteMap.delete(posKey);
        // Remove from pieceMeshes array
        const idx = this.pieceMeshes.indexOf(sprite);
        if (idx !== -1) {
          this.pieceMeshes.splice(idx, 1);
        }
      }
    }

    // Add sprites for positions that are new or changed
    for (const posKey of toAdd) {
      const [rStr, cStr] = posKey.split(',');
      const r = parseInt(rStr);
      const c = parseInt(cStr);
      const piece = position[r][c];
      if (!piece) continue;  // Safety check

      // DEFENSIVE CHECK: If _spriteMap already has a sprite at this position,
      // release it first to prevent overlaps from race conditions or edge cases
      const existingSprite = this._spriteMap.get(posKey) as PooledSprite | undefined;
      if (existingSprite) {
        if (DEBUG_MODE) {
          console.warn('[Board3D] Defensive cleanup: releasing existing sprite before adding new one', {
            timeline: this.id,
            posKey,
            timestamp,
          });
        }
        spritePool.release(existingSprite);
        const existingIdx = this.pieceMeshes.indexOf(existingSprite);
        if (existingIdx !== -1) {
          this.pieceMeshes.splice(existingIdx, 1);
        }
        this._spriteMap.delete(posKey);
      }

      const isW = piece.color === 'w';
      const chKey = isW ? piece.type.toUpperCase() : piece.type;
      const tex = this._pieceTex(this._pieceChars[chKey], isW);
      const material = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });

      // Get sprite from pool (or create new one)
      const sprite = spritePool.acquire(material);
      sprite.position.set(c - 3.5, TimelineCol.MAIN_PIECE_Y, r - 3.5);
      sprite.scale.set(0.88, 0.88, 0.88);

      // DEBUG: Check if any sprite already exists at this position in the scene BEFORE adding
      if (DEBUG_MODE) {
        let existingCount = 0;
        for (const child of this.group.children) {
          if (this._isMainBoardSprite(child as Object3D)) {
            const childCol = Math.round((child as Object3D).position.x + 3.5);
            const childRow = Math.round((child as Object3D).position.z + 3.5);
            if (childRow === r && childCol === c) {
              existingCount++;
              console.error(`[Board3D.render] DUPLICATE_CREATION: About to add sprite at ${posKey} but ${existingCount} already exists!`, {
                timeline: this.id,
                existingChild: child,
                newSprite: sprite,
              });
            }
          }
        }
      }

      this.group.add(sprite);
      this.pieceMeshes.push(sprite);
      this._spriteMap.set(posKey, sprite);
    }

    // Update stored state for next render
    this._prevBoardState = newBoardState;

    // SAFETY: Clean up any orphaned sprites not in our map (in case of bugs)
    // This handles edge cases like rapid state changes
    // Use position-based lookup instead of identity to catch sprites that may
    // have been added at the same position with different object references
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (this._isMainBoardSprite(child)) {
        // Calculate position key matching _spriteMap format
        const col = Math.round(child.position.x + 3.5);
        const row = Math.round(child.position.z + 3.5);
        const posKey = `${row},${col}`;

        // Check if THIS sprite is the canonical one at this position
        const mapSprite = this._spriteMap.get(posKey);
        if (!mapSprite || mapSprite !== child) {
          // Either position not in map, or a different sprite is canonical - this is orphaned
          console.warn(`[Board3D.render] ORPHAN_CLEANUP timeline=${this.id} posKey=${posKey}`, {
            hasMapSprite: !!mapSprite,
            isSameSprite: mapSprite === child,
            childY: child.position.y,
          });
          this.group.remove(child);
          spritePool.release(child as PooledSprite);
          // Also remove from pieceMeshes if present
          const idx = this.pieceMeshes.indexOf(child);
          if (idx !== -1) {
            this.pieceMeshes.splice(idx, 1);
          }
        }
      }
    }

    // DEBUG: Validation checks
    if (DEBUG_MODE) {
      const expectedCount = newBoardState.size;
      if (this.pieceMeshes.length !== expectedCount) {
        console.error('[Board3D] VISUAL_TRAILS_BUG: Sprite count mismatch!', {
          timeline: this.id,
          timestamp,
          expected: expectedCount,
          actual: this.pieceMeshes.length,
          removed: toRemove.length,
          added: toAdd.length,
        });
      }

      // Check for duplicates - use same key format as _spriteMap ("row,col")
      let spritesAtPieceHeight = 0;
      const spritePositions: Map<string, number> = new Map();
      this.group.traverse((child: Object3D) => {
        if ((child as Sprite).isSprite && Math.abs(child.position.y - TimelineCol.MAIN_PIECE_Y) < 0.01) {
          const x = child.position.x;
          const z = child.position.z;
          if (x >= -4 && x <= 4 && z >= -4 && z <= 4) {
            spritesAtPieceHeight++;
            // Use board coordinates matching _spriteMap format
            const col = Math.round(x + 3.5);
            const row = Math.round(z + 3.5);
            const posKey = `${row},${col}`;
            spritePositions.set(posKey, (spritePositions.get(posKey) || 0) + 1);
          }
        }
      });

      const duplicates: string[] = [];
      spritePositions.forEach((count, pos) => {
        if (count > 1) duplicates.push(`${pos} (${count} sprites)`);
      });

      if (duplicates.length > 0) {
        console.error('[Board3D] PIECE_OVERLAP_BUG: Duplicate sprites detected!', {
          timeline: this.id,
          timestamp,
          duplicates,
        });
      }
    }

    // Reset reentrant flag at end of render
    this._renderInProgress = false;
  }

  /**
   * Validates that no duplicate sprites exist at MAIN_PIECE_Y height.
   * If duplicates are found, logs an error with details and removes the extras.
   * This is a defensive check to catch edge cases where sprites weren't properly
   * cleaned up during render(), which can happen due to Three.js scene graph timing.
   *
   * IMPORTANT: When removing duplicates, this method also syncs:
   * - pieceMeshes array (removes duplicate entries)
   * - _spriteMap (updates to point to the kept sprite)
   * - Returns duplicates to spritePool for reuse
   *
   * @param currentBoard Optional - if provided and duplicates found, will do a full rebuild
   * @returns true if no duplicates were found (validation passed),
   *          false if duplicates were detected and auto-fixed
   */
  validateNoDuplicates(currentBoard?: Board): boolean {
    const timestamp = Date.now();
    const positionMap = new Map<string, { sprite: Sprite; pieceInfo: string; boardPosKey: string }[]>();

    // First pass: collect all sprites at MAIN_PIECE_Y grouped by position
    // CRITICAL: Use SAME key format as _spriteMap ("row,col" integers) to ensure consistency
    for (let i = 0; i < this.group.children.length; i++) {
      const child = this.group.children[i];
      if (this._isMainBoardSprite(child)) {
        // Calculate board position key (row,col) - MUST match _spriteMap format from render()
        const col = Math.round(child.position.x + 3.5);
        const row = Math.round(child.position.z + 3.5);
        const posKey = `${row},${col}`;  // Same format as render() uses for _spriteMap

        // Extract piece info from sprite texture/material for diagnostics
        const material = child.material as SpriteMaterial | undefined;
        const pieceInfo = material?.map?.name ?? material?.name ?? 'unknown';

        const boardPosKey = posKey;  // Already in the correct format

        if (!positionMap.has(posKey)) {
          positionMap.set(posKey, []);
        }
        positionMap.get(posKey)!.push({ sprite: child, pieceInfo, boardPosKey });
      }
    }

    // Second pass: identify duplicates
    let foundDuplicates = false;
    const duplicateInfo: string[] = [];
    positionMap.forEach((sprites, posKey) => {
      if (sprites.length > 1) {
        foundDuplicates = true;

        // Convert position key (now "row,col" format) back to chess square for logging
        const [rowStr, colStr] = posKey.split(',');
        const row = parseInt(rowStr);
        const col = parseInt(colStr);

        // Validate calculated square is within valid chess board range
        let square: string;
        if (col >= 0 && col <= 7 && row >= 0 && row <= 7) {
          square = String.fromCharCode(97 + col) + (8 - row);
        } else {
          square = `invalid(col=${col},row=${row})`;
        }

        duplicateInfo.push(`${square}: ${sprites.length} sprites (${sprites.map(s => s.pieceInfo).join(', ')})`);
      }
    });

    if (foundDuplicates) {
      console.error('[Board3D] PIECE_OVERLAP_BUG: Duplicate sprites detected!', {
        timeline: this.id,
        timestamp,
        duplicates: duplicateInfo,
      });

      // If we have the current board state, do a complete rebuild instead of trying to fix in place
      if (currentBoard) {
        console.warn('[Board3D] Performing full rebuild to fix duplicates');
        this.forceFullRebuild(currentBoard);
        return false;
      }

      // Otherwise, try to fix in place (legacy behavior)
      positionMap.forEach((sprites, posKey) => {
        if (sprites.length > 1) {
          // Keep the first sprite, update _spriteMap to point to it
          const keptSprite = sprites[0].sprite;
          const boardPosKey = sprites[0].boardPosKey;
          this._spriteMap.set(boardPosKey, keptSprite);

          // Remove the duplicate sprites (all but the first)
          for (let i = 1; i < sprites.length; i++) {
            const spriteEntry = sprites[i];
            if (spriteEntry && spriteEntry.sprite) {
              // Remove from pieceMeshes array
              const pieceMeshIdx = this.pieceMeshes.indexOf(spriteEntry.sprite);
              if (pieceMeshIdx !== -1) {
                this.pieceMeshes.splice(pieceMeshIdx, 1);
              }

              // Return to sprite pool (handles removal from parent and disposal)
              spritePool.release(spriteEntry.sprite as PooledSprite);
            }
          }
        }
      });
    }

    return !foundDuplicates;
  }

  /**
   * Force a complete rebuild of all piece sprites.
   * This is a nuclear option for when state gets out of sync.
   * Clears all existing sprites and re-renders from scratch.
   */
  forceFullRebuild(position: Board): void {
    console.warn(`[Board3D] FORCE_REBUILD timeline=${this.id} - clearing all state and re-rendering`);

    // Clear all piece sprites - return to pool
    for (let i = this.pieceMeshes.length - 1; i >= 0; i--) {
      const sprite = this.pieceMeshes[i] as PooledSprite;
      spritePool.release(sprite);
    }
    this.pieceMeshes.length = 0;

    // Clear tracking state
    this._prevBoardState.clear();
    this._spriteMap.clear();

    // Now render from scratch
    this.render(position);

    console.warn(`[Board3D] FORCE_REBUILD complete - now have ${this.pieceMeshes.length} sprites`);
  }

  /* highlight / selection */
  select(sq: string): void {
    this.clearHighlights();
    const pos = this._fromSq(sq);
    const m = this.squareMeshes[pos.r * 8 + pos.c];
    (m.material as MeshStandardMaterial).color.setHex(0xbba030);
    (m.material as MeshStandardMaterial).emissive = new THREE.Color(0x554410);
    this.highlightMeshes.push({ type: 'sq', mesh: m });
  }

  showLegalMoves(moves: ChessMove[], position: Board): void {
    for (let i = 0; i < moves.length; i++) {
      const p = this._fromSq(moves[i].to);
      const hasPiece = position[p.r][p.c] !== null;
      // Use shared geometry and material via object pool
      const geo = hasPiece
        ? this.shared.moveIndicatorRing!
        : this.shared.moveIndicatorCircle!;
      const poolType = hasPiece ? 'moveIndicatorRing' : 'moveIndicatorCircle';
      const ind = meshPool.acquire(poolType, geo, this.shared.moveIndicatorMat!);
      ind.rotation.x = -Math.PI / 2;
      ind.position.set(p.c - 3.5, 0.06, p.r - 3.5);
      this.group.add(ind);
      this.highlightMeshes.push({ type: 'ind', mesh: ind });
    }
  }

  showLastMove(from: string, to: string): void {
    // Return old highlights to pool
    for (let i = 0; i < this.lastMoveHL.length; i++) {
      meshPool.release(this.lastMoveHL[i] as PooledMesh);
    }
    this.lastMoveHL = [];
    const sqs = [from, to];
    for (let i = 0; i < 2; i++) {
      const pos = this._fromSq(sqs[i]);
      // Use shared geometry and material via pool
      const pl = meshPool.acquire(
        'lastMoveHighlight',
        this.shared.lastMoveHighlightGeometry!,
        this.shared.lastMoveHighlightMat!
      );
      pl.rotation.x = -Math.PI / 2;
      pl.position.set(pos.c - 3.5, 0.055, pos.r - 3.5);
      this.group.add(pl);
      this.lastMoveHL.push(pl);
    }
  }

  /** CPU move preview - highlight source piece and show target with portal colors */
  private cpuPreviewMeshes: Mesh[] = [];

  showCpuMovePreview(from: string, to: string, isWhite: boolean, isTimeTravel: boolean = false): void {
    this.clearCpuMovePreview();

    const fromPos = this._fromSq(from);
    const toPos = this._fromSq(to);
    const color = isTimeTravel ? 0x44ffaa : (isWhite ? 0x88ccff : 0xffaa66);  // Cyan for time travel, blue/orange for normal

    // Highlight source square with glowing ring
    const sourceGeo = new THREE.RingGeometry(0.42, 0.52, 32);
    const sourceMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sourceRing = new THREE.Mesh(sourceGeo, sourceMat);
    sourceRing.rotation.x = -Math.PI / 2;
    sourceRing.position.set(fromPos.c - 3.5, 0.12, fromPos.r - 3.5);
    this.group.add(sourceRing);
    this.cpuPreviewMeshes.push(sourceRing);

    // Source glow disc
    const sourceGlowGeo = new THREE.CircleGeometry(0.45, 32);
    const sourceGlowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sourceGlow = new THREE.Mesh(sourceGlowGeo, sourceGlowMat);
    sourceGlow.rotation.x = -Math.PI / 2;
    sourceGlow.position.set(fromPos.c - 3.5, 0.10, fromPos.r - 3.5);
    this.group.add(sourceGlow);
    this.cpuPreviewMeshes.push(sourceGlow);

    // Target indicator (portal-style ring like cross-timeline targets)
    const targetGeo = new THREE.RingGeometry(0.35, 0.48, 32);
    const targetMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const targetRing = new THREE.Mesh(targetGeo, targetMat);
    targetRing.rotation.x = -Math.PI / 2;
    targetRing.position.set(toPos.c - 3.5, 0.09, toPos.r - 3.5);
    this.group.add(targetRing);
    this.cpuPreviewMeshes.push(targetRing);

    // Target glow
    const targetGlowGeo = new THREE.CircleGeometry(0.45, 32);
    const targetGlowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const targetGlow = new THREE.Mesh(targetGlowGeo, targetGlowMat);
    targetGlow.rotation.x = -Math.PI / 2;
    targetGlow.position.set(toPos.c - 3.5, 0.07, toPos.r - 3.5);
    this.group.add(targetGlow);
    this.cpuPreviewMeshes.push(targetGlow);

    // Preview line connecting source to target
    const fromWorld = new THREE.Vector3(fromPos.c - 3.5, 0.15, fromPos.r - 3.5);
    const toWorld = new THREE.Vector3(toPos.c - 3.5, 0.15, toPos.r - 3.5);
    const previewLine = Board3DManager._glowTube(fromWorld, toWorld, color, 0.02, 0.08, false, 0.6);
    previewLine.userData.isCpuPreview = true;
    this.group.add(previewLine);
    this.cpuPreviewMeshes.push(previewLine as unknown as Mesh);
  }

  clearCpuMovePreview(): void {
    for (const mesh of this.cpuPreviewMeshes) {
      this.group.remove(mesh);
      // Dispose materials and geometry
      if ((mesh as Mesh).geometry) (mesh as Mesh).geometry.dispose();
      if ((mesh as Mesh).material) {
        const mat = (mesh as Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach(m => m.dispose());
        } else {
          (mat as Material).dispose();
        }
      }
      // If it's a Group (glow tube), traverse and dispose children
      if ((mesh as unknown as Group).isGroup) {
        (mesh as unknown as Group).traverse((child: Object3D) => {
          if ((child as Mesh).geometry) (child as Mesh).geometry.dispose();
          if ((child as Mesh).material) {
            ((child as Mesh).material as Material).dispose();
          }
        });
      }
    }
    this.cpuPreviewMeshes = [];
  }

  clearHighlights(): void {
    for (let i = 0; i < this.highlightMeshes.length; i++) {
      const h = this.highlightMeshes[i];
      if (h.type === 'sq') {
        (h.mesh.material as MeshStandardMaterial).color.setHex(
          h.mesh.userData.origColor as number
        );
        (h.mesh.material as MeshStandardMaterial).emissive = new THREE.Color(0);
      } else {
        // Return pooled meshes instead of disposing
        meshPool.release(h.mesh as PooledMesh);
      }
    }
    this.highlightMeshes = [];
  }

  /* Cross-timeline movement indicators - enhanced with vertical beams */
  showCrossTimelineTarget(sq: string, isCapture: boolean): void {
    const pos = this._fromSq(sq);
    // Use shared geometry and material via pool
    const geo = isCapture
      ? this.shared.crossTimelineRingLarge!
      : this.shared.crossTimelineRingSmall!;
    const poolType = isCapture ? 'crossTimelineRingLarge' : 'crossTimelineRingSmall';
    const ind = meshPool.acquire(poolType, geo, this.shared.crossTimelineRingMat!);
    ind.rotation.x = -Math.PI / 2;
    ind.position.set(pos.c - 3.5, 0.08, pos.r - 3.5);
    this.group.add(ind);
    this.crossTimelineTargets.push(ind);

    // Add pulsing glow effect
    const glow = meshPool.acquire(
      'crossTimelineGlow',
      this.shared.crossTimelineGlowGeometry!,
      this.shared.crossTimelineGlowMat!
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.c - 3.5, 0.07, pos.r - 3.5);
    this.group.add(glow);
    this.crossTimelineTargets.push(glow);

    // Vertical beam above square (highly visible portal indicator)
    const beamGeo = new THREE.CylinderGeometry(0.08, 0.15, 1.2, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xaa44ff,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(pos.c - 3.5, 0.7, pos.r - 3.5);
    this.group.add(beam);
    this.crossTimelineTargets.push(beam);

    // Capture indicator (red-ish outer ring if capturing)
    if (isCapture) {
      const captureRingGeo = new THREE.RingGeometry(0.52, 0.58, 32);
      const captureRingMat = new THREE.MeshBasicMaterial({
        color: 0xff6666,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const captureRing = new THREE.Mesh(captureRingGeo, captureRingMat);
      captureRing.rotation.x = -Math.PI / 2;
      captureRing.position.set(pos.c - 3.5, 0.10, pos.r - 3.5);
      this.group.add(captureRing);
      this.crossTimelineTargets.push(captureRing);
    }
  }

  clearCrossTimelineTargets(): void {
    for (const mesh of this.crossTimelineTargets) {
      // Some meshes are pooled, some are not (beams, capture rings)
      if ((mesh as PooledMesh)._poolType) {
        meshPool.release(mesh as PooledMesh);
      } else {
        this.group.remove(mesh);
        if ((mesh as Mesh).geometry) (mesh as Mesh).geometry.dispose();
        if ((mesh as Mesh).material) ((mesh as Mesh).material as Material).dispose();
      }
    }
    this.crossTimelineTargets = [];
    // Also clear board glow border
    this._clearBoardGlowBorder();
  }

  /** Add a glowing border around the entire board to indicate it's a valid target */
  showBoardGlowBorder(color: number = 0xaa44ff): void {
    this._clearBoardGlowBorder();

    // Create 4 edge beams around the board perimeter
    const halfSize = 4.3;  // Board is ~8.6 wide
    const beamHeight = 0.15;
    const beamWidth = 0.08;

    const edges = [
      { pos: [0, beamHeight, -halfSize], rot: [0, 0, 0], len: halfSize * 2 },  // Front edge
      { pos: [0, beamHeight, halfSize], rot: [0, 0, 0], len: halfSize * 2 },   // Back edge
      { pos: [-halfSize, beamHeight, 0], rot: [0, Math.PI / 2, 0], len: halfSize * 2 }, // Left edge
      { pos: [halfSize, beamHeight, 0], rot: [0, Math.PI / 2, 0], len: halfSize * 2 },  // Right edge
    ];

    for (const edge of edges) {
      const geo = new THREE.BoxGeometry(edge.len, beamWidth, beamWidth);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const beam = new THREE.Mesh(geo, mat);
      beam.position.set(edge.pos[0], edge.pos[1], edge.pos[2]);
      beam.rotation.set(edge.rot[0], edge.rot[1], edge.rot[2]);
      beam.userData.isBoardGlowBorder = true;
      this.group.add(beam);
    }

    // Add corner glow spheres
    const corners = [
      [-halfSize, beamHeight, -halfSize],
      [halfSize, beamHeight, -halfSize],
      [-halfSize, beamHeight, halfSize],
      [halfSize, beamHeight, halfSize],
    ];

    for (const corner of corners) {
      const geo = new THREE.SphereGeometry(0.12, 8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sphere = new THREE.Mesh(geo, mat);
      sphere.position.set(corner[0], corner[1], corner[2]);
      sphere.userData.isBoardGlowBorder = true;
      this.group.add(sphere);
    }
  }

  /** Clear the board glow border */
  private _clearBoardGlowBorder(): void {
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const child = this.group.children[i];
      if (child.userData.isBoardGlowBorder) {
        this.group.remove(child);
        if ((child as Mesh).geometry) (child as Mesh).geometry.dispose();
        if ((child as Mesh).material) ((child as Mesh).material as Material).dispose();
      }
    }
  }

  /* Time travel target indicators (on history layers) */
  showTimeTravelTarget(turnIndex: number, sq: string, isCapture: boolean): void {
    // turnIndex 0 = most recent history layer, which is at historyLayers[0]
    if (turnIndex < 0 || turnIndex >= this.historyLayers.length) return;

    const layer = this.historyLayers[turnIndex];
    if (!layer) return;

    const pos = this._fromSq(sq);

    // Outer glow ring - use shared geometry via pool
    const outerRing = meshPool.acquire(
      'portalOuterRing',
      this.shared.portalOuterRing!,
      this.shared.portalRingMat!
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.set(pos.c - 3.5, TimelineCol.HISTORY_PIECE_Y, pos.r - 3.5);
    layer.add(outerRing);
    this.timeTravelTargets.push(outerRing);

    // Inner glow disc
    const glowMat = isCapture ? this.shared.portalGlowCaptureMat! : this.shared.portalGlowMat!;
    const glow = meshPool.acquire('portalInnerGlow', this.shared.portalInnerGlow!, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.c - 3.5, 0.11, pos.r - 3.5);
    layer.add(glow);
    this.timeTravelTargets.push(glow);

    // Capture indicator (red-ish outer ring if capturing)
    if (isCapture) {
      const captureRing = meshPool.acquire(
        'portalCaptureRing',
        this.shared.portalCaptureRing!,
        this.shared.portalCaptureRingMat!
      );
      captureRing.rotation.x = -Math.PI / 2;
      captureRing.position.set(pos.c - 3.5, 0.13, pos.r - 3.5);
      layer.add(captureRing);
      this.timeTravelTargets.push(captureRing);
    }
  }

  clearTimeTravelTargets(): void {
    // Return all time travel target meshes to pool
    for (const mesh of this.timeTravelTargets) {
      meshPool.release(mesh as PooledMesh);
    }
    this.timeTravelTargets = [];
  }

  /** Mark a snapshot index as having a branch drawn from it */
  markBranchDrawn(snapshotIndex: number): void {
    this.drawnBranchIndices.add(snapshotIndex);
  }

  /** Check if a snapshot index already has a branch drawn */
  hasBranchDrawn(snapshotIndex: number): boolean {
    return this.drawnBranchIndices.has(snapshotIndex);
  }

  /* persistent move lines on current board - keep only last N to prevent clutter */
  private static MAX_MOVE_LINES = 8;  // Only show last 8 moves on top board

  addMoveLine(fromSq: string, toSq: string, isWhite: boolean): void {
    const a = this._sqToWorld(fromSq, 0.09);
    const b = this._sqToWorld(toSq, 0.09);
    a.x -= this.xOffset;
    b.x -= this.xOffset;
    // Softer, more muted colors and much lower opacity for in-board move lines
    const col = isWhite ? 0x6688bb : 0xbb8866;  // Lighter, desaturated blue/red
    this.moveLineGroup.add(Board3DManager._glowTube(a, b, col, 0.012, 0.04, false, 0.3));  // Thinner, less glow, 30% opacity

    // Remove old lines to prevent clutter - keep only last N
    while (this.moveLineGroup.children.length > TimelineCol.MAX_MOVE_LINES) {
      const old = this.moveLineGroup.children[0];
      this.moveLineGroup.remove(old);
      // Dispose of materials to prevent memory leak
      if (old instanceof THREE.Group) {
        old.traverse((child: Object3D) => {
          const mesh = child as Mesh;
          if (mesh.isMesh && mesh.material) {
            (mesh.material as Material).dispose();
          }
        });
      }
    }
  }

  /* history snapshot */
  addSnapshot(position: Board, moveFrom: string, moveTo: string, isWhite: boolean): void {
    const layerGroup = this._makeHistoryBoard(position);
    layerGroup.userData = { moveFrom, moveTo, isWhite };
    this.historyLayers.unshift(layerGroup);
    this.group.add(layerGroup);

    while (this.historyLayers.length > TimelineCol.MAX_LAYERS) {
      const old = this.historyLayers.pop()!;
      this._removeHistorySquares(old);
      this.group.remove(old);
    }
    this._layoutLayers();

    // VALIDATION: Ensure all history layer sprites are positioned below the main board
    // History piece sprites are at local Y=HISTORY_PIECE_Y, and the group should be at negative Y
    // So world Y of any history sprite should be negative
    for (let i = 0; i < this.historyLayers.length; i++) {
      const layer = this.historyLayers[i];
      const groupY = layer.position.y;
      const expectedMinY = -(i + 1) * TimelineCol.LAYER_GAP;

      if (Math.abs(groupY - expectedMinY) > 0.001) {
        console.error('[Board3D] PIECE_OVERLAP_BUG: History layer at wrong Y position!', {
          layerIndex: i,
          actualY: groupY,
          expectedY: expectedMinY,
          timelineId: this.id,
        });
      }

      // Check that all sprites in this layer have negative world Y
      layer.traverse((child: Object3D) => {
        if ((child as Sprite).isSprite) {
          const worldY = groupY + child.position.y;
          if (worldY >= 0) {
            console.error('[Board3D] PIECE_OVERLAP_BUG: History sprite at non-negative world Y!', {
              layerIndex: i,
              groupY,
              localY: child.position.y,
              worldY,
              timelineId: this.id,
            });
          }
        }
      });
    }
  }

  private _makeHistoryBoard(position: Board): Group {
    const g = new THREE.Group();
    const turnIndex = this.historyLayers.length;
    const sqMeshes: Mesh[] = [];

    // Use shared geometry and material for history base
    const base = new THREE.Mesh(
      this.shared.historyBaseGeometry!,
      this.shared.historyBaseMat!
    );
    base.position.y = -0.02;
    base.frustumCulled = true;
    g.add(base);

    // PERFORMANCE OPTIMIZATION: Create just 2 materials per layer (light/dark)
    // instead of 64 materials per layer. All squares in a layer share the same opacity,
    // so they can share materials. This reduces material count from 768 to 24 for 12 layers.
    const layerLightMat = this.shared.historySquareLightMat!.clone();
    const layerDarkMat = this.shared.historySquareDarkMat!.clone();

    // Store materials on group for later disposal and opacity updates
    g.userData.lightMat = layerLightMat;
    g.userData.darkMat = layerDarkMat;

    // History squares - use shared geometry, per-LAYER materials for opacity control
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isLight = (r + c) % 2 === 0;
        const m = new THREE.Mesh(
          this.shared.historySquareGeometry!,
          isLight ? layerLightMat : layerDarkMat
        );
        m.position.set(c - 3.5, 0, r - 3.5);
        m.frustumCulled = true;
        m.userData = {
          square: this._toSq(r, c),
          row: r,
          col: c,
          origColor: (m.material as MeshStandardMaterial).color.getHex(),
          timelineId: this.id,
          turn: turnIndex,
          isHistory: true,
        };
        g.add(m);
        sqMeshes.push(m);
      }
    }

    // Pieces
    for (let r2 = 0; r2 < 8; r2++) {
      for (let c2 = 0; c2 < 8; c2++) {
        const piece = position[r2][c2];
        if (!piece) continue;
        const isW = piece.color === 'w';
        const chKey = isW ? piece.type.toUpperCase() : piece.type;
        const tex = this._pieceTex(this._pieceChars[chKey], isW);
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.25, depthWrite: false })
        );
        sp.position.set(c2 - 3.5, TimelineCol.HISTORY_PIECE_Y, r2 - 3.5);
        sp.scale.set(0.7, 0.7, 0.7);
        sp.frustumCulled = true;
        g.add(sp);
      }
    }

    g.userData.sqMeshes = sqMeshes;
    this.historySquareMeshes = this.historySquareMeshes.concat(sqMeshes);
    return g;
  }

  private _removeHistorySquares(layerGroup: Group): void {
    const toRemove = (layerGroup.userData.sqMeshes as Mesh[]) || [];
    this.historySquareMeshes = this.historySquareMeshes.filter((m) => toRemove.indexOf(m) === -1);

    // Dispose the per-layer shared materials (just 2 per layer now)
    const lightMat = layerGroup.userData.lightMat as MeshStandardMaterial | undefined;
    const darkMat = layerGroup.userData.darkMat as MeshStandardMaterial | undefined;
    lightMat?.dispose();
    darkMat?.dispose();

    // Dispose of all sprites in the layer to prevent memory leaks
    layerGroup.traverse((child: Object3D) => {
      const obj = child as Sprite;
      if (obj.isSprite && obj.material) {
        (obj.material as SpriteMaterial).dispose();
      }
    });
  }

  private _layoutLayers(): void {
    for (let i = 0; i < this.historyLayers.length; i++) {
      const targetY = -(i + 1) * TimelineCol.LAYER_GAP;
      this.historyLayers[i].position.y = targetY;

      // VALIDATION: Ensure history layers are always below the main board
      if (targetY >= 0) {
        console.error('[Board3D] PIECE_OVERLAP_BUG: History layer at non-negative Y!', {
          layerIndex: i,
          targetY,
          timelineId: this.id,
        });
      }

      // Calculate snapshot index for this layer (most recent history is layer 0)
      // historyLayers[0] corresponds to the most recent snapshot before current
      const snapshotIndex = this.historyLayers.length - 1 - i;
      const hasBranch = this.drawnBranchIndices.has(snapshotIndex);

      // More prominent grey-out effect: lower base opacity and faster falloff
      // Even lower opacity for layers with branches (already explored)
      const baseOp = hasBranch ? 0.12 : 0.28;
      const op = Math.max(0.04, baseOp - i * 0.035);
      this._setGroupOpacity(this.historyLayers[i], op);

      // Update turn indices for history squares
      const sqs = (this.historyLayers[i].userData.sqMeshes as Mesh[]) || [];
      for (let j = 0; j < sqs.length; j++) {
        sqs[j].userData.turn = i;
      }
    }

    // Rebuild inter-layer lines
    while (this.interLayerGroup.children.length) {
      this.interLayerGroup.remove(this.interLayerGroup.children[0]);
    }

    for (let j = 0; j < this.historyLayers.length; j++) {
      const layer = this.historyLayers[j];
      const fromSq = layer.userData.moveFrom as string;
      const toSq = layer.userData.moveTo as string;
      const isW = layer.userData.isWhite as boolean;

      // Skip drawing inter-layer lines for layers that have branches
      // (these are already connected to other timelines)
      const snapshotIndex = this.historyLayers.length - 1 - j;
      if (this.drawnBranchIndices.has(snapshotIndex)) {
        continue;
      }

      const fromY = layer.position.y + 0.1;
      const toY = j === 0 ? 0.1 : this.historyLayers[j - 1].position.y + 0.1;
      const fromW = new THREE.Vector3().copy(this._sqToWorld(fromSq, fromY));
      const toW = new THREE.Vector3().copy(this._sqToWorld(toSq, toY));
      fromW.x -= this.xOffset;
      toW.x -= this.xOffset;
      // Softer, more muted inter-layer lines (same as move lines, but keep time travel visible)
      const lineCol = isW ? 0x88bbdd : 0xddaa77;  // Lighter, desaturated cyan/orange
      this.interLayerGroup.add(Board3DManager._glowTube(fromW, toW, lineCol, 0.018, 0.06, true, 0.4));
    }
  }

  private _setGroupOpacity(group: Group, opacity: number): void {
    // PERFORMANCE: Update per-layer shared materials directly instead of traversing all children
    // With shared materials, we only need to set opacity on 2 materials per layer
    const lightMat = group.userData.lightMat as MeshStandardMaterial | undefined;
    const darkMat = group.userData.darkMat as MeshStandardMaterial | undefined;
    if (lightMat) lightMat.opacity = opacity;
    if (darkMat) darkMat.opacity = opacity;

    // Also update sprite opacity (history piece sprites still need traversal)
    group.traverse((child: Object3D) => {
      const obj = child as Sprite;
      if (obj.isSprite && obj.material && (obj.material as Material).transparent) {
        (obj.material as Material).opacity = opacity * 1.1;
      }
    });
  }

  getAllSquareMeshes(): Mesh[] {
    return this.squareMeshes.concat(this.historySquareMeshes);
  }

  setActive(active: boolean): void {
    this.group.children.forEach((child) => {
      const mesh = child as Mesh;
      if (
        mesh.geometry &&
        (mesh.geometry as BoxGeometry).type === 'BoxGeometry' &&
        (mesh.geometry as BoxGeometry).parameters.width > 8.5 &&
        mesh.position.y < -0.1
      ) {
        (mesh.material as MeshStandardMaterial).emissive = active
          ? new THREE.Color(0x222244)
          : new THREE.Color(0);
      }
    });
  }

  setHighlighted(highlighted: boolean): void {
    this.group.children.forEach((child) => {
      const mesh = child as Mesh;
      if (
        mesh.geometry &&
        (mesh.geometry as BoxGeometry).type === 'BoxGeometry' &&
        (mesh.geometry as BoxGeometry).parameters.width > 8.5 &&
        mesh.position.y < -0.1
      ) {
        if (highlighted) {
          (mesh.material as MeshStandardMaterial).emissive = new THREE.Color(0x446688);
        } else {
          (mesh.material as MeshStandardMaterial).emissive = new THREE.Color(0);
        }
      }
    });
  }

  /** Set board state glow (checkmate = red, draw = grey, none = clear) */
  setBoardGlow(state: 'checkmate' | 'draw' | 'none'): void {
    let glowColor: Color | null = null;
    if (state === 'checkmate') {
      glowColor = new THREE.Color(0xff3333);
    } else if (state === 'draw') {
      glowColor = new THREE.Color(0x888888);
    }

    // Apply glow to all square meshes on the main board
    for (const mesh of this.squareMeshes) {
      const mat = mesh.material as MeshStandardMaterial;
      if (glowColor) {
        mat.emissive = glowColor;
        mat.emissiveIntensity = 0.3;
      } else {
        mat.emissive = new THREE.Color(0);
        mat.emissiveIntensity = 0;
      }
    }
  }

  clearAll(): void {
    // Clear and return piece sprites to pool for reuse
    for (let i = this.pieceMeshes.length - 1; i >= 0; i--) {
      const sprite = this.pieceMeshes[i] as PooledSprite;
      spritePool.release(sprite);
    }
    this.pieceMeshes.length = 0;

    // Clear diff-based rendering state
    this._prevBoardState.clear();
    this._spriteMap.clear();

    // Clear history layers and dispose of their contents
    for (let i = 0; i < this.historyLayers.length; i++) {
      const layer = this.historyLayers[i];
      this._removeHistorySquares(layer);
      this.group.remove(layer);
    }
    this.historyLayers = [];
    this.historySquareMeshes = [];
    this.drawnBranchIndices.clear();  // Clear branch tracking
    while (this.moveLineGroup.children.length) {
      this.moveLineGroup.remove(this.moveLineGroup.children[0]);
    }
    while (this.interLayerGroup.children.length) {
      this.interLayerGroup.remove(this.interLayerGroup.children[0]);
    }
    this.clearHighlights();

    // Return last move highlights to pool
    for (let i = 0; i < this.lastMoveHL.length; i++) {
      meshPool.release(this.lastMoveHL[i] as PooledMesh);
    }
    this.lastMoveHL = [];

    // Clear cross-timeline and time-travel targets
    this.clearCrossTimelineTargets();
    this.clearTimeTravelTargets();
  }

  destroy(): void {
    this.clearAll();
    // Dispose per-square materials
    for (const mesh of this.squareMeshes) {
      if (mesh.material) {
        (mesh.material as Material).dispose();
      }
    }
    this.scene.remove(this.group);
  }
}

// ===============================================================
// Board3D - scene manager, coordinates multiple timelines
// ===============================================================

class Board3DManager implements IBoard3D {
  scene: Scene | null = null;
  camera: PerspectiveCamera | null = null;
  renderer: WebGLRenderer | null = null;
  controls: OrbitControlsInstance | null = null;
  private raycaster: Raycaster | null = null;
  private mouse: Vector2 | null = null;
  private container: HTMLElement | null = null;
  private _clock: Clock | null = null;
  private _downPos: { x: number; y: number } | null = null;
  private _texCache: TextureCache = {};

  // Performance: render-on-demand
  private _needsRender = true;
  private _lastRenderTime = 0;

  // Performance: FPS tracking
  private _frameCount = 0;
  private _lastFpsUpdate = 0;
  private _currentFps = 0;

  // Performance: track camera state to detect OrbitControls changes
  private _lastCameraPosition = new THREE.Vector3();
  private _lastCameraTarget = new THREE.Vector3();

  // Performance: throttle particle animation (frame counter)
  private _particleAnimFrame = 0;
  private static readonly PARTICLE_ANIM_INTERVAL = 3;  // Update every 3 frames

  // Note: DEBUG_MODE is now a module-level constant at the top of this file

  // Performance: pooled scratch vectors (avoid GC churn from frequent allocations)
  // These are reused across frames in _updatePanning() for camera movement calculations.
  //
  // _tempVec3A: forward direction from camera, also reused for rotation offset
  // _tempVec3B: right direction (perpendicular to forward in XZ plane)
  // _tempVec3C: accumulated movement vector
  // _tempVec3D: up reference vector (0,1,0) - MUST be separate from _tempVec3B to avoid
  //             crossVectors() self-reference bug where output === input corrupts calculation
  private _tempVec3A = new THREE.Vector3();
  private _tempVec3B = new THREE.Vector3();
  private _tempVec3C = new THREE.Vector3();
  private _tempVec3D = new THREE.Vector3();

  // Shared materials for squares (avoid creating 64+ materials per board)
  private _lightSquareMat: MeshStandardMaterial | null = null;
  private _darkSquareMat: MeshStandardMaterial | null = null;
  private _historyLightSquareMat: MeshStandardMaterial | null = null;
  private _historyDarkSquareMat: MeshStandardMaterial | null = null;
  private _boardBaseMat: MeshStandardMaterial | null = null;
  private _boardTrimMat: MeshStandardMaterial | null = null;

  timelineCols: Record<number, TimelineCol> = {};
  private branchLineGroup: Group | null = null;
  private particleSystem: Points | null = null;

  // Track branch/time-travel line metadata for rebuilding when snapshots shift
  private _branchLineData: Array<{
    type: 'branch' | 'cross' | 'timetravel';
    fromTlId: number;
    toTlId: number;
    fromTurn: number;  // Snapshot count in source timeline at time of creation
    toTurn?: number;   // Snapshot count in target timeline at time of creation
    square?: string;
    targetTurnIndex?: number;  // For time travel: target snapshot index
    isWhite?: boolean;
  }> = [];
  private onSquareClick:
    | ((info: { timelineId: number; square: string; turn: number; isHistory: boolean }) => void)
    | null = null;

  private _panKeys: PanKeyState = { w: false, a: false, s: false, d: false, q: false, e: false };
  private _panSpeed = 0.12;  // Slowed down from 0.25 for smoother control
  private _zoomSpeed = 0.4;
  private _focusTween: FocusTween | undefined;
  private _resizeTimeout: number | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _lastContainerWidth = 0;
  private _lastContainerHeight = 0;

  // Store bound event handlers for proper cleanup in dispose()
  private _boundPointerDown: ((e: PointerEvent) => void) | null = null;
  private _boundPointerUp: ((e: PointerEvent) => void) | null = null;
  private _boundResize: (() => void) | null = null;
  private _boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private _boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private _boundBeforeUnload: (() => void) | null = null;
  private _boundContextLost: ((e: Event) => void) | null = null;
  private _boundContextRestored: (() => void) | null = null;

  // WebGL context loss state
  private _webglContextLost = false;

  // Visual effects storage
  private _activeEffects: Array<{
    mesh: Mesh | Points;
    startTime: number;
    duration: number;
    type: 'portal' | 'capture';
  }> = [];

  // Use WHITE CHESS symbols (outlined) for both colors to avoid emoji rendering
  // The fill/stroke colors in _pieceTexture() distinguish white vs black pieces
  readonly PIECE_CHARS: PieceCharMap = {
    K: '\u2654',  // ♔ WHITE CHESS KING
    Q: '\u2655',  // ♕ WHITE CHESS QUEEN
    R: '\u2656',  // ♖ WHITE CHESS ROOK
    B: '\u2657',  // ♗ WHITE CHESS BISHOP
    N: '\u2658',  // ♘ WHITE CHESS KNIGHT
    P: '\u2659',  // ♙ WHITE CHESS PAWN
    k: '\u2654',  // Use white glyph, colored dark by _pieceTexture
    q: '\u2655',
    r: '\u2656',
    b: '\u2657',
    n: '\u2658',
    p: '\u2659',
  };

  readonly TIMELINE_COLORS: number[] = [
    0x44ddff, 0xff66aa, 0x66ff88, 0xffaa33, 0xaa66ff, 0xff4444, 0x44ffcc, 0xffff44,
  ];
  readonly TIMELINE_SPACING = 12;

  /** Mark that a render is needed (called when state changes) */
  markDirty(): void {
    this._needsRender = true;
  }

  /** Get current FPS */
  getFps(): number {
    return this._currentFps;
  }

  /** Initialize shared materials (called once in init) */
  private _initSharedMaterials(): void {
    // Main board squares
    this._lightSquareMat = new THREE.MeshStandardMaterial({
      color: 0x7575a8,
      metalness: 0.15,
      roughness: 0.75,
      side: THREE.FrontSide,
    });
    this._darkSquareMat = new THREE.MeshStandardMaterial({
      color: 0x44446e,
      metalness: 0.15,
      roughness: 0.75,
      side: THREE.FrontSide,
    });

    // History layer squares
    this._historyLightSquareMat = new THREE.MeshStandardMaterial({
      color: 0x7575a8,
      transparent: true,
      opacity: 0.2,
      metalness: 0.15,
      roughness: 0.8,
    });
    this._historyDarkSquareMat = new THREE.MeshStandardMaterial({
      color: 0x44446e,
      transparent: true,
      opacity: 0.2,
      metalness: 0.15,
      roughness: 0.8,
    });

    // Board base and trim
    this._boardBaseMat = new THREE.MeshStandardMaterial({
      color: 0x15152a,
      metalness: 0.7,
      roughness: 0.3,
    });
    this._boardTrimMat = new THREE.MeshStandardMaterial({
      color: 0x333366,
      metalness: 0.9,
      roughness: 0.2,
    });
  }

  /** Get shared material for square type */
  getSquareMaterial(isLight: boolean, isHistory: boolean = false): MeshStandardMaterial {
    if (isHistory) {
      return isLight ? this._historyLightSquareMat! : this._historyDarkSquareMat!;
    }
    return isLight ? this._lightSquareMat! : this._darkSquareMat!;
  }

  /** Get shared board base material */
  getBoardBaseMaterial(): MeshStandardMaterial {
    return this._boardBaseMat!;
  }

  /** Get shared board trim material */
  getBoardTrimMaterial(): MeshStandardMaterial {
    return this._boardTrimMat!;
  }

  init(
    containerId: string,
    onSquareClick: (info: { timelineId: number; square: string; turn: number; isHistory: boolean }) => void
  ): void {
    this.onSquareClick = onSquareClick;
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container element '${containerId}' not found`);
    }
    this.container = container;
    this._clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Initialize shared materials for performance
    this._initSharedMaterials();
    // Initialize shared resources singleton
    SharedResources.getInstance();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setClearColor(0x080818);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // WebGL context loss handling - prevents white screen crashes
    this._boundContextLost = (event: Event) => {
      event.preventDefault();  // Allows context to be restored
      this._webglContextLost = true;
      console.error('[Board3D] WebGL context lost! Render loop paused.');
      // Show user-friendly error message
      const overlay = document.createElement('div');
      overlay.id = 'webgl-context-lost-overlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);color:white;display:flex;align-items:center;justify-content:center;font-size:18px;z-index:1000;';
      overlay.textContent = 'WebGL context lost. Please refresh the page.';
      this.container?.appendChild(overlay);
    };
    this._boundContextRestored = () => {
      this._webglContextLost = false;
      console.log('[Board3D] WebGL context restored.');
      // Remove error overlay
      const overlay = document.getElementById('webgl-context-lost-overlay');
      overlay?.remove();
      // Mark for render
      this._needsRender = true;
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this._boundContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this._boundContextRestored);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x080818, 0.008);

    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 300);
    this.camera.position.set(0, 14, 12);

    // Use global THREE.OrbitControls from CDN
    const controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.7;
    controls.panSpeed = 0.8;
    controls.zoomSpeed = 1.2;
    controls.minDistance = 5;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI * 0.85;
    controls.target.set(0, 0, 0);
    controls.screenSpacePanning = true;
    this.controls = controls;

    this._setupLights();
    this.branchLineGroup = new THREE.Group();
    this.scene.add(this.branchLineGroup);
    this._createFloor();
    this._createParticles();

    // Store bound event handlers for cleanup in dispose()
    this._boundPointerDown = (e: PointerEvent) => {
      this._downPos = { x: e.clientX, y: e.clientY };
    };
    this._boundPointerUp = (e: PointerEvent) => {
      if (!this._downPos) return;
      const dx = e.clientX - this._downPos.x;
      const dy = e.clientY - this._downPos.y;
      if (dx * dx + dy * dy < 36) this._onClick(e);
      this._downPos = null;
    };
    this._boundResize = () => this._scheduleResize();
    this._boundKeyDown = (e: KeyboardEvent) => this._onKeyDown(e);
    this._boundKeyUp = (e: KeyboardEvent) => this._onKeyUp(e);
    this._boundBeforeUnload = () => this.dispose();

    this.renderer.domElement.addEventListener('pointerdown', this._boundPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this._boundPointerUp);

    // Window resize handler with debouncing
    window.addEventListener('resize', this._boundResize);

    // ResizeObserver for container size changes (handles sidebar resize, etc.)
    this._resizeObserver = new ResizeObserver(this._boundResize);
    this._resizeObserver.observe(this.container);

    // Store initial dimensions
    this._lastContainerWidth = this.container.clientWidth;
    this._lastContainerHeight = this.container.clientHeight;

    // WASD keyboard panning
    window.addEventListener('keydown', this._boundKeyDown);
    window.addEventListener('keyup', this._boundKeyUp);

    // Tab close cleanup - dispose all resources to prevent lag
    window.addEventListener('beforeunload', this._boundBeforeUnload);

    // Ensure initial render happens after all setup is complete
    this._needsRender = true;

    this._animate();
  }

  /* create / get timeline */
  createTimeline(id: number, xOffset: number): TimelineCol {
    const col = new TimelineCol(
      this.scene!,
      id,
      xOffset,
      this.TIMELINE_COLORS[id % this.TIMELINE_COLORS.length],
      this._texCache,
      this.PIECE_CHARS,
      this._pieceTexture.bind(this)
    );
    this.timelineCols[id] = col;
    return col;
  }

  getTimeline(id: number): TimelineCol | undefined {
    return this.timelineCols[id];
  }

  removeTimeline(id: number): void {
    if (this.timelineCols[id]) {
      this.timelineCols[id].destroy();
      delete this.timelineCols[id];
    }
  }

  /* add a glow branch line between two timelines */
  addBranchLine(fromTlId: number, fromTurn: number, toTlId: number): void {
    const fromCol = this.timelineCols[fromTlId];
    const toCol = this.timelineCols[toTlId];
    if (!fromCol || !toCol || !this.branchLineGroup) return;

    // Skip if this branch point has already been drawn
    const branchKey = fromTurn;
    if (fromCol.hasBranchDrawn(branchKey)) {
      return;
    }
    fromCol.markBranchDrawn(branchKey);

    // Store metadata for rebuilding when snapshots shift
    this._branchLineData.push({
      type: 'branch',
      fromTlId,
      toTlId,
      fromTurn,
    });

    this._rebuildBranchLines();
  }

  /** Add a horizontal line showing cross-timeline piece movement */
  addCrossTimelineLine(fromTlId: number, toTlId: number, square: string, isWhite: boolean): void {
    const fromCol = this.timelineCols[fromTlId];
    const toCol = this.timelineCols[toTlId];
    if (!fromCol || !toCol || !this.branchLineGroup) return;

    // Store metadata for rebuilding when snapshots shift
    // Track both timelines' snapshot counts so lines step down correctly on each
    this._branchLineData.push({
      type: 'cross',
      fromTlId,
      toTlId,
      fromTurn: fromCol.historyLayers.length,
      toTurn: toCol.historyLayers.length,
      square,
      isWhite,
    });

    this._rebuildBranchLines();
  }

  /** Add a time travel line showing queen moving backward in time to create new timeline */
  addTimeTravelLine(
    sourceTlId: number,
    targetTurnIndex: number,
    newTlId: number,
    square: string,
    isWhite: boolean
  ): void {
    const sourceCol = this.timelineCols[sourceTlId];
    const newCol = this.timelineCols[newTlId];
    if (!sourceCol || !newCol || !this.branchLineGroup) return;

    // Store metadata for rebuilding when snapshots shift
    // fromTurn = snapshot count on source at time of travel
    // toTurn = snapshot count on new timeline at time of travel (for stepping down)
    this._branchLineData.push({
      type: 'timetravel',
      fromTlId: sourceTlId,
      toTlId: newTlId,
      fromTurn: sourceCol.historyLayers.length,
      toTurn: newCol.historyLayers.length,
      targetTurnIndex,
      square,
      isWhite,
    });

    this._rebuildBranchLines();
  }

  private _fromSq(sq: string): { r: number; c: number } {
    return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
  }

  /** Rebuild all branch/cross/time-travel lines based on stored metadata */
  private _rebuildBranchLines(): void {
    if (!this.branchLineGroup) return;

    // Clear existing lines
    while (this.branchLineGroup.children.length) {
      this.branchLineGroup.remove(this.branchLineGroup.children[0]);
    }

    // Rebuild each line from metadata
    for (const data of this._branchLineData) {
      const fromCol = this.timelineCols[data.fromTlId];
      const toCol = this.timelineCols[data.toTlId];
      if (!fromCol || !toCol) continue;

      if (data.type === 'branch') {
        // Branch line: from history layer to new timeline's top board
        // Calculate depth based on how many snapshots have been added since branch
        const currentDepth = fromCol.historyLayers.length;
        const depthSinceBranch = currentDepth - data.fromTurn;
        const fromY = -(depthSinceBranch + 1) * TimelineCol.LAYER_GAP;

        const from = new THREE.Vector3(fromCol.xOffset, fromY + 0.2, 0);
        const to = new THREE.Vector3(toCol.xOffset, 0.2, 0);
        const tintCol = this.TIMELINE_COLORS[data.toTlId % this.TIMELINE_COLORS.length];

        // Fade based on depth
        const opacityScale = Math.max(0.2, 1 - depthSinceBranch * 0.08);
        this.branchLineGroup.add(Board3DManager._glowTube(from, to, tintCol, 0.04, 0.18, true, opacityScale));

      } else if (data.type === 'cross' && data.square) {
        // Cross-timeline: horizontal line connecting the move positions on both timelines
        const pos = this._fromSq(data.square);
        const sqX = pos.c - 3.5;
        const sqZ = pos.r - 3.5;

        // Calculate depth on SOURCE timeline since cross move
        const fromCurrentDepth = fromCol.historyLayers.length;
        const depthSinceCrossFrom = fromCurrentDepth - data.fromTurn;

        // Calculate depth on TARGET timeline since cross move
        const toCurrentDepth = toCol.historyLayers.length;
        const depthSinceCrossTo = toCurrentDepth - (data.toTurn ?? data.fromTurn);

        // Source Y: steps down as more moves happen on source timeline
        let fromY = 0.3;  // Current board
        if (depthSinceCrossFrom > 0) {
          fromY = -(depthSinceCrossFrom) * TimelineCol.LAYER_GAP + 0.2;
        }

        // Target Y: steps down as more moves happen on target timeline
        let toY = 0.3;
        if (depthSinceCrossTo > 0) {
          toY = -(depthSinceCrossTo) * TimelineCol.LAYER_GAP + 0.2;
        }

        const from = new THREE.Vector3(fromCol.xOffset + sqX, fromY, sqZ);
        const to = new THREE.Vector3(toCol.xOffset + sqX, toY, sqZ);

        const color = 0xaa44ff;  // Purple
        const avgDepth = (depthSinceCrossFrom + depthSinceCrossTo) / 2;
        const opacityScale = Math.max(0.2, 1 - avgDepth * 0.08);
        this.branchLineGroup.add(Board3DManager._glowTube(from, to, color, 0.03, 0.12, true, opacityScale));

      } else if (data.type === 'timetravel' && data.square !== undefined && data.targetTurnIndex !== undefined) {
        // Time travel: vertical line down then horizontal to new timeline
        const pos = this._fromSq(data.square);
        const sqX = pos.c - 3.5;
        const sqZ = pos.r - 3.5;

        // Calculate how many snapshots have been added on SOURCE timeline since time travel
        const fromCurrentDepth = fromCol.historyLayers.length;
        const depthSinceTravelFrom = fromCurrentDepth - data.fromTurn;

        // Calculate how many snapshots have been added on NEW timeline since creation
        const toCurrentDepth = toCol.historyLayers.length;
        const depthSinceTravelTo = toCurrentDepth - (data.toTurn ?? 0);

        // Start Y: departure point on source timeline steps down as moves happen
        let startY = 0.3;  // Current board
        if (depthSinceTravelFrom > 0) {
          startY = -(depthSinceTravelFrom) * TimelineCol.LAYER_GAP + 0.2;
        }

        // Mid Y: the historical target point on source timeline
        // This also needs to step down as new snapshots are added
        const adjustedTargetIndex = data.targetTurnIndex + depthSinceTravelFrom + 1;
        const midY = -(adjustedTargetIndex + 1) * TimelineCol.LAYER_GAP + 0.2;

        // End Y: arrival point on new timeline steps down as that timeline gets more moves
        let endY = 0.3;
        if (depthSinceTravelTo > 0) {
          endY = -(depthSinceTravelTo) * TimelineCol.LAYER_GAP + 0.2;
        }

        const start = new THREE.Vector3(fromCol.xOffset + sqX, startY, sqZ);
        const mid = new THREE.Vector3(fromCol.xOffset + sqX, midY, sqZ);
        const end = new THREE.Vector3(toCol.xOffset + sqX, endY, sqZ);

        const color = 0x44ffaa;  // Cyan-green
        const avgDepth = (depthSinceTravelFrom + depthSinceTravelTo) / 2;
        const opacityScale = Math.max(0.2, 1 - avgDepth * 0.08);

        // Vertical line down through time
        this.branchLineGroup.add(Board3DManager._glowTube(start, mid, color, 0.03, 0.12, false, opacityScale));

        // Horizontal line to new timeline
        this.branchLineGroup.add(Board3DManager._glowTube(mid, end, color, 0.03, 0.12, true, opacityScale));
      }
    }
  }

  /** Notify that a timeline's snapshots have changed - triggers branch line rebuild */
  notifySnapshotAdded(timelineId: number): void {
    // Rebuild branch lines whenever any timeline gets a new snapshot
    // This ensures lines stay connected to the correct history layers
    this._rebuildBranchLines();
  }

  setActiveTimeline(id: number): void {
    for (const key in this.timelineCols) {
      this.timelineCols[key].setActive(parseInt(key) === id);
    }
  }

  /* Smoothly pan camera to center on a timeline */
  focusTimeline(id: number, animate: boolean): void {
    const col = this.timelineCols[id];
    if (!col || !this.controls || !this.camera || !this._clock) return;

    const targetX = col.xOffset;
    const currentTarget = this.controls.target.clone();
    const newTarget = new THREE.Vector3(targetX, 0, 0);

    if (animate) {
      const startTime = this._clock.getElapsedTime();
      const duration = 0.4;

      this._focusTween = {
        start: currentTarget,
        end: newTarget,
        startTime,
        duration,
      };
    } else {
      const delta = new THREE.Vector3().subVectors(newTarget, currentTarget);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
  }

  /* Update focus animation in render loop */
  private _updateFocusAnimation(): void {
    if (!this._focusTween || !this._clock || !this.controls || !this.camera) return;

    const t = this._clock.getElapsedTime();
    const elapsed = t - this._focusTween.startTime;
    const progress = Math.min(elapsed / this._focusTween.duration, 1);

    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);

    const newTarget = new THREE.Vector3().lerpVectors(
      this._focusTween.start,
      this._focusTween.end,
      eased
    );

    const delta = new THREE.Vector3().subVectors(newTarget, this.controls.target);
    this.controls.target.add(delta);
    this.camera.position.add(delta);

    if (progress >= 1) {
      this._focusTween = undefined;
    }
  }

  /* Lights */
  private _setupLights(): void {
    if (!this.scene) return;
    this.scene.add(new THREE.AmbientLight(0x404060, 0.5));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(5, 15, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -20;
    dir.shadow.camera.right = 20;
    dir.shadow.camera.top = 20;
    dir.shadow.camera.bottom = -20;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 60;
    this.scene.add(dir);
    const p1 = new THREE.PointLight(0x4466ff, 0.5, 50);
    p1.position.set(-12, 8, -8);
    this.scene.add(p1);
    const p2 = new THREE.PointLight(0xff6644, 0.35, 50);
    p2.position.set(12, 8, 8);
    this.scene.add(p2);
  }

  private _createFloor(): void {
    // Removed grid floor that was causing visual artifacts between boards
    // The dark background is sufficient for the cosmic aesthetic
  }

  private _createParticles(): void {
    if (!this.scene) return;
    const n = 400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = Math.random() * 30 - 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particleSystem = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x6688cc,
        size: 0.07,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(this.particleSystem);
  }

  /* piece texture factory */
  private _pieceTexture(symbol: string, isWhite: boolean): Texture {
    const key = symbol + (isWhite ? 'w' : 'b');
    if (this._texCache[key]) return this._texCache[key];
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = s;
    cv.height = s;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, s, s);
    ctx.font = s * 0.78 + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isWhite) {
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#f0ece0';
      ctx.fillText(symbol, s / 2, s / 2);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(40,30,10,0.25)';
      ctx.lineWidth = 1.5;
      ctx.strokeText(symbol, s / 2, s / 2);
    } else {
      // Black pieces: same outline style as white but with dark fill and visible lighter outline
      // Makes black pieces clearly readable against the dark board
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#1a1a2e';  // Dark navy fill
      ctx.fillText(symbol, s / 2, s / 2);
      ctx.shadowBlur = 0;
      // Lighter outline so piece shape is clearly visible (matching white's stroke approach)
      ctx.strokeStyle = '#b0b0c8';
      ctx.lineWidth = 2;
      ctx.strokeText(symbol, s / 2, s / 2);
    }
    const tex = new THREE.CanvasTexture(cv);
    this._texCache[key] = tex;
    return tex;
  }

  /* text sprite helper */
  static _textSprite(text: string, color: string): Sprite {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 32, 32);
    return new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
    );
  }

  /* glow tube (static helper) */
  static _glowTube(
    from: Vector3,
    to: Vector3,
    color: number,
    coreR: number,
    glowR: number,
    arc: boolean,
    opacityScale: number = 1.0
  ): Group {
    const group = new THREE.Group();
    let curve: Curve<Vector3>;
    if (arc) {
      const mid = new THREE.Vector3().lerpVectors(from, to, 0.5);
      // Lift the arc above boards so it doesn't clip through them
      const dist = from.distanceTo(to);
      const yLift = Math.max(1.5, dist * 0.25);
      mid.y = Math.max(from.y, to.y) + yLift;
      // Slight horizontal offset for visual separation
      const hDir = new THREE.Vector2(to.x - from.x, to.z - from.z);
      const hLen = hDir.length();
      if (hLen > 0.01) {
        hDir.normalize();
        // Perpendicular nudge so parallel lines don't overlap
        mid.x += -hDir.y * 0.5;
        mid.z += hDir.x * 0.5;
      }
      curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    } else {
      curve = new THREE.LineCurve3(from, to);
    }
    const segs = arc ? 24 : 8;

    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, segs, glowR, 8, false),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.1 * opacityScale,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      )
    );
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, segs, glowR * 0.45, 8, false),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.22 * opacityScale,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      )
    );
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, segs, coreR, 8, false),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.75 * opacityScale,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
    );

    const sg = new THREE.SphereGeometry(coreR * 2.2, 12, 12);
    const sm = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6 * opacityScale,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const s1 = new THREE.Mesh(sg, sm);
    s1.position.copy(from);
    group.add(s1);
    const s2 = new THREE.Mesh(sg.clone(), sm.clone());
    s2.position.copy(to);
    group.add(s2);
    return group;
  }

  /* WASD keyboard panning handlers */
  private _onKeyDown(e: KeyboardEvent): void {
    // Don't capture if typing in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    const key = e.key.toLowerCase() as keyof PanKeyState;
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
      e.preventDefault();
      this._panKeys[key] = true;
    }
  }

  private _onKeyUp(e: KeyboardEvent): void {
    const key = e.key.toLowerCase() as keyof PanKeyState;
    if (key === 'w' || key === 'a' || key === 's' || key === 'd' || key === 'q' || key === 'e') {
      this._panKeys[key] = false;
    }
  }

  private _updatePanning(): boolean {
    if (!this._panKeys || !this.camera || !this.controls) return false;

    let panX = 0;
    let panZ = 0;
    if (this._panKeys.w) panZ -= this._panSpeed;
    if (this._panKeys.s) panZ += this._panSpeed;
    if (this._panKeys.a) panX -= this._panSpeed;
    if (this._panKeys.d) panX += this._panSpeed;

    let isPanning = false;

    if (panX !== 0 || panZ !== 0) {
      isPanning = true;
      // Use pooled vectors to avoid GC churn
      const forward = this._tempVec3A;
      this.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      // CRITICAL FIX: Use separate 'up' vector for crossVectors() to avoid self-reference bug.
      //
      // The BUGGY code was:
      //   right.set(0, 1, 0);
      //   right.crossVectors(forward, right).normalize();
      //
      // This fails because crossVectors(a, b) computes:
      //   this.x = a.y * b.z - a.z * b.y
      //   this.y = a.z * b.x - a.x * b.z
      //   this.z = a.x * b.y - a.y * b.x
      //
      // When 'this' === 'b', the first assignment corrupts b.x before it's used
      // in the subsequent calculations, producing incorrect results.
      //
      // Solution: Use a separate vector for the 'up' reference.
      const up = this._tempVec3D;
      up.set(0, 1, 0);
      const right = this._tempVec3B;
      right.crossVectors(forward, up).normalize();

      // Calculate movement using pooled vector
      const move = this._tempVec3C;
      move.set(0, 0, 0);
      move.addScaledVector(forward, -panZ);
      move.addScaledVector(right, panX);

      // Apply to both camera and target
      this.camera.position.add(move);
      this.controls.target.add(move);
    }

    // Q/E keyboard rotation (slow orbit around target)
    if (this._panKeys.q || this._panKeys.e) {
      isPanning = true;
      const rotateDir = this._panKeys.q ? 1 : -1; // Q = rotate left, E = rotate right
      const rotateSpeed = 0.015; // Slow rotation

      // Use pooled vector for offset
      const offset = this._tempVec3A;
      offset.subVectors(this.camera.position, this.controls.target);

      // Rotate around Y axis
      const angle = rotateDir * rotateSpeed;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const newX = offset.x * cos - offset.z * sin;
      const newZ = offset.x * sin + offset.z * cos;

      offset.x = newX;
      offset.z = newZ;

      // Apply new position
      this.camera.position.copy(this.controls.target).add(offset);
    }

    return isPanning;
  }

  /* click -> find which timeline + square (or history square) */
  private _onClick(event: PointerEvent): void {
    if (!this.renderer || !this.raycaster || !this.mouse || !this.camera) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Collect all clickable squares across all timelines
    let allMeshes: Mesh[] = [];
    for (const key in this.timelineCols) {
      allMeshes = allMeshes.concat(this.timelineCols[key].getAllSquareMeshes());
    }
    const hits = this.raycaster.intersectObjects(allMeshes);
    if (hits.length > 0 && this.onSquareClick) {
      const ud = hits[0].object.userData;
      this.onSquareClick({
        timelineId: ud.timelineId as number,
        square: ud.square as string,
        turn: ud.turn as number,
        isHistory: !!ud.isHistory,
      });
    }
  }

  /** Schedule a debounced resize to prevent rapid re-renders */
  private _scheduleResize(): void {
    if (this._resizeTimeout !== null) {
      window.clearTimeout(this._resizeTimeout);
    }
    this._resizeTimeout = window.setTimeout(() => {
      this._onResize();
      this._resizeTimeout = null;
    }, 50);
  }

  private _onResize(): void {
    if (!this.container || !this.camera || !this.renderer) return;

    // Get container dimensions with fallback to parent or window
    let w = this.container.clientWidth;
    let h = this.container.clientHeight;

    // Ensure we have valid dimensions (prevent 0-size canvas)
    if (w <= 0 || h <= 0) {
      const parent = this.container.parentElement;
      if (parent) {
        w = parent.clientWidth - 250; // Account for sidebar
        h = parent.clientHeight;
      }
      // Final fallback to window dimensions
      if (w <= 0) w = window.innerWidth - 250;
      if (h <= 0) h = window.innerHeight;
    }

    // Clamp dimensions to reasonable bounds
    w = Math.max(100, Math.min(w, window.innerWidth));
    h = Math.max(100, Math.min(h, window.innerHeight));

    // Only resize if dimensions actually changed
    if (w === this._lastContainerWidth && h === this._lastContainerHeight) {
      return;
    }

    this._lastContainerWidth = w;
    this._lastContainerHeight = h;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private _animate(): void {
    requestAnimationFrame(() => this._animate());

    // Skip rendering if WebGL context is lost
    if (this._webglContextLost) return;

    if (!this._clock || !this.controls || !this.renderer || !this.scene || !this.camera) return;

    const t = this._clock.getElapsedTime();

    // FPS tracking
    this._frameCount++;
    if (t - this._lastFpsUpdate >= 1.0) {
      this._currentFps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsUpdate = t;
      this._updateFpsDisplay();
    }

    // Update WASD panning (marks dirty if moving)
    const wasPanning = this._updatePanning();
    if (wasPanning) this._needsRender = true;

    // Update focus animation
    if (this._focusTween) {
      this._updateFocusAnimation();
      this._needsRender = true;
    }

    // Update visual effects
    if (this._activeEffects.length > 0) {
      this._updateEffects();
      this._needsRender = true;
    }

    // Controls damping requires constant updates
    this.controls.update();

    // Detect OrbitControls camera movement (mouse drag, zoom, etc.)
    if (!this.camera.position.equals(this._lastCameraPosition) ||
        !this.controls.target.equals(this._lastCameraTarget)) {
      this._needsRender = true;
      this._lastCameraPosition.copy(this.camera.position);
      this._lastCameraTarget.copy(this.controls.target);
    }

    // Particle animation - THROTTLED to every N frames to reduce CPU load
    // Original: 400 particles * Math.sin() every frame = expensive
    // Optimized: Update every 3 frames, still looks smooth
    this._particleAnimFrame++;
    if (this.particleSystem && this._particleAnimFrame >= Board3DManager.PARTICLE_ANIM_INTERVAL) {
      this._particleAnimFrame = 0;
      const pa = (this.particleSystem.geometry.attributes.position as BufferAttribute)
        .array as Float32Array;
      // Scale movement by interval to maintain visual speed
      const moveFactor = 0.001 * Board3DManager.PARTICLE_ANIM_INTERVAL;
      for (let i = 1; i < pa.length; i += 3) {
        pa[i] += Math.sin(t * 0.5 + i) * moveFactor;
      }
      this.particleSystem.geometry.attributes.position.needsUpdate = true;
      this.particleSystem.rotation.y = t * 0.006;
      this._needsRender = true;
    }

    // Pulse effects only need render every ~100ms, not every frame
    const shouldPulse = t - this._lastRenderTime > 0.1;
    if (shouldPulse && (this.branchLineGroup?.children.length || Object.keys(this.timelineCols).length > 0)) {
      const pulse = 0.7 + 0.3 * Math.sin(t * 2);
      this.branchLineGroup?.traverse((child: Object3D) => {
        const mesh = child as Mesh;
        if (mesh.isMesh && mesh.material && (mesh.material as Material).opacity <= 0.12) {
          (mesh.material as Material).opacity = 0.1 * pulse;
        }
      });

      // Pulse inter-layer lines per timeline
      for (const key in this.timelineCols) {
        this.timelineCols[key].interLayerGroup.traverse((child: Object3D) => {
          const mesh = child as Mesh;
          if (mesh.isMesh && mesh.material && (mesh.material as Material).opacity <= 0.12) {
            (mesh.material as Material).opacity = 0.1 * pulse;
          }
        });
      }
      this._needsRender = true;
    }

    // PERFORMANCE: Only render when dirty flag is set
    // This can save significant GPU/CPU when the scene is static
    if (this._needsRender) {
      this.renderer.render(this.scene, this.camera);
      this._lastRenderTime = t;
      this._needsRender = false;
    }
  }

  /** Update FPS display in UI */
  private _updateFpsDisplay(): void {
    const fpsEl = document.getElementById('fps-counter');
    if (fpsEl) {
      fpsEl.textContent = `${this._currentFps} FPS`;
    }
  }

  /** Create portal effect at a position (cyan-purple burst) */
  spawnPortalEffect(timelineId: number, square: string): void {
    if (!this.scene || !this._clock) return;
    const col = this.timelineCols[timelineId];
    if (!col) return;

    const pos = this._squareToWorld(col.xOffset, square);

    // Create a ring of particles expanding outward
    const geo = new THREE.RingGeometry(0.1, 0.5, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ffcc,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.set(pos.x, 0.3, pos.z);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);

    this._activeEffects.push({
      mesh: ring,
      startTime: this._clock.getElapsedTime(),
      duration: 0.5,
      type: 'portal',
    });
  }

  /** Create capture effect at a position (red flash) */
  spawnCaptureEffect(timelineId: number, square: string): void {
    if (!this.scene || !this._clock) return;
    const col = this.timelineCols[timelineId];
    if (!col) return;

    const pos = this._squareToWorld(col.xOffset, square);

    // Create a flash sphere
    const geo = new THREE.SphereGeometry(0.3, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.8,
    });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.set(pos.x, 0.4, pos.z);
    this.scene.add(sphere);

    this._activeEffects.push({
      mesh: sphere,
      startTime: this._clock.getElapsedTime(),
      duration: 0.3,
      type: 'capture',
    });
  }

  /** Convert square notation to world position */
  private _squareToWorld(xOffset: number, square: string): { x: number; z: number } {
    const c = square.charCodeAt(0) - 97; // a=0, h=7
    const r = 8 - parseInt(square[1]);   // 8=0, 1=7
    return {
      x: xOffset + c - 3.5,
      z: r - 3.5,
    };
  }

  /** Update visual effects (called in animate loop) */
  private _updateEffects(): void {
    if (!this._clock || !this.scene) return;
    const t = this._clock.getElapsedTime();

    for (let i = this._activeEffects.length - 1; i >= 0; i--) {
      const eff = this._activeEffects[i];
      const elapsed = t - eff.startTime;
      const progress = elapsed / eff.duration;

      if (progress >= 1) {
        // Remove finished effect
        this.scene.remove(eff.mesh);
        eff.mesh.geometry?.dispose();
        if (eff.mesh.material) {
          if (Array.isArray(eff.mesh.material)) {
            eff.mesh.material.forEach(m => m.dispose());
          } else {
            (eff.mesh.material as Material).dispose();
          }
        }
        this._activeEffects.splice(i, 1);
        continue;
      }

      // Animate based on type
      if (eff.type === 'portal') {
        // Expand ring outward and fade
        const scale = 1 + progress * 2;
        eff.mesh.scale.set(scale, scale, 1);
        ((eff.mesh as Mesh).material as MeshStandardMaterial).opacity = 0.9 * (1 - progress);
      } else if (eff.type === 'capture') {
        // Expand sphere and fade quickly
        const scale = 1 + progress * 1.5;
        eff.mesh.scale.set(scale, scale, scale);
        ((eff.mesh as Mesh).material as MeshStandardMaterial).opacity = 0.8 * (1 - progress);
      }
    }
  }

  clearAll(): void {
    for (const key in this.timelineCols) {
      this.timelineCols[key].destroy();
    }
    this.timelineCols = {};
    if (this.branchLineGroup) {
      while (this.branchLineGroup.children.length) {
        this.branchLineGroup.remove(this.branchLineGroup.children[0]);
      }
    }
    // Clear branch line metadata
    this._branchLineData = [];
    this.controls?.target.set(0, 0, 0);
    // Clear object pools when resetting game
    meshPool.clear();
    // Trim sprite pool to reduce memory (keep some for reuse)
    spritePool.trim(32);  // Keep ~1 board worth of pieces for quick reuse
  }

  /**
   * Comprehensive cleanup method for tab close / page unload.
   * Disposes all Three.js resources to prevent memory leaks and GPU context issues.
   * Call this on beforeunload event or when destroying the game instance.
   */
  dispose(): void {
    // Clear all timelines first
    this.clearAll();

    // Dispose particle system
    if (this.particleSystem) {
      this.particleSystem.geometry?.dispose();
      if (this.particleSystem.material) {
        (this.particleSystem.material as Material).dispose();
      }
      this.scene?.remove(this.particleSystem);
      this.particleSystem = null;
    }

    // Dispose branch line group and its contents
    if (this.branchLineGroup && this.scene) {
      this.branchLineGroup.traverse((child: Object3D) => {
        const mesh = child as Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(m => m.dispose());
            } else {
              (mesh.material as Material).dispose();
            }
          }
        }
      });
      this.scene.remove(this.branchLineGroup);
      this.branchLineGroup = null;
    }

    // Dispose active effects
    for (const eff of this._activeEffects) {
      eff.mesh.geometry?.dispose();
      if (eff.mesh.material) {
        if (Array.isArray(eff.mesh.material)) {
          eff.mesh.material.forEach(m => m.dispose());
        } else {
          (eff.mesh.material as Material).dispose();
        }
      }
      this.scene?.remove(eff.mesh);
    }
    this._activeEffects = [];

    // Dispose shared materials
    this._lightSquareMat?.dispose();
    this._darkSquareMat?.dispose();
    this._historyLightSquareMat?.dispose();
    this._historyDarkSquareMat?.dispose();
    this._boardBaseMat?.dispose();
    this._boardTrimMat?.dispose();
    this._lightSquareMat = null;
    this._darkSquareMat = null;
    this._historyLightSquareMat = null;
    this._historyDarkSquareMat = null;
    this._boardBaseMat = null;
    this._boardTrimMat = null;

    // Dispose texture cache
    for (const key in this._texCache) {
      this._texCache[key]?.dispose();
    }
    this._texCache = {};

    // Dispose SharedResources singleton
    SharedResources.getInstance().dispose();

    // Clear mesh pool
    meshPool.clear();

    // Disconnect resize observer
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // Clear resize timeout
    if (this._resizeTimeout !== null) {
      window.clearTimeout(this._resizeTimeout);
      this._resizeTimeout = null;
    }

    // Remove event listeners using stored bound handlers
    if (this._boundResize) {
      window.removeEventListener('resize', this._boundResize);
    }
    if (this._boundKeyDown) {
      window.removeEventListener('keydown', this._boundKeyDown);
    }
    if (this._boundKeyUp) {
      window.removeEventListener('keyup', this._boundKeyUp);
    }
    if (this._boundBeforeUnload) {
      window.removeEventListener('beforeunload', this._boundBeforeUnload);
    }
    // Remove WebGL context loss handlers
    if (this.renderer?.domElement) {
      if (this._boundContextLost) {
        this.renderer.domElement.removeEventListener('webglcontextlost', this._boundContextLost);
      }
      if (this._boundContextRestored) {
        this.renderer.domElement.removeEventListener('webglcontextrestored', this._boundContextRestored);
      }
    }
    // Canvas event listeners - removed when canvas is removed from DOM
    // No need to explicitly remove if renderer.domElement is removed

    this._boundPointerDown = null;
    this._boundPointerUp = null;
    this._boundResize = null;
    this._boundKeyDown = null;
    this._boundKeyUp = null;
    this._boundBeforeUnload = null;
    this._boundContextLost = null;
    this._boundContextRestored = null;

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      if (this.container && this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }

    // Clear references
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.raycaster = null;
    this.mouse = null;
    this.container = null;
    this._clock = null;
    this.onSquareClick = null;
  }
}

// Export singleton instance
export const Board3D = new Board3DManager();
