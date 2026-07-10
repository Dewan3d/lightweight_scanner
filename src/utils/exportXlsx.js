import * as XLSX from 'xlsx';

/**
 * Exports scan data as an .xlsx Excel file and triggers a browser download.
 * @param {Array<{barcode: string, scanned_by: string, branch: string, created_at: string}>} scans
 * @param {string} filename - Name for the downloaded file (without extension)
 */
export function exportToXlsx(scans, filename = 'scan_export') {
  const worksheetData = scans.map((scan) => ({
    'Serial Number': scan.barcode,
    'Paygo Code': scan.paygo || '—',
    'Scanned By': scan.scanned_by_name || scan.scanned_by,
    'Branch': scan.branch_name || scan.branch_id,
    'Timestamp': new Date(scan.created_at).toLocaleString(),
  }));

  const worksheet = XLSX.utils.json_to_sheet(worksheetData);

  /* Auto-size columns */
  const colWidths = Object.keys(worksheetData[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...worksheetData.map((row) => String(row[key] || '').length)) + 2,
  }));
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Scans');

  // Generate Excel file buffer
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

  // Create Blob with explicit Excel MIME type (Safari requires this to handle the file correctly)
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  // Fallback for older IE/Edge if applicable
  if (window.navigator && window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, `${filename}.xlsx`);
    return;
  }

  // Trigger download with temporary anchor tag
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();

  // Delay revoking the ObjectURL so Safari/iOS has time to process the download
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 500);
}
