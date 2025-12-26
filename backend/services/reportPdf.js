const PDFDocument = require('pdfkit');
const https = require('https');
const http = require('http');

const REPORT_TYPE_LABELS = {
  today: "Today's Report",
  weekly: 'Weekly Report',
  monthly: 'Monthly Report',
  yearly: 'Annual Report',
  custom: 'Custom Range Report'
};

// Premium color palette
const colors = {
  primary: '#6366f1',      // Indigo
  primaryDark: '#4f46e5',  // Darker indigo
  secondary: '#8b5cf6',    // Purple
  accent: '#ec4899',       // Pink
  success: '#10b981',      // Emerald
  warning: '#f59e0b',      // Amber
  danger: '#ef4444',       // Red
  info: '#0ea5e9',         // Sky blue
  dark: '#1e293b',         // Slate 800
  darkText: '#0f172a',     // Slate 900
  grayText: '#64748b',     // Slate 500
  lightGray: '#f1f5f9',    // Slate 100
  white: '#ffffff',
  cardBg: '#ffffff',
  cardBorder: '#e2e8f0',   // Slate 200
  tableBorder: '#e2e8f0',
  tableHeader: '#f8fafc',  // Slate 50
  gold: '#fbbf24',         // Gold for stars
};

const formatCurrency = (val) => `Rs.${(val || 0).toLocaleString('en-IN')}`;

// Validate if buffer is a valid image
const isValidImage = (buffer) => {
  if (!buffer || buffer.length < 8) return false;
  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const isPng = pngSignature.every((byte, i) => buffer[i] === byte);
  const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
  const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  return isPng || isJpeg || isGif || isWebp;
};

// Fetch image from URL and return as buffer
const fetchImageBuffer = (url) => {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    
    const timeout = setTimeout(() => resolve(null), 12000);
    
    const makeRequest = (requestUrl, redirectCount = 0) => {
      if (redirectCount > 5) { clearTimeout(timeout); resolve(null); return; }
      
      const reqProtocol = requestUrl.startsWith('https') ? https : http;
      
      reqProtocol.get(requestUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            const urlObj = new URL(requestUrl);
            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
          }
          makeRequest(redirectUrl, redirectCount + 1);
          return;
        }
        
        if (res.statusCode !== 200) { clearTimeout(timeout); resolve(null); return; }
        
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timeout);
          const buffer = Buffer.concat(chunks);
          resolve(isValidImage(buffer) ? buffer : null);
        });
        res.on('error', () => { clearTimeout(timeout); resolve(null); });
      }).on('error', () => { clearTimeout(timeout); resolve(null); });
    };
    
    makeRequest(url);
  });
};

// Pre-fetch all images
const prefetchImages = async (items) => {
  const imageMap = {};
  const uniqueItems = [];
  const seenNames = new Set();
  
  for (const item of items) {
    if (item.name && !seenNames.has(item.name)) {
      seenNames.add(item.name);
      uniqueItems.push(item);
    }
  }
  
  await Promise.all(uniqueItems.map(async (item) => {
    if (item.image) {
      try {
        const buffer = await fetchImageBuffer(item.image);
        if (buffer) imageMap[item.name] = buffer;
      } catch (e) { /* skip */ }
    }
  }));
  return imageMap;
};

