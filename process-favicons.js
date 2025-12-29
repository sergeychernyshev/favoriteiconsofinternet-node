import fs from "fs/promises";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import path from "path";
import { URL } from "url";

// --- Configuration ---
const inputFile = path.join(process.cwd(), "favicons.json");
const outputFile = path.join(process.cwd(), "favicons-processed.json");
const rankedListFile = path.join(process.cwd(), "domain-lists", "top10milliondomains.csv");
// ---------------------

/**
 * Reads the favicons.json file, converts relative favicon paths to absolute URLs,
 * deduplicates by domain, checks against a ranked domain list, assigns rank,
 * and saves the result to a new file.
 */
async function processAndDeduplicateFavicons() {
  console.log(`🚀 Reading and processing data from ${inputFile}...`);

  try {
    // 1. Read and parse the input JSON file.
    const rawData = await fs.readFile(inputFile, "utf-8");
    const entries = JSON.parse(rawData);
    console.log(`📊 Found ${entries.length} entries to process.`);

    // 2. Process each entry to resolve the favicon URL.
    const processedEntries = entries.map((entry) => {
      // Defensive check for required fields.
      if (!entry.favicon || !entry.url) {
        return {
          ...entry,
          date: entry.date?.value || null, // Flatten date
          error: "Missing url or favicon field",
        };
      }

      let absoluteFaviconUrl;
      try {
        // The URL constructor elegantly handles absolute, protocol-relative,
        // and root-relative paths by resolving them against the base `entry.url`.
        const resolvedUrl = new URL(entry.favicon, entry.url);
        absoluteFaviconUrl = resolvedUrl.href;
      } catch (e) {
        console.warn(
          `⚠️  Could not parse URL for entry: ${entry.url}. Error: ${e.message}`
        );
        return {
          ...entry,
          date: entry.date?.value,
          error: `Invalid URL: ${e.message}`,
        };
      }

      // 3. Return a new object with the updated fields.
      return {
        ...entry,
        date: entry.date.value, // Flatten the date object for simplicity.
        favicon: absoluteFaviconUrl, // Overwrite with the absolute URL.
      };
    });

    console.log("✅ URL processing complete.");

    // 4. Deduplicate entries by domain, keeping the first one found.
    console.log("🚀 Deduplicating entries by domain...");
    const seenDomains = new Set();
    const uniqueEntriesMap = new Map();

    for (const entry of processedEntries) {
      // We can only deduplicate if we have a valid, error-free URL.
      if (entry.error || !entry.url) {
        continue; // Skip entries with errors or no URL for the ranked list matching.
      }

      // The URL was valid for processing, so it should be valid here.
      const domain = new URL(entry.url).hostname;
      if (!seenDomains.has(domain)) {
        seenDomains.add(domain);
        uniqueEntriesMap.set(domain, entry);
      }
    }
    
    console.log(
      `✅ Deduplication complete. Found ${uniqueEntriesMap.size} unique domains.`
    );

    // 5. Stream the ranked list and filter/update entries.
    console.log(`🚀 Mapping ranks from ${rankedListFile}...`);
    
    const finalEntries = [];
    const fileStream = createReadStream(rankedListFile);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let processedLines = 0;
    for await (const line of rl) {
        processedLines++;
        // Parse line: "1","facebook.com","10.00"
        const parts = line.split(',');
        if (parts.length < 2) continue;

        // Strip quotes
        const rankStr = parts[0].replace(/"/g, '');
        const domain = parts[1].replace(/"/g, '');
        
        if (domain === 'Domain') continue; // Skip header

        if (uniqueEntriesMap.has(domain)) {
            const entry = uniqueEntriesMap.get(domain);
            entry.rank = parseInt(rankStr, 10);
            finalEntries.push(entry);
            uniqueEntriesMap.delete(domain); // Remove to avoid re-checking or just to track what's left
        }
    }

    console.log(`✅ Rank mapping complete. Kept ${finalEntries.length} entries.`);

    // 6. Sort by rank.
    finalEntries.sort((a, b) => a.rank - b.rank);

    // 7. Save the processed and deduplicated data to a new file.
    await fs.writeFile(outputFile, JSON.stringify(finalEntries, null, 2));
    console.log(`💾 Processed data successfully saved to ${outputFile}`);

  } catch (error) {
    console.error("❌ An error occurred during processing:", error.message);
    if (error.code === "ENOENT") {
      console.error(
        `\nHint: Make sure the input files exist. You may need to run 'npm start' first.`
      );
    }
    process.exit(1);
  }
}

processAndDeduplicateFavicons();
