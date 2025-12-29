import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// --- Configuration ---
const CONFIG = {
  INPUT_FILE: 'favicons-downloaded.json',
  OUTPUT_FILE: 'favicons-tiled.json',
  TILES_DIR: 'tiles',
  GRID_SIZE: 10,
  ICON_SIZE: 16,
  BORDER_SIZE: 1,
  BACKGROUND_COLOR: { r: 255, g: 255, b: 255, alpha: 1 },
  EAGER_LOAD_TILES: 32,
  TILES_PER_MAP_GROUP: 16,
};

async function ensureDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function generateTiles() {
  console.log('🚀 Starting tile generation process...');

  // 1. Setup
  await ensureDir(CONFIG.TILES_DIR);

  // 2. Load Data
  console.log(`📖 Reading ${CONFIG.INPUT_FILE}...`);
  const rawData = await fs.readFile(CONFIG.INPUT_FILE, 'utf-8');
  let entries = JSON.parse(rawData);

  // 3. Filter and Sort
  // We only want entries that are successfully downloaded/present locally
  // and we want them sorted by rank.
  const validEntries = entries
    .filter(
      (e) => (e.status === 'downloaded' || e.status === 'not_modified') && e.localPath && e.rank, // Ensure rank exists
    )
    .sort((a, b) => a.rank - b.rank);

  console.log(`📊 Found ${validEntries.length} valid icons to tile.`);

  // 4. Chunking
  const chunkSize = CONFIG.GRID_SIZE * CONFIG.GRID_SIZE; // 100
  const chunks = [];
  for (let i = 0; i < validEntries.length; i += chunkSize) {
    chunks.push(validEntries.slice(i, i + chunkSize));
  }

  console.log(`🧩 Creating ${chunks.length} tiles...`);

  const cellSize = CONFIG.ICON_SIZE + CONFIG.BORDER_SIZE * 2; // 32 + 2 + 2 = 36
  const imageSize = cellSize * CONFIG.GRID_SIZE; // 36 * 10 = 360

  let allImagesHtml = '';
  let mapsBuffer = '';

  // 5. Process Chunks
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const tileIndex = i + 1;
    const tileFilename = `tile_${tileIndex}.png`;
    const tilePath = path.join(CONFIG.TILES_DIR, tileFilename);

    console.log(`\n🎨 Generating Tile #${tileIndex} (${chunk.length} icons)...`);

    const composites = [];
    const htmlAreas = [];

    for (let j = 0; j < chunk.length; j++) {
      const entry = chunk[j];

      // Calculate position
      const col = j % CONFIG.GRID_SIZE;
      const row = Math.floor(j / CONFIG.GRID_SIZE);
      const left = col * cellSize + CONFIG.BORDER_SIZE;
      const top = row * cellSize + CONFIG.BORDER_SIZE;

      try {
        // Resize image to ensure it fits the target size
        const resizedImageBuffer = await sharp(entry.localPath)
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

      // Add to HTML map areas
      htmlAreas.push(
        `    <area shape="rect" coords="${left},${top},${left + CONFIG.ICON_SIZE},${top + CONFIG.ICON_SIZE}" href="${entry.url}" title="${entry.url}">`,
      );

      // Update entry with tile info
      entry.tile = {
        file: tileFilename,
        index: j,
        row: row,
        col: col,
      };
    }

    // Generate Image
    try {
      await sharp({
        create: {
          width: imageSize,
          height: imageSize,
          channels: 4,
          background: CONFIG.BACKGROUND_COLOR,
        },
      })
        .composite(composites)
        .png()
        .toFile(tilePath);
      console.log(`  ✅ Saved Image: ${tilePath}`);
    } catch (err) {
      console.error(`  ❌ Error generating image for tile ${tileIndex}: ${err.message}`);
    }

    // Append to Accumulators
    const mapName = `map_${tileIndex}`;

    // Add Image to Image Accumulator
    const loadingAttr = tileIndex > CONFIG.EAGER_LOAD_TILES ? ' loading="lazy"' : '';
    allImagesHtml += `<img src="${tileFilename}" usemap="#${mapName}" width="${imageSize}" height="${imageSize}"${loadingAttr}>\n`;

    // Add Map to Buffer
    mapsBuffer += `<map name="${mapName}">\n${htmlAreas.join('\n')}\n</map>\n`;

    // Flush maps every N tiles or at the end
    if (tileIndex % CONFIG.TILES_PER_MAP_GROUP === 0 || i === chunks.length - 1) {
      const startTile = Math.max(
        1,
        tileIndex - (tileIndex % CONFIG.TILES_PER_MAP_GROUP || CONFIG.TILES_PER_MAP_GROUP) + 1,
      );
      allImagesHtml += `<!-- Maps for Tiles ${startTile} - ${tileIndex} -->\n${mapsBuffer}`;
      mapsBuffer = ''; // Clear buffer
    }
  }

  // 6. Generate Single Index HTML
  const finalHtmlContent = `<!DOCTYPE html>
<html>
  <head>
    <title>Favorite Icons of Internet</title>
    <base target="_blank" />
    <style>        body { margin: 0; padding: 0; background: white; }
        .tiles-wrapper { 
            font-size: 0; 
            line-height: 0; 
            display: inline-block; 
            width: round(up, 100vw, ${imageSize}px);
        }
        img { border: 0; display: inline-block; margin: 0; padding: 0; vertical-align: top; }
    </style>
</head>
<body>
    <div class="tiles-wrapper">
${allImagesHtml}
    </div>
</body>
</html>`;

  const indexHtmlPath = path.join(CONFIG.TILES_DIR, 'index.html');
  await fs.writeFile(indexHtmlPath, finalHtmlContent);
  console.log(`✅ Saved Combined Index HTML: ${indexHtmlPath}`);

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
