/* 6D Chess - Main Entry Point */

import { Game } from './game';

// Declare lucide global from CDN
declare const lucide: { createIcons: () => void };

// Initialize the game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  Game.init();
  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  // Expose for debugging
  (window as unknown as { Game: typeof Game }).Game = Game;
});

// Export for potential external access
export { Game };
export { Board3D, TimelineCol } from './board3d';
export * from './types';
