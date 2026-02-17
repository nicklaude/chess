# TypeScript Migration Plan for 6D Chess

## Overview

### Why Migrate to TypeScript?

The 6D Chess project has grown to ~1,500 lines of JavaScript across two main files:
- `js/game.js` (~830 lines) - Game logic, timeline management, move history
- `js/board3d.js` (~785 lines) - THREE.js 3D rendering, camera controls, board visualization

**Benefits of migrating to TypeScript:**

1. **Type Safety** - Catch bugs at compile time instead of runtime. The codebase has complex data structures (timelines, snapshots, moves) where type mismatches are easy to introduce.

2. **Better IDE Support** - Autocomplete for THREE.js APIs, chess.js methods, and your own interfaces. No more guessing method signatures.

3. **Refactoring Confidence** - Renaming properties, changing function signatures, or restructuring data flows becomes safe with compiler checks.

4. **Self-Documenting Code** - Interfaces serve as living documentation for data structures like `TimelineData`, `Snapshot`, and `Move`.

5. **Easier Collaboration** - If others contribute, types make the codebase more approachable.

### Migration Strategy

This plan uses a **gradual migration** approach:
- Keep the project working at every step
- Migrate one file at a time
- Start with `.ts` files alongside `.js` files
- Enable strict mode only after all files are converted

---

## Phase 1: Setup (2-3 hours)

### 1.1 Install Dependencies

```bash
cd ~/code/chess
npm init -y
npm install --save-dev typescript esbuild @types/three
```

**Why esbuild?**
- Extremely fast (10-100x faster than tsc for bundling)
- Zero config for simple projects
- Handles TypeScript natively
- Small dependency footprint

### 1.2 Create tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowJs": true,
    "checkJs": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": false,
    "sourceMap": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Key settings explained:**
- `strict: false` - Start lenient, enable later
- `allowJs: true` - Mix .js and .ts during migration
- `noEmit: true` - Let esbuild handle output, tsc just type-checks
- `sourceMap: true` - Debug TypeScript in browser DevTools

### 1.3 Create Build Script

Create `build.js`:

```javascript
const esbuild = require('esbuild');

const isDev = process.argv.includes('--watch');

const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  sourcemap: true,
  target: 'es2020',
  format: 'iife',
  external: ['three'],  // THREE.js loaded from CDN
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"'
  },
  minify: !isDev,
};

if (isDev) {
  esbuild.context(config).then(ctx => {
    ctx.watch();
    console.log('Watching for changes...');
  });
} else {
  esbuild.build(config).then(() => {
    console.log('Build complete!');
  });
}
```

### 1.4 Add npm Scripts

Update `package.json`:

```json
{
  "scripts": {
    "build": "node build.js",
    "watch": "node build.js --watch",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit && echo 'Types OK!'"
  }
}
```

### 1.5 Create Source Directory Structure

```
chess/
├── src/
│   ├── main.ts          # Entry point
│   ├── game.ts          # Game logic (migrated from js/game.js)
│   ├── board3d.ts       # 3D rendering (migrated from js/board3d.js)
│   └── types/
│       ├── index.ts     # Re-exports all types
│       ├── game.ts      # Game-related interfaces
│       └── three.d.ts   # THREE.js augmentations if needed
├── dist/
│   └── bundle.js        # Built output
├── js/                  # Keep during migration, delete after
├── index.html           # Update script src to dist/bundle.js
└── tsconfig.json
```

### 1.6 Update index.html

Change the script loading:

```html
<!-- Before -->
<script src="js/board3d.js"></script>
<script src="js/game.js"></script>

<!-- After -->
<script src="dist/bundle.js"></script>
```

Keep the CDN scripts for THREE.js and chess.js - they'll be external to the bundle.

---

## Phase 2: Types (3-4 hours)

### 2.1 Core Game Types

