/* Stockfish Integration for 6D Chess CPU Play */

import type { Square } from './types';

export interface StockfishMove {
  from: Square;
  to: Square;
  promotion?: string;
}

/**
 * StockfishManager - Manages Stockfish chess engine for CPU play
 *
 * Uses stockfish.js Web Worker from CDN for UCI chess engine
 * Handles UCI protocol communication with the engine
 */
export class StockfishManager {
  private worker: Worker | null = null;
  private isReady = false;
  private isLoading = false;
  private pendingResolve: ((move: StockfishMove | null) => void) | null = null;
  private _skillLevel = 10; // 0-20, default middle
  private _searchDepth = 10; // 1-20, default reasonable depth
  private _onReadyCallbacks: (() => void)[] = [];

  constructor() {
    // Load Stockfish on construction
    this.loadEngine();
  }

  /**
   * Register a callback to be called when the engine becomes ready
   */
  onReady(callback: () => void): void {
    if (this.isReady) {
      callback();
    } else {
      this._onReadyCallbacks.push(callback);
    }
  }

  /**
   * Notify all registered callbacks that the engine is ready
   */
  private _notifyReady(): void {
    for (const cb of this._onReadyCallbacks) {
      try {
        cb();
      } catch (e) {
        console.error('[Stockfish] onReady callback error:', e);
      }
    }
    this._onReadyCallbacks = [];
  }

  /**
   * Load the Stockfish engine as a Web Worker with proper WASM path resolution
   */
  async loadEngine(): Promise<boolean> {
    if (this.worker) {
      return true;
    }

    if (this.isLoading) {
      // Wait for existing load to complete
      return new Promise((resolve) => {
        const checkReady = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkReady);
            resolve(true);
          } else if (!this.isLoading && !this.worker) {
            clearInterval(checkReady);
            resolve(false);
          }
        }, 100);
      });
    }

    this.isLoading = true;

    try {
      // Create the worker using the wrapper script that handles WASM path resolution
      // The wrapper script uses self.location.href to determine the base URL
      // which works correctly when loaded from a direct file path
      const workerUrl = new URL('lib/stockfish-worker.js', window.location.href).href;
      console.log('[Stockfish] Creating worker from:', workerUrl);

      this.worker = new Worker(workerUrl);

      // Setup message handler
      this.worker.onmessage = (e) => this.handleMessage(String(e.data));

      this.worker.onerror = (err) => {
        console.error('[Stockfish] Worker error:', err);
      };

      // Initialize UCI
      this.worker.postMessage('uci');

      // Wait for uciok
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Stockfish UCI timeout'));
        }, 10000); // 10s timeout for loading WASM

        const checkReady = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkReady);
            clearTimeout(timeout);
            resolve();
          }
        }, 50);
      });

      // Set default skill level
      this.setSkillLevel(this._skillLevel);

      console.log('[Stockfish] Engine loaded and ready');
      this.isLoading = false;

      // Notify any registered callbacks
      this._notifyReady();

      return true;
    } catch (error) {
      console.error('[Stockfish] Failed to load engine:', error);
      this.worker?.terminate();
      this.worker = null;
      this.isLoading = false;
      return false;
    }
  }

  /**
   * Handle UCI messages from the engine
   */
  private handleMessage(msg: string): void {
    // console.log('[Stockfish] Message:', msg);

    if (msg === 'uciok') {
      this.isReady = true;
    } else if (msg.startsWith('bestmove')) {
      // Parse bestmove response: "bestmove e2e4 ponder d7d5"
      const parts = msg.split(' ');
      if (parts.length >= 2 && parts[1] !== '(none)') {
        const moveStr = parts[1];
        const move = this.parseMoveString(moveStr);
        if (this.pendingResolve) {
          this.pendingResolve(move);
          this.pendingResolve = null;
        }
      } else {
        // No legal move (shouldn't happen in normal play)
        if (this.pendingResolve) {
          this.pendingResolve(null);
          this.pendingResolve = null;
        }
      }
    }
  }

  /**
   * Parse a UCI move string like "e2e4" or "e7e8q" to StockfishMove
   */
  private parseMoveString(moveStr: string): StockfishMove | null {
    if (moveStr.length < 4) return null;

    const from = moveStr.substring(0, 2) as Square;
    const to = moveStr.substring(2, 4) as Square;
    const promotion = moveStr.length > 4 ? moveStr.charAt(4) : undefined;

    return { from, to, promotion };
  }

  /**
   * Set the engine skill level (0-20)
   * 0 = weakest, 20 = strongest
   */
  setSkillLevel(level: number): void {
    this._skillLevel = Math.max(0, Math.min(20, level));
    if (this.worker && this.isReady) {
      this.worker.postMessage(`setoption name Skill Level value ${this._skillLevel}`);
    }
  }

  get skillLevel(): number {
    return this._skillLevel;
  }

  /**
   * Set the search depth (1-20)
   */
  setSearchDepth(depth: number): void {
    this._searchDepth = Math.max(1, Math.min(20, depth));
  }

  get searchDepth(): number {
    return this._searchDepth;
  }

  /**
   * Check if the engine is available and ready
   */
  get available(): boolean {
    return this.worker !== null && this.isReady;
  }

  /**
   * Get the best move for a given position (FEN)
   * @param fen - The position in FEN notation
   * @param depth - Optional search depth override (uses instance depth if not specified)
   * @returns Promise<StockfishMove | null> - The best move or null if unavailable
   */
  async getBestMove(fen: string, depth?: number): Promise<StockfishMove | null> {
    if (!this.worker || !this.isReady) {
      // Try to load engine if not ready
      const loaded = await this.loadEngine();
      if (!loaded) {
        console.warn('[Stockfish] Engine not available, returning null');
        return null;
      }
    }

    // Use provided depth or instance depth
    const searchDepth = depth ?? this._searchDepth;

    return new Promise((resolve) => {
      // Set up a timeout in case engine hangs
      const timeout = setTimeout(() => {
        console.warn('[Stockfish] Search timed out');
        this.pendingResolve = null;
        this.worker?.postMessage('stop');
        resolve(null);
      }, 10000); // 10 second timeout

      this.pendingResolve = (move) => {
        clearTimeout(timeout);
        resolve(move);
      };

      // Send position and search command
      this.worker!.postMessage(`position fen ${fen}`);
      this.worker!.postMessage(`go depth ${searchDepth}`);
    });
  }

  /**
   * Stop any ongoing search
   */
  stop(): void {
    if (this.worker) {
      this.worker.postMessage('stop');
      if (this.pendingResolve) {
        this.pendingResolve(null);
        this.pendingResolve = null;
      }
    }
  }

  /**
   * Reset the engine for a new game
   */
  newGame(): void {
    if (this.worker && this.isReady) {
      this.worker.postMessage('ucinewgame');
    }
  }
}

// Export singleton instance
export const stockfish = new StockfishManager();
