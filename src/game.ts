/* 6D Chess - multiverse game controller with timeline branching */

import { Board3D, TimelineCol } from './board3d';
import {
  expandFenRow,
  compressFenRow,
  squareToIndices,
  parseFen,
  buildFen,
  updateCastlingForRemoval,
  updateCastlingForPlacement,
  modifyFen as modifyFenUtil,
  getTimelineDebugInfo,
  logGameState,
  isValidFen,
  validateKings,
  validateNoSelfCheck,
  type BoardDebugInfo,
  type GameDebugState,
} from './gameUtils';
import type {
  Board,
  Piece,
  PieceType,
  PieceColor,
  Move,
  ChessMove,
  ChessInstance,
  TimelineData,
  AnySnapshot,
  Snapshot,
  PendingPromotion,
  SquareClickInfo,
  CrossTimelineMove,
  CrossTimelineMoveTarget,
  CrossTimelineSelection,
  TimeTravelTarget,
  TimeTravelSelection,
  Square,
} from './types';
import { TimelineTransaction } from './transaction';
import { stockfish, type StockfishMove } from './stockfish';

class GameManager {
  private timelines: Record<number, TimelineData> = {};
  private activeTimelineId = 0;
  private nextTimelineId = 1;
  private selected: string | null = null;
  private selectedTimelineId: number | null = null;
  private pendingPromotion: PendingPromotion | null = null;
  private viewingMoveIndex: number | null = null;

  // Cross-timeline movement state
  private crossTimelineSelection: CrossTimelineSelection | null = null;

  // Time travel movement state (queen moving backward in time)
  private timeTravelSelection: TimeTravelSelection | null = null;

  // Cached state for optimized re-renders (avoid unnecessary DOM updates)
  private _lastMoveListHtml = '';
  private _lastTimelineListHtml = '';
  private _lastTimelineStructure = '';

  // Debounce timer for timeline hover highlighting
  private _highlightDebounceTimer: number | null = null;
  private _highlightDebounceDelay = 50; // ms

  init(): void {
    Board3D.init('scene-container', (info) => this.handleClick(info));

    const resetBtn = document.getElementById('reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.reset());
    }

    // Setup CPU controls
    this._setupCpuControls();

    // Setup keyboard navigation
    this._setupKeyboardNav();

    // Setup move slider
    this._setupMoveSlider();

    // Setup command input for programmatic testing
    this._setupCommandInput();

    // Setup sidebar resize
    this._setupSidebarResize();

    // Setup timeline panel resize and collapse
    this._setupTimelinePanel();

    // Create the main timeline
    this._createTimeline(0, 0, null, -1, null);
    this.setActiveTimeline(0);
    this.renderTimeline(0);
    this.updateStatus();
    this.updateTimelineList();

    // Setup collapsible shortcuts panel
    this._setupCollapsibleShortcuts();

    // Setup example play button
    this._setupExamplePlay();

    // Register callback to update UI when Stockfish becomes ready
    stockfish.onReady(() => {
      this._updateCpuUI();
    });

    // Initial CPU UI update (will show loading state if not ready)
    this._updateCpuUI();
  }

  /* -- Example Play (Demo Mode) -- */
  private _examplePlaying = false;
  private _exampleTimer: number | null = null;

  private _setupExamplePlay(): void {
    const btn = document.getElementById('example-play');
    if (btn) {
      btn.addEventListener('click', () => this._toggleExamplePlay());
    }
  }

  private _toggleExamplePlay(): void {
    if (this._examplePlaying) {
      this._stopExamplePlay();
    } else {
      this._startExamplePlay();
    }
  }

  private _startExamplePlay(): void {
    // Reset first
    this.reset();
    this._examplePlaying = true;

    const btn = document.getElementById('example-play');
    if (btn) {
      btn.classList.add('running');
      btn.textContent = '⏹ Stop';
    }

    // Example game: Fool's Mate - the fastest possible checkmate (2 moves)
    // This demonstrates a quick checkmate for testing purposes
    // After checkmate, CPU takes over to continue playing on other timelines
    const moves = [
      // Fool's Mate sequence - Black wins in 4 half-moves
      { from: 'f2', to: 'f3' },   // 1. f3 (weakens king position)
      { from: 'e7', to: 'e5' },   // 1... e5
      { from: 'g2', to: 'g4' },   // 2. g4?? (blunder - exposes king diagonal)
      { from: 'd8', to: 'h4' },   // 2... Qh4# (checkmate!)
    ];

    let moveIndex = 0;
    const playNextMove = () => {
      if (!this._examplePlaying || moveIndex >= moves.length) {
        // After main moves, start CPU to finish the game
        if (this._examplePlaying) {
          // Enable dumb mode for fast finish
          this.cpuUseStockfish = false;
          this._updateCpuUI();
          this.cpuStart();
        }
        return;
      }

      const move = moves[moveIndex];
      const tl = this.timelines[this.activeTimelineId];
      if (tl) {
        try {
          // Find the valid chess move from the position
          const validMoves = tl.chess.moves({ verbose: true }) as ChessMove[];
          const chessMove = validMoves.find(m => m.from === move.from && m.to === move.to);
          if (chessMove) {
            this.makeMove(this.activeTimelineId, chessMove);
          } else {
            console.warn('[ExamplePlay] Move not found in legal moves:', move);
          }
        } catch (e) {
          console.warn('[ExamplePlay] Move failed:', move, e);
        }
      }

      moveIndex++;
      this._exampleTimer = window.setTimeout(playNextMove, 300);
    };

    // Start playing
    this._exampleTimer = window.setTimeout(playNextMove, 200);
  }

  private _stopExamplePlay(): void {
    this._examplePlaying = false;
    if (this._exampleTimer !== null) {
      clearTimeout(this._exampleTimer);
      this._exampleTimer = null;
    }
    this.cpuStop();

    const btn = document.getElementById('example-play');
    if (btn) {
      btn.classList.remove('running');
      btn.textContent = '▶ Demo';
    }
  }

