import fs from 'fs/promises';
import path from 'path';
import { getRelativePathFromFilename } from './utils.js';

const ICONS_DIR = 'icons';

async function migrateIcons() {
  console.log('🚀 Starting icon migration...');

  try {
    const files = await fs.readdir(ICONS_DIR, { withFileTypes: true });
    let movedCount = 0;
    let errorCount = 0;

    for (const dirent of files) {
      // Process only files that are directly in the icons folder (flat structure)
      // and look like icon files (ending in .png)
      if (dirent.isFile() && dirent.name.endsWith('.png')) {
        const oldPath = path.join(ICONS_DIR, dirent.name);
        const relativeNewPath = getRelativePathFromFilename(dirent.name);
        const newPath = path.join(ICONS_DIR, relativeNewPath);

        // Skip if the file is already in the correct place (though readdir is non-recursive, so this shouldn't happen for files in subdirs unless logic is flawed)
        if (oldPath === newPath) continue;

        try {
          // Ensure target directory exists
          await fs.mkdir(path.dirname(newPath), { recursive: true });

          // Move the file
          await fs.rename(oldPath, newPath);
          // console.log(`✅ Moved ${dirent.name} -> ${relativeNewPath}`);
          movedCount++;
          if (movedCount % 1000 === 0) {
            process.stdout.write(`Moved ${movedCount} icons...\r`);
          }
        } catch (err) {
          console.error(`❌ Failed to move ${dirent.name}: ${err.message}`);
          errorCount++;
        }
      }
    }

    console.log(`\n✨ Migration complete.`);
    console.log(`📦 Moved: ${movedCount}`);
    if (errorCount > 0) {
      console.log(`⚠️  Errors: ${errorCount}`);
    }
  } catch (err) {
    console.error(`❌ Fatal error: ${err.message}`);
    process.exit(1);
  }
}

migrateIcons();
