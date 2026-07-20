import * as XLSX from 'xlsx';

/**
 * Combines transfer and sales data to calculate the ledger-style stock balance.
 *
 * Ledger Formula:
 *   Opening Balance = Historical Received − Historical Sent Out − Historical Sold
 *   Closing Balance = Opening Balance + Period Received − Period Sent Out − Period Sold
 *
 * @param {Object} transferData - Output from parseTransferRecord() (ledger format)
 * @param {Object} salesData - Output from parseSalesOrders() (ledger format)
 * @param {string} branchName - Name of the selected branch
 * @param {string[]} branchSCRNames - SCR names for this branch
 * @returns {Object} Combined results with opening/closing balance and per-SCR breakdown
 */
export function calculateStockBalance(transferData, salesData, branchName, branchSCRNames) {
  // Branch-level opening balance (all activity before the selected period)
  const openingBalance =
    transferData.historical.received -
    transferData.historical.sentOut -
    salesData.historical.unitsSold;

  // Branch-level closing balance
  const closingBalance =
    openingBalance +
    transferData.period.received -
    transferData.period.sentOut -
    salesData.period.unitsSold;

  // Build per-SCR combined breakdown
  const perSCRCombined = branchSCRNames.map((name) => {
    const t = transferData.perSCR[name] || {
      historicalReceived: 0,
      historicalSentOut: 0,
      periodReceived: 0,
      periodSentOut: 0,
      periodInternal: 0,
    };
    const s = salesData.period.perSCR[name] || { historicalSold: 0, periodSold: 0, periodOrders: 0 };

    const scrOpening = t.historicalReceived - t.historicalSentOut - s.historicalSold;
    const scrClosing = scrOpening + t.periodReceived - t.periodSentOut - s.periodSold;

    return {
      name,
      openingBalance: scrOpening,
      periodReceived: t.periodReceived,
      periodSentOut: t.periodSentOut,
      periodInternal: t.periodInternal,
      periodSold: s.periodSold,
      periodOrders: s.periodOrders,
      closingBalance: scrClosing,
    };
  });

  // Also include sellers from the sales file who are NOT registered branch SCRs
  const branchSCRNamesLower = new Set(branchSCRNames.map((n) => n.toLowerCase().trim()));
  const otherSellers = [];
  for (const [name, data] of Object.entries(salesData.period.perSCR)) {
    if (!branchSCRNamesLower.has(name.toLowerCase().trim())) {
      otherSellers.push({
        name,
        openingBalance: 0,
        periodReceived: 0,
        periodSentOut: 0,
        periodInternal: 0,
        periodSold: data.periodSold,
        periodOrders: data.periodOrders,
        closingBalance: -data.periodSold,
        isExternal: true,
      });
    }
  }

  return {
    branchName,
    openingBalance,
    periodReceived: transferData.period.received,
    periodSentOut: transferData.period.sentOut,
    periodInternal: transferData.period.internal,
    periodSold: salesData.period.unitsSold,
    closingBalance,
    perSCR: perSCRCombined,
    otherSellers,
    productBreakdown: salesData.period.productBreakdown,
    transferDetails: transferData.details,
    salesDetails: salesData.period.orderDetails,
    stats: {
      totalTransferRows: transferData.totalRows,
      filteredTransferRows: transferData.filteredRows,
      totalSalesRows: salesData.totalRows,
      filteredSalesRows: salesData.filteredRows,
    },
  };
}

/**
 * Exports the stock verification results as a multi-sheet Excel file.
 *
 * @param {Object} results - Output from calculateStockBalance()
 * @param {string} startDateStr - Formatted start date string
 * @param {string} endDateStr - Formatted end date string
 */
