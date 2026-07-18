import * as XLSX from 'xlsx';

/**
 * Parses the SCR Names Excel file and returns a map of branch → SCR names.
 *
 * Expected columns: dotName (branch), name (SCR name)
 *
 * @param {File} file - The SCR registry Excel file
 * @returns {Promise<Map<string, string[]>>} Map of lowercase branch name → array of SCR names
 */
export async function parseSCRRegistry(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < 2) {
    throw new Error('SCR Registry file appears to be empty or has no data rows.');
  }

  // Validate headers
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const dotNameIdx = headers.findIndex((h) => h === 'dotname');
  const nameIdx = headers.findIndex((h) => h === 'name');

  if (dotNameIdx === -1 || nameIdx === -1) {
    throw new Error(
      `SCR Registry file is missing required columns. Expected "dotName" and "name", ` +
      `but found: ${rows[0].join(', ')}`
    );
  }

  // Build the branch → SCR names map
  const branchMap = new Map();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[dotNameIdx] || !row[nameIdx]) continue;

    const branch = String(row[dotNameIdx]).trim();
    const name = String(row[nameIdx]).trim();

    if (!branch || !name) continue;

    const key = branch.toLowerCase();
    if (!branchMap.has(key)) {
      branchMap.set(key, { originalName: branch, scrNames: [] });
    }
    branchMap.get(key).scrNames.push(name);
  }

  return branchMap;
}

/**
 * Get the list of unique branch names from the parsed SCR registry.
 * @param {Map<string, {originalName: string, scrNames: string[]}>} branchMap
 * @returns {string[]} Array of original branch names, sorted alphabetically
 */
export function getBranchNames(branchMap) {
  const names = [];
  for (const { originalName } of branchMap.values()) {
    if (!names.includes(originalName)) {
      names.push(originalName);
    }
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Get SCR names for a specific branch (case-insensitive lookup).
 * @param {Map<string, {originalName: string, scrNames: string[]}>} branchMap
 * @param {string} branchName
 * @returns {string[]} Array of SCR names for that branch
 */
export function getSCRsForBranch(branchMap, branchName) {
  const entry = branchMap.get(branchName.toLowerCase().trim());
  return entry ? entry.scrNames : [];
}
