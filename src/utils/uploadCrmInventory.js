import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

/**
 * Parses a CRM inventory CSV/XLSX file and uploads it to the crm_inventory table.
 * Expected columns: "Creation Time", "SN", "PayGo Number", "SCR"
 *
 * @param {File} file - The uploaded file
 * @param {function} onProgress - Callback with { phase, current, total, message }
 * @returns {Promise<{ batchId: string, totalRecords: number }>}
 */
export async function uploadCrmInventory(file, onProgress = () => {}) {
  // 1. Parse the file
  onProgress({ phase: 'parsing', current: 0, total: 0, message: 'Reading file...' });

  const data = await readFileAsArrayBuffer(file);
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (rows.length === 0) {
    throw new Error('The uploaded file contains no data rows.');
  }

  // 2. Map columns — handle different possible header formats
  const mappedRows = rows.map((row) => {
    // Try multiple possible column names
    const sn = row['SN'] || row['Serial Number'] || row['serial_number'] || row['S/N'] || '';
    const paygo = row['PayGo Number'] || row['Paygo Number'] || row['PAYGO'] || row['paygo_number'] || row['Paygo'] || '';
    const scr = row['SCR'] || row['scr'] || row['Agent'] || row['Rep'] || '';
    const creationTime = row['Creation Time'] || row['creation_time'] || row['Date'] || row['Timestamp'] || '';

    return {
      serial_number: String(sn).trim(),
      paygo_number: String(paygo).trim() || null,
      scr_name: String(scr).trim() || null,
      creation_time: parseCreationTime(creationTime),
    };
  }).filter((r) => r.serial_number); // Remove rows with empty serial numbers

  if (mappedRows.length === 0) {
    throw new Error(
      'No valid rows found. Make sure the file has a column named "SN" or "Serial Number".'
    );
  }

  // 3. Generate a batch ID and clear previous batches
  onProgress({ phase: 'clearing', current: 0, total: mappedRows.length, message: 'Clearing previous upload...' });

  const batchId = crypto.randomUUID();

  // Delete all previous records (we only keep the latest upload)
  const { error: deleteError } = await supabase.from('crm_inventory').delete().neq('batch_id', 'impossible-id');
  if (deleteError) {
    console.error('Failed to clear previous CRM data:', deleteError);
    // Continue anyway — insert will still work
  }

  // 4. Insert in chunks of 500
  const CHUNK_SIZE = 500;
  const totalChunks = Math.ceil(mappedRows.length / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const chunk = mappedRows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).map((row) => ({
      ...row,
      batch_id: batchId,
    }));

    const { error: insertError } = await supabase.from('crm_inventory').insert(chunk);

    if (insertError) {
      throw new Error(`Upload failed at chunk ${i + 1}/${totalChunks}: ${insertError.message}`);
    }

    onProgress({
      phase: 'uploading',
      current: Math.min((i + 1) * CHUNK_SIZE, mappedRows.length),
      total: mappedRows.length,
      message: `Uploading... ${Math.min((i + 1) * CHUNK_SIZE, mappedRows.length).toLocaleString()} / ${mappedRows.length.toLocaleString()}`,
    });
  }

  return { batchId, totalRecords: mappedRows.length };
}

/**
 * Gets info about the latest CRM inventory upload.
 * @returns {Promise<{ count: number, uploadedAt: string | null }>}
 */
export async function getCrmInventoryInfo() {
  const { count, error } = await supabase
    .from('crm_inventory')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Failed to get CRM inventory info:', error);
    return { count: 0, uploadedAt: null };
  }

  if (count === 0) return { count: 0, uploadedAt: null };

  // Get the most recent upload timestamp
  const { data: latest } = await supabase
    .from('crm_inventory')
    .select('uploaded_at')
    .order('uploaded_at', { ascending: false })
    .limit(1);

  return {
    count: count || 0,
    uploadedAt: latest?.[0]?.uploaded_at || null,
  };
}

// --- Helpers ---

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

function parseCreationTime(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;

  // Try parsing as ISO or common date formats
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // Excel serial date number
  if (!isNaN(Number(str))) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + Number(str) * 86400000);
    if (!isNaN(date.getTime())) return date.toISOString();
  }

  return null;
}
