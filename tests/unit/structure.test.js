/**
 * Unit tests - Structure validation
 * Tests file structure, exports, and configuration without requiring a server
 */

const fs = require('fs');
const path = require('path');

class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.tests = [];
  }

  test(name, condition) {
    if (condition) {
      console.log(`  ✓ ${name}`);
      this.passed++;
      this.tests.push({ name, passed: true });
    } else {
      console.log(`  ✗ ${name}`);
      this.failed++;
      this.tests.push({ name, passed: false });
    }
  }

  summary() {
    console.log(`\n  Tests: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }
}

function runStructureTests() {
  console.log('\n📁 Running structure validation tests...\n');
  const runner = new TestRunner();

  // Test 1: API handler file exists
  const apiHandlerPath = path.join(__dirname, '..', '..', 'api', 'repos', 'contents.ts');
  runner.test('API handler file exists', fs.existsSync(apiHandlerPath));

  // Test 2: API handler is valid TypeScript/JavaScript
  if (fs.existsSync(apiHandlerPath)) {
    const content = fs.readFileSync(apiHandlerPath, 'utf-8');
    runner.test('API handler exports a default function', content.includes('export default'));
    runner.test('API handler uses VercelRequest type', content.includes('VercelRequest'));
    runner.test('API handler uses VercelResponse type', content.includes('VercelResponse'));
    runner.test('API handler has handler function', 
      content.includes('async function handler') || content.includes('export default async function'));
    runner.test('API handler handles GET requests', content.includes("case 'GET'"));
    runner.test('API handler handles PUT requests', content.includes("case 'PUT'"));
    runner.test('API handler handles POST requests', content.includes("case 'POST'"));
    runner.test('API handler handles DELETE requests', content.includes("case 'DELETE'"));
  }

  // Test 3: package.json exists and has required fields
  const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    runner.test('package.json has name', !!packageJson.name);
    runner.test('package.json has version', !!packageJson.version);
    runner.test('package.json has test script', !!packageJson.scripts?.test);
    runner.test('package.json has @vercel/node dependency', !!packageJson.dependencies?.['@vercel/node']);
  }

  // Test 4: tsconfig.json exists
  const tsconfigPath = path.join(__dirname, '..', '..', 'tsconfig.json');
  runner.test('tsconfig.json exists', fs.existsSync(tsconfigPath));

  // Test 5: vercel.json exists at root
  const vercelJsonPath = path.join(__dirname, '..', '..', 'vercel.json');
  runner.test('vercel.json exists', fs.existsSync(vercelJsonPath));

  // Test 6: env.template exists
  const envTemplatePath = path.join(__dirname, '..', '..', 'env.template');
  runner.test('env.template exists', fs.existsSync(envTemplatePath));

  return runner.summary();
}

if (require.main === module) {
  const success = runStructureTests();
  process.exit(success ? 0 : 1);
}

module.exports = { runStructureTests };

