import { BigQuery } from "@google-cloud/bigquery";
import fs from "fs/promises";
import path from "path";

// --- Configuration ---
// The full ID of the table you want to query.
const tableId = "usinggeminiforcoding.favicons.favicons_1M";

// The path where the output JSON file will be saved.
const outputFilePath = path.join(process.cwd(), "favicons.json");

// The Google Cloud project ID that owns the BigQuery table.
const projectId = "usinggeminiforcoding";
// ---------------------

/**
 * Downloads data from a BigQuery table and saves it as a JSON file.
 */
async function downloadBigQueryTable() {
  console.log("🚀 Starting BigQuery data download...");

  try {
    // 1. Initialize BigQuery client.
    // The client automatically uses Application Default Credentials (ADC)
    // for authentication, which you set up with `gcloud auth application-default login`.
    const bigquery = new BigQuery({ projectId });
    console.log(
      `✅ Authenticated and initialized BigQuery client for project: ${projectId}`
    );

    // 2. Construct the SQL query.
    // This query selects all columns from the specified table.
    // For very large tables, consider using `LIMIT` or selecting specific columns.
    const query = `SELECT * FROM \`${tableId}\``;
    console.log("Executing query...");
    console.log(`   ${query}`);

    const options = {
      query: query,
      // Location must match that of the dataset.
      // 'US' is the multi-region location for this public dataset.
      location: "US",
    };

    // 3. Run the query.
    const [rows] = await bigquery.query(options);
    console.log(`📊 Successfully fetched ${rows.length} rows from BigQuery.`);

    // 4. Save the data to a JSON file.
    // We use JSON.stringify with a replacer (null) and space (2) for pretty-printing.
    const jsonData = JSON.stringify(rows, null, 2);
    await fs.writeFile(outputFilePath, jsonData);

    console.log(`💾 Data successfully saved to ${outputFilePath}`);
  } catch (error) {
    console.error("❌ An error occurred:", error.message);
    if (
      error.code === 7 ||
      (error.message && error.message.includes("accessDenied"))
    ) {
      console.error(
        "\nHint: This looks like a permission error. Please ensure:"
      );
      console.error(
        "1. You have run `gcloud auth application-default login` successfully."
      );
      console.error(
        `2. The authenticated user has the 'BigQuery Data Viewer' and 'BigQuery Job User' roles on the project '${projectId}'.`
      );
      console.error(
        "3. The BigQuery API is enabled for your project: https://console.cloud.google.com/apis/library/bigquery.googleapis.com"
      );
    }
    process.exit(1);
  }
}

downloadBigQueryTable();
