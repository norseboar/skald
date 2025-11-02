/**
 * Shared GitHub API Test Logic
 * Common test functions used by both local and production test suites
 */

const http = require('http');
const https = require('https');
const url = require('url');

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

/**
 * Unified request function that works with both localhost (hostname/port) and URLs
 * @param {string|object} target - Either a URL string or {hostname, port} object
 * @param {string} requestPath - Path to append (for localhost) or full path (for URL)
 * @param {string} method - HTTP method
 * @param {object} headers - Request headers
 * @param {object|string|null} data - Request body data
 * @returns {Promise<object>} Response object with status, headers, body, rawBody
 */
function makeRequest(target, requestPath, method = 'GET', headers = {}, data = null, debug = false) {
    return new Promise((resolve, reject) => {
        const timeout = 30000;

        let requestModule;
        let reqOptions;
        let fullUrl;

        // Determine if target is a URL string or localhost config
        if (typeof target === 'string') {
            // URL-based request (production)
            fullUrl = `${target}${requestPath}`;
            const parsedUrl = new URL(fullUrl);
            requestModule = parsedUrl.protocol === 'https:' ? https : http;

            reqOptions = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method: method,
                headers: headers
            };
        } else {
            // Localhost-based request (development)
            requestModule = http;
            fullUrl = `http://${target.hostname}:${target.port}${requestPath}`;
            reqOptions = {
                hostname: target.hostname,
                port: target.port,
                path: requestPath,
                method: method,
                headers: headers
            };
        }

        // Prepare body data if provided
        let bodyData = null;
        if (data) {
            bodyData = typeof data === 'string' ? data : JSON.stringify(data);
            reqOptions.headers['Content-Type'] = reqOptions.headers['Content-Type'] || 'application/json';
            reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyData);
        }

        // Debug logging for production requests
        if (debug || typeof target === 'string') {
            const maskedHeaders = { ...headers };
            if (maskedHeaders['Authorization']) {
                const authHeader = maskedHeaders['Authorization'];
                if (authHeader.startsWith('Bearer ')) {
                    const key = authHeader.substring(7);
                    maskedHeaders['Authorization'] = `Bearer ${key.substring(0, 10)}...${key.substring(key.length - 4)}`;
                }
            }
            console.log(`    [DEBUG] Making ${method} request to: ${fullUrl}`);
            console.log(`    [DEBUG] Headers: ${JSON.stringify(maskedHeaders, null, 2)}`);
            if (bodyData) {
                const bodyPreview = typeof data === 'string' ? data.substring(0, 100) : JSON.stringify(data).substring(0, 100);
                console.log(`    [DEBUG] Body: ${bodyPreview}${bodyPreview.length >= 100 ? '...' : ''}`);
            }
        }

        const req = requestModule.request(reqOptions, (res) => {
            if (debug || typeof target === 'string') {
                console.log(`    [DEBUG] Response status: ${res.statusCode}`);
                console.log(`    [DEBUG] Response headers: ${JSON.stringify(res.headers, null, 2)}`);
            }

            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = body ? JSON.parse(body) : null;
                    if (debug || typeof target === 'string') {
                        const bodyPreview = typeof parsed === 'string' ? parsed.substring(0, 200) : JSON.stringify(parsed).substring(0, 200);
                        console.log(`    [DEBUG] Response body: ${bodyPreview}${bodyPreview.length >= 200 ? '...' : ''}`);
                    }
                    resolve({ status: res.statusCode, headers: res.headers, body: parsed, rawBody: body });
                } catch (e) {
                    if (debug || typeof target === 'string') {
                        console.log(`    [DEBUG] Response body (raw): ${body.substring(0, 200)}${body.length >= 200 ? '...' : ''}`);
                    }
                    resolve({ status: res.statusCode, headers: res.headers, body: body, rawBody: body });
                }
            });
        });

        req.on('error', (error) => {
            if (debug || typeof target === 'string') {
                console.log(`    [DEBUG] Request error: ${error.message}`);
                console.log(`    [DEBUG] Error stack: ${error.stack}`);
            }
            reject(error);
        });

        req.setTimeout(timeout, () => {
            if (debug || typeof target === 'string') {
                console.log(`    [DEBUG] Request timeout after ${timeout}ms`);
            }
            req.destroy();
            reject(new Error(`Request timeout after ${timeout}ms`));
        });

        if (bodyData) {
            req.write(bodyData);
        }
        req.end();
    });
}

/**
 * Run the GitHub API test suite
 * @param {string|object} target - Either a URL string or {hostname, port} object
 * @param {string} testRepo - Repository to test against (format: owner/repo)
 * @param {string} apiKey - API key for authentication
 * @param {TestRunner} runner - Test runner instance
 * @returns {Promise<Array>} Array of created files for cleanup
 */
