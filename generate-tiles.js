import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { Command } from 'commander';
import { getIconRelativePath, getDomain, loadIconMtimes } from './utils.js';

const program = new Command();

program
  .option('--force', 'Force regeneration of tiles')
  .option('--emulate [count]', 'Emulate more tiles', (val) => parseInt(val, 10), 0);

program.parse();
const options = program.opts();

// --- Configuration ---
const CONFIG = {
  INPUT_FILE: 'favicons-downloaded.json',
  OUTPUT_FILE: 'favicons-tiled.json',
  ICONS_DIR: 'icons',
  TILES_DIR: 'dist',
  GRID_SIZE: 10,
  ICON_SIZE: 32,
  BORDER_SIZE: 2,
  BACKGROUND_COLOR: { r: 255, g: 255, b: 255, alpha: 0 },
  EAGER_LOAD_TILES: 8,
  HIGH_PRIORITY_TILES: 4,
  HOSTNAME: 'favoriteiconsofinternet.com',
  FORCE_REGEN: options.force,
  EMULATE_MORE_TILES: options.emulate !== 0,
  EMULATE_MORE_TILES_TOTAL_ICONS: options.emulate === true ? 20000 : options.emulate,
};

async function ensureDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function generateOgImage(entries, cellSize, iconMtimes) {
  const ogImagePath = path.join(CONFIG.TILES_DIR, 'og_image.webp');
  console.log('\n🎨 Generating Open Graph Image...');
  const width = 1200;
  const height = 630;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const maxIcons = cols * rows;

  const iconsToUse = entries.slice(0, Math.min(entries.length, maxIcons));
  let shouldGenerate = CONFIG.FORCE_REGEN;

  if (!shouldGenerate) {
    try {
      const ogStats = await fs.stat(ogImagePath);
      const ogMtime = ogStats.mtimeMs;

      // Check if any used icon is newer
      let isStale = false;
      for (const entry of iconsToUse) {
        const relativePath = getIconRelativePath(entry.url);
        const iconMtime = iconMtimes.get(relativePath);
        if (iconMtime && iconMtime > ogMtime) {
          isStale = true;
          break;
        }
      }

      if (isStale) {
        console.log(`  🔄 OG Image is stale. Regenerating...`);
        shouldGenerate = true;
      } else {
        console.log(`  ⏭️  OG Image is up to date. Skipping generation.`);
        return;
      }
    } catch (e) {
      console.log(`  ✨ OG Image is missing. Generating...`);
      shouldGenerate = true;
    }
  } else {
    console.log(`  🔄 Force regenerating OG Image...`);
  }

  const composites = [];

  // Use the top ranked icons
  for (let i = 0; i < iconsToUse.length; i++) {
    const entry = iconsToUse[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = col * cellSize + CONFIG.BORDER_SIZE;
    const top = row * cellSize + CONFIG.BORDER_SIZE;

    try {
      const iconPath = path.join(CONFIG.ICONS_DIR, getIconRelativePath(entry.url));
      const resized = await sharp(iconPath)
        .resize(CONFIG.ICON_SIZE, CONFIG.ICON_SIZE)
        .png() // Convert to PNG first to ensure transparency is handled well before resizing/compositing if needed, but standard sharp pipeline handles this. Keeping png() as intermediate is fine, but output must be avif.
        // Actually, we can just resize and toBuffer. Sharp handles formats.
        .toBuffer();

      composites.push({ input: resized, top, left });
    } catch (e) {
      continue;
    }
  }

  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: CONFIG.BACKGROUND_COLOR,
    },
  })
    .composite(composites)
    .webp({ quality: 20 }) // Change to webp with 25% quality
    .toFile(ogImagePath);
  console.log('✅ Saved OG Image: dist/og_image.webp');
}

