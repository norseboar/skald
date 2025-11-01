/**
 * GitHub API Integration Tests (Local Server)
 * Tests actual GitHub API operations (GET, PUT, POST, DELETE) against a local Vercel dev server
 * 
 * These tests require:
 * - A dedicated test repository (set TEST_REPO in .env.local)
 * - Valid GITHUB_TOKEN with repo permissions
 * - Valid API_KEY
 * 
 * Run with: npm run test:github
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { TestRunner, sleep, makeRequest, runGitHubTests, cleanupTestFiles } = require('./github.test.shared');

async function runLocalGitHubTests() {
    console.log('\n🔬 Running GitHub API integration tests...\n');
    const runner = new TestRunner();

    // Increase max listeners to prevent warnings when multiple test files run
    process.setMaxListeners(20);

    // Check if .env.local exists
    const envPath = path.join(__dirname, '..', '..', '.env.local');
    if (!fs.existsSync(envPath)) {
        console.log('  ⚠ Skipping GitHub tests: .env.local not found');
        console.log('  Create .env.local from env.template to run GitHub tests\n');
        return true;
    }

    // Load environment variables
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const apiKey = envContent.match(/^API_KEY=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');
    const testRepo = envContent.match(/^TEST_REPO=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');
    const allowedRepos = envContent.match(/^ALLOWED_REPOS=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');

    if (!apiKey || apiKey === 'your_api_key_here') {
        console.log('  ⚠ Skipping GitHub tests: API_KEY not configured in .env.local\n');
        return true;
    }

    if (!testRepo || testRepo === 'your-username/test-repo') {
        console.log('  ⚠ Skipping GitHub tests: TEST_REPO not configured in .env.local');
        console.log('  Add TEST_REPO=your-username/test-repo to .env.local to run GitHub tests\n');
        return true;
    }

    // Verify TEST_REPO is in ALLOWED_REPOS
    if (!allowedRepos || !allowedRepos.split(',').map(r => r.trim()).includes(testRepo)) {
        console.log('  ⚠ Skipping GitHub tests: TEST_REPO must be included in ALLOWED_REPOS');
        console.log(`  Current ALLOWED_REPOS: ${allowedRepos || 'not set'}`);
        console.log(`  TEST_REPO: ${testRepo}`);
        console.log('  Add TEST_REPO to the ALLOWED_REPOS list in .env.local\n');
        return true;
    }

    console.log(`  Using test repository: ${testRepo}`);
    console.log(`  API Key configured: ${apiKey ? 'Yes' : 'No'}\n`);

    // Check if vercel CLI is available and user is logged in
    const projectRoot = path.join(__dirname, '..', '..');
    const vercelCheck = spawn('npx', ['vercel', 'whoami'], {
        cwd: projectRoot,
        shell: true,
        stdio: 'pipe'
    });

    let vercelLoggedIn = false;
    let vercelOutput = '';

    await new Promise((resolve) => {
        vercelCheck.stdout.on('data', (data) => {
            vercelOutput += data.toString();
            if (data.toString().trim()) {
                vercelLoggedIn = true;
            }
        });
        vercelCheck.stderr.on('data', (data) => {
            vercelOutput += data.toString();
            if (data.toString().includes('No existing credentials') ||
                data.toString().includes('not logged in')) {
                vercelLoggedIn = false;
            }
        });
        vercelCheck.on('close', (code) => {
            if (code === 0 && vercelOutput.trim()) {
                vercelLoggedIn = true;
            }
            resolve();
        });
        vercelCheck.on('error', () => resolve());
    });

    if (!vercelLoggedIn) {
        console.log('  ⚠ Skipping GitHub tests: Vercel CLI not logged in');
        console.log('  Run: npx vercel login\n');
        return true;
    }

    // Load .env.local into environment for the server process
    const envWithLocal = { ...process.env };
    const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');

    // Parse all environment variables from .env.local
    envLines.forEach(line => {
        // Skip comments and empty lines
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            value = value.replace(/^["']|["']$/g, '');
            envWithLocal[key] = value;
        }
    });

    // Explicitly ensure critical variables are set (in case parsing missed them)
    envWithLocal.API_KEY = apiKey;
    if (allowedRepos) {
        envWithLocal.ALLOWED_REPOS = allowedRepos;
    }

    // Parse GITHUB_TOKEN explicitly
    const githubToken = envContent.match(/^GITHUB_TOKEN=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');
    if (githubToken && githubToken !== 'your_github_personal_access_token_here') {
        envWithLocal.GITHUB_TOKEN = githubToken;
    }

    console.log(`  ✓ Environment configured for server`);
    console.log(`    API_KEY: ${apiKey ? 'Set' : 'Missing'} (length: ${apiKey.length})`);
    console.log(`    ALLOWED_REPOS: ${envWithLocal.ALLOWED_REPOS ? 'Set' : 'Missing'}`);
    console.log(`    GITHUB_TOKEN: ${envWithLocal.GITHUB_TOKEN ? 'Set' : 'Missing'}`);

    // Start Vercel dev server
    console.log('  Starting Vercel dev server...');
    const serverProcess = spawn('npx', ['vercel', 'dev', '--listen', '3000', '--yes'], {
        cwd: projectRoot,
        shell: true,
        stdio: 'pipe',
        env: envWithLocal
    });

    let serverOutput = '';
    let serverPort = 3000;

    function extractPort(output) {
        const portMatch = output.match(/localhost:(\d+)/);
        if (portMatch) {
            const port = parseInt(portMatch[1], 10);
            if (port && port !== serverPort) {
                serverPort = port;
            }
        }
    }

    async function shutdownServer() {
        if (serverProcess && !serverProcess.killed) {
            try {
                serverProcess.kill('SIGTERM');
                await sleep(2000);
                if (!serverProcess.killed) {
                    serverProcess.kill('SIGKILL');
                }
            } catch (e) {
                // Ignore cleanup errors
            }
        }
    }

    // Handle Ctrl+C gracefully
    // Remove any existing SIGINT listeners to prevent accumulation
    const sigintHandler = async () => {
        await shutdownServer();
        process.exit(1);
    };
    process.removeAllListeners('SIGINT');
    process.on('SIGINT', sigintHandler);

    serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        serverOutput += output;
        extractPort(output);
    });

    serverProcess.stderr.on('data', (data) => {
        const output = data.toString();
        serverOutput += output;
        extractPort(output);
    });

    const STARTUP_TIMEOUT = 45000;
    const startupTimeout = setTimeout(() => {
        console.log('\n  ⚠ Server startup timeout (45s). Stopping...');
        if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGTERM');
        }
    }, STARTUP_TIMEOUT);

    try {
        // Wait for server to start
        console.log('  Waiting for server to start...\n');
        await sleep(2000);

        const portsToTry = [serverPort, 3000, 3001, 3002, 3003, 3004];
        let connected = false;

        // Helper function to wait for server
        const waitForServer = async (port, maxAttempts = 60, delay = 1000) => {
            for (let i = 0; i < maxAttempts; i++) {
                try {
                    await makeRequest({ hostname: 'localhost', port: port }, '/', 'GET', {}, null);
                    return true;
                } catch (e) {
                    if (i === maxAttempts - 1) {
                        throw new Error(`Server did not start within ${maxAttempts * delay / 1000}s timeout`);
                    }
                    await sleep(delay);
                }
            }
        };

        for (const port of portsToTry) {
            try {
                await waitForServer(port, 5, 1000);
                serverPort = port;
                connected = true;
                break;
            } catch (e) {
                // Try next port
            }
        }

        if (!connected) {
            throw new Error(`Could not connect to server on any port tried: ${portsToTry.join(', ')}`);
        }

        clearTimeout(startupTimeout);
        console.log(`  ✓ Server started on port ${serverPort}\n`);

        // Give server a moment to fully initialize environment variables
        await sleep(2000);

        // Warm up the serverless function to ensure env vars are loaded
        // This prevents cold start issues where the first request fails auth
        console.log('  Warming up serverless function...');
        try {
            const warmupResponse = await makeRequest(
                { hostname: 'localhost', port: serverPort },
                `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=.`,
                'OPTIONS',
                {
                    'Origin': 'http://localhost:3000',
                    'Access-Control-Request-Method': 'GET'
                }
            );
            // Wait a bit more after warmup to ensure env vars are fully loaded
            await sleep(1000);
            console.log('  ✓ Function warmed up\n');
        } catch (e) {
            console.log(`  ⚠ Warmup request failed (non-critical): ${e.message}\n`);
        }

        // Run the shared test suite
        const target = { hostname: 'localhost', port: serverPort };
        const createdFiles = await runGitHubTests(target, testRepo, apiKey, runner);

        // Cleanup: Delete created files
        await cleanupTestFiles(target, testRepo, apiKey, createdFiles);

    } catch (error) {
        clearTimeout(startupTimeout);
        console.log(`\n  ✗ Tests failed: ${error.message}`);
        runner.test('Tests completed successfully', false, error.message);
    } finally {
        clearTimeout(startupTimeout);
        // Remove SIGINT handler to prevent listener accumulation
        process.removeListener('SIGINT', sigintHandler);
        console.log('\n  Stopping server...');
        await shutdownServer();
        console.log('  Server stopped.\n');
    }

    return runner.summary();
}

if (require.main === module) {
    runLocalGitHubTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('  ✗ GitHub tests failed:', error.message);
        process.exit(1);
    });
}

module.exports = { runGitHubTests: runLocalGitHubTests };