Create `src/types/game.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════
// Chess piece and board types
// ═══════════════════════════════════════════════════════════════

export type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
export type PieceColor = 'w' | 'b';

export interface Piece {
  type: PieceType;
  color: PieceColor;
}

/** 8x8 board representation - row 0 is rank 8, col 0 is file a */
export type Board = (Piece | null)[][];

export type Square = string; // e.g., 'e4', 'a1'

// ═══════════════════════════════════════════════════════════════
// Move types
// ═══════════════════════════════════════════════════════════════

export interface Move {
  from: Square;
  to: Square;
  piece: PieceType;
  captured?: PieceType | null;
  san: string;           // Standard Algebraic Notation, e.g., "Nf3"
  isWhite: boolean;
  promotion?: PieceType | null;
}

/** Verbose move from chess.js */
export interface ChessMove {
  from: Square;
  to: Square;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  flags: string;
  san: string;
  color: PieceColor;
}

// ═══════════════════════════════════════════════════════════════
// Snapshot types (for history/time travel)
// ═══════════════════════════════════════════════════════════════

/** New format: contains both FEN (for game state) and board (for rendering) */
export interface Snapshot {
  fen: string;
  board: Board;
}

/** Old format for backward compatibility */
export type LegacySnapshot = Board;

/** Union type for handling both formats */
export type AnySnapshot = Snapshot | LegacySnapshot;

// ═══════════════════════════════════════════════════════════════
// Timeline types (multiverse branching)
// ═══════════════════════════════════════════════════════════════

export interface TimelineData {
  id: number;
  chess: ChessInstance;   // chess.js instance
  moveHistory: Move[];
  snapshots: Snapshot[];
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

// ═══════════════════════════════════════════════════════════════
// Click/interaction types
// ═══════════════════════════════════════════════════════════════

export interface SquareClickInfo {
  timelineId: number;
  square: Square;
  turn: number;          // -1 for current board, 0+ for history layers
  isHistory: boolean;
}

export interface PendingPromotion {
  tlId: number;
  move: ChessMove;
}

// ═══════════════════════════════════════════════════════════════
// chess.js type stubs (until @types/chess.js is added)
// ═══════════════════════════════════════════════════════════════

export interface ChessInstance {
  fen(): string;
  board(): Board;
  turn(): PieceColor;
  get(square: Square): Piece | null;
  move(move: string | { from: Square; to: Square; promotion?: PieceType }): ChessMove | null;
  moves(options?: { square?: Square; verbose?: boolean }): ChessMove[] | string[];
  history(options?: { verbose?: boolean }): string[] | ChessMove[];
  in_check(): boolean;
  in_checkmate(): boolean;
  in_draw(): boolean;
  in_stalemate(): boolean;
  load(fen: string): boolean;
}

declare global {
  const Chess: new (fen?: string) => ChessInstance;
}
```

### 2.2 Board3D Types

Create `src/types/board3d.ts`:

```typescript
import * as THREE from 'three';
import type { Board, Square, PieceColor, ChessMove } from './game';

// ═══════════════════════════════════════════════════════════════
// THREE.js mesh user data
// ═══════════════════════════════════════════════════════════════

export interface SquareUserData {
  square: Square;
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

// ═══════════════════════════════════════════════════════════════
// Timeline column (3D board visualization)
// ═══════════════════════════════════════════════════════════════

export interface HistoryLayerData {
  moveFrom: Square;
  moveTo: Square;
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

// ═══════════════════════════════════════════════════════════════
// Texture and piece rendering
// ═══════════════════════════════════════════════════════════════

export type TextureCache = Record<string, THREE.Texture>;

export type PieceCharMap = Record<string, string>;

// ═══════════════════════════════════════════════════════════════
// Camera animation
// ═══════════════════════════════════════════════════════════════

export interface FocusTween {
  start: THREE.Vector3;
  end: THREE.Vector3;
  startTime: number;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════
// Keyboard state
// ═══════════════════════════════════════════════════════════════

export interface PanKeyState {
  w: boolean;
  a: boolean;
  s: boolean;
  d: boolean;
  q: boolean;
  e: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Board3D module interface
// ═══════════════════════════════════════════════════════════════

export interface Board3DModule {
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  controls: THREE.OrbitControls | null;

  timelineCols: Record<number, TimelineCol>;

  PIECE_CHARS: PieceCharMap;
  TIMELINE_COLORS: number[];
  TIMELINE_SPACING: number;

  init(containerId: string, onSquareClick: (info: SquareClickInfo) => void): void;
  createTimeline(id: number, xOffset: number): TimelineCol;
  getTimeline(id: number): TimelineCol | undefined;
  removeTimeline(id: number): void;
  setActiveTimeline(id: number): void;
  focusTimeline(id: number, animate: boolean): void;
  addBranchLine(fromTlId: number, fromTurn: number, toTlId: number): void;
  clearAll(): void;
}

// ═══════════════════════════════════════════════════════════════
// TimelineCol class interface
// ═══════════════════════════════════════════════════════════════

export interface TimelineCol {
  id: number;
  xOffset: number;
  group: THREE.Group;

  render(position: Board): void;
  select(sq: Square): void;
  showLegalMoves(moves: ChessMove[], position: Board): void;
  showLastMove(from: Square, to: Square): void;
  clearHighlights(): void;
  addMoveLine(from: Square, to: Square, isWhite: boolean): void;
  addSnapshot(position: Board, moveFrom: Square, moveTo: Square, isWhite: boolean): void;
  setActive(active: boolean): void;
  setHighlighted(highlighted: boolean): void;
  getAllSquareMeshes(): THREE.Mesh[];
  clearAll(): void;
  destroy(): void;
}
```

