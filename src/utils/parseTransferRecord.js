import * as XLSX from 'xlsx';

/**
 * Converts an Excel serial date number to a JavaScript Date object.
 * Excel epoch is Jan 1, 1900 (with the 1900 leap year bug).
 * @param {number} serial - Excel serial date number
 * @returns {Date}
 */
function excelSerialToDate(serial) {
  const epoch = new Date(1899, 11, 30); // Dec 30, 1899
  return new Date(epoch.getTime() + serial * 86400000);
}

/**
 * Normalizes a name for comparison: lowercase, trim, collapse multiple spaces.
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Parses the Transfer Record Excel file and calculates stock movements for a branch.
 *
 * Expected columns: AllotTime, SendOut, Receive, AllotQuantity
 *
 * Transfer categorization:
 * - "received": Branch SCR is in Receive AND sender is NOT a branch SCR → stock IN
 * - "sentOut": Branch SCR is in SendOut AND receiver is NOT a branch SCR → stock OUT
 * - "internal": Both sender and receiver are branch SCRs → net zero
 *
 * @param {File} file - The Transfer Record Excel file
 * @param {string[]} branchSCRNames - Array of SCR names for the selected branch
 * @param {Date} startDate - Start of date range (inclusive)
 * @param {Date} endDate - End of date range (inclusive, end of day)
 * @returns {Promise<Object>} Parsed transfer data with totals and per-SCR breakdown
 */
export async function parseTransferRecord(file, branchSCRNames, startDate, endDate) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < 2) {
    throw new Error('Transfer Record file appears to be empty or has no data rows.');
  }

  // Validate headers
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const timeIdx = headers.findIndex((h) => h === 'allottime');
  const sendIdx = headers.findIndex((h) => h === 'sendout');
  const recvIdx = headers.findIndex((h) => h === 'receive');
  const qtyIdx = headers.findIndex((h) => h === 'allotquantity');

  if (timeIdx === -1 || sendIdx === -1 || recvIdx === -1 || qtyIdx === -1) {
    throw new Error(
      `Transfer Record is missing required columns. Expected "AllotTime", "SendOut", "Receive", "AllotQuantity". ` +
      `Found: ${rows[0].join(', ')}`
    );
  }

  // Build a Set of normalized branch SCR names for fast lookup
  const branchSCRSet = new Set(branchSCRNames.map(normalizeName));

  // Set up date range boundaries (inclusive, full day)
  const rangeStart = new Date(startDate);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(endDate);
  rangeEnd.setHours(23, 59, 59, 999);

  // Per-SCR breakdown
  const perSCR = {};
  for (const name of branchSCRNames) {
    perSCR[name] = {
      historicalReceived: 0,
      historicalSentOut: 0,
      periodReceived: 0,
      periodSentOut: 0,
      periodInternal: 0,
    };
  }

  let historicalReceived = 0;
  let historicalSentOut = 0;
  let periodReceived = 0;
  let periodSentOut = 0;
  let periodInternal = 0;
  const details = []; // Filtered transfer rows for export (period only)

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;

    // Parse date (Excel serial number)
    const rawTime = row[timeIdx];
    let transferDate;
    if (typeof rawTime === 'number') {
      transferDate = excelSerialToDate(rawTime);
    } else if (typeof rawTime === 'string') {
      transferDate = new Date(rawTime);
    } else {
      continue; // Skip rows with invalid dates
    }

    if (isNaN(transferDate.getTime())) continue;

    // Filter out rows after the end date
    if (transferDate > rangeEnd) continue;

    const sender = String(row[sendIdx] || '').trim();
    const receiver = String(row[recvIdx] || '').trim();
    const quantity = parseInt(row[qtyIdx]) || 0;

    if (quantity === 0) continue;

    const senderNorm = normalizeName(sender);
    const receiverNorm = normalizeName(receiver);
    const senderIsBranch = branchSCRSet.has(senderNorm);
    const receiverIsBranch = branchSCRSet.has(receiverNorm);

    // Skip if neither party is a branch SCR
    if (!senderIsBranch && !receiverIsBranch) continue;

    const isHistorical = transferDate < rangeStart;

    if (senderIsBranch && receiverIsBranch) {
      // Internal transfer — net zero for branch balance
      if (!isHistorical) {
        periodInternal += quantity;
        const senderOriginal = findOriginalName(branchSCRNames, senderNorm);
        const receiverOriginal = findOriginalName(branchSCRNames, receiverNorm);
        if (senderOriginal && perSCR[senderOriginal]) perSCR[senderOriginal].periodInternal += quantity;
        if (receiverOriginal && perSCR[receiverOriginal]) perSCR[receiverOriginal].periodInternal += quantity;
      }
    } else if (receiverIsBranch && !senderIsBranch) {
      // Stock coming INTO the branch
      const receiverOriginal = findOriginalName(branchSCRNames, receiverNorm);
      if (isHistorical) {
        historicalReceived += quantity;
        if (receiverOriginal && perSCR[receiverOriginal]) perSCR[receiverOriginal].historicalReceived += quantity;
      } else {
        periodReceived += quantity;
        if (receiverOriginal && perSCR[receiverOriginal]) perSCR[receiverOriginal].periodReceived += quantity;
      }
    } else if (senderIsBranch && !receiverIsBranch) {
      // Stock going OUT of the branch
      const senderOriginal = findOriginalName(branchSCRNames, senderNorm);
      if (isHistorical) {
        historicalSentOut += quantity;
        if (senderOriginal && perSCR[senderOriginal]) perSCR[senderOriginal].historicalSentOut += quantity;
      } else {
        periodSentOut += quantity;
        if (senderOriginal && perSCR[senderOriginal]) perSCR[senderOriginal].periodSentOut += quantity;
      }
    }

    // Only add to export details if it occurred within the audited period
    if (!isHistorical) {
      details.push({
        date: transferDate.toISOString().slice(0, 19).replace('T', ' '),
        sender,
        receiver,
        quantity,
        category: (senderIsBranch && receiverIsBranch) ? 'internal'
          : (receiverIsBranch) ? 'received' : 'sentOut',
      });
    }
  }

  return {
    historical: {
      received: historicalReceived,
      sentOut: historicalSentOut,
    },
    period: {
      received: periodReceived,
      sentOut: periodSentOut,
      internal: periodInternal,
    },
    perSCR,
    details,
    totalRows: rows.length - 1,
    filteredRows: details.length,
  };
}

/**
 * Finds the original (un-normalized) name from the SCR list that matches a normalized name.
 * @param {string[]} scrNames - Original SCR names
 * @param {string} normalizedName - Normalized name to find
 * @returns {string|null}
 */
function findOriginalName(scrNames, normalizedName) {
  return scrNames.find((n) => normalizeName(n) === normalizedName) || null;
}
