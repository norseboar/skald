# Skald Test Suite

This directory contains the test suite for the Skald API wrapper.

## Test Structure

```
tests/
├── unit/               # Unit tests (structure validation)
│   └── structure.test.js
├── integration/        # Integration tests (server & API)
│   └── server.test.js
├── runner.js          # Main test runner
├── test.sh            # Legacy bash script (kept for reference)
└── README.md          # This file
```

## Test Types

### Unit Tests (`tests/unit/structure.test.js`)
Validates project structure without requiring a running server:
- ✅ API handler file exists
- ✅ Handler exports default function
- ✅ Handler uses correct Vercel types
- ✅ Handler implements all HTTP methods (GET, PUT, POST, DELETE)
- ✅ package.json has required fields
- ✅ Configuration files exist (tsconfig.json, vercel.json, env.template)

### Integration Tests (`tests/integration/server.test.js`)
Tests the actual server and API endpoints:
- ✅ Server starts successfully
- ✅ CORS preflight (OPTIONS) works
- ✅ Authentication required (401 without auth)
- ✅ Invalid auth rejected (401 with wrong key)
- ✅ Valid auth accepted (200 with correct key)
- ✅ Repository validation (403 for invalid repo)
- ✅ Required parameters validation (400 for missing path)

**Note**: Integration tests require:
- `web/.env.local` file with valid credentials
- Vercel CLI installed (`npm install -g vercel` or via npx)
- **Vercel CLI logged in** (run `npx vercel login` - you don't need to deploy, just authenticate)
- Network access to GitHub API

**Note**: You don't need to deploy to Vercel to use `vercel dev` - it's designed for local development. Just authenticate with `npx vercel login`.

### TypeScript Compilation Check
Validates that all TypeScript code compiles without errors.

## Running Tests

From the `web/` directory:

```bash
# Run all tests (unit + TypeScript + integration)
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run only TypeScript check
npm run test:typescript

# Explicitly run all tests
npm run test:all
```

From the project root:

```bash
# Run all tests
cd web && npm test

# Or run the runner directly
node tests/runner.js
```

## Skipping Tests

You can skip specific test suites:

```bash
# Skip integration tests (faster, good for CI)
node tests/runner.js --skip-integration

# Skip unit tests
node tests/runner.js --skip-unit

# Skip TypeScript check
node tests/runner.js --skip-typescript

# Run only integration tests
node tests/runner.js --skip-unit --skip-typescript
```

## Integration Test Setup

Integration tests automatically start a Vercel dev server, run tests, and clean up. To run them:

1. **Authenticate with Vercel CLI** (required for `vercel dev`):
   ```bash
   npx vercel login
   ```
   Follow the prompts to authenticate. You don't need to deploy anything - this just authenticates you locally.

2. **Create environment file**:
   ```bash
   cp web/env.template web/.env.local
   ```

3. **Fill in your credentials** in `web/.env.local`:
   - `GITHUB_TOKEN`: Your GitHub Personal Access Token
   - `ALLOWED_REPOS`: Comma-separated list of repos (e.g., `owner/repo`)
   - `API_KEY`: Your API key for authentication

4. **Run integration tests**:
   ```bash
   npm run test:integration
   ```

The tests will:
- Start the Vercel dev server automatically
- Wait for it to be ready
- Run API endpoint tests
- Stop the server when done

## Legacy Bash Script

The `test.sh` script is kept for reference but is no longer the primary test method. It requires:
- Bash shell (Git Bash or WSL on Windows)
- Server already running manually
- curl installed

## CI/CD Usage

For CI/CD pipelines, it's recommended to run:
```bash
npm run test:unit && npm run test:typescript
```

This runs fast tests that don't require:
- Vercel CLI
- Environment variables
- Network access
- GitHub API credentials

Integration tests can be run separately when needed or in environments with proper credentials configured.