### 2.3 Type Re-exports

Create `src/types/index.ts`:

```typescript
export * from './game';
export * from './board3d';
```

---

## Phase 3: Gradual Migration (6-8 hours)

### 3.1 Recommended Migration Order

1. **`types/` directory** - Already done in Phase 2
2. **`board3d.ts`** - More self-contained, fewer dependencies
3. **`game.ts`** - Depends on board3d and chess.js
4. **`main.ts`** - Entry point, imports everything

### 3.2 Migration Process for Each File

For each file:

1. **Copy** `js/file.js` to `src/file.ts`
2. **Add imports** at the top:
   ```typescript
   import * as THREE from 'three';
   import type { ... } from './types';
   ```
3. **Add type annotations** to function parameters and return types
4. **Run `npm run typecheck`** to find issues
5. **Fix errors** one at a time
6. **Test in browser** to ensure functionality

### 3.3 Converting board3d.js

Key changes needed:

```typescript
// Before (JavaScript)
function TimelineCol(scene, id, xOffset, tintColor, texCache, pieceChars, pieceTex) {
    this.scene = scene;
    // ...
}

// After (TypeScript class)
import * as THREE from 'three';
import type { Board, Square, TimelineColConfig, HistoryLayerData } from './types';

export class TimelineCol {
  private scene: THREE.Scene;
  private id: number;
  private xOffset: number;
  private tint: number;

  private group: THREE.Group;
  private squareMeshes: THREE.Mesh[] = [];
  private pieceMeshes: THREE.Sprite[] = [];
  private highlightMeshes: HighlightEntry[] = [];
  private historyLayers: THREE.Group[] = [];

  static readonly LAYER_GAP = 2.8;
  static readonly MAX_LAYERS = 12;

  constructor(config: TimelineColConfig) {
    this.scene = config.scene;
    this.id = config.id;
    // ...
  }

  render(position: Board): void {
    // ...
  }
}
```

### 3.4 Converting game.js

Key changes needed:

```typescript
// Before (JavaScript object literal)
var Game = {
    timelines: {},
    activeTimelineId: 0,
    init: function() { ... }
};

// After (TypeScript class or module)
import { Board3D } from './board3d';
import type { TimelineData, Move, Snapshot, SquareClickInfo, PendingPromotion } from './types';

class Game {
  private timelines: Map<number, TimelineData> = new Map();
  private activeTimelineId: number = 0;
  private nextTimelineId: number = 1;
  private selected: Square | null = null;
  private selectedTimelineId: number | null = null;
  private pendingPromotion: PendingPromotion | null = null;
  private viewingMoveIndex: number | null = null;

  init(): void {
    Board3D.init('scene-container', (info) => this.handleClick(info));
    // ...
  }

  private handleClick(info: SquareClickInfo): void {
    // ...
  }
}

export const game = new Game();
```

### 3.5 Handling .js and .ts Coexistence

During migration, you might have both formats. Options:

**Option A: Shadow copies (recommended)**
- Keep original `.js` files in `js/`
- Work on `.ts` versions in `src/`
- Switch `index.html` to use `dist/bundle.js` once Phase 3 starts
- Delete `js/` directory when migration complete

**Option B: Incremental in-place**
- Rename files one at a time from `.js` to `.ts`
- Requires more careful tsconfig management

---

## Phase 4: Strict Mode (2-3 hours)

### 4.1 Enable Strict Options Incrementally

Update `tsconfig.json` one option at a time:

```json
{
  "compilerOptions": {
    // Step 1: Enable these first
    "noImplicitAny": true,

    // Step 2: After fixing noImplicitAny errors
    "strictNullChecks": true,

    // Step 3: After fixing null checks
    "strictFunctionTypes": true,
    "strictBindCallApply": true,

    // Step 4: Final strict settings
    "strict": true
  }
}
```

### 4.2 Common `any` Locations to Fix

Based on the current code, expect `any` in:

1. **chess.js integration** - Add proper typing or use type assertions
2. **THREE.js userData** - Type the userData objects explicitly
3. **Event handlers** - Type DOM events properly
4. **Object iteration** - Use `Object.entries()` with type guards

### 4.3 Fixing Null Checks

Common patterns:

```typescript
// Before
var tl = this.timelines[this.activeTimelineId];
if (!tl) return;
// tl could still be undefined according to TypeScript

// After
const tl = this.timelines.get(this.activeTimelineId);
if (!tl) return;
// TypeScript now knows tl is TimelineData
```

---

## Phase 5: GitHub Actions Update (30 minutes)

### 5.1 Updated Workflow

Replace `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run typecheck

      - name: Build
        run: npm run build

      - name: Prepare deploy directory
        run: |
          mkdir -p deploy
          cp index.html deploy/
          cp -r css deploy/
          cp -r dist deploy/
          cp .nojekyll deploy/

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: 'deploy'

      - id: deployment
        uses: actions/deploy-pages@v4
```

### 5.2 Add .gitignore Entries

Update `.gitignore`:

```gitignore
# Dependencies
node_modules/

# Build output
dist/

# TypeScript cache
*.tsbuildinfo

# IDE
.vscode/
.idea/

# OS
.DS_Store
```

### 5.3 Required Files for CI

Ensure these are committed:
- `package.json`
- `package-lock.json` (run `npm install` locally first)
- `tsconfig.json`
- `build.js`

---

## Estimated Effort Summary

| Phase | Description | Time Estimate |
|-------|-------------|---------------|
| 1 | Setup (tooling, config, structure) | 2-3 hours |
| 2 | Types (interfaces, type definitions) | 3-4 hours |
| 3 | Gradual Migration (convert files) | 6-8 hours |
| 4 | Strict Mode (fix remaining issues) | 2-3 hours |
| 5 | GitHub Actions (CI/CD update) | 30 minutes |
| **Total** | | **14-19 hours** |

### Suggested Approach for Spare Time

**Week 1:** Phase 1 + Phase 2 (one evening session)
- Set up tooling and define all types
- No code changes yet, project still works with old JS

**Week 2:** Phase 3 - board3d.ts (two sessions)
- Convert TimelineCol class
- Convert Board3D module
- Test thoroughly

**Week 3:** Phase 3 - game.ts (two sessions)
- Convert Game object to class
- Wire up imports
- Full integration testing

**Week 4:** Phase 4 + Phase 5 (one session)
- Enable strict mode
- Fix remaining type errors
- Update GitHub Actions
- Final testing and deploy

---

## Quick Reference Commands

```bash
# Development
npm run watch        # Watch mode with auto-rebuild
npm run typecheck    # Type check only (fast)
npm run build        # Production build

# Testing locally
open index.html      # Test in browser (after build)

# Debugging
# Open DevTools → Sources → webpack:// → src/ for TypeScript source maps
```

---

## Rollback Plan

If migration causes issues:

1. The original `js/` files remain untouched during migration
2. Revert `index.html` to load `js/board3d.js` and `js/game.js` directly
3. GitHub Actions can fall back to the simpler deploy without build step

Keep the `js/` directory until you're confident the TypeScript version is stable, then delete it in a final cleanup commit.
