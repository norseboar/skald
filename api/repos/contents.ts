import type { VercelRequest, VercelResponse } from '@vercel/node';

interface GitHubContentItem {
    name: string;
    path: string;
    sha: string;
    size: number;
    url: string;
    html_url: string;
    git_url: string;
    download_url: string | null;
    type: 'file' | 'dir';
    content?: string;
    encoding?: string;
}

interface GitHubContentResponse {
    content: string;
    encoding: string;
    sha: string;
    size: number;
    url: string;
    html_url: string;
    git_url: string;
    download_url: string | null;
    lineCount?: number; // Added for Option A
}

interface GitHubCreateUpdateResponse {
    content: GitHubContentResponse;
    commit: {
        sha: string;
        node_id: string;
        url: string;
        html_url: string;
        author: {
            name: string;
            email: string;
            date: string;
        };
        committer: {
            name: string;
            email: string;
            date: string;
        };
        message: string;
        tree: {
            sha: string;
            url: string;
        };
        parents: Array<{ sha: string; url: string; html_url: string }>;
    };
}

interface TextEditRange {
    start: { line: number; character: number };
    end: { line: number; character: number };
}

interface TextEdit {
    range: TextEditRange;
    newText: string;
}

function maskSecret(value: string | undefined | null): string {
    if (!value) {
        return '(empty or not set)';
    }
    if (value.length <= 6) {
        return '(too short to mask)';
    }
    return `${value.substring(0, 3)}...${value.substring(value.length - 3)}`;
}

function getAuthHeader(req: VercelRequest): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
}

function validateApiKey(req: VercelRequest): boolean {
    const apiKey = process.env.API_KEY;
    const providedKey = getAuthHeader(req);

    // Log environment variables and auth info
    console.log('[AUTH DEBUG] Environment variables:');
    console.log(`  API_KEY: ${maskSecret(apiKey)} (length: ${apiKey?.length || 0})`);
    console.log(`  GITHUB_TOKEN: ${maskSecret(process.env.GITHUB_TOKEN)} (length: ${process.env.GITHUB_TOKEN?.length || 0})`);
    console.log(`  ALLOWED_REPOS: ${process.env.ALLOWED_REPOS || '(empty or not set)'}`);
    console.log('[AUTH DEBUG] Client auth:');
    console.log(`  Authorization header present: ${!!req.headers.authorization}`);
    console.log(`  Provided API key: ${maskSecret(providedKey)} (length: ${providedKey?.length || 0})`);
    console.log(`  Keys match: ${providedKey === apiKey}`);
    console.log(`  Server API key length: ${apiKey?.length || 0}, Client API key length: ${providedKey?.length || 0}`);

    if (!apiKey) {
        console.log('[AUTH DEBUG] API_KEY environment variable is not set');
        return false;
    }
    if (!providedKey) {
        console.log('[AUTH DEBUG] No API key provided in Authorization header');
        return false;
    }

    return providedKey === apiKey;
}

function validateRepo(repo: string): boolean {
    const allowedRepos = process.env.ALLOWED_REPOS;
    if (!allowedRepos) {
        return false;
    }
    const allowedList = allowedRepos.split(',').map(r => r.trim());
    return allowedList.includes(repo);
}

async function githubApiRequest(
    method: string,
    url: string,
    body?: any,
    useRawMediaType?: boolean
): Promise<Response> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error('GITHUB_TOKEN not configured');
    }

    const acceptHeader = useRawMediaType
        ? 'application/vnd.github.v3.raw'
        : 'application/vnd.github.v3+json';

    const options: RequestInit = {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': acceptHeader,
            'Content-Type': 'application/json',
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    return fetch(url, options);
}

/**
 * Validates a TextEdit object
 */
function validateTextEdit(edit: any): edit is TextEdit {
    if (!edit || typeof edit !== 'object') {
        return false;
    }
    if (!edit.range || typeof edit.range !== 'object') {
        return false;
    }
    if (!edit.range.start || typeof edit.range.start !== 'object' ||
        typeof edit.range.start.line !== 'number' ||
        typeof edit.range.start.character !== 'number') {
        return false;
    }
    if (!edit.range.end || typeof edit.range.end !== 'object' ||
        typeof edit.range.end.line !== 'number' ||
        typeof edit.range.end.character !== 'number') {
        return false;
    }
    if (typeof edit.newText !== 'string') {
        return false;
    }
    // Validate range: start must be before or equal to end
    if (edit.range.start.line > edit.range.end.line ||
        (edit.range.start.line === edit.range.end.line &&
            edit.range.start.character > edit.range.end.character)) {
        return false;
    }
    return true;
}

