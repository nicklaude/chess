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

  init(): void {
    Board3D.init('scene-container', (info) => this.handleClick(info));

    const resetBtn = document.getElementById('reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.reset());
    }

    // Setup keyboard navigation
    this._setupKeyboardNav();

    // Setup move slider
    this._setupMoveSlider();

    // Setup command input for programmatic testing
    this._setupCommandInput();

    // Create the main timeline
    this._createTimeline(0, 0, null, -1, null);
    this.setActiveTimeline(0);
    this.renderTimeline(0);
    this.updateStatus();
    this.updateTimelineList();
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
      this.makeTimeTravelMove(
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
        console.error('[_createTimeline] Failed to load FEN:', initialFen);
        // Fallback to starting position
        chess = new Chess();
      }
    } else {
      chess = new Chess();
    }

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

  setActiveTimeline(id: number): void {
    const previousId = this.activeTimelineId;
    this.activeTimelineId = id;
    this.viewingMoveIndex = null; // Reset to current position when switching timelines
    Board3D.setActiveTimeline(id);
    this.clearSelection();
    this.updateStatus();
    this.updateMoveList();
    this.updateTimelineList();
    this._updateMoveSlider();

    // Auto-focus on the new timeline with animation (if switching timelines)
    if (previousId !== id) {
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
        this.makeTimeTravelMove(
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
        this.makeMove(tlId, targetMove);
        return;
      }

      if (sq === this.selected) {
        this.clearSelection();
        return;
      }
    }

    if (piece && piece.color === chess.turn()) {
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
        const timeTravelTargets = this.getTimeTravelTargets(tlId, sq as Square, piece);
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
    const existingCount = Object.keys(this.timelines).length;
    const side = existingCount % 2 === 0 ? 1 : -1;
    const xOffset = parentTl.xOffset + side * Board3D.TIMELINE_SPACING * Math.ceil(existingCount / 2);

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

    // Switch to the new timeline
    this.setActiveTimeline(newId);
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
  }

  /* -- Move execution -- */
  makeMove(tlId: number, move: ChessMove, promotionPiece?: PieceType): void {
    const tl = this.timelines[tlId];
    if (!tl) return;
    const chess = tl.chess;
    const isWhite = chess.turn() === 'w';

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

    // Store the actual promotion piece used (if any)
    tl.moveHistory.push({
      from: move.from as Move['from'],
      to: move.to as Move['to'],
      piece: move.piece,
      captured: move.captured || null,
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

    this.clearSelection();
    this.renderTimeline(tlId);
    this.updateStatus();
    this.updateMoveList();
    this.updateTimelineList();
    this._updateMoveSlider();
  }

  /* -- Cross-Timeline Movement -- */

  /** Check if a piece type can move across timelines (only Queen for now) */
  private canMoveCrossTimeline(pieceType: PieceType): boolean {
    return pieceType === 'q';  // Only Queen can cross timelines
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

    // Clone boards before move for snapshots
    const sourceBoardBefore = this._cloneBoard(sourceTl.chess);
    const targetBoardBefore = this._cloneBoard(targetTl.chess);

    // 1. Remove piece from source timeline
    // Load FEN, modify board, reload
    const sourceFen = sourceTl.chess.fen();
    const sourceBoard = sourceTl.chess.board();
    const pos = this._fromSq(square);

    // Build new FEN without the piece
    // For simplicity, we set the square to empty and flip turn
    const newSourceFen = this._modifyFen(sourceFen, square, null, !isWhite);
    sourceTl.chess.load(newSourceFen);

    // 2. Add piece to target timeline (capture if enemy piece there)
    const targetFen = targetTl.chess.fen();
    const newTargetFen = this._modifyFen(targetFen, square, piece, !isWhite);
    targetTl.chess.load(newTargetFen);

    // 3. Record the move in both timelines
    const crossMove: Move = {
      from: square,
      to: square,
      piece: piece.type,
      captured: targetPiece?.type || null,
      san: `Q${square}→T${targetTimelineId}`,  // Custom notation for cross-timeline
      isWhite,
    };

    // Source timeline: piece left
    sourceTl.moveHistory.push({
      ...crossMove,
      san: `Q${square}→T${targetTimelineId}`,
    });
    sourceTl.snapshots.push(this._cloneBoard(sourceTl.chess));

    // Target timeline: piece arrived (possibly captured)
    targetTl.moveHistory.push({
      ...crossMove,
      san: `Q${square}←T${sourceTimelineId}`,
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

    // 5. Update UI
    this.clearSelection();
    this.renderTimeline(sourceTimelineId);
    this.renderTimeline(targetTimelineId);
    this.updateStatus();
    this.updateMoveList();
    this.updateTimelineList();
    this._updateMoveSlider();
  }

  /* -- Time Travel Movement (backward in time) -- */

  /** Get all valid time travel targets for a queen (moving backward in time) */
  private getTimeTravelTargets(
    sourceTimelineId: number,
    square: Square,
    piece: Piece
  ): TimeTravelTarget[] {
    if (piece.type !== 'q') return [];  // Only queens can time travel

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
      if (!targetPiece || targetPiece.color !== piece.color) {
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

  /** Execute a time travel move - queen goes back in time, creating a new timeline */
  private makeTimeTravelMove(
    sourceTimelineId: number,
    sourceSquare: Square,
    targetTurnIndex: number,
    piece: Piece,
    capturedPiece: Piece | null | undefined
  ): void {
    const sourceTl = this.timelines[sourceTimelineId];
    if (!sourceTl) return;

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

    // 1. Remove queen from source timeline (it traveled away)
    const sourceFen = sourceTl.chess.fen();
    const newSourceFen = this._modifyFen(sourceFen, sourceSquare, null, !isWhite);
    sourceTl.chess.load(newSourceFen);

    // Record the departure move on source timeline
    sourceTl.moveHistory.push({
      from: sourceSquare,
      to: sourceSquare,
      piece: 'q',
      captured: null,
      san: `Q${sourceSquare}⟳T${targetTurnIndex}`,  // Time travel notation
      isWhite,
    });
    sourceTl.snapshots.push(this._cloneBoard(sourceTl.chess));

    // Update source timeline visual
    const sourceCol = Board3D.getTimeline(sourceTimelineId);
    if (sourceCol) {
      sourceCol.addSnapshot(this._getSnapshotBoard(sourceBoardBefore), sourceSquare, sourceSquare, isWhite);
      sourceCol.showLastMove(sourceSquare, sourceSquare);
    }

    // 2. Create a NEW timeline branching from that historical point
    const newId = this.nextTimelineId++;

    // Calculate x offset: alternate left/right of parent
    const existingCount = Object.keys(this.timelines).length;
    const side = existingCount % 2 === 0 ? 1 : -1;
    const xOffset = sourceTl.xOffset + side * Board3D.TIMELINE_SPACING * Math.ceil(existingCount / 2);

    console.log('[Time Travel] Creating new timeline:', {
      originalFen: fen,
      sourceSquare,
      piece,
      snapshotIdx,
    });

    // Create the new timeline with the ORIGINAL historical FEN
    // (We'll add the time-traveled piece manually to allow extra queens)
    const newTl = this._createTimeline(newId, xOffset, sourceTimelineId, snapshotIdx, fen);

    // Now manually place the time-traveled queen using chess.put()
    // This bypasses validation that would reject multiple queens
    const targetSquare = sourceSquare;  // Queen appears at same square, different time

    // Remove any piece currently on target (capture)
    const existingPiece = newTl.chess.get(targetSquare);
    if (existingPiece) {
      newTl.chess.remove(targetSquare);
    }

    // Place the time-traveled queen
    const placed = newTl.chess.put(piece, targetSquare);
    if (!placed) {
      console.error('[Time Travel] Failed to place queen at', targetSquare);
    }

    // Note: We don't flip the turn here because chess.load() would reject
    // the 2-queen FEN. The turn tracking is handled by our moveHistory,
    // and the opponent will play next on this timeline.

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
      piece: 'q',
      captured: capturedPiece?.type || null,
      san: `Q${sourceSquare}⟳←T${sourceTimelineId}`,  // Arrived via time travel
      isWhite,
    });

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

    // 4. Switch to the new timeline
    this.clearSelection();
    this.setActiveTimeline(newId);
    this.renderTimeline(sourceTimelineId);
    this.renderTimeline(newId);
    this.updateTimelineList();
    this._updateMoveSlider();
  }

  /** Helper: Modify a FEN string to change a square's piece and flip turn */
  private _modifyFen(fen: string, square: Square, newPiece: Piece | null, whiteToMove: boolean): string {
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
    if (newPiece) {
      const pieceChar = newPiece.color === 'w'
        ? newPiece.type.toUpperCase()
        : newPiece.type.toLowerCase();
      rowArr[pos.c] = pieceChar;
    } else {
      rowArr[pos.c] = '';
    }
    rows[pos.r] = compressRow(rowArr);

    // Flip turn
    parts[0] = rows.join('/');
    parts[1] = whiteToMove ? 'w' : 'b';

    const result = parts.join(' ');

    // Validate the result by trying to parse it
    const testChess = new Chess();
    const valid = testChess.load(result);
    if (!valid) {
      console.error('[_modifyFen] Generated invalid FEN!', {
        input: fen,
        output: result,
        square,
        newPiece,
        pos,
        rowArr,
      });
      // Return original FEN if we broke it
      return fen;
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
    if (!tl) return;
    Board3D.getTimeline(tlId)?.render(tl.chess.board());
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
  }

  updateMoveList(): void {
    const movesEl = document.getElementById('moves');
    if (!movesEl) return;
    const tl = this.timelines[this.activeTimelineId];
    if (!tl) {
      movesEl.innerHTML = '';
      return;
    }
    const history = tl.chess.history() as string[];
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
    movesEl.innerHTML = html;
    movesEl.scrollTop = movesEl.scrollHeight;
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
      const turnCount = (tl.chess.history() as string[]).length;

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

    listEl.innerHTML = html;

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

  /* -- Branch Point Indicators -- */
  private _highlightConnectedTimelines(tlId: number, highlight: boolean): void {
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
  }
}

// Export singleton instance
export const Game = new GameManager();
