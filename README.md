# Skald - GitHub API Wrapper

A lightweight Vercel serverless function that wraps GitHub's Content API, allowing you to list directories, get file contents, create/update files, and create folders.

## Project Structure

The project is organized with the web API in the `web/` subdirectory to allow for future additions (e.g., mobile apps):
- `web/` - Vercel serverless functions and configuration
- `web/api/` - API route handlers
- `web/env.template` - Environment variable template
- `web/.env.local` - Your local environment variables (gitignored)

## Setup

1. **Install dependencies** (for local development):
   ```bash
   cd web
   npm install
   ```

2. **Configure environment variables**:
   - Copy `web/env.template` to `web/.env.local` and fill in your values (for local development)
   - In Vercel dashboard, add these environment variables:
     - `GITHUB_TOKEN`: Your GitHub Personal Access Token
     - `ALLOWED_REPOS`: Comma-separated list of allowed repositories (e.g., `owner1/repo1,owner2/repo2`)
     - `API_KEY`: API key for protecting your endpoints

3. **Deploy to Vercel**:
   ```bash
   vercel
   ```
   
   The `vercel.json` file at the root configures Vercel to use `web/` as the root directory.

## API Endpoints

All endpoints require authentication via `Authorization: Bearer <API_KEY>` header.

Base URL: `https://your-project.vercel.app/api/repos/{repo}/contents`

### GET - List Directory or Get File Contents

**Endpoint**: `GET /api/repos/{repo}/contents?path={path}&branch={branch}`

**Query Parameters**:
- `path` (required): File or directory path relative to repo root
- `branch` (optional): Branch name (defaults to `main`)

**Example**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://your-project.vercel.app/api/repos/owner/repo/contents?path=src/utils"
```

**Response** (directory):
```json
[
  {
    "name": "helper.ts",
    "path": "src/utils/helper.ts",
    "sha": "...",
    "type": "file",
    ...
  }
]
```

**Response** (file):
```json
{
  "name": "helper.ts",
  "path": "src/utils/helper.ts",
  "sha": "...",
  "content": "file contents as plain text",
  ...
}
```

### PUT - Create or Update File

**Endpoint**: `PUT /api/repos/{repo}/contents?path={path}&branch={branch}`

**Query Parameters**:
- `path` (required): File path relative to repo root
- `branch` (optional): Branch name (defaults to `main`)

**Body**:
```json
{
  "content": "file contents as plain text",
  "message": "commit message"
}
```

**Example**:
```bash
curl -X PUT \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, World!", "message": "Add hello.txt"}' \
  "https://your-project.vercel.app/api/repos/owner/repo/contents?path=hello.txt"
```

### POST - Create Folder

**Endpoint**: `POST /api/repos/{repo}/contents?path={path}&branch={branch}`

**Query Parameters**:
- `path` (required): Folder path relative to repo root
- `branch` (optional): Branch name (defaults to `main`)

**Body**:
```json
{
  "message": "commit message"
}
```

**Example**:
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Create new folder"}' \
  "https://your-project.vercel.app/api/repos/owner/repo/contents?path=new-folder"
```

**Note**: Creates a `.gitkeep` file in the folder to ensure the folder exists in Git.

### DELETE - Delete File

**Endpoint**: `DELETE /api/repos/{repo}/contents?path={path}&branch={branch}`

**Query Parameters**:
- `path` (required): File path relative to repo root
- `branch` (optional): Branch name (defaults to `main`)

**Body**:
```json
{
  "message": "commit message",
  "sha": "file SHA from GET request"
}
```

**Example**:
```bash
curl -X DELETE \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Delete file", "sha": "abc123..."}' \
  "https://your-project.vercel.app/api/repos/owner/repo/contents?path=hello.txt"
```

## Local Development

Run the development server:
```bash
cd web
npm run dev
```

This will start Vercel's development server at `http://localhost:3000`.

## Notes

- All file contents are handled as plain text (UTF-8)
- The API mirrors GitHub's Content API responses closely
- File operations automatically create parent directories if they don't exist
- Folder creation uses `.gitkeep` files (GitHub doesn't support empty directories)