async function runGitHubTests(target, testRepo, apiKey, runner) {
    const createdFiles = []; // Track files/folders to clean up

    // Generate unique test file name
    const timestamp = Date.now();
    const testFileName = `test-${timestamp}.txt`;
    const testFilePath = `test-files/${testFileName}`;
    const testFolderPath = `test-files/test-folder-${timestamp}`;

    // Test 1: PUT - Create a test file
    console.log('  [TEST 1] PUT - Create test file');
    try {
        const authHeader = `Bearer ${apiKey}`;
        const putResponse = await makeRequest(
            target,
            `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=${encodeURIComponent(testFilePath)}`,
            'PUT',
            {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            {
                content: `Test file created at ${new Date().toISOString()}`,
                message: `Test: Create file ${testFileName}`
            }
        );

        console.log(`    Status: ${putResponse.status}`);
        if (putResponse.status !== 200 && putResponse.status !== 201) {
            console.log(`    Error response: ${JSON.stringify(putResponse.body).substring(0, 300)}`);
            console.log(`    Request headers sent: Authorization=${authHeader.substring(0, 20)}...`);
        }
        runner.test('PUT creates file successfully', putResponse.status === 200 || putResponse.status === 201, `Got status ${putResponse.status}`);

        if (putResponse.status === 200 || putResponse.status === 201) {
            createdFiles.push({ path: testFilePath, sha: putResponse.body?.content?.sha });
            runner.test('Response contains file info', !!putResponse.body?.content);
        }
    } catch (e) {
        console.log(`    Error: ${e.message}`);
        runner.test('PUT request succeeds', false, e.message);
    }

    // Test 2: GET - Verify the file exists
    console.log('\n  [TEST 2] GET - Verify file exists');
    try {
        await sleep(1000); // Give GitHub a moment to process
        const getResponse = await makeRequest(
            target,
            `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=${encodeURIComponent(testFilePath)}`,
            'GET',
            {
                'Authorization': `Bearer ${apiKey}`
            }
        );

        console.log(`    Status: ${getResponse.status}`);
        if (getResponse.status !== 200) {
            console.log(`    Error response: ${JSON.stringify(getResponse.body).substring(0, 300)}`);
        }
        runner.test('GET retrieves created file', getResponse.status === 200, `Got status ${getResponse.status}`);

        if (getResponse.status === 200) {
            runner.test('File content matches',
                getResponse.body?.content?.includes('Test file created') ||
                (typeof getResponse.body === 'string' && getResponse.body.includes('Test file created')));

            // Update SHA for cleanup
            if (getResponse.body?.sha && createdFiles.length > 0) {
                createdFiles[0].sha = getResponse.body.sha;
            }
        }
    } catch (e) {
        console.log(`    Error: ${e.message}`);
        runner.test('GET request succeeds', false, e.message);
    }

    // Test 3: POST - Create a test folder
    console.log('\n  [TEST 3] POST - Create test folder');
    try {
        const postResponse = await makeRequest(
            target,
            `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=${encodeURIComponent(testFolderPath)}`,
            'POST',
            {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            {
                message: `Test: Create folder ${testFolderPath}`
            }
        );

        console.log(`    Status: ${postResponse.status}`);
        if (postResponse.status !== 200 && postResponse.status !== 201) {
            console.log(`    Error response: ${JSON.stringify(postResponse.body).substring(0, 300)}`);
        }
        runner.test('POST creates folder successfully', postResponse.status === 200 || postResponse.status === 201, `Got status ${postResponse.status}`);

        if (postResponse.status === 200 || postResponse.status === 201) {
            createdFiles.push({ path: `${testFolderPath}/.gitkeep`, sha: postResponse.body?.content?.sha });
        }
    } catch (e) {
        console.log(`    Error: ${e.message}`);
        runner.test('POST request succeeds', false, e.message);
    }

    // Test 4: PUT - Update the test file
    console.log('\n  [TEST 4] PUT - Update test file');
    try {
        if (createdFiles.length > 0 && createdFiles[0].sha) {
            const updateResponse = await makeRequest(
                target,
                `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=${encodeURIComponent(testFilePath)}`,
                'PUT',
                {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                {
                    content: `Test file updated at ${new Date().toISOString()}`,
                    message: `Test: Update file ${testFileName}`,
                    sha: createdFiles[0].sha
                }
            );

            console.log(`    Status: ${updateResponse.status}`);
            runner.test('PUT updates file successfully', updateResponse.status === 200, `Got status ${updateResponse.status}`);

            if (updateResponse.status === 200) {
                // Update SHA for cleanup
                createdFiles[0].sha = updateResponse.body?.content?.sha;
            }
        } else {
            runner.test('PUT updates file successfully', false, 'No file SHA available');
        }
    } catch (e) {
        console.log(`    Error: ${e.message}`);
        runner.test('PUT update succeeds', false, e.message);
    }

    // Test 5: PATCH - Apply partial edits to a file
    console.log('\n  [TEST 5] PATCH - Apply text edits');
    try {
        // First, create a file with known content for testing edits
        const patchTestFileName = `test-patch-${timestamp}.txt`;
        const patchTestFilePath = `test-files/${patchTestFileName}`;
        const initialContent = 'Line 1: Hello\nLine 2: World\nLine 3: Test\nLine 4: Content';

        // Create the file
        const createResponse = await makeRequest(
            target,
            `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=${encodeURIComponent(patchTestFilePath)}`,
            'PUT',
            {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            {
                content: initialContent,
                message: `Test: Create file for PATCH test ${patchTestFileName}`
            }
        );

        if (createResponse.status === 200 || createResponse.status === 201) {
            await sleep(1000); // Give GitHub a moment to process

            // Apply a PATCH edit: replace "World" with "Universe"
            const patchResponse = await makeRequest(
                target,
                `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=${encodeURIComponent(patchTestFilePath)}`,
                'PATCH',
                {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                {
                    edits: [
                        {
                            range: {
                                start: { line: 1, character: 7 },
                                end: { line: 1, character: 12 }
                            },
                            newText: 'Universe'
                        }
                    ],
                    message: `Test: Apply PATCH edit to ${patchTestFileName}`
                }
            );

            console.log(`    Status: ${patchResponse.status}`);
            runner.test('PATCH applies edits successfully', patchResponse.status === 200, `Got status ${patchResponse.status}`);

            if (patchResponse.status === 200) {
                // Verify the edit was applied correctly
                await sleep(1000);
                const verifyResponse = await makeRequest(
                    target,
                    `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=${encodeURIComponent(patchTestFilePath)}`,
                    'GET',
                    {
                        'Authorization': `Bearer ${apiKey}`
                    }
                );

                if (verifyResponse.status === 200) {
                    const content = verifyResponse.body?.content || verifyResponse.body;
                    const hasUniverse = typeof content === 'string' && content.includes('Universe');
                    const hasOriginalWorld = typeof content === 'string' && content.includes('World');
                    runner.test('PATCH edit applied correctly', hasUniverse && !hasOriginalWorld,
                        hasUniverse ? 'Edit verified' : 'Content verification failed');
                }

                // Track file for cleanup
                createdFiles.push({
                    path: patchTestFilePath,
                    sha: patchResponse.body?.content?.sha || createResponse.body?.content?.sha
                });
            } else {
                console.log(`    Error response: ${JSON.stringify(patchResponse.body).substring(0, 300)}`);
            }
        } else {
            runner.test('PATCH test setup succeeds', false, `Failed to create test file: ${createResponse.status}`);
        }
    } catch (e) {
        console.log(`    Error: ${e.message}`);
        runner.test('PATCH request succeeds', false, e.message);
    }

    // Test 6: PATCH - Test invalid edit (out of bounds)
    console.log('\n  [TEST 6] PATCH - Test invalid edit validation');
    try {
        if (createdFiles.length > 0) {
            const invalidPatchResponse = await makeRequest(
                target,
                `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=${encodeURIComponent(testFilePath)}`,
                'PATCH',
                {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                {
                    edits: [
                        {
                            range: {
                                start: { line: 9999, character: 0 },
                                end: { line: 10000, character: 0 }
                            },
                            newText: 'This should fail'
                        }
                    ],
                    message: `Test: Invalid edit range`
                }
            );

            console.log(`    Status: ${invalidPatchResponse.status}`);
            runner.test('PATCH rejects invalid edit range', invalidPatchResponse.status === 400,
                `Got status ${invalidPatchResponse.status}, expected 400`);
        } else {
            runner.test('PATCH invalid edit test', false, 'No test file available');
        }
    } catch (e) {
        console.log(`    Error: ${e.message}`);
        runner.test('PATCH invalid edit test', false, e.message);
    }

    return createdFiles;
}

/**
 * Clean up created test files
 * @param {string|object} target - Either a URL string or {hostname, port} object
 * @param {string} testRepo - Repository to clean up in
 * @param {string} apiKey - API key for authentication
 * @param {Array} createdFiles - Array of file objects with path and sha
 */
async function cleanupTestFiles(target, testRepo, apiKey, createdFiles) {
    console.log('\n  [CLEANUP] Deleting test files...');
    for (const file of createdFiles.reverse()) { // Delete in reverse order
        if (file.sha) {
            try {
                const deleteResponse = await makeRequest(
                    target,
                    `/api/repos/contents?repo=${encodeURIComponent(testRepo)}&path=${encodeURIComponent(file.path)}`,
                    'DELETE',
                    {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    {
                        message: `Test cleanup: Delete ${file.path}`,
                        sha: file.sha
                    }
                );

                if (deleteResponse.status === 200) {
                    console.log(`    ✓ Deleted ${file.path}`);
                } else {
                    console.log(`    ⚠ Failed to delete ${file.path} (status ${deleteResponse.status})`);
                }
            } catch (e) {
                console.log(`    ⚠ Error deleting ${file.path}: ${e.message}`);
            }
            await sleep(500); // Small delay between deletions
        }
    }
}

module.exports = {
    TestRunner,
    sleep,
    makeRequest,
    runGitHubTests,
    cleanupTestFiles
};

