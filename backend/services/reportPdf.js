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
  primaryDark: '#4f46e5',
  primaryLight: '#a5b4fc',
  secondary: '#0ea5e9',    // Sky blue
  success: '#10b981',      // Emerald
  warning: '#f59e0b',      // Amber
  danger: '#ef4444',       // Red
  purple: '#8b5cf6',       // Purple
  dark: '#1e293b',         // Slate 800
  darkGray: '#475569',     // Slate 600
  gray: '#64748b',         // Slate 500
  lightGray: '#94a3b8',    // Slate 400
  border: '#e2e8f0',       // Slate 200
  background: '#f8fafc',   // Slate 50
  white: '#ffffff'
};

// Format currency for PDF
const formatCurrency = (val) => `Rs. ${(val || 0).toLocaleString('en-IN')}`;

// Fetch image from URL and return as buffer
const fetchImageBuffer = (url) => {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    
    const protocol = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => resolve(null), 5000);
    
    protocol.get(url, (res) => {
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
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const contentWidth = pageWidth - 80;

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Helper: Draw rounded rectangle
      const drawRoundedRect = (x, y, w, h, r, fillColor, strokeColor = null) => {
        doc.roundedRect(x, y, w, h, r);
        if (strokeColor) {
          doc.fillAndStroke(fillColor, strokeColor);
        } else {
          doc.fill(fillColor);
        }
      };

      // Helper: Draw stat card
      const drawStatCard = (x, y, width, height, label, value, accentColor) => {
        // Card background
        drawRoundedRect(x, y, width, height, 8, colors.white);
        // Left accent bar
        doc.roundedRect(x, y, 4, height, 2).fill(accentColor);
        // Value
        doc.fillColor(colors.dark).fontSize(18).font('Helvetica-Bold')
          .text(value, x + 15, y + 15, { width: width - 25 });
        // Label
        doc.fillColor(colors.gray).fontSize(9).font('Helvetica')
          .text(label, x + 15, y + 38, { width: width - 25 });
      };

      // Helper: Draw mini stat
      const drawMiniStat = (x, y, width, label, value, color) => {
        drawRoundedRect(x, y, width, 50, 6, colors.white);
        doc.fillColor(color).fontSize(20).font('Helvetica-Bold')
          .text(String(value), x + 12, y + 10, { width: width - 24 });
        doc.fillColor(colors.darkGray).fontSize(8).font('Helvetica')
          .text(label, x + 12, y + 32, { width: width - 24 });
      };

      // ============ HEADER SECTION ============
      // Gradient-like header background
      doc.rect(0, 0, pageWidth, 140).fill(colors.primary);
      doc.rect(0, 100, pageWidth, 40).fill(colors.primaryDark);
      
      // Decorative circles
      doc.circle(pageWidth - 60, 30, 80).fill(colors.primaryLight).opacity(0.1);
      doc.circle(pageWidth - 20, 80, 50).fill(colors.primaryLight).opacity(0.1);
      doc.opacity(1);

      // Logo/Brand
      doc.fillColor(colors.white).fontSize(26).font('Helvetica-Bold')
        .text('FoodAdmin', 40, 35);
      doc.fillColor(colors.primaryLight).fontSize(10).font('Helvetica')
        .text('Restaurant Management System', 40, 65);

      // Report title with date range
      const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      let reportTitle = REPORT_TYPE_LABELS[reportType] || 'Report';
      let dateSubtitle = '';
      
      if (reportData.dateRange) {
        const fromDate = formatDate(reportData.dateRange.start);
        const toDate = formatDate(reportData.dateRange.end);
        dateSubtitle = reportType === 'today' ? fromDate : `${fromDate} - ${toDate}`;
      }

      // Report badge
      drawRoundedRect(40, 105, 180, 26, 13, colors.white);
      doc.fillColor(colors.primary).fontSize(11).font('Helvetica-Bold')
        .text(reportTitle, 55, 111);

      // Generated date (right side)
      const dateStr = new Date().toLocaleDateString('en-IN', { 
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      doc.fillColor(colors.primaryLight).fontSize(9).font('Helvetica')
        .text(`Generated: ${dateStr}`, pageWidth - 200, 45, { width: 160, align: 'right' });
      if (dateSubtitle) {
        doc.fillColor(colors.white).fontSize(10).font('Helvetica-Bold')
          .text(dateSubtitle, pageWidth - 200, 60, { width: 160, align: 'right' });
      }

      let y = 160;

      // ============ SUMMARY SECTION ============
      doc.fillColor(colors.dark).fontSize(14).font('Helvetica-Bold')
        .text('Revenue Overview', 40, y);
      y += 25;

      // Summary cards - 4 columns
      const cardWidth = (contentWidth - 30) / 4;
      const summaryData = [
        { label: 'Total Revenue', value: formatCurrency(reportData.totalRevenue), color: colors.success },
        { label: 'Total Orders', value: String(reportData.totalOrders || 0), color: colors.secondary },
        { label: 'Items Sold', value: String(reportData.totalItemsSold || 0), color: colors.purple },
        { label: 'Avg Order Value', value: formatCurrency(reportData.avgOrderValue), color: colors.primary }
      ];

      summaryData.forEach((item, i) => {
        drawStatCard(40 + (i * (cardWidth + 10)), y, cardWidth, 55, item.label, item.value, item.color);
      });
      y += 75;

      // ============ ORDER STATUS SECTION ============
      doc.fillColor(colors.dark).fontSize(14).font('Helvetica-Bold')
        .text('Order Statistics', 40, y);
      y += 25;

      // Status cards - 5 columns
      const miniWidth = (contentWidth - 40) / 5;
      const statusData = [
        { label: 'Delivered', value: reportData.deliveredOrders || 0, color: colors.success },
        { label: 'Cancelled', value: reportData.cancelledOrders || 0, color: colors.danger },
        { label: 'Refunded', value: reportData.refundedOrders || 0, color: colors.warning },
        { label: 'COD Orders', value: reportData.codOrders || 0, color: colors.secondary },
        { label: 'UPI Orders', value: reportData.upiOrders || 0, color: colors.purple }
      ];

      statusData.forEach((item, i) => {
        drawMiniStat(40 + (i * (miniWidth + 10)), y, miniWidth, item.label, item.value, item.color);
      });
      y += 70;

      // ============ HELPER: Interest Level ============
      const getInterestLevel = (quantity, allItems) => {
        if (!allItems || allItems.length === 0) return 'low';
        const quantities = allItems.map(i => i.quantity || 0);
        const avgQty = quantities.reduce((a, b) => a + b, 0) / quantities.length;
        if (quantity >= avgQty * 1.5) return 'high';
        if (quantity >= avgQty * 0.5) return 'constant';
        return 'low';
      };

      // ============ HELPER: Draw Premium Table ============
      const drawPremiumTable = (title, emoji, items, startY, allItems, showAll = false) => {
        let currentY = startY;
        const imgSize = 28;
        const rowHeight = 38;
        
        if (currentY > 620) {
          doc.addPage();
          currentY = 50;
        }

        // Section header with emoji
        doc.fillColor(colors.dark).fontSize(13).font('Helvetica-Bold')
          .text(`${emoji}  ${title}`, 40, currentY);
        currentY += 25;

        // Table container
        const tableWidth = contentWidth;
        const colWidths = [35, 40, 130, 55, 60, 45, 70]; // S.No, Image, Name, Rating, Interest, Qty, Revenue
        
        // Table header background
        drawRoundedRect(40, currentY, tableWidth, 28, 6, colors.primary);
        
        // Header text
        doc.fillColor(colors.white).fontSize(8).font('Helvetica-Bold');
        let colX = 48;
        const headers = ['#', 'Image', 'Item Name', 'Rating', 'Interest', 'Qty', 'Revenue'];
        headers.forEach((header, i) => {
          const align = i >= 4 ? 'center' : 'left';
          doc.text(header, colX, currentY + 9, { width: colWidths[i] - 8, align });
          colX += colWidths[i];
        });
        currentY += 32;

        // Table rows
        const itemsToShow = showAll ? items : items.slice(0, 5);
        
        itemsToShow.forEach((item, idx) => {
          if (currentY > 720) {
            doc.addPage();
            currentY = 50;
          }

          // Alternating row background
          const rowBg = idx % 2 === 0 ? colors.white : colors.background;
          const isLast = idx === itemsToShow.length - 1;
          
          if (isLast) {
            drawRoundedRect(40, currentY, tableWidth, rowHeight, 6, rowBg);
          } else {
            doc.rect(40, currentY, tableWidth, rowHeight).fill(rowBg);
          }

          colX = 48;
          const textY = currentY + (rowHeight - 10) / 2;

          // S.No
          doc.fillColor(colors.darkGray).fontSize(9).font('Helvetica-Bold')
            .text(String(idx + 1), colX, textY, { width: colWidths[0] - 8 });
          colX += colWidths[0];

          // Image
          const imgBuffer = imageMap[item.name];
          const imgY = currentY + (rowHeight - imgSize) / 2;
          drawRoundedRect(colX, imgY, imgSize, imgSize, 4, colors.border);
          
          if (imgBuffer) {
            try {
              doc.save();
              doc.roundedRect(colX, imgY, imgSize, imgSize, 4).clip();
              doc.image(imgBuffer, colX, imgY, { cover: [imgSize, imgSize], align: 'center', valign: 'center' });
              doc.restore();
            } catch (e) {}
          }
          colX += colWidths[1];

          // Item Name
          doc.fillColor(colors.dark).fontSize(9).font('Helvetica')
            .text(item.name || '-', colX, textY, { width: colWidths[2] - 8, lineBreak: false });
          colX += colWidths[2];

          // Rating
          if (item.totalRatings > 0) {
            doc.fillColor(colors.warning).fontSize(9).font('Helvetica-Bold')
              .text(`★ ${(item.avgRating || 0).toFixed(1)}`, colX, textY, { width: colWidths[3] - 8 });
          } else {
            doc.fillColor(colors.lightGray).fontSize(9).font('Helvetica')
              .text('No rating', colX, textY, { width: colWidths[3] - 8 });
          }
          colX += colWidths[3];

          // Interest badge
          const interest = getInterestLevel(item.quantity, allItems);
          const interestConfig = {
            high: { color: colors.success, bg: '#dcfce7', label: '↑ High' },
            constant: { color: colors.warning, bg: '#fef3c7', label: '→ Stable' },
            low: { color: colors.danger, bg: '#fee2e2', label: '↓ Low' }
          };
          const { color: intColor, bg: intBg, label: intLabel } = interestConfig[interest];
          
          drawRoundedRect(colX, textY - 3, 48, 16, 8, intBg);
          doc.fillColor(intColor).fontSize(7).font('Helvetica-Bold')
            .text(intLabel, colX + 5, textY, { width: 40 });
          colX += colWidths[4];

          // Quantity
          doc.fillColor(colors.dark).fontSize(9).font('Helvetica-Bold')
            .text(String(item.quantity || 0), colX, textY, { width: colWidths[5] - 8, align: 'center' });
          colX += colWidths[5];

          // Revenue
          doc.fillColor(colors.success).fontSize(9).font('Helvetica-Bold')
            .text(formatCurrency(item.revenue), colX, textY, { width: colWidths[6] - 8, align: 'right' });

          currentY += rowHeight;
        });

        // Table border
        doc.roundedRect(40, startY + 25, tableWidth, currentY - startY - 25, 6).stroke(colors.border);

        return currentY + 20;
      };

      // ============ TOP SELLING ITEMS ============
      if (reportData.topSellingItems && reportData.topSellingItems.length > 0) {
        y = drawPremiumTable('Top Selling Items', '🔥', reportData.topSellingItems, y, reportData.allItemsSold || []);
      }

      // ============ LEAST SELLING ITEMS ============
      if (reportData.leastSellingItems && reportData.leastSellingItems.length > 0) {
        y = drawPremiumTable('Least Selling Items', '📉', reportData.leastSellingItems, y, reportData.allItemsSold || []);
      }

      // ============ ALL ITEMS SOLD ============
      if (reportData.allItemsSold && reportData.allItemsSold.length > 0) {
        doc.addPage();
        y = 50;
        
        // Page header for continuation
        doc.fillColor(colors.primary).fontSize(18).font('Helvetica-Bold')
          .text('Complete Items Report', 40, y);
        doc.fillColor(colors.gray).fontSize(10).font('Helvetica')
          .text(`Total ${reportData.allItemsSold.length} items`, 40, y + 22);
        y += 50;
        
        y = drawPremiumTable('All Items Sold', '📦', reportData.allItemsSold, y, reportData.allItemsSold, true);
      }

      // ============ FOOTER ============
      const addFooter = () => {
        // Footer line
        doc.moveTo(40, pageHeight - 45).lineTo(pageWidth - 40, pageHeight - 45).stroke(colors.border);
        
        // Footer text
        doc.fillColor(colors.lightGray).fontSize(8).font('Helvetica')
          .text('This is a computer-generated report. No signature required.', 40, pageHeight - 35, { 
            width: contentWidth, 
            align: 'center' 
          });
        doc.fillColor(colors.primary).fontSize(8).font('Helvetica-Bold')
          .text('FoodAdmin', 40, pageHeight - 25, { width: contentWidth, align: 'center' });
      };

      // Add footer to all pages
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        addFooter();
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = { generateReportPdf };
