import fs from 'fs/promises';
import path from 'path';
import { getIconRelativePath } from './utils.js';

const CONFIG = {
  INPUT_FILE: 'favicons-downloaded.json',
  OUTPUT_FILE: 'stats.html',
  ICONS_DIR: 'icons',
};

async function ensureDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function generateStats() {
  console.log('📊 Generating statistics...');

  try {
    await ensureDir(path.dirname(CONFIG.OUTPUT_FILE));

    const rawData = await fs.readFile(CONFIG.INPUT_FILE, 'utf-8');
    const data = JSON.parse(rawData);

    const stats = {
      total: data.length,
      byStatus: {},
      byHttpStatus: {},
      byError: {},
      byFileSize: {
        '< 1KB': 0,
        '1KB - 5KB': 0,
        '5KB - 10KB': 0,
        '10KB - 50KB': 0,
        '> 50KB': 0,
      },
      totalSize: 0,
      downloadedCount: 0,
    };

    console.log(`Processing ${data.length} entries...`);
    let processedCount = 0;

    // Use a loop with await for file stats to avoid overwhelming the file system
    // or use Promise.all with concurrency limit if needed, but linear is fine for stats gen.
    for (const entry of data) {
      processedCount++;
      if (processedCount % 1000 === 0) process.stdout.write(`Processed ${processedCount}...\r`);

      // Status
      const status = entry.status || 'unknown';
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

      // HTTP Status
      if (entry.httpStatus) {
        stats.byHttpStatus[entry.httpStatus] = (stats.byHttpStatus[entry.httpStatus] || 0) + 1;
      }

      // Errors
      if (entry.error) {
        const errorMsg = entry.error;
        stats.byError[errorMsg] = (stats.byError[errorMsg] || 0) + 1;
      }

      // File Size from Disk
      if (status === 'downloaded' || status === 'not_modified' || status === 'skipped_recent') {
        try {
          const relativePath = getIconRelativePath(entry.url);
          const filePath = path.join(CONFIG.ICONS_DIR, relativePath);
          const fileStats = await fs.stat(filePath);
          const size = fileStats.size;

          stats.totalSize += size;
          stats.downloadedCount++;

          if (size < 1024) stats.byFileSize['< 1KB']++;
          else if (size < 5 * 1024) stats.byFileSize['1KB - 5KB']++;
          else if (size < 10 * 1024) stats.byFileSize['5KB - 10KB']++;
          else if (size < 50 * 1024) stats.byFileSize['10KB - 50KB']++;
          else stats.byFileSize['> 50KB']++;
        } catch (e) {
          // File might be missing or error reading stat
        }
      }
    }
    console.log('\n✅ Data processing complete.');

    const avgSize =
      stats.downloadedCount > 0 ? Math.round(stats.totalSize / stats.downloadedCount) : 0;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Favicon Download Statistics</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background: #f4f4f9; color: #333; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { margin-bottom: 20px; }
        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
        .card h3 { margin: 0 0 10px; color: #666; font-size: 14px; text-transform: uppercase; }
        .card .value { font-size: 32px; font-weight: bold; color: #333; }
        .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
        .chart-container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); height: 400px; }
        .full-width { grid-column: 1 / -1; height: 500px; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; }
        tr:last-child td { border-bottom: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Favicon Download Statistics</h1>
        
        <div class="cards">
            <div class="card">
                <h3>Total Processed</h3>
                <div class="value">${stats.total.toLocaleString()}</div>
            </div>
            <div class="card">
                <h3>Downloaded</h3>
                <div class="value">${(stats.byStatus['downloaded'] || 0).toLocaleString()}</div>
            </div>
             <div class="card">
                <h3>Avg File Size</h3>
                <div class="value">${(avgSize / 1024).toFixed(2)} KB</div>
            </div>
             <div class="card">
                <h3>Failed/Error</h3>
                <div class="value">${((stats.byStatus['failed'] || 0) + (stats.byStatus['error'] || 0)).toLocaleString()}</div>
            </div>
        </div>

        <div class="charts">
            <div class="chart-container">
                <canvas id="statusChart"></canvas>
            </div>
            <div class="chart-container">
                <canvas id="fileSizeChart"></canvas>
            </div>
            <div class="chart-container full-width">
                <canvas id="httpStatusChart"></canvas>
            </div>
            <div class="chart-container full-width">
                <h3>Top 20 Errors</h3>
                <canvas id="errorChart"></canvas>
            </div>
        </div>

        <h3>Error Details (Top 50)</h3>
        <table>
            <thead>
                <tr>
                    <th>Error Message</th>
                    <th>Count</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(stats.byError)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 50)
                  .map(([error, count]) => `<tr><td>${error}</td><td>${count}</td></tr>`)
                  .join('')}
            </tbody>
        </table>
    </div>

    <script>
        // Status Chart
        const statusCtx = document.getElementById('statusChart').getContext('2d');
        new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: ${JSON.stringify(Object.keys(stats.byStatus))},
                datasets: [{
                    data: ${JSON.stringify(Object.values(stats.byStatus))},
                    backgroundColor: [
                        '#4caf50', '#2196f3', '#ff9800', '#f44336', '#9c27b0', '#795548', '#607d8b'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    title: { display: true, text: 'Status Distribution' }
                }
            }
        });

        // File Size Chart
        const fileSizeCtx = document.getElementById('fileSizeChart').getContext('2d');
        new Chart(fileSizeCtx, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(Object.keys(stats.byFileSize))},
                datasets: [{
                    label: 'Count',
                    data: ${JSON.stringify(Object.values(stats.byFileSize))},
                    backgroundColor: '#009688'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'File Size Distribution' }
                }
            }
        });

        // HTTP Status Chart
        const httpStatusCtx = document.getElementById('httpStatusChart').getContext('2d');
        const httpData = ${JSON.stringify(
          Object.entries(stats.byHttpStatus).sort((a, b) => parseInt(a[0]) - parseInt(b[0])),
        )};
        new Chart(httpStatusCtx, {
            type: 'bar',
            data: {
                labels: httpData.map(d => d[0]),
                datasets: [{
                    label: 'Count',
                    data: httpData.map(d => d[1]),
                    backgroundColor: '#3f51b5'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'HTTP Status Codes' }
                }
            }
        });

        // Error Chart
        const errorCtx = document.getElementById('errorChart').getContext('2d');
        const errorData = ${JSON.stringify(
          Object.entries(stats.byError)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20),
        )};
        new Chart(errorCtx, {
            type: 'bar',
            data: {
                labels: errorData.map(d => d[0].substring(0, 80) + (d[0].length > 80 ? '...' : '')),
                datasets: [{
                    label: 'Count',
                    data: errorData.map(d => d[1]),
                    backgroundColor: '#f44336'
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                }
            }
        });
    </script>
</body>
</html>
    `;

    await fs.writeFile(CONFIG.OUTPUT_FILE, html);
    console.log(`✅ Stats saved to ${CONFIG.OUTPUT_FILE}`);
  } catch (err) {
    console.error('❌ Error generating stats:', err.message);
  }
}

generateStats();
