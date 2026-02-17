/* 6D Chess - multiverse game controller with timeline branching */

import { Board3D, TimelineCol } from './board3d';
import type {
  Board,
  Piece,
  PieceType,
  Move,
  ChessMove,
  ChessInstance,
  TimelineData,
  AnySnapshot,
  Snapshot,
  PendingPromotion,
  SquareClickInfo,
} from './types';

class GameManager {
  private timelines: Record<number, TimelineData> = {};
  private activeTimelineId = 0;
  private nextTimelineId = 1;
  private selected: string | null = null;
  private selectedTimelineId: number | null = null;
  private pendingPromotion: PendingPromotion | null = null;
  private viewingMoveIndex: number | null = null;

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
        case 't':
        case 'T':
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
      chess = new Chess(initialFen);
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

    // Clicking on a history board -> potential fork
    if (isHistory) {
      this._handleHistoryClick(tlId, turn, sq);
      return;
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
    } else {
      this.clearSelection();
    }
  }

  private _handleHistoryClick(tlId: number, turnIndex: number, sq: string): void {
    const tl = this.timelines[tlId];
    if (!tl) return;

    // Get the board state at that turn
    // turnIndex 0 = most recent history, which is snapshot at (total snapshots - 2)
    const snapshotIdx = tl.snapshots.length - 2 - turnIndex;
    if (snapshotIdx < 0) return;

    const snapshot = tl.snapshots[snapshotIdx];
    if (!snapshot) return;

    // Check if there's a piece belonging to current turn player
    const pos = this._fromSq(sq);
    const board = this._getSnapshotBoard(snapshot);
    const piece = board[pos.r][pos.c];
    if (!piece) return;

    // Determine whose turn it was at that snapshot
    // Try to get turn from FEN first (accurate for nested forks)
    let turnColor = this._getSnapshotTurn(snapshot);
    if (!turnColor) {
      // Fallback for old snapshots without FEN: use index parity
      // (This is less accurate for nested forks but maintains backward compat)
      turnColor = snapshotIdx % 2 === 0 ? 'w' : 'b';
    }
    if (piece.color !== turnColor) return;

    // Fork! Create a new timeline from this point
    this._forkTimeline(tlId, snapshotIdx, sq);
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
    this.selected = null;
    this.selectedTimelineId = null;
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
