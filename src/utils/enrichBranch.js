import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

/**
 * Runs the 3-phase enrichment process for a specific branch.
 *
 * Phase 1: Verify — find each scan's barcode (or paygo) in CRM inventory
 * Phase 2: Complete the Set — get the counterpart (serial ↔ paygo)
 * Phase 3: SCR Name Validation — fuzzy-match CRM SCR name with branch SCR profiles
 *
 * @param {string} branchId
 * @param {string} branchName
 * @param {function} onProgress - Callback with { current, total, message }
 * @returns {Promise<{ results: Array, passCount: number, failCount: number }>}
 */
export async function enrichBranch(branchId, branchName, onProgress = () => {}) {
  // 1. Fetch all scans for this branch
  onProgress({ current: 0, total: 0, message: 'Loading branch scans...' });

  let allScans = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: scans, error } = await supabase
      .from('scans')
      .select('id, barcode, paygo, scanned_by, branch_id, created_at, profiles ( full_name, role )')
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw new Error(`Failed to load scans: ${error.message}`);

    if (scans && scans.length > 0) {
      allScans = [...allScans, ...scans];
      hasMore = scans.length === pageSize;
      page++;
    } else {
      hasMore = false;
    }
  }

  if (allScans.length === 0) {
    throw new Error('No scans found for this branch.');
  }

  // 2. Fetch all CRM inventory records and build lookup maps
  onProgress({ current: 0, total: allScans.length, message: 'Loading CRM inventory...' });

  let allCrm = [];
  page = 0;
  hasMore = true;

  while (hasMore) {
    const { data: crm, error } = await supabase
      .from('crm_inventory')
      .select('serial_number, paygo_number, scr_name, creation_time')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) throw new Error(`Failed to load CRM inventory: ${error.message}`);

    if (crm && crm.length > 0) {
      allCrm = [...allCrm, ...crm];
      hasMore = crm.length === pageSize;
      page++;
    } else {
      hasMore = false;
    }
  }

  if (allCrm.length === 0) {
    throw new Error('CRM inventory is empty. Please upload your CRM export first.');
  }

  // Build lookup maps (case-insensitive)
  const serialMap = new Map(); // lowercase serial → CRM record
  const paygoMap = new Map();  // lowercase paygo → CRM record

  for (const record of allCrm) {
    if (record.serial_number) {
      serialMap.set(record.serial_number.toLowerCase().trim(), record);
    }
    if (record.paygo_number) {
      paygoMap.set(record.paygo_number.toLowerCase().trim(), record);
    }
  }

  // 3. Get all SCR profiles for this branch
  const { data: branchSCRs, error: scrError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('branch_id', branchId)
    .eq('role', 'SCR');

  if (scrError) throw new Error(`Failed to load SCR profiles: ${scrError.message}`);

  const branchScrNames = (branchSCRs || []).map((p) => p.full_name || '').filter(Boolean);

  // 4. Run enrichment for each scan
  const results = [];
  let passCount = 0;
  let failCount = 0;

  for (let i = 0; i < allScans.length; i++) {
    const scan = allScans[i];
    const result = enrichSingleScan(scan, serialMap, paygoMap, branchScrNames);
    results.push(result);

    if (result.device_verification === 'Pass' && result.scr_verification === 'Pass') {
      passCount++;
    } else {
      failCount++;
    }

    // Report progress every 10 scans or at the end
    if ((i + 1) % 10 === 0 || i === allScans.length - 1) {
      onProgress({
        current: i + 1,
        total: allScans.length,
        message: `Enriching... ${i + 1}/${allScans.length} (✅ ${passCount} / ❌ ${failCount})`,
      });
    }
  }

  return { results, passCount, failCount };
}

/**
 * Exports enrichment results as an Excel file.
 */