  /* -- Keyboard Navigation -- */
  private _setupKeyboardNav(): void {
    document.addEventListener('keydown', (e) => {
      // Don't capture if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          this.navigateMove(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.navigateMove(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          Board3D.cycleBoard(-1);  // Previous board
          break;
        case 'ArrowDown':
          e.preventDefault();
          Board3D.cycleBoard(1);   // Next board
          break;
        case 'Tab':
          e.preventDefault();
          this.cycleTimeline(e.shiftKey ? -1 : 1);
          break;
        case ' ':
          e.preventDefault();
          this.flipBoard();
          break;
        case 'Home':
          e.preventDefault();
          this.goToMove(0);
          break;
        case 'End':
          e.preventDefault();
          this.goToMove(-1); // -1 = last move
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          this.focusActiveTimeline();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          this.resetCameraView();
          break;
        // Number keys 1-9 to select specific board
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          e.preventDefault();
          Board3D.selectBoard(parseInt(e.key) - 1);
          break;
        case '0':
          e.preventDefault();
          Board3D.selectBoard(9);  // 0 selects 10th board
          break;
        // Z key to zoom in on selected board
        case 'z':
        case 'Z':
          e.preventDefault();
          Board3D.zoomInOnSelected();
          break;
        // X key to zoom out / show all
        case 'x':
        case 'X':
          e.preventDefault();
          Board3D.zoomOut();
          break;
        // V key to toggle zoom
        case 'v':
        case 'V':
          e.preventDefault();
          Board3D.toggleZoom();
          break;
        // T key to toggle 2D top-down mode
        case 't':
        case 'T':
          e.preventDefault();
          Board3D.toggle2DMode();
          this._update2DButtonUI();
          break;
      }
    });
  }

  /* -- Collapsible Shortcuts Panel -- */
  private _setupCollapsibleShortcuts(): void {
    const panel = document.getElementById('shortcuts-panel');
    const header = document.getElementById('shortcuts-header');
    if (panel && header && !header.hasAttribute('data-collapse-init')) {
      header.setAttribute('data-collapse-init', 'true');
      header.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
      });
    }
  }

  /* -- Move Slider -- */
  private _setupMoveSlider(): void {
    const sliderContainer = document.createElement('div');
    sliderContainer.id = 'move-slider-container';
    sliderContainer.innerHTML =
      '<input type="range" id="move-slider" min="0" max="0" value="0">' +
      '<div id="move-slider-label">Move 0/0</div>';

    // Insert before the moves panel
    const movesEl = document.getElementById('moves');
    if (movesEl?.parentNode) {
      movesEl.parentNode.insertBefore(sliderContainer, movesEl);
    }

    const slider = document.getElementById('move-slider') as HTMLInputElement | null;
    if (slider) {
      slider.addEventListener('input', () => {
        this.goToMove(parseInt(slider.value));
      });
    }
  }

  /* -- CPU Controls -- */
  private _setupCpuControls(): void {
    const cpuToggle = document.getElementById('cpu-toggle');
    if (cpuToggle) {
      cpuToggle.addEventListener('click', () => this.cpuToggle());
    }

    const speedSlider = document.getElementById('cpu-speed') as HTMLInputElement | null;
    if (speedSlider) {
      speedSlider.addEventListener('input', () => {
        // Direct mapping: slider value = delay (right side = higher value = slower)
        // Actually want: right = faster = lower delay
        // So invert: delay = 2100 - sliderValue
        const sliderVal = parseInt(speedSlider.value);
        this.cpuSetDelay(2100 - sliderVal);
      });
    }

    const maxTimelinesSlider = document.getElementById('max-timelines') as HTMLInputElement | null;
    const maxTimelinesValue = document.getElementById('max-timelines-value');
    if (maxTimelinesSlider) {
      maxTimelinesSlider.addEventListener('input', () => {
        const val = parseInt(maxTimelinesSlider.value);
        this.setMaxTimelines(val);
        if (maxTimelinesValue) {
          maxTimelinesValue.textContent = val.toString();
        }
      });
    }

    const cameraToggle = document.getElementById('cpu-camera-toggle');
    if (cameraToggle) {
      cameraToggle.addEventListener('click', () => {
        this.cpuCameraFollow = !this.cpuCameraFollow;
        this._updateCpuUI();
      });
    }

    // 2D mode toggle button
    const mode2DToggle = document.getElementById('2d-mode-toggle');
    if (mode2DToggle) {
      mode2DToggle.addEventListener('click', () => {
        Board3D.toggle2DMode();
        this._update2DButtonUI();
      });
    }

    // White CPU controls
    const whiteToggle = document.getElementById('cpu-white-toggle');
    if (whiteToggle) {
      whiteToggle.addEventListener('click', () => {
        this.cpuWhiteEnabled = !this.cpuWhiteEnabled;
        this._updateCpuUI();
      });
    }

    // Black CPU toggle
    const blackToggle = document.getElementById('cpu-black-toggle');
    if (blackToggle) {
      blackToggle.addEventListener('click', () => {
        this.cpuBlackEnabled = !this.cpuBlackEnabled;
        this._updateCpuUI();
      });
    }

    // Unified 5D controls (apply to both colors)
    const crossTimelineSlider = document.getElementById('cpu-cross-timeline') as HTMLInputElement | null;
    const crossTimelineValue = document.getElementById('cpu-cross-timeline-value');
    if (crossTimelineSlider) {
      crossTimelineSlider.addEventListener('input', () => {
        const val = parseInt(crossTimelineSlider.value);
        this.cpuCrossTimelineChance = val / 100;
        if (crossTimelineValue) crossTimelineValue.textContent = `${val}%`;
      });
    }

    const timeTravelSlider = document.getElementById('cpu-time-travel') as HTMLInputElement | null;
    const timeTravelValue = document.getElementById('cpu-time-travel-value');
    if (timeTravelSlider) {
      timeTravelSlider.addEventListener('input', () => {
        const val = parseInt(timeTravelSlider.value);
        this.cpuTimeTravelChance = val / 100;
        if (timeTravelValue) timeTravelValue.textContent = `${val}%`;
      });
    }

    // Unified per-piece portal sliders (apply to both colors)
    const pieceTypes = ['q', 'r', 'b', 'n'] as const;
    for (const pt of pieceTypes) {
      const slider = document.getElementById(`cpu-portal-${pt}`) as HTMLInputElement | null;
      if (slider) {
        slider.addEventListener('input', () => {
          const val = parseInt(slider.value) / 100;
          this.cpuWhitePortalBias[pt] = val;
          this.cpuBlackPortalBias[pt] = val;
          // Update the label
          const span = slider.nextElementSibling;
          if (span) span.textContent = slider.value;
        });
      }
    }

    // Speed slider display - show actual delay (inverted from slider value)
    const speedSlider2 = document.getElementById('cpu-speed') as HTMLInputElement | null;
    const speedValue = document.getElementById('cpu-speed-value');
    if (speedSlider2 && speedValue) {
      speedSlider2.addEventListener('input', () => {
        // Show actual delay: slider 100 = 2000ms delay (slow), slider 2000 = 100ms delay (fast)
        const actualDelay = 2100 - parseInt(speedSlider2.value);
        speedValue.textContent = `${actualDelay}ms`;
      });
    }

    // FIX: Blur sliders after interaction to restore WASD keyboard control
    // Range inputs keep focus after dragging, which blocks keyboard events
    document.querySelectorAll('#cpu-controls input[type="range"]').forEach(slider => {
      slider.addEventListener('change', () => {
        (slider as HTMLInputElement).blur();
      });
    });

    // Disable camera follow when user pans manually
    const sceneContainer = document.getElementById('scene-container');
    if (sceneContainer) {
      sceneContainer.addEventListener('pointerdown', () => {
        if (this.cpuEnabled && this.cpuCameraFollow) {
          this.cpuCameraFollow = false;
          this._updateCpuUI();
        }
      });
    }

    // Stockfish controls
    const sfToggle = document.getElementById('cpu-stockfish-toggle');
    if (sfToggle) {
      sfToggle.addEventListener('click', () => this.toggleStockfish());
    }

    // Dumb CPU mode toggle (random moves instead of Stockfish)
    const dumbToggle = document.getElementById('cpu-dumb-toggle');
    if (dumbToggle) {
      dumbToggle.addEventListener('click', () => {
        this.cpuUseStockfish = !this.cpuUseStockfish;
        this._updateCpuUI();
      });
    }

    // Per-color skill sliders
    const sfSkillWhiteSlider = document.getElementById('cpu-stockfish-skill-white') as HTMLInputElement | null;
    const sfSkillWhiteValue = document.getElementById('cpu-stockfish-skill-white-value');
    if (sfSkillWhiteSlider) {
      sfSkillWhiteSlider.addEventListener('input', () => {
        const val = parseInt(sfSkillWhiteSlider.value);
        this.setStockfishSkillWhite(val);
        if (sfSkillWhiteValue) {
          sfSkillWhiteValue.textContent = val.toString();
        }
      });
    }

    const sfSkillBlackSlider = document.getElementById('cpu-stockfish-skill-black') as HTMLInputElement | null;
    const sfSkillBlackValue = document.getElementById('cpu-stockfish-skill-black-value');
    if (sfSkillBlackSlider) {
      sfSkillBlackSlider.addEventListener('input', () => {
        const val = parseInt(sfSkillBlackSlider.value);
        this.setStockfishSkillBlack(val);
        if (sfSkillBlackValue) {
          sfSkillBlackValue.textContent = val.toString();
        }
      });
    }

    const sfDepthSlider = document.getElementById('cpu-stockfish-depth') as HTMLInputElement | null;
    const sfDepthValue = document.getElementById('cpu-stockfish-depth-value');
    if (sfDepthSlider) {
      sfDepthSlider.addEventListener('input', () => {
        const val = parseInt(sfDepthSlider.value);
        this.setStockfishDepth(val);
        if (sfDepthValue) {
          sfDepthValue.textContent = val.toString();
        }
      });
    }
  }

  /* -- Command Input for Programmatic Testing -- */
  private _setupCommandInput(): void {
    const input = document.getElementById('command-input') as HTMLInputElement | null;
    const output = document.getElementById('command-output');
    if (!input || !output) return;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = input.value.trim().toLowerCase();
        const result = this._executeCommand(cmd);
        output.textContent = result.message;
        output.classList.add('visible');
        output.classList.toggle('error', !result.success);
        if (result.success) {
          input.value = '';
        }
      }
    });
  }

  /* -- Sidebar Resize -- */
  private _setupSidebarResize(): void {
    const sidebar = document.getElementById('sidebar');
    const resizeHandle = document.getElementById('sidebar-resize');
    if (!sidebar || !resizeHandle) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isResizing) return;
      const diff = startX - e.clientX; // Negative because sidebar is on right
      // Constrain to sensible limits based on viewport
      const maxWidth = Math.min(500, window.innerWidth * 0.5);
      const minWidth = 180;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + diff));
      sidebar.style.width = newWidth + 'px';
      sidebar.style.minWidth = newWidth + 'px';
      sidebar.style.maxWidth = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
      }
    });
  }

  /* -- Timeline Panel Resize and Collapse -- */
  private _setupTimelinePanel(): void {
    const panel = document.getElementById('timeline-panel');
    const header = document.getElementById('timeline-header');
    const resizeHandle = document.getElementById('timeline-resize');
    if (!panel || !header) return;

    // Collapse/expand on header click
    header.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });

    // Resize functionality
    if (!resizeHandle) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = panel.offsetHeight;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isResizing) return;
      const diff = e.clientY - startY;
      // Constrain to sensible limits
      const maxHeight = 500;
      const minHeight = 60;
      const newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + diff));
      panel.style.maxHeight = newHeight + 'px';
      // Update timeline-list max-height (panel height minus header height ~32px)
      const listEl = document.getElementById('timeline-list');
      if (listEl) {
        listEl.style.maxHeight = (newHeight - 32) + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
      }
    });
  }

  private _executeCommand(cmd: string): { success: boolean; message: string } {
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return { success: false, message: 'No active timeline' };

    // help command
    if (cmd === 'help') {
      return {
        success: true,
        message: `Commands:
e2e4 - make move (from-to)
fen - show current FEN
select e2 - select square
timetravel N - travel to turn N
switch N - switch to timeline N
reset - new game
timelines - list timelines`,
      };
    }

    // fen command
    if (cmd === 'fen') {
      return { success: true, message: tl.chess.fen() };
    }

    // reset command
    if (cmd === 'reset') {
      this.reset();
      return { success: true, message: 'Game reset' };
    }

    // timelines command
    if (cmd === 'timelines') {
      const tlList = Object.keys(this.timelines).map(id => {
        const t = this.timelines[parseInt(id)];
        return `${id}: ${t.name} (${t.moveHistory.length} moves)`;
      }).join('\n');
      return { success: true, message: tlList };
    }

    // switch N command
    const switchMatch = cmd.match(/^switch\s+(\d+)$/);
    if (switchMatch) {
      const tlId = parseInt(switchMatch[1]);
      if (this.timelines[tlId]) {
        this.setActiveTimeline(tlId);
        return { success: true, message: `Switched to timeline ${tlId}` };
      }
      return { success: false, message: `Timeline ${tlId} not found` };
    }

    // select SQ command
    const selectMatch = cmd.match(/^select\s+([a-h][1-8])$/);
    if (selectMatch) {
      const sq = selectMatch[1];
      this._handleBoardClick(this.activeTimelineId, sq);
      return { success: true, message: `Selected ${sq}` };
    }

    // timetravel N command
    const ttMatch = cmd.match(/^timetravel\s+(\d+)$/);
    if (ttMatch) {
      const turnIdx = parseInt(ttMatch[1]);
      if (!this.timeTravelSelection) {
        return { success: false, message: 'Select a queen first with time travel targets' };
      }
      const target = this.timeTravelSelection.validTargets.find(t => t.targetTurnIndex === turnIdx);
      if (!target) {
        return { success: false, message: `No time travel target at turn ${turnIdx}` };
      }
      this._makeTimeTravelMove(
        this.timeTravelSelection.sourceTimelineId,
        this.timeTravelSelection.sourceSquare,
        target.targetTurnIndex,
        this.timeTravelSelection.piece,
        target.isCapture ? target.capturedPiece : null
      );
      return { success: true, message: `Time traveled to turn ${turnIdx}` };
    }

    // move command (e2e4 format)
    const moveMatch = cmd.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (moveMatch) {
      const from = moveMatch[1];
      const to = moveMatch[2];
      const promotion = moveMatch[3] as PieceType | undefined;

      const moves = tl.chess.moves({ verbose: true }) as ChessMove[];
      const move = moves.find(m => m.from === from && m.to === to);
      if (!move) {
        return { success: false, message: `Invalid move: ${from}-${to}` };
      }
      this.makeMove(this.activeTimelineId, move, promotion);
      return { success: true, message: `Moved ${from}-${to}` };
    }

    return { success: false, message: `Unknown command: ${cmd}. Type 'help' for commands.` };
  }

  private _updateMoveSlider(): void {
    const slider = document.getElementById('move-slider') as HTMLInputElement | null;
    const label = document.getElementById('move-slider-label');
    const tl = this.timelines[this.activeTimelineId];
    if (!tl || !slider || !label) return;

    const totalMoves = tl.moveHistory.length;
    const currentMove = this.viewingMoveIndex !== null ? this.viewingMoveIndex : totalMoves;

    slider.max = String(totalMoves);
    slider.value = String(currentMove);
    label.textContent = 'Move ' + currentMove + '/' + totalMoves;

    // Visual indicator when not at current position
    if (this.viewingMoveIndex !== null && this.viewingMoveIndex < totalMoves) {
      label.classList.add('viewing-history');
    } else {
      label.classList.remove('viewing-history');
    }
  }

  /* -- Navigation Methods -- */
  navigateMove(delta: number): void {
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;

    const totalMoves = tl.moveHistory.length;
    const currentMove = this.viewingMoveIndex !== null ? this.viewingMoveIndex : totalMoves;
    const newMove = Math.max(0, Math.min(totalMoves, currentMove + delta));

    this.goToMove(newMove);
  }

  goToMove(moveIndex: number): void {
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;

    const totalMoves = tl.moveHistory.length;

    // -1 means go to last move (current position)
    if (moveIndex === -1) moveIndex = totalMoves;

    // Clamp to valid range
    moveIndex = Math.max(0, Math.min(totalMoves, moveIndex));

    // If at current position, clear viewing mode
    if (moveIndex === totalMoves) {
      this.viewingMoveIndex = null;
      this.renderTimeline(this.activeTimelineId);
    } else {
      this.viewingMoveIndex = moveIndex;
      // Render the board at that snapshot
      const snapshot = tl.snapshots[moveIndex];
      const board = this._getSnapshotBoard(snapshot);
      Board3D.getTimeline(this.activeTimelineId)?.render(board);
    }

    this._updateMoveSlider();
    this.updateStatus();
    this._highlightCurrentMoveInList();
  }

  private _highlightCurrentMoveInList(): void {
    const movesEl = document.getElementById('moves');
    if (!movesEl) return;
    const pairs = movesEl.querySelectorAll('.move-pair');
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;

    const totalMoves = tl.moveHistory.length;
    const viewingMove = this.viewingMoveIndex !== null ? this.viewingMoveIndex : totalMoves;

    pairs.forEach((pair, idx) => {
      const pairStartMove = idx * 2 + 1; // Move 1 is at pair 0
      const pairEndMove = idx * 2 + 2;

      if (viewingMove >= pairStartMove && viewingMove <= pairEndMove) {
        pair.classList.add('current-move');
      } else if (viewingMove < pairStartMove) {
        pair.classList.add('future-move');
      } else {
        pair.classList.remove('current-move', 'future-move');
      }
    });
  }

  cycleTimeline(direction: number): void {
    const ids = Object.keys(this.timelines).map(Number).sort((a, b) => a - b);
    if (ids.length <= 1) return;

    const currentIdx = ids.indexOf(this.activeTimelineId);
    const newIdx = (currentIdx + direction + ids.length) % ids.length;
    this.setActiveTimeline(ids[newIdx]);
  }

  flipBoard(): void {
    // Toggle camera position to flip perspective
    if (Board3D.controls && Board3D.camera) {
      const camera = Board3D.camera;
      const target = Board3D.controls.target;

      // Rotate camera 180 degrees around the Y axis relative to target
      const dx = camera.position.x - target.x;
      const dz = camera.position.z - target.z;

      camera.position.x = target.x - dx;
      camera.position.z = target.z - dz;

      Board3D.controls.update();
    }
  }

  focusActiveTimeline(): void {
    Board3D.focusTimeline(this.activeTimelineId, true);
  }

  resetCameraView(): void {
    // Reset to default camera position centered on active timeline
    const tl = this.timelines[this.activeTimelineId];
    const targetX = tl ? tl.xOffset : 0;

    if (Board3D.camera && Board3D.controls) {
      Board3D.camera.position.set(targetX, 14, 12);
      Board3D.controls.target.set(targetX, 0, 0);
      Board3D.controls.update();
    }
  }

  /* -- Timeline management -- */
  private _createTimeline(
    id: number,
    xOffset: number,
    parentId: number | null,
    branchTurn: number,
    initialFen: string | null
  ): TimelineData {
    let chess: ChessInstance;
    if (initialFen) {
      chess = new Chess();
      const loaded = chess.load(initialFen);
      if (!loaded) {
        console.error('[_createTimeline] MISSING_BOARD_BUG: Failed to load FEN:', initialFen, {
          timelineId: id,
          parentId,
          branchTurn,
        });
        // Fallback to starting position
        chess = new Chess();
      }
    } else {
      chess = new Chess();
    }

    // Validate we have a valid board
    const board = chess.board();
    let pieceCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r] && board[r][c]) pieceCount++;
      }
    }
    // TURN DEBUG: Log timeline creation with turn state
    const fen = chess.fen();
    const turnFromFen = fen.split(' ')[1];
    console.log('[TURN_DEBUG] _createTimeline:', {
      timelineId: id,
      parentId,
      branchTurn,
      fen,
      turnFromFen,
      turnFromChess: chess.turn(),
      pieceCount,
      xOffset,
    });
    console.log('[_createTimeline] Created timeline', id, 'with', pieceCount, 'pieces', {
      fen: chess.fen(),
      xOffset,
    });

    const tlData: TimelineData = {
      id,
      chess,
      moveHistory: [],
      snapshots: [],
      parentId,
      branchTurn,
      xOffset,
      name: parentId === null ? 'Main' : 'Branch ' + id,
    };

    this.timelines[id] = tlData;

    // Take initial snapshot
    this.timelines[id].snapshots.push(this._cloneBoard(chess));

    Board3D.createTimeline(id, xOffset);

    // If in 2D mode, refresh the grid to include the new timeline
    if (Board3D.is2DMode()) {
      Board3D.set2DMode(false);
      Board3D.set2DMode(true);
    }

    return this.timelines[id];
  }

  getTimeline(id: number): TimelineData | undefined {
    return this.timelines[id];
  }

  setActiveTimeline(id: number, autoFocus: boolean = true): void {
    const previousId = this.activeTimelineId;
    const prevTl = this.timelines[previousId];
    const newTl = this.timelines[id];

    // TURN DEBUG: Log timeline switch
    console.log('[TURN_DEBUG] setActiveTimeline:', {
      previousTimelineId: previousId,
      previousTimelineName: prevTl?.name,
      previousTurn: prevTl?.chess.turn(),
      previousFen: prevTl?.chess.fen(),
      newTimelineId: id,
      newTimelineName: newTl?.name,
      newTurn: newTl?.chess.turn(),
      newFen: newTl?.chess.fen(),
    });

    this.activeTimelineId = id;
    this.viewingMoveIndex = null; // Reset to current position when switching timelines
    Board3D.setActiveTimeline(id);
    this.clearSelection();
    this.updateStatus();
    this.updateMoveList();
    this.updateTimelineList();

    // Setup collapsible shortcuts panel
    this._setupCollapsibleShortcuts();
    this._updateMoveSlider();

    // Auto-focus on the new timeline with animation (if switching timelines and autoFocus enabled)
    if (autoFocus && previousId !== id) {
      Board3D.focusTimeline(id, true);
    }
  }

  /* -- Click handling -- */
  handleClick(info: SquareClickInfo): void {
    // RACE CONDITION PREVENTION: Ignore clicks while CPU move is pending execution
    // This prevents user interaction from interfering with the pending move's render cycle
    if (this.cpuPendingMove) {
      console.log('[handleClick] Ignoring click - CPU move pending');
      return;
    }

    const tlId = info.timelineId;
    const sq = info.square;
    const isHistory = info.isHistory;
    const turn = info.turn;

    // Check for time travel portal click (clicking history board with time travel active)
    if (isHistory && this.timeTravelSelection) {
      const target = this.timeTravelSelection.validTargets.find(
        (t) => t.sourceTimelineId === tlId && t.targetTurnIndex === turn && t.targetSquare === sq
      );
      if (target) {
        // Execute time travel move!
        this._makeTimeTravelMove(
          this.timeTravelSelection.sourceTimelineId,
          this.timeTravelSelection.sourceSquare,
          target.targetTurnIndex,
          this.timeTravelSelection.piece,
          target.isCapture ? target.capturedPiece : null
        );
        return;
      }
    }

    // Clicking on a history board without valid time travel target -> do nothing
    if (isHistory) {
      this._handleHistoryClick(tlId, turn, sq);
      return;
    }

    // Check for cross-timeline move first
    if (this.crossTimelineSelection && tlId !== this.crossTimelineSelection.sourceTimelineId) {
      // Check if this is a valid cross-timeline target
      const target = this.crossTimelineSelection.validTargets.find(
        (t) => t.targetTimelineId === tlId && t.targetSquare === sq
      );
      if (target) {
        // Execute cross-timeline move!
        this.makeCrossTimelineMove(
          this.crossTimelineSelection.sourceTimelineId,
          tlId,
          sq as Square,
          this.crossTimelineSelection.piece
        );
        return;
      }
      // Clicked on a different timeline but not a valid target - clear selection
      this.clearSelection();
    }

    // Clicking on a non-active timeline's current board -> switch to it
    if (tlId !== this.activeTimelineId) {
      this.setActiveTimeline(tlId);
    }

    // Normal board interaction on active timeline
    this._handleBoardClick(tlId, sq);
  }

  private _handleBoardClick(tlId: number, sq: string): void {
    const tl = this.timelines[tlId];
    if (!tl) return;
    const chess = tl.chess;
    const piece = chess.get(sq);
    const col = Board3D.getTimeline(tlId);
    if (!col) return;

    // TURN DEBUG: Log click context
    console.log('[TURN_DEBUG] _handleBoardClick:', {
      timelineId: tlId,
      timelineName: tl.name,
      activeTimelineId: this.activeTimelineId,
      clickedSquare: sq,
      pieceAtSquare: piece ? { type: piece.type, color: piece.color } : null,
      chessTurn: chess.turn(),
      fen: chess.fen(),
      currentSelection: this.selected,
      selectedTimelineId: this.selectedTimelineId,
    });

    if (this.selected && this.selectedTimelineId === tlId) {
      // Try to make a move
      const moves = chess.moves({ square: this.selected, verbose: true }) as ChessMove[];
      let targetMove: ChessMove | null = null;
      for (let i = 0; i < moves.length; i++) {
        if (moves[i].to === sq) {
          targetMove = moves[i];
          break;
        }
      }

      if (targetMove) {
        // TURN DEBUG: Log before attempting move
        const selectedPiece = chess.get(this.selected);
        console.log('[TURN_DEBUG] About to make move:', {
          timelineId: tlId,
          timelineName: tl.name,
          from: this.selected,
          to: sq,
          selectedPiece: selectedPiece ? { type: selectedPiece.type, color: selectedPiece.color } : null,
          chessTurn: chess.turn(),
          turnMismatch: selectedPiece && selectedPiece.color !== chess.turn(),
        });
        this.makeMove(tlId, targetMove);
        return;
      }

      if (sq === this.selected) {
        this.clearSelection();
        return;
      }
    }

    if (piece && piece.color === chess.turn()) {
      // TURN DEBUG: Log piece selection
      console.log('[TURN_DEBUG] Selecting piece (color matches turn):', {
        timelineId: tlId,
        timelineName: tl.name,
        square: sq,
        piece: { type: piece.type, color: piece.color },
        chessTurn: chess.turn(),
      });
      this.clearSelection();
      this.selected = sq;
      this.selectedTimelineId = tlId;
      const legalMoves = chess.moves({ square: sq, verbose: true }) as ChessMove[];
      col.select(sq);
      col.showLegalMoves(legalMoves, chess.board());

      // Check for cross-timeline movement capability
      if (this.canMoveCrossTimeline(piece.type)) {
        const crossTargets = this.getCrossTimelineTargets(tlId, sq as Square, piece);
        if (crossTargets.length > 0) {
          this.crossTimelineSelection = {
            sourceTimelineId: tlId,
            sourceSquare: sq as Square,
            piece,
            validTargets: crossTargets,
          };
          // Show cross-timeline targets in other timelines
          this._showCrossTimelineTargets(crossTargets);
        }

        // Check for time travel capability (queen moving backward in time)
        const timeTravelTargets = this._getTimeTravelTargets(tlId, sq as Square, piece);
        if (timeTravelTargets.length > 0) {
          this.timeTravelSelection = {
            sourceTimelineId: tlId,
            sourceSquare: sq as Square,
            piece,
            validTargets: timeTravelTargets,
          };
          // Show time travel portal targets on history boards
          this._showTimeTravelTargets(timeTravelTargets);
        }
      }
    } else {
      // TURN DEBUG: Log when piece selection is rejected (wrong color or empty square)
      if (piece) {
        console.log('[TURN_DEBUG] Selection REJECTED - wrong color:', {
          timelineId: tlId,
          timelineName: tl.name,
          square: sq,
          pieceColor: piece.color,
          chessTurn: chess.turn(),
          fen: chess.fen(),
          reason: `Piece is ${piece.color === 'w' ? 'white' : 'black'} but it's ${chess.turn() === 'w' ? 'white' : 'black'}'s turn`,
        });
      }
      this.clearSelection();
    }
  }

  private _handleHistoryClick(tlId: number, turnIndex: number, sq: string): void {
    // History boards are read-only views
    // Timeline forking only happens via queen time travel moves
    // (clicking a time travel portal target, not directly clicking history)
    return;
  }

  private _forkTimeline(parentTlId: number, snapshotIdx: number, selectedSq: string): void {
    const parentTl = this.timelines[parentTlId];
    const snapshot = parentTl.snapshots[snapshotIdx];

    // Get FEN from snapshot if available (new format), otherwise replay moves
    let fen = this._getSnapshotFen(snapshot);
    if (!fen) {
      // Fallback: Rebuild the FEN by replaying moves (for old snapshots without FEN)
      const forkChess = new Chess();
      for (let i = 0; i < snapshotIdx; i++) {
        if (i < parentTl.moveHistory.length) {
          const histMove = parentTl.moveHistory[i];
          const moveObj: { from: string; to: string; promotion?: PieceType } = {
            from: histMove.from,
            to: histMove.to,
          };
          // Use the actual promotion piece that was played
          if (histMove.promotion) {
            moveObj.promotion = histMove.promotion;
          }
          forkChess.move(moveObj);
        }
      }
      fen = forkChess.fen();
    }

    const newId = this.nextTimelineId++;

    // Calculate x offset: alternate left/right of parent
    // Use sibling count (children of same parent) instead of total timeline count
    // to prevent exponential spacing growth
    const siblingCount = Object.values(this.timelines)
      .filter(tl => tl.parentId === parentTlId).length;
    const side = siblingCount % 2 === 0 ? 1 : -1;
    let xOffset = parentTl.xOffset + side * Board3D.TIMELINE_SPACING * Math.ceil((siblingCount + 1) / 2);

    // OVERLAP DETECTION: Check if any existing timeline has this xOffset
    const existingOffsets = Object.values(this.timelines).map(tl => tl.xOffset);
    if (existingOffsets.includes(xOffset)) {
      console.error('[BOARD_OVERLAP_BUG] Timeline xOffset collision detected!', {
        newTimelineId: newId,
        calculatedXOffset: xOffset,
        parentId: parentTlId,
        siblingCount,
        side,
        existingOffsets,
        allTimelines: Object.values(this.timelines).map(tl => ({
          id: tl.id,
          xOffset: tl.xOffset,
          parentId: tl.parentId,
        })),
      });
      // FIX: Find a unique position by incrementing until we find an unused slot
      const spacing = Board3D.TIMELINE_SPACING;
      let attempts = 0;
      while (existingOffsets.includes(xOffset) && attempts < 100) {
        // Try alternating left/right with increasing distance
        attempts++;
        const distance = Math.ceil(attempts / 2) * spacing;
        xOffset = parentTl.xOffset + (attempts % 2 === 0 ? 1 : -1) * distance;
      }
      console.log('[BOARD_OVERLAP_FIX] Found unique xOffset after collision:', {
        newTimelineId: newId,
        finalXOffset: xOffset,
        attempts,
      });
    }

    // DEBUG: Log all timeline positions for visibility
    console.log('[TIMELINE_POSITIONS] Creating timeline with position:', {
      newTimelineId: newId,
      xOffset,
      parentId: parentTlId,
      siblingCount,
      side,
      allPositions: Object.values(this.timelines).map(tl => ({
        id: tl.id,
        xOffset: tl.xOffset,
        name: tl.name,
      })),
    });

    const newTl = this._createTimeline(newId, xOffset, parentTlId, snapshotIdx, fen);

    // Copy snapshots up to the fork point
    newTl.snapshots = [];
    for (let s = 0; s <= snapshotIdx; s++) {
      newTl.snapshots.push(this._deepCloneSnapshot(parentTl.snapshots[s]));
    }

    // Replay the corresponding move history up to fork point
    // (snapshots has snapshotIdx+1 entries, so moveHistory needs snapshotIdx entries)
    newTl.moveHistory = [];
    for (let m = 0; m < snapshotIdx; m++) {
      if (m < parentTl.moveHistory.length) {
        newTl.moveHistory.push(JSON.parse(JSON.stringify(parentTl.moveHistory[m])));
      }
    }

    // Validate snapshot consistency on the new timeline
    this._validateSnapshotConsistency(newTl);

    // Add snapshots as history layers on the new timeline visual
    // (skip index 0 = initial state, add pairs as before-move states)
    const newCol = Board3D.getTimeline(newId);
    if (newCol) {
      for (let h = newTl.moveHistory.length - 1; h >= 0; h--) {
        const mv = newTl.moveHistory[h];
        const boardBefore = this._getSnapshotBoard(newTl.snapshots[h]);
        newCol.addSnapshot(boardBefore, mv.from, mv.to, mv.isWhite);
      }
    }

    // Add branch connection line
    Board3D.addBranchLine(
      parentTlId,
      Math.max(0, parentTl.moveHistory.length - snapshotIdx - 1),
      newId
    );

    // Switch to the new timeline (respect camera follow setting for CPU mode)
    const shouldFocus = !this.cpuEnabled || this.cpuCameraFollow;
    this.setActiveTimeline(newId, shouldFocus);
    this.renderTimeline(newId);

    // Auto-select the piece on the new timeline
    this.selected = selectedSq;
    this.selectedTimelineId = newId;
    const col = Board3D.getTimeline(newId);
    if (col) {
      const legalMoves = newTl.chess.moves({ square: selectedSq, verbose: true }) as ChessMove[];
      col.select(selectedSq);
      col.showLegalMoves(legalMoves, newTl.chess.board());
    }

    this.updateTimelineList();

    // Setup collapsible shortcuts panel
    this._setupCollapsibleShortcuts();
  }

  /* -- Move execution -- */
  makeMove(tlId: number, move: ChessMove, promotionPiece?: PieceType): void {
    const tl = this.timelines[tlId];
    if (!tl) return;

    // Clear history viewing mode when a move is made - ensures render uses current state
    if (this.viewingMoveIndex !== null && tlId === this.activeTimelineId) {
      this.viewingMoveIndex = null;
    }

    const chess = tl.chess;
    const isWhite = chess.turn() === 'w';

    // TURN DEBUG: Log FEN and turn state BEFORE the move
    const fenBefore = chess.fen();
    const turnFromFenBefore = fenBefore.split(' ')[1]; // 'w' or 'b'
    const pieceBeingMoved = chess.get(move.from);
    const pieceColor = pieceBeingMoved?.color || 'unknown';

    console.log('[TURN_DEBUG] makeMove ENTRY:', {
      timelineId: tlId,
      timelineName: tl.name,
      fenBefore,
      turnFromFen: turnFromFenBefore,
      turnFromChess: chess.turn(),
      pieceColor,
      pieceType: pieceBeingMoved?.type || 'none',
      moveFrom: move.from,
      moveTo: move.to,
      moveSan: move.san,
      moveHistoryLength: tl.moveHistory.length,
      snapshotsLength: tl.snapshots.length,
    });

    // TURN DEBUG: Flag mismatch between turn and piece color
    if (pieceBeingMoved && pieceColor !== chess.turn()) {
      console.error('[TURN_DEBUG] MISMATCH! Piece color does not match whose turn it is:', {
        timelineId: tlId,
        timelineName: tl.name,
        expectedTurn: chess.turn(),
        actualPieceColor: pieceColor,
        fen: fenBefore,
        move: `${move.from}-${move.to}`,
      });
    }

    // Check if this is a pawn promotion move that needs user input
    if (move.flags && move.flags.indexOf('p') !== -1 && !promotionPiece) {
      // Show promotion picker and wait for user choice
      this.pendingPromotion = { tlId, move };
      this._showPromotionPicker(tlId, move.to, isWhite);
      return;
    }

    const boardBefore = this._cloneBoard(chess);

    // Use the provided promotion piece, or default to queen for non-promotion moves
    const moveObj: { from: string; to: string; promotion?: PieceType } = {
      from: move.from,
      to: move.to,
    };
    if (move.flags && move.flags.indexOf('p') !== -1) {
      moveObj.promotion = promotionPiece || 'q';
    }

    const result = chess.move(moveObj);
    if (!result) {
      console.error('Invalid move:', moveObj);
      return;
    }

    // TURN DEBUG: Log FEN and turn state AFTER the move
    const fenAfter = chess.fen();
    const turnFromFenAfter = fenAfter.split(' ')[1];
    console.log('[TURN_DEBUG] makeMove AFTER chess.move():', {
      timelineId: tlId,
      timelineName: tl.name,
      fenAfter,
      turnFromFenAfter,
      turnFromChess: chess.turn(),
      resultSan: result.san,
      capturedPiece: result.captured || 'none',
    });

    // Store the actual promotion piece used (if any)
    // Use result.captured (actual move result) instead of move.captured (potential move)
    tl.moveHistory.push({
      from: move.from as Move['from'],
      to: move.to as Move['to'],
      piece: move.piece,
      captured: result.captured || null,
      san: result.san,
      isWhite,
      promotion: result.promotion || null,
    });

    tl.snapshots.push(this._cloneBoard(chess));

    // Validate snapshot/moveHistory consistency
    this._validateSnapshotConsistency(tl);

    const col = Board3D.getTimeline(tlId);
    if (col) {
      col.addSnapshot(this._getSnapshotBoard(boardBefore), move.from, move.to, isWhite);
      col.addMoveLine(move.from, move.to, isWhite);
      col.showLastMove(move.from, move.to);
    }

    // Notify that snapshot was added - triggers branch line rebuild
    Board3D.notifySnapshotAdded(tlId);

    // Spawn capture effect if this was a capture
    if (result.captured) {
      Board3D.spawnCaptureEffect(tlId, move.to);
    }

    console.log('[makeMove] VISUAL_TRAILS_DEBUG: About to render after move', {
      timestamp: Date.now(),
      timelineId: tlId,
      move: move.san || `${move.from}-${move.to}`,
    });
    this.clearSelection();
    this.renderTimeline(tlId);
    console.log('[makeMove] VISUAL_TRAILS_DEBUG: Render complete', {
      timestamp: Date.now(),
    });
    this.updateStatus();
    this.updateMoveList();
    this.updateTimelineList();

    // Setup collapsible shortcuts panel
    this._setupCollapsibleShortcuts();
    this._updateMoveSlider();
  }

  /* -- Cross-Timeline Movement -- */

  /** Check if a piece type can move across timelines (all pieces except King) */
  private canMoveCrossTimeline(pieceType: PieceType): boolean {
    // All pieces except King can cross timelines
    // King cannot leave its board - would break check/checkmate logic
    return pieceType !== 'k';
  }

  /** Check if a timeline is finished (checkmate, stalemate, or draw) */
  private isTimelineFinished(tl: TimelineData): boolean {
    return tl.chess.in_checkmate() || tl.chess.in_stalemate() || tl.chess.in_draw();
  }

  /** Get all valid cross-timeline targets for a piece */
  private getCrossTimelineTargets(
    sourceTimelineId: number,
    square: Square,
    piece: Piece
  ): CrossTimelineMoveTarget[] {
    if (!this.canMoveCrossTimeline(piece.type)) {
      return [];
    }

    const sourceTl = this.timelines[sourceTimelineId];
    if (!sourceTl) return [];

    const sourceMoveCount = sourceTl.moveHistory.length;
    const sourceColor = piece.color;
    const targets: CrossTimelineMoveTarget[] = [];

    // Check all other timelines
    for (const tlIdStr in this.timelines) {
      const tlId = parseInt(tlIdStr);
      if (tlId === sourceTimelineId) continue;

      const targetTl = this.timelines[tlId];
      if (!targetTl) continue;

      // Rule: Cannot move to a finished timeline (checkmate/stalemate/draw)
      if (this.isTimelineFinished(targetTl)) continue;

      // Rule: Can only move to timeline where it's your turn
      if (targetTl.chess.turn() !== sourceColor) continue;

      // Rule: Cross-timeline move counts in both timelines,
      // so both must be at same move count (synced)
      if (targetTl.moveHistory.length !== sourceMoveCount) continue;

      // Check the same square in the target timeline
      const targetPiece = targetTl.chess.get(square);

      // Can't move if own piece is there
      if (targetPiece && targetPiece.color === sourceColor) continue;

      // CANNOT capture kings - that would break the game
      if (targetPiece && targetPiece.type === 'k') continue;

      // Valid target!
      targets.push({
        targetTimelineId: tlId,
        targetSquare: square,
        isCapture: targetPiece !== null,
        capturedPiece: targetPiece,
      });
    }

    return targets;
  }

  /** Execute a cross-timeline move */
  private makeCrossTimelineMove(
    sourceTimelineId: number,
    targetTimelineId: number,
    square: Square,
    piece: Piece
  ): void {
    const sourceTl = this.timelines[sourceTimelineId];
    const targetTl = this.timelines[targetTimelineId];
    if (!sourceTl || !targetTl) return;

    // SAFETY CHECK: Cannot move to a finished timeline
    if (this.isTimelineFinished(targetTl)) {
      console.error('[Cross-Timeline] Target timeline is finished (checkmate/stalemate/draw), blocking move', {
        targetTimelineId,
        inCheckmate: targetTl.chess.in_checkmate(),
        inStalemate: targetTl.chess.in_stalemate(),
        inDraw: targetTl.chess.in_draw(),
      });
      return;
    }

    // RACE CONDITION CHECK: Re-validate move count synchronization
    // Cross-timeline moves require both timelines to have the same move count
    if (sourceTl.moveHistory.length !== targetTl.moveHistory.length) {
      console.error('[Cross-Timeline] RACE CONDITION DETECTED: Move count mismatch!', {
        sourceTimelineId,
        sourceMoves: sourceTl.moveHistory.length,
        targetTimelineId,
        targetMoves: targetTl.moveHistory.length,
      });
      return;
    }

    // RACE CONDITION CHECK: Re-validate turn synchronization
    // Both timelines must be on the same color's turn
    if (sourceTl.chess.turn() !== targetTl.chess.turn()) {
      console.error('[Cross-Timeline] RACE CONDITION DETECTED: Turn mismatch!', {
        sourceTimelineId,
        sourceTurn: sourceTl.chess.turn(),
        targetTimelineId,
        targetTurn: targetTl.chess.turn(),
      });
      return;
    }

    const isWhite = piece.color === 'w';
    const targetPiece = targetTl.chess.get(square);

    // RACE CONDITION CHECK: Validate it's this piece's color's turn
    if ((isWhite && sourceTl.chess.turn() !== 'w') || (!isWhite && sourceTl.chess.turn() !== 'b')) {
      console.error('[Cross-Timeline] RACE CONDITION DETECTED: Not this color turn!', {
        pieceColor: piece.color,
        currentTurn: sourceTl.chess.turn(),
      });
      return;
    }

    // TURN DEBUG: Log cross-timeline move entry
    console.log('[TURN_DEBUG] makeCrossTimelineMove ENTRY:', {
      sourceTimelineId,
      sourceTimelineName: sourceTl.name,
      sourceFen: sourceTl.chess.fen(),
      sourceTurn: sourceTl.chess.turn(),
      targetTimelineId,
      targetTimelineName: targetTl.name,
      targetFen: targetTl.chess.fen(),
      targetTurn: targetTl.chess.turn(),
      square,
      piece: { type: piece.type, color: piece.color },
      pieceIsWhite: isWhite,
      targetPiece: targetPiece ? { type: targetPiece.type, color: targetPiece.color } : null,
    });

    // Clone boards before move for snapshots
    const sourceBoardBefore = this._cloneBoard(sourceTl.chess);
    const targetBoardBefore = this._cloneBoard(targetTl.chess);

    // 1. Remove piece from source timeline
    // Load FEN, modify board, reload
    const sourceFen = sourceTl.chess.fen();
    const sourceBoard = sourceTl.chess.board();
    const pos = this._fromSq(square);

    // Verify piece exists on source before removal
    const sourcePieceCheck = sourceTl.chess.get(square);
    if (!sourcePieceCheck || sourcePieceCheck.type !== piece.type || sourcePieceCheck.color !== piece.color) {
      console.error('[Cross-Timeline] Source piece mismatch!', {
        expected: piece,
        actual: sourcePieceCheck,
        square,
      });
      throw new Error(`Cross-timeline move failed: source piece mismatch at ${square}`);
    }

    // Build new FEN without the piece
    // For simplicity, we set the square to empty and flip turn
    // Source: piece left, no capture on source timeline
    // skipSelfCheckValidation=true because the piece is LEAVING (check validation happens on target)
    const newSourceFen = this._modifyFen(sourceFen, square, null, !isWhite, false, true);
    const sourceLoadResult = sourceTl.chess.load(newSourceFen);
    if (!sourceLoadResult) {
      console.error('[Cross-Timeline] Failed to load source FEN after remove!', { fen: newSourceFen });
      throw new Error(`Cross-timeline move failed: invalid source FEN after piece removal`);
    }

    // Validate remove worked - piece should no longer be there
    const afterRemove = sourceTl.chess.get(square);
    if (afterRemove) {
      console.error('[Cross-Timeline] Piece still present after removal!', {
        square,
        stillThere: afterRemove,
      });
      throw new Error(`Cross-timeline move failed: piece still present at ${square} after removal`);
    }

    // 2. Add piece to target timeline (capture if enemy piece there)
    const targetFen = targetTl.chess.fen();
    const isCrossCapture = targetPiece !== null;
    const newTargetFen = this._modifyFen(targetFen, square, piece, !isWhite, isCrossCapture);
    const targetLoadResult = targetTl.chess.load(newTargetFen);
    if (!targetLoadResult) {
      console.error('[Cross-Timeline] Failed to load target FEN after placement!', { fen: newTargetFen });
      throw new Error(`Cross-timeline move failed: invalid target FEN after piece placement`);
    }

    // Validate placement worked - piece should now be there
    const afterPlace = targetTl.chess.get(square);
    if (!afterPlace || afterPlace.type !== piece.type || afterPlace.color !== piece.color) {
      console.error('[Cross-Timeline] Piece placement verification failed!', {
        expected: piece,
        actual: afterPlace,
        square,
      });
      throw new Error(`Cross-timeline move failed: piece not found at ${square} after placement`);
    }

    // 3. Record the move in both timelines
    // Use actual piece character (not hardcoded Q) for future extensibility
    const pieceChar = piece.type.toUpperCase();
    const crossMove: Move = {
      from: square,
      to: square,
      piece: piece.type,
      captured: targetPiece?.type || null,
      san: `${pieceChar}${square}→T${targetTimelineId}`,  // Custom notation for cross-timeline
      isWhite,
    };

    // Source timeline: piece left
    sourceTl.moveHistory.push({
      ...crossMove,
      san: `${pieceChar}${square}→T${targetTimelineId}`,
    });
    sourceTl.snapshots.push(this._cloneBoard(sourceTl.chess));

    // Target timeline: piece arrived (possibly captured)
    targetTl.moveHistory.push({
      ...crossMove,
      san: `${pieceChar}${square}←T${sourceTimelineId}`,
    });
    targetTl.snapshots.push(this._cloneBoard(targetTl.chess));

    // 4. Update 3D visualization
    const sourceCol = Board3D.getTimeline(sourceTimelineId);
    const targetCol = Board3D.getTimeline(targetTimelineId);

    if (sourceCol) {
      sourceCol.addSnapshot(this._getSnapshotBoard(sourceBoardBefore), square, square, isWhite);
      sourceCol.showLastMove(square, square);
    }

    if (targetCol) {
      targetCol.addSnapshot(this._getSnapshotBoard(targetBoardBefore), square, square, isWhite);
      targetCol.showLastMove(square, square);
    }

    // Draw line between timelines to show the move
    Board3D.addCrossTimelineLine(sourceTimelineId, targetTimelineId, square, isWhite);

    // Notify that snapshots were added - triggers branch line rebuild
    Board3D.notifySnapshotAdded(sourceTimelineId);
    Board3D.notifySnapshotAdded(targetTimelineId);

    // Spawn capture effect on target timeline if capture occurred
    if (targetPiece) {
      Board3D.spawnCaptureEffect(targetTimelineId, square);
    }

    // TURN DEBUG: Log turn state after cross-timeline move completed
    console.log('[TURN_DEBUG] makeCrossTimelineMove AFTER:', {
      sourceTimelineId,
      sourceTimelineName: sourceTl.name,
      sourceFenAfter: sourceTl.chess.fen(),
      sourceTurnAfter: sourceTl.chess.turn(),
      targetTimelineId,
      targetTimelineName: targetTl.name,
      targetFenAfter: targetTl.chess.fen(),
      targetTurnAfter: targetTl.chess.turn(),
    });

    // 5. Update UI
    console.log('[crossTimeline] VISUAL_TRAILS_DEBUG: About to render after cross-timeline move', {
      timestamp: Date.now(),
      sourceTimelineId,
      targetTimelineId,
      square,
    });
    this.clearSelection();
    this.renderTimeline(sourceTimelineId);
    this.renderTimeline(targetTimelineId);

    // Validate no duplicate sprites after cross-timeline renders
    // This catches edge cases where sprites weren't properly cleaned up
    // Pass current board state so we can do a full rebuild if needed
    if (sourceCol) {
      sourceCol.validateNoDuplicates(sourceTl.chess.board());
    }
    if (targetCol) {
      targetCol.validateNoDuplicates(targetTl.chess.board());
    }

    console.log('[crossTimeline] VISUAL_TRAILS_DEBUG: Render complete', {
      timestamp: Date.now(),
    });
    this.updateStatus();
    this.updateMoveList();
    this.updateTimelineList();

    // Setup collapsible shortcuts panel
    this._setupCollapsibleShortcuts();
    this._updateMoveSlider();
  }

  /* -- Time Travel Movement (backward in time) -- */

  /** Get all valid time travel targets for a piece (moving backward in time) */
  private _getTimeTravelTargets(
    sourceTimelineId: number,
    square: Square,
    piece: Piece
  ): TimeTravelTarget[] {
    // Queens, Rooks, Bishops, and Knights can time travel
    const canTimeTravel = ['q', 'r', 'b', 'n'].includes(piece.type);
    if (!canTimeTravel) return [];

    const tl = this.timelines[sourceTimelineId];
    if (!tl) return [];

    // Need at least 2 snapshots (initial + at least 1 move) for time travel
    if (tl.snapshots.length < 2) return [];

    const targets: TimeTravelTarget[] = [];

    // Queen can travel to any previous board state where:
    // 1. The same square is empty OR occupied by enemy piece
    // 2. The snapshot represents a past state (not the current board)
    // We iterate snapshots from most recent to oldest (excluding current)
    for (let snapshotIdx = tl.snapshots.length - 2; snapshotIdx >= 0; snapshotIdx--) {
      const snapshot = tl.snapshots[snapshotIdx];
      const board = this._getSnapshotBoard(snapshot);
      const pos = this._fromSq(square);
      const targetPiece = board[pos.r][pos.c];

      // Can arrive if square is empty or has enemy piece (capture)
      // CANNOT capture kings - that would break the game
      if (!targetPiece || (targetPiece.color !== piece.color && targetPiece.type !== 'k')) {
        // turnIndex is relative to history layers (0 = most recent history)
        // Snapshot index 0 is initial state, snapshot length-1 is current
        // History layer 0 = snapshot at (length - 2), layer 1 = snapshot at (length - 3), etc.
        const turnIndex = tl.snapshots.length - 2 - snapshotIdx;
        targets.push({
          sourceTimelineId,
          targetTurnIndex: turnIndex,
          targetSquare: square,
          isCapture: targetPiece !== null,
          capturedPiece: targetPiece,
        });
      }
    }

    return targets;
  }

  /** Execute a time travel move - piece goes back in time, creating a new timeline */
  private _makeTimeTravelMove(
    sourceTimelineId: number,
    sourceSquare: Square,
    targetTurnIndex: number,
    piece: Piece,
    capturedPiece: Piece | null | undefined
  ): void {
    const sourceTl = this.timelines[sourceTimelineId];
    if (!sourceTl) return;

    // RACE CONDITION CHECK: Validate it's this piece's color's turn
    const isWhiteMoving = piece.color === 'w';
    if ((isWhiteMoving && sourceTl.chess.turn() !== 'w') || (!isWhiteMoving && sourceTl.chess.turn() !== 'b')) {
      console.error('[Time Travel] RACE CONDITION DETECTED: Not this color turn!', {
        pieceColor: piece.color,
        currentTurn: sourceTl.chess.turn(),
        sourceTimelineId,
      });
      return;
    }

    // TURN DEBUG: Log time travel move entry
    console.log('[TURN_DEBUG] _makeTimeTravelMove ENTRY:', {
      sourceTimelineId,
      sourceTimelineName: sourceTl.name,
      sourceFen: sourceTl.chess.fen(),
      sourceTurn: sourceTl.chess.turn(),
      sourceSquare,
      targetTurnIndex,
      piece: { type: piece.type, color: piece.color },
      capturedPiece: capturedPiece ? { type: capturedPiece.type, color: capturedPiece.color } : null,
    });

    // VALIDATION: Verify the piece actually exists at the source square
    const actualPiece = sourceTl.chess.get(sourceSquare);
    if (!actualPiece) {
      console.error('[Time Travel] ABORT: No piece at source square!', {
        sourceSquare,
        expectedPiece: piece,
        actualBoard: sourceTl.chess.fen(),
      });
      return;
    }
    if (actualPiece.type !== piece.type || actualPiece.color !== piece.color) {
      console.error('[Time Travel] ABORT: Piece mismatch at source!', {
        sourceSquare,
        expectedPiece: piece,
        actualPiece,
        fen: sourceTl.chess.fen(),
      });
      return;
    }

    const isWhite = piece.color === 'w';

    // Convert turnIndex to snapshot index
    // turnIndex 0 = snapshot at (length - 2), turnIndex 1 = snapshot at (length - 3), etc.
    const snapshotIdx = sourceTl.snapshots.length - 2 - targetTurnIndex;
    if (snapshotIdx < 0) return;

    const targetSnapshot = sourceTl.snapshots[snapshotIdx];
    if (!targetSnapshot) return;

    // Get FEN at target historical point
    let fen = this._getSnapshotFen(targetSnapshot);
    console.log('[Time Travel] snapshotIdx:', snapshotIdx);
    console.log('[Time Travel] targetSnapshot:', JSON.stringify(targetSnapshot).slice(0, 200));
    console.log('[Time Travel] FEN from snapshot:', fen);

    if (!fen) {
      console.log('[Time Travel] No FEN in snapshot, rebuilding from moves...');
      // Fallback: Rebuild FEN by replaying moves (for old snapshots)
      const forkChess = new Chess();
      for (let i = 0; i < snapshotIdx; i++) {
        if (i < sourceTl.moveHistory.length) {
          const histMove = sourceTl.moveHistory[i];
          const moveResult = forkChess.move({ from: histMove.from, to: histMove.to, promotion: histMove.promotion || undefined });
          if (!moveResult) {
            console.error('[Time Travel] Failed to replay move:', histMove);
          }
        }
      }
      fen = forkChess.fen();
      console.log('[Time Travel] Rebuilt FEN:', fen);
    }

    if (!fen) {
      console.error('[Time Travel] Could not get FEN! Aborting time travel.');
      return;
    }

    // Clone board before we modify source timeline
    const sourceBoardBefore = this._cloneBoard(sourceTl.chess);

    // 1. Remove piece from source timeline (it traveled away)
    const sourceFen = sourceTl.chess.fen();
    // Source: piece left via time travel, no capture on source timeline
    // skipSelfCheckValidation=true because the piece is LEAVING (check validation happens on new timeline)
    const newSourceFen = this._modifyFen(sourceFen, sourceSquare, null, !isWhite, false, true);
    sourceTl.chess.load(newSourceFen);

    // Record the departure move on source timeline
    const pieceChar = piece.type.toUpperCase();
    sourceTl.moveHistory.push({
      from: sourceSquare,
      to: sourceSquare,
      piece: piece.type,
      captured: null,
      san: `${pieceChar}${sourceSquare}⟳T${targetTurnIndex}`,  // Time travel notation
      isWhite,
    });
    sourceTl.snapshots.push(this._cloneBoard(sourceTl.chess));

    // Update source timeline visual
    const sourceCol = Board3D.getTimeline(sourceTimelineId);
    if (sourceCol) {
      sourceCol.addSnapshot(this._getSnapshotBoard(sourceBoardBefore), sourceSquare, sourceSquare, isWhite);
      sourceCol.showLastMove(sourceSquare, sourceSquare);
      // Immediately re-render to show piece removal (don't wait until end)
      sourceCol.render(sourceTl.chess.board());
    }

    // Notify that snapshot was added - triggers branch line rebuild
    Board3D.notifySnapshotAdded(sourceTimelineId);

    // Spawn portal effect at departure point
    Board3D.spawnPortalEffect(sourceTimelineId, sourceSquare);

    // 2. Create a NEW timeline branching from that historical point
    const newId = this.nextTimelineId++;

    // Calculate x offset: alternate left/right of parent
    // Use sibling count (children of same parent) instead of total timeline count
    // to prevent exponential spacing growth
    const siblingCount = Object.values(this.timelines)
      .filter(tl => tl.parentId === sourceTimelineId).length;
    const side = siblingCount % 2 === 0 ? 1 : -1;
    let xOffset = sourceTl.xOffset + side * Board3D.TIMELINE_SPACING * Math.ceil((siblingCount + 1) / 2);

    // OVERLAP DETECTION: Check if any existing timeline has this xOffset
    const existingOffsets = Object.values(this.timelines).map(tl => tl.xOffset);
    if (existingOffsets.includes(xOffset)) {
      console.error('[BOARD_OVERLAP_BUG] Timeline xOffset collision detected (time travel)!', {
        newTimelineId: newId,
        calculatedXOffset: xOffset,
        parentId: sourceTimelineId,
        siblingCount,
        side,
        existingOffsets,
        allTimelines: Object.values(this.timelines).map(tl => ({
          id: tl.id,
          xOffset: tl.xOffset,
          parentId: tl.parentId,
        })),
      });
      // FIX: Find a unique position by incrementing until we find an unused slot
      const spacing = Board3D.TIMELINE_SPACING;
      let attempts = 0;
      while (existingOffsets.includes(xOffset) && attempts < 100) {
        // Try alternating left/right with increasing distance
        attempts++;
        const distance = Math.ceil(attempts / 2) * spacing;
        xOffset = sourceTl.xOffset + (attempts % 2 === 0 ? 1 : -1) * distance;
      }
      console.log('[BOARD_OVERLAP_FIX] Found unique xOffset after collision (time travel):', {
        newTimelineId: newId,
        finalXOffset: xOffset,
        attempts,
      });
    }

    // DEBUG: Log all timeline positions for visibility
    console.log('[TIMELINE_POSITIONS] Creating timeline with position (time travel):', {
      newTimelineId: newId,
      xOffset,
      parentId: sourceTimelineId,
      siblingCount,
      side,
      allPositions: Object.values(this.timelines).map(tl => ({
        id: tl.id,
        xOffset: tl.xOffset,
        name: tl.name,
      })),
    });

    console.log('[Time Travel] Creating new timeline:', {
      originalFen: fen,
      sourceSquare,
      piece,
      snapshotIdx,
    });

    // Create the new timeline with the ORIGINAL historical FEN
    // (We'll add the time-traveled piece manually to allow extra queens)
    const newTl = this._createTimeline(newId, xOffset, sourceTimelineId, snapshotIdx, fen);

    // Now manually place the time-traveled piece using chess.put()
    // This bypasses validation that would reject multiple queens etc
    const targetSquare = sourceSquare;  // Piece appears at same square, different time

    // Remove any piece currently on target (capture)
    const existingPiece = newTl.chess.get(targetSquare);
    if (existingPiece) {
      const removed = newTl.chess.remove(targetSquare);
      if (!removed) {
        console.error('[Time Travel] Failed to remove existing piece at', targetSquare, existingPiece);
        throw new Error(`Time travel failed: could not remove existing piece at ${targetSquare}`);
      }
      console.log('[Time Travel] Removed existing piece:', { square: targetSquare, piece: existingPiece });
    }

    // Validate target square is now empty before placing
    const afterRemove = newTl.chess.get(targetSquare);
    if (afterRemove) {
      console.error('[Time Travel] Square not empty after remove!', { square: targetSquare, stillThere: afterRemove });
      throw new Error(`Time travel failed: square ${targetSquare} not empty after remove operation`);
    }

    // Place the time-traveled piece
    const placed = newTl.chess.put(piece, targetSquare);
    if (!placed) {
      console.error('[Time Travel] Failed to place piece at', targetSquare, piece);
      throw new Error(`Time travel failed: could not place ${piece.type} at ${targetSquare}`);
    }

    // Verify the piece was actually placed correctly (no overlaps)
    const verifyPlaced = newTl.chess.get(targetSquare);
    if (!verifyPlaced || verifyPlaced.type !== piece.type || verifyPlaced.color !== piece.color) {
      console.error('[Time Travel] Piece placement verification failed!', {
        expected: piece,
        actual: verifyPlaced,
        square: targetSquare,
      });
      throw new Error(`Time travel failed: piece placement verification failed at ${targetSquare}`);
    }

    // Fix turn synchronization: After time travel arrival, it's the opponent's turn.
    // We need to flip the turn in the FEN. Since chess.put() doesn't modify turn,
    // we reload the FEN with the correct turn.
    const currentFen = newTl.chess.fen();
    const fenParts = currentFen.split(' ');
    // After the time-traveling piece's color moves, it's the opponent's turn
    fenParts[1] = isWhite ? 'b' : 'w';
    // Reset en passant on new timeline (historical en passant no longer valid)
    fenParts[3] = '-';
    // Halfmove clock: reset if capture, otherwise increment
    const wasCapture = existingPiece !== null;
    if (wasCapture) {
      fenParts[4] = '0';
    } else {
      fenParts[4] = String(parseInt(fenParts[4] || '0') + 1);
    }
    // Fullmove number: increment when it becomes white's turn (after black moved)
    if (fenParts[1] === 'w') {
      fenParts[5] = String(parseInt(fenParts[5] || '1') + 1);
    }
    const fixedFen = fenParts.join(' ');
    const loadResult = newTl.chess.load(fixedFen);
    if (!loadResult) {
      console.error('[Time Travel] MISSING_BOARD_BUG: Failed to load turn-fixed FEN:', fixedFen, {
        originalFen: fen,
        currentFen,
        newTimelineId: newId,
      });
    }

    // Validate that the time-traveling player's king is not in check after arrival
    // (moving player is isWhite ? 'w' : 'b', and FEN turn is already flipped to opponent)
    const movingPlayerColor: 'w' | 'b' = isWhite ? 'w' : 'b';
    const selfCheckValidation = validateNoSelfCheck(newTl.chess.fen(), movingPlayerColor);
    if (!selfCheckValidation.valid) {
      console.error('[Time Travel] CRITICAL: Time travel leaves own king in check!', {
        fen: newTl.chess.fen(),
        movingPlayerColor,
        reason: selfCheckValidation.reason,
      });
      // TODO: Add rollback here using TimelineTransaction
      throw new Error(`Illegal time travel: ${selfCheckValidation.reason}`);
    }

    console.log('[Time Travel] New timeline chess state:', newTl.chess.fen());
    console.log('[Time Travel] New timeline board:', newTl.chess.board());

    // Copy snapshots up to the branch point
    newTl.snapshots = [];
    for (let s = 0; s <= snapshotIdx; s++) {
      newTl.snapshots.push(this._deepCloneSnapshot(sourceTl.snapshots[s]));
    }

    // Add the arrival snapshot (queen now on this timeline)
    newTl.snapshots.push(this._cloneBoard(newTl.chess));

    // Record the time travel arrival as a move
    newTl.moveHistory = [];
    // Copy move history up to branch point
    for (let m = 0; m < snapshotIdx; m++) {
      if (m < sourceTl.moveHistory.length) {
        newTl.moveHistory.push(JSON.parse(JSON.stringify(sourceTl.moveHistory[m])));
      }
    }
    // Add the arrival move
    newTl.moveHistory.push({
      from: sourceSquare,
      to: sourceSquare,
      piece: piece.type,
      captured: capturedPiece?.type || null,
      san: `${pieceChar}${sourceSquare}⟳←T${sourceTimelineId}`,  // Arrived via time travel
      isWhite,
    });

    // Validate snapshot consistency on the new timeline (same as branching code)
    this._validateSnapshotConsistency(newTl);

    // Add history layers to the new timeline visual
    const newCol = Board3D.getTimeline(newId);
    if (newCol) {
      for (let h = newTl.moveHistory.length - 1; h >= 0; h--) {
        const mv = newTl.moveHistory[h];
        const boardBefore = this._getSnapshotBoard(newTl.snapshots[h]);
        newCol.addSnapshot(boardBefore, mv.from, mv.to, mv.isWhite);
      }
    }

    // 3. Add time travel connection line (vertical drop then horizontal)
    Board3D.addTimeTravelLine(
      sourceTimelineId,
      targetTurnIndex,
      newId,
      sourceSquare,
      isWhite
    );

    // 4. Switch to the new timeline (respect camera follow setting for CPU mode)
    console.log('[Time Travel] VISUAL_TRAILS_DEBUG: About to render after time travel', {
      timestamp: Date.now(),
      sourceTimelineId,
      newTimelineId: newId,
      sourceSquare,
    });
    this.clearSelection();
    const shouldFocus = !this.cpuEnabled || this.cpuCameraFollow;
    this.setActiveTimeline(newId, shouldFocus);
    this.renderTimeline(sourceTimelineId);
    this.renderTimeline(newId);

    // Validate no duplicate sprites after time travel renders
    // Pass current board state so we can do a full rebuild if needed
    // (sourceCol and newCol are already declared earlier in this function)
    if (sourceCol) {
      sourceCol.validateNoDuplicates(sourceTl.chess.board());
    }
    if (newCol) {
      newCol.validateNoDuplicates(newTl.chess.board());
    }

    console.log('[Time Travel] VISUAL_TRAILS_DEBUG: Render complete', {
      timestamp: Date.now(),
    });
    this.updateTimelineList();
    this._updateMoveSlider();

    // Spawn portal effect at arrival point
    Board3D.spawnPortalEffect(newId, sourceSquare);

    // If captured a piece, also spawn capture effect
    if (capturedPiece) {
      Board3D.spawnCaptureEffect(newId, sourceSquare);
    }

    // TURN DEBUG: Log final state after time travel move
    console.log('[TURN_DEBUG] _makeTimeTravelMove COMPLETE:', {
      sourceTimelineId,
      sourceTimelineName: sourceTl.name,
      sourceFenAfter: sourceTl.chess.fen(),
      sourceTurnAfter: sourceTl.chess.turn(),
      newTimelineId: newId,
      newTimelineName: newTl.name,
      newTimelineFen: newTl.chess.fen(),
      newTimelineTurn: newTl.chess.turn(),
    });
  }

  /** Helper: Modify a FEN string to change a square's piece and flip turn.
   * Also updates castling rights, en passant, halfmove clock, and fullmove number.
   * Uses utility functions from gameUtils.ts for clean, testable logic.
   * @param isCapture - Set to true if this modification represents a capture
   * @param skipSelfCheckValidation - Set to true to skip self-check validation (for source timeline removal)
   */
  private _modifyFen(fen: string, square: Square, newPiece: Piece | null, whiteToMove: boolean, isCapture: boolean = false, skipSelfCheckValidation: boolean = false): string {
    // Use the centralized modifyFen utility which handles all FEN modification logic
    // including castling rights, en passant reset, halfmove clock, and fullmove number
    const result = modifyFenUtil({
      fen,
      square,
      newPiece,
      whiteToMove,
      isCapture,
      resetEnPassant: true,  // Always reset en passant on time travel/cross-timeline
    });

    // Validate the result
    if (!isValidFen(result)) {
      console.error('[_modifyFen] CRITICAL: Generated invalid FEN!', {
        input: fen,
        output: result,
        square,
        newPiece,
      });
      throw new Error(`FEN modification failed: invalid result "${result}" from input "${fen}" (square=${square}, newPiece=${JSON.stringify(newPiece)})`);
    }

    // Validate kings are still correct
    const kingValidation = validateKings(result);
    if (!kingValidation.valid) {
      console.error('[_modifyFen] CRITICAL: Invalid king count after FEN modification!', {
        input: fen,
        output: result,
        whiteKings: kingValidation.whiteKings,
        blackKings: kingValidation.blackKings,
      });
      throw new Error(`FEN modification resulted in invalid king count: white=${kingValidation.whiteKings}, black=${kingValidation.blackKings}`);
    }

    // Validate that the moving player's king is not left in check
    // whiteToMove indicates whose turn it is AFTER the move, so the moving player is the opposite
    // Skip this validation for source timeline removal (the piece is leaving, check validation
    // happens on the target timeline where the piece arrives)
    if (!skipSelfCheckValidation) {
      const movingPlayerColor: 'w' | 'b' = whiteToMove ? 'b' : 'w';
      const selfCheckValidation = validateNoSelfCheck(result, movingPlayerColor);
      if (!selfCheckValidation.valid) {
        console.error('[_modifyFen] CRITICAL: Move leaves own king in check!', {
          input: fen,
          output: result,
          square,
          newPiece,
          movingPlayerColor,
          reason: selfCheckValidation.reason,
        });
        throw new Error(`Illegal teleport: ${selfCheckValidation.reason}`);
      }
    }

    return result;
  }

  /* -- Promotion UI -- */
  private _showPromotionPicker(tlId: number, square: string, isWhite: boolean): void {
    const existing = document.getElementById('promotion-picker');
    if (existing) existing.remove();

    const picker = document.createElement('div');
    picker.id = 'promotion-picker';
    picker.innerHTML =
      '<div class="promo-title">Promote to:</div>' +
      '<div class="promo-options">' +
      '<button data-piece="q" title="Queen">' + (isWhite ? '\u2655' : '\u265B') + '</button>' +
      '<button data-piece="r" title="Rook">' + (isWhite ? '\u2656' : '\u265C') + '</button>' +
      '<button data-piece="b" title="Bishop">' + (isWhite ? '\u2657' : '\u265D') + '</button>' +
      '<button data-piece="n" title="Knight">' + (isWhite ? '\u2658' : '\u265E') + '</button>' +
      '</div>';

    picker.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const piece = btn.getAttribute('data-piece') as PieceType | null;
        picker.remove();
        if (this.pendingPromotion && piece) {
          const pending = this.pendingPromotion;
          this.pendingPromotion = null;
          this.makeMove(pending.tlId, pending.move, piece);
        }
      });
    });

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.appendChild(picker);
    }
  }

  /* -- Snapshot consistency validation -- */
  private _validateSnapshotConsistency(tl: TimelineData): void {
    // Invariant: snapshots.length === moveHistory.length + 1
    // (snapshot[0] is initial state, each move adds one snapshot)
    if (tl.snapshots.length !== tl.moveHistory.length + 1) {
      console.error('SNAPSHOT CONSISTENCY ERROR:', {
        timeline: tl.id,
        snapshotsLength: tl.snapshots.length,
        moveHistoryLength: tl.moveHistory.length,
        expected: 'snapshots.length === moveHistory.length + 1',
      });
      throw new Error('GameStateError: Snapshot/moveHistory mismatch on timeline ' + tl.id);
    }
  }

  /* -- Rendering -- */
  renderTimeline(tlId: number): void {
    const tl = this.timelines[tlId];
    if (!tl) {
      console.error('[renderTimeline] MISSING_BOARD_BUG: Timeline data not found for id:', tlId);
      return;
    }
    const col = Board3D.getTimeline(tlId);
    if (!col) {
      console.error('[renderTimeline] MISSING_BOARD_BUG: 3D timeline not found for id:', tlId);
      return;
    }

    const board = tl.chess.board();
    // Count pieces on the board
    let pieceCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r] && board[r][c]) pieceCount++;
      }
    }
    if (pieceCount === 0) {
      console.error('[renderTimeline] MISSING_BOARD_BUG: Board has 0 pieces!', {
        timelineId: tlId,
        fen: tl.chess.fen(),
        board,
      });
    }

    col.render(board);

    // Update board glow based on game state
    if (tl.chess.in_checkmate()) {
      col.setBoardGlow('checkmate');
    } else if (tl.chess.in_draw() || tl.chess.in_stalemate()) {
      col.setBoardGlow('draw');
    } else {
      col.setBoardGlow('none');
    }
  }

  clearSelection(): void {
    if (this.selectedTimelineId !== null) {
      const col = Board3D.getTimeline(this.selectedTimelineId);
      if (col) col.clearHighlights();
    }
    // Clear cross-timeline highlights
    if (this.crossTimelineSelection) {
      this._clearCrossTimelineTargets();
      this.crossTimelineSelection = null;
    }
    // Clear time travel highlights
    if (this.timeTravelSelection) {
      this._clearTimeTravelTargets();
      this.timeTravelSelection = null;
    }
    this.selected = null;
    this.selectedTimelineId = null;
  }

  /** Show cross-timeline target indicators in other timelines */
  private _showCrossTimelineTargets(targets: CrossTimelineMoveTarget[]): void {
    // Group targets by timeline to show board glow border once per board
    const targetsByTimeline = new Map<number, CrossTimelineMoveTarget[]>();
    for (const target of targets) {
      const existing = targetsByTimeline.get(target.targetTimelineId) || [];
      existing.push(target);
      targetsByTimeline.set(target.targetTimelineId, existing);
    }

    // Show indicators and board glow for each target timeline
    for (const [tlId, tlTargets] of targetsByTimeline) {
      const col = Board3D.getTimeline(tlId);
      if (col) {
        // Show glowing border around the entire board
        col.showBoardGlowBorder(0xaa44ff);  // Purple for cross-timeline
        // Show individual square targets
        for (const target of tlTargets) {
          col.showCrossTimelineTarget(target.targetSquare, target.isCapture);
        }
      }
    }
  }

  /** Clear cross-timeline target indicators */
  private _clearCrossTimelineTargets(): void {
    if (!this.crossTimelineSelection) return;
    for (const target of this.crossTimelineSelection.validTargets) {
      const col = Board3D.getTimeline(target.targetTimelineId);
      if (col) {
        col.clearCrossTimelineTargets();
      }
    }
  }

  /** Show time travel target indicators on history boards */
  private _showTimeTravelTargets(targets: TimeTravelTarget[]): void {
    for (const target of targets) {
      const col = Board3D.getTimeline(target.sourceTimelineId);
      if (col) {
        col.showTimeTravelTarget(target.targetTurnIndex, target.targetSquare, target.isCapture);
      }
    }
  }

  /** Clear time travel target indicators */
  private _clearTimeTravelTargets(): void {
    if (!this.timeTravelSelection) return;
    for (const target of this.timeTravelSelection.validTargets) {
      const col = Board3D.getTimeline(target.sourceTimelineId);
      if (col) {
        col.clearTimeTravelTargets();
      }
    }
  }

  /* -- Board cloning -- */
  // Snapshot format: { fen: string, board: 8x8 array }
  // - fen: full game state for reconstruction (includes castling, en passant, etc.)
  // - board: piece positions for rendering
  private _cloneBoard(chess: ChessInstance): Snapshot {
    const board = chess.board();
    const boardClone: Board = [];
    for (let r = 0; r < 8; r++) {
      boardClone[r] = [];
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        boardClone[r][c] = p ? { type: p.type, color: p.color } : null;
      }
    }
    return {
      fen: chess.fen(),
      board: boardClone,
    };
  }

  private _deepCloneSnapshot(snapshot: AnySnapshot): AnySnapshot {
    // Handle both old format (array) and new format (object with fen/board)
    if (Array.isArray(snapshot)) {
      // Old format: just board array
      const clone: Board = [];
      for (let r = 0; r < 8; r++) {
        clone[r] = [];
        for (let c = 0; c < 8; c++) {
          const p = snapshot[r][c];
          clone[r][c] = p ? { type: p.type, color: p.color } : null;
        }
      }
      return clone;
    }
    // New format: { fen, board }
    const boardClone: Board = [];
    for (let r = 0; r < 8; r++) {
      boardClone[r] = [];
      for (let c = 0; c < 8; c++) {
        const p = snapshot.board[r][c];
        boardClone[r][c] = p ? { type: p.type, color: p.color } : null;
      }
    }
    return {
      fen: snapshot.fen,
      board: boardClone,
    };
  }

  // Helper to get board array from snapshot (handles both formats)
  private _getSnapshotBoard(snapshot: AnySnapshot): Board {
    if (Array.isArray(snapshot)) return snapshot;
    return snapshot.board;
  }

  // Helper to get FEN from snapshot (returns null for old format)
  private _getSnapshotFen(snapshot: AnySnapshot): string | null {
    if (Array.isArray(snapshot)) return null;
    return snapshot.fen;
  }

  // Helper to get turn from snapshot
  private _getSnapshotTurn(snapshot: AnySnapshot): string | null {
    const fen = this._getSnapshotFen(snapshot);
    if (fen) {
      // FEN format: "position turn castling enpassant halfmove fullmove"
      // Turn is the second field
      return fen.split(' ')[1]; // 'w' or 'b'
    }
    return null;
  }

  private _fromSq(sq: string): { r: number; c: number } {
    return { r: 8 - parseInt(sq[1]), c: sq.charCodeAt(0) - 97 };
  }

  /* -- UI updates -- */
  updateStatus(): void {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;
    const chess = tl.chess;
    const turn = chess.turn() === 'w' ? 'White' : 'Black';
    const prefix =
      Object.keys(this.timelines).length > 1 ? '[' + tl.name + '] ' : '';

    // TURN DEBUG: Log status update with full turn state for all timelines
    const allTimelinesTurnState: Record<string, { name: string; turn: string; fen: string; moveCount: number }> = {};
    for (const tlIdStr of Object.keys(this.timelines)) {
      const t = this.timelines[parseInt(tlIdStr)];
      allTimelinesTurnState[tlIdStr] = {
        name: t.name,
        turn: t.chess.turn(),
        fen: t.chess.fen(),
        moveCount: t.moveHistory.length,
      };
    }
    console.log('[TURN_DEBUG] updateStatus:', {
      activeTimelineId: this.activeTimelineId,
      activeTimelineName: tl.name,
      displayingTurn: turn,
      chessTurn: chess.turn(),
      fen: chess.fen(),
      allTimelines: allTimelinesTurnState,
    });

    if (chess.in_checkmate()) {
      const winner = chess.turn() === 'w' ? 'Black' : 'White';
      statusEl.textContent = prefix + 'Checkmate! ' + winner + ' wins';
      statusEl.style.color = '#ff6b6b';
    } else if (chess.in_draw()) {
      statusEl.textContent = prefix + 'Draw!';
      statusEl.style.color = '#ffd93d';
    } else if (chess.in_check()) {
      statusEl.textContent = prefix + turn + ' \u2014 Check!';
      statusEl.style.color = '#ff6b6b';
    } else {
      statusEl.textContent = prefix + turn + ' to move';
      statusEl.style.color = '#e0e0e0';
    }

    // Update FEN display
    this._updateFenDisplay();
  }

  private _updateFenDisplay(): void {
    const fenText = document.getElementById('fen-text');
    const fenTooltip = document.getElementById('fen-tooltip');
    const fenDisplay = document.getElementById('fen-display');
    if (!fenText || !fenTooltip || !fenDisplay) return;

    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return;

    const fen = tl.chess.fen();
    fenText.textContent = fen;
    fenTooltip.textContent = fen;

    // Click to copy
    fenDisplay.onclick = () => {
      navigator.clipboard.writeText(fen).then(() => {
        const original = fenTooltip.textContent;
        fenTooltip.textContent = 'Copied!';
        fenTooltip.style.color = '#6bc96b';
        setTimeout(() => {
          fenTooltip.textContent = original;
          fenTooltip.style.color = '';
        }, 1000);
      });
    };
  }

  updateMoveList(): void {
    const movesEl = document.getElementById('moves');
    if (!movesEl) return;
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) {
      if (this._lastMoveListHtml !== '') {
        movesEl.innerHTML = '';
        this._lastMoveListHtml = '';
      }
      return;
    }
    // Use moveHistory instead of chess.history() because chess.load() wipes history
    // when we modify FEN for time travel/cross-timeline moves
    const history = tl.moveHistory.map(m => m.san);
    let html = '';
    for (let i = 0; i < history.length; i += 2) {
      const num = Math.floor(i / 2) + 1;
      const white = history[i];
      const black = history[i + 1] || '';
      html +=
        '<div class="move-pair">' +
        '<span class="move-number">' + num + '.</span>' +
        this._formatMoveWithTooltip(white) +
        this._formatMoveWithTooltip(black) + '</div>';
    }
    // Only update DOM if content changed (avoids unnecessary re-renders)
    if (html !== this._lastMoveListHtml) {
      movesEl.innerHTML = html;
      movesEl.scrollTop = movesEl.scrollHeight;
      this._lastMoveListHtml = html;
    }
  }

  /** Format a move SAN with tooltips for cross-timeline/time-travel notation */
  private _formatMoveWithTooltip(san: string): string {
    if (!san) return '<span class="move"></span>';

    // Cross-timeline moves: Qd4→T2 (piece moves TO timeline) or Qd4←T1 (piece arrives FROM timeline)
    // Time travel moves: Qd4⟳T3 (departure) or Qd4⟳←T1 (arrival via time travel)
    let tooltip = '';
    let cssClass = 'move';

    if (san.includes('⟳←T')) {
      // Time travel arrival: piece arrived via time travel from another timeline
      const match = san.match(/⟳←T(\d+)/);
      if (match) {
        tooltip = `Piece arrives via time travel from Timeline ${match[1]}`;
        cssClass += ' time-travel';
      }
    } else if (san.includes('⟳T')) {
      // Time travel departure: piece time travels to a past turn
      const match = san.match(/⟳T(\d+)/);
      if (match) {
        tooltip = `Piece time travels to turn ${match[1]} (creates new timeline)`;
        cssClass += ' time-travel';
      }
    } else if (san.includes('→T')) {
      // Cross-timeline departure: piece moves TO another timeline
      const match = san.match(/→T(\d+)/);
      if (match) {
        tooltip = `Piece moves TO Timeline ${match[1]}`;
        cssClass += ' cross-timeline';
      }
    } else if (san.includes('←T')) {
      // Cross-timeline arrival: piece arrives FROM another timeline
      const match = san.match(/←T(\d+)/);
      if (match) {
        tooltip = `Piece arrives FROM Timeline ${match[1]}`;
        cssClass += ' cross-timeline';
      }
    }

    if (tooltip) {
      return `<span class="${cssClass}" title="${tooltip}">${san}</span>`;
    }
    return `<span class="${cssClass}">${san}</span>`;
  }

  updateTimelineList(): void {
    const listEl = document.getElementById('timeline-list');
    if (!listEl) return;
    const colors = Board3D.TIMELINE_COLORS;

    // Fixed 6-slot grid: Main + 5 branches (minimum visible)
    const MIN_SLOTS = 6;
    const slotNames = ['Main', 'Branch 1', 'Branch 2', 'Branch 3', 'Branch 4', 'Branch 5'];

    // Map existing timelines to slots (by ID, sorted)
    const timelineIds = Object.keys(this.timelines).map(k => parseInt(k)).sort((a, b) => a - b);
    const totalSlots = Math.max(MIN_SLOTS, timelineIds.length);

    // Check if structure changed (new timelines added)
    const structureKey = timelineIds.join(',') + '|' + totalSlots;
    const structureChanged = structureKey !== this._lastTimelineStructure;

    if (structureChanged) {
      // Full rebuild needed
      let html = '';
      for (let slot = 0; slot < totalSlots; slot++) {
        const tlId = timelineIds[slot];
        const tl = tlId !== undefined ? this.timelines[tlId] : null;
        const color = colors[slot % colors.length];
        const hexColor = '#' + color.toString(16).padStart(6, '0');

        if (tl) {
          const isActive = tl.id === this.activeTimelineId;
          const turnCount = tl.moveHistory.length;

          html +=
            '<div class="tl-item' +
            (isActive ? ' active' : '') +
            '" data-tl-id="' +
            tl.id +
            '">' +
            '<span class="tl-dot" style="background:' +
            hexColor +
            '"></span>' +
            '<span class="tl-label">' +
            tl.name +
            '</span>' +
            '<span class="tl-turn">' +
            turnCount +
            '</span></div>';
        } else {
          const name = slot < slotNames.length ? slotNames[slot] : 'Branch ' + slot;
          html +=
            '<div class="tl-item empty">' +
            '<span class="tl-dot" style="background:' +
            hexColor +
            '; opacity: 0.3"></span>' +
            '<span class="tl-label">' +
            name +
            '</span>' +
            '<span class="tl-turn">-</span></div>';
        }
      }

      listEl.innerHTML = html;
      this._lastTimelineStructure = structureKey;

      // Attach click handlers
      const items = listEl.querySelectorAll('.tl-item:not(.empty)');
      items.forEach((item) => {
        const tlId = parseInt((item as HTMLElement).dataset.tlId || '0');
        item.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent any bubbling issues
          console.log('[TIMELINE_CLICK] Clicked timeline', tlId, 'current active:', this.activeTimelineId);
          this.setActiveTimeline(tlId);
        });
      });
    } else {
      // Just update active state and move counts in place (no scroll jump)
      const items = listEl.querySelectorAll('.tl-item');
      items.forEach((item) => {
        const el = item as HTMLElement;
        const tlId = el.dataset.tlId;
        if (tlId === undefined) return; // empty slot

        const id = parseInt(tlId);
        const tl = this.timelines[id];
        if (!tl) return;

        // Update active class
        if (id === this.activeTimelineId) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }

        // Update move count
        const turnEl = el.querySelector('.tl-turn');
        if (turnEl) {
          turnEl.textContent = String(tl.moveHistory.length);
        }
      });
    }
  }

  /* -- Branch Point Indicators -- */
  private _highlightConnectedTimelines(tlId: number, highlight: boolean): void {
    // Cancel any pending highlight operation
    if (this._highlightDebounceTimer !== null) {
      clearTimeout(this._highlightDebounceTimer);
      this._highlightDebounceTimer = null;
    }

    // For unhighlight, execute immediately to avoid lingering highlights
    // For highlight, debounce to prevent flicker during rapid hover changes (e.g., CPU play)
    if (!highlight) {
      this._executeHighlight(tlId, false);
    } else {
      this._highlightDebounceTimer = window.setTimeout(() => {
        this._executeHighlight(tlId, true);
        this._highlightDebounceTimer = null;
      }, this._highlightDebounceDelay);
    }
  }

  private _executeHighlight(tlId: number, highlight: boolean): void {
    const tl = this.timelines[tlId];
    if (!tl) return;

    // Find all connected timelines (parent and children)
    const connected: number[] = [];

    // Add parent
    if (tl.parentId !== null) {
      connected.push(tl.parentId);
    }

    // Add children
    for (const key in this.timelines) {
      const other = this.timelines[key];
      if (other.parentId === tlId) {
        connected.push(other.id);
      }
    }

    // Highlight/unhighlight in UI
    const listEl = document.getElementById('timeline-list');
    if (listEl) {
      connected.forEach((connectedId) => {
        const item = listEl.querySelector('[data-tl-id="' + connectedId + '"]');
        if (item) {
          if (highlight) {
            item.classList.add('connected-highlight');
          } else {
            item.classList.remove('connected-highlight');
          }
        }
      });
    }

    // Highlight in 3D view
    connected.forEach((connectedId) => {
      const col = Board3D.getTimeline(connectedId);
      if (col) {
        col.setHighlighted(highlight);
      }
    });
  }

  /* -- Get branch points for a timeline -- */
  getBranchPoints(tlId: number): { childId: number; moveIndex: number; name: string }[] {
    const branches: { childId: number; moveIndex: number; name: string }[] = [];
    for (const key in this.timelines) {
      const tl = this.timelines[key];
      if (tl.parentId === tlId) {
        branches.push({
          childId: tl.id,
          moveIndex: tl.branchTurn,
          name: tl.name,
        });
      }
    }
    return branches;
  }

  /* -- Global Game Over Detection -- */

  /**
   * Check if the game is globally over (all timelines in checkmate or stalemate)
   */
  isGlobalGameOver(): boolean {
    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      if (!tl.chess.in_checkmate() && !tl.chess.in_stalemate() && !tl.chess.in_draw()) {
        return false;
      }
    }
    // All timelines are finished
    return Object.keys(this.timelines).length > 0;
  }

  /**
   * Get the global winner (if game is over)
   * Returns 'white', 'black', 'draw', or null if game is not over
   */
  getGlobalWinner(): 'white' | 'black' | 'draw' | null {
    if (!this.isGlobalGameOver()) return null;

    let whiteWins = 0;
    let blackWins = 0;
    let draws = 0;

    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      if (tl.chess.in_checkmate()) {
        // The side to move is in checkmate, so the other side wins
        if (tl.chess.turn() === 'w') blackWins++;
        else whiteWins++;
      } else {
        // Stalemate or draw
        draws++;
      }
    }

    // If there are any decisive results, the side with more wins wins
    if (whiteWins > blackWins) return 'white';
    if (blackWins > whiteWins) return 'black';
    return 'draw';
  }

  /**
   * Handle game end - zoom out to show all boards and display stats toast.
   */
  private _handleGameEnd(): void {
    // Zoom out camera to show all boards
    Board3D.zoomOutShowAll();

    // Gather game stats
    const stats = this._getGameEndStats();

    // Display toast notification
    this._showGameEndToast(stats);
  }

  /**
   * Get game end statistics.
   */
  private _getGameEndStats(): {
    winner: 'white' | 'black' | 'draw';
    totalTimelines: number;
    whiteWins: number;
    blackWins: number;
    draws: number;
    totalMoves: number;
  } {
    let whiteWins = 0;
    let blackWins = 0;
    let draws = 0;
    let totalMoves = 0;

    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      totalMoves += tl.chess.history().length;

      if (tl.chess.in_checkmate()) {
        if (tl.chess.turn() === 'w') blackWins++;
        else whiteWins++;
      } else {
        draws++;
      }
    }

    const winner = this.getGlobalWinner() || 'draw';

    return {
      winner,
      totalTimelines: Object.keys(this.timelines).length,
      whiteWins,
      blackWins,
      draws,
      totalMoves,
    };
  }

  /**
   * Show game end toast notification.
   */
  private _showGameEndToast(stats: ReturnType<typeof this._getGameEndStats>): void {
    // Remove any existing toast
    const existingToast = document.getElementById('game-end-toast');
    if (existingToast) existingToast.remove();

    // Create toast element
    const toast = document.createElement('div');
    toast.id = 'game-end-toast';
    toast.className = 'game-end-toast';

    // Determine winner text and emoji
    let winnerText: string;
    let winnerEmoji: string;
    if (stats.winner === 'white') {
      winnerText = 'White Wins!';
      winnerEmoji = '⚪';
    } else if (stats.winner === 'black') {
      winnerText = 'Black Wins!';
      winnerEmoji = '⚫';
    } else {
      winnerText = 'Draw!';
      winnerEmoji = '🤝';
    }

    toast.innerHTML = `
      <div class="toast-header">
        <span class="toast-title">${winnerEmoji} ${winnerText}</span>
        <button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="toast-body">
        <div class="toast-stat"><span>Timelines:</span> <strong>${stats.totalTimelines}</strong></div>
        <div class="toast-stat"><span>White wins:</span> <strong>${stats.whiteWins}</strong></div>
        <div class="toast-stat"><span>Black wins:</span> <strong>${stats.blackWins}</strong></div>
        <div class="toast-stat"><span>Draws:</span> <strong>${stats.draws}</strong></div>
        <div class="toast-stat"><span>Total moves:</span> <strong>${stats.totalMoves}</strong></div>
      </div>
    `;

    document.body.appendChild(toast);

    // Auto-fade after 10 seconds (but stays if user hovers)
    setTimeout(() => {
      if (toast.matches(':hover')) {
        toast.addEventListener('mouseleave', () => toast.classList.add('fading'), { once: true });
      } else {
        toast.classList.add('fading');
      }
    }, 10000);

    toast.addEventListener('animationend', (e) => {
      if (e.animationName === 'fadeOut') toast.remove();
    });
  }

  /* -- FEN Logging System (Phase 2) -- */

  /**
   * Get comprehensive debug info for all boards
   * Returns an object with FEN, turn, move history, etc. for each timeline
   */
  getGameDebugState(): GameDebugState {
    const boards: BoardDebugInfo[] = [];

    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      boards.push(getTimelineDebugInfo(
        tl,
        tl.chess.in_checkmate(),
        tl.chess.in_draw(),
        tl.chess.in_check()
      ));
    }

    return {
      timestamp: new Date().toISOString(),
      boards,
      activeTimelineId: this.activeTimelineId,
      totalTimelines: Object.keys(this.timelines).length,
      globalGameOver: this.isGlobalGameOver(),
    };
  }

  /**
   * Log the current game state to console (useful for debugging)
   */
  logGameState(): void {
    logGameState(this.getGameDebugState());
  }

  /**
   * Get FEN for a specific timeline (for user debugging)
   */
  getTimelineFen(tlId: number): string | null {
    const tl = this.timelines[tlId];
    return tl ? tl.chess.fen() : null;
  }

  /**
   * Copy FEN for active timeline to clipboard
   */
  async copyFenToClipboard(): Promise<boolean> {
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) return false;

    try {
      await navigator.clipboard.writeText(tl.chess.fen());
      return true;
    } catch {
      return false;
    }
  }

  /* -- Reset -- */
  reset(): void {
    // Stop CPU if running
    this.cpuStop();
    this.cpuGlobalTurn = 'w';

    Board3D.clearAll();
    this.timelines = {};
    this.nextTimelineId = 1;
    this.selected = null;
    this.selectedTimelineId = null;
    const movesEl = document.getElementById('moves');
    if (movesEl) {
      movesEl.innerHTML = '';
    }

    this._createTimeline(0, 0, null, -1, null);
    this.setActiveTimeline(0);
    this.renderTimeline(0);
    this.updateStatus();
    this.updateTimelineList();

    // Setup collapsible shortcuts panel
    this._setupCollapsibleShortcuts();
  }

  /* -- CPU Mode -- */

  // CPU state
  private cpuEnabled = false;
  private cpuTimer: number | null = null;
  private cpuMoveDelay = 400;  // ms between moves (faster for visual effect)
  private maxTimelines = 6;   // Default to 6 total timelines (main + 5 branches), adjustable via slider (0-30)
  private cpuCameraFollow = true;  // Auto-follow moves with camera
  private cpuGlobalTurn: PieceColor = 'w';  // Track whose turn globally (independent of per-timeline state)

  // Race condition prevention: lock to prevent concurrent move execution
  private cpuMoveInProgress = false;

  // Per-color CPU settings
  private cpuWhiteEnabled = true;
  private cpuBlackEnabled = true;
  private cpuWhiteCapturePreference = 0.7;
  private cpuBlackCapturePreference = 0.7;

  // Per-piece portal biases (per color) - higher = more aggressive with 5D moves
  private cpuWhitePortalBias: Record<string, number> = { q: 0.5, r: 0.4, b: 0.35, n: 0.3 };
  private cpuBlackPortalBias: Record<string, number> = { q: 0.5, r: 0.4, b: 0.35, n: 0.3 };

  // 5D Chess aggression settings (increased for more dynamic multi-board play)
  private cpuCrossTimelineChance = 0.75;  // Base chance for cross-timeline moves (0-1)
  private cpuTimeTravelChance = 0.5;      // Base chance for time travel moves (0-1)

  // Stockfish settings
  private cpuUseStockfish = true;  // Use Stockfish when available
  private cpuStockfishSkillWhite = 10;  // Skill level 0-20 for White
  private cpuStockfishSkillBlack = 10;  // Skill level 0-20 for Black
  private cpuStockfishDepth = 10;  // Search depth 1-20

  /** Start CPU auto-play mode */
  cpuStart(): void {
    if (this.cpuEnabled) return;

    // Check if game is already over (all timelines in checkmate/stalemate)
    if (this._cpuIsGameOver()) {
      console.log('[CPU] Cannot start - all timelines already in checkmate/stalemate');
      return;
    }

    this.cpuEnabled = true;
    this.cpuMoveInProgress = false;  // Ensure clean state on start
    this._cpuTick();
    this._updateCpuUI();
  }

  /** Stop CPU auto-play mode */
  cpuStop(): void {
    this.cpuEnabled = false;
    this.cpuMoveInProgress = false;  // Clear any pending move lock
    if (this.cpuTimer !== null) {
      clearTimeout(this.cpuTimer);
      this.cpuTimer = null;
    }
    this._updateCpuUI();
  }

  /** Toggle CPU mode */
  cpuToggle(): void {
    if (this.cpuEnabled) {
      this.cpuStop();
    } else {
      this.cpuStart();
    }
  }

  /** Set move delay (100-2000ms) */
  cpuSetDelay(ms: number): void {
    this.cpuMoveDelay = Math.max(100, Math.min(2000, ms));
  }

  /** Set max timelines/branches (0-30, where 0=main only, 6=default with 5 branches) */
  setMaxTimelines(count: number): void {
    // 0 means only main timeline, 1 means main + 1 branch, etc.
    // Clamp to 0-30 range
    this.maxTimelines = Math.max(0, Math.min(30, count));
  }

  /** Toggle camera follow mode */
  cpuSetCameraFollow(follow: boolean): void {
    this.cpuCameraFollow = follow;
    this._updateCpuUI();
  }

  /** Set white CPU enabled */
  cpuSetWhiteEnabled(enabled: boolean): void {
    this.cpuWhiteEnabled = enabled;
    this._updateCpuUI();
  }

  /** Set black CPU enabled */
  cpuSetBlackEnabled(enabled: boolean): void {
    this.cpuBlackEnabled = enabled;
    this._updateCpuUI();
  }

  /** Set white capture preference (0-1) */
  cpuSetWhiteCapturePreference(pref: number): void {
    this.cpuWhiteCapturePreference = Math.max(0, Math.min(1, pref));
  }

  /** Set black capture preference (0-1) */
  cpuSetBlackCapturePreference(pref: number): void {
    this.cpuBlackCapturePreference = Math.max(0, Math.min(1, pref));
  }

  /** Main CPU tick - called repeatedly while enabled */
  private async _cpuTick(): Promise<void> {
    if (!this.cpuEnabled) return;

    // RACE CONDITION PREVENTION: If a move is already in progress OR pending, skip this tick
    // This prevents overlapping move execution when setTimeout callbacks fire during long operations
    // BUG FIX: Also check cpuPendingMove - a move might be scheduled but not yet executed
    if (this.cpuMoveInProgress || this.cpuPendingMove) {
      console.log('[CPU] Move in progress or pending, skipping tick', {
        inProgress: this.cpuMoveInProgress,
        pending: !!this.cpuPendingMove,
      });
      this.cpuTimer = window.setTimeout(() => this._cpuTick(), this.cpuMoveDelay);
      return;
    }

    // Check if ALL timelines are finished (checkmate or stalemate)
    // If so, stop CPU to avoid spinning forever
    if (this._cpuIsGameOver()) {
      console.log('[CPU] All timelines finished - stopping CPU');
      this.cpuStop();
      this._handleGameEnd();
      return;
    }

    // Check if this color's CPU is enabled
    const isWhiteTurn = this.cpuGlobalTurn === 'w';
    const cpuActiveForColor = isWhiteTurn ? this.cpuWhiteEnabled : this.cpuBlackEnabled;

    if (!cpuActiveForColor) {
      // This color's CPU is disabled, flip turn and continue
      this.cpuGlobalTurn = isWhiteTurn ? 'b' : 'w';
      this.cpuTimer = window.setTimeout(() => this._cpuTick(), this.cpuMoveDelay);
      return;
    }

    // Find ALL playable timelines for current color and make moves on each
    const playableTimelines = this._cpuGetPlayableTimelines();

    if (playableTimelines.length === 0) {
      // No playable timelines for this color - flip turn and keep ticking
      this.cpuGlobalTurn = isWhiteTurn ? 'b' : 'w';
      this.cpuTimer = window.setTimeout(() => this._cpuTick(), this.cpuMoveDelay);
      return;
    }

    // RACE CONDITION PREVENTION: Acquire lock before making move
    this.cpuMoveInProgress = true;

    try {
      // 5D-aware timeline selection: prioritize based on tactical evaluation
      const tlId = this._cpuSelectBestTimeline(playableTimelines);
      const moved = await this._cpuMakeMove(tlId);

      if (moved) {
        // After successful move, flip global turn
        this.cpuGlobalTurn = isWhiteTurn ? 'b' : 'w';
      } else {
        // Move failed - flip turn anyway to avoid getting stuck in infinite loop
        // This handles cases where time travel or cross-timeline moves fail
        console.warn('[CPU] Move failed, flipping turn to avoid stuck state');
        this.cpuGlobalTurn = isWhiteTurn ? 'b' : 'w';
      }
    } catch (error) {
      // Fatal error - flip turn and continue to prevent hanging
      console.error('[CPU] Fatal error during move execution:', error);
      this.cpuGlobalTurn = isWhiteTurn ? 'b' : 'w';
    } finally {
      // RACE CONDITION PREVENTION: Release lock after move completes
      this.cpuMoveInProgress = false;
    }

    // Schedule next tick
    this.cpuTimer = window.setTimeout(() => this._cpuTick(), this.cpuMoveDelay);
  }

  /** Check if game is completely over - all timelines in checkmate, stalemate, or draw */
  private _cpuIsGameOver(): boolean {
    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      // If any timeline is NOT in checkmate/stalemate/draw, game is not over
      if (!tl.chess.in_checkmate() && !tl.chess.in_stalemate() && !tl.chess.in_draw()) {
        return false;
      }
    }
    // All timelines finished
    return true;
  }

  /** Get all timelines where current color can play */
  private _cpuGetPlayableTimelines(): number[] {
    const playable: number[] = [];

    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      // Timeline is playable if it's this color's turn AND not in checkmate/stalemate/draw
      if (tl.chess.turn() === this.cpuGlobalTurn &&
          !tl.chess.in_checkmate() &&
          !tl.chess.in_stalemate() &&
          !tl.chess.in_draw()) {
        playable.push(tl.id);
      }
    }

    return playable;
  }

  /**
   * Evaluate material balance on a timeline (positive = white advantage)
   * Used for 5D-aware timeline prioritization
   */
  private _evaluateMaterial(fen: string): number {
    const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let score = 0;
    const boardPart = fen.split(' ')[0];
    for (const char of boardPart) {
      const piece = char.toLowerCase();
      if (pieceValues[piece] !== undefined) {
        const value = pieceValues[piece];
        score += char === char.toUpperCase() ? value : -value; // Upper = white
      }
    }
    return score;
  }

  /**
   * Pick the best timeline to play on (5D-aware selection)
   * Prioritizes timelines where:
   * - We have check opportunities
   * - We have material advantage (pressing)
   * - We're in danger (defending)
   */
  private _cpuSelectBestTimeline(playable: number[]): number {
    if (playable.length === 1) return playable[0];

    const isWhite = this.cpuGlobalTurn === 'w';
    let bestTlId = playable[0];
    let bestScore = -Infinity;

    for (const tlId of playable) {
      const tl = this.timelines[tlId];
      if (!tl) continue;

      let score = 0;
      const chess = tl.chess;

      // Priority 1: We can give check (high priority)
      const moves = chess.moves({ verbose: true }) as ChessMove[];
      const checkMoves = moves.filter((m) => m.san?.includes('+'));
      if (checkMoves.length > 0) score += 50;

      // Priority 2: We're in check (need to respond)
      if (chess.in_check()) score += 40;

      // Priority 3: Capture opportunities
      const captureMoves = moves.filter((m) => m.captured);
      score += captureMoves.length * 5;

      // Priority 4: Material evaluation (press advantage or defend weakness)
      const material = this._evaluateMaterial(chess.fen());
      // If white: positive material is good. If black: negative material is good
      const advantageMultiplier = isWhite ? material : -material;
      if (advantageMultiplier > 0) {
        // We have advantage - prioritize attacking here
        score += advantageMultiplier * 3;
      } else if (advantageMultiplier < 0) {
        // We're behind - prioritize defending here
        score += Math.abs(advantageMultiplier) * 2;
      }

      // Priority 5: Balance play across boards (prefer less-played timelines)
      // This prevents one board from getting 168 moves while another has 8
      const moveCount = tl.moveHistory.length;
      const avgMoves = playable.reduce((sum, id) => {
        const t = this.timelines[id];
        return sum + (t ? t.moveHistory.length : 0);
      }, 0) / playable.length;
      if (moveCount < avgMoves * 0.5) {
        // This board has less than half the average moves - prioritize it
        score += 20;
      } else if (moveCount < avgMoves * 0.8) {
        // Moderately under-played
        score += 10;
      }

      // Small random factor to avoid being too predictable
      score += Math.random() * 5;

      if (score > bestScore) {
        bestScore = score;
        bestTlId = tlId;
      }
    }

    return bestTlId;
  }

  // CPU pending move state
  private cpuPendingMove: {
    tlId: number;
    move: ChessMove;
    isWhite: boolean;
    isTimeTravel: boolean;
    isCrossTimeline: boolean;
    timeTravelData?: { sourceSquare: Square; targetTurnIndex: number; piece: Piece; capturedPiece: Piece | null | undefined };
    crossTimelineData?: { targetTimelineId: number; square: Square; piece: Piece };
  } | null = null;

  /** Make a CPU move on the given timeline (with preview pause) */
  private async _cpuMakeMove(tlId: number): Promise<boolean> {
    const tl = this.timelines[tlId];
    if (!tl) return false;

    // RACE CONDITION CHECK: Verify this timeline's turn matches global turn
    // This catches edge cases where state changed between selection and execution
    if (tl.chess.turn() !== this.cpuGlobalTurn) {
      console.error('[CPU] RACE CONDITION DETECTED: Turn mismatch!', {
        timelineId: tlId,
        timelineTurn: tl.chess.turn(),
        globalTurn: this.cpuGlobalTurn,
      });
      return false;
    }

    // Double-check: refuse to move if in checkmate, stalemate, or draw
    if (tl.chess.in_checkmate() || tl.chess.in_stalemate() || tl.chess.in_draw()) {
      console.log('[CPU] Skipping timeline', tlId, '- already in checkmate/stalemate/draw');
      return false;
    }

    const isWhite = tl.chess.turn() === 'w';
    const capturePreference = isWhite ? this.cpuWhiteCapturePreference : this.cpuBlackCapturePreference;

    // Switch to this timeline and animate camera if follow mode enabled
    if (this.activeTimelineId !== tlId) {
      this.setActiveTimeline(tlId, this.cpuCameraFollow);
    }

    // Get legal moves
    const moves = tl.chess.moves({ verbose: true }) as ChessMove[];
    if (moves.length === 0) {
      console.log('[CPU] No legal moves on timeline', tlId);
      return false;
    }

    // Check for time travel opportunity (if under timeline limit)
    // _cpuCheckTimeTravel already handles per-piece bias checks internally
    if (Object.keys(this.timelines).length < this.maxTimelines) {
      const timeTravelMove = this._cpuCheckTimeTravel(tlId);
      if (timeTravelMove) {
        // Store pending move and execute immediately (indicator shown after)
        this.cpuPendingMove = {
          tlId,
          move: { from: timeTravelMove.sourceSquare, to: timeTravelMove.sourceSquare } as ChessMove,
          isWhite,
          isTimeTravel: true,
          isCrossTimeline: false,
          timeTravelData: {
            sourceSquare: timeTravelMove.sourceSquare,
            targetTurnIndex: timeTravelMove.targetTurnIndex,
            piece: timeTravelMove.piece,
            capturedPiece: timeTravelMove.isCapture ? timeTravelMove.capturedPiece : null,
          },
        };

        // Execute immediately and return actual success status
        return this._cpuExecutePendingMove();
      }
    }

    // Check for cross-timeline opportunity (can always happen if multiple timelines exist)
    const crossTimelineMove = this._cpuCheckCrossTimeline(tlId);
    if (crossTimelineMove) {
      // Store pending move and execute immediately (indicator shown after)
      this.cpuPendingMove = {
        tlId,
        move: { from: crossTimelineMove.square, to: crossTimelineMove.square } as ChessMove,
        isWhite,
        isTimeTravel: false,
        isCrossTimeline: true,
        crossTimelineData: {
          targetTimelineId: crossTimelineMove.targetTimelineId,
          square: crossTimelineMove.square,
          piece: crossTimelineMove.piece,
        },
      };

      // Execute immediately and return actual success status
      return this._cpuExecutePendingMove();
    }

    // Use Stockfish for move selection if available, otherwise fall back to random
    const move = await this._selectCpuMove(tlId, tl.chess.fen(), moves, capturePreference, isWhite);
    if (!move) {
      console.warn('[CPU] No move selected, skipping');
      return false;
    }

    // Store pending move and execute immediately (indicator shown after)
    this.cpuPendingMove = { tlId, move, isWhite, isTimeTravel: false, isCrossTimeline: false };

    // Execute immediately and return actual success status
    return this._cpuExecutePendingMove();
  }

  /** Select a CPU move using Stockfish or random fallback */
  private async _selectCpuMove(
    tlId: number,
    fen: string,
    moves: ChessMove[],
    capturePreference: number,
    isWhite: boolean
  ): Promise<ChessMove | null> {
    // Try Stockfish first if enabled
    if (this.cpuUseStockfish && stockfish.available) {
      try {
        // Set skill level based on whose turn it is
        const skillLevel = isWhite ? this.cpuStockfishSkillWhite : this.cpuStockfishSkillBlack;
        stockfish.setSkillLevel(skillLevel);
        const sfMove = await stockfish.getBestMove(fen, this.cpuStockfishDepth);
        if (sfMove) {
          // Find matching move in legal moves list
          const matchingMove = moves.find(
            (m) => m.from === sfMove.from && m.to === sfMove.to
          );
          if (matchingMove) {
            // If Stockfish suggests a promotion, use it
            if (sfMove.promotion) {
              matchingMove.promotion = sfMove.promotion as 'n' | 'b' | 'r' | 'q';
            }
            return matchingMove;
          }
        }
      } catch (error) {
        console.warn('[CPU] Stockfish error, falling back to random:', error);
      }
    }

    // Fallback: pick a random legal move (with preference for captures)
    const captures = moves.filter((m) => m.captured);
    let move: ChessMove;

    if (captures.length > 0 && Math.random() < capturePreference) {
      move = captures[Math.floor(Math.random() * captures.length)];
    } else {
      move = moves[Math.floor(Math.random() * moves.length)];
    }

    return move;
  }

  /** Execute the pending CPU move and show indicator after. Returns true if successful. */
  private _cpuExecutePendingMove(): boolean {
    if (!this.cpuPendingMove) return false;

    const { tlId, move, isWhite, isTimeTravel, isCrossTimeline, timeTravelData, crossTimelineData } = this.cpuPendingMove;
    this.cpuPendingMove = null;

    // Clear any existing indicators first
    Board3D.clearAllCpuPreviews();

    try {
      if (isTimeTravel && timeTravelData) {
        // Execute time travel move
        console.log('[CPU] Time traveling!', { timeline: tlId });
        this._makeTimeTravelMove(
          tlId,
          timeTravelData.sourceSquare,
          timeTravelData.targetTurnIndex,
          timeTravelData.piece,
          timeTravelData.capturedPiece
        );
        // Show indicator on source square after move completes
        const col = Board3D.getTimeline(tlId);
        if (col) {
          col.showCpuMovePreview(timeTravelData.sourceSquare, timeTravelData.sourceSquare, isWhite, true);
          // Fade out after 800ms
          window.setTimeout(() => col.clearCpuMovePreview(), 800);
        }
        return true;
      } else if (isCrossTimeline && crossTimelineData) {
        // Execute cross-timeline move
        console.log('[CPU] Crossing timelines!', {
          from: tlId,
          to: crossTimelineData.targetTimelineId,
          piece: crossTimelineData.piece.type,
        });
        this.makeCrossTimelineMove(
          tlId,
          crossTimelineData.targetTimelineId,
          crossTimelineData.square,
          crossTimelineData.piece
        );
        // Show indicator on source square after move completes
        const col = Board3D.getTimeline(tlId);
        if (col) {
          col.showCpuMovePreview(crossTimelineData.square, crossTimelineData.square, isWhite, false);
          // Fade out after 800ms
          window.setTimeout(() => col.clearCpuMovePreview(), 800);
        }
        return true;
      } else {
        // Execute normal move (auto-queen for CPU promotions)
        this.makeMove(tlId, move, move.promotion ? 'q' : undefined);
        // Show indicator from->to after move completes
        const col = Board3D.getTimeline(tlId);
        if (col) {
          col.showCpuMovePreview(move.from, move.to, isWhite, false);
          // Fade out after 800ms
          window.setTimeout(() => col.clearCpuMovePreview(), 800);
        }
        return true;
      }
    } catch (error) {
      console.error('[CPU] Move execution failed:', error);
      return false;
    }
  }

  /** Check if CPU has a time travel opportunity on this timeline */
  private _cpuCheckTimeTravel(tlId: number): TimeTravelTarget & { sourceSquare: Square; piece: Piece } | null {
    const tl = this.timelines[tlId];
    if (!tl) return null;

    const color = tl.chess.turn();
    const board = tl.chess.board();
    const isWhite = color === 'w';
    const portalBiases = isWhite ? this.cpuWhitePortalBias : this.cpuBlackPortalBias;

    // Collect all portal opportunities with their biases
    const opportunities: Array<{
      target: TimeTravelTarget;
      sourceSquare: Square;
      piece: Piece;
      bias: number;
    }> = [];

    // Find pieces that can time travel (q, r, b, n)
    const timeTravelPieces = ['q', 'r', 'b', 'n'];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && timeTravelPieces.includes(piece.type) && piece.color === color) {
          const bias = portalBiases[piece.type] || 0;
          if (bias <= 0) continue; // Skip if bias is 0

          const square = (String.fromCharCode(97 + c) + (8 - r)) as Square;
          const targets = this._getTimeTravelTargets(tlId, square, piece);

          for (const target of targets) {
            opportunities.push({ target, sourceSquare: square, piece, bias });
          }
        }
      }
    }

    if (opportunities.length === 0) return null;

    // For each opportunity, roll dice based on its bias
    // Prefer captures, use highest-bias piece type
    const captures = opportunities.filter(o => o.target.isCapture);
    const pool = captures.length > 0 ? captures : opportunities;

    // Sort by bias (highest first) and pick from top opportunities
    pool.sort((a, b) => b.bias - a.bias);

    // Pick the first opportunity that passes its bias check
    for (const opp of pool) {
      if (Math.random() < opp.bias) {
        return { ...opp.target, sourceSquare: opp.sourceSquare, piece: opp.piece };
      }
    }

    return null;
  }

  /**
   * 5D-Aware CPU: Check for cross-timeline opportunities with strategic evaluation.
   * Considers board evaluations across ALL timelines to decide when to cross.
   */
  private _cpuCheckCrossTimeline(tlId: number): { targetTimelineId: number; square: Square; piece: Piece; isCapture: boolean } | null {
    const tl = this.timelines[tlId];
    if (!tl) return null;

    const timelineIds = Object.keys(this.timelines).map(Number);
    // Need at least 2 timelines to cross
    if (timelineIds.length < 2) return null;

    const color = tl.chess.turn();
    const board = tl.chess.board();
    const isWhite = color === 'w';
    const portalBiases = isWhite ? this.cpuWhitePortalBias : this.cpuBlackPortalBias;

    // 5D AWARENESS: Evaluate material balance on all timelines
    const timelineEvals: Record<number, number> = {};
    for (const id of timelineIds) {
      const timeline = this.timelines[id];
      if (timeline) {
        timelineEvals[id] = this._evaluateMaterialBalance(timeline.chess, color);
      }
    }

    // Current board evaluation (positive = winning, negative = losing)
    const sourceEval = timelineEvals[tlId] || 0;

    // Collect all cross-timeline opportunities with strategic scoring
    const opportunities: Array<{
      targetTimelineId: number;
      square: Square;
      piece: Piece;
      isCapture: boolean;
      bias: number;
      strategicScore: number;
    }> = [];

    // Find pieces that can cross timelines (all except king)
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.type !== 'k' && piece.color === color) {
          const baseBias = portalBiases[piece.type] || 0.1;
          if (baseBias <= 0) continue;

          const square = (String.fromCharCode(97 + c) + (8 - r)) as Square;
          const targets = this.getCrossTimelineTargets(tlId, square, piece);

          for (const target of targets) {
            const targetEval = timelineEvals[target.targetTimelineId] || 0;

            // Strategic scoring based on 5D chess awareness:
            // 1. If source board is LOSING and target is WINNING: HIGH priority (send reinforcements)
            // 2. If source board is WINNING and target is LOSING: MEDIUM priority (press advantage)
            // 3. Captures are always valuable
            // 4. Sending to boards where we're already winning = build overwhelming force

            let strategicScore = 0;

            // Capture bonus (very valuable in multi-board chess)
            if (target.isCapture) {
              strategicScore += 3;
            }

            // Piece value for the crossing piece
            const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
            const pieceValue = pieceValues[piece.type] || 1;

            // 5D tactical evaluation
            if (sourceEval > 3 && targetEval < -1) {
              // We're winning here, losing there - send reinforcements!
              strategicScore += 4;
            } else if (sourceEval < -1 && targetEval > 1) {
              // We're losing here but winning there - escape valuable pieces
              strategicScore += 2 + (pieceValue > 3 ? 2 : 0);
            } else if (targetEval > 2) {
              // Target board is favorable - build overwhelming force
              strategicScore += 2;
            }

            // Bonus for high-value pieces crossing (queens, rooks)
            if (pieceValue >= 5) {
              strategicScore += 1;
            }

            opportunities.push({
              targetTimelineId: target.targetTimelineId,
              square,
              piece,
              isCapture: target.isCapture,
              bias: baseBias,
              strategicScore,
            });
          }
        }
      }
    }

    if (opportunities.length === 0) return null;

    // Sort by strategic score (highest first), then by capture, then by bias
    opportunities.sort((a, b) => {
      if (b.strategicScore !== a.strategicScore) return b.strategicScore - a.strategicScore;
      if (a.isCapture !== b.isCapture) return a.isCapture ? -1 : 1;
      return b.bias - a.bias;
    });

    // 5D Aggressive mode: use slider-controlled cross-timeline chance
    for (const opp of opportunities) {
      // Base chance from slider, plus strategic bonus
      const baseChance = this.cpuCrossTimelineChance;
      const strategicBonus = opp.strategicScore * 0.10; // Each strategic point adds 10%
      const totalChance = Math.min(0.95, baseChance + strategicBonus);

      if (Math.random() < totalChance) {
        console.log('[CPU 5D] Cross-timeline move!', {
          from: tlId,
          to: opp.targetTimelineId,
          piece: opp.piece.type,
          isCapture: opp.isCapture,
          strategicScore: opp.strategicScore,
          chance: Math.round(totalChance * 100) + '%',
        });
        return {
          targetTimelineId: opp.targetTimelineId,
          square: opp.square,
          piece: opp.piece,
          isCapture: opp.isCapture,
        };
      }
    }

    return null;
  }

  /** Evaluate material balance for a position (positive = color is winning) */
  private _evaluateMaterialBalance(chess: ChessInstance, color: PieceColor): number {
    const board = chess.board();
    const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

    let whiteScore = 0;
    let blackScore = 0;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece) {
          const value = pieceValues[piece.type] || 0;
          if (piece.color === 'w') {
            whiteScore += value;
          } else {
            blackScore += value;
          }
        }
      }
    }

    // Return score relative to the specified color
    return color === 'w' ? whiteScore - blackScore : blackScore - whiteScore;
  }

  /** Update CPU UI elements */
  private _updateCpuUI(): void {
    const btn = document.getElementById('cpu-toggle');
    if (btn) {
      btn.textContent = this.cpuEnabled ? 'Stop CPU' : 'Start CPU';
      btn.classList.toggle('active', this.cpuEnabled);
    }

    const cameraBtn = document.getElementById('cpu-camera-toggle');
    if (cameraBtn) {
      // Keep the emoji icon, just update tooltip and active state
      cameraBtn.title = this.cpuCameraFollow ? 'Camera follow: ON (click to disable)' : 'Camera follow: OFF (click to enable)';
      cameraBtn.classList.toggle('active', this.cpuCameraFollow);
    }

    const whiteToggle = document.getElementById('cpu-white-toggle');
    if (whiteToggle) {
      whiteToggle.textContent = this.cpuWhiteEnabled ? 'ON' : 'OFF';
      whiteToggle.classList.toggle('active', this.cpuWhiteEnabled);
    }

    const blackToggle = document.getElementById('cpu-black-toggle');
    if (blackToggle) {
      blackToggle.textContent = this.cpuBlackEnabled ? 'ON' : 'OFF';
      blackToggle.classList.toggle('active', this.cpuBlackEnabled);
    }

    // Update Stockfish status and dumb mode toggle
    const stockfishStatus = document.getElementById('cpu-stockfish-status');
    const dumbToggle = document.getElementById('cpu-dumb-toggle');
    if (stockfishStatus) {
      if (!this.cpuUseStockfish) {
        stockfishStatus.textContent = 'Dumb Mode';
        stockfishStatus.classList.remove('ready');
        stockfishStatus.classList.add('dumb');
      } else if (stockfish.available) {
        stockfishStatus.textContent = 'Ready';
        stockfishStatus.classList.add('ready');
        stockfishStatus.classList.remove('error', 'dumb');
      } else {
        stockfishStatus.textContent = 'Loading...';
        stockfishStatus.classList.remove('ready', 'error', 'dumb');
      }
    }
    if (dumbToggle) {
      dumbToggle.textContent = this.cpuUseStockfish ? 'ON' : 'OFF';
      dumbToggle.classList.toggle('active', this.cpuUseStockfish);
      dumbToggle.title = this.cpuUseStockfish ? 'Stockfish enabled (click to disable)' : 'Stockfish disabled (click to enable)';
    }

    // Update 2D mode button
    this._update2DButtonUI();
  }

  /** Update 2D mode button UI state */
  private _update2DButtonUI(): void {
    const btn = document.getElementById('2d-mode-toggle');
    if (btn) {
      const is2D = Board3D.is2DMode();
      btn.title = is2D ? '2D view: ON (click for 3D)' : '2D view: OFF (click for 2D)';
      btn.classList.toggle('active', is2D);
    }
  }

  /** Set Stockfish skill level for White (0-20). Applied dynamically per-move in _selectCpuMove. */
  setStockfishSkillWhite(level: number): void {
    this.cpuStockfishSkillWhite = Math.max(0, Math.min(20, level));
  }

  /** Set Stockfish skill level for Black (0-20). Applied dynamically per-move in _selectCpuMove. */
  setStockfishSkillBlack(level: number): void {
    this.cpuStockfishSkillBlack = Math.max(0, Math.min(20, level));
  }

  /** Set Stockfish search depth (1-20) */
  setStockfishDepth(depth: number): void {
    this.cpuStockfishDepth = Math.max(1, Math.min(20, depth));
    stockfish.setSearchDepth(this.cpuStockfishDepth);
  }

  /** Toggle Stockfish usage */
  toggleStockfish(): void {
    this.cpuUseStockfish = !this.cpuUseStockfish;
    this._updateCpuUI();
  }

  /** Check if Stockfish is available */
  isStockfishAvailable(): boolean {
    return stockfish.available;
  }
}

// Export singleton instance
export const Game = new GameManager();
