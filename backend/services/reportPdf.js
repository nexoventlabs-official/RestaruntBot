const PDFDocument = require('pdfkit');

const REPORT_TYPE_LABELS = {
  today: "Today's Report",
  weekly: 'Weekly Report',
  monthly: 'Monthly Report',
  yearly: 'Annual Report',
  custom: 'Custom Range Report'
};

const generateReportPdf = (reportData, reportType) => {
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

      // Header
      doc.rect(0, 0, doc.page.width, 120).fill(primaryColor);
      doc.fillColor('white').fontSize(28).font('Helvetica-Bold')
        .text('FoodAdmin', 50, 40);
      doc.fontSize(12).font('Helvetica')
        .text('Restaurant Management System', 50, 75);
      doc.fontSize(16).font('Helvetica-Bold')
        .text(REPORT_TYPE_LABELS[reportType] || 'Report', 50, 95);

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
        { label: 'Total Revenue', value: `₹${(reportData.totalRevenue || 0).toLocaleString()}` },
        { label: 'Total Orders', value: String(reportData.totalOrders || 0) },
        { label: 'Items Sold', value: String(reportData.totalItemsSold || 0) },
        { label: 'Avg Order Value', value: `₹${(reportData.avgOrderValue || 0).toLocaleString()}` }
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

      // Top Selling Items
      if (reportData.topSellingItems && reportData.topSellingItems.length > 0) {
        doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold')
          .text('Top Selling Items', 50, y);
        y += 20;

        // Table header
        doc.fillColor(grayColor).fontSize(9).font('Helvetica-Bold');
        doc.text('Item Name', 50, y, { width: 200 });
        doc.text('Qty', 260, y, { width: 50 });
        doc.text('Revenue', 320, y, { width: 80 });
        y += 15;
        doc.moveTo(50, y).lineTo(400, y).stroke('#e2e3e5');
        y += 5;

        doc.font('Helvetica').fontSize(9);
        reportData.topSellingItems.slice(0, 10).forEach(item => {
          doc.fillColor(darkColor).text(item.name || '-', 50, y, { width: 200 });
          doc.text(String(item.quantity || 0), 260, y, { width: 50 });
          doc.text(`₹${(item.revenue || 0).toLocaleString()}`, 320, y, { width: 80 });
          y += 15;
        });
        y += 10;
      }

      // Revenue by Category
      if (reportData.revenueByCategory && reportData.revenueByCategory.length > 0 && y < 650) {
        doc.fillColor(darkColor).fontSize(14).font('Helvetica-Bold')
          .text('Revenue by Category', 50, y);
        y += 20;

        doc.fillColor(grayColor).fontSize(9).font('Helvetica-Bold');
        doc.text('Category', 50, y, { width: 200 });
        doc.text('Qty', 260, y, { width: 50 });
        doc.text('Revenue', 320, y, { width: 80 });
        y += 15;
        doc.moveTo(50, y).lineTo(400, y).stroke('#e2e3e5');
        y += 5;

        doc.font('Helvetica').fontSize(9);
        reportData.revenueByCategory.slice(0, 8).forEach(cat => {
          doc.fillColor(darkColor).text(cat.category || 'Uncategorized', 50, y, { width: 200 });
          doc.text(String(cat.quantity || 0), 260, y, { width: 50 });
          doc.text(`₹${(cat.revenue || 0).toLocaleString()}`, 320, y, { width: 80 });
          y += 15;
        });
      }

      // Footer
      doc.fillColor(grayColor).fontSize(8).font('Helvetica')
        .text('This is a computer-generated report. No signature required.', 50, doc.page.height - 50, { align: 'center', width: doc.page.width - 100 });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = { generateReportPdf };
