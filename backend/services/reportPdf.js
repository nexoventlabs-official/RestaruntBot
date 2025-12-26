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

// Fetch image from URL and return as buffer with redirect support
const fetchImageBuffer = (url, redirectCount = 0) => {
  return new Promise((resolve) => {
    if (!url || redirectCount > 5) {
      resolve(null);
      return;
    }
    
    const protocol = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => resolve(null), 10000); // 10s timeout
    
    protocol.get(url, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        resolve(fetchImageBuffer(res.headers.location, redirectCount + 1));
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
        const buffer = Buffer.concat(chunks);
        // Verify it's a valid image (check for common image headers)
        if (buffer.length > 0) {
          resolve(buffer);
        } else {
          resolve(null);
        }
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

// Pre-fetch all images for items using unique identifier
const prefetchImages = async (items) => {
  const imageMap = {};
  const promises = items.map(async (item, index) => {
    if (item.image) {
      const buffer = await fetchImageBuffer(item.image);
      if (buffer) {
        // Use combination of name and index for unique key
        const key = `${item.name}_${item._id || index}`;
        imageMap[key] = buffer;
        // Also store by name for backward compatibility
        if (!imageMap[item.name]) {
          imageMap[item.name] = buffer;
        }
      }
    }
  });
  await Promise.all(promises);
  return imageMap;
};

const generateReportPdf = async (reportData, reportType) => {
  // Ensure items arrays exist and have data
  const topSellingItems = reportData.topSellingItems || [];
  const leastSellingItems = reportData.leastSellingItems || [];
  const allItemsSold = reportData.allItemsSold || [];
  
  // Pre-fetch images for all items
  const allItems = [...topSellingItems, ...leastSellingItems, ...allItemsSold];
  const imageMap = await prefetchImages(allItems);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const primaryColor = '#e63946';
      const darkColor = '#1c1d21';
      const grayColor = '#61636b';
      const lightGray = '#f8f9fb';
      const borderColor = '#e5e7eb';
      const greenColor = '#22c55e';
      const redColor = '#ef4444';
      const yellowColor = '#eab308';
      
      // Match admin panel image size: 40x40px
      const imgSize = 40;
      const rowHeight = 50; // Increased for larger images
      const pageWidth = doc.page.width - 80; // Account for margins

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

      // Summary Section - matching admin panel StatCard style
      doc.fillColor(darkColor).fontSize(16).font('Helvetica-Bold')
        .text('Summary', 40, y);
      y += 30;

      // Summary boxes - matching admin panel card style with colored icons
      const summaryData = [
        { label: 'Total Revenue', value: formatCurrency(reportData.totalRevenue), color: greenColor },
        { label: 'Total Orders', value: String(reportData.totalOrders || 0), color: '#3b82f6' },
        { label: 'Items Sold', value: String(reportData.totalItemsSold || 0), color: '#f97316' },
        { label: 'Avg Order Value', value: formatCurrency(reportData.avgOrderValue), color: primaryColor }
      ];

      const boxWidth = 125;
      const boxHeight = 70;
      summaryData.forEach((item, i) => {
        const x = 40 + (i * (boxWidth + 10));
        // Card background with subtle shadow effect
        doc.rect(x, y, boxWidth, boxHeight).fill('white');
        doc.rect(x, y, boxWidth, boxHeight).stroke(borderColor);
        
        // Colored icon circle
        doc.circle(x + 20, y + 20, 12).fill(item.color + '20'); // Light version of color
        doc.fillColor(item.color).fontSize(12).font('Helvetica-Bold')
          .text('$', x + 15, y + 14);
        
        // Value
        doc.fillColor(darkColor).fontSize(18).font('Helvetica-Bold')
          .text(item.value, x + 10, y + 38, { width: boxWidth - 20 });
        // Label
        doc.fillColor(grayColor).fontSize(9).font('Helvetica')
          .text(item.label, x + 10, y + 55, { width: boxWidth - 20 });
      });
      y += boxHeight + 20;

      // Order Status Section - matching admin panel style
      doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold')
        .text('Order Status Breakdown', 40, y);
      y += 25;

      const statusData = [
        { label: 'Delivered', value: reportData.deliveredOrders || 0, color: greenColor },
        { label: 'Cancelled', value: reportData.cancelledOrders || 0, color: redColor },
        { label: 'Refunded', value: reportData.refundedOrders || 0, color: '#f97316' },
        { label: 'COD Orders', value: reportData.codOrders || 0, color: '#3b82f6' },
        { label: 'UPI Orders', value: reportData.upiOrders || 0, color: primaryColor }
      ];

      const statusBoxWidth = 100;
      const statusBoxHeight = 60;
      statusData.forEach((item, i) => {
        const x = 40 + (i * (statusBoxWidth + 8));
        // Card background
        doc.rect(x, y, statusBoxWidth, statusBoxHeight).fill('white');
        doc.rect(x, y, statusBoxWidth, statusBoxHeight).stroke(borderColor);
        
        // Colored icon circle
        doc.circle(x + 18, y + 18, 10).fill(item.color + '20');
        
        // Value
        doc.fillColor(darkColor).fontSize(20).font('Helvetica-Bold')
          .text(String(item.value), x + 10, y + 32, { width: statusBoxWidth - 20 });
        // Label
        doc.fillColor(grayColor).fontSize(8).font('Helvetica')
          .text(item.label, x + 10, y + 48, { width: statusBoxWidth - 20 });
      });
      y += statusBoxHeight + 25;

      // Helper function to calculate interest level
      const getInterestLevel = (quantity, items) => {
        if (!items || items.length === 0) return 'low';
        const quantities = items.map(i => i.quantity || 0);
        const avgQty = quantities.reduce((a, b) => a + b, 0) / quantities.length;
        
        if (quantity >= avgQty * 1.5) return 'high';
        if (quantity >= avgQty * 0.5) return 'constant';
        return 'low';
      };

      // Helper function to draw rounded rectangle (for images)
      const drawRoundedRect = (x, y, width, height, radius, fillColor, strokeColor) => {
        doc.save();
        doc.roundedRect(x, y, width, height, radius);
        if (fillColor) {
          doc.fillColor(fillColor).fill();
        }
        if (strokeColor) {
          doc.strokeColor(strokeColor).stroke();
        }
        doc.restore();
      };

      // Helper function to draw item table matching admin panel style
      const drawItemTable = (title, emoji, items, startY, referenceItems, showAll = false) => {
        let currentY = startY;
        
        // Check if we need a new page
        if (currentY > 680) {
          doc.addPage();
          currentY = 50;
        }
        
        // Title with emoji
        doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold')
          .text(`${emoji} ${title}`, 40, currentY);
        currentY += 30;

        // Table header - matching admin panel bg-dark-50 style
        const headerHeight = 35;
        doc.rect(40, currentY, pageWidth, headerHeight).fill(lightGray);
        doc.rect(40, currentY, pageWidth, headerHeight).stroke(borderColor);
        
        // Column positions matching admin panel proportions
        const col = {
          sno: 50,
          image: 90,
          name: 145,
          rating: 290,
          interest: 360,
          qty: 430,
          revenue: 480
        };
        
        doc.fillColor(grayColor).fontSize(9).font('Helvetica-Bold');
        const headerY = currentY + 12;
        doc.text('S.No', col.sno, headerY, { width: 35 });
        doc.text('Image', col.image, headerY, { width: 45 });
        doc.text('Item Name', col.name, headerY, { width: 140 });
        doc.text('Rating', col.rating, headerY, { width: 60 });
        doc.text('Interest', col.interest, headerY, { width: 60 });
        doc.text('Qty', col.qty, headerY, { width: 40 });
        doc.text('Revenue', col.revenue, headerY, { width: 70 });
        currentY += headerHeight;

        // Table rows
        const itemsToShow = showAll ? items : items.slice(0, 5);
        
        if (itemsToShow.length === 0) {
          // No data row
          doc.rect(40, currentY, pageWidth, rowHeight).fill('white');
          doc.rect(40, currentY, pageWidth, rowHeight).stroke(borderColor);
          doc.fillColor(grayColor).fontSize(10).font('Helvetica')
            .text('No data available', 40, currentY + 18, { width: pageWidth, align: 'center' });
          currentY += rowHeight;
        } else {
          itemsToShow.forEach((item, idx) => {
            // Check if we need a new page
            if (currentY > 720) {
              doc.addPage();
              currentY = 50;
              
              // Redraw header on new page
              doc.rect(40, currentY, pageWidth, headerHeight).fill(lightGray);
              doc.rect(40, currentY, pageWidth, headerHeight).stroke(borderColor);
              doc.fillColor(grayColor).fontSize(9).font('Helvetica-Bold');
              const newHeaderY = currentY + 12;
              doc.text('S.No', col.sno, newHeaderY, { width: 35 });
              doc.text('Image', col.image, newHeaderY, { width: 45 });
              doc.text('Item Name', col.name, newHeaderY, { width: 140 });
              doc.text('Rating', col.rating, newHeaderY, { width: 60 });
              doc.text('Interest', col.interest, newHeaderY, { width: 60 });
              doc.text('Qty', col.qty, newHeaderY, { width: 40 });
              doc.text('Revenue', col.revenue, newHeaderY, { width: 70 });
              currentY += headerHeight;
            }
            
            const rowY = currentY;
            
            // Alternating row background (white/light gray for hover effect simulation)
            doc.rect(40, rowY, pageWidth, rowHeight).fill('white');
            doc.rect(40, rowY, pageWidth, rowHeight).stroke(borderColor);
            
            // Draw image - 40x40 with rounded corners matching admin panel
            const imgX = col.image;
            const imgY = rowY + (rowHeight - imgSize) / 2;
            const imgBuffer = imageMap[item.name];
            
            if (imgBuffer) {
              try {
                // Save state for clipping
                doc.save();
                // Create rounded clipping path
                doc.roundedRect(imgX, imgY, imgSize, imgSize, 6).clip();
                // Draw image to fill the clipped area (object-cover effect)
                doc.image(imgBuffer, imgX, imgY, { 
                  width: imgSize, 
                  height: imgSize,
                  fit: [imgSize, imgSize],
                  align: 'center',
                  valign: 'center'
                });
                doc.restore();
                // Draw border around image
                doc.roundedRect(imgX, imgY, imgSize, imgSize, 6).stroke(borderColor);
              } catch (e) {
                // Draw placeholder if image fails
                drawRoundedRect(imgX, imgY, imgSize, imgSize, 6, lightGray, borderColor);
              }
            } else {
              // Draw placeholder box matching admin panel style
              drawRoundedRect(imgX, imgY, imgSize, imgSize, 6, lightGray, borderColor);
            }
            
            // Text content - vertically centered
            const textY = rowY + (rowHeight - 10) / 2;
            
            // S.No
            doc.fillColor(grayColor).fontSize(10).font('Helvetica')
              .text(String(idx + 1), col.sno, textY, { width: 35 });
            
            // Item Name
            doc.fillColor(darkColor).fontSize(10).font('Helvetica')
              .text(item.name || '-', col.name, textY, { width: 140 });
            
            // Rating with star
            if (item.totalRatings > 0) {
              doc.fillColor('#f59e0b').fontSize(10).font('Helvetica')
                .text('★', col.rating, textY, { width: 12 });
              doc.fillColor(darkColor)
                .text(`${(item.avgRating || 0).toFixed(1)}`, col.rating + 12, textY, { width: 25 });
              doc.fillColor(grayColor).fontSize(8)
                .text(`(${item.totalRatings})`, col.rating + 38, textY + 1, { width: 25 });
            } else {
              doc.fillColor(grayColor).fontSize(10).font('Helvetica')
                .text('-', col.rating, textY, { width: 60 });
            }
            
            // Interest badge with arrow and colored text
            const interest = getInterestLevel(item.quantity, referenceItems);
            const interestConfig = {
              high: { arrow: '↗', color: greenColor, label: 'High' },
              constant: { arrow: '→', color: yellowColor, label: 'Stable' },
              low: { arrow: '↘', color: redColor, label: 'Low' }
            };
            const { arrow, color: interestColor, label: interestLabel } = interestConfig[interest];
            doc.fillColor(interestColor).fontSize(10).font('Helvetica')
              .text(`${arrow} ${interestLabel}`, col.interest, textY, { width: 60 });
            
            // Quantity
            doc.fillColor(darkColor).fontSize(10).font('Helvetica')
              .text(String(item.quantity || 0), col.qty, textY, { width: 40 });
            
            // Revenue
            doc.fillColor(darkColor).fontSize(10).font('Helvetica')
              .text(formatCurrency(item.revenue), col.revenue, textY, { width: 70 });
            
            currentY += rowHeight;
          });
        }
        
        return currentY + 15;
      };

      // Top Selling Items
      if (topSellingItems.length > 0) {
        y = drawItemTable('Top Selling Items', '🔥', topSellingItems, y, allItemsSold);
      }

      // Least Selling Items
      if (leastSellingItems.length > 0) {
        y = drawItemTable('Least Selling Items', '📉', leastSellingItems, y, allItemsSold);
      }

      // All Items Sold - show ALL items
      if (allItemsSold.length > 0) {
        doc.addPage();
        y = 50;
        y = drawItemTable('All Items Sold', '📦', allItemsSold, y, allItemsSold, true);
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