export function exportStockVerification(results, startDateStr, endDateStr) {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary (Ledger format)
  const summaryData = [
    { Field: 'Branch', Value: results.branchName },
    { Field: 'Audit Period', Value: `${startDateStr} to ${endDateStr}` },
    { Field: '', Value: '' },
    { Field: '═══ STOCK LEDGER ═══', Value: '' },
    { Field: 'Opening Stock (Carry-over)', Value: results.openingBalance },
    { Field: '', Value: '' },
    { Field: '  (+) Stock Received (Period)', Value: results.periodReceived },
    { Field: '  (−) Stock Sent Out (Period)', Value: results.periodSentOut },
    { Field: '  (−) Stock Sold (Period)', Value: results.periodSold },
    { Field: '  (○) Internal Transfers (Period)', Value: results.periodInternal },
    { Field: '', Value: '' },
    { Field: 'CLOSING STOCK BALANCE', Value: results.closingBalance },
    { Field: '', Value: '' },
    { Field: '═══ PRODUCT BREAKDOWN (Sales, Period Only) ═══', Value: '' },
  ];

  // Add product breakdown
  for (const [product, qty] of Object.entries(results.productBreakdown).sort((a, b) => b[1] - a[1])) {
    summaryData.push({ Field: `  ${product}`, Value: qty });
  }

  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  autoSizeColumns(summarySheet, summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: Per-SCR Breakdown
  const scrData = [
    ...results.perSCR.map((s) => ({
      'SCR Name': s.name,
      'Opening Balance': s.openingBalance,
      'Received (Period)': s.periodReceived,
      'Sent Out (Period)': s.periodSentOut,
      'Internal (Period)': s.periodInternal,
      'Sold (Period)': s.periodSold,
      'Orders (Period)': s.periodOrders,
      'Closing Balance': s.closingBalance,
      'Type': 'Branch SCR',
    })),
    ...results.otherSellers.map((s) => ({
      'SCR Name': s.name,
      'Opening Balance': s.openingBalance,
      'Received (Period)': s.periodReceived,
      'Sent Out (Period)': s.periodSentOut,
      'Internal (Period)': s.periodInternal,
      'Sold (Period)': s.periodSold,
      'Orders (Period)': s.periodOrders,
      'Closing Balance': s.closingBalance,
      'Type': 'External Seller',
    })),
  ];

  if (scrData.length > 0) {
    const scrSheet = XLSX.utils.json_to_sheet(scrData);
    autoSizeColumns(scrSheet, scrData);
    XLSX.utils.book_append_sheet(workbook, scrSheet, 'Per-SCR Breakdown');
  }

  // Sheet 3: Transfer Details
  if (results.transferDetails.length > 0) {
    const transferSheetData = results.transferDetails.map((t) => ({
      'Date': t.date,
      'Sender': t.sender,
      'Receiver': t.receiver,
      'Quantity': t.quantity,
      'Category': t.category === 'received' ? 'Stock IN'
        : t.category === 'sentOut' ? 'Stock OUT'
        : 'Internal',
    }));
    const transferSheet = XLSX.utils.json_to_sheet(transferSheetData);
    autoSizeColumns(transferSheet, transferSheetData);
    XLSX.utils.book_append_sheet(workbook, transferSheet, 'Transfer Details');
  }

  // Sheet 4: Sales Details
  if (results.salesDetails.length > 0) {
    const salesSheetData = results.salesDetails.map((s) => ({
      'Order No': s.orderNo,
      'Order Date': s.orderDate,
      'Service Name': s.serviceName,
      'Products': s.productDetail,
      'Unit Count': s.unitCount,
    }));
    const salesSheet = XLSX.utils.json_to_sheet(salesSheetData);
    autoSizeColumns(salesSheet, salesSheetData);
    XLSX.utils.book_append_sheet(workbook, salesSheet, 'Sales Details');
  }

  // Generate and download
  const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  const safeBranch = results.branchName.replace(/\s+/g, '_');
  const filename = `Stock_Verification_${safeBranch}_${dateStr}.xlsx`;

  if (window.navigator && window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }

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

/**
 * Auto-sizes columns based on content width.
 * @param {Object} sheet - XLSX worksheet
 * @param {Array<Object>} data - Data array used to create the sheet
 */
function autoSizeColumns(sheet, data) {
  if (!data || data.length === 0) return;
  const keys = Object.keys(data[0]);
  sheet['!cols'] = keys.map((key) => ({
    wch: Math.max(
      key.length,
      ...data.map((row) => String(row[key] || '').length)
    ) + 2,
  }));
}