async function generateOneTile(
  chunk,
  tileIndex,
  lastExistingTileIndex,
  cellSize,
  imageSize,
  iconMtimes,
) {
  const tileFilename = `tile_${tileIndex}.avif`;
  const tilePath = path.join(CONFIG.TILES_DIR, tileFilename);
  const domainsJsonFilename = `tile_${tileIndex}.json`;
  const domainsJsonPath = path.join(CONFIG.TILES_DIR, domainsJsonFilename);

  console.log(`\n🎨 Generating Tile #${tileIndex} (${chunk.length} icons)...`);

  const composites = [];
  const domains = [];

  for (let j = 0; j < chunk.length; j++) {
    const entry = chunk[j];
    const domain = getDomain(entry.url);
    domains.push(domain);

    // Calculate position
    const col = j % CONFIG.GRID_SIZE;
    const row = Math.floor(j / CONFIG.GRID_SIZE);
    const left = col * cellSize + CONFIG.BORDER_SIZE;
    const top = row * cellSize + CONFIG.BORDER_SIZE;

    try {
      // Resize image to ensure it fits the target size
      const iconPath = path.join(CONFIG.ICONS_DIR, getIconRelativePath(entry.url));
      const resizedImageBuffer = await sharp(iconPath)
        .resize(CONFIG.ICON_SIZE, CONFIG.ICON_SIZE)
        .png()
        .toBuffer();

      // Add to image composite list
      composites.push({
        input: resizedImageBuffer,
        top: top,
        left: left,
      });
    } catch (err) {
      console.warn(`  ⚠️ Skipped resizing/compositing for ${entry.url}: ${err.message}`);
      continue; // Skip this one if resizing fails
    }

    // Update entry with tile info
    entry.tile = {
      file: tileFilename,
      index: j,
      row: row,
      col: col,
    };
  }

  // Generate Image and JSON
  try {
    let shouldGenerate = CONFIG.FORCE_REGEN;

    if (!shouldGenerate) {
      if (tileIndex === lastExistingTileIndex) {
        console.log(`  🔄 Forcing regeneration of the last existing tile #${tileIndex}...`);
        shouldGenerate = true;
      } else {
        try {
          const tileStats = await fs.stat(tilePath);
          const tileMtime = tileStats.mtimeMs;

          // Check if JSON exists and content matches
          let jsonContentChanged = false;
          try {
            const existingJson = JSON.parse(await fs.readFile(domainsJsonPath, 'utf-8'));
            if (JSON.stringify(existingJson) !== JSON.stringify(domains)) {
              jsonContentChanged = true;
              console.log(`  🔄 Tile #${tileIndex} content changed (domains mismatch).`);
            }
          } catch (e) {
            jsonContentChanged = true;
            console.log(`  🔄 Tile #${tileIndex} JSON missing or invalid.`);
          }

          if (jsonContentChanged) {
            shouldGenerate = true;
          } else {
            // Check if any icon in this chunk is newer than the tile
            let isStale = false;
            for (const entry of chunk) {
              const relativePath = getIconRelativePath(entry.url);
              const iconMtime = iconMtimes.get(relativePath);
              if (iconMtime && iconMtime > tileMtime) {
                isStale = true;
                break;
              }
            }

            if (isStale) {
              console.log(`  🔄 Tile #${tileIndex} is stale. Regenerating...`);
              shouldGenerate = true;
            } else {
              console.log(`  ⏭️  Tile #${tileIndex} is up to date. Skipping generation.`);
            }
          }
        } catch (e) {
          // Tile doesn't exist
          console.log(`  ✨ Tile #${tileIndex} is missing. Generating...`);
          shouldGenerate = true;
        }
      }
    } else {
      console.log(`  🔄 Force regenerating Tile #${tileIndex}...`);
    }

    // Check if JSON exists, if not, force generation of at least JSON
    let shouldGenerateJson = shouldGenerate;

    if (!shouldGenerateJson) {
      try {
        await fs.access(domainsJsonPath);
      } catch {
        console.log(`  ✨ JSON for Tile #${tileIndex} is missing. Generating...`);
        shouldGenerateJson = true;
      }
    }

    if (shouldGenerateJson) {
      try {
        await fs.writeFile(domainsJsonPath, JSON.stringify(domains, null, 2));
        console.log(`  ✅ Saved Domains JSON: ${domainsJsonPath}`);
      } catch (err) {
        console.error(`  ❌ Error saving domains JSON for tile ${tileIndex}: ${err.message}`);
      }
    }

    if (shouldGenerate) {
      await sharp({
        create: {
          width: imageSize,
          height: imageSize,
          channels: 4,
          background: CONFIG.BACKGROUND_COLOR,
        },
      })
        .composite(composites)
        .avif() // Changed to .avif()
        .toFile(tilePath);
      console.log(`  ✅ Saved Image: ${tilePath}`);
    }
  } catch (err) {
    console.error(`  ❌ Error generating image for tile ${tileIndex}: ${err.message}`);
  }
}

