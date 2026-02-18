/* 6D Chess - multiverse game controller with timeline branching */

import { Board3D, TimelineCol } from './board3d';
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
        // Invert: slider shows 100-2000, but we want higher slider = faster (lower delay)
        // So delay = 2100 - sliderValue (100->2000, 2000->100)
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

    // White CPU controls
    const whiteToggle = document.getElementById('cpu-white-toggle');
    if (whiteToggle) {
      whiteToggle.addEventListener('click', () => {
        this.cpuWhiteEnabled = !this.cpuWhiteEnabled;
        this._updateCpuUI();
      });
    }

    // Per-piece portal sliders for white
    const pieceTypes = ['q', 'r', 'b', 'n'] as const;
    for (const pt of pieceTypes) {
      const slider = document.getElementById(`cpu-white-portal-${pt}`) as HTMLInputElement | null;
      if (slider) {
        slider.addEventListener('input', () => {
          this.cpuWhitePortalBias[pt] = parseInt(slider.value) / 100;
        });
      }
    }

    const whiteCapture = document.getElementById('cpu-white-capture') as HTMLInputElement | null;
    if (whiteCapture) {
      whiteCapture.addEventListener('input', () => {
        this.cpuSetWhiteCapturePreference(parseInt(whiteCapture.value) / 100);
      });
    }

    // Black CPU controls
    const blackToggle = document.getElementById('cpu-black-toggle');
    if (blackToggle) {
      blackToggle.addEventListener('click', () => {
        this.cpuBlackEnabled = !this.cpuBlackEnabled;
        this._updateCpuUI();
      });
    }

    // Per-piece portal sliders for black
    for (const pt of pieceTypes) {
      const slider = document.getElementById(`cpu-black-portal-${pt}`) as HTMLInputElement | null;
      if (slider) {
        slider.addEventListener('input', () => {
          this.cpuBlackPortalBias[pt] = parseInt(slider.value) / 100;
        });
      }
    }

    const blackCapture = document.getElementById('cpu-black-capture') as HTMLInputElement | null;
    if (blackCapture) {
      blackCapture.addEventListener('input', () => {
        this.cpuSetBlackCapturePreference(parseInt(blackCapture.value) / 100);
      });
    }

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
      const maxHeight = 300;
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
    const xOffset = parentTl.xOffset + side * Board3D.TIMELINE_SPACING * Math.ceil((siblingCount + 1) / 2);

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

    const isWhite = piece.color === 'w';
    const targetPiece = targetTl.chess.get(square);

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
    const newSourceFen = this._modifyFen(sourceFen, square, null, !isWhite, false);
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
    const newSourceFen = this._modifyFen(sourceFen, sourceSquare, null, !isWhite, false);
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
    const xOffset = sourceTl.xOffset + side * Board3D.TIMELINE_SPACING * Math.ceil((siblingCount + 1) / 2);

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
   * @param isCapture - Set to true if this modification represents a capture
   */
  private _modifyFen(fen: string, square: Square, newPiece: Piece | null, whiteToMove: boolean, isCapture: boolean = false): string {
    const parts = fen.split(' ');
    const rows = parts[0].split('/');
    const pos = this._fromSq(square);

    // Convert FEN row to array of chars
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

    // Compress array back to FEN row
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

    // Modify the specific square
    console.log('[_modifyFen] pos:', pos, 'rows:', rows, 'rows[pos.r]:', rows[pos.r]);
    if (!rows[pos.r]) {
      console.error('[_modifyFen] Invalid row index:', pos.r, 'FEN rows:', rows);
      return fen;  // Return unchanged if invalid
    }
    const rowArr = expandRow(rows[pos.r]);
    console.log('[_modifyFen] expanded row:', rowArr);

    // Track what piece was there before
    const oldPieceChar = rowArr[pos.c];

    if (newPiece) {
      const pieceChar = newPiece.color === 'w'
        ? newPiece.type.toUpperCase()
        : newPiece.type.toLowerCase();
      rowArr[pos.c] = pieceChar;
    } else {
      rowArr[pos.c] = '';
    }
    rows[pos.r] = compressRow(rowArr);

    // Update board position
    parts[0] = rows.join('/');

    // Flip turn
    parts[1] = whiteToMove ? 'w' : 'b';

    // Update castling rights (parts[2]) - remove rights when rooks/kings move
    let castling = parts[2] || '-';
    if (castling !== '-') {
      // If a rook or king is being removed (newPiece is null), update castling
      if (!newPiece && oldPieceChar) {
        const removedPiece = oldPieceChar.toLowerCase();
        const isWhitePiece = oldPieceChar === oldPieceChar.toUpperCase();

        if (removedPiece === 'k') {
          // King removed - remove all castling rights for that color
          if (isWhitePiece) {
            castling = castling.replace(/[KQ]/g, '');
          } else {
            castling = castling.replace(/[kq]/g, '');
          }
        } else if (removedPiece === 'r') {
          // Rook removed - check which corner
          if (square === 'a1') castling = castling.replace('Q', '');
          else if (square === 'h1') castling = castling.replace('K', '');
          else if (square === 'a8') castling = castling.replace('q', '');
          else if (square === 'h8') castling = castling.replace('k', '');
        }
      }
      // If a piece is being placed on a rook square, also invalidate that castling
      if (newPiece) {
        if (square === 'a1') castling = castling.replace('Q', '');
        else if (square === 'h1') castling = castling.replace('K', '');
        else if (square === 'a8') castling = castling.replace('q', '');
        else if (square === 'h8') castling = castling.replace('k', '');
      }
      if (castling === '') castling = '-';
    }
    parts[2] = castling;

    // Always reset en passant on timeline branches/time travel
    // (The historical en passant is no longer valid since a move was made)
    parts[3] = '-';

    // Halfmove clock: reset on capture or pawn move, increment otherwise
    const isPawnMove = newPiece && newPiece.type === 'p';
    if (isCapture || isPawnMove) {
      parts[4] = '0';
    } else {
      // Non-capture, non-pawn move: increment halfmove clock
      parts[4] = String(parseInt(parts[4] || '0') + 1);
    }

    // Fullmove number: increment when it becomes white's turn (after black moved)
    if (whiteToMove) {
      parts[5] = String(parseInt(parts[5] || '1') + 1);
    }

    const result = parts.join(' ');

    // Validate the result by trying to parse it
    const testChess = new Chess();
    const valid = testChess.load(result);
    if (!valid) {
      const errorDetails = {
        input: fen,
        output: result,
        square,
        newPiece,
        pos,
        rowArr,
      };
      console.error('[_modifyFen] CRITICAL: Generated invalid FEN!', errorDetails);
      // Throw error to make validation failures obvious rather than silently returning original
      throw new Error(`FEN modification failed: invalid result "${result}" from input "${fen}" (square=${square}, newPiece=${JSON.stringify(newPiece)})`);
    }

    console.log('[_modifyFen] Result:', { input: fen, output: result, square, newPiece, valid });
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
    for (const target of targets) {
      const col = Board3D.getTimeline(target.targetTimelineId);
      if (col) {
        col.showCrossTimelineTarget(target.targetSquare, target.isCapture);
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
        '<span class="move">' + white + '</span>' +
        '<span class="move">' + black + '</span></div>';
    }
    // Only update DOM if content changed (avoids unnecessary re-renders)
    if (html !== this._lastMoveListHtml) {
      movesEl.innerHTML = html;
      movesEl.scrollTop = movesEl.scrollHeight;
      this._lastMoveListHtml = html;
    }
  }

  updateTimelineList(): void {
    const listEl = document.getElementById('timeline-list');
    if (!listEl) return;
    let html = '';
    const colors = Board3D.TIMELINE_COLORS;

    // Build parent-child relationships
    const childrenOf: Record<number, number[]> = {};
    for (const key in this.timelines) {
      const tl = this.timelines[key];
      if (tl.parentId !== null) {
        if (!childrenOf[tl.parentId]) childrenOf[tl.parentId] = [];
        childrenOf[tl.parentId].push(tl.id);
      }
    }

    for (const key in this.timelines) {
      const tl = this.timelines[key];
      const id = tl.id;
      const isActive = id === this.activeTimelineId;
      const color = colors[id % colors.length];
      const hexColor = '#' + color.toString(16).padStart(6, '0');
      // Use moveHistory instead of chess.history() because chess.load() wipes history
      const turnCount = tl.moveHistory.length;

      // Check if this timeline has children (is a branch point)
      const hasChildren = childrenOf[id] && childrenOf[id].length > 0;
      const branchCount = hasChildren ? childrenOf[id].length : 0;

      // Build branch indicator
      let branchIndicator = '';
      if (hasChildren) {
        branchIndicator =
          '<span class="tl-branch-count" title="' +
          branchCount +
          ' branch(es)">' +
          '\u2442' +
          branchCount +
          '</span>';
      }

      // Show parent info for child timelines
      let parentInfo = '';
      if (tl.parentId !== null) {
        const parentTl = this.timelines[tl.parentId];
        const parentName = parentTl ? parentTl.name : 'Unknown';
        parentInfo =
          '<span class="tl-parent" title="Branched from ' +
          parentName +
          ' at move ' +
          tl.branchTurn +
          '">\u21B3 ' +
          parentName +
          '@' +
          tl.branchTurn +
          '</span>';
      }

      html +=
        '<div class="tl-item' +
        (isActive ? ' active' : '') +
        (hasChildren ? ' has-branches' : '') +
        '" data-tl-id="' +
        id +
        '" data-children="' +
        (childrenOf[id] || []).join(',') +
        '">' +
        '<span class="tl-dot" style="background:' +
        hexColor +
        '"></span>' +
        '<div class="tl-info">' +
        '<span class="tl-label">' +
        tl.name +
        branchIndicator +
        '</span>' +
        parentInfo +
        '</div>' +
        '<span class="tl-turn">' +
        turnCount +
        '</span></div>';
    }

    // Only update DOM if content changed (avoids unnecessary re-renders)
    if (html !== this._lastTimelineListHtml) {
      listEl.innerHTML = html;
      this._lastTimelineListHtml = html;

      // Attach click and hover handlers
      const items = listEl.querySelectorAll('.tl-item');
      items.forEach((item) => {
        const tlId = parseInt((item as HTMLElement).dataset.tlId || '0');

        // Click to select timeline
        item.addEventListener('click', () => {
          this.setActiveTimeline(tlId);
        });

        // Hover to highlight connected timelines
        item.addEventListener('mouseenter', () => {
          this._highlightConnectedTimelines(tlId, true);
        });

        item.addEventListener('mouseleave', () => {
          this._highlightConnectedTimelines(tlId, false);
        });
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
  private maxTimelines = 10;   // Default to 10 branches, adjustable via slider (max 100)
  private cpuCameraFollow = true;  // Auto-follow moves with camera
  private cpuGlobalTurn: PieceColor = 'w';  // Track whose turn globally (independent of per-timeline state)

  // Per-color CPU settings
  private cpuWhiteEnabled = true;
  private cpuBlackEnabled = true;
  private cpuWhiteCapturePreference = 0.7;
  private cpuBlackCapturePreference = 0.7;

  // Per-piece portal biases (per color)
  private cpuWhitePortalBias: Record<string, number> = { q: 0.3, r: 0.2, b: 0.15, n: 0.1 };
  private cpuBlackPortalBias: Record<string, number> = { q: 0.3, r: 0.2, b: 0.15, n: 0.1 };

  /** Start CPU auto-play mode */
  cpuStart(): void {
    if (this.cpuEnabled) return;

    // Check if game is already over (all timelines in checkmate/stalemate)
    if (this._cpuIsGameOver()) {
      console.log('[CPU] Cannot start - all timelines already in checkmate/stalemate');
      return;
    }

    this.cpuEnabled = true;
    this._cpuTick();
    this._updateCpuUI();
  }

  /** Stop CPU auto-play mode */
  cpuStop(): void {
    this.cpuEnabled = false;
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

  /** Set max timelines/branches (5-100) */
  setMaxTimelines(count: number): void {
    this.maxTimelines = Math.max(5, Math.min(100, count));
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
  private _cpuTick(): void {
    if (!this.cpuEnabled) return;

    // Check if ALL timelines are finished (checkmate or stalemate)
    // If so, stop CPU to avoid spinning forever
    if (this._cpuIsGameOver()) {
      console.log('[CPU] All timelines finished - stopping CPU');
      this.cpuStop();
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

    // Make a move on ONE random playable timeline (to keep pace reasonable)
    const tlId = playableTimelines[Math.floor(Math.random() * playableTimelines.length)];
    const moved = this._cpuMakeMove(tlId);

    if (moved) {
      // After successful move, flip global turn
      this.cpuGlobalTurn = isWhiteTurn ? 'b' : 'w';
    }

    // Schedule next tick
    this.cpuTimer = window.setTimeout(() => this._cpuTick(), this.cpuMoveDelay);
  }

  /** Check if game is completely over - all timelines in checkmate or stalemate */
  private _cpuIsGameOver(): boolean {
    for (const key in this.timelines) {
      const tl = this.timelines[parseInt(key)];
      // If any timeline is NOT in checkmate/stalemate, game is not over
      if (!tl.chess.in_checkmate() && !tl.chess.in_stalemate()) {
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
      // Timeline is playable if it's this color's turn AND not in checkmate/stalemate
      if (tl.chess.turn() === this.cpuGlobalTurn &&
          !tl.chess.in_checkmate() &&
          !tl.chess.in_stalemate()) {
        playable.push(tl.id);
      }
    }

    return playable;
  }

  /** Make a CPU move on the given timeline */
  private _cpuMakeMove(tlId: number): boolean {
    const tl = this.timelines[tlId];
    if (!tl) return false;

    // Double-check: refuse to move if in checkmate or stalemate
    if (tl.chess.in_checkmate() || tl.chess.in_stalemate()) {
      console.log('[CPU] Skipping timeline', tlId, '- already in checkmate/stalemate');
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
        // Execute time travel move!
        console.log('[CPU] Time traveling!', { color: isWhite ? 'white' : 'black', timeline: tlId });
        this._makeTimeTravelMove(
          tlId,
          timeTravelMove.sourceSquare,
          timeTravelMove.targetTurnIndex,
          timeTravelMove.piece,
          timeTravelMove.isCapture ? timeTravelMove.capturedPiece : null
        );
        return true;
      }
    }

    // Check for cross-timeline opportunity (can always happen if multiple timelines exist)
    const crossTimelineMove = this._cpuCheckCrossTimeline(tlId);
    if (crossTimelineMove) {
      console.log('[CPU] Crossing timelines!', {
        color: isWhite ? 'white' : 'black',
        from: tlId,
        to: crossTimelineMove.targetTimelineId,
        piece: crossTimelineMove.piece.type,
      });
      this.makeCrossTimelineMove(
        tlId,
        crossTimelineMove.targetTimelineId,
        crossTimelineMove.square,
        crossTimelineMove.piece
      );
      return true;
    }

    // Otherwise, pick a random legal move (with preference for captures based on setting)
    const captures = moves.filter(m => m.captured);
    let move: ChessMove;

    if (captures.length > 0 && Math.random() < capturePreference) {
      move = captures[Math.floor(Math.random() * captures.length)];
    } else {
      move = moves[Math.floor(Math.random() * moves.length)];
    }

    // Execute the move (auto-queen for CPU promotions)
    this.makeMove(tlId, move, move.promotion ? 'q' : undefined);
    return true;
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

  /** Check if CPU has a cross-timeline opportunity on this timeline */
  private _cpuCheckCrossTimeline(tlId: number): { targetTimelineId: number; square: Square; piece: Piece; isCapture: boolean } | null {
    const tl = this.timelines[tlId];
    if (!tl) return null;

    // Need at least 2 timelines to cross
    if (Object.keys(this.timelines).length < 2) return null;

    const color = tl.chess.turn();
    const board = tl.chess.board();
    const isWhite = color === 'w';
    const portalBiases = isWhite ? this.cpuWhitePortalBias : this.cpuBlackPortalBias;

    // Collect all cross-timeline opportunities
    const opportunities: Array<{
      targetTimelineId: number;
      square: Square;
      piece: Piece;
      isCapture: boolean;
      bias: number;
    }> = [];

    // Find pieces that can cross timelines (all except king)
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.type !== 'k' && piece.color === color) {
          const bias = portalBiases[piece.type] || 0.1;  // Default 10% for pieces without explicit bias
          if (bias <= 0) continue;

          const square = (String.fromCharCode(97 + c) + (8 - r)) as Square;
          const targets = this.getCrossTimelineTargets(tlId, square, piece);

          for (const target of targets) {
            opportunities.push({
              targetTimelineId: target.targetTimelineId,
              square,
              piece,
              isCapture: target.isCapture,
              bias,
            });
          }
        }
      }
    }

    if (opportunities.length === 0) return null;

    // Prefer captures, use highest-bias piece type
    const captures = opportunities.filter(o => o.isCapture);
    const pool = captures.length > 0 ? captures : opportunities;

    // Sort by bias (highest first)
    pool.sort((a, b) => b.bias - a.bias);

    // Pick the first opportunity that passes its bias check (lower chance than time travel)
    for (const opp of pool) {
      // Cross-timeline is less dramatic than time travel, use half the bias
      if (Math.random() < opp.bias * 0.5) {
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

  /** Update CPU UI elements */
  private _updateCpuUI(): void {
    const btn = document.getElementById('cpu-toggle');
    if (btn) {
      btn.textContent = this.cpuEnabled ? 'Stop CPU' : 'Start CPU';
      btn.classList.toggle('active', this.cpuEnabled);
    }

    const cameraBtn = document.getElementById('cpu-camera-toggle');
    if (cameraBtn) {
      cameraBtn.textContent = this.cpuCameraFollow ? 'Camera Follow: ON' : 'Camera Follow: OFF';
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
  }
}

// Export singleton instance
export const Game = new GameManager();
