import * as XLSX from 'xlsx';

/**
 * Combines transfer and sales data to calculate the final stock balance
 * and generates export-ready data.
 *
 * Formula: Balance = Total Received − Total Sent Out − Total Sold
 *
 * @param {Object} transferData - Output from parseTransferRecord()
 * @param {Object} salesData - Output from parseSalesOrders()
 * @param {string} branchName - Name of the selected branch
 * @param {string[]} branchSCRNames - SCR names for this branch
 * @returns {Object} Combined results with balance and per-SCR breakdown
 */
export function calculateStockBalance(transferData, salesData, branchName, branchSCRNames) {
  const balance = transferData.totalReceived - transferData.totalSentOut - salesData.totalUnitsSold;

  // Build per-SCR combined breakdown
  const perSCRCombined = branchSCRNames.map((name) => {
    const transfer = transferData.perSCR[name] || { received: 0, sentOut: 0, internal: 0 };
    const sales = salesData.perSCR[name] || { unitsSold: 0, orderCount: 0 };

    return {
      name,
      received: transfer.received,
      sentOut: transfer.sentOut,
      internal: transfer.internal,
      sold: sales.unitsSold,
      orders: sales.orderCount,
      balance: transfer.received - transfer.sentOut - sales.unitsSold,
    };
  });

  // Also include sellers from the sales file who are NOT registered branch SCRs
  // (so the admin can see all sales attribution)
  const branchSCRNamesLower = new Set(branchSCRNames.map((n) => n.toLowerCase().trim()));
  const otherSellers = [];
  for (const [name, data] of Object.entries(salesData.perSCR)) {
    if (!branchSCRNamesLower.has(name.toLowerCase().trim())) {
      otherSellers.push({
        name,
        received: 0,
        sentOut: 0,
        internal: 0,
        sold: data.unitsSold,
        orders: data.orderCount,
        balance: -data.unitsSold, // They sold stock but didn't receive any (from this branch's perspective)
        isExternal: true,
      });
    }
  }

  return {
    branchName,
    totalReceived: transferData.totalReceived,
    totalSentOut: transferData.totalSentOut,
    totalInternal: transferData.totalInternal,
    totalSold: salesData.totalUnitsSold,
    balance,
    perSCR: perSCRCombined,
    otherSellers,
    productBreakdown: salesData.productBreakdown,
    transferDetails: transferData.details,
    salesDetails: salesData.orderDetails,
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

  // Sheet 1: Summary
  const summaryData = [
    { Field: 'Branch', Value: results.branchName },
    { Field: 'Date Range', Value: `${startDateStr} to ${endDateStr}` },
    { Field: '', Value: '' },
    { Field: 'Total Stock Received', Value: results.totalReceived },
    { Field: 'Total Stock Sent Out', Value: results.totalSentOut },
    { Field: 'Internal Transfers', Value: results.totalInternal },
    { Field: 'Total Units Sold', Value: results.totalSold },
    { Field: '', Value: '' },
    { Field: 'STOCK BALANCE', Value: results.balance },
    { Field: '', Value: '' },
    { Field: '--- Product Breakdown (Sales) ---', Value: '' },
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
      'Stock Received': s.received,
      'Stock Sent Out': s.sentOut,
      'Internal Transfers': s.internal,
      'Units Sold': s.sold,
      'Orders': s.orders,
      'Balance': s.balance,
      'Type': 'Branch SCR',
    })),
    ...results.otherSellers.map((s) => ({
      'SCR Name': s.name,
      'Stock Received': s.received,
      'Stock Sent Out': s.sentOut,
      'Internal Transfers': s.internal,
      'Units Sold': s.sold,
      'Orders': s.orders,
      'Balance': s.balance,
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
