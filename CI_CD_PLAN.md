# CI/CD Plan for 6D Chess

This document outlines the recommended CI/CD setup for the 6D Chess project.

## Overview

The CI/CD pipeline will ensure code quality through automated testing, type checking, and deployment to GitHub Pages.

---

## Phase 1: GitHub Actions Workflow (Build/Test on PR)

### Recommended Workflow: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run typecheck

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration

      - name: Run headless tests
        run: npm run test:headless

      - name: Build
        run: npm run build

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
          retention-days: 7
```

### Key Features
- Runs on all PRs to main
- Caches npm dependencies for faster builds
- Runs all test suites (unit, integration, headless)
- Type checking with strict mode
- Build verification
- Artifact upload for debugging

---

## Phase 2: Automated Deployment to GitHub Pages

### Deployment Workflow: `.github/workflows/deploy.yml`

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:  # Allow manual triggers

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: .  # Upload entire project (index.html at root)

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### Configuration Required
1. Enable GitHub Pages in repository settings
2. Set source to "GitHub Actions"
3. Ensure `index.html` exists at project root

---

## Phase 3: Test Coverage Reporting

### Add Coverage with c8

```bash
npm install --save-dev c8
```

### Update package.json scripts
```json
{
  "scripts": {
    "test:coverage": "c8 --reporter=lcov npm run test:unit"
  }
}
```

### Coverage Workflow Addition
```yaml
      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: false
```

---

## Phase 4: Linting Checks

### Add ESLint

```bash
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

### Recommended `.eslintrc.json`
```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parserOptions": {
    "project": "./tsconfig.json"
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  },
  "ignorePatterns": ["node_modules/", "dist/", "*.js"]
}
```

### Update package.json
```json
{
  "scripts": {
    "lint": "eslint src/ test/ --ext .ts"
  }
}
```

---

## Phase 5: Status Badges

Add to README.md:

```markdown
[![CI](https://github.com/sammcgrail/chess/actions/workflows/ci.yml/badge.svg)](https://github.com/sammcgrail/chess/actions/workflows/ci.yml)
[![Deploy](https://github.com/sammcgrail/chess/actions/workflows/deploy.yml/badge.svg)](https://github.com/sammcgrail/chess/actions/workflows/deploy.yml)
[![codecov](https://codecov.io/gh/sammcgrail/chess/branch/main/graph/badge.svg)](https://codecov.io/gh/sammcgrail/chess)
```

---

## Implementation Priority

1. **High Priority (Implement First)**
   - GitHub Actions CI workflow for PRs
   - Type checking in CI
   - Unit and integration tests

2. **Medium Priority**
   - GitHub Pages deployment
   - Headless stress tests in CI

3. **Lower Priority (Nice to Have)**
   - Coverage reporting
   - ESLint integration
   - Status badges

---

## Current Status

As of this plan's creation:
- All tests pass: unit (40/40), integration (16/16), headless (10/10)
- TypeScript strict mode passes
- Build succeeds
- Ready for CI/CD implementation

---

## Notes

- The headless tests use randomized game simulation, which may have flaky behavior on CI
- Consider setting a fixed seed for reproducible headless tests
- GitHub Pages requires the repository to be public or have GitHub Enterprise
- For private repos, consider Vercel or Netlify as alternatives
