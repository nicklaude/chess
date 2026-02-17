/* Three.js 6D Chess - multiverse with timeline branching */

// THREE.js is loaded from CDN as a global - we just use the types from @types/three
import type {
  Scene, PerspectiveCamera, WebGLRenderer, Raycaster, Vector2, Vector3, Clock,
  Group, Mesh, Sprite, Points, Material, MeshStandardMaterial, SpriteMaterial,
  Texture, Object3D, BufferAttribute, Color, BoxGeometry, Curve
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
// TimelineCol - one per timeline
// ===============================================================

export class TimelineCol implements ITimelineCol {
  static readonly LAYER_GAP = 2.8;
  static readonly MAX_LAYERS = 12;

  private scene: Scene;
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
  private historyLayers: Group[] = [];
  private historySquareMeshes: Mesh[] = [];
  private moveLineGroup: Group;
  interLayerGroup: Group;
  private crossTimelineTargets: Mesh[] = [];  // Purple highlights for cross-timeline moves
  private timeTravelTargets: Mesh[] = [];     // Cyan-green portals for time travel moves

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

  private _sqToWorld(sq: string, y?: number): Vector3 {
    const p = this._fromSq(sq);
    return new THREE.Vector3(p.c - 3.5 + this.xOffset, y || 0, p.r - 3.5);
  }

  /* board base + squares */
  private _buildBoard(): void {
    // Base board - lowered to prevent z-fighting with square bottoms when viewed from below
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(8.6, 0.18, 8.6),
      new THREE.MeshStandardMaterial({ color: 0x15152a, metalness: 0.7, roughness: 0.3 })
    );
    base.position.y = -0.16;  // Lowered from -0.14 to create gap with square bottoms
    base.receiveShadow = true;
    this.group.add(base);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(8.8, 0.06, 8.8),
      new THREE.MeshStandardMaterial({ color: 0x333366, metalness: 0.9, roughness: 0.2 })
    );
    trim.position.y = -0.28;  // Lowered from -0.24 to stay below base
    this.group.add(trim);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isLight = (r + c) % 2 === 0;
        const mat = new THREE.MeshStandardMaterial({
          color: isLight ? 0x7575a8 : 0x44446e,
          metalness: 0.15,
          roughness: 0.75,
          side: THREE.FrontSide,  // Only visible from above, not below
        });
        // Use PlaneGeometry for single-sided squares (invisible from below)
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), mat);
        mesh.rotation.x = -Math.PI / 2;  // Rotate to lie flat
        mesh.position.set(c - 3.5, 0.035, r - 3.5);  // Slight y offset to sit on base
        mesh.receiveShadow = true;
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

  /* render pieces on current board */
  render(position: Board): void {
    for (let i = 0; i < this.pieceMeshes.length; i++) {
      this.group.remove(this.pieceMeshes[i]);
    }
    this.pieceMeshes = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = position[r][c];
        if (!piece) continue;
        const isW = piece.color === 'w';
        const chKey = isW ? piece.type.toUpperCase() : piece.type;
        const tex = this._pieceTex(this._pieceChars[chKey], isW);
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
        );
        sprite.position.set(c - 3.5, 0.38, r - 3.5);
        sprite.scale.set(0.88, 0.88, 0.88);
        this.pieceMeshes.push(sprite);
        this.group.add(sprite);
      }
    }
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
      const geo = hasPiece
        ? new THREE.RingGeometry(0.34, 0.44, 32)
        : new THREE.CircleGeometry(0.14, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffdd44,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ind = new THREE.Mesh(geo, mat);
      ind.rotation.x = -Math.PI / 2;
      ind.position.set(p.c - 3.5, 0.06, p.r - 3.5);
      this.group.add(ind);
      this.highlightMeshes.push({ type: 'ind', mesh: ind });
    }
  }

  showLastMove(from: string, to: string): void {
    for (let i = 0; i < this.lastMoveHL.length; i++) {
      this.group.remove(this.lastMoveHL[i]);
    }
    this.lastMoveHL = [];
    const sqs = [from, to];
    for (let i = 0; i < 2; i++) {
      const pos = this._fromSq(sqs[i]);
      const pl = new THREE.Mesh(
        new THREE.PlaneGeometry(0.96, 0.96),
        new THREE.MeshBasicMaterial({
          color: 0x4488ff,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      pl.rotation.x = -Math.PI / 2;
      pl.position.set(pos.c - 3.5, 0.055, pos.r - 3.5);
      this.group.add(pl);
      this.lastMoveHL.push(pl);
    }
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
        this.group.remove(h.mesh);
      }
    }
    this.highlightMeshes = [];
  }

  /* Cross-timeline movement indicators */
  showCrossTimelineTarget(sq: string, isCapture: boolean): void {
    const pos = this._fromSq(sq);
    // Purple ring for cross-timeline targets (larger if capture)
    const geo = isCapture
      ? new THREE.RingGeometry(0.38, 0.48, 32)
      : new THREE.RingGeometry(0.28, 0.38, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xaa44ff,  // Purple for cross-timeline
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ind = new THREE.Mesh(geo, mat);
    ind.rotation.x = -Math.PI / 2;
    ind.position.set(pos.c - 3.5, 0.08, pos.r - 3.5);
    this.group.add(ind);
    this.crossTimelineTargets.push(ind);

    // Add pulsing glow effect
    const glowGeo = new THREE.CircleGeometry(0.5, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xaa44ff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.c - 3.5, 0.07, pos.r - 3.5);
    this.group.add(glow);
    this.crossTimelineTargets.push(glow);
  }

  clearCrossTimelineTargets(): void {
    for (const mesh of this.crossTimelineTargets) {
      this.group.remove(mesh);
    }
    this.crossTimelineTargets = [];
  }

  /* Time travel target indicators (on history layers) */
  showTimeTravelTarget(turnIndex: number, sq: string, isCapture: boolean): void {
    // turnIndex 0 = most recent history layer, which is at historyLayers[0]
    if (turnIndex < 0 || turnIndex >= this.historyLayers.length) return;

    const layer = this.historyLayers[turnIndex];
    if (!layer) return;

    const pos = this._fromSq(sq);
    const layerY = layer.position.y;

    // Create a glowing portal/ring effect - cyan-green for time travel
    const portalColor = 0x44ffaa;

    // Outer glow ring
    const outerRingGeo = new THREE.TorusGeometry(0.42, 0.06, 8, 32);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: portalColor,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.set(pos.c - 3.5, 0.12, pos.r - 3.5);
    layer.add(outerRing);
    this.timeTravelTargets.push(outerRing);

    // Inner glow disc
    const glowGeo = new THREE.CircleGeometry(0.36, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: portalColor,
      transparent: true,
      opacity: isCapture ? 0.4 : 0.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.c - 3.5, 0.11, pos.r - 3.5);
    layer.add(glow);
    this.timeTravelTargets.push(glow);

    // Capture indicator (red-ish outer ring if capturing)
    if (isCapture) {
      const captureRingGeo = new THREE.TorusGeometry(0.48, 0.04, 8, 32);
      const captureRingMat = new THREE.MeshBasicMaterial({
        color: 0xff6666,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      });
      const captureRing = new THREE.Mesh(captureRingGeo, captureRingMat);
      captureRing.rotation.x = -Math.PI / 2;
      captureRing.position.set(pos.c - 3.5, 0.13, pos.r - 3.5);
      layer.add(captureRing);
      this.timeTravelTargets.push(captureRing);
    }
  }

  clearTimeTravelTargets(): void {
    // Remove all time travel target meshes from their parent layers
    for (const mesh of this.timeTravelTargets) {
      if (mesh.parent) {
        mesh.parent.remove(mesh);
      }
    }
    this.timeTravelTargets = [];
  }

  /* persistent move lines on current board */
  addMoveLine(fromSq: string, toSq: string, isWhite: boolean): void {
    const a = this._sqToWorld(fromSq, 0.09);
    const b = this._sqToWorld(toSq, 0.09);
    a.x -= this.xOffset;
    b.x -= this.xOffset;
    // Softer, more muted colors and much lower opacity for in-board move lines
    const col = isWhite ? 0x6688bb : 0xbb8866;  // Lighter, desaturated blue/red
    this.moveLineGroup.add(Board3DManager._glowTube(a, b, col, 0.012, 0.04, false, 0.3));  // Thinner, less glow, 30% opacity
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
  }

  private _makeHistoryBoard(position: Board): Group {
    const g = new THREE.Group();
    const turnIndex = this.historyLayers.length;
    const sqMeshes: Mesh[] = [];

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(8.2, 0.03, 8.2),
      new THREE.MeshStandardMaterial({
        color: 0x15152a,
        transparent: true,
        opacity: 0.25,
        metalness: 0.5,
        roughness: 0.5,
      })
    );
    base.position.y = -0.02;
    g.add(base);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isLight = (r + c) % 2 === 0;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.93, 0.025, 0.93),
          new THREE.MeshStandardMaterial({
            color: isLight ? 0x7575a8 : 0x44446e,
            transparent: true,
            opacity: 0.2,
            metalness: 0.15,
            roughness: 0.8,
          })
        );
        m.position.set(c - 3.5, 0, r - 3.5);
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
          new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.35, depthWrite: false })
        );
        sp.position.set(c2 - 3.5, 0.25, r2 - 3.5);
        sp.scale.set(0.7, 0.7, 0.7);
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
  }

  private _layoutLayers(): void {
    for (let i = 0; i < this.historyLayers.length; i++) {
      this.historyLayers[i].position.y = -(i + 1) * TimelineCol.LAYER_GAP;
      const op = Math.max(0.06, 0.38 - i * 0.025);
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
    group.traverse((child: Object3D) => {
      const obj = child as Mesh | Sprite;
      if (obj.material && (obj.material as Material).transparent) {
        (obj.material as Material).opacity = (child as Sprite).isSprite
          ? opacity * 1.1
          : opacity;
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
    for (let i = 0; i < this.historyLayers.length; i++) {
      this.group.remove(this.historyLayers[i]);
    }
    this.historyLayers = [];
    this.historySquareMeshes = [];
    while (this.moveLineGroup.children.length) {
      this.moveLineGroup.remove(this.moveLineGroup.children[0]);
    }
    while (this.interLayerGroup.children.length) {
      this.interLayerGroup.remove(this.interLayerGroup.children[0]);
    }
    this.clearHighlights();
    for (let i = 0; i < this.lastMoveHL.length; i++) {
      this.group.remove(this.lastMoveHL[i]);
    }
    this.lastMoveHL = [];
  }

  destroy(): void {
    this.clearAll();
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

  // Performance: pooled scratch vectors (avoid GC churn)
  private _tempVec3A = new THREE.Vector3();
  private _tempVec3B = new THREE.Vector3();
  private _tempVec3C = new THREE.Vector3();

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
  private onSquareClick:
    | ((info: { timelineId: number; square: string; turn: number; isHistory: boolean }) => void)
    | null = null;

  private _panKeys: PanKeyState = { w: false, a: false, s: false, d: false, q: false, e: false };
  private _panSpeed = 0.12;  // Slowed down from 0.25 for smoother control
  private _zoomSpeed = 0.4;
  private _focusTween: FocusTween | undefined;

  // Visual effects storage
  private _activeEffects: Array<{
    mesh: Mesh | Points;
    startTime: number;
    duration: number;
    type: 'portal' | 'capture';
  }> = [];

  readonly PIECE_CHARS: PieceCharMap = {
    K: '\u2654',
    Q: '\u2655',
    R: '\u2656',
    B: '\u2657',
    N: '\u2658',
    P: '\u2659',
    k: '\u265A',
    q: '\u265B',
    r: '\u265C',
    b: '\u265D',
    n: '\u265E',
    p: '\u265F',
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

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setClearColor(0x080818);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

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

    this.renderer.domElement.addEventListener('pointerdown', (e: PointerEvent) => {
      this._downPos = { x: e.clientX, y: e.clientY };
    });
    this.renderer.domElement.addEventListener('pointerup', (e: PointerEvent) => {
      if (!this._downPos) return;
      const dx = e.clientX - this._downPos.x;
      const dy = e.clientY - this._downPos.y;
      if (dx * dx + dy * dy < 36) this._onClick(e);
      this._downPos = null;
    });
    window.addEventListener('resize', () => this._onResize());

    // WASD keyboard panning
    window.addEventListener('keydown', (e: KeyboardEvent) => this._onKeyDown(e));
    window.addEventListener('keyup', (e: KeyboardEvent) => this._onKeyUp(e));

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

    const fromY = -(fromTurn + 1) * TimelineCol.LAYER_GAP;
    const from = new THREE.Vector3(fromCol.xOffset, fromY + 0.2, 0);
    const to = new THREE.Vector3(toCol.xOffset, 0.2, 0);
    const tintCol = this.TIMELINE_COLORS[toTlId % this.TIMELINE_COLORS.length];
    this.branchLineGroup.add(Board3DManager._glowTube(from, to, tintCol, 0.04, 0.18, true));
  }

  /** Add a horizontal line showing cross-timeline piece movement */
  addCrossTimelineLine(fromTlId: number, toTlId: number, square: string, isWhite: boolean): void {
    const fromCol = this.timelineCols[fromTlId];
    const toCol = this.timelineCols[toTlId];
    if (!fromCol || !toCol || !this.branchLineGroup) return;

    // Get the 3D position of the square in each timeline
    const pos = this._fromSq(square);
    const sqX = pos.c - 3.5;
    const sqZ = pos.r - 3.5;

    const from = new THREE.Vector3(fromCol.xOffset + sqX, 0.3, sqZ);
    const to = new THREE.Vector3(toCol.xOffset + sqX, 0.3, sqZ);

    // Purple for cross-timeline moves
    const color = 0xaa44ff;
    this.branchLineGroup.add(Board3DManager._glowTube(from, to, color, 0.03, 0.12, true));
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

    const pos = this._fromSq(square);
    const sqX = pos.c - 3.5;
    const sqZ = pos.r - 3.5;

    // Line goes: source board (top) -> down through time -> across to new timeline
    const sourceY = 0.3;  // Current board height
    const targetY = -(targetTurnIndex + 1) * TimelineCol.LAYER_GAP + 0.2;  // Historical layer height

    // Start point: queen's position on current source board
    const start = new THREE.Vector3(sourceCol.xOffset + sqX, sourceY, sqZ);

    // Mid point: same square but at the historical layer depth (in source timeline)
    const mid = new THREE.Vector3(sourceCol.xOffset + sqX, targetY, sqZ);

    // End point: the new timeline's current board (where queen arrived)
    const end = new THREE.Vector3(newCol.xOffset + sqX, 0.3, sqZ);

    // Cyan-green for time travel
    const color = 0x44ffaa;

    // Vertical line down through time
    this.branchLineGroup.add(Board3DManager._glowTube(start, mid, color, 0.03, 0.12, false));

    // Horizontal/arc line to new timeline
    this.branchLineGroup.add(Board3DManager._glowTube(mid, end, color, 0.03, 0.12, true));
  }

  private _fromSq(sq: string): { r: number; c: number } {
    return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
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
      ctx.shadowColor = 'rgba(80,80,140,0.5)';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#303048';
      ctx.fillText(symbol, s / 2, s / 2);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#aaaacc';
      ctx.lineWidth = 2.5;
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
      const hDir = new THREE.Vector2(mid.x, mid.z);
      const hLen = hDir.length();
      if (hLen > 0.01) {
        hDir.normalize();
        mid.x += hDir.x * 0.7;
        mid.z += hDir.y * 0.7;
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

      const right = this._tempVec3B;
      right.set(0, 1, 0);
      right.crossVectors(forward, right).normalize();

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

  private _onResize(): void {
    if (!this.container || !this.camera || !this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private _animate(): void {
    requestAnimationFrame(() => this._animate());

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

    // Particle animation (runs always for ambient effect, but lightweight)
    if (this.particleSystem) {
      const pa = (this.particleSystem.geometry.attributes.position as BufferAttribute)
        .array as Float32Array;
      for (let i = 1; i < pa.length; i += 3) {
        pa[i] += Math.sin(t * 0.5 + i) * 0.001;
      }
      this.particleSystem.geometry.attributes.position.needsUpdate = true;
      this.particleSystem.rotation.y = t * 0.006;
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

    // Only render if something changed or we have active animations
    // For now, always render but track FPS - can make this stricter later
    this.renderer.render(this.scene, this.camera);
    this._lastRenderTime = t;
    this._needsRender = false;
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
    this.controls?.target.set(0, 0, 0);
  }
}

// Export singleton instance
export const Board3D = new Board3DManager();