export function exportEnrichmentResults(results, branchName) {
  const worksheetData = results.map((r) => ({
    'Serial Number': r.barcode,
    'Paygo Code': r.paygo || '—',
    'CRM Serial': r.crm_serial || '—',
    'CRM PayGo': r.crm_paygo || '—',
    'Scanned By': r.scanned_by_name,
    'Branch': r.branch_name,
    'Scan Date': r.scan_date,
    'CRM SCR Name': r.crm_scr_name || '—',
    'Device Verification': r.device_verification,
    'Device Failure Reason': r.device_failure_reason || '—',
    'SCR Verification': r.scr_verification,
    'SCR Failure Reason': r.scr_failure_reason || '—',
  }));

  // Use the xlsx library (already imported at top)
  const worksheet = XLSX.utils.json_to_sheet(worksheetData);

  // Auto-size columns
  const colWidths = Object.keys(worksheetData[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...worksheetData.map((row) => String(row[key] || '').length)) + 2,
  }));
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Enrichment');

  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${branchName.replace(/\s+/g, '_')}_enrichment_${dateStr}.xlsx`;

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 500);
}


// ============================================
// Internal enrichment logic
// ============================================

/**
 * Enriches a single scan through all 3 phases.
 */
function enrichSingleScan(scan, serialMap, paygoMap, branchScrNames) {
  const barcode = (scan.barcode || '').trim();
  const paygo = (scan.paygo || '').trim();
  const scannerName = scan.profiles?.full_name || '';

  const base = {
    barcode: scan.barcode,
    paygo: scan.paygo || null,
    scanned_by_name: scannerName,
    branch_name: '', // Will be set by caller context
    scan_date: scan.created_at ? new Date(scan.created_at).toLocaleString() : '',
    crm_serial: null,
    crm_paygo: null,
    crm_scr_name: null,
    device_verification: 'Fail',
    device_failure_reason: '',
    scr_verification: 'Fail',
    scr_failure_reason: '',
  };

  // ===== PHASE 1: Verify & Identify =====
  let crmRecord = null;
  let matchedBy = null; // 'serial' | 'paygo'

  if (barcode && paygo) {
    // DUAL MODE: Both barcode and paygo are present
    const dualResult = verifyDualMode(barcode, paygo, serialMap, paygoMap);
    if (dualResult.found) {
      crmRecord = dualResult.crmRecord;
      matchedBy = dualResult.matchedBy;
    } else {
      base.device_failure_reason = dualResult.reason;
      base.scr_failure_reason = 'Device verification failed';
      return base;
    }
  } else if (barcode) {
    // SINGLE MODE: Only barcode (could be serial or paygo)
    const singleResult = verifySingleMode(barcode, serialMap, paygoMap);
    if (singleResult.found) {
      crmRecord = singleResult.crmRecord;
      matchedBy = singleResult.matchedBy;
    } else {
      base.device_failure_reason = singleResult.reason;
      base.scr_failure_reason = 'Device verification failed';
      return base;
    }
  } else {
    base.device_failure_reason = 'Empty barcode — no data to verify';
    base.scr_failure_reason = 'Device verification failed';
    return base;
  }

  // ===== PHASE 2: Complete the Set =====
  base.crm_serial = crmRecord.serial_number || null;
  base.crm_paygo = crmRecord.paygo_number || null;
  base.crm_scr_name = crmRecord.scr_name || null;

  // Check that the counterpart exists
  if (matchedBy === 'serial' && !crmRecord.paygo_number) {
    base.device_failure_reason = 'Counterpart missing: Serial found in CRM but no PayGo number linked';
    base.scr_failure_reason = 'Device verification failed';
    return base;
  }
  if (matchedBy === 'paygo' && !crmRecord.serial_number) {
    base.device_failure_reason = 'Counterpart missing: PayGo found in CRM but no Serial number linked';
    base.scr_failure_reason = 'Device verification failed';
    return base;
  }

  // If we reach here, Device Verification has passed!
  base.device_verification = 'Pass';
  base.device_failure_reason = '';

  // ===== PHASE 3: SCR Name Validation =====
  const crmScrName = crmRecord.scr_name || '';

  if (!crmScrName) {
    base.scr_failure_reason = 'CRM record has no SCR name assigned';
    return base;
  }

  if (branchScrNames.length === 0) {
    base.scr_failure_reason = 'No SCR users found for this branch in the scanner app';
    return base;
  }

  const scrMatched = branchScrNames.some((branchName) =>
    fuzzyNameMatch(branchName, crmScrName)
  );

  if (!scrMatched) {
    base.scr_failure_reason = `SCR name mismatch: CRM has "${crmScrName}", Branch SCR(s): "${branchScrNames.join(', ')}"`;
    return base;
  }

  // ===== SCR VERIFICATION PASSED =====
  base.scr_verification = 'Pass';
  base.scr_failure_reason = '';
  return base;
}

/**
 * Phase 1 — Dual mode verification.
 * Both barcode and paygo are present. Verify they exist and match as a pair.
 */
function verifyDualMode(barcode, paygo, serialMap, paygoMap) {
  const barcodeLower = barcode.toLowerCase();
  const paygoLower = paygo.toLowerCase();

  // Attempt 1: barcode = serial, paygo = paygo (expected normal case)
  const crmBySerial = serialMap.get(barcodeLower);
  if (crmBySerial) {
    const crmPaygo = (crmBySerial.paygo_number || '').toLowerCase().trim();
    if (crmPaygo === paygoLower) {
      return { found: true, crmRecord: crmBySerial, matchedBy: 'serial' };
    }
    // Serial found but paygo doesn't match — check if it's the wrong pair
    const crmByPaygo = paygoMap.get(paygoLower);
    if (crmByPaygo) {
      return {
        found: false,
        reason: `Serial and PayGo both exist in CRM but belong to different products. Serial "${barcode}" → CRM PayGo "${crmBySerial.paygo_number}", but scanned PayGo "${paygo}" → CRM Serial "${crmByPaygo.serial_number}"`,
      };
    }
    return {
      found: false,
      reason: `Serial "${barcode}" found in CRM but scanned PayGo "${paygo}" does not match CRM PayGo "${crmBySerial.paygo_number}"`,
    };
  }

  // Attempt 2: barcode = paygo, paygo = serial (user scanned in wrong order)
  const crmByPaygoBarcode = paygoMap.get(barcodeLower);
  if (crmByPaygoBarcode) {
    const crmSerial = (crmByPaygoBarcode.serial_number || '').toLowerCase().trim();
    if (crmSerial === paygoLower) {
      return { found: true, crmRecord: crmByPaygoBarcode, matchedBy: 'paygo' };
    }
  }

  // Attempt 3: Check paygo field as serial
  const crmBySerialPaygo = serialMap.get(paygoLower);
  if (crmBySerialPaygo) {
    const crmPaygo = (crmBySerialPaygo.paygo_number || '').toLowerCase().trim();
    if (crmPaygo === barcodeLower) {
      return { found: true, crmRecord: crmBySerialPaygo, matchedBy: 'serial' };
    }
  }

  // Nothing matched
  const barcodeInCrm = serialMap.has(barcodeLower) || paygoMap.has(barcodeLower);
  const paygoInCrm = serialMap.has(paygoLower) || paygoMap.has(paygoLower);

  if (!barcodeInCrm && !paygoInCrm) {
    return { found: false, reason: `Neither Serial "${barcode}" nor PayGo "${paygo}" found in CRM inventory` };
  }

  return { found: false, reason: `Serial "${barcode}" and PayGo "${paygo}" found but could not be matched as a valid pair in CRM` };
}

/**
 * Phase 1 — Single mode verification.
 * Only barcode is present. Could be a serial number or a paygo number.
 */
function verifySingleMode(barcode, serialMap, paygoMap) {
  const barcodeLower = barcode.toLowerCase();

  // Step 1: Check if it's a serial number
  const crmBySerial = serialMap.get(barcodeLower);
  if (crmBySerial) {
    return { found: true, crmRecord: crmBySerial, matchedBy: 'serial' };
  }

  // Step 2: Check if it's a paygo number
  const crmByPaygo = paygoMap.get(barcodeLower);
  if (crmByPaygo) {
    return { found: true, crmRecord: crmByPaygo, matchedBy: 'paygo' };
  }

  // Not found
  return { found: false, reason: `"${barcode}" not found in CRM inventory (checked both Serial and PayGo columns)` };
}

/**
 * Smart fuzzy name matching.
 * - For multi-word names: requires 2+ overlapping words (handles reordering and case differences)
 * - For single-word names: requires exact match (case-insensitive)
 */
function fuzzyNameMatch(name1, name2) {
  if (!name1 || !name2) return false;

  const words1 = name1.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  const words2 = name2.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);

  if (words1.length === 0 || words2.length === 0) return false;

  // For single-word names, require exact match
  if (words1.length === 1 || words2.length === 1) {
    // Check if the single word appears in the other name
    const singleWord = words1.length === 1 ? words1[0] : words2[0];
    const otherWords = words1.length === 1 ? words2 : words1;
    return otherWords.includes(singleWord);
  }

  // For multi-word names, count overlapping words
  const set1 = new Set(words1);
  const overlapping = words2.filter((w) => set1.has(w));

  return overlapping.length >= 2;
}
