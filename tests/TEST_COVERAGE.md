# Test Coverage Summary

This document explains what each test suite covers.

## Test Breakdown

### Unit Tests (`tests/unit/structure.test.js`)

**Purpose**: Validates project structure and code organization without requiring a running server or external dependencies.

**What it tests** (16 tests):

1. **File Structure**:
   - ✅ API handler file exists at correct path
   - ✅ Configuration files exist (tsconfig.json, vercel.json, env.template)

2. **Code Structure**:
   - ✅ API handler exports a default function (required by Vercel)
   - ✅ Handler uses correct Vercel types (VercelRequest, VercelResponse)
   - ✅ Handler function signature is correct (async function handler)

3. **HTTP Method Coverage**:
   - ✅ Handler implements GET requests
   - ✅ Handler implements PUT requests  
   - ✅ Handler implements POST requests
   - ✅ Handler implements DELETE requests

4. **Package Configuration**:
   - ✅ package.json has required fields (name, version)
   - ✅ package.json has test script configured
   - ✅ package.json has @vercel/node dependency

**When to run**: Always - these are fast and validate code structure.

**Dependencies**: None (pure Node.js file system operations)

---

### TypeScript Compilation Check

**Purpose**: Ensures all TypeScript code compiles without type errors.

**What it tests**:
- ✅ All TypeScript files compile successfully
- ✅ No type errors in the codebase
- ✅ Type definitions are correct

**When to run**: Before commits/deploys, in CI/CD pipelines.

**Dependencies**: TypeScript compiler (via npx)

---

### Integration Tests (`tests/integration/server.test.js`)

**Purpose**: Tests the actual running server and API endpoints with real HTTP requests.

**What it tests** (6+ tests):

1. **Server Startup**:
   - ✅ Server starts successfully
   - ✅ Server is accessible on localhost:3000

2. **CORS Support**:
   - ✅ OPTIONS requests return 200
   - ✅ CORS headers are present

3. **Authentication**:
   - ✅ Missing auth returns 401
   - ✅ Invalid auth returns 401
   - ✅ Valid auth returns 200

4. **Authorization**:
   - ✅ Invalid repository returns 403
   - ✅ Valid repository with valid auth returns 200

5. **Parameter Validation**:
   - ✅ Missing required path parameter returns 400

**When to run**: 
- Before deployments
- When making API changes
- Locally (requires setup)

**Dependencies**:
- Vercel CLI (or npx vercel)
- `web/.env.local` with valid credentials:
  - `GITHUB_TOKEN`: GitHub Personal Access Token
  - `ALLOWED_REPOS`: Comma-separated list of repos
  - `API_KEY`: API authentication key
- Network access to GitHub API

**Note**: Integration tests automatically skip if:
- `.env.local` doesn't exist
- Credentials are not configured
- Vercel CLI is not available

---

## Test Execution Strategy

### Quick Validation (CI/CD friendly)
```bash
npm run test:unit && npm run test:typescript
```
- Fast execution (< 5 seconds)
- No external dependencies
- No credentials required
- Catches structural and type errors

### Full Test Suite
```bash
npm test
```
- Includes integration tests
- Requires credentials and Vercel CLI
- Takes longer (60+ seconds for server startup)
- Validates end-to-end functionality

### Individual Test Suites
```bash
npm run test:unit        # Structure validation only
npm run test:typescript  # Type checking only  
npm run test:integration # Server tests only
```

---

## What's NOT Tested (Yet)

These areas could be expanded in the future:

- **Error Handling**: 
  - GitHub API failures
  - Network timeouts
  - Invalid JSON responses

- **Edge Cases**:
  - Very large files
  - Special characters in paths
  - Empty repositories
  - Private vs public repo access

- **Performance**:
  - Response times
  - Concurrent requests
  - Memory usage

- **End-to-End Scenarios**:
  - Full CRUD workflow (create, read, update, delete)
  - Branch operations
  - File encoding edge cases

---

## Test Metrics

**Current Coverage**:
- Structure validation: ✅ 16 tests
- TypeScript compilation: ✅ Full codebase
- Integration: ✅ 6+ endpoint tests

**Test Execution Time**:
- Unit tests: ~1 second
- TypeScript check: ~2-3 seconds
- Integration tests: ~60-120 seconds (includes server startup)

**Reliability**:
- Unit tests: ✅ 100% reliable (no external deps)
- TypeScript check: ✅ 100% reliable
- Integration tests: ⚠️ Requires environment setup (skips gracefully if not available)

