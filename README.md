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
