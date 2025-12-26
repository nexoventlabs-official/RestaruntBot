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

// Format currency for PDF (using Rs. since Helvetica doesn't support ₹)
const formatCurrency = (val) => `Rs.${(val || 0).toLocaleString('en-IN')}`;

// Fetch image from URL and return as buffer
const fetchImageBuffer = (url) => {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    
    const protocol = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => resolve(null), 8000); // 8s timeout
    
    protocol.get(url, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        fetchImageBuffer(res.headers.location).then(resolve);
        return;
      }
      
      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        resolve(null);
        return;
      }
      
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });
      res.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    }).on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
};

// Pre-fetch all images for items
const prefetchImages = async (items) => {
  const imageMap = {};
  const promises = items.map(async (item) => {
    if (item.image) {
      const buffer = await fetchImageBuffer(item.image);
      if (buffer) {
        imageMap[item.name] = buffer;
      }
    }
  });
  await Promise.all(promises);
  return imageMap;
};

const generateReportPdf = async (reportData, reportType) => {
  // Pre-fetch images for all items
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

      // Colors matching admin panel
      const primaryColor = '#e63946';
      const darkColor = '#1c1d21';
      const grayColor = '#61636b';
      const lightGray = '#f8f9fb';
      const borderColor = '#e5e7eb';
      
      // Table settings - matching admin panel (40x40 images)
      const imgSize = 32; // Image size matching admin panel proportionally
      const rowHeight = 44; // Row height to accommodate images
      const tableWidth = 515; // Full width table
      const tableStartX = 40;

      // Column widths matching admin panel proportions
      const cols = {
        sno: 35,
        image: 45,
        name: 140,
        rating: 70,
        interest: 70,
        qty: 55,
        revenue: 100
      };

      // Header
      doc.rect(0, 0, doc.page.width, 120).fill(primaryColor);
      doc.fillColor('white').fontSize(28).font('Helvetica-Bold')
        .text('FoodAdmin', 50, 40);
      doc.fontSize(12).font('Helvetica')
        .text('Restaurant Management System', 50, 75);
      
      // Generate report title with date range
      const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      let reportTitle = 'Report';
      
      if (reportData.dateRange) {
        const fromDate = formatDate(reportData.dateRange.start);
        const toDate = formatDate(reportData.dateRange.end);
        
        switch (reportType) {
          case 'today':
            reportTitle = `Today's Report (${fromDate})`;
            break;
          case 'weekly':
            reportTitle = `Weekly Report (${fromDate} - ${toDate})`;
            break;
          case 'monthly':
            reportTitle = `Monthly Report (${fromDate} - ${toDate})`;
            break;
          case 'yearly':
            reportTitle = `Annual Report (${fromDate} - ${toDate})`;
            break;
          case 'custom':
            reportTitle = `${fromDate} - ${toDate}`;
            break;
          default:
            reportTitle = REPORT_TYPE_LABELS[reportType] || 'Report';
        }
      } else {
        reportTitle = REPORT_TYPE_LABELS[reportType] || 'Report';
      }
      
      doc.fontSize(14).font('Helvetica-Bold')
        .text(reportTitle, 50, 95);

      // Date info
      const dateStr = new Date().toLocaleDateString('en-IN', { 
        day: '2-digit', month: 'long', year: 'numeric' 
      });
      doc.fontSize(10).font('Helvetica').fillColor('white')
        .text(`Generated: ${dateStr}`, doc.page.width - 200, 50, { width: 150, align: 'right' });

      let y = 145;

      // Summary Section
      doc.fillColor(darkColor).fontSize(16).font('Helvetica-Bold')
        .text('Summary', 40, y);
      y += 30;

      // Summary boxes - matching admin panel cards
      const summaryData = [
        { label: 'Total Revenue', value: formatCurrency(reportData.totalRevenue), color: '#22c55e' },
        { label: 'Total Orders', value: String(reportData.totalOrders || 0), color: '#3b82f6' },
        { label: 'Items Sold', value: String(reportData.totalItemsSold || 0), color: '#f97316' },
        { label: 'Avg Order Value', value: formatCurrency(reportData.avgOrderValue), color: '#e63946' }
      ];

      const boxWidth = 120;
      const boxHeight = 65;
      summaryData.forEach((item, i) => {
        const x = 40 + (i * (boxWidth + 12));
        // Card background
        doc.roundedRect(x, y, boxWidth, boxHeight, 8).fillAndStroke('#ffffff', borderColor);
        // Color indicator bar
        doc.rect(x, y, 4, boxHeight).fill(item.color);
        // Label
        doc.fillColor(grayColor).fontSize(9).font('Helvetica')
          .text(item.label, x + 12, y + 12, { width: boxWidth - 20 });
        // Value
        doc.fillColor(darkColor).fontSize(18).font('Helvetica-Bold')
          .text(item.value, x + 12, y + 32, { width: boxWidth - 20 });
      });
      y += boxHeight + 20;

      // Order Status Section
      doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold')
        .text('Order Status Breakdown', 40, y);
      y += 25;

      const statusData = [
        { label: 'Delivered', value: reportData.deliveredOrders || 0, color: '#22c55e' },
        { label: 'Cancelled', value: reportData.cancelledOrders || 0, color: '#ef4444' },
        { label: 'Refunded', value: reportData.refundedOrders || 0, color: '#f97316' },
        { label: 'COD Orders', value: reportData.codOrders || 0, color: '#3b82f6' },
        { label: 'UPI Orders', value: reportData.upiOrders || 0, color: '#8b5cf6' }
      ];

      const statusBoxWidth = 95;
      statusData.forEach((item, i) => {
        const x = 40 + (i * (statusBoxWidth + 8));
        doc.roundedRect(x, y, statusBoxWidth, 50, 6).fillAndStroke('#ffffff', borderColor);
        doc.rect(x, y, 3, 50).fill(item.color);
        doc.fillColor(item.color).fontSize(20).font('Helvetica-Bold')
          .text(String(item.value), x + 10, y + 10);
        doc.fillColor(grayColor).fontSize(8).font('Helvetica')
          .text(item.label, x + 10, y + 32);
      });
      y += 70;

      // Helper function to calculate interest level
      const getInterestLevel = (quantity, allItems) => {
        if (!allItems || allItems.length === 0) return 'low';
        const quantities = allItems.map(i => i.quantity || 0);
        const avgQty = quantities.reduce((a, b) => a + b, 0) / quantities.length;
        
        if (quantity >= avgQty * 1.5) return 'high';
        if (quantity >= avgQty * 0.5) return 'constant';
        return 'low';
      };

      // Helper function to draw table header - matching admin panel style
      const drawTableHeader = (startY) => {
        // Header background - matching bg-dark-50
        doc.rect(tableStartX, startY, tableWidth, 28).fill('#f9fafb');
        
        // Header text
        doc.fillColor('#4b5563').fontSize(9).font('Helvetica-Bold');
        let x = tableStartX;
        doc.text('S.No', x + 8, startY + 10, { width: cols.sno });
        x += cols.sno;
        doc.text('Image', x + 4, startY + 10, { width: cols.image });
        x += cols.image;
        doc.text('Item Name', x + 4, startY + 10, { width: cols.name });
        x += cols.name;
        doc.text('Rating', x + 4, startY + 10, { width: cols.rating, align: 'center' });
        x += cols.rating;
        doc.text('Interest', x + 4, startY + 10, { width: cols.interest, align: 'center' });
        x += cols.interest;
        doc.text('Qty Sold', x + 4, startY + 10, { width: cols.qty, align: 'right' });
        x += cols.qty;
        doc.text('Revenue', x + 4, startY + 10, { width: cols.revenue - 8, align: 'right' });
        
        return startY + 28;
      };

      // Helper function to draw item row - matching admin panel style
      const drawItemRow = (item, idx, startY, allItems) => {
        const rowY = startY;
        
        // Alternating row background for better readability
        if (idx % 2 === 1) {
          doc.rect(tableStartX, rowY, tableWidth, rowHeight).fill('#fafafa');
        }
        
        // Row border bottom
        doc.moveTo(tableStartX, rowY + rowHeight).lineTo(tableStartX + tableWidth, rowY + rowHeight).stroke(borderColor);
        
        let x = tableStartX;
        const textY = rowY + (rowHeight - 10) / 2;
        const imgY = rowY + (rowHeight - imgSize) / 2;
        
        // S.No
        doc.fillColor('#6b7280').fontSize(9).font('Helvetica')
          .text(String(idx + 1), x + 8, textY, { width: cols.sno });
        x += cols.sno;
        
        // Image - matching admin panel 40x40 rounded style with object-cover (fill box, no gaps)
        const imgBuffer = imageMap[item.name];
        const imgX = x + 4;
        if (imgBuffer) {
          try {
            // Draw rounded rectangle clip for image
            doc.save();
            doc.roundedRect(imgX, imgY, imgSize, imgSize, 4).clip();
            // Use cover option to fill the entire box (crops image to fit, no gaps)
            doc.image(imgBuffer, imgX, imgY, { cover: [imgSize, imgSize], align: 'center', valign: 'center' });
            doc.restore();
            // Border around image
            doc.roundedRect(imgX, imgY, imgSize, imgSize, 4).stroke(borderColor);
          } catch (e) {
            // Draw placeholder if image fails
            doc.roundedRect(imgX, imgY, imgSize, imgSize, 4).fillAndStroke('#f3f4f6', borderColor);
            doc.fillColor('#9ca3af').fontSize(14).text('?', imgX + imgSize/2 - 4, imgY + imgSize/2 - 7);
          }
        } else {
          // Draw placeholder box - matching admin panel placeholder
          doc.roundedRect(imgX, imgY, imgSize, imgSize, 4).fillAndStroke('#f3f4f6', borderColor);
          doc.fillColor('#9ca3af').fontSize(14).text('?', imgX + imgSize/2 - 4, imgY + imgSize/2 - 7);
        }
        x += cols.image;
        
        // Item Name
        doc.fillColor(darkColor).fontSize(9).font('Helvetica')
          .text(item.name || '-', x + 4, textY, { width: cols.name - 8, lineBreak: false });
        x += cols.name;
        
        // Rating column - matching admin panel star style
        if (item.totalRatings > 0) {
          doc.fillColor('#facc15').fontSize(9).text('★', x + 8, textY, { width: 12 });
          doc.fillColor(darkColor).text(`${(item.avgRating || 0).toFixed(1)}`, x + 20, textY, { width: 20 });
          doc.fillColor(grayColor).fontSize(7).text(`(${item.totalRatings})`, x + 40, textY + 1, { width: 25 });
        } else {
          doc.fillColor('#9ca3af').fontSize(9).text('-', x + 4, textY, { width: cols.rating, align: 'center' });
        }
        x += cols.rating;
        
        // Interest column with badge - matching admin panel InterestBadge
        const interest = getInterestLevel(item.quantity, allItems);
        const interestConfig = {
          high: { color: '#22c55e', bg: '#f0fdf4', label: 'High', icon: '↑' },
          constant: { color: '#eab308', bg: '#fefce8', label: 'Stable', icon: '→' },
          low: { color: '#ef4444', bg: '#fef2f2', label: 'Low', icon: '↓' }
        };
        const { color: interestColor, bg: interestBg, label: interestLabel, icon: interestIcon } = interestConfig[interest];
        
        // Draw badge background
        const badgeWidth = 50;
        const badgeHeight = 18;
        const badgeX = x + (cols.interest - badgeWidth) / 2;
        const badgeY = textY - 4;
        doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 9).fill(interestBg);
        doc.fillColor(interestColor).fontSize(8).font('Helvetica-Bold')
          .text(`${interestIcon} ${interestLabel}`, badgeX + 4, badgeY + 5, { width: badgeWidth - 8, align: 'center' });
        x += cols.interest;
        
        // Qty Sold
        doc.fillColor(darkColor).fontSize(9).font('Helvetica')
          .text(String(item.quantity || 0), x + 4, textY, { width: cols.qty - 8, align: 'right' });
        x += cols.qty;
        
        // Revenue
        doc.fillColor(darkColor).fontSize(9).font('Helvetica')
          .text(formatCurrency(item.revenue), x + 4, textY, { width: cols.revenue - 12, align: 'right' });
        
        return rowY + rowHeight;
      };

      // Helper function to draw complete item table - matching admin panel card style
      const drawItemTable = (title, emoji, items, startY, allItems, showAll = false) => {
        let currentY = startY;
        
        // Check if we need a new page
        if (currentY > 650) {
          doc.addPage();
          currentY = 50;
        }
        
        // Table card container - matching admin panel rounded-xl shadow-card
        const itemsToShow = showAll ? items : items.slice(0, 5);
        const tableHeight = 28 + (itemsToShow.length * rowHeight) + 20; // header + rows + padding
        
        // Card background with shadow effect
        doc.rect(tableStartX - 2, currentY - 2, tableWidth + 4, tableHeight + 40).fill('#f8f9fa');
        doc.roundedRect(tableStartX, currentY, tableWidth, tableHeight + 36, 8).fill('#ffffff');
        doc.roundedRect(tableStartX, currentY, tableWidth, tableHeight + 36, 8).stroke(borderColor);
        
        // Title section - matching admin panel header
        doc.rect(tableStartX, currentY, tableWidth, 32).fill('#ffffff');
        doc.roundedRect(tableStartX, currentY, tableWidth, 32, 8).stroke(borderColor);
        doc.moveTo(tableStartX, currentY + 32).lineTo(tableStartX + tableWidth, currentY + 32).stroke(borderColor);
        
        doc.fillColor(darkColor).fontSize(12).font('Helvetica-Bold')
          .text(`${emoji} ${title}`, tableStartX + 12, currentY + 10);
        currentY += 36;

        // Table header
        currentY = drawTableHeader(currentY);

        // Table rows
        doc.font('Helvetica').fontSize(9);
        itemsToShow.forEach((item, idx) => {
          // Check if we need a new page
          if (currentY > 720) {
            doc.addPage();
            currentY = 50;
            // Redraw table header on new page
            currentY = drawTableHeader(currentY);
          }
          
          currentY = drawItemRow(item, idx, currentY, allItems);
        });
        
        // No data message
        if (itemsToShow.length === 0) {
          doc.fillColor('#9ca3af').fontSize(10).font('Helvetica')
            .text('No data available', tableStartX, currentY + 20, { width: tableWidth, align: 'center' });
          currentY += 50;
        }
        
        return currentY + 20;
      };

      // Top Selling Items
      if (reportData.topSellingItems && reportData.topSellingItems.length > 0) {
        y = drawItemTable('Top Selling Items', '🔥', reportData.topSellingItems, y, reportData.allItemsSold || []);
      }

      // Least Selling Items
      if (reportData.leastSellingItems && reportData.leastSellingItems.length > 0) {
        y = drawItemTable('Least Selling Items', '📉', reportData.leastSellingItems, y, reportData.allItemsSold || []);
      }

      // All Items Sold - show ALL items on new page
      if (reportData.allItemsSold && reportData.allItemsSold.length > 0) {
        doc.addPage();
        y = 50;
        y = drawItemTable('All Items Sold', '📦', reportData.allItemsSold, y, reportData.allItemsSold, true);
      }

      // Footer on last page
      doc.fillColor(grayColor).fontSize(8).font('Helvetica')
        .text('This is a computer-generated report. No signature required.', 50, doc.page.height - 50, { align: 'center', width: doc.page.width - 100 });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = { generateReportPdf };
