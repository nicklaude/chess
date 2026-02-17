const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isDev = process.argv.includes('--watch');

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;

// Update version in index.html
const indexPath = path.join(__dirname, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
indexHtml = indexHtml.replace(
  /<span id="version-info">v[\d.]+<\/span>/,
  `<span id="version-info">v${version}</span>`
);
fs.writeFileSync(indexPath, indexHtml);
console.log(`Version updated to v${version} in index.html`);

const config = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  sourcemap: true,
  target: 'es2020',
  format: 'iife',
  globalName: 'ChessApp',
  external: [],  // Bundle everything - THREE.js loaded from CDN as global
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