/**
 * Applies LSP TextEdit format edits to file content
 * Edits are applied in reverse order (highest line number first) to preserve positions
 */
function applyTextEdits(content: string, edits: TextEdit[]): string {
    if (edits.length === 0) {
        return content;
    }

    const lines = content.split(/\r?\n/);

    // Sort edits by position (highest line/character first) to apply in reverse order
    const sortedEdits = [...edits].sort((a, b) => {
        if (b.range.end.line !== a.range.end.line) {
            return b.range.end.line - a.range.end.line;
        }
        return b.range.end.character - a.range.end.character;
    });

    for (const edit of sortedEdits) {
        const { range, newText } = edit;

        // Validate range bounds (enhanced error messages - Option D)
        if (range.start.line < 0) {
            throw new Error(`Edit range out of bounds: start line ${range.start.line} is negative (file has ${lines.length} lines, 0-based indexing)`);
        }
        if (range.end.line >= lines.length) {
            throw new Error(`Edit range out of bounds: end line ${range.end.line} exceeds file length (file has ${lines.length} lines, 0-based indexing, max valid line is ${lines.length - 1})`);
        }
        if (range.start.line > range.end.line) {
            throw new Error(`Edit range invalid: start line ${range.start.line} is greater than end line ${range.end.line}`);
        }

        // Handle single-line edits
        if (range.start.line === range.end.line) {
            const line = lines[range.start.line];
            if (range.start.character < 0) {
                throw new Error(`Edit range out of bounds on line ${range.start.line}: start character ${range.start.character} is negative (line has ${line.length} characters, 0-based indexing)`);
            }
            if (range.end.character > line.length) {
                throw new Error(`Edit range out of bounds on line ${range.start.line}: end character ${range.end.character} exceeds line length (line has ${line.length} characters, 0-based indexing, max valid character is ${line.length})`);
            }
            const before = line.substring(0, range.start.character);
            const after = line.substring(range.end.character);
            lines[range.start.line] = before + newText + after;
        } else {
            // Handle multi-line edits
            const firstLine = lines[range.start.line];
            const lastLine = lines[range.end.line];

            if (range.start.character < 0 || range.start.character > firstLine.length) {
                throw new Error(`Edit range out of bounds on start line ${range.start.line}: character ${range.start.character} (line has ${firstLine.length} characters, 0-based indexing, max valid character is ${firstLine.length})`);
            }
            if (range.end.character < 0 || range.end.character > lastLine.length) {
                throw new Error(`Edit range out of bounds on end line ${range.end.line}: character ${range.end.character} (line has ${lastLine.length} characters, 0-based indexing, max valid character is ${lastLine.length})`);
            }

            const before = firstLine.substring(0, range.start.character);
            const after = lastLine.substring(range.end.character);

            // Split newText into lines
            const newTextLines = newText.split(/\r?\n/);

            // Replace the lines
            const replacedLines = [
                before + (newTextLines[0] || ''),
                ...newTextLines.slice(1),
                after
            ];

            // Remove the old lines and insert the new ones
            lines.splice(range.start.line, range.end.line - range.start.line + 1, ...replacedLines);
        }
    }

    return lines.join('\n');
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Log request info
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    console.log(`[REQUEST] Query params: repo=${req.query.repo}, path=${req.query.path}`);

    // Validate API key
    if (!validateApiKey(req)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }

    // Get repo from query parameter
    const repo = req.query.repo as string;
    if (!repo) {
        return res.status(400).json({ error: 'Repository parameter is required' });
    }

    // Validate repo is in allowed list
    if (!validateRepo(repo)) {
        return res.status(403).json({ error: 'Repository not allowed' });
    }

    const path = req.query.path as string;
    if (!path) {
        return res.status(400).json({ error: 'Path parameter is required' });
    }

    const branch = (req.query.branch as string) || 'main';
    const [owner, repoName] = repo.split('/');

    if (!owner || !repoName) {
        return res.status(400).json({ error: 'Invalid repository format. Use owner/repo' });
    }

    const githubUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${encodeURIComponent(path)}`;

    try {
        switch (req.method) {
            case 'GET': {
                // Check if this is a search request (Option B)
                const searchPattern = req.query.search as string | undefined;

                const response = await githubApiRequest('GET', `${githubUrl}?ref=${branch}`);
                const data = await response.json() as GitHubContentItem[] | GitHubContentResponse | any;

                if (!response.ok) {
                    return res.status(response.status).json(data);
                }

                // If it's an array, it's a directory listing
                if (Array.isArray(data)) {
                    return res.status(200).json(data);
                }

                // Otherwise it's a file - decode base64 content
                const fileData = data as GitHubContentResponse;
                let decodedContent: string = '';

                if (fileData.encoding === 'base64' && fileData.content) {
                    decodedContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
                } else if (fileData.content && typeof fileData.content === 'string') {
                    decodedContent = fileData.content;
                } else {
                    return res.status(200).json(data);
                }

                // Calculate line count (Option A)
                const lines = decodedContent.split(/\r?\n/);
                const lineCount = lines.length;

                // If search pattern provided, find matches (Option B)
                if (searchPattern) {
                    const matches: Array<{ line: number; character: number; text: string }> = [];

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        let startIndex = 0;

                        // Find all occurrences of the pattern in this line
                        while (true) {
                            const index = line.indexOf(searchPattern, startIndex);
                            if (index === -1) break;

                            matches.push({
                                line: i,
                                character: index,
                                text: line.substring(Math.max(0, index - 20), Math.min(line.length, index + searchPattern.length + 20))
                            });

                            startIndex = index + 1;
                        }
                    }

                    return res.status(200).json({
                        pattern: searchPattern,
                        matches: matches,
                        totalMatches: matches.length,
                        lineCount: lineCount,
                        fileInfo: {
                            path: path,
                            sha: fileData.sha,
                            size: fileData.size
                        }
                    });
                }

                // Regular GET response with line count
                return res.status(200).json({
                    ...fileData,
                    content: decodedContent,
                    lineCount: lineCount,
                });
            }

            case 'PUT': {
                const { content, message } = req.body;

                if (!content || typeof content !== 'string') {
                    return res.status(400).json({ error: 'Content is required and must be a string' });
                }
                if (!message || typeof message !== 'string') {
                    return res.status(400).json({ error: 'Message is required and must be a string' });
                }

                // Check file size limit (100 MB = 100 * 1024 * 1024 bytes)
                const MAX_FILE_SIZE = 100 * 1024 * 1024;
                const contentSize = Buffer.byteLength(content, 'utf-8');
                if (contentSize > MAX_FILE_SIZE) {
                    return res.status(400).json({
                        error: `File size exceeds GitHub limit`,
                        details: `File is ${contentSize} bytes (limit is ${MAX_FILE_SIZE} bytes / 100 MB)`
                    });
                }

                // First, try to get the file to get its SHA (for updates)
                let sha: string | undefined;
                try {
                    const getResponse = await githubApiRequest('GET', `${githubUrl}?ref=${branch}`);
                    if (getResponse.ok) {
                        const existingFile = await getResponse.json() as GitHubContentItem | GitHubContentItem[] | any;
                        if (!Array.isArray(existingFile) && existingFile.sha) {
                            sha = existingFile.sha;
                        }
                    }
                } catch (e) {
                    // File doesn't exist, will create new one
                }

                // Encode content to base64
                const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

                const updateBody: any = {
                    message,
                    content: encodedContent,
                    branch,
                };

                if (sha) {
                    updateBody.sha = sha;
                }

                const response = await githubApiRequest('PUT', githubUrl, updateBody);
                const data = await response.json() as GitHubCreateUpdateResponse | any;

                if (!response.ok) {
                    return res.status(response.status).json(data);
                }

                // Decode the content in the response
                const updateData = data as GitHubCreateUpdateResponse;
                if (updateData.content && updateData.content.encoding === 'base64') {
                    updateData.content.content = Buffer.from(updateData.content.content, 'base64').toString('utf-8');
                }

                return res.status(response.status).json(updateData);
            }

            case 'PATCH': {
                const { edits, message } = req.body;

                if (!edits || !Array.isArray(edits) || edits.length === 0) {
                    return res.status(400).json({ error: 'Edits array is required and must contain at least one edit' });
                }
                if (!message || typeof message !== 'string') {
                    return res.status(400).json({ error: 'Message is required and must be a string' });
                }

                // Validate all edits
                for (let i = 0; i < edits.length; i++) {
                    if (!validateTextEdit(edits[i])) {
                        return res.status(400).json({
                            error: `Invalid edit at index ${i}. Each edit must have a range with start/end (line, character) and newText (string)`
                        });
                    }
                }

                // Get the current file content
                let sha: string | undefined;
                let currentContent: string = '';
                let fileSize: number = 0;

                try {
                    // First check file size to determine if we need raw media type
                    const getResponse = await githubApiRequest('GET', `${githubUrl}?ref=${branch}`);
                    if (!getResponse.ok) {
                        return res.status(getResponse.status).json({
                            error: 'File not found',
                            details: await getResponse.json().catch(() => ({}))
                        });
                    }

                    const existingFile = await getResponse.json() as GitHubContentResponse | any;

                    // Check if it's a directory
                    if (Array.isArray(existingFile)) {
                        return res.status(400).json({ error: 'Cannot apply edits to a directory' });
                    }

                    fileSize = existingFile.size || 0;
                    sha = existingFile.sha;

                    // Use raw media type for files > 1 MB
                    const useRawMediaType = fileSize > 1024 * 1024; // 1 MB

                    const contentResponse = await githubApiRequest('GET', `${githubUrl}?ref=${branch}`, undefined, useRawMediaType);
                    if (!contentResponse.ok) {
                        return res.status(contentResponse.status).json({
                            error: 'Failed to retrieve file content',
                            details: await contentResponse.json().catch(() => ({}))
                        });
                    }

                    if (useRawMediaType) {
                        // Raw content is plain text
                        currentContent = await contentResponse.text();
                    } else {
                        // Regular API response has base64 encoded content
                        const fileData = await contentResponse.json() as GitHubContentResponse;
                        if (fileData.encoding === 'base64' && fileData.content) {
                            currentContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
                        } else {
                            currentContent = fileData.content || '';
                        }
                    }
                } catch (e: any) {
                    return res.status(500).json({
                        error: 'Failed to retrieve file content',
                        message: e.message
                    });
                }

                // Calculate line count for better error messages (Option D)
                const lines = currentContent.split(/\r?\n/);
                const actualLineCount = lines.length;

                // Apply edits
                let updatedContent: string;
                try {
                    updatedContent = applyTextEdits(currentContent, edits as TextEdit[]);
                } catch (e: any) {
                    // Enhanced error message with file stats (Option D)
                    const errorMessage = e.message;

                    // Try multiple patterns to extract line numbers
                    const rangeMatch = errorMessage.match(/line (\d+)-(\d+)/) ||
                        errorMessage.match(/line (\d+)/) ||
                        errorMessage.match(/start line (\d+)/) ||
                        errorMessage.match(/end line (\d+)/);

                    let suggestion = `File has ${actualLineCount} lines (0-based indexing, so max valid line is ${actualLineCount - 1}). `;

                    if (rangeMatch) {
                        const requestedStart = parseInt(rangeMatch[1]);
                        const requestedEnd = rangeMatch[2] ? parseInt(rangeMatch[2]) : requestedStart;

                        if (requestedStart >= actualLineCount) {
                            suggestion += `Requested line ${requestedStart} is out of bounds. `;
                        } else if (requestedEnd >= actualLineCount) {
                            suggestion += `Requested end line ${requestedEnd} is out of bounds. `;
                        }
                        suggestion += 'Check that you calculated line numbers from the complete file content, not truncated content.';

                        return res.status(400).json({
                            error: 'Failed to apply edits',
                            message: errorMessage,
                            details: {
                                actualFileLineCount: actualLineCount,
                                requestedRange: `${requestedStart}-${requestedEnd}`,
                                fileSize: fileSize,
                                filePath: path,
                                suggestion: suggestion
                            }
                        });
                    }

                    // Fallback for errors without parseable line numbers
                    suggestion += 'Check that you calculated line numbers from the complete file content, not truncated content.';

                    return res.status(400).json({
                        error: 'Failed to apply edits',
                        message: errorMessage,
                        details: {
                            actualFileLineCount: actualLineCount,
                            fileSize: fileSize,
                            filePath: path,
                            suggestion: suggestion
                        }
                    });
                }

                // Check file size limit (100 MB = 100 * 1024 * 1024 bytes)
                const MAX_FILE_SIZE = 100 * 1024 * 1024;
                const updatedContentSize = Buffer.byteLength(updatedContent, 'utf-8');
                if (updatedContentSize > MAX_FILE_SIZE) {
                    return res.status(400).json({
                        error: `File size exceeds GitHub limit`,
                        details: `File would be ${updatedContentSize} bytes (limit is ${MAX_FILE_SIZE} bytes / 100 MB)`
                    });
                }

                // Encode updated content to base64
                const encodedContent = Buffer.from(updatedContent, 'utf-8').toString('base64');

                const updateBody: any = {
                    message,
                    content: encodedContent,
                    branch,
                };

                if (sha) {
                    updateBody.sha = sha;
                }

                const response = await githubApiRequest('PUT', githubUrl, updateBody);
                const data = await response.json() as GitHubCreateUpdateResponse | any;

                if (!response.ok) {
                    return res.status(response.status).json(data);
                }

                // Decode the content in the response
                const updateData = data as GitHubCreateUpdateResponse;
                if (updateData.content && updateData.content.encoding === 'base64') {
                    updateData.content.content = Buffer.from(updateData.content.content, 'base64').toString('utf-8');
                }

                return res.status(response.status).json(updateData);
            }

            case 'POST': {
                // Create folder by creating a .gitkeep file
                const { message } = req.body;

                if (!message || typeof message !== 'string') {
                    return res.status(400).json({ error: 'Message is required and must be a string' });
                }

                const folderPath = path.endsWith('/') ? path : `${path}/`;
                const gitkeepPath = `${folderPath}.gitkeep`;
                const gitkeepUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${encodeURIComponent(gitkeepPath)}`;

                // Check if .gitkeep already exists
                let sha: string | undefined;
                try {
                    const getResponse = await githubApiRequest('GET', `${gitkeepUrl}?ref=${branch}`);
                    if (getResponse.ok) {
                        const existingFile = await getResponse.json() as GitHubContentItem | GitHubContentItem[] | any;
                        if (!Array.isArray(existingFile) && existingFile.sha) {
                            sha = existingFile.sha;
                        }
                    }
                } catch (e) {
                    // File doesn't exist, will create new one
                }

                const content = Buffer.from('', 'utf-8').toString('base64');
                const createBody: any = {
                    message,
                    content,
                    branch,
                };

                if (sha) {
                    createBody.sha = sha;
                }

                const response = await githubApiRequest('PUT', gitkeepUrl, createBody);
                const data = await response.json() as GitHubCreateUpdateResponse | any;

                if (!response.ok) {
                    return res.status(response.status).json(data);
                }

                const createData = data as GitHubCreateUpdateResponse;
                return res.status(response.status).json({
                    ...createData,
                    path: folderPath,
                    message: `Folder created via .gitkeep file`,
                });
            }

            case 'DELETE': {
                const { message, sha } = req.body;

                if (!message || typeof message !== 'string') {
                    return res.status(400).json({ error: 'Message is required and must be a string' });
                }
                if (!sha || typeof sha !== 'string') {
                    return res.status(400).json({ error: 'SHA is required and must be a string' });
                }

                const deleteBody = {
                    message,
                    sha,
                    branch,
                };

                const response = await githubApiRequest('DELETE', githubUrl, deleteBody);

                if (!response.ok) {
                    const data = await response.json();
                    return res.status(response.status).json(data);
                }

                // GitHub returns 200 with commit info on successful delete
                const data = await response.json();
                return res.status(200).json(data);
            }

            default:
                return res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (error: any) {
        console.error('Error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

