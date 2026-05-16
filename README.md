# imageCompresssor

A GitHub Actions helper repository for generating production-ready WebP image variants from a source image repo and pushing the generated assets into a target repo.

## What it does

- Scans a source repository for `jpg`, `jpeg`, and `webp` images
- Generates WebP variants only for new or changed images
- Preserves the source folder structure in the target repository
- Writes a folder per source image containing variants named with pixel width
- Commits and pushes generated output to the target repo

## Output structure

A source image like:

- `photos/products/shirt.jpg`

Becomes output in the target repo as:

- `photos/products/shirt/shirt-200.webp`
- `photos/products/shirt/shirt-640.webp`
- `photos/products/shirt/shirt-1024.webp`
- `photos/products/shirt/shirt-1920.webp`

## Generated sizes

The action generates these WebP widths:

- `200px`
- `640px`
- `1024px`
- `1920px`

All variants keep the original aspect ratio and are converted to WebP.

## Files added

- `.github/workflows/compress-images.yml` — workflow definition
- `package.json` — Node.js package manifest with `sharp`
- `scripts/generate-images.js` — image scanning and WebP generation logic
- `.gitignore` — ignores `node_modules`

## Usage

Install dependencies locally:

```bash
npm install
```

Run generation manually:

```bash
node scripts/generate-images.js --source-root source --output-root compressed --changed-files-file changed-files.txt
```

## GitHub Actions

The workflow is configured to run on `push` to `main` and only when image files change.

### Target repo permissions

Pushing generated output to `shasabolton/compressedImages` may require a personal access token. Define a secret named `TARGET_REPO_PAT` in the source repository if cross-repo permissions are needed.

If the token is not provided, the workflow will attempt to push using the default `GITHUB_TOKEN`.

## What next

1. Create a workflow file in your repository at `.github/workflows/compress-images.yml`.
   - The workflow should checkout your source repo, install dependencies, and run `npm run generate`.
   - If you are pushing generated output back to the same repository, `GITHUB_TOKEN` is usually enough.
   - If you are pushing to a different repository, use a personal access token (PAT) stored as a secret.

2. Get a GitHub personal access token (PAT):
   - Open GitHub and go to your profile icon > `Settings` > `Developer settings` > `Personal access tokens` > `Tokens (classic)` or `Fine-grained tokens`.
   - Create a token with at least `repo` permissions for the target repository.
   - If you only need to push to the same repository, this is not required.

3. Add the token as a repository secret:
   - In your repo, go to `Settings` > `Secrets and variables` > `Actions`.
   - Click `New repository secret`.
   - Name it `TARGET_REPO_PAT` and paste the PAT value.

4. Use the secret in your workflow:
   - Reference `secrets.TARGET_REPO_PAT` in the workflow if the action needs to push to another repo.
   - If using the default repo, `GITHUB_TOKEN` is available automatically.

5. Where to look for setup help:
   - GitHub Actions docs: https://docs.github.com/en/actions
   - Secrets setup: https://docs.github.com/en/actions/security-guides/encrypted-secrets
   - Workflow syntax: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions

This gives you the full path to add the action, configure tokens, and use the generated image pipeline in GitHub. If you want, I can also provide a ready-to-use `compress-images.yml` workflow file example.