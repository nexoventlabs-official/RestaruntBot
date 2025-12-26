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
    const timeout = setTimeout(() => resolve(null), 5000); // 5s timeout
    
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
  // Pre-fetch images for all items
  const allItems = [
    ...(reportData.topSellingItems || []),
    ...(reportData.leastSellingItems || []),
    ...(reportData.allItemsSold || [])
  ];
  const imageMap = await prefetchImages(allItems);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const primaryColor = '#e63946';
      const darkColor = '#1c1d21';
      const grayColor = '#61636b';
      const rowHeight = 35; // Increased row height for images
      const imgSize = 25; // Image size

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

      let y = 150;

      // Summary Section
      doc.fillColor(darkColor).fontSize(16).font('Helvetica-Bold')
        .text('Summary', 50, y);
      y += 30;

      // Summary boxes
      const summaryData = [
        { label: 'Total Revenue', value: formatCurrency(reportData.totalRevenue) },
        { label: 'Total Orders', value: String(reportData.totalOrders || 0) },
        { label: 'Items Sold', value: String(reportData.totalItemsSold || 0) },
        { label: 'Avg Order Value', value: formatCurrency(reportData.avgOrderValue) }
      ];

      const boxWidth = 120;
      summaryData.forEach((item, i) => {
        const x = 50 + (i * (boxWidth + 15));
        doc.rect(x, y, boxWidth, 60).fillAndStroke('#f8f9fb', '#e2e3e5');
        doc.fillColor(grayColor).fontSize(9).font('Helvetica')
          .text(item.label, x + 10, y + 10, { width: boxWidth - 20 });
        doc.fillColor(darkColor).fontSize(16).font('Helvetica-Bold')
          .text(item.value, x + 10, y + 30, { width: boxWidth - 20 });
      });
      y += 80;

      // Order Status Section
      doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold')
        .text('Order Status Breakdown', 50, y);
      y += 25;

      const statusData = [
        { label: 'Delivered', value: reportData.deliveredOrders || 0, color: '#22c55e' },
        { label: 'Cancelled', value: reportData.cancelledOrders || 0, color: '#ef4444' },
        { label: 'Refunded', value: reportData.refundedOrders || 0, color: '#f97316' },
        { label: 'COD Orders', value: reportData.codOrders || 0, color: '#3b82f6' },
        { label: 'UPI Orders', value: reportData.upiOrders || 0, color: '#8b5cf6' }
      ];

      statusData.forEach((item, i) => {
        const x = 50 + (i * 100);
        doc.fillColor(item.color).fontSize(18).font('Helvetica-Bold')
          .text(String(item.value), x, y);
        doc.fillColor(grayColor).fontSize(9).font('Helvetica')
          .text(item.label, x, y + 20);
      });
      y += 55;

      // Helper function to calculate interest level
      const getInterestLevel = (quantity, allItems) => {
        if (!allItems || allItems.length === 0) return 'low';
        const quantities = allItems.map(i => i.quantity || 0);
        const avgQty = quantities.reduce((a, b) => a + b, 0) / quantities.length;
        
        if (quantity >= avgQty * 1.5) return 'high';
        if (quantity >= avgQty * 0.5) return 'constant';
        return 'low';
      };

      // Helper function to draw item table with images, ratings and interest
      const drawItemTable = (title, items, startY, allItems, showAll = false) => {
        let currentY = startY;
        
        // Check if we need a new page
        if (currentY > 650) {
          doc.addPage();
          currentY = 50;
        }
        
        doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold')
          .text(title, 50, currentY);
        currentY += 20;

        // Table header
        doc.fillColor(grayColor).fontSize(8).font('Helvetica-Bold');
        doc.text('S.No', 50, currentY, { width: 25 });
        doc.text('Image', 75, currentY, { width: 35 });
        doc.text('Item Name', 115, currentY, { width: 120 });
        doc.text('Rating', 240, currentY, { width: 45 });
        doc.text('Interest', 290, currentY, { width: 50 });
        doc.text('Qty', 345, currentY, { width: 35 });
        doc.text('Revenue', 385, currentY, { width: 65 });
        currentY += 15;
        doc.moveTo(50, currentY).lineTo(450, currentY).stroke('#e2e3e5');
        currentY += 5;

        const itemsToShow = showAll ? items : items.slice(0, 5);
        doc.font('Helvetica').fontSize(8);
        itemsToShow.forEach((item, idx) => {
          // Check if we need a new page
          if (currentY > 720) {
            doc.addPage();
            currentY = 50;
          }
          
          const rowY = currentY;
          
          // Draw image if available
          const imgBuffer = imageMap[item.name];
          if (imgBuffer) {
            try {
              // Use cover to ensure all images are exactly the same size (cropped to fit)
              doc.image(imgBuffer, 75, rowY, { 
                width: imgSize, 
                height: imgSize, 
                cover: [imgSize, imgSize],
                align: 'center',
                valign: 'center'
              });
            } catch (e) {
              // Draw placeholder if image fails
              doc.rect(75, rowY, imgSize, imgSize).fillAndStroke('#f0f0f0', '#e0e0e0');
            }
          } else {
            // Draw placeholder box
            doc.rect(75, rowY, imgSize, imgSize).fillAndStroke('#f0f0f0', '#e0e0e0');
          }
          
          // Draw text (vertically centered with image)
          const textY = rowY + (imgSize - 8) / 2;
          doc.fillColor(darkColor).text(String(idx + 1), 50, textY, { width: 25 });
          doc.text(item.name || '-', 115, textY, { width: 120 });
          
          // Rating column
          if (item.totalRatings > 0) {
            doc.fillColor('#f59e0b').text(`${(item.avgRating || 0).toFixed(1)}`, 240, textY, { width: 20 });
            doc.fillColor(grayColor).text(`(${item.totalRatings})`, 260, textY, { width: 25 });
          } else {
            doc.fillColor(grayColor).text('-', 240, textY, { width: 45 });
          }
          
          // Interest column with colored indicator
          const interest = getInterestLevel(item.quantity, allItems);
          const interestConfig = {
            high: { color: '#22c55e', label: 'High' },
            constant: { color: '#eab308', label: 'Stable' },
            low: { color: '#ef4444', label: 'Low' }
          };
          const { color: interestColor, label: interestLabel } = interestConfig[interest];
          doc.fillColor(interestColor).text(interestLabel, 290, textY, { width: 50 });
          
          doc.fillColor(darkColor).text(String(item.quantity || 0), 345, textY, { width: 35 });
          doc.text(formatCurrency(item.revenue), 385, textY, { width: 65 });
          
          currentY += rowHeight;
        });
        
        return currentY + 10;
      };

      // Top Selling Items
      if (reportData.topSellingItems && reportData.topSellingItems.length > 0) {
        y = drawItemTable('Top Selling Items', reportData.topSellingItems, y, reportData.allItemsSold || []);
      }

      // Least Selling Items
      if (reportData.leastSellingItems && reportData.leastSellingItems.length > 0) {
        y = drawItemTable('Least Selling Items', reportData.leastSellingItems, y, reportData.allItemsSold || []);
      }

      // All Items Sold - show ALL items
      if (reportData.allItemsSold && reportData.allItemsSold.length > 0) {
        doc.addPage();
        y = 50;
        y = drawItemTable('All Items Sold', reportData.allItemsSold, y, reportData.allItemsSold, true);
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
