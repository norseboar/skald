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
    body?: any
): Promise<Response> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error('GITHUB_TOKEN not configured');
    }

    const options: RequestInit = {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        },
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    return fetch(url, options);
}

export default async function handler(
    req: VercelRequest,
    res: VercelResponse
) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
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
                if (fileData.encoding === 'base64' && fileData.content) {
                    const decodedContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
                    return res.status(200).json({
                        ...fileData,
                        content: decodedContent,
                    });
                }

                return res.status(200).json(data);
            }

            case 'PUT': {
                const { content, message } = req.body;

                if (!content || typeof content !== 'string') {
                    return res.status(400).json({ error: 'Content is required and must be a string' });
                }
                if (!message || typeof message !== 'string') {
                    return res.status(400).json({ error: 'Message is required and must be a string' });
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

