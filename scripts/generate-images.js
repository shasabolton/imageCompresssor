#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.webp']);
const TARGET_WIDTHS = [200, 640, 1024, 1920];
const QUALITY = 80;

function parseArgs() {
  const result = {};
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source-root') {
      result.sourceRoot = args[++i];
    } else if (arg === '--output-root') {
      result.outputRoot = args[++i];
    } else if (arg === '--changed-files-file') {
      result.changedFilesFile = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return result;
}

function usage() {
  console.log('Usage: node scripts/generate-images.js --source-root <path> --output-root <path> [--changed-files-file <path>]');
  console.log('If no changed-files-file is provided, the script scans all supported images recursively.');
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readChangedFiles(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function scanImages(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const targetPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await scanImages(targetPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        results.push(path.relative(directory, targetPath));
      }
    }
  }

  return results;
}

async function getSourceFiles(sourceRoot, changedFilesFile) {
  if (changedFilesFile) {
    const changedPaths = await readChangedFiles(changedFilesFile);
    return changedPaths
      .map((relativePath) => relativePath.trim())
      .filter(Boolean)
      .filter((relativePath) => {
        const ext = path.extname(relativePath).toLowerCase();
        return SUPPORTED_EXTENSIONS.has(ext);
      });
  }

  const allFiles = [];
  async function traverse(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await traverse(entryPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          allFiles.push(path.relative(sourceRoot, entryPath));
        }
      }
    }
  }

  await traverse(sourceRoot);
  return allFiles;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function imageNeedsGenerate(sourcePath, outputPath, sourceMtimeMs) {
  if (!(await fileExists(outputPath))) {
    return true;
  }

  const outputStats = await fs.stat(outputPath);
  return outputStats.mtimeMs < sourceMtimeMs;
}

async function generateVariant(sourcePath, outputPath, width) {
  await sharp(sourcePath)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(outputPath);
}

async function processImage(sourceRoot, outputRoot, relativeSourcePath) {
  const sourcePath = path.join(sourceRoot, relativeSourcePath);
  const sourceStats = await fs.stat(sourcePath);
  const fileExt = path.extname(relativeSourcePath).toLowerCase();
  const baseName = path.basename(relativeSourcePath, fileExt);
  const outputFolder = path.join(outputRoot, path.dirname(relativeSourcePath), baseName);

  await ensureDir(outputFolder);

  const metadata = await sharp(sourcePath).metadata();
  if (!metadata.width) {
    console.warn(`Skipping ${relativeSourcePath}: unable to read image width.`);
    return;
  }

  let generatedCount = 0;

  for (const targetWidth of TARGET_WIDTHS) {
    const outputFileName = `${baseName}-${targetWidth}.webp`;
    const outputPath = path.join(outputFolder, outputFileName);
    const finalWidth = Math.min(targetWidth, metadata.width);

    const shouldGenerate = await imageNeedsGenerate(sourcePath, outputPath, sourceStats.mtimeMs);
    if (!shouldGenerate) {
      continue;
    }

    await generateVariant(sourcePath, outputPath, finalWidth);
    generatedCount += 1;
    console.log(`Generated ${path.relative(outputRoot, outputPath)} (${finalWidth}px)`);
  }

  if (generatedCount === 0) {
    console.log(`No new variants needed for ${relativeSourcePath}`);
  }
}

async function main() {
  const args = parseArgs();
  if (args.help || !args.sourceRoot || !args.outputRoot) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const sourceRoot = path.resolve(args.sourceRoot);
  const outputRoot = path.resolve(args.outputRoot);

  const changedFiles = await getSourceFiles(sourceRoot, args.changedFilesFile);
  if (changedFiles.length === 0) {
    console.log('No matching source images found to generate.');
    return;
  }

  console.log(`Processing ${changedFiles.length} source image(s)...`);
  for (const relativeImagePath of changedFiles) {
    try {
      await processImage(sourceRoot, outputRoot, relativeImagePath);
    } catch (error) {
      console.error(`Failed processing ${relativeImagePath}: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
