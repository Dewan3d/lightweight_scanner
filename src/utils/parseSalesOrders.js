import * as XLSX from 'xlsx';

/**
 * Parses the Sales Orders Excel file and calculates units sold per order.
 *
 * Expected columns: Branch, OrderNo, OrderDate, ProductDetail, ServiceName
 * ProductDetail format: "P-P200-UN-YL-BL-010-P0*1,P-PV75-EU-BK-BL-010*1,A-FN-BL-0224*1"
 *   - Items separated by comma (,)
 *   - Each item has format PRODUCT_CODE*QUANTITY
 *
 * @param {File} file - The Sales Orders Excel file
 * @param {Date} startDate - Start of date range (inclusive)
 * @param {Date} endDate - End of date range (inclusive, end of day)
 * @returns {Promise<Object>} Parsed sales data with totals, per-SCR breakdown, and product breakdown
 */
export async function parseSalesOrders(file, startDate, endDate) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < 2) {
    throw new Error('Sales Orders file appears to be empty or has no data rows.');
  }

  // Validate headers
  const headers = rows[0].map((h) => String(h).trim().toLowerCase());
  const branchIdx = headers.findIndex((h) => h === 'branch');
  const orderNoIdx = headers.findIndex((h) => h === 'orderno');
  const dateIdx = headers.findIndex((h) => h === 'orderdate');
  const productIdx = headers.findIndex((h) => h === 'productdetail');
  const serviceIdx = headers.findIndex((h) => h === 'servicename');

  if (productIdx === -1) {
    throw new Error(
      `Sales Orders file is missing required "ProductDetail" column. ` +
      `Found columns: ${rows[0].join(', ')}`
    );
  }

  if (dateIdx === -1) {
    throw new Error(
      `Sales Orders file is missing required "OrderDate" column. ` +
      `Found columns: ${rows[0].join(', ')}`
    );
  }

  // Set up date range boundaries
  const rangeStart = new Date(startDate);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(endDate);
  rangeEnd.setHours(23, 59, 59, 999);

  let totalUnitsSold = 0;
  const perSCR = {}; // { name: { unitsSold, orderCount } }
  const productBreakdown = {}; // { productCode: totalQty }
  const orderDetails = []; // For export

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[productIdx]) continue;

    // Parse date
    const rawDate = row[dateIdx];
    let orderDate;
    if (typeof rawDate === 'string') {
      orderDate = new Date(rawDate);
    } else if (typeof rawDate === 'number') {
      // Excel serial number fallback
      const epoch = new Date(1899, 11, 30);
      orderDate = new Date(epoch.getTime() + rawDate * 86400000);
    } else {
      continue;
    }

    if (isNaN(orderDate.getTime())) continue;

    // Filter by date range
    if (orderDate < rangeStart || orderDate > rangeEnd) continue;

    // Parse ProductDetail
    const productDetail = String(row[productIdx]).trim();
    const items = productDetail.split(',').filter((s) => s.trim());
    let orderUnits = 0;

    for (const item of items) {
      const trimmed = item.trim();
      const parts = trimmed.split('*');
      const productCode = parts[0] || trimmed;
      const qty = parts.length > 1 ? parseInt(parts[1]) || 1 : 1;

      orderUnits += qty;

      // Track per-product breakdown
      const friendlyName = getProductFriendlyName(productCode);
      productBreakdown[friendlyName] = (productBreakdown[friendlyName] || 0) + qty;
    }

    totalUnitsSold += orderUnits;

    // Track per-SCR
    const serviceName = serviceIdx !== -1 ? String(row[serviceIdx] || '').trim() : 'Unknown';
    if (serviceName) {
      if (!perSCR[serviceName]) {
        perSCR[serviceName] = { unitsSold: 0, orderCount: 0 };
      }
      perSCR[serviceName].unitsSold += orderUnits;
      perSCR[serviceName].orderCount += 1;
    }

    // Track order detail for export
    orderDetails.push({
      branch: branchIdx !== -1 ? String(row[branchIdx] || '').trim() : '',
      orderNo: orderNoIdx !== -1 ? String(row[orderNoIdx] || '').trim() : '',
      orderDate: orderDate.toISOString().slice(0, 19).replace('T', ' '),
      productDetail,
      serviceName,
      unitCount: orderUnits,
    });
  }

  return {
    totalUnitsSold,
    perSCR,
    productBreakdown,
    orderDetails,
    totalRows: rows.length - 1,
    filteredRows: orderDetails.length,
  };
}

/**
 * Converts a raw product code to a shorter, human-friendly name.
 * e.g., "P-P200-UN-YL-BL-010-P0" → "P200"
 *       "A-FN-BL-0224" → "Fan"
 *       "A-LCD-SA" → "LCD"
 *       "P-PV75-EU-BK-BL-010" → "PV75"
 *
 * @param {string} code - Raw product code
 * @returns {string} Friendly product name
 */
function getProductFriendlyName(code) {
  const upper = code.toUpperCase().trim();

  // Extract the key product identifier using known patterns
  if (upper.includes('P200'))  return 'P200';
  if (upper.includes('P100'))  return 'P100';
  if (upper.includes('P350'))  return 'P350';
  if (upper.includes('P80'))   return 'P80';
  if (upper.includes('E60'))   return 'E60';
  if (upper.includes('PV110')) return 'PV110';
  if (upper.includes('PV75'))  return 'PV75';
  if (upper.includes('PV55'))  return 'PV55';
  if (upper.includes('A-FN') || upper.includes('-FN-'))  return 'Fan';
  if (upper.includes('LCD'))   return 'LCD TV';

  // Fallback: try to extract a short name from the code
  // Pattern: P-XXXX-... → XXXX or A-XXXX-... → XXXX
  const match = upper.match(/^[PA]-([A-Z0-9]+)/);
  if (match) return match[1];

  return code; // Return original if no pattern matches
}
