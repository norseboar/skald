# Custom GPT Setup for Skald GitHub API Service

This directory contains the files needed to configure a Custom GPT that uses the Skald GitHub API wrapper service.

## Files

1. **`openapi.yaml`** - OpenAPI schema for the API actions
   - Copy the entire contents of this file into the "Actions" section of your Custom GPT configuration
   - The schema defines all available endpoints (GET, PUT, POST, DELETE)

2. **`instructions.md`** - Instructions for the Custom GPT
   - Copy the entire contents of this file into the "Instructions" section of your Custom GPT configuration
   - These instructions guide the GPT on how to function as a Game Specification Updater

## Setup Steps

1. **Configure Authentication**:
   - **Use Bearer Token Authentication** (not Basic Auth)
   - In your Custom GPT's "Actions" configuration, add the API key as the `BearerAuth` token
   - The API key should match the `API_KEY` environment variable in your Vercel deployment
   - The service expects `Authorization: Bearer <your-api-key>` header format

2. **Server URL**:
   - The server URL is already configured as `https://skald-mu.vercel.app` in the `openapi.yaml` file
   - The API path is `/api/repos/contents` with `repo` as a query parameter (not a path parameter)

3. **Configure Repository Access**:
   - Ensure your Vercel deployment has the target repository in the `ALLOWED_REPOS` environment variable (comma-separated list: `owner1/repo1,owner2/repo2`)

4. **Test the Setup**:
   - Try asking the GPT to list files in your repository
   - Test creating a simple markdown file
   - Verify folder creation works as expected

## Suggested Repository Structure

For a game specification repository, consider this structure:

```
game-specs/
├── README.md                 # Overview of the game and spec organization
├── index.json                 # Master index of all documentation
├── systems/                   # Game systems documentation
│   ├── index.json
│   ├── combat.md
│   ├── crafting.md
│   ├── economy.md
│   └── ...
├── tech-trees/               # Technology trees
│   ├── index.json
│   ├── production.md
│   ├── research.md
│   └── ...
├── narrative/                # Story and lore
│   ├── index.json
│   ├── main-quest.md
│   ├── characters.md
│   └── ...
├── mechanics/                # Core game mechanics
│   ├── index.json
│   ├── progression.md
│   ├── rewards.md
│   └── ...
└── decisions/                # Design decision log
    ├── index.json
    └── 2024-01-15-combat-overhaul.md
```

## Recommendations

1. **Index Files**: JSON index files are great for programmatic access and can be used by tools or scripts later. Consider creating them for folders with many files.

2. **Cross-References**: Use markdown links between related documents (e.g., `[Combat System](./systems/combat.md)`) to help navigation.

3. **Decision Logs**: Consider maintaining a `decisions/` folder with dated files documenting major design decisions and their rationale.

4. **Versioning**: If you need to track versions of specs, consider using git tags or including version numbers in filenames/folders.

5. **Templates**: You might want to create template markdown files that the GPT can reference when creating new documentation.

