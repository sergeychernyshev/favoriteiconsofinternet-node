import { URL } from 'url';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

/**
 * Extracts the domain from a URL, removing the 'www.' prefix if present.
 * @param {string} url - The URL to extract the domain from.
 * @returns {string} The domain name.
 */
export function getDomain(url) {
  return new URL(url).hostname.replace(/^www\./, '');
}

/**
 * Generates the relative nested path for the icon based on a hash of the filename.
 * Structure: xx/yy/filename.png
 * @param {string} filename - The filename of the icon (e.g., "example.com.png").
 * @returns {string} The relative path (e.g., "a1/b2/example.com.png").
 */
export function getRelativePathFromFilename(filename) {
  const hash = crypto.createHash('md5').update(filename).digest('hex');
  const dir1 = hash.substring(0, 2);
  const dir2 = hash.substring(2, 4);
  return path.join(dir1, dir2, filename);
}

/**
 * Generates the relative nested path for the icon based on a hash of the filename.
 * Structure: xx/yy/filename.png
 * @param {string} url - The URL of the page.
 * @returns {string} The relative path (e.g., "a1/b2/example.com.png").
 */
export function getIconRelativePath(url) {
  const domain = getDomain(url);
  const filename = `${domain}.png`;
  return getRelativePathFromFilename(filename);
}

/**
 * Recursively loads modification times for all .png files in the icons directory.
 * @param {string} iconsDir - The path to the icons directory.
 * @returns {Promise<Map<string, number>>} A map of relative paths to mtimeMs.
 */
export async function loadIconMtimes(iconsDir) {
  console.log(`📂 Loading icon stats from ${iconsDir}...`);
  const mtimes = new Map();

  async function walk(dir, relativeBase = '') {
    const files = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of files) {
      const fullPath = path.join(dir, dirent.name);
      const relativePath = path.join(relativeBase, dirent.name);

      if (dirent.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (dirent.isFile() && dirent.name.endsWith('.png')) {
        try {
          const stats = await fs.stat(fullPath);
          mtimes.set(relativePath, stats.mtimeMs);
        } catch (e) {
          // Skip if stat fails
        }
      }
    }
  }

  try {
    await walk(iconsDir);
  } catch (e) {
    console.error(`❌ Failed to read icons directory: ${e.message}`);
  }
  console.log(`✅ Loaded stats for ${mtimes.size} icons.`);
  return mtimes;
}
