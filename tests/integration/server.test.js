/**
 * Integration tests - Server and API endpoint tests
 * Tests that the server starts and responds correctly to API requests
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class TestRunner {
    constructor() {
        this.passed = 0;
        this.failed = 0;
        this.tests = [];
    }

    test(name, condition, details = '') {
        if (condition) {
            console.log(`  ✓ ${name}${details ? ` - ${details}` : ''}`);
            this.passed++;
            this.tests.push({ name, passed: true });
        } else {
            console.log(`  ✗ ${name}${details ? ` - ${details}` : ''}`);
            this.failed++;
            this.tests.push({ name, passed: false });
        }
    }

    summary() {
        console.log(`\n  Tests: ${this.passed} passed, ${this.failed} failed`);
        return this.failed === 0;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeRequest(options, data = null) {
    return new Promise((resolve, reject) => {
        const timeout = options.timeout || 5000;
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = body ? JSON.parse(body) : null;
                    resolve({ status: res.statusCode, headers: res.headers, body: parsed, rawBody: body });
                } catch (e) {
                    resolve({ status: res.statusCode, headers: res.headers, body: body, rawBody: body });
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(timeout, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (data) {
            req.write(typeof data === 'string' ? data : JSON.stringify(data));
        }
        req.end();
    });
}

function waitForServer(port, maxAttempts = 60, delay = 1000) {
    return new Promise(async (resolve, reject) => {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const result = await makeRequest({ hostname: 'localhost', port: port, path: '/', method: 'GET', timeout: 2000 });
                // Any response (even 404) means server is up
                resolve(true);
                return;
            } catch (e) {
                if (i === maxAttempts - 1) {
                    reject(new Error(`Server did not start within ${maxAttempts * delay / 1000}s timeout`));
                }
                await sleep(delay);
            }
        }
    });
}

async function runIntegrationTests() {
    console.log('\n🚀 Running integration tests...\n');
    const runner = new TestRunner();

    // Increase max listeners to prevent warnings when multiple test files run
    process.setMaxListeners(20);

    // Check if .env.local exists
    const envPath = path.join(__dirname, '..', '..', '.env.local');
    if (!fs.existsSync(envPath)) {
        console.log('  ⚠ Skipping integration tests: .env.local not found');
        console.log('  Create .env.local from env.template to run integration tests\n');
        return true; // Don't fail the build, just skip
    }

    // Load environment variables
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const apiKey = envContent.match(/^API_KEY=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');
    const allowedRepos = envContent.match(/^ALLOWED_REPOS=(.+)$/m)?.[1]?.trim()?.replace(/^["']|["']$/g, '');

    if (!apiKey || apiKey === 'your_api_key_here') {
        console.log('  ⚠ Skipping integration tests: API_KEY not configured in .env.local\n');
        return true;
    }

    if (!allowedRepos || allowedRepos === 'your-username/your-repo') {
        console.log('  ⚠ Skipping integration tests: ALLOWED_REPOS not configured in .env.local\n');
        return true;
    }

    const repo = allowedRepos.split(',')[0].trim();
    console.log(`  Using repository: ${repo}\n`);

    // Start Vercel dev server
    console.log('  Starting Vercel dev server...');
    // Run from project root where vercel.json is located
    // vercel.json has rootDirectory: "web" so it knows where the app code is
    const projectRoot = path.join(__dirname, '..', '..');
    const webDir = path.join(projectRoot, 'web');

    // Check if vercel CLI is available and user is logged in
    console.log('  Checking Vercel CLI...');
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
            // If we get any output (like username), user is logged in
            if (data.toString().trim()) {
                vercelLoggedIn = true;
            }
        });
        vercelCheck.stderr.on('data', (data) => {
            vercelOutput += data.toString();
            // Check for login error
            if (data.toString().includes('No existing credentials') ||
                data.toString().includes('not logged in')) {
                vercelLoggedIn = false;
            }
        });
        vercelCheck.on('close', (code) => {
            // Exit code 0 usually means logged in
            if (code === 0 && vercelOutput.trim()) {
                vercelLoggedIn = true;
            }
            resolve();
        });
        vercelCheck.on('error', () => resolve());
    });

    if (!vercelLoggedIn) {
        console.log('\n  ⚠ Skipping integration tests: Vercel CLI not logged in');
        console.log('  To run integration tests:');
        console.log('    1. Run: npx vercel login');
        console.log('    2. Follow the authentication prompts');
        console.log('    3. Then run: npm run test:integration\n');
        return true; // Skip gracefully, don't fail
    }

    console.log('  ✓ Vercel CLI authenticated\n');

    // Load .env.local into environment for the server process
    const envWithLocal = { ...process.env };
    const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');
    envLines.forEach(line => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            // Remove quotes if present
            value = value.replace(/^["']|["']$/g, '');
            envWithLocal[key] = value;
        }
    });

    // Run vercel dev from project root (where vercel.json is)
    // This avoids the recursive invocation issue
    const serverProcess = spawn('npx', ['vercel', 'dev', '--listen', '3000', '--yes'], {
        cwd: projectRoot,
        shell: true,
        stdio: 'pipe',
        env: envWithLocal
    });

    let serverOutput = '';
    let serverReady = false;
    let serverError = null;
    let serverPort = 3000; // Default port, will be updated when detected

    // Function to extract port from Vercel output
    function extractPort(output) {
        // Look for patterns like "Available at http://localhost:3004" or "localhost:3004"
        const portMatch = output.match(/localhost:(\d+)/);
        if (portMatch) {
            const port = parseInt(portMatch[1], 10);
            if (port && port !== serverPort) {
                serverPort = port;
                console.log(`  ✓ Detected server running on port ${serverPort}`);
            }
        }
    }

    // Function to safely shutdown server
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
        // Vercel outputs various ready messages
        if (output.includes('Ready') ||
            output.includes('ready') ||
            output.includes('localhost:') ||
            output.includes('Ready in') ||
            output.includes('○') ||
            output.includes('▲')) {
            serverReady = true;
        }
        // Show output for debugging (but don't spam)
        if (output.includes('error') || output.includes('Error') || output.includes('Failed')) {
            console.log(`  [Server Output] ${output.trim()}`);
        }
    });

    serverProcess.stderr.on('data', (data) => {
        const output = data.toString();
        serverOutput += output;
        extractPort(output);
        // Vercel often outputs to stderr even for normal messages
        if (output.includes('Ready') ||
            output.includes('ready') ||
            output.includes('localhost:') ||
            output.includes('Ready in') ||
            output.includes('○') ||
            output.includes('▲')) {
            serverReady = true;
        }
        // Only show errors/warnings, not all stderr
        if (output.includes('error') || output.includes('Error') || output.includes('Failed') || output.includes('Warning')) {
            console.log(`  [Server Error] ${output.trim()}`);
        }
    });

    serverProcess.on('error', (error) => {
        serverError = error;
        console.log(`  [Server Process Error] ${error.message}`);
    });

    // Set a timeout for the entire server startup process
    const STARTUP_TIMEOUT = 45000; // 45 seconds max (more aggressive)
    const startupTimeout = setTimeout(() => {
        console.log('\n  ⚠ Server startup timeout (45s). Stopping...');
        if (serverProcess && !serverProcess.killed) {
            serverProcess.kill('SIGTERM');
        }
    }, STARTUP_TIMEOUT);

    // Function to check for errors in server output
    function checkForErrors(output) {
        return output.includes('[Server Error]');
    }

    try {
        // Wait for server to start
        console.log('  Waiting for server to start (checking for errors every 1 second)...\n');

        // Check for errors immediately and periodically - start checking right away
        let errorDetected = false;
        const errorCheckInterval = setInterval(() => {
            if (checkForErrors(serverOutput)) {
                errorDetected = true;
                clearInterval(errorCheckInterval);
            }
        }, 1000); // Check every 1 second

        // Give server just 2 seconds to start spawning, then check for immediate errors
        await sleep(2000);

        // Check for immediate errors (like recursive invocation)
        if (checkForErrors(serverOutput)) {
            clearTimeout(startupTimeout);
            clearInterval(errorCheckInterval);

            let errorType = 'Unknown error';
            if (serverOutput.includes('recursively invoke') || serverOutput.includes('recursive-invocation')) {
                errorType = 'Recursive invocation detected';
                console.log('\n  ✗ Server startup failed: Recursive invocation detected');
                console.log('  This happens when vercel.json devCommand or package.json dev script');
                console.log('  calls vercel dev. Fix your configuration.\n');
            } else if (serverOutput.includes('No existing credentials') || serverOutput.includes('Please run `vercel login`')) {
                errorType = 'Vercel CLI login required';
                console.log('\n  ⚠ Server startup failed: Vercel CLI authentication required');
                console.log('  Run: npx vercel login');
                console.log('  Then try the integration tests again\n');
            } else {
                console.log('\n  ✗ Server startup failed: Error detected in server output\n');
            }

            runner.test('Server started successfully', false, errorType);
            return runner.summary();
        }

        clearInterval(errorCheckInterval);

        // Try to connect to the server with reduced timeout
        // Try multiple ports in case Vercel chose a different one
        try {
            // First try the detected port, then fallback to common ports
            const portsToTry = [serverPort, 3000, 3001, 3002, 3003, 3004];
            let connected = false;

            for (const port of portsToTry) {
                try {
                    await waitForServer(port, 5, 1000); // Quick check - 5 attempts * 1s
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
            console.log(`  ✓ Server started and responding on port ${serverPort}!\n`);
        } catch (error) {
            clearTimeout(startupTimeout);

            // Check for specific error types
            if (checkForErrors(serverOutput)) {
                let errorMsg = 'Server startup error detected';
                if (serverOutput.includes('recursively invoke')) {
                    errorMsg = 'Recursive invocation error';
                } else if (serverOutput.includes('No existing credentials') || serverOutput.includes('Please run `vercel login`')) {
                    errorMsg = 'Vercel CLI login required';
                    console.log('\n  ⚠ Server startup failed: Vercel CLI authentication required');
                    console.log('  Run: npx vercel login');
                    console.log('  Then try the integration tests again\n');
                }

                runner.test('Server started successfully', false, errorMsg);
                return runner.summary();
            }

            // Show server output for debugging
            console.log('\n  ✗ Server startup failed. Error details:');
            if (serverOutput) {
                console.log('  [Server Output] Last 20 lines:');
                const lines = serverOutput.split('\n').slice(-20);
                lines.forEach(line => {
                    if (line.trim()) console.log(`    ${line.trim()}`);
                });
                console.log('');
            }
            if (serverError) {
                runner.test('Server started successfully', false, `Server process error: ${serverError.message}`);
                return runner.summary();
            }
            runner.test('Server started successfully', false, `Server did not become ready: ${error.message}`);
            return runner.summary();
        }

        // Test 1: OPTIONS request (CORS preflight) - Check endpoint exists
        console.log('\n  [TEST 1] OPTIONS - Check endpoint exists');
        const testPath = `/api/repos/contents?repo=${encodeURIComponent(repo)}&path=.`;
        console.log(`    Testing path: ${testPath}`);
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: serverPort,
                path: testPath,
                method: 'OPTIONS',
                headers: {
                    'Origin': 'http://localhost:3000',
                    'Access-Control-Request-Method': 'GET'
                }
            });
            console.log(`    Status: ${response.status}`);
            console.log(`    Response body: ${response.rawBody?.substring(0, 200)}`);
            // Endpoint exists if we don't get 404
            runner.test('OPTIONS endpoint exists (not 404)', response.status !== 404, `Got status ${response.status}`);
            if (response.status === 200) {
                runner.test('OPTIONS returns 200', true);
                runner.test('CORS headers present',
                    response.headers['access-control-allow-origin'] === '*' ||
                    response.headers['access-control-allow-methods']?.includes('GET'));
            }
        } catch (e) {
            console.log(`    Error: ${e.message}`);
            runner.test('OPTIONS request succeeds', false, e.message);
        }

        // Test 2: GET without auth - Check endpoint exists and returns proper error
        console.log('\n  [TEST 2] GET - Check endpoint exists');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: serverPort,
                path: `/api/repos/contents?repo=${encodeURIComponent(repo)}&path=.`,
                method: 'GET'
            });
            console.log(`    Status: ${response.status}`);
            console.log(`    Response body: ${JSON.stringify(response.body).substring(0, 200)}`);
            // Endpoint exists if we don't get 404
            runner.test('GET endpoint exists (not 404)', response.status !== 404, `Got status ${response.status}`);
            if (response.status === 401) {
                runner.test('Returns 401 without auth', true);
            }
        } catch (e) {
            console.log(`    Error: ${e.message}`);
            runner.test('GET request handled', false, e.message);
        }

        // Test 3: GET with invalid auth - Check endpoint handles invalid auth
        console.log('\n  [TEST 3] GET - Invalid authentication');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: serverPort,
                path: `/api/repos/contents?repo=${encodeURIComponent(repo)}&path=.`,
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer invalid-key'
                }
            });
            console.log(`    Status: ${response.status}`);
            runner.test('Endpoint handles invalid auth', response.status !== 404, `Got status ${response.status}`);
            if (response.status === 401) {
                runner.test('Returns 401 with invalid auth', true);
            }
        } catch (e) {
            runner.test('Request with invalid auth handled', false, e.message);
        }

        // Test 4: GET with valid auth - Check endpoint works with valid auth
        console.log('\n  [TEST 4] GET - Valid authentication');
        try {
            const response = await makeRequest({
                hostname: 'localhost',
                port: serverPort,
                path: `/api/repos/contents?repo=${encodeURIComponent(repo)}&path=.`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
            console.log(`    Status: ${response.status}`);
            runner.test('Endpoint handles valid auth', response.status !== 404, `Got status ${response.status}`);
            if (response.status === 200) {
                runner.test('Returns 200 with valid auth', true);
                runner.test('Returns JSON response', typeof response.body === 'object' || Array.isArray(response.body));
                if (Array.isArray(response.body)) {
                    runner.test('Directory listing is array', true);
                }
            }
        } catch (e) {
            runner.test('Request with valid auth succeeds', false, e.message);
        }

    } catch (error) {
        clearTimeout(startupTimeout);
        console.log(`\n  ✗ Server startup failed: ${error.message}`);
        runner.test('Server started successfully', false, error.message);

        // Show some server output for debugging
        if (serverOutput) {
            const recentOutput = serverOutput.split('\n').slice(-10).join('\n');
            if (recentOutput.trim()) {
                console.log('  Recent server output:');
                console.log('  ' + recentOutput.split('\n').join('\n  '));
            }
        }
    } finally {
        // Cleanup: kill server process
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
    runIntegrationTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('  ✗ Integration tests failed:', error.message);
        process.exit(1);
    });
}

module.exports = { runIntegrationTests };