const generateReportPdf = async (reportData, reportType) => {
  const allItems = [
    ...(reportData.topSellingItems || []),
    ...(reportData.leastSellingItems || []),
    ...(reportData.allItemsSold || [])
  ];
  const imageMap = await prefetchImages(allItems);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width;
      const imgSize = 36;
      const rowHeight = 48;
      const tableWidth = 515;
      const tableStartX = 40;

      const cols = { sno: 32, image: 48, name: 145, rating: 70, interest: 70, qty: 50, revenue: 100 };

      // === PREMIUM HEADER WITH GRADIENT EFFECT ===
      // Dark gradient header
      doc.rect(0, 0, pageWidth, 130).fill(colors.dark);
      doc.rect(0, 125, pageWidth, 8).fill(colors.primary);
      
      // Decorative accent line
      doc.rect(0, 0, pageWidth, 4).fill(colors.accent);
      
      // Logo/Brand
      doc.fillColor(colors.white).fontSize(32).font('Helvetica-Bold').text('FoodAdmin', 50, 35);
      doc.fillColor(colors.primary).fontSize(10).font('Helvetica').text('PREMIUM ANALYTICS', 52, 70);
      doc.fillColor('#94a3b8').fontSize(10).text('Restaurant Management System', 52, 85);
      
      // Report title badge
      const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      let reportTitle = REPORT_TYPE_LABELS[reportType] || 'Report';
      
      if (reportData.dateRange) {
        const fromDate = formatDate(reportData.dateRange.start);
        const toDate = formatDate(reportData.dateRange.end);
        if (reportType === 'today') reportTitle = `Today's Report - ${fromDate}`;
        else if (reportType === 'custom') reportTitle = `${fromDate} to ${toDate}`;
        else reportTitle = `${REPORT_TYPE_LABELS[reportType]} (${fromDate} - ${toDate})`;
      }
      
      // Report badge on right
      const badgeWidth = 180;
      doc.roundedRect(pageWidth - badgeWidth - 50, 40, badgeWidth, 50, 8).fill(colors.primaryDark);
      doc.fillColor(colors.white).fontSize(9).font('Helvetica').text('REPORT TYPE', pageWidth - badgeWidth - 40, 48, { width: badgeWidth - 20, align: 'center' });
      doc.fontSize(11).font('Helvetica-Bold').text(reportTitle.split(' - ')[0].split(' (')[0], pageWidth - badgeWidth - 40, 63, { width: badgeWidth - 20, align: 'center' });
      
      // Generated date
      const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
      doc.fillColor('#94a3b8').fontSize(9).font('Helvetica').text(`Generated: ${dateStr}`, pageWidth - 200, 100, { width: 150, align: 'right' });

      let y = 155;

      // === PREMIUM SUMMARY CARDS ===
      doc.fillColor(colors.darkText).fontSize(18).font('Helvetica-Bold').text('Summary', 40, y);
      y += 35;

      const summaryData = [
        { label: 'Total Revenue', value: formatCurrency(reportData.totalRevenue), color: colors.success, icon: 'revenue' },
        { label: 'Total Orders', value: String(reportData.totalOrders || 0), color: colors.info, icon: 'orders' },
        { label: 'Items Sold', value: String(reportData.totalItemsSold || 0), color: colors.warning, icon: 'items' },
        { label: 'Avg Order', value: formatCurrency(reportData.avgOrderValue), color: colors.primary, icon: 'avg' }
      ];

      const cardWidth = 118;
      const cardHeight = 80;
      const cardGap = 14;

      summaryData.forEach((item, i) => {
        const x = 40 + (i * (cardWidth + cardGap));
        
        // Card shadow
        doc.rect(x + 2, y + 2, cardWidth, cardHeight).fill('#e2e8f0');
        
        // Card background with gradient effect
        doc.roundedRect(x, y, cardWidth, cardHeight, 10).fill(colors.white);
        doc.roundedRect(x, y, cardWidth, cardHeight, 10).strokeColor(colors.cardBorder).lineWidth(1).stroke();
        
        // Colored top accent
        doc.roundedRect(x, y, cardWidth, 6, 10).fill(item.color);
        doc.rect(x, y + 3, cardWidth, 3).fill(item.color);
        
        // Icon circle
        doc.circle(x + 20, y + 32, 12).fill(item.color + '20');
        doc.fillColor(item.color).fontSize(14).font('Helvetica-Bold');
        if (item.icon === 'revenue') doc.text('$', x + 15, y + 26);
        else if (item.icon === 'orders') doc.text('#', x + 15, y + 26);
        else if (item.icon === 'items') doc.text('*', x + 16, y + 26);
        else doc.text('~', x + 15, y + 26);
        
        // Label
        doc.fillColor(colors.grayText).fontSize(8).font('Helvetica').text(item.label, x + 10, y + 50, { width: cardWidth - 20 });
        
        // Value
        doc.fillColor(colors.darkText).fontSize(16).font('Helvetica-Bold').text(item.value, x + 10, y + 62, { width: cardWidth - 20 });
      });
      y += cardHeight + 30;

      // === ORDER STATUS SECTION ===
      doc.fillColor(colors.darkText).fontSize(16).font('Helvetica-Bold').text('Order Status', 40, y);
      y += 28;

      const statusData = [
        { label: 'Delivered', value: reportData.deliveredOrders || 0, color: colors.success },
        { label: 'Cancelled', value: reportData.cancelledOrders || 0, color: colors.danger },
        { label: 'Refunded', value: reportData.refundedOrders || 0, color: colors.warning },
        { label: 'COD', value: reportData.codOrders || 0, color: colors.info },
        { label: 'UPI', value: reportData.upiOrders || 0, color: colors.secondary }
      ];

      const statusWidth = 95;
      const statusHeight = 60;
      statusData.forEach((item, i) => {
        const x = 40 + (i * (statusWidth + 10));
        
        // Card with colored left border
        doc.roundedRect(x, y, statusWidth, statusHeight, 8).fill(colors.white);
        doc.roundedRect(x, y, statusWidth, statusHeight, 8).strokeColor(colors.cardBorder).lineWidth(1).stroke();
        doc.roundedRect(x, y, 5, statusHeight, 8).fill(item.color);
        doc.rect(x + 3, y, 2, statusHeight).fill(item.color);
        
        // Value
        doc.fillColor(item.color).fontSize(24).font('Helvetica-Bold').text(String(item.value), x + 15, y + 12);
        
        // Label
        doc.fillColor(colors.grayText).fontSize(9).font('Helvetica').text(item.label, x + 15, y + 40);
      });
      y += statusHeight + 25;

      // === HELPER FUNCTIONS ===
      const getInterestLevel = (quantity, allItemsList) => {
        if (!allItemsList || allItemsList.length === 0) return 'low';
        const quantities = allItemsList.map(i => i.quantity || 0);
        const avgQty = quantities.reduce((a, b) => a + b, 0) / quantities.length;
        if (quantity >= avgQty * 1.5) return 'high';
        if (quantity >= avgQty * 0.5) return 'constant';
        return 'low';
      };

      // Draw star icon
      const drawStar = (x, y, size = 10) => {
        doc.save();
        doc.translate(x, y);
        const s = size / 10;
        doc.scale(s);
        doc.path('M5 0L6.2 3.8H10L6.9 6.2L8.1 10L5 7.6L1.9 10L3.1 6.2L0 3.8H3.8Z').fill(colors.gold);
        doc.restore();
      };

      // Draw trend icons
      const drawTrendUp = (x, y, size = 10) => {
        doc.save();
        doc.translate(x, y);
        doc.scale(size / 10);
        doc.path('M5 0L10 7H6V10H4V7H0Z').fill(colors.success);
        doc.restore();
      };

      const drawTrendDown = (x, y, size = 10) => {
        doc.save();
        doc.translate(x, y);
        doc.scale(size / 10);
        doc.path('M5 10L10 3H6V0H4V3H0Z').fill(colors.danger);
        doc.restore();
      };

      const drawStable = (x, y, size = 10) => {
        doc.save();
        doc.translate(x, y);
        doc.roundedRect(0, 3, size, 4, 2).fill(colors.warning);
        doc.restore();
      };

      // Draw section icons
      const drawFireIcon = (x, y, size = 16) => {
        doc.save();
        doc.translate(x, y);
        doc.scale(size / 16);
        doc.path('M8 0C8 0 3 5 3 10C3 13 5 15 8 16C5.5 14 5.5 11 8 8C10.5 11 10.5 14 8 16C11 15 13 13 13 10C13 5 8 0 8 0Z').fill(colors.accent);
        doc.restore();
      };

      const drawChartIcon = (x, y, size = 16) => {
        doc.save();
        doc.translate(x, y);
        doc.scale(size / 16);
        doc.rect(1, 10, 3, 5).fill(colors.info);
        doc.rect(6, 6, 3, 9).fill(colors.primary);
        doc.rect(11, 2, 3, 13).fill(colors.secondary);
        doc.restore();
      };

      const drawBoxIcon = (x, y, size = 16) => {
        doc.save();
        doc.translate(x, y);
        doc.scale(size / 16);
        doc.rect(1, 4, 14, 11).strokeColor(colors.primary).lineWidth(1.5).stroke();
        doc.moveTo(1, 4).lineTo(8, 0).lineTo(15, 4).strokeColor(colors.primary).stroke();
        doc.moveTo(8, 0).lineTo(8, 8).stroke();
        doc.moveTo(1, 4).lineTo(8, 8).lineTo(15, 4).stroke();
        doc.restore();
      };

      // Draw placeholder
      const drawPlaceholder = (imgX, imgY) => {
        doc.roundedRect(imgX, imgY, imgSize, imgSize, 6).fill('#f1f5f9');
        doc.roundedRect(imgX, imgY, imgSize, imgSize, 6).strokeColor(colors.cardBorder).lineWidth(0.5).stroke();
        doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text('No', imgX, imgY + imgSize/2 - 8, { width: imgSize, align: 'center' });
        doc.text('Image', imgX, imgY + imgSize/2, { width: imgSize, align: 'center' });
      };

      // === TABLE HEADER ===
      const drawTableHeader = (startY) => {
        doc.rect(tableStartX, startY, tableWidth, 32).fill(colors.tableHeader);
        doc.moveTo(tableStartX, startY + 32).lineTo(tableStartX + tableWidth, startY + 32).strokeColor(colors.tableBorder).lineWidth(1).stroke();
        
        doc.fillColor(colors.grayText).fontSize(9).font('Helvetica-Bold');
        let x = tableStartX;
        doc.text('#', x + 10, startY + 12, { width: cols.sno });
        x += cols.sno;
        doc.text('Image', x + 6, startY + 12, { width: cols.image });
        x += cols.image;
        doc.text('Item Name', x + 6, startY + 12, { width: cols.name });
        x += cols.name;
        doc.text('Rating', x, startY + 12, { width: cols.rating, align: 'center' });
        x += cols.rating;
        doc.text('Interest', x, startY + 12, { width: cols.interest, align: 'center' });
        x += cols.interest;
        doc.text('Qty', x, startY + 12, { width: cols.qty, align: 'right' });
        x += cols.qty;
        doc.text('Revenue', x, startY + 12, { width: cols.revenue - 10, align: 'right' });
        
        return startY + 32;
      };

      // === TABLE ROW ===
      const drawItemRow = (item, idx, startY, allItemsList) => {
        const rowY = startY;
        
        // Alternating row colors
        if (idx % 2 === 0) {
          doc.rect(tableStartX, rowY, tableWidth, rowHeight).fill('#fafbfc');
        }
        
        // Row border
        doc.moveTo(tableStartX, rowY + rowHeight).lineTo(tableStartX + tableWidth, rowY + rowHeight).strokeColor(colors.tableBorder).lineWidth(0.5).stroke();
        
        let x = tableStartX;
        const textY = rowY + (rowHeight - 10) / 2;
        const imgY = rowY + (rowHeight - imgSize) / 2;
        
        // S.No with circle
        doc.circle(x + 16, rowY + rowHeight/2, 10).fill(colors.primary + '15');
        doc.fillColor(colors.primary).fontSize(9).font('Helvetica-Bold').text(String(idx + 1), x + 6, textY, { width: cols.sno - 6, align: 'center' });
        x += cols.sno;
        
        // Image with better error handling
        const imgBuffer = imageMap[item.name];
        const imgX = x + 6;
        let imageDrawn = false;
        
        if (imgBuffer) {
          try {
            doc.save();
            doc.roundedRect(imgX, imgY, imgSize, imgSize, 6).clip();
            doc.image(imgBuffer, imgX, imgY, { cover: [imgSize, imgSize], align: 'center', valign: 'center' });
            doc.restore();
            doc.roundedRect(imgX, imgY, imgSize, imgSize, 6).strokeColor(colors.cardBorder).lineWidth(0.5).stroke();
            imageDrawn = true;
          } catch (e) {
            try { doc.restore(); } catch (re) { /* ignore */ }
          }
        }
        
        if (!imageDrawn) {
          drawPlaceholder(imgX, imgY);
        }
        x += cols.image;
        
        // Item Name
        doc.fillColor(colors.darkText).fontSize(9).font('Helvetica-Bold').text(item.name || '-', x + 6, textY, { width: cols.name - 12, lineBreak: false });
        x += cols.name;
        
        // Rating
        if (item.totalRatings > 0) {
          drawStar(x + 12, textY, 10);
          doc.fillColor(colors.darkText).fontSize(9).font('Helvetica').text(`${(item.avgRating || 0).toFixed(1)}`, x + 24, textY, { width: 20 });
          doc.fillColor(colors.grayText).fontSize(7).text(`(${item.totalRatings})`, x + 44, textY + 1, { width: 24 });
        } else {
          doc.fillColor(colors.grayText).fontSize(9).font('Helvetica').text('-', x, textY, { width: cols.rating, align: 'center' });
        }
        x += cols.rating;
        
        // Interest badge
        const interest = getInterestLevel(item.quantity, allItemsList);
        const interestConfig = {
          high: { color: colors.success, bg: '#ecfdf5', label: 'High', draw: drawTrendUp },
          constant: { color: colors.warning, bg: '#fffbeb', label: 'Stable', draw: drawStable },
          low: { color: colors.danger, bg: '#fef2f2', label: 'Low', draw: drawTrendDown }
        };
        const { color: iColor, bg: iBg, label: iLabel, draw: iDraw } = interestConfig[interest];
        
        const badgeW = 54, badgeH = 20;
        const badgeX = x + (cols.interest - badgeW) / 2;
        const badgeY = textY - 5;
        doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 10).fill(iBg);
        iDraw(badgeX + 8, badgeY + 5, 10);
        doc.fillColor(iColor).fontSize(8).font('Helvetica-Bold').text(iLabel, badgeX + 20, badgeY + 6, { width: badgeW - 24 });
        x += cols.interest;
        
        // Qty
        doc.fillColor(colors.darkText).fontSize(9).font('Helvetica-Bold').text(String(item.quantity || 0), x, textY, { width: cols.qty - 5, align: 'right' });
        x += cols.qty;
        
        // Revenue
        doc.fillColor(colors.success).fontSize(9).font('Helvetica-Bold').text(formatCurrency(item.revenue), x, textY, { width: cols.revenue - 15, align: 'right' });
        
        return rowY + rowHeight;
      };

      // === DRAW TABLE ===
      const drawItemTable = (title, iconType, items, startY, allItemsList, showAll = false) => {
        let currentY = startY;
        
        if (currentY > 620) {
          doc.addPage();
          currentY = 50;
        }
        
        const itemsToShow = showAll ? items : items.slice(0, 5);
        const tableHeight = 32 + (itemsToShow.length * rowHeight) + 10;
        
        // Card shadow
        doc.rect(tableStartX + 3, currentY + 3, tableWidth, tableHeight + 45).fill('#e2e8f0');
        
        // Card background
        doc.roundedRect(tableStartX, currentY, tableWidth, tableHeight + 42, 12).fill(colors.white);
        doc.roundedRect(tableStartX, currentY, tableWidth, tableHeight + 42, 12).strokeColor(colors.cardBorder).lineWidth(1).stroke();
        
        // Header section with gradient
        doc.save();
        doc.roundedRect(tableStartX, currentY, tableWidth, 40, 12).clip();
        doc.rect(tableStartX, currentY, tableWidth, 40).fill(colors.dark);
        doc.rect(tableStartX, currentY + 36, tableWidth, 4).fill(colors.primary);
        doc.restore();
        
        // Icon
        const iconX = tableStartX + 16;
        const iconY = currentY + 12;
        if (iconType === 'fire') drawFireIcon(iconX, iconY, 16);
        else if (iconType === 'chart') drawChartIcon(iconX, iconY, 16);
        else drawBoxIcon(iconX, iconY, 16);
        
        // Title
        doc.fillColor(colors.white).fontSize(13).font('Helvetica-Bold').text(title, tableStartX + 40, currentY + 13);
        
        // Item count badge
        const countBadge = `${itemsToShow.length} items`;
        doc.roundedRect(tableStartX + tableWidth - 80, currentY + 10, 65, 20, 10).fill(colors.primary);
        doc.fillColor(colors.white).fontSize(9).font('Helvetica').text(countBadge, tableStartX + tableWidth - 78, currentY + 15, { width: 61, align: 'center' });
        
        currentY += 44;
        currentY = drawTableHeader(currentY);

        for (let idx = 0; idx < itemsToShow.length; idx++) {
          if (currentY > 720) {
            doc.addPage();
            currentY = 50;
            currentY = drawTableHeader(currentY);
          }
          
          try {
            currentY = drawItemRow(itemsToShow[idx], idx, currentY, allItemsList);
          } catch (e) {
            currentY += rowHeight;
          }
        }
        
        if (itemsToShow.length === 0) {
          doc.fillColor(colors.grayText).fontSize(11).font('Helvetica').text('No data available', tableStartX, currentY + 25, { width: tableWidth, align: 'center' });
          currentY += 60;
        }
        
        return currentY + 25;
      };

      // === RENDER TABLES ===
      if (reportData.topSellingItems && reportData.topSellingItems.length > 0) {
        y = drawItemTable('Top Selling Items', 'fire', reportData.topSellingItems, y, reportData.allItemsSold || []);
      }

      if (reportData.leastSellingItems && reportData.leastSellingItems.length > 0) {
        y = drawItemTable('Least Selling Items', 'chart', reportData.leastSellingItems, y, reportData.allItemsSold || []);
      }

      if (reportData.allItemsSold && reportData.allItemsSold.length > 0) {
        doc.addPage();
        y = 50;
        y = drawItemTable('All Items Sold', 'box', reportData.allItemsSold, y, reportData.allItemsSold, true);
      }

      // === FOOTER ===
      const footerY = doc.page.height - 40;
      doc.rect(0, footerY - 10, pageWidth, 50).fill(colors.tableHeader);
      doc.moveTo(40, footerY - 10).lineTo(pageWidth - 40, footerY - 10).strokeColor(colors.cardBorder).lineWidth(1).stroke();
      doc.fillColor(colors.grayText).fontSize(8).font('Helvetica').text('This is a computer-generated report. No signature required.', 40, footerY, { width: pageWidth - 80, align: 'center' });
      doc.fillColor(colors.primary).text('FoodAdmin Premium Analytics', 40, footerY + 12, { width: pageWidth - 80, align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = { generateReportPdf };