async function generateTiles() {
  console.log('🚀 Starting tile generation process...');

  // 1. Setup
  await ensureDir(CONFIG.TILES_DIR);
  const iconMtimes = await loadIconMtimes(CONFIG.ICONS_DIR);

  // 2. Load Data
  console.log(`📖 Reading ${CONFIG.INPUT_FILE}...`);
  let entries = [];
  try {
    const rawData = await fs.readFile(CONFIG.INPUT_FILE, 'utf-8');
    entries = JSON.parse(rawData);
    if (!Array.isArray(entries)) {
      console.warn('⚠️ Input file is not an array, defaulting to empty list.');
      entries = [];
    }
  } catch (e) {
    console.warn(`⚠️ Failed to read/parse input file: ${e.message}. Defaulting to empty list.`);
    entries = [];
  }

  // 3. Filter and Sort
  // We only want entries that are successfully downloaded/present locally
  // and we want them sorted by rank.
  const validEntries = entries
    .filter((e) => {
      const relativePath = getIconRelativePath(e.url);
      const mtime = iconMtimes.get(relativePath);

      if (
        (e.status === 'downloaded' ||
          e.status === 'not_modified' ||
          e.status === 'skipped_recent') &&
        mtime &&
        e.rank
      ) {
        // Update timestamps if missing, using file mtime
        if (!e.lastCheckTime) e.lastCheckTime = new Date(mtime).toISOString();
        if (!e.downloadTime) e.downloadTime = new Date(mtime).toISOString();
        return true;
      }
      return false;
    })
    .sort((a, b) => a.rank - b.rank);

  console.log(`📊 Found ${validEntries.length} valid icons to tile.`);

  // 4. Chunking
  const chunkSize = CONFIG.GRID_SIZE * CONFIG.GRID_SIZE; // 100
  const chunks = [];
  for (let i = 0; i < validEntries.length; i += chunkSize) {
    chunks.push(validEntries.slice(i, i + chunkSize));
  }

  console.log(`🧩 Creating ${chunks.length} tiles...`);

  // Find the last existing tile to force its regeneration
  let lastExistingTileIndex = 0;
  try {
    const files = await fs.readdir(CONFIG.TILES_DIR);
    const tileFiles = files.filter((f) => f.startsWith('tile_') && f.endsWith('.avif'));
    const indices = tileFiles
      .map((f) => {
        const match = f.match(/tile_(\d+)\.avif/);
        return match ? parseInt(match[1]) : null;
      })
      .filter((n) => n !== null && !isNaN(n));
    if (indices.length > 0) {
      lastExistingTileIndex = Math.max(...indices);
    }
  } catch (e) {
    // Directory might not exist yet
  }

  if (lastExistingTileIndex > 0) {
    console.log(
      `🔍 Last existing tile index found: ${lastExistingTileIndex}. It will be forced to regenerate.`,
    );
  }

  const cellSize = CONFIG.ICON_SIZE + CONFIG.BORDER_SIZE * 2; // 32 + 2 + 2 = 36
  const imageSize = cellSize * CONFIG.GRID_SIZE; // 36 * 10 = 360

  // Generate OG Image
  await generateOgImage(validEntries, cellSize, iconMtimes);

  let eagerImagesHtml = '';
  let lazyImagesHtml = '';

  // 5. Process Chunks
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const tileIndex = i + 1;
    const tileFilename = `tile_${tileIndex}.avif`;
    await generateOneTile(chunk, tileIndex, lastExistingTileIndex, cellSize, imageSize, iconMtimes);

    // Append to Accumulators
    const mapName = `map_${tileIndex}`;

    // Add Image to Image Accumulator
    const isEager = tileIndex <= CONFIG.EAGER_LOAD_TILES;
    const loadingAttr = isEager ? '' : ' loading="lazy"';
    const fetchPriorityAttr =
      tileIndex <= CONFIG.HIGH_PRIORITY_TILES ? ' fetchpriority="high"' : '';
    const imgTag = `<img src="${tileFilename}" usemap="#${mapName}" width="${imageSize}" height="${imageSize}"${loadingAttr}${fetchPriorityAttr} onload="loadMap(this, ${tileIndex})">\n`;

    if (isEager) {
      eagerImagesHtml += imgTag;
      // Do not inline map for eager tiles anymore, JS will handle it
    } else {
      lazyImagesHtml += imgTag;
    }
  }

  if (CONFIG.EMULATE_MORE_TILES && validEntries.length > 0) {
    // Generate emulated tile (the pattern used for all emulated tiles)
    const emulateTileIndex = 'emulated';
    const firstEntry = validEntries[0];
    const chunk = Array(chunkSize)
      .fill(null)
      .map(() => ({ ...firstEntry }));
    await generateOneTile(
      chunk,
      emulateTileIndex,
      lastExistingTileIndex,
      cellSize,
      imageSize,
      iconMtimes,
    );

    const totalEmulatedTiles = Math.max(
      0,
      Math.ceil(CONFIG.EMULATE_MORE_TILES_TOTAL_ICONS / CONFIG.GRID_SIZE ** 2 - chunks.length),
    );

    console.log(`\n🧩 Creating ${totalEmulatedTiles} emulated tiles...`);

    for (let i = 0; i < totalEmulatedTiles; i++) {
      const tileIndex = chunks.length + i + 1;
      const imgTag = `<img src="tile_${emulateTileIndex}.avif" usemap="#map_${tileIndex}" width="${imageSize}" height="${imageSize}" loading="lazy" onload="loadMap(this, ${tileIndex}, '${emulateTileIndex}')">\n`;
      lazyImagesHtml += imgTag;
    }
  }

  // Combine content: Eager Images -> Lazy Images (maps are generated by JS)
  const allImagesHtml = eagerImagesHtml + lazyImagesHtml;

  // 6. Generate Single Index HTML
  const finalHtmlContent = `<!DOCTYPE html>
<html>
  <head>
    <title>Favorite Icons of Internet</title>
    <meta property="og:title" content="Favorite Icons of Internet" />
    <meta property="og:url" content="https://favoriteiconsofinternet.com" />
    <meta property="og:description" content="Favorite icons map of internet" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="https://${CONFIG.HOSTNAME}/og_image.webp" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <base target="_blank" />
    <meta name="color-scheme" content="light dark">
    <style>
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 0;
        background-color: Field;
      }
      .tiles-wrapper {
          font-size: 0;
          line-height: 0;
          display: inline-block;
          width: round(up, 100vw, ${imageSize}px);
      }
      img { border: 0; display: inline-block; margin: 0; padding: 0; vertical-align: top; }
    </style>
    <script>
      function loadMap(img, tileIndex, mapIndexOverride) {
        if (img.dataset.mapLoaded) return;
        img.dataset.mapLoaded = "true";

        const CONFIG = {
          GRID_SIZE: ${CONFIG.GRID_SIZE},
          ICON_SIZE: ${CONFIG.ICON_SIZE},
          BORDER_SIZE: ${CONFIG.BORDER_SIZE}
        };

        fetch(\`tile_\${mapIndexOverride ? mapIndexOverride : tileIndex}.json\`)
          .then(res => res.json())
          .then(domains => {
            const mapName = \`map_\${tileIndex}\`;
            const map = document.createElement('map');
            map.name = mapName;

            const cellSize = CONFIG.ICON_SIZE + CONFIG.BORDER_SIZE * 2;

            domains.forEach((domain, index) => {
              const col = index % CONFIG.GRID_SIZE;
              const row = Math.floor(index / CONFIG.GRID_SIZE);
              const left = col * cellSize + CONFIG.BORDER_SIZE;
              const top = row * cellSize + CONFIG.BORDER_SIZE;

              const area = document.createElement('area');
              area.shape = 'rect';
              area.coords = \`\${left},\${top},\${left + CONFIG.ICON_SIZE},\${top + CONFIG.ICON_SIZE}\`;
              area.href = 'https://' + domain;
              area.title = domain;
              map.appendChild(area);
            });

            img.after(map);
          })
          .catch(err => {
            console.error('Failed to load map for tile ' + tileIndex, err);
            delete img.dataset.mapLoaded;
          });
      }
    </script>
</head>
<body>
    <div class="tiles-wrapper">
      ${allImagesHtml}
    </div>
</body>
</html>`;

  const indexHtmlPath = path.join(CONFIG.TILES_DIR, 'index.html');
  await fs.writeFile(indexHtmlPath, finalHtmlContent);
  console.log(`\n✅ Saved Combined Index HTML: ${indexHtmlPath}`);

  // Generate Cloudflare _headers file
  let headersContent = '/\n';
  for (let i = 1; i <= Math.min(chunks.length, CONFIG.HIGH_PRIORITY_TILES); i++) {
    headersContent += `  Link: </tile_${i}.avif>; rel=preload; as=image; fetchpriority=high\n`;
  }
  const headersPath = path.join(CONFIG.TILES_DIR, '_headers');
  await fs.writeFile(headersPath, headersContent);
  console.log(`✅ Saved Cloudflare Headers: ${headersPath}`);

  // 7. Update Metadata
  // We need to merge these updates back into the full list.
  // Since we filtered `entries` to get `validEntries` and modified objects inside `validEntries`,
  // and `validEntries` holds references to objects in `entries` (if filter creates a shallow copy of the array but references same objects),
  // then `entries` might be updated?
  // Array.prototype.filter creates a NEW array with references to the SAME elements.
  // So modifying `entry.tile` in the loop DOES modify the object in the original `entries` array.

  await fs.writeFile(CONFIG.OUTPUT_FILE, JSON.stringify(entries, null, 2));
  console.log(`
💾 Saved updated metadata to ${CONFIG.OUTPUT_FILE}`);
}

generateTiles();
