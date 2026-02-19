/**
 * TimelineTransaction - Provides rollback semantics for timeline operations
 *
 * When time travel or cross-timeline moves fail mid-operation, the game state
 * can be left inconsistent. This class captures state before modification and
 * provides rollback capability if any step fails.
 *
 * Usage:
 *   const transaction = new TimelineTransaction();
 *   try {
 *     transaction.captureTimeline(sourceTimeline, 'source');
 *     // ... modify source ...
 *     transaction.captureNewTimeline(newId);
 *     // ... create and modify new timeline ...
 *     transaction.commit();
 *   } catch (error) {
 *     transaction.rollback();
 *     throw error;
 *   }
 */

import type {
  TimelineData,
  Move,
  AnySnapshot,
  Board,
  Piece,
  ChessInstance,
} from './types';

/** Captured state of a timeline for rollback */
interface TimelineState {
  id: number;
  fen: string;
  moveHistory: Move[];
  snapshots: AnySnapshot[];
  label: string;  // For debugging: 'source', 'target', etc.
}

/** Tracks a newly created timeline that should be deleted on rollback */
interface NewTimelineRecord {
  id: number;
}

export class TimelineTransaction {
  private capturedStates: Map<number, TimelineState> = new Map();
  private newTimelineIds: number[] = [];
  private committed = false;
  private rolledBack = false;

  /**
   * Capture the current state of a timeline before modification.
   * Call this BEFORE making any changes to the timeline.
   *
   * @param timeline - The timeline data to capture
   * @param label - A label for debugging (e.g., 'source', 'target')
   */
  captureTimeline(timeline: TimelineData, label: string): void {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already finalized');
    }

    // Don't re-capture if already captured
    if (this.capturedStates.has(timeline.id)) {
      console.log(`[Transaction] Timeline ${timeline.id} already captured, skipping`);
      return;
    }

    const state: TimelineState = {
      id: timeline.id,
      fen: timeline.chess.fen(),
      moveHistory: this.deepCloneMoveHistory(timeline.moveHistory),
      snapshots: this.deepCloneSnapshots(timeline.snapshots),
      label,
    };

    this.capturedStates.set(timeline.id, state);
    console.log(`[Transaction] Captured timeline ${timeline.id} (${label}):`, {
      fen: state.fen,
      moveCount: state.moveHistory.length,
      snapshotCount: state.snapshots.length,
    });
  }

  /**
   * Record a newly created timeline ID.
   * On rollback, this timeline will be deleted from the timelines registry.
   *
   * @param id - The ID of the newly created timeline
   */
  captureNewTimeline(id: number): void {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already finalized');
    }

    this.newTimelineIds.push(id);
    console.log(`[Transaction] Recorded new timeline: ${id}`);
  }

  /**
   * Commit the transaction - marks it as successful.
   * After commit, rollback is not possible.
   */
  commit(): void {
    if (this.committed || this.rolledBack) {
      throw new Error('Transaction already finalized');
    }

    this.committed = true;
    console.log('[Transaction] Committed successfully', {
      capturedTimelines: Array.from(this.capturedStates.keys()),
      newTimelines: this.newTimelineIds,
    });
  }

  /**
   * Rollback all changes made during this transaction.
   * Restores captured timelines to their original state and deletes new timelines.
   *
   * @param timelines - The timelines registry (Record<number, TimelineData>)
   * @param onDeleteTimeline - Optional callback to handle timeline deletion (e.g., 3D cleanup)
   */
  rollback(
    timelines: Record<number, TimelineData>,
    onDeleteTimeline?: (id: number) => void
  ): void {
    if (this.committed) {
      throw new Error('Cannot rollback a committed transaction');
    }
    if (this.rolledBack) {
      console.warn('[Transaction] Already rolled back, ignoring duplicate rollback call');
      return;
    }

    console.log('[Transaction] Rolling back...', {
      capturedTimelines: Array.from(this.capturedStates.keys()),
      newTimelines: this.newTimelineIds,
    });

    // 1. Delete any newly created timelines
    for (const newId of this.newTimelineIds) {
      if (timelines[newId]) {
        console.log(`[Transaction] Deleting new timeline: ${newId}`);
        if (onDeleteTimeline) {
          onDeleteTimeline(newId);
        }
        delete timelines[newId];
      }
    }

    // 2. Restore captured timelines to their original state
    for (const [id, state] of this.capturedStates) {
      const timeline = timelines[id];
      if (!timeline) {
        console.warn(`[Transaction] Timeline ${id} not found during rollback, skipping`);
        continue;
      }

      console.log(`[Transaction] Restoring timeline ${id} (${state.label}) to:`, {
        fen: state.fen,
        moveCount: state.moveHistory.length,
        snapshotCount: state.snapshots.length,
      });

      // Restore FEN (game state)
      const loaded = timeline.chess.load(state.fen);
      if (!loaded) {
        console.error(`[Transaction] CRITICAL: Failed to restore FEN for timeline ${id}:`, state.fen);
        // Continue anyway - partial rollback is better than none
      }

      // Restore move history
      timeline.moveHistory = this.deepCloneMoveHistory(state.moveHistory);

      // Restore snapshots
      timeline.snapshots = this.deepCloneSnapshots(state.snapshots);
    }

    this.rolledBack = true;
    console.log('[Transaction] Rollback complete');
  }

  /**
   * Check if this transaction has been finalized (committed or rolled back)
   */
  isFinalized(): boolean {
    return this.committed || this.rolledBack;
  }

  /**
   * Check if this transaction was committed
   */
  isCommitted(): boolean {
    return this.committed;
  }

  /**
   * Check if this transaction was rolled back
   */
  isRolledBack(): boolean {
    return this.rolledBack;
  }

  // ===============================================================
  // Private helper methods for deep cloning
  // ===============================================================

  private deepCloneMoveHistory(moves: Move[]): Move[] {
    return moves.map(m => ({
      from: m.from,
      to: m.to,
      piece: m.piece,
      captured: m.captured,
      san: m.san,
      isWhite: m.isWhite,
      promotion: m.promotion,
    }));
  }

  private deepCloneSnapshots(snapshots: AnySnapshot[]): AnySnapshot[] {
    return snapshots.map(snapshot => this.deepCloneSnapshot(snapshot));
  }

  private deepCloneSnapshot(snapshot: AnySnapshot): AnySnapshot {
    // Handle both old format (array) and new format (object with fen/board)
    if (Array.isArray(snapshot)) {
      // Old format: just board array
      return this.deepCloneBoard(snapshot);
    }
    // New format: { fen, board }
    return {
      fen: snapshot.fen,
      board: this.deepCloneBoard(snapshot.board),
    };
  }

  private deepCloneBoard(board: Board): Board {
    const clone: Board = [];
    for (let r = 0; r < 8; r++) {
      clone[r] = [];
      for (let c = 0; c < 8; c++) {
        const p = board[r]?.[c];
        clone[r][c] = p ? { type: p.type, color: p.color } : null;
      }
    }
    return clone;
  }
}
