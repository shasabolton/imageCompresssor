#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const TARGET_WIDTHS = [200, 640, 1024, 1920];
const QUALITY = 80;

async function readMagicBytes(filePath, length = 16) {
  const handle = await fs.open(filePath, 'r');
  const buffer = Buffer.alloc(length);
  await handle.read(buffer, 0, length, 0);
  await handle.close();
  return buffer;
}

function isGitLfsPointer(header) {
  return header.toString('utf8', 0, 24).startsWith('version https://git-lfs.github.com/spec/v1');
}

function isJpegHeader(header) {
  return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
}

function isPngHeader(header) {
  return header.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isWebpHeader(header) {
  return header.slice(0, 4).toString('ascii') === 'RIFF' && header.slice(8, 12).toString('ascii') === 'WEBP';
}

function isValidImageHeader(header) {
  return isJpegHeader(header) || isPngHeader(header) || isWebpHeader(header);
}

async function parseArgs() {
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

function slugify(text) {
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeOrientation(width, height) {
  if (width === height) return 'square';
  return width > height ? 'landscape' : 'portrait';
}

function parseDateTaken(exifBuffer) {
  if (!exifBuffer) {
    return '';
  }

  const text = exifBuffer.toString('ascii');
  const match = text.match(/\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/);
  if (!match) {
    return '';
  }

  const normalized = match[0].replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

async function getDominantColor(sourcePath) {
  try {
    const { data } = await sharp(sourcePath)
      .rotate()
      .resize(1, 1, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const [r, g, b] = data;
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  } catch (err) {
    console.warn(`Failed to extract dominant color with rotation: ${err.message}`);
    try {
      const { data } = await sharp(sourcePath)
        .resize(1, 1, { fit: 'fill' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const [r, g, b] = data;
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    } catch (err2) {
      console.warn(`Failed to extract dominant color even without rotation, using default: ${err2.message}`);
      return '#000000'; // Return black as default when extraction fails
    }
  }
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
  try {
    // Try with rotation first (respects EXIF orientation)
    await sharp(sourcePath)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(outputPath);
  } catch (err) {
    console.warn(`Variant generation with rotation failed: ${err.message}, retrying without rotation...`);
    try {
      // Fallback: try without rotation
      await sharp(sourcePath)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(outputPath);
    } catch (err2) {
      // If still failing, try with auto-orientation (alternative to rotate)
      console.warn(`Variant generation without rotation failed: ${err2.message}, trying with normalized metadata...`);
      await sharp(sourcePath)
        .withMetadata()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(outputPath);
    }
  }
}

async function writeMetadataFile(outputFolder, metadataObject) {
  const metadataPath = path.join(outputFolder, 'metadata.json');
  await fs.writeFile(metadataPath, JSON.stringify(metadataObject, null, 2) + '\n', 'utf8');
}

async function buildIndexFile(outputRoot) {
  const entries = [];

  async function traverse(currentDir) {
    const entriesInDir = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entriesInDir) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await traverse(entryPath);
      } else if (entry.isFile() && entry.name === 'metadata.json') {
        const raw = await fs.readFile(entryPath, 'utf8');
        const entryMeta = JSON.parse(raw);
        entries.push({
          folder: path.relative(outputRoot, currentDir),
          ...entryMeta,
        });
      }
    }
  }

  await traverse(outputRoot);
  const indexData = {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    images: entries,
  };
  await fs.writeFile(path.join(outputRoot, 'index.json'), JSON.stringify(indexData, null, 2) + '\n', 'utf8');
  console.log(`Wrote index.json with ${entries.length} image entries.`);
}

async function processImage(sourceRoot, outputRoot, relativeSourcePath) {
  const sourcePath = path.join(sourceRoot, relativeSourcePath);
  const sourceStats = await fs.stat(sourcePath);
  const fileExt = path.extname(relativeSourcePath).toLowerCase();
  const baseName = path.basename(relativeSourcePath, fileExt);
  const outputFolder = path.join(outputRoot, path.dirname(relativeSourcePath), baseName);

  await ensureDir(outputFolder);

  const header = await readMagicBytes(sourcePath, 16);
  if (isGitLfsPointer(header)) {
    throw new Error(`Git LFS pointer file detected: ${relativeSourcePath}. Ensure LFS objects were fetched before processing.`);
  }

  if (!isValidImageHeader(header)) {
    throw new Error(`Invalid image header detected for ${relativeSourcePath}.`);
  }

  let image;
  let metadata;
  
  // Try to process with rotation first (respects EXIF orientation)
  try {
    image = sharp(sourcePath).rotate();
    metadata = await image.metadata();
  } catch (err) {
    // If rotation fails, try without it (may be EXIF corruption or libvips version issue)
    console.warn(`Processing ${relativeSourcePath} without rotation due to: ${err.message}`);
    image = sharp(sourcePath);
    metadata = await image.metadata();
  }
  
  if (!metadata.width || !metadata.height) {
    console.warn(`Skipping ${relativeSourcePath}: unable to read image dimensions.`);
    return;
  }

  const normalizedWidth = metadata.width;
  const normalizedHeight = metadata.height;
  const aspectRatio = Number((normalizedWidth / normalizedHeight).toFixed(4));
  const orientation = normalizeOrientation(normalizedWidth, normalizedHeight);
  const dateTaken = parseDateTaken(metadata.exif);
  const dominantColor = await getDominantColor(sourcePath);

  const variants = {};
  let generatedCount = 0;

  for (const targetWidth of TARGET_WIDTHS) {
    const outputFileName = `${baseName}-${targetWidth}.webp`;
    const outputPath = path.join(outputFolder, outputFileName);
    const finalWidth = Math.min(targetWidth, normalizedWidth);

    const shouldGenerate = await imageNeedsGenerate(sourcePath, outputPath, sourceStats.mtimeMs);
    if (!shouldGenerate) {
      variants[targetWidth] = outputFileName;
      continue;
    }

    try {
      await generateVariant(sourcePath, outputPath, finalWidth);
      variants[targetWidth] = outputFileName;
      generatedCount += 1;
      console.log(`Generated ${path.relative(outputRoot, outputPath)} (${finalWidth}px)`);
    } catch (error) {
      console.error(`Failed to generate ${outputFileName} from ${relativeSourcePath}: ${error.message}`);
      return;
    }
  }

  const metadataObject = {
    title: '',
    slug: slugify(baseName),
    width: normalizedWidth,
    height: normalizedHeight,
    aspectRatio,
    orientation,
    dateTaken,
    variants,
    dominantColor,
    tags: [],
  };
  await writeMetadataFile(outputFolder, metadataObject);

  if (generatedCount === 0) {
    console.log(`No new variants needed for ${relativeSourcePath}`);
  }
}

async function main() {
  const args = await parseArgs();
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
  let successCount = 0;
  let failureCount = 0;

  for (const relativeImagePath of changedFiles) {
    try {
      await processImage(sourceRoot, outputRoot, relativeImagePath);
      successCount += 1;
    } catch (error) {
      failureCount += 1;
      console.error(`❌ Failed processing ${relativeImagePath}`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failureCount}`);

  if (failureCount > 0) {
    process.exit(1);
  }

  await buildIndexFile(outputRoot);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
