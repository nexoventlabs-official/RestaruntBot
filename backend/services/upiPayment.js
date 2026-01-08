// UPI Payment Service - Direct UPI Payment

// Get UPI config from environment variables
const UPI_ID = process.env.UPI_ID || 'gokrishna98@okaxis';
const MERCHANT_NAME = process.env.UPI_MERCHANT_NAME || 'FoodAdmin';
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://restarunt-bot.vercel.app';

const upiPayment = {
  // Generate payment page URL (redirects to UPI app)
  // This creates a web page that auto-redirects to UPI intent
  generatePaymentPageUrl(amount, orderId) {
    // URL to your payment redirect page
    const params = new URLSearchParams({
      pa: UPI_ID,
      pn: MERCHANT_NAME,
      am: amount.toFixed(2),
      tn: `Order_${orderId}`,
      tr: orderId,
      cu: 'INR'
    });
    
    return `${WEBSITE_URL}/pay?${params.toString()}`;
  },

  // Generate UPI deep link URL (for QR codes)
  generateUpiLink(amount, orderId) {
    const params = new URLSearchParams({
      pa: UPI_ID,
      pn: MERCHANT_NAME,
      am: amount.toFixed(2),
      cu: 'INR',
      tn: `Order_${orderId}`,
      tr: orderId
    });
    
    return `upi://pay?${params.toString()}`;
  },

  // Generate QR code URL for UPI payment
  generateQrCodeUrl(amount, orderId) {
    const upiLink = this.generateUpiLink(amount, orderId);
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiLink)}`;
  },

  // Validate UPI transaction ID format
  // Common formats: 12-digit number, alphanumeric with bank codes
  isValidTransactionIdFormat(transactionId) {
    if (!transactionId || typeof transactionId !== 'string') return false;
    
    // Clean the transaction ID
    const cleanId = transactionId.trim().toUpperCase();
    
    // Common UPI transaction ID patterns:
    // 1. 12-digit numeric (most common)
    // 2. Alphanumeric with bank codes (e.g., 123456789012, HDFC123456789012)
    // 3. UTR format (e.g., 123456789012)
    
    // At least 10 characters, alphanumeric
    if (cleanId.length < 10) return false;
    if (!/^[A-Z0-9]+$/.test(cleanId)) return false;
    
    return true;
  },

  // Use Groq AI to analyze transaction ID from text
  async analyzeTransactionId(text, expectedAmount, orderId) {
    try {
      const Groq = require('groq-sdk');
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      
      const completion = await groq.chat.completions.create({
        messages: [{
          role: 'system',
          content: `You are a UPI transaction ID validator. Extract and validate UPI transaction IDs from user messages.

RULES:
1. Extract any transaction ID, UTR number, or reference number from the text
2. UPI transaction IDs are typically 12-digit numbers or alphanumeric codes
3. Common formats: 123456789012, UTR123456789012, HDFC123456789012
4. Return ONLY a JSON object, no other text

Expected Order: ${orderId}
Expected Amount: ₹${expectedAmount}

RESPONSE FORMAT (JSON only):
{
  "found": true/false,
  "transactionId": "extracted_id_or_null",
  "isValid": true/false,
  "confidence": "high/medium/low",
  "reason": "brief explanation"
}`
        }, {
          role: 'user',
          content: `Analyze this message for UPI transaction ID: "${text}"`
        }],
        model: 'llama-3.1-8b-instant',
        max_tokens: 200,
        temperature: 0.1
      });
      
      const response = completion.choices[0]?.message?.content?.trim() || '';
      
      // Try to parse JSON response
      try {
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr);
      }
      
      // Fallback: try to extract transaction ID manually
      const idMatch = text.match(/\b(\d{12,})\b/) || text.match(/\b([A-Z0-9]{12,})\b/i);
      if (idMatch) {
        return {
          found: true,
          transactionId: idMatch[1].toUpperCase(),
          isValid: true,
          confidence: 'medium',
          reason: 'Extracted numeric/alphanumeric ID from text'
        };
      }
      
      return {
        found: false,
        transactionId: null,
        isValid: false,
        confidence: 'low',
        reason: 'Could not find valid transaction ID in message'
      };
    } catch (error) {
      console.error('Groq AI transaction analysis error:', error.message);
      
      // Fallback extraction
      const idMatch = text.match(/\b(\d{12,})\b/) || text.match(/\b([A-Z0-9]{12,})\b/i);
      if (idMatch) {
        return {
          found: true,
          transactionId: idMatch[1].toUpperCase(),
          isValid: true,
          confidence: 'low',
          reason: 'Fallback extraction'
        };
      }
      
      return {
        found: false,
        transactionId: null,
        isValid: false,
        confidence: 'low',
        reason: 'Analysis failed'
      };
    }
  },

  // Analyze screenshot for transaction ID using Groq Vision
  async analyzeScreenshot(imageBuffer, expectedAmount, orderId) {
    try {
      const Groq = require('groq-sdk');
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      
      // Convert buffer to base64
      const base64Image = imageBuffer.toString('base64');
      const mimeType = 'image/jpeg'; // Assume JPEG, WhatsApp typically sends JPEG
      
      const completion = await groq.chat.completions.create({
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this UPI payment screenshot. Extract the transaction ID/UTR number and verify the payment details.

Expected Order: ${orderId}
Expected Amount: ₹${expectedAmount}
Expected UPI ID: ${UPI_ID}

Look for:
1. Transaction ID / UTR / Reference Number (usually 12+ digit number)
2. Payment amount
3. Recipient UPI ID or name
4. Payment status (Success/Failed/Pending)

RESPOND ONLY WITH JSON:
{
  "found": true/false,
  "transactionId": "extracted_id_or_null",
  "amount": extracted_amount_or_null,
  "recipientUpi": "extracted_upi_or_null",
  "status": "success/failed/pending/unknown",
  "isValid": true/false,
  "confidence": "high/medium/low",
  "reason": "brief explanation"
}`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }],
        model: 'llama-3.2-90b-vision-preview',
        max_tokens: 300,
        temperature: 0.1
      });
      
      const response = completion.choices[0]?.message?.content?.trim() || '';
      console.log('🖼️ Screenshot analysis response:', response);
      
      // Try to parse JSON response
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          
          // Additional validation
          if (result.found && result.transactionId) {
            // Check if amount matches (with some tolerance)
            if (result.amount && Math.abs(result.amount - expectedAmount) > 1) {
              result.isValid = false;
              result.reason = `Amount mismatch: Expected ₹${expectedAmount}, found ₹${result.amount}`;
            }
            
            // Check if UPI ID matches
            if (result.recipientUpi && !result.recipientUpi.includes(UPI_ID.split('@')[0])) {
              result.isValid = false;
              result.reason = `UPI ID mismatch: Expected ${UPI_ID}`;
            }
          }
          
          return result;
        }
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr);
      }
      
      return {
        found: false,
        transactionId: null,
        isValid: false,
        confidence: 'low',
        reason: 'Could not analyze screenshot'
      };
    } catch (error) {
      console.error('Screenshot analysis error:', error.message);
      return {
        found: false,
        transactionId: null,
        isValid: false,
        confidence: 'low',
        reason: 'Screenshot analysis failed: ' + error.message
      };
    }
  },

  // Get UPI ID for display
  getUpiId() {
    return UPI_ID;
  },

  // Get merchant name
  getMerchantName() {
    return MERCHANT_NAME;
  }
};

module.exports = upiPayment;
