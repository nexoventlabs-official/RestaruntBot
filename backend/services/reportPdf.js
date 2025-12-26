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
  primary: '#4f46e5',
  primaryLight: '#818cf8',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  info: '#0284c7',
  purple: '#7c3aed',
  dark: '#1e293b',
  gray: '#64748b',
  lightGray: '#94a3b8',
  border: '#e2e8f0',
  bgLight: '#f8fafc',
  white: '#ffffff'
};

const formatCurrency = (val) => `Rs. ${(val || 0).toLocaleString('en-IN')}`;

const fetchImageBuffer = (url) => {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const protocol = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => resolve(null), 5000);
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) { clearTimeout(timeout); resolve(null); return; }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { clearTimeout(timeout); resolve(Buffer.concat(chunks)); });
      res.on('error', () => { clearTimeout(timeout); resolve(null); });
    }).on('error', () => { clearTimeout(timeout); resolve(null); });
  });
};

const prefetchImages = async (items) => {
  const imageMap = {};
  await Promise.all(items.map(async (item) => {
    if (item.image) {
      const buffer = await fetchImageBuffer(item.image);
      if (buffer) imageMap[item.name] = buffer;
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
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks = [];
      const pageWidth = doc.page.width;
      const contentWidth = pageWidth - 100;

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const rowHeight = 36;
      const imgSize = 26;

      // ========== HEADER ==========
      doc.rect(0, 0, pageWidth, 130).fill(colors.primary);
      
      // Brand
      doc.fillColor(colors.white).fontSize(28).font('Helvetica-Bold').text('FoodAdmin', 50, 40);
      doc.fillColor(colors.primaryLight).fontSize(11).font('Helvetica').text('Restaurant Management System', 50, 72);

      // Report info
      const formatDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      let reportTitle = REPORT_TYPE_LABELS[reportType] || 'Report';
      let dateRange = '';
      
      if (reportData.dateRange) {
        const from = formatDate(reportData.dateRange.start);
        const to = formatDate(reportData.dateRange.end);
        dateRange = reportType === 'today' ? from : `${from} - ${to}`;
      }

      // Report badge
      doc.rect(50, 95, 160, 24).fill(colors.white);
      doc.fillColor(colors.primary).fontSize(11).font('Helvetica-Bold').text(reportTitle, 60, 101);

      // Date on right
      const genDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
      doc.fillColor(colors.primaryLight).fontSize(9).font('Helvetica')
        .text(`Generated: ${genDate}`, pageWidth - 200, 45, { width: 150, align: 'right' });
      if (dateRange) {
        doc.fillColor(colors.white).fontSize(10).font('Helvetica-Bold')
          .text(dateRange, pageWidth - 200, 62, { width: 150, align: 'right' });
      }

      let y = 150;

      // ========== SUMMARY SECTION ==========
      doc.fillColor(colors.dark).fontSize(14).font('Helvetica-Bold').text('Revenue Overview', 50, y);
      y += 25;

      const cardW = (contentWidth - 30) / 4;
      const summaryCards = [
        { label: 'Total Revenue', value: formatCurrency(reportData.totalRevenue), color: colors.success },
        { label: 'Total Orders', value: String(reportData.totalOrders || 0), color: colors.info },
        { label: 'Items Sold', value: String(reportData.totalItemsSold || 0), color: colors.purple },
        { label: 'Avg Order Value', value: formatCurrency(reportData.avgOrderValue), color: colors.primary }
      ];

      summaryCards.forEach((card, i) => {
        const x = 50 + i * (cardW + 10);
        doc.rect(x, y, cardW, 55).fill(colors.white);
        doc.rect(x, y, 4, 55).fill(card.color);
        doc.fillColor(colors.dark).fontSize(16).font('Helvetica-Bold').text(card.value, x + 14, y + 12, { width: cardW - 20 });
        doc.fillColor(colors.gray).fontSize(9).font('Helvetica').text(card.label, x + 14, y + 35, { width: cardW - 20 });
      });
      y += 75;

      // ========== ORDER STATS ==========
      doc.fillColor(colors.dark).fontSize(14).font('Helvetica-Bold').text('Order Statistics', 50, y);
      y += 25;

      const miniW = (contentWidth - 40) / 5;
      const orderStats = [
        { label: 'Delivered', value: reportData.deliveredOrders || 0, color: colors.success },
        { label: 'Cancelled', value: reportData.cancelledOrders || 0, color: colors.danger },
        { label: 'Refunded', value: reportData.refundedOrders || 0, color: colors.warning },
        { label: 'COD Orders', value: reportData.codOrders || 0, color: colors.info },
        { label: 'UPI Orders', value: reportData.upiOrders || 0, color: colors.purple }
      ];

      orderStats.forEach((stat, i) => {
        const x = 50 + i * (miniW + 10);
        doc.rect(x, y, miniW, 48).fill(colors.white);
        doc.fillColor(stat.color).fontSize(18).font('Helvetica-Bold').text(String(stat.value), x + 10, y + 10, { width: miniW - 20 });
        doc.fillColor(colors.gray).fontSize(8).font('Helvetica').text(stat.label, x + 10, y + 32, { width: miniW - 20 });
      });
      y += 68;

      // ========== INTEREST HELPER ==========
      const getInterest = (qty, items) => {
        if (!items || items.length === 0) return 'low';
        const avg = items.reduce((s, i) => s + (i.quantity || 0), 0) / items.length;
        if (qty >= avg * 1.5) return 'high';
        if (qty >= avg * 0.5) return 'stable';
        return 'low';
      };

      // ========== TABLE HELPER ==========
      const drawTable = (title, icon, items, startY, allItems, showAll = false) => {
        let cy = startY;
        
        if (cy > 620) { doc.addPage(); cy = 50; }

        // Title
        doc.fillColor(colors.dark).fontSize(13).font('Helvetica-Bold').text(`${icon} ${title}`, 50, cy);
        cy += 22;

        const tableW = contentWidth;
        const cols = [30, 38, 125, 55, 55, 40, 70];

        // Header
        doc.rect(50, cy, tableW, 26).fill(colors.primary);
        doc.fillColor(colors.white).fontSize(8).font('Helvetica-Bold');
        let cx = 55;
        ['#', 'Image', 'Item Name', 'Rating', 'Interest', 'Qty', 'Revenue'].forEach((h, i) => {
          doc.text(h, cx, cy + 8, { width: cols[i] - 5 });
          cx += cols[i];
        });
        cy += 30;

        const itemsToShow = showAll ? items : items.slice(0, 5);
        
        itemsToShow.forEach((item, idx) => {
          if (cy > 720) { doc.addPage(); cy = 50; }

          // Row bg
          doc.rect(50, cy, tableW, rowHeight).fill(idx % 2 === 0 ? colors.white : colors.bgLight);

          cx = 55;
          const textY = cy + 12;

          // S.No
          doc.fillColor(colors.gray).fontSize(9).font('Helvetica-Bold').text(String(idx + 1), cx, textY, { width: cols[0] - 5 });
          cx += cols[0];

          // Image
          const imgY = cy + (rowHeight - imgSize) / 2;
          doc.rect(cx, imgY, imgSize, imgSize).fill(colors.border);
          const imgBuf = imageMap[item.name];
          if (imgBuf) {
            try {
              doc.save();
              doc.rect(cx, imgY, imgSize, imgSize).clip();
              doc.image(imgBuf, cx, imgY, { cover: [imgSize, imgSize] });
              doc.restore();
            } catch (e) {}
          }
          cx += cols[1];

          // Name
          doc.fillColor(colors.dark).fontSize(9).font('Helvetica').text(item.name || '-', cx, textY, { width: cols[2] - 5, lineBreak: false });
          cx += cols[2];

          // Rating
          if (item.totalRatings > 0) {
            doc.fillColor(colors.warning).fontSize(9).font('Helvetica-Bold').text(`* ${(item.avgRating || 0).toFixed(1)}`, cx, textY, { width: cols[3] - 5 });
          } else {
            doc.fillColor(colors.lightGray).fontSize(8).font('Helvetica').text('No rating', cx, textY, { width: cols[3] - 5 });
          }
          cx += cols[3];

          // Interest
          const interest = getInterest(item.quantity, allItems);
          const intConf = {
            high: { color: colors.success, label: 'High' },
            stable: { color: colors.warning, label: 'Stable' },
            low: { color: colors.danger, label: 'Low' }
          };
          doc.fillColor(intConf[interest].color).fontSize(8).font('Helvetica-Bold').text(intConf[interest].label, cx, textY, { width: cols[4] - 5 });
          cx += cols[4];

          // Qty
          doc.fillColor(colors.dark).fontSize(9).font('Helvetica-Bold').text(String(item.quantity || 0), cx, textY, { width: cols[5] - 5 });
          cx += cols[5];

          // Revenue
          doc.fillColor(colors.success).fontSize(9).font('Helvetica-Bold').text(formatCurrency(item.revenue), cx, textY, { width: cols[6] - 5 });

          cy += rowHeight;
        });

        return cy + 15;
      };

      // ========== TABLES ==========
      if (reportData.topSellingItems?.length > 0) {
        y = drawTable('Top Selling Items', '[TOP]', reportData.topSellingItems, y, reportData.allItemsSold || []);
      }

      if (reportData.leastSellingItems?.length > 0) {
        y = drawTable('Least Selling Items', '[LOW]', reportData.leastSellingItems, y, reportData.allItemsSold || []);
      }

      if (reportData.allItemsSold?.length > 0) {
        doc.addPage();
        doc.fillColor(colors.primary).fontSize(16).font('Helvetica-Bold').text('Complete Items Report', 50, 50);
        doc.fillColor(colors.gray).fontSize(10).font('Helvetica').text(`Total ${reportData.allItemsSold.length} items`, 50, 70);
        y = drawTable('All Items Sold', '[ALL]', reportData.allItemsSold, 95, reportData.allItemsSold, true);
      }

      // ========== FOOTER ==========
      doc.fillColor(colors.lightGray).fontSize(8).font('Helvetica')
        .text('This is a computer-generated report. No signature required.', 50, doc.page.height - 40, { width: contentWidth, align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = { generateReportPdf };
