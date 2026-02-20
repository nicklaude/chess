// Wrapper worker that properly configures Stockfish WASM path
// This file should be loaded as a Web Worker

// Get the base URL from the current script location
const scriptUrl = self.location.href;
const baseUrl = scriptUrl.substring(0, scriptUrl.lastIndexOf('/') + 1);
const wasmUrl = baseUrl + 'stockfish-nnue-16-single.wasm';

// Set up the Module configuration before loading Stockfish
self.Module = {
  locateFile: function(file) {
    if (file.endsWith('.wasm')) {
      return wasmUrl;
    }
    return baseUrl + file;
  }
};

// Import the actual Stockfish engine
importScripts(baseUrl + 'stockfish-nnue-16-single.js');
