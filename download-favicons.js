import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import sharp from 'sharp';
import { sharpsFromIco } from 'sharp-ico';

// --- Configuration ---
const CONFIG = {
  INPUT_FILE: 'favicons-processed.json',
  OUTPUT_FILE: 'favicons-downloaded.json',
  ICONS_DIR: 'icons',
  MAX_REQUESTS: 5000,
  USER_AGENT: 'Mozilla/5.0 (compatible; FaviconDownloader/1.0)',
  TIMEOUT_MS: 10000,
  TARGET_SIZE: 32,
};

async function ensureDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function loadJSON(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function downloadFavicons() {
  console.log('🚀 Starting favicon download process...');

  // 1. Setup
  await ensureDir(CONFIG.ICONS_DIR);

  const inputEntries = await loadJSON(CONFIG.INPUT_FILE);
  if (!inputEntries) {
    console.error(`❌ Input file ${CONFIG.INPUT_FILE} not found.`);
    process.exit(1);
  }

  // Load previous state if available to get ETags/Last-Modified
  const previousState = (await loadJSON(CONFIG.OUTPUT_FILE)) || [];
  const stateMap = new Map(previousState.map((e) => [e.url, e]));

  // 2. Identify targets
  // We process the first N entries from the input list (which is ranked).
  const targets = inputEntries.slice(0, CONFIG.MAX_REQUESTS);
  console.log(`📊 Processing top ${targets.length} entries.`);

  const results = [];

  for (const entry of targets) {
    const domain = new URL(entry.url).hostname.replace(/^www\./, '');
    const faviconUrl = entry.favicon;
    const prevEntry = stateMap.get(entry.url);

    console.log(`
Processing [Rank ${entry.rank}] ${domain}...`);

    // Prepare Headers
    const headers = {
      'User-Agent': CONFIG.USER_AGENT,
    };

    if (prevEntry) {
      if (prevEntry.etag) headers['If-None-Match'] = prevEntry.etag;
      if (prevEntry.lastModified) headers['If-Modified-Since'] = prevEntry.lastModified;
    }

    const startTime = Date.now();
    let status = 'skipped';
    let error = null;
    let metadata = { ...entry, ...prevEntry }; // Start with existing data

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

      const response = await fetch(faviconUrl, {
        method: 'GET',
        headers: headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      metadata.lastCheckTime = new Date().toISOString();
      metadata.httpStatus = response.status;

      if (response.status === 304) {
        console.log(`  Make: 304 Not Modified. (No change)`);
        status = 'not_modified';
      } else if (response.status === 200) {
        console.log(`  Make: 200 OK. Downloading...`);

        const buffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(buffer);

        // Resize and Save
        const filename = `${domain}.png`;
        const outputPath = path.join(CONFIG.ICONS_DIR, filename);

        // Determine if it's an ICO
        const isIco =
          (metadata.contentType && metadata.contentType.includes('ico')) ||
          path.extname(new URL(faviconUrl).pathname).toLowerCase() === '.ico';

        let sharpInstance;

        if (isIco) {
          try {
            // sharpsFromIco returns an array of sharp instances (one for each size in the ICO)
            const icons = await sharpsFromIco(imageBuffer);

            if (icons.length > 0) {
              // Find the best icon: preferably >= 32x32.
              // We need to inspect metadata of each to know size.
              // Since we can't await inside sort effectively without resolving first,
              // let's just get metadata for all.
              const iconsWithMeta = await Promise.all(
                icons.map(async (icon) => {
                  const meta = await icon.metadata();
                  return { icon, width: meta.width, height: meta.height };
                }),
              );

              // Sort by width descending to get the largest one
              iconsWithMeta.sort((a, b) => b.width - a.width);

              // Or find closest to 32? Let's just take the largest and resize down for best quality.
              sharpInstance = iconsWithMeta[0].icon;
            }
          } catch (icoError) {
            console.warn(
              `  Warning: Failed to parse ICO, falling back to standard sharp: ${icoError.message}`,
            );
          }
        }

        // Fallback to standard sharp if not ICO or ICO parsing failed
        if (!sharpInstance) {
          sharpInstance = sharp(imageBuffer);
        }

        await sharpInstance.resize(CONFIG.TARGET_SIZE, CONFIG.TARGET_SIZE).png().toFile(outputPath);

        console.log(`  Saved to ${outputPath}`);

        // Update Metadata
        metadata.downloadTime = new Date().toISOString();
        metadata.etag = response.headers.get('etag');
        metadata.lastModified = response.headers.get('last-modified');
        metadata.localPath = outputPath;
        metadata.contentLength = response.headers.get('content-length');
        metadata.contentType = response.headers.get('content-type');
        status = 'downloaded';
      } else {
        console.warn(`  Warning: HTTP ${response.status} - ${response.statusText}`);
        status = 'failed';
        error = `HTTP ${response.status}`;
      }
    } catch (e) {
      console.error(`  Error: ${e.message}`);
      status = 'error';
      error = e.message;
    }

    // Merge updates into result object
    results.push({
      ...metadata,
      status,
      error,
    });
  }

  // 3. Save Results
  // We merge the new results into the previous state map (updating old entries, adding new ones)
  // But wait, if we only processed 100, we shouldn't lose the other 100k+ entries if we overwrite the file.
  // However, the prompt says "takes processed.json as input... save metadata".
  // If we want to maintain a full state file, we should probably start with the full input list
  // and overlay our current results.

  // Strategy:
  // Take ALL input entries.
  // For the ones we processed, use the NEW result.
  // For the ones we didn't, use the PREVIOUS state if it exists, or just the input entry.

  const finalOutput = inputEntries.map((entry) => {
    // Is this entry in our current batch results?
    const newResult = results.find((r) => r.url === entry.url);
    if (newResult) return newResult;

    // If not, do we have old state?
    const oldState = stateMap.get(entry.url);
    if (oldState) return oldState;

    // Otherwise just the original entry
    return entry;
  });

  await fs.writeFile(CONFIG.OUTPUT_FILE, JSON.stringify(finalOutput, null, 2));
  console.log(`
💾 Saved ${finalOutput.length} entries (processed ${results.length}) to ${CONFIG.OUTPUT_FILE}`);
}

downloadFavicons();
