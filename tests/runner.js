/**
 * Main test runner
 * Runs all test suites: unit tests, TypeScript compilation, and integration tests
 */

const { runStructureTests } = require('./unit/structure.test');
const { runIntegrationTests } = require('./integration/server.test');
const { spawn } = require('child_process');
const path = require('path');

async function runTypeScriptCheck() {
  return new Promise((resolve) => {
    console.log('\n📝 Running TypeScript compilation check...\n');
    const projectRoot = path.join(__dirname, '..');
    const tscProcess = spawn('npx', ['tsc', '--noEmit'], {
      cwd: projectRoot,
      shell: true,
      stdio: 'inherit'
    });

    tscProcess.on('close', (code) => {
      if (code === 0) {
        console.log('  ✓ TypeScript compilation passed\n');
        resolve(true);
      } else {
        console.log('  ✗ TypeScript compilation failed\n');
        resolve(false);
      }
    });

    tscProcess.on('error', (error) => {
      console.log(`  ✗ Failed to run TypeScript compiler: ${error.message}\n`);
      resolve(false);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const testUnit = !args.includes('--skip-unit');
  const testIntegration = !args.includes('--skip-integration');
  const testTypeScript = !args.includes('--skip-typescript');

  console.log('🧪 Running Skald Test Suite\n');
  console.log('='.repeat(50));

  let allPassed = true;

  // Unit tests
  if (testUnit) {
    const unitPassed = runStructureTests();
    if (!unitPassed) allPassed = false;
  } else {
    console.log('\n⏭ Skipping unit tests (--skip-unit)\n');
  }

  // TypeScript check
  if (testTypeScript) {
    const tsPassed = await runTypeScriptCheck();
    if (!tsPassed) allPassed = false;
  } else {
    console.log('\n⏭ Skipping TypeScript check (--skip-typescript)\n');
  }

  // Integration tests
  if (testIntegration) {
    const integrationPassed = await runIntegrationTests();
    if (!integrationPassed) allPassed = false;
  } else {
    console.log('\n⏭ Skipping integration tests (--skip-integration)\n');
  }

  // Summary
  console.log('='.repeat(50));
  if (allPassed) {
    console.log('\n✅ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed\n');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('\n💥 Test runner error:', error);
    process.exit(1);
  });
}

module.exports = { main };

