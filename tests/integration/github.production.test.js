/**
 * GitHub API Production Integration Tests
 * Tests actual GitHub API operations against a hosted/production server
 * 
 * These tests require:
 * - A dedicated test repository (set TEST_REPO in .env.local)
 * - Valid GITHUB_TOKEN with repo permissions
 * - Valid API_KEY
 * - A running server URL (passed as argument or TEST_URL env var)
 * 
 * Usage:
 *   node tests/integration/github.production.test.js https://your-server.vercel.app
 *   TEST_URL=https://your-server.vercel.app node tests/integration/github.production.test.js
 *   npm run test:github:production
 */

const path = require('path');
const fs = require('fs');
const { TestRunner, sleep, makeRequest, runGitHubTests, cleanupTestFiles } = require('./github.test.shared');

async function runProductionGitHubTests(baseUrl) {
    console.log('\n🌐 Running GitHub API production integration tests...\n');
    console.log(`  Target server: ${baseUrl}\n`);
    const runner = new TestRunner();

    // Check if .env.local exists
    const envPath = path.join(__dirname, '..', '..', '.env.local');
    if (!fs.existsSync(envPath)) {
        console.log('  ⚠ Skipping GitHub tests: .env.local not found');
        console.log('  Create .env.local from env.template to run GitHub tests\n');
        return false;
    }

    // Load environment variables
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const apiKey = envContent.match(/^API_KEY=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');
    const testRepo = envContent.match(/^TEST_REPO=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');
    const allowedRepos = envContent.match(/^ALLOWED_REPOS=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');

    if (!apiKey || apiKey === 'your_api_key_here') {
        console.log('  ⚠ Skipping GitHub tests: API_KEY not configured in .env.local\n');
        return false;
    }

    if (!testRepo || testRepo === 'your-username/test-repo') {
        console.log('  ⚠ Skipping GitHub tests: TEST_REPO not configured in .env.local');
        console.log('  Add TEST_REPO=your-username/test-repo to .env.local to run GitHub tests\n');
        return false;
    }

    // Verify TEST_REPO is in ALLOWED_REPOS
    if (!allowedRepos || !allowedRepos.split(',').map(r => r.trim()).includes(testRepo)) {
        console.log('  ⚠ Skipping GitHub tests: TEST_REPO must be included in ALLOWED_REPOS');
        console.log(`  Current ALLOWED_REPOS: ${allowedRepos || 'not set'}`);
        console.log(`  TEST_REPO: ${testRepo}`);
        console.log('  Add TEST_REPO to the ALLOWED_REPOS list in .env.local\n');
        return false;
    }

    console.log(`  Using test repository: ${testRepo}`);
    console.log(`  API Key configured: ${apiKey ? 'Yes' : 'No'}\n`);

    // Normalize base URL (remove trailing slash)
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

    // Test server connectivity first
    console.log('  Testing server connectivity...');
    try {
        const healthCheck = await makeRequest(
            normalizedBaseUrl,
            `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=.`,
            'OPTIONS',
            {
                'Origin': normalizedBaseUrl,
                'Access-Control-Request-Method': 'GET'
            },
            null,
            true // Enable debug logging
        );
        console.log('  ✓ Server is reachable\n');
    } catch (e) {
        console.log(`  ✗ Cannot reach server: ${e.message}`);

        // Try a simple GET to root to see if server is up at all
        console.log('\n  Attempting simple connectivity test to root path...');
        try {
            const rootCheck = await makeRequest(normalizedBaseUrl, '/', 'GET', {}, null, true);
            console.log(`  Root path responded with status: ${rootCheck.status}`);
        } catch (rootError) {
            console.log(`  Root path also failed: ${rootError.message}`);
        }

        console.log('  Please verify the server URL is correct and the server is running.\n');
        return false;
    }

    // Test with API key to see if auth is working
    console.log('  Testing authentication...');
    console.log(`    API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)} (masked)`);
    const testPath = `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=.`;

    try {
        const authTest = await makeRequest(
            normalizedBaseUrl,
            testPath,
            'GET',
            {
                'Authorization': `Bearer ${apiKey}`
            },
            null,
            true // Enable debug logging
        );
        if (authTest.status === 401) {
            console.log('  ⚠ Authentication failed - check API_KEY in Vercel environment variables');
            console.log('     Make sure the API_KEY in Vercel matches the one in .env.local');
        } else if (authTest.status === 403) {
            console.log('  ⚠ Repository not allowed - check ALLOWED_REPOS in Vercel environment variables');
            console.log(`     Make sure "${testRepo}" is included in ALLOWED_REPOS in Vercel`);
        } else if (authTest.status === 200 || authTest.status === 404) {
            console.log('  ✓ Authentication successful');
        }
        console.log('');
    } catch (authError) {
        console.log(`  Auth test failed: ${authError.message}`);
        console.log('');
    }

    try {
        // Run the shared test suite
        const createdFiles = await runGitHubTests(normalizedBaseUrl, testRepo, apiKey, runner);

        // Cleanup: Delete created files
        await cleanupTestFiles(normalizedBaseUrl, testRepo, apiKey, createdFiles);
    } catch (error) {
        console.log(`\n  ✗ Tests failed: ${error.message}`);
        runner.test('Tests completed successfully', false, error.message);
    }

    return runner.summary();
}

// Get URL from command line argument, environment variable, or .env.local
function getBaseUrl() {
    // Check command line arguments first
    const args = process.argv.slice(2);
    if (args.length > 0) {
        return args[0];
    }

    // Check environment variable
    if (process.env.TEST_URL) {
        return process.env.TEST_URL;
    }

    // Check .env.local file
    const envPath = path.join(__dirname, '..', '..', '.env.local');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const testUrl = envContent.match(/^TEST_URL=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');
        if (testUrl) {
            return testUrl;
        }
    }

    // No URL provided
    console.error('\n  ✗ Error: No server URL provided');
    console.error('\n  Usage:');
    console.error('    node tests/integration/github.production.test.js <URL>');
    console.error('    TEST_URL=<URL> node tests/integration/github.production.test.js');
    console.error('    npm run test:github:production');
    console.error('    (or set TEST_URL in .env.local)\n');
    console.error('  Example:');
    console.error('    node tests/integration/github.production.test.js https://your-app.vercel.app');
    console.error('    TEST_URL=https://your-app.vercel.app node tests/integration/github.production.test.js');
    console.error('    Add TEST_URL=https://your-app.vercel.app to .env.local\n');
    process.exit(1);
}

if (require.main === module) {
    const baseUrl = getBaseUrl();
    runProductionGitHubTests(baseUrl).then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('  ✗ Production GitHub tests failed:', error.message);
        process.exit(1);
    });
}

module.exports = { runProductionGitHubTests };

