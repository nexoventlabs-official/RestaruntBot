const Customer = require('../models/Customer');
const MenuItem = require('../models/MenuItem');
const Category = require('../models/Category');
const Order = require('../models/Order');
const whatsapp = require('./whatsapp');
const razorpayService = require('./razorpay');
const googleSheets = require('./googleSheets');
const groqAi = require('./groqAi');
const axios = require('axios');

const generateOrderId = () => 'ORD' + Date.now().toString(36).toUpperCase();

const chatbot = {
  // Helper to detect cancel order intent from text/voice
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  isCancelIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const cancelPatterns = [
      // English
      /\bcancel\b/, /\bcancel order\b/, /\bcancel my order\b/, /\bcancel item\b/,
      /\bremove order\b/, /\bstop order\b/, /\bdon'?t want\b/, /\bdont want\b/, /\bno need\b/,
      // Hindi
      /\bcancel karo\b/, /\bcancel kar do\b/, /\border cancel\b/, /\bcancel करो\b/,
      /\bऑर्डर कैंसल\b/, /\bकैंसल\b/, /\bरद्द करो\b/, /\bरद्द कर दो\b/,
      // Telugu
      /\bcancel cheyyi\b/, /\bcancel cheyyandi\b/, /\border cancel cheyyi\b/,
      /\bక్యాన్సల్\b/, /\bఆర్డర్ క్యాన్సల్\b/, /\bరద్దు చేయండి\b/, /\bరద్దు\b/,
      // Tamil
      /\bcancel pannunga\b/, /\bcancel pannu\b/, /\border cancel\b/,
      /\bகேன்சல்\b/, /\bஆர்டர் கேன்சல்\b/, /\bரத்து செய்\b/, /\bரத்து\b/,
      // Kannada
      /\bcancel maadi\b/, /\border cancel maadi\b/,
      /\bಕ್ಯಾನ್ಸಲ್\b/, /\bಆರ್ಡರ್ ಕ್ಯಾನ್ಸಲ್\b/, /\bರದ್ದು\b/,
      // Malayalam
      /\bcancel cheyyuka\b/, /\bക്യാൻസൽ\b/, /\bഓർഡർ ക്യാൻസൽ\b/, /\bറദ്ദാക്കുക\b/,
      // Bengali
      /\bcancel koro\b/, /\bক্যান্সেল\b/, /\bঅর্ডার ক্যান্সেল\b/, /\bবাতিল করো\b/,
      // Marathi
      /\bcancel kara\b/, /\bकॅन्सल करा\b/, /\bऑर्डर कॅन्सल\b/, /\bरद्द करा\b/,
      // Gujarati
      /\bcancel karo\b/, /\bકેન્સલ\b/, /\bઓર્ડર કેન્સલ\b/, /\bરદ કરો\b/
    ];
    return cancelPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect refund intent from text/voice
  isRefundIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const refundPatterns = [
      // English
      /\brefund\b/, /\brefund please\b/, /\bget refund\b/, /\bmoney back\b/,
      /\breturn money\b/, /\bwant refund\b/, /\bgive refund\b/,
      // Hindi
      /\brefund karo\b/, /\bpaisa wapas\b/, /\bpaise wapas\b/, /\brefund chahiye\b/,
      /\bपैसा वापस\b/, /\bरिफंड\b/, /\bपैसे वापस करो\b/, /\bरिफंड चाहिए\b/,
      // Telugu
      /\brefund kavali\b/, /\bpaisa wapas\b/, /\bరీఫండ్\b/, /\bడబ్బు వాపస్\b/,
      /\bరీఫండ్ కావాలి\b/, /\bడబ్బు తిరిగి ఇవ్వండి\b/,
      // Tamil
      /\brefund venum\b/, /\bpanam thirumba\b/, /\bரீஃபண்ட்\b/, /\bபணம் திரும்ப\b/,
      // Kannada
      /\brefund beku\b/, /\bರೀಫಂಡ್\b/, /\bಹಣ ವಾಪಸ್\b/,
      // Malayalam
      /\brefund venam\b/, /\bറീഫണ്ട്\b/, /\bപണം തിരികെ\b/,
      // Bengali
      /\brefund chai\b/, /\bটাকা ফেরত\b/, /\bরিফান্ড\b/,
      // Marathi
      /\brefund pahije\b/, /\bरिफंड पाहिजे\b/, /\bपैसे परत\b/,
      // Gujarati
      /\brefund joiye\b/, /\bરીફંડ\b/, /\bપૈસા પાછા\b/
    ];
    return refundPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect cart intent from text/voice
  // Handles voice recognition mistakes like "card", "cut", "kart", "cot", "caught", "cat", "court" instead of "cart"
  // Also handles "items" variations in all languages
  isCartIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const cartPatterns = [
      // ========== ENGLISH - ALL VOICE MISTAKES ==========
      // Cart variations (cart, card, cut, kart, cot, caught, cat, court)
      /\bmy cart\b/, /\bview cart\b/, /\bshow cart\b/, /\bsee cart\b/, /\bcheck cart\b/, /\bopen cart\b/,
      /\bmy card\b/, /\bview card\b/, /\bshow card\b/, /\bsee card\b/, /\bcheck card\b/, /\bopen card\b/,
      /\bmy cut\b/, /\bview cut\b/, /\bshow cut\b/, /\bsee cut\b/, /\bcheck cut\b/,
      /\bmy kart\b/, /\bview kart\b/, /\bshow kart\b/, /\bsee kart\b/, /\bcheck kart\b/,
      /\bmy cot\b/, /\bview cot\b/, /\bshow cot\b/, /\bsee cot\b/,
      /\bmy caught\b/, /\bview caught\b/, /\bshow caught\b/, /\bsee caught\b/,
      /\bmy cat\b/, /\bview cat\b/, /\bshow cat\b/, /\bsee cat\b/,
      /\bmy court\b/, /\bview court\b/, /\bshow court\b/, /\bsee court\b/,
      // Items variations
      /\bmy items\b/, /\bshow items\b/, /\bview items\b/, /\bsee items\b/, /\bcheck items\b/,
      /\bshow my items\b/, /\bview my items\b/, /\bsee my items\b/, /\bcheck my items\b/,
      /\bmy order items\b/, /\bshow order\b/, /\bview order\b/, /\bmy order\b/,
      /\bshow my order\b/, /\bview my order\b/, /\bsee my order\b/,
      // Basket variations
      /\bmy basket\b/, /\bshow basket\b/, /\bview basket\b/, /\bsee basket\b/,
      // What's in cart
      /\bwhat'?s in my cart\b/, /\bwhats in cart\b/, /\bwhat'?s in cart\b/,
      /\bwhat'?s in my card\b/, /\bwhats in card\b/, /\bwhat in cart\b/, /\bwhat in card\b/,
      // Standalone words (only match if short message)
      /^cart$/, /^card$/, /^kart$/, /^items$/, /^basket$/,
      
      // ========== HINDI ==========
      /\bcart me kya hai\b/, /\bcart dikhao\b/, /\bcart dekho\b/, /\bmera cart\b/, /\bcart dekhao\b/,
      /\bcard me kya hai\b/, /\bcard dikhao\b/, /\bcard dekho\b/, /\bmera card\b/, /\bcard dekhao\b/,
      /\bमेरा कार्ट\b/, /\bकार्ट\b/, /\bकार्ट दिखाओ\b/, /\bकार्ट में क्या है\b/, /\bकार्ट देखो\b/,
      /\bआइटम दिखाओ\b/, /\bमेरे आइटम\b/, /\bसामान दिखाओ\b/, /\bमेरा सामान\b/, /\bआइटम्स दिखाओ\b/,
      /\bitems dikhao\b/, /\bmere items\b/, /\bsaman dikhao\b/, /\bmera saman\b/,
      
      // ========== TELUGU ==========
      /\bcart chupinchu\b/, /\bnaa cart\b/, /\bcart chudu\b/, /\bcart choodu\b/,
      /\bcard chupinchu\b/, /\bnaa card\b/, /\bcard chudu\b/,
      /\bకార్ట్\b/, /\bనా కార్ట్\b/, /\bకార్ట్ చూపించు\b/, /\bకార్ట్ చూడు\b/,
      /\bనా ఐటమ్స్\b/, /\bఐటమ్స్ చూపించు\b/, /\bఐటమ్స్ చూడు\b/, /\bసామాన్లు చూపించు\b/,
      /\bitems chupinchu\b/, /\bnaa items\b/, /\bsamanlu chupinchu\b/,
      
      // ========== TAMIL ==========
      /\bcart kaattu\b/, /\ben cart\b/, /\bcart paaru\b/, /\bcart kaatu\b/,
      /\bcard kaattu\b/, /\ben card\b/, /\bcard paaru\b/,
      /\bகார்ட்\b/, /\bஎன் கார்ட்\b/, /\bகார்ட் காட்டு\b/, /\bகார்ட் பாரு\b/,
      /\bஎன் ஐட்டம்ஸ்\b/, /\bஐட்டம்ஸ் காட்டு\b/, /\bபொருட்கள் காட்டு\b/,
      /\bitems kaattu\b/, /\ben items\b/, /\bporulgal kaattu\b/,
      
      // ========== KANNADA ==========
      /\bcart toorisu\b/, /\bnanna cart\b/, /\bcart nodu\b/, /\bcart thoorisu\b/,
      /\bcard toorisu\b/, /\bnanna card\b/, /\bcard nodu\b/,
      /\bಕಾರ್ಟ್\b/, /\bನನ್ನ ಕಾರ್ಟ್\b/, /\bಕಾರ್ಟ್ ತೋರಿಸು\b/, /\bಕಾರ್ಟ್ ನೋಡು\b/,
      /\bನನ್ನ ಐಟಮ್ಸ್\b/, /\bಐಟಮ್ಸ್ ತೋರಿಸು\b/, /\bಸಾಮಾನು ತೋರಿಸು\b/,
      /\bitems toorisu\b/, /\bnanna items\b/, /\bsamanu toorisu\b/,
      
      // ========== MALAYALAM ==========
      /\bcart kaanikkuka\b/, /\bente cart\b/, /\bcart kaanu\b/, /\bcart kanikkuka\b/,
      /\bcard kaanikkuka\b/, /\bente card\b/, /\bcard kaanu\b/,
      /\bകാർട്ട്\b/, /\bഎന്റെ കാർട്ട്\b/, /\bകാർട്ട് കാണിക്കുക\b/, /\bകാർട്ട് കാണു\b/,
      /\bഎന്റെ ഐറ്റംസ്\b/, /\bഐറ്റംസ് കാണിക്കുക\b/, /\bസാധനങ്ങൾ കാണിക്കുക\b/,
      /\bitems kaanikkuka\b/, /\bente items\b/, /\bsadhanangal kaanikkuka\b/,
      
      // ========== BENGALI ==========
      /\bcart dekho\b/, /\bamar cart\b/, /\bcart dekhao\b/, /\bcart dao\b/,
      /\bcard dekho\b/, /\bamar card\b/, /\bcard dekhao\b/,
      /\bকার্ট\b/, /\bআমার কার্ট\b/, /\bকার্ট দেখো\b/, /\bকার্ট দেখাও\b/,
      /\bআমার আইটেম\b/, /\bআইটেম দেখো\b/, /\bজিনিস দেখো\b/,
      /\bitems dekho\b/, /\bamar items\b/, /\bjinis dekho\b/,
      
      // ========== MARATHI ==========
      /\bcart dakhva\b/, /\bmaza cart\b/, /\bcart bagha\b/, /\bcart dakhava\b/,
      /\bcard dakhva\b/, /\bmaza card\b/, /\bcard bagha\b/,
      /\bकार्ट\b/, /\bमाझा कार्ट\b/, /\bकार्ट दाखवा\b/, /\bकार्ट बघा\b/,
      /\bमाझे आइटम\b/, /\bआइटम दाखवा\b/, /\bसामान दाखवा\b/,
      /\bitems dakhva\b/, /\bmaze items\b/, /\bsaman dakhva\b/,
      
      // ========== GUJARATI ==========
      /\bcart batavo\b/, /\bmaru cart\b/, /\bcart juo\b/, /\bcart batao\b/,
      /\bcard batavo\b/, /\bmaru card\b/, /\bcard juo\b/,
      /\bકાર્ટ\b/, /\bમારું કાર્ટ\b/, /\bકાર્ટ બતાવો\b/, /\bકાર્ટ જુઓ\b/,
      /\bમારા આઇટમ્સ\b/, /\bઆઇટમ્સ બતાવો\b/, /\bસામાન બતાવો\b/,
      /\bitems batavo\b/, /\bmara items\b/, /\bsaman batavo\b/,
      
      // ========== MIXED LANGUAGE PATTERNS (Hinglish/Tanglish/etc.) ==========
      // "dekhna hai" / "dekhna" style (want to see)
      /\bcart dekhna hai\b/, /\bcart dekhna\b/, /\bcard dekhna hai\b/, /\bcard dekhna\b/,
      /\bitems dekhna hai\b/, /\bitems dekhna\b/, /\bsaman dekhna hai\b/,
      // "chahiye" / "chai" style (want/need)
      /\bcart dekhna chahiye\b/, /\bcart chahiye\b/, /\bcard chahiye\b/,
      /\bitems dekhna chahiye\b/, /\bitems chahiye\b/, /\bmy items chahiye\b/,
      /\bcart show chai\b/, /\bitems show chai\b/, /\bcart dikhao chai\b/,
      // "karo" / "kar do" / "do" style (please do)
      /\bcart show karo\b/, /\bcart show kar do\b/, /\bcard show karo\b/,
      /\bitems show karo\b/, /\bitems show kar do\b/, /\bitems dikhao na\b/,
      /\bcart dikha do\b/, /\bcard dikha do\b/, /\bitems dikha do\b/,
      // "mujhe" / "mera" / "mere" style (my/mine)
      /\bmujhe cart dikhao\b/, /\bmujhe items dikhao\b/, /\bmujhe cart show karo\b/,
      /\bmera cart dikhao\b/, /\bmera cart show\b/, /\bmera card dikhao\b/,
      /\bmere items dikhao\b/, /\bmere items show\b/, /\bmere saman dikhao\b/,
      // Telugu mixed (chupinchu/chudu at end)
      /\bcart show chupinchu\b/, /\bitems show chupinchu\b/, /\bcart chudu\b/,
      /\bitems chudu\b/, /\bnaa cart chudu\b/, /\bnaa items chudu\b/,
      // Tamil mixed (kaattu/paaru at end)
      /\bcart show kaattu\b/, /\bitems show kaattu\b/, /\bcart paaru\b/,
      /\bitems paaru\b/, /\ben cart paaru\b/, /\ben items paaru\b/,
      // Kannada mixed (toorisu/nodu at end)
      /\bcart show toorisu\b/, /\bitems show toorisu\b/, /\bcart nodu\b/,
      /\bitems nodu\b/, /\bnanna cart nodu\b/, /\bnanna items nodu\b/,
      // Bengali mixed (dekho/dekhao at end)
      /\bcart show dekho\b/, /\bitems show dekho\b/, /\bcart dekhao na\b/,
      /\bitems dekhao na\b/, /\bamar cart dekho\b/, /\bamar items dekho\b/,
      // Marathi mixed (dakhva/bagha at end)
      /\bcart show dakhva\b/, /\bitems show dakhva\b/, /\bcart bagha na\b/,
      /\bitems bagha na\b/, /\bmaza cart bagha\b/, /\bmaze items bagha\b/,
      // Gujarati mixed (batavo/juo at end)
      /\bcart show batavo\b/, /\bitems show batavo\b/, /\bcart juo na\b/,
      /\bitems juo na\b/, /\bmaru cart juo\b/, /\bmara items juo\b/,
      // "please" mixed patterns
      /\bplease show cart\b/, /\bplease show items\b/, /\bplease show my cart\b/,
      /\bcart show please\b/, /\bitems show please\b/, /\bmy cart please\b/,
      // "want to" patterns
      /\bwant to see cart\b/, /\bwant to see items\b/, /\bwant to view cart\b/,
      /\bi want see cart\b/, /\bi want see items\b/, /\bi want my cart\b/,
      // Short forms
      /\bshw cart\b/, /\bshw items\b/, /\bvw cart\b/, /\bvw items\b/
    ];
    return cartPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect clear/empty cart intent from text/voice
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  // Handles voice recognition mistakes like "card", "cut", "kart", "cot", "caught", "cat", "court" instead of "cart"
  // Also handles "items" variations in all languages
  isClearCartIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const clearCartPatterns = [
      // ========== ENGLISH - ALL VOICE MISTAKES ==========
      // Clear variations - cart/card/cut/kart/cot/caught/cat/court
      /\bclear cart\b/, /\bclear my cart\b/, /\bclear the cart\b/, /\bempty cart\b/, /\bempty my cart\b/,
      /\bclear card\b/, /\bclear my card\b/, /\bclear the card\b/, /\bempty card\b/, /\bempty my card\b/,
      /\bclear cut\b/, /\bclear my cut\b/, /\bclear the cut\b/, /\bempty cut\b/, /\bempty my cut\b/,
      /\bclear kart\b/, /\bclear my kart\b/, /\bclear the kart\b/, /\bempty kart\b/, /\bempty my kart\b/,
      /\bclear cot\b/, /\bclear my cot\b/, /\bclear the cot\b/, /\bempty cot\b/, /\bempty my cot\b/,
      /\bclear caught\b/, /\bclear my caught\b/, /\bclear the caught\b/, /\bempty caught\b/,
      /\bclear cat\b/, /\bclear my cat\b/, /\bclear the cat\b/, /\bempty cat\b/,
      /\bclear court\b/, /\bclear my court\b/, /\bclear the court\b/, /\bempty court\b/,
      // Remove variations - ALL voice mistakes for cart/card/cut/kart/cot/caught/cat/court
      /\bremove cart\b/, /\bremove my cart\b/, /\bremove the cart\b/, /\bremove all from cart\b/,
      /\bremove card\b/, /\bremove my card\b/, /\bremove the card\b/, /\bremove all from card\b/,
      /\bremove cut\b/, /\bremove my cut\b/, /\bremove the cut\b/,
      /\bremove kart\b/, /\bremove my kart\b/, /\bremove the kart\b/,
      /\bremove cot\b/, /\bremove my cot\b/, /\bremove the cot\b/,
      /\bremove caught\b/, /\bremove my caught\b/, /\bremove the caught\b/,
      /\bremove cat\b/, /\bremove my cat\b/, /\bremove the cat\b/,
      /\bremove court\b/, /\bremove my court\b/, /\bremove the court\b/,
      /\bremove all\b/, /\bremove items\b/, /\bremove all items\b/, /\bremove my items\b/, /\bremove the items\b/,
      /\bremove everything\b/, /\bremove from cart\b/, /\bremove from card\b/,
      // Delete variations - ALL voice mistakes for cart/card/cut/kart/cot/caught/cat/court
      /\bdelete cart\b/, /\bdelete my cart\b/, /\bdelete the cart\b/,
      /\bdelete card\b/, /\bdelete my card\b/, /\bdelete the card\b/,
      /\bdelete cut\b/, /\bdelete my cut\b/, /\bdelete the cut\b/,
      /\bdelete kart\b/, /\bdelete my kart\b/, /\bdelete the kart\b/,
      /\bdelete cot\b/, /\bdelete my cot\b/, /\bdelete the cot\b/,
      /\bdelete caught\b/, /\bdelete my caught\b/, /\bdelete the caught\b/,
      /\bdelete cat\b/, /\bdelete my cat\b/, /\bdelete the cat\b/,
      /\bdelete court\b/, /\bdelete my court\b/, /\bdelete the court\b/,
      /\bdelete all\b/, /\bdelete items\b/, /\bdelete my items\b/, /\bdelete the items\b/, /\bdelete all items\b/, /\bdelete everything\b/,
      // Clean/Reset/Cancel variations - ALL voice mistakes
      /\bclean cart\b/, /\bclean my cart\b/, /\bclean card\b/, /\bclean my card\b/,
      /\bclean cut\b/, /\bclean my cut\b/, /\bclean kart\b/, /\bclean my kart\b/,
      /\bclean items\b/, /\bclean my items\b/, /\bclean the items\b/,
      /\breset cart\b/, /\breset my cart\b/, /\breset card\b/, /\breset my card\b/,
      /\breset cut\b/, /\breset my cut\b/, /\breset kart\b/, /\breset my kart\b/,
      /\breset items\b/, /\breset my items\b/, /\breset the items\b/,
      // Cancel variations - ALL voice mistakes
      /\bcancel cart\b/, /\bcancel my cart\b/, /\bcancel the cart\b/,
      /\bcancel card\b/, /\bcancel my card\b/, /\bcancel the card\b/,
      /\bcancel cut\b/, /\bcancel my cut\b/, /\bcancel the cut\b/,
      /\bcancel kart\b/, /\bcancel my kart\b/, /\bcancel the kart\b/,
      /\bcancel cot\b/, /\bcancel my cot\b/, /\bcancel caught\b/, /\bcancel my caught\b/,
      /\bcancel cat\b/, /\bcancel my cat\b/, /\bcancel court\b/, /\bcancel my court\b/,
      /\bcancel items\b/, /\bcancel my items\b/, /\bcancel the items\b/, /\bcancel all items\b/, /\bcancel all\b/,
      // Other English patterns
      /\bclear basket\b/, /\bempty basket\b/, /\bremove basket\b/, /\bdelete basket\b/,
      /\bclear all\b/, /\bclear items\b/, /\bclear my items\b/, /\bclear the items\b/, /\bclear all items\b/,
      /\bstart fresh\b/, /\bstart over\b/, /\bfresh start\b/,
      // ========== HINDI ==========
      // Cart variations with voice mistakes
      /\bcart khali karo\b/, /\bcart saaf karo\b/, /\bcart clear karo\b/, /\bcart hatao\b/,
      /\bcard khali karo\b/, /\bcard saaf karo\b/, /\bcard clear karo\b/, /\bcard hatao\b/,
      /\bcut khali karo\b/, /\bcut saaf karo\b/, /\bkart khali karo\b/, /\bkart saaf karo\b/,
      // Items variations
      /\bitems hatao\b/, /\bitems clear karo\b/, /\bitems delete karo\b/, /\bitems remove karo\b/,
      /\bsab items hatao\b/, /\bsab items clear karo\b/, /\bsab items delete karo\b/,
      /\bsab hatao\b/, /\bsab remove karo\b/, /\bsab delete karo\b/, /\bsab clear karo\b/,
      /\bsaman hatao\b/, /\bsaman clear karo\b/, /\bsab saman hatao\b/,
      // Hindi script
      /\bकार्ट खाली करो\b/, /\bकार्ट साफ करो\b/, /\bकार्ट क्लियर\b/, /\bकार्ट हटाओ\b/,
      /\bसब हटाओ\b/, /\bसब कुछ हटाओ\b/, /\bसब क्लियर करो\b/, /\bसब डिलीट करो\b/,
      /\bआइटम हटाओ\b/, /\bआइटम्स हटाओ\b/, /\bसब आइटम हटाओ\b/, /\bआइटम्स क्लियर\b/,
      /\bसामान हटाओ\b/, /\bसब सामान हटाओ\b/, /\bसामान क्लियर करो\b/,
      // ========== TELUGU ==========
      // Cart variations with voice mistakes
      /\bcart clear cheyyi\b/, /\bcart khali cheyyi\b/, /\bcart teeseyyi\b/, /\bcart delete cheyyi\b/,
      /\bcard clear cheyyi\b/, /\bcard khali cheyyi\b/, /\bcard teeseyyi\b/, /\bcard delete cheyyi\b/,
      /\bcut clear cheyyi\b/, /\bkart clear cheyyi\b/, /\bkart khali cheyyi\b/,
      // Items variations
      /\bitems teeseyyi\b/, /\bitems clear cheyyi\b/, /\bitems delete cheyyi\b/, /\bitems remove cheyyi\b/,
      /\banni items teeseyyi\b/, /\banni items clear cheyyi\b/,
      /\banni teeseyyi\b/, /\banni clear cheyyi\b/, /\banni delete cheyyi\b/,
      /\bsamanlu teeseyyi\b/, /\bsamanlu clear cheyyi\b/, /\banni samanlu teeseyyi\b/,
      // Telugu script
      /\bకార్ట్ క్లియర్\b/, /\bకార్ట్ ఖాళీ చేయి\b/, /\bకార్ట్ తీసేయి\b/, /\bకార్ట్ డిలీట్\b/,
      /\bఅన్నీ తీసేయి\b/, /\bఅన్నీ క్లియర్\b/, /\bఅన్నీ డిలీట్\b/,
      /\bఐటమ్స్ తీసేయి\b/, /\bఐటమ్స్ క్లియర్\b/, /\bఐటమ్స్ డిలీట్\b/, /\bఅన్ని ఐటమ్స్ తీసేయి\b/,
      /\bసామాన్లు తీసేయి\b/, /\bసామాన్లు క్లియర్\b/, /\bఅన్ని సామాన్లు తీసేయి\b/,
      // ========== TAMIL ==========
      // Cart variations with voice mistakes
      /\bcart clear pannu\b/, /\bcart kaali pannu\b/, /\bcart neekku\b/, /\bcart delete pannu\b/,
      /\bcard clear pannu\b/, /\bcard kaali pannu\b/, /\bcard neekku\b/, /\bcard delete pannu\b/,
      /\bcut clear pannu\b/, /\bkart clear pannu\b/, /\bkart kaali pannu\b/,
      // Items variations
      /\bitems neekku\b/, /\bitems clear pannu\b/, /\bitems delete pannu\b/, /\bitems remove pannu\b/,
      /\bella items neekku\b/, /\bella items clear pannu\b/,
      /\bellam eduthudu\b/, /\bellam neekku\b/, /\bellam clear pannu\b/, /\bellam delete pannu\b/,
      /\bporulgal neekku\b/, /\bporulgal clear pannu\b/, /\bella porulgal neekku\b/,
      // Tamil script
      /\bகார்ட் கிளியர்\b/, /\bகார்ட் காலி\b/, /\bகார்ட் நீக்கு\b/, /\bகார்ட் டெலிட்\b/,
      /\bஎல்லாம் எடுத்துடு\b/, /\bஎல்லாம் நீக்கு\b/, /\bஎல்லாம் கிளியர்\b/,
      /\bஐட்டம்ஸ் நீக்கு\b/, /\bஐட்டம்ஸ் கிளியர்\b/, /\bஐட்டம்ஸ் டெலிட்\b/, /\bஎல்லா ஐட்டம்ஸ் நீக்கு\b/,
      /\bபொருட்கள் நீக்கு\b/, /\bபொருட்கள் கிளியர்\b/, /\bஎல்லா பொருட்கள் நீக்கு\b/,
      // ========== KANNADA ==========
      // Cart variations with voice mistakes
      /\bcart clear maadi\b/, /\bcart khali maadi\b/, /\bcart tegedu\b/, /\bcart delete maadi\b/,
      /\bcard clear maadi\b/, /\bcard khali maadi\b/, /\bcard tegedu\b/, /\bcard delete maadi\b/,
      /\bcut clear maadi\b/, /\bkart clear maadi\b/, /\bkart khali maadi\b/,
      // Items variations
      /\bitems tegedu\b/, /\bitems clear maadi\b/, /\bitems delete maadi\b/, /\bitems remove maadi\b/,
      /\bella items tegedu\b/, /\bella items clear maadi\b/,
      /\bella tegedu\b/, /\bella clear maadi\b/, /\bella delete maadi\b/,
      /\bsamanu tegedu\b/, /\bsamanu clear maadi\b/, /\bella samanu tegedu\b/,
      // Kannada script
      /\bಕಾರ್ಟ್ ಕ್ಲಿಯರ್\b/, /\bಕಾರ್ಟ್ ಖಾಲಿ\b/, /\bಕಾರ್ಟ್ ತೆಗೆದು\b/, /\bಕಾರ್ಟ್ ಡಿಲೀಟ್\b/,
      /\bಎಲ್ಲಾ ತೆಗೆದು\b/, /\bಎಲ್ಲಾ ಕ್ಲಿಯರ್\b/, /\bಎಲ್ಲಾ ಡಿಲೀಟ್\b/,
      /\bಐಟಮ್ಸ್ ತೆಗೆದು\b/, /\bಐಟಮ್ಸ್ ಕ್ಲಿಯರ್\b/, /\bಐಟಮ್ಸ್ ಡಿಲೀಟ್\b/, /\bಎಲ್ಲಾ ಐಟಮ್ಸ್ ತೆಗೆದು\b/,
      /\bಸಾಮಾನು ತೆಗೆದು\b/, /\bಸಾಮಾನು ಕ್ಲಿಯರ್\b/, /\bಎಲ್ಲಾ ಸಾಮಾನು ತೆಗೆದು\b/,
      // ========== MALAYALAM ==========
      // Cart variations with voice mistakes
      /\bcart clear cheyyuka\b/, /\bcart kaali aakkuka\b/, /\bcart maarruka\b/, /\bcart delete cheyyuka\b/,
      /\bcard clear cheyyuka\b/, /\bcard kaali aakkuka\b/, /\bcard maarruka\b/, /\bcard delete cheyyuka\b/,
      /\bcut clear cheyyuka\b/, /\bkart clear cheyyuka\b/, /\bkart kaali aakkuka\b/,
      // Items variations
      /\bitems maarruka\b/, /\bitems clear cheyyuka\b/, /\bitems delete cheyyuka\b/, /\bitems remove cheyyuka\b/,
      /\bellam items maarruka\b/, /\bellam items clear cheyyuka\b/,
      /\bellam maarruka\b/, /\bellam clear cheyyuka\b/, /\bellam delete cheyyuka\b/,
      /\bsadhanangal maarruka\b/, /\bsadhanangal clear cheyyuka\b/, /\bellam sadhanangal maarruka\b/,
      // Malayalam script
      /\bകാർട്ട് ക്ലിയർ\b/, /\bകാർട്ട് കാലി\b/, /\bകാർട്ട് മാറ്റുക\b/, /\bകാർട്ട് ഡിലീറ്റ്\b/,
      /\bഎല്ലാം മാറ്റുക\b/, /\bഎല്ലാം ക്ലിയർ\b/, /\bഎല്ലാം ഡിലീറ്റ്\b/,
      /\bഐറ്റംസ് മാറ്റുക\b/, /\bഐറ്റംസ് ക്ലിയർ\b/, /\bഐറ്റംസ് ഡിലീറ്റ്\b/, /\bഎല്ലാ ഐറ്റംസ് മാറ്റുക\b/,
      /\bസാധനങ്ങൾ മാറ്റുക\b/, /\bസാധനങ്ങൾ ക്ലിയർ\b/, /\bഎല്ലാ സാധനങ്ങൾ മാറ്റുക\b/,
      // ========== BENGALI ==========
      // Cart variations with voice mistakes
      /\bcart clear koro\b/, /\bcart khali koro\b/, /\bcart soriyo\b/, /\bcart delete koro\b/,
      /\bcard clear koro\b/, /\bcard khali koro\b/, /\bcard soriyo\b/, /\bcard delete koro\b/,
      /\bcut clear koro\b/, /\bkart clear koro\b/, /\bkart khali koro\b/,
      // Items variations
      /\bitems soriyo\b/, /\bitems clear koro\b/, /\bitems delete koro\b/, /\bitems remove koro\b/,
      /\bsob items soriyo\b/, /\bsob items clear koro\b/,
      /\bsob soriyo\b/, /\bsob clear koro\b/, /\bsob delete koro\b/,
      /\bjinis soriyo\b/, /\bjinis clear koro\b/, /\bsob jinis soriyo\b/,
      // Bengali script
      /\bকার্ট ক্লিয়ার\b/, /\bকার্ট খালি করো\b/, /\bকার্ট সরিয়ে দাও\b/, /\bকার্ট ডিলিট\b/,
      /\bসব সরিয়ে দাও\b/, /\bসব ক্লিয়ার করো\b/, /\bসব ডিলিট করো\b/,
      /\bআইটেম সরিয়ে দাও\b/, /\bআইটেম ক্লিয়ার\b/, /\bআইটেম ডিলিট\b/, /\bসব আইটেম সরিয়ে দাও\b/,
      /\bজিনিস সরিয়ে দাও\b/, /\bজিনিস ক্লিয়ার\b/, /\bসব জিনিস সরিয়ে দাও\b/,
      // ========== MARATHI ==========
      // Cart variations with voice mistakes
      /\bcart clear kara\b/, /\bcart khali kara\b/, /\bcart kadhun taka\b/, /\bcart delete kara\b/,
      /\bcard clear kara\b/, /\bcard khali kara\b/, /\bcard kadhun taka\b/, /\bcard delete kara\b/,
      /\bcut clear kara\b/, /\bkart clear kara\b/, /\bkart khali kara\b/,
      // Items variations
      /\bitems kadhun taka\b/, /\bitems clear kara\b/, /\bitems delete kara\b/, /\bitems remove kara\b/,
      /\bsagla items kadhun taka\b/, /\bsagla items clear kara\b/,
      /\bsagla kadhun taka\b/, /\bsagla clear kara\b/, /\bsagla delete kara\b/,
      /\bsaman kadhun taka\b/, /\bsaman clear kara\b/, /\bsagla saman kadhun taka\b/,
      // Marathi script
      /\bकार्ट क्लियर करा\b/, /\bकार्ट खाली करा\b/, /\bकार्ट काढून टाका\b/, /\bकार्ट डिलीट करा\b/,
      /\bसगळं काढून टाका\b/, /\bसगळं क्लियर करा\b/, /\bसगळं डिलीट करा\b/,
      /\bआइटम काढून टाका\b/, /\bआइटम क्लियर करा\b/, /\bआइटम डिलीट करा\b/, /\bसगळे आइटम काढून टाका\b/,
      /\bसामान काढून टाका\b/, /\bसामान क्लियर करा\b/, /\bसगळं सामान काढून टाका\b/,
      // ========== GUJARATI ==========
      // Cart variations with voice mistakes
      /\bcart clear karo\b/, /\bcart khali karo\b/, /\bcart kaadhi nakho\b/, /\bcart delete karo\b/,
      /\bcard clear karo\b/, /\bcard khali karo\b/, /\bcard kaadhi nakho\b/, /\bcard delete karo\b/,
      /\bcut clear karo\b/, /\bkart clear karo\b/, /\bkart khali karo\b/,
      // Items variations
      /\bitems kaadhi nakho\b/, /\bitems clear karo\b/, /\bitems delete karo\b/, /\bitems remove karo\b/,
      /\bbadha items kaadhi nakho\b/, /\bbadha items clear karo\b/,
      /\bbadhu kaadhi nakho\b/, /\bbadhu clear karo\b/, /\bbadhu delete karo\b/,
      /\bsaman kaadhi nakho\b/, /\bsaman clear karo\b/, /\bbadhu saman kaadhi nakho\b/,
      // Gujarati script
      /\bકાર્ટ ક્લિયર\b/, /\bકાર્ટ ખાલી કરો\b/, /\bકાર્ટ કાઢી નાખો\b/, /\bકાર્ટ ડિલીટ\b/,
      /\bબધું કાઢી નાખો\b/, /\bબધું ક્લિયર કરો\b/, /\bબધું ડિલીટ કરો\b/,
      /\bઆઇટમ્સ કાઢી નાખો\b/, /\bઆઇટમ્સ ક્લિયર\b/, /\bઆઇટમ્સ ડિલીટ\b/, /\bબધા આઇટમ્સ કાઢી નાખો\b/,
      /\bસામાન કાઢી નાખો\b/, /\bસામાન ક્લિયર\b/, /\bબધું સામાન કાઢી નાખો\b/,
      
      // ========== MIXED LANGUAGE PATTERNS (Hinglish/Tanglish/etc.) ==========
      // "items remove chai" style - action word at end (Hindi style in English)
      /\bitems remove chai\b/, /\bitems delete chai\b/, /\bitems clear chai\b/, /\bitems hatao chai\b/,
      /\bcart remove chai\b/, /\bcart delete chai\b/, /\bcart clear chai\b/, /\bcart hatao chai\b/,
      /\bcard remove chai\b/, /\bcard delete chai\b/, /\bcard clear chai\b/,
      /\bsab remove chai\b/, /\bsab delete chai\b/, /\bsab clear chai\b/,
      // "chai" variations (chahiye/chaiye - want to)
      /\bitems remove chahiye\b/, /\bitems delete chahiye\b/, /\bitems clear chahiye\b/,
      /\bcart remove chahiye\b/, /\bcart delete chahiye\b/, /\bcart clear chahiye\b/,
      /\bcart empty chahiye\b/, /\bcart khali chahiye\b/, /\bcard khali chahiye\b/,
      // "karna hai" / "karna" style (want to do)
      /\bitems remove karna\b/, /\bitems delete karna\b/, /\bitems clear karna\b/,
      /\bcart remove karna\b/, /\bcart delete karna\b/, /\bcart clear karna\b/, /\bcart empty karna\b/,
      /\bitems remove karna hai\b/, /\bitems delete karna hai\b/, /\bcart clear karna hai\b/,
      /\bcart khali karna\b/, /\bcart khali karna hai\b/, /\bcard khali karna\b/,
      // "do" / "kar do" / "de do" style (please do)
      /\bitems remove kar do\b/, /\bitems delete kar do\b/, /\bitems clear kar do\b/,
      /\bcart remove kar do\b/, /\bcart delete kar do\b/, /\bcart clear kar do\b/,
      /\bcart khali kar do\b/, /\bcard khali kar do\b/, /\bcart empty kar do\b/,
      /\bitems hata do\b/, /\bcart hata do\b/, /\bsab hata do\b/,
      // "please" mixed patterns
      /\bplease clear cart\b/, /\bplease remove cart\b/, /\bplease delete cart\b/,
      /\bplease clear items\b/, /\bplease remove items\b/, /\bplease delete items\b/,
      /\bcart clear please\b/, /\bitems clear please\b/, /\bcart remove please\b/,
      // Telugu mixed (cheyyi/cheyyandi at end)
      /\bitems remove cheyyi\b/, /\bitems delete cheyyi\b/, /\bcart remove cheyyi\b/,
      /\bitems clear cheyyandi\b/, /\bcart clear cheyyandi\b/, /\bcart remove cheyyandi\b/,
      // Tamil mixed (pannu/pannunga at end)
      /\bitems remove pannu\b/, /\bitems delete pannu\b/, /\bcart remove pannu\b/,
      /\bitems clear pannunga\b/, /\bcart clear pannunga\b/, /\bcart remove pannunga\b/,
      // Kannada mixed (maadi at end)
      /\bitems remove maadi\b/, /\bitems delete maadi\b/, /\bcart remove maadi\b/,
      /\bitems clear maadi\b/, /\bcart clear maadiri\b/,
      // Bengali mixed (koro at end)
      /\bitems remove koro\b/, /\bitems delete koro\b/, /\bcart remove koro\b/,
      // Marathi mixed (kara at end)
      /\bitems remove kara\b/, /\bitems delete kara\b/, /\bcart remove kara\b/,
      // Gujarati mixed (karo at end)
      /\bitems remove karo\b/, /\bitems delete karo\b/, /\bcart remove karo\b/,
      // "mujhe" / "mera" / "mere" style (my/mine)
      /\bmujhe cart clear\b/, /\bmujhe items clear\b/, /\bmujhe cart remove\b/,
      /\bmera cart clear\b/, /\bmera cart remove\b/, /\bmera cart delete\b/,
      /\bmere items clear\b/, /\bmere items remove\b/, /\bmere items delete\b/,
      // "nahi chahiye" / "nahi chaiye" (don't want)
      /\bcart nahi chahiye\b/, /\bitems nahi chahiye\b/, /\bsab nahi chahiye\b/,
      /\bcart nahi chaiye\b/, /\bitems nahi chaiye\b/,
      // Short forms and typos
      /\bclr cart\b/, /\bclr card\b/, /\bclr items\b/, /\brmv cart\b/, /\brmv items\b/,
      /\bdel cart\b/, /\bdel card\b/, /\bdel items\b/,
      // "want to" patterns
      /\bwant to clear cart\b/, /\bwant to remove cart\b/, /\bwant to delete cart\b/,
      /\bwant to clear items\b/, /\bwant to remove items\b/, /\bwant to delete items\b/,
      /\bi want clear cart\b/, /\bi want remove items\b/, /\bi want delete cart\b/
    ];
    return clearCartPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect "add to cart" intent from text/voice
  // Returns: { itemName: string } or null
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  isAddToCartIntent(text) {
    if (!text) return null;
    const lowerText = text.toLowerCase().trim();
    
    // Patterns to extract item name from "add X to cart" style messages
    const addPatterns = [
      // English
      /add\s+(.+?)\s+to\s+(?:cart|card|kart)/i,
      /add\s+(.+?)\s+(?:to\s+)?(?:my\s+)?(?:cart|card|kart)/i,
      /(?:i\s+)?want\s+(?:to\s+)?add\s+(.+?)\s+(?:to\s+)?(?:cart|card)/i,
      /put\s+(.+?)\s+in\s+(?:cart|card|kart)/i,
      /(.+?)\s+add\s+(?:to\s+)?(?:cart|card|kart)/i,
      /(.+?)\s+(?:cart|card)\s+(?:me|mein|mai)\s+(?:add|daal|dal)/i,
      // Hindi
      /(.+?)\s+(?:cart|card)\s+(?:me|mein|mai)\s+(?:daalo|dalo|add\s+karo)/i,
      /(.+?)\s+(?:add|daal|dal)\s+(?:karo|do|kar\s+do)/i,
      /(.+?)\s+(?:कार्ट|कार्ड)\s+(?:में|मे)\s+(?:डालो|ऐड\s+करो)/i,
      // Telugu
      /(.+?)\s+(?:cart|card)\s+(?:lo|ki)\s+(?:add|pettandi|pettu)/i,
      /(.+?)\s+(?:కార్ట్|కార్డ్)\s+(?:లో|కి)\s+(?:పెట్టు|యాడ్)/i,
      // Tamil
      /(.+?)\s+(?:cart|card)\s+(?:la|le)\s+(?:add|podungal|podu)/i,
      /(.+?)\s+(?:கார்ட்|கார்ட்)\s+(?:ல|லே)\s+(?:போடு|ஆட்)/i,
      // Simple patterns - just item name followed by "add"
      /^(.+?)\s+add$/i,
      /^add\s+(.+)$/i,
    ];
    
    for (const pattern of addPatterns) {
      const match = lowerText.match(pattern);
      if (match && match[1]) {
        const itemName = match[1].trim();
        // Filter out common words that aren't item names
        if (itemName.length > 1 && !['to', 'the', 'a', 'an', 'my', 'this', 'that'].includes(itemName)) {
          return { itemName };
        }
      }
    }
    return null;
  },

  // Helper to detect website order format
  // Detects: "Hi! I'd like to order: ◆ ItemName ◆ Price: ₹XXX"
  // Returns: { itemName: string, price: number } or null
  isWebsiteOrderIntent(text) {
    if (!text || typeof text !== 'string') return null;
    
    console.log('🔍 Checking website order intent:', text);
    
    // Pattern for website order format - handle various emoji/symbol markers
    const patterns = [
      // Format with ◆ diamond: "◆ Gongura Chicken ◆ Price: ₹267"
      /[◆◇♦]\s*([^◆◇♦₹\n]+?)\s*[◆◇♦]\s*Price[:\s]*₹?\s*(\d+)/i,
      // Format with 🍽️: "🍽️ *ItemName* 💰 Price: ₹XXX"
      /🍽️\s*\*?\s*([^*💰₹\n]+?)\s*\*?\s*💰?\s*Price[:\s]*₹?\s*(\d+)/i,
      // Format: "Hi! I'd like to order:" then newline then item
      /i'?d?\s*like\s*to\s*order[:\s]*\n*[◆◇♦🍽️]*\s*\*?\s*([^*◆◇♦💰₹\n]+?)\s*\*?\s*\n*[◆◇♦💰]*\s*Price[:\s]*₹?\s*(\d+)/i,
      // Simple format: "Order: ItemName"
      /order[:\s]+([^-₹◆◇♦\n]+?)(?:\s*[-–]\s*₹?\s*(\d+))?$/i,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const itemName = match[1].trim().replace(/^\*|\*$/g, '').replace(/^[◆◇♦🍽️\s]+|[◆◇♦💰\s]+$/g, '').trim();
        const price = match[2] ? parseInt(match[2]) : null;
        console.log('✅ Website order extracted:', { itemName, price });
        if (itemName.length > 1) {
          return { itemName, price };
        }
      }
    }
    return null;
  },

  // Helper to detect show menu/items intent from text/voice
  // Returns: { showMenu: true, foodType: 'veg'|'nonveg'|'both'|null, searchTerm: string|null }
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  isShowMenuIntent(text) {
    if (!text) return null;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // Patterns for showing menu/items
    const menuPatterns = [
      // English - "all menu", "all items", "full menu", etc.
      /\bshow\s+(?:me\s+)?(?:the\s+)?menu\b/, /\bshow\s+(?:me\s+)?(?:all\s+)?items\b/,
      /\bshow\s+(?:me\s+)?(?:the\s+)?food\b/, /\bwhat\s+(?:do\s+you\s+have|items|food)\b/,
      /\blist\s+(?:all\s+)?(?:items|menu|food)\b/, /\bdisplay\s+(?:menu|items)\b/,
      /\bsee\s+(?:the\s+)?(?:menu|items|food)\b/, /\bview\s+(?:all\s+)?(?:items|food)\b/,
      /\ball\s+items\b/, /\bfull\s+menu\b/, /\bentire\s+menu\b/,
      /\ball\s+menu\b/, /\bshow\s+all\s+menu\b/, /\bview\s+all\s+menu\b/, /\bsee\s+all\s+menu\b/,
      /\bcomplete\s+menu\b/, /\bwhole\s+menu\b/, /\btotal\s+menu\b/,
      /\ball\s+food\b/, /\bshow\s+all\s+food\b/, /\bfull\s+items\b/,
      // Hindi - "sab menu", "pura menu", "all menu dikhao"
      /\bmenu\s+dikhao\b/, /\bsab\s+items\s+dikhao\b/, /\bkhana\s+dikhao\b/,
      /\bमेन्यू\s+दिखाओ\b/, /\bसब\s+आइटम\b/, /\bखाना\s+दिखाओ\b/, /\bक्या\s+है\b/,
      /\bsab\s+menu\b/, /\bsab\s+menu\s+dikhao\b/, /\bpura\s+menu\b/, /\bpura\s+menu\s+dikhao\b/,
      /\ball\s+menu\s+dikhao\b/, /\bfull\s+menu\s+dikhao\b/, /\bsara\s+menu\b/,
      /\bसब\s+मेन्यू\b/, /\bपूरा\s+मेन्यू\b/, /\bसारा\s+मेन्यू\b/, /\bपूरा\s+मेन्यू\s+दिखाओ\b/,
      // Telugu - "antha menu", "motham menu", "all menu chupinchu"
      /\bmenu\s+chupinchu\b/, /\banni\s+items\s+chupinchu\b/, /\bమెనూ\s+చూపించు\b/,
      /\bఅన్ని\s+ఐటమ్స్\b/, /\bఏమి\s+ఉంది\b/,
      /\bantha\s+menu\b/, /\bmotham\s+menu\b/, /\ball\s+menu\s+chupinchu\b/, /\bfull\s+menu\s+chupinchu\b/,
      /\banni\s+menu\b/, /\banni\s+menu\s+chupinchu\b/,
      /\bఅంతా\s+మెనూ\b/, /\bమొత్తం\s+మెనూ\b/, /\bఅన్ని\s+మెనూ\b/,
      // Tamil - "ella menu", "muzhu menu", "all menu kaattu"
      /\bmenu\s+kaattu\b/, /\bella\s+items\s+kaattu\b/, /\bமெனு\s+காட்டு\b/,
      /\bஎல்லா\s+ஐட்டம்ஸ்\b/, /\bஎன்ன\s+இருக்கு\b/,
      /\bella\s+menu\b/, /\bmuzhu\s+menu\b/, /\ball\s+menu\s+kaattu\b/, /\bfull\s+menu\s+kaattu\b/,
      /\bella\s+menu\s+kaattu\b/,
      /\bஎல்லா\s+மெனு\b/, /\bமுழு\s+மெனு\b/,
      // Kannada - "ella menu", "puri menu", "all menu toorisu"
      /\bmenu\s+toorisu\b/, /\bella\s+items\s+toorisu\b/, /\bಮೆನು\s+ತೋರಿಸು\b/,
      /\bಎಲ್ಲಾ\s+ಐಟಮ್ಸ್\b/, /\bಏನು\s+ಇದೆ\b/,
      /\bella\s+menu\b/, /\bella\s+menu\s+toorisu\b/, /\bpuri\s+menu\b/, /\ball\s+menu\s+toorisu\b/,
      /\bಎಲ್ಲಾ\s+ಮೆನು\b/, /\bಪೂರ್ಣ\s+ಮೆನು\b/,
      // Malayalam - "ellam menu", "muzhuvan menu", "all menu kaanikkuka"
      /\bmenu\s+kaanikkuka\b/, /\bellam\s+kaanikkuka\b/, /\bമെനു\s+കാണിക്കുക\b/,
      /\bഎല്ലാം\s+കാണിക്കുക\b/, /\bഎന്താണ്\s+ഉള്ളത്\b/,
      /\bellam\s+menu\b/, /\bmuzhuvan\s+menu\b/, /\ball\s+menu\s+kaanikkuka\b/, /\bfull\s+menu\s+kaanikkuka\b/,
      /\bഎല്ലാം\s+മെനു\b/, /\bമുഴുവൻ\s+മെനു\b/,
      // Bengali - "sob menu", "puro menu", "all menu dekho"
      /\bmenu\s+dekho\b/, /\bsob\s+items\s+dekho\b/, /\bমেনু\s+দেখো\b/,
      /\bসব\s+আইটেম\b/, /\bকি\s+আছে\b/,
      /\bsob\s+menu\b/, /\bpuro\s+menu\b/, /\ball\s+menu\s+dekho\b/, /\bfull\s+menu\s+dekho\b/,
      /\bসব\s+মেনু\b/, /\bপুরো\s+মেনু\b/,
      // Marathi - "sagla menu", "purn menu", "all menu dakhva"
      /\bmenu\s+dakhva\b/, /\bsagla\s+dakhva\b/, /\bमेन्यू\s+दाखवा\b/,
      /\bसगळे\s+आइटम\b/, /\bकाय\s+आहे\b/,
      /\bsagla\s+menu\b/, /\bpurn\s+menu\b/, /\ball\s+menu\s+dakhva\b/, /\bfull\s+menu\s+dakhva\b/,
      /\bसगळा\s+मेन्यू\b/, /\bपूर्ण\s+मेन्यू\b/,
      // Gujarati - "badhu menu", "puru menu", "all menu batavo"
      /\bmenu\s+batavo\b/, /\bbadha\s+items\s+batavo\b/, /\bમેનુ\s+બતાવો\b/,
      /\bબધા\s+આઇટમ્સ\b/, /\bશું\s+છે\b/,
      /\bbadhu\s+menu\b/, /\bbadha\s+menu\b/, /\bpuru\s+menu\b/, /\ball\s+menu\s+batavo\b/, /\bfull\s+menu\s+batavo\b/,
      /\bબધું\s+મેનુ\b/, /\bબધા\s+મેનુ\b/, /\bપૂરું\s+મેનુ\b/
    ];
    
    // Patterns specifically for veg items - compound patterns only (standalone handled separately)
    const vegPatterns = [
      // English - compound patterns only
      /\bveg\s+(?:items?|menu|food|dishes?)\b/, /\bvegetarian\s+(?:items?|menu|food|dishes?)\b/,
      /\bshow\s+(?:me\s+)?veg\b/, /\bonly\s+veg\b/, /\bpure\s+veg\b/,
      /\bveggie\s+(?:items?|menu|food)\b/,
      // Hindi
      /\bveg\s+(?:items?|khana)\s+dikhao\b/, /\bवेज\s+आइटम\b/,
      /\bवेज\s+खाना\b/, /\bसिर्फ\s+वेज\b/,
      // Telugu
      /\bveg\s+items\s+chupinchu\b/, /\bవెజ్\s+ఐటమ్స్\b/,
      // Tamil
      /\bveg\s+items\s+kaattu\b/, /\bவெஜ்\s+ஐட்டம்ஸ்\b/,
      // Kannada
      /\bveg\s+items\s+toorisu\b/, /\bವೆಜ್\s+ಐಟಮ್ಸ್\b/,
      // Malayalam
      /\bveg\s+items\s+kaanikkuka\b/, /\bവെജ്\s+ഐറ്റംസ്\b/,
      // Bengali
      /\bveg\s+items\s+dekho\b/, /\bভেজ\s+আইটেম\b/,
      // Marathi
      /\bveg\s+items\s+dakhva\b/, /\bवेज\s+आइटम\b/,
      // Gujarati
      /\bveg\s+items\s+batavo\b/, /\bવેજ\s+આઇટમ્સ\b/
    ];
    
    // Patterns specifically for egg items - compound patterns only (standalone handled separately)
    const eggPatterns = [
      // English - compound patterns only
      /\begg\s+(?:items?|menu|food|dishes?)\b/,
      /\bshow\s+(?:me\s+)?egg\b/, /\bonly\s+egg\b/
    ];
    
    // Patterns specifically for non-veg items - compound patterns only (standalone handled separately)
    const nonvegPatterns = [
      // English - compound patterns only
      /\bnon[\s-]?veg\s+(?:items?|menu|food|dishes?)\b/, /\bnonveg\s+(?:items?|menu|food|dishes?)\b/,
      /\bshow\s+(?:me\s+)?non[\s-]?veg\b/, /\bonly\s+non[\s-]?veg\b/,
      /\bmeat\s+(?:items?|menu|dishes?)\b/,
      // Hindi
      /\bnon[\s-]?veg\s+(?:items?|khana)\s+dikhao\b/, /\bनॉन\s*वेज\s+आइटम\b/,
      /\bनॉन\s*वेज\s+खाना\b/, /\bसिर्फ\s+नॉन\s*वेज\b/,
      // Telugu
      /\bnon[\s-]?veg\s+items\s+chupinchu\b/, /\bనాన్\s*వెజ్\s+ఐటమ్స్\b/,
      // Tamil
      /\bnon[\s-]?veg\s+items\s+kaattu\b/, /\bநான்\s*வெஜ்\s+ஐட்டம்ஸ்\b/,
      // Kannada
      /\bnon[\s-]?veg\s+items\s+toorisu\b/, /\bನಾನ್\s*ವೆಜ್\s+ಐಟಮ್ಸ್\b/,
      // Malayalam
      /\bnon[\s-]?veg\s+items\s+kaanikkuka\b/, /\bനോൺ\s*വെജ്\s+ഐറ്റംസ്\b/,
      // Bengali
      /\bnon[\s-]?veg\s+items\s+dekho\b/, /\bনন\s*ভেজ\s+আইটেম\b/,
      // Marathi
      /\bnon[\s-]?veg\s+items\s+dakhva\b/, /\bनॉन\s*वेज\s+आइटम\b/,
      // Gujarati
      /\bnon[\s-]?veg\s+items\s+batavo\b/, /\bનોન\s*વેજ\s+આઇટમ્સ\b/
    ];
    
    // Helper to check if text is ONLY the food type keyword (standalone)
    // This prevents "egg curry" from matching as egg menu intent
    const trimmedText = text.toLowerCase().trim();
    const words = trimmedText.split(/\s+/).filter(w => w.length > 0);
    const menuWords = ['menu', 'items', 'item', 'food', 'dishes', 'dish', 'dikhao', 'show', 'batavo', 'dakhva', 'dekho', 'me', 'the', 'all', 'only'];
    
    const isStandaloneKeyword = (keywords) => {
      // Check if all words are either the keyword or menu-related words
      const nonMenuWords = words.filter(w => !keywords.includes(w) && !menuWords.includes(w));
      return nonMenuWords.length === 0 && words.some(w => keywords.includes(w));
    };
    
    // Standalone keywords for each food type
    const standaloneEggKeywords = ['egg', 'eggs', 'anda', 'अंडा', 'अंडे', 'గుడ్డు', 'కోడిగుడ్డు', 'முட்டை', 'ಮೊಟ್ಟೆ', 'മുട്ട', 'ডিম', 'ઈંડા'];
    const standaloneVegKeywords = ['veg', 'vegetarian', 'veggie', 'वेज', 'శాకాహారం', 'వెజ్', 'சைவம்', 'வெஜ்', 'ಸಸ್ಯಾಹಾರ', 'ವೆಜ್', 'സസ്യാഹാരം', 'വെജ്', 'নিরামিষ', 'ভেজ', 'शाकाहारी', 'શાકાહારી'];
    const standaloneNonvegKeywords = ['nonveg', 'non-veg', 'मांसाहारी', 'नॉनवेज', 'మాంసాహారం', 'నాన్వెజ్', 'அசைவம்', 'நான்வெஜ்', 'ಮಾಂಸಾಹಾರ', 'നാന്വെജ്', 'മാംസാഹാരം', 'আমিষ', 'নন ভেজ', 'માંસાહારી'];
    
    // Check for egg-specific intent - only if standalone or with menu words
    // Compound patterns like "egg items" or "show egg" are fine
    const isEggCompound = eggPatterns.some(pattern => pattern.test(lowerText) && pattern.source.includes('\\s+'));
    const isEggStandalone = isStandaloneKeyword(standaloneEggKeywords);
    if (isEggCompound || isEggStandalone) {
      return { showMenu: true, foodType: 'egg', searchTerm: null };
    }
    
    // Check for non-veg-specific intent (before veg, since "non veg" contains "veg")
    // But first verify the text actually contains "non" to avoid false matches
    const hasNonPrefix = /\bnon[\s-]?veg/i.test(lowerText) || /\bnonveg/i.test(lowerText);
    const isNonvegCompound = hasNonPrefix && nonvegPatterns.some(pattern => pattern.test(lowerText));
    const isNonvegStandalone = isStandaloneKeyword(standaloneNonvegKeywords) || (hasNonPrefix && words.filter(w => !menuWords.includes(w) && w !== 'non' && w !== 'veg' && w !== 'nonveg' && w !== 'non-veg').length === 0);
    if (isNonvegCompound || isNonvegStandalone) {
      return { showMenu: true, foodType: 'nonveg', searchTerm: null };
    }
    
    // Check for veg-specific intent (only if not non-veg) - only standalone or compound
    const isVegCompound = vegPatterns.some(pattern => pattern.test(lowerText) && pattern.source.includes('\\s+'));
    const isVegStandalone = !hasNonPrefix && isStandaloneKeyword(standaloneVegKeywords);
    if (isVegCompound || isVegStandalone) {
      return { showMenu: true, foodType: 'veg', searchTerm: null };
    }
    
    // Check for general menu intent
    const isMenuIntent = menuPatterns.some(pattern => pattern.test(lowerText));
    if (isMenuIntent) {
      return { showMenu: true, foodType: 'both', searchTerm: null };
    }
    
    return null;
  },

  // Helper to detect track order intent from text/voice
  isTrackIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const trackPatterns = [
      // English
      /\btrack\b/, /\btrack order\b/, /\btrack my order\b/, /\btracking\b/,
      /\bwhere is my order\b/, /\bwhere'?s my order\b/, /\border location\b/,
      /\bdelivery status\b/, /\bwhen will.+arrive\b/, /\bwhere is.+order\b/,
      // Hindi
      /\bkahan hai\b/, /\bkab aayega\b/, /\border kahan\b/, /\btrack karo\b/,
      /\bट्रैक\b/, /\bकहां है\b/, /\bऑर्डर कहां है\b/, /\bकब आएगा\b/, /\bमेरा ऑर्डर कहां\b/,
      // Telugu
      /\bekkada undi\b/, /\border ekkada\b/, /\beppudu vastundi\b/, /\btrack cheyyi\b/,
      /\bట్రాక్\b/, /\bఎక్కడ ఉంది\b/, /\bనా ఆర్డర్ ఎక్కడ\b/, /\bఎప్పుడు వస్తుంది\b/,
      // Tamil
      /\benga irukku\b/, /\border enga\b/, /\bepppo varum\b/, /\btrack pannu\b/,
      /\bட்ராக்\b/, /\bஎங்கே இருக்கு\b/, /\bஆர்டர் எங்கே\b/, /\bஎப்போ வரும்\b/,
      // Kannada
      /\belli ide\b/, /\border elli\b/, /\byavaga baratte\b/, /\btrack maadi\b/,
      /\bಟ್ರ್ಯಾಕ್\b/, /\bಎಲ್ಲಿ ಇದೆ\b/, /\bಆರ್ಡರ್ ಎಲ್ಲಿ\b/,
      // Malayalam
      /\bevide und\b/, /\border evide\b/, /\beppol varum\b/, /\btrack cheyyuka\b/,
      /\bട്രാക്ക്\b/, /\bഎവിടെ ഉണ്ട്\b/, /\bഓർഡർ എവിടെ\b/,
      // Bengali
      /\bkothay ache\b/, /\border kothay\b/, /\bkokhon ashbe\b/, /\btrack koro\b/,
      /\bট্র্যাক\b/, /\bকোথায় আছে\b/, /\bঅর্ডার কোথায়\b/,
      // Marathi
      /\bkuthe aahe\b/, /\border kuthe\b/, /\bkevha yeil\b/, /\btrack kara\b/,
      /\bट्रॅक\b/, /\bकुठे आहे\b/, /\bऑर्डर कुठे\b/,
      // Gujarati
      /\bkya che\b/, /\border kya\b/, /\bkyare avshe\b/, /\btrack karo\b/,
      /\bટ્રેક\b/, /\bક્યાં છે\b/, /\bઓર્ડર ક્યાં\b/
    ];
    return trackPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect order status intent from text/voice
  isOrderStatusIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // First check if it's actually a cancel/refund/track intent - those take priority
    if (this.isCancelIntent(text) || this.isRefundIntent(text) || this.isTrackIntent(text)) {
      return false;
    }
    
    const statusPatterns = [
      // English
      /\border status\b/, /\bcheck order\b/, /\border history\b/, /\bprevious order\b/,
      /\bpast order\b/, /\bshow order\b/, /\bview order\b/, /\border details\b/,
      /\bmy orders\b/, /\bstatus\b/,
      // Hindi
      /\border kya hua\b/, /\border status kya hai\b/, /\border ka status\b/,
      /\bऑर्डर स्टेटस\b/, /\bऑर्डर क्या हुआ\b/, /\bस्टेटस\b/,
      // Telugu
      /\border status enti\b/, /\border em aindi\b/, /\bఆర్డర్ స్టేటస్\b/, /\bస్టేటస్\b/,
      // Tamil
      /\border status enna\b/, /\border enna achu\b/, /\bஆர்டர் ஸ்டேட்டஸ்\b/, /\bஸ்டேட்டஸ்\b/,
      // Kannada
      /\border status enu\b/, /\border enu aaytu\b/, /\bಆರ್ಡರ್ ಸ್ಟೇಟಸ್\b/, /\bಸ್ಟೇಟಸ್\b/,
      // Malayalam
      /\border status enthaanu\b/, /\border entha\b/, /\bഓർഡർ സ്റ്റാറ്റസ്\b/, /\bസ്റ്റാറ്റസ്\b/,
      // Bengali
      /\border status ki\b/, /\border ki holo\b/, /\bঅর্ডার স্ট্যাটাস\b/, /\bস্ট্যাটাস\b/,
      // Marathi
      /\border status kay\b/, /\border kay jhala\b/, /\bऑर्डर स्टेटस\b/, /\bस्टेटस\b/,
      // Gujarati
      /\border status shu\b/, /\border shu thyu\b/, /\bઓર્ડર સ્ટેટસ\b/, /\bસ્ટેટસ\b/
    ];
    return statusPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to find category by name
  findCategory(text, menuItems) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    const lowerText = text.toLowerCase();
    return categories.find(cat => cat.toLowerCase().includes(lowerText) || lowerText.includes(cat.toLowerCase()));
  },

  // Helper to find item by name
  findItem(text, menuItems) {
    const lowerText = text.toLowerCase();
    return menuItems.find(item => 
      item.name.toLowerCase().includes(lowerText) || 
      lowerText.includes(item.name.toLowerCase())
    );
  },

  // Helper to find items by tag keyword
  findItemsByTag(text, menuItems) {
    const lowerText = text.toLowerCase().trim();
    // Find all items that have a tag matching the keyword
    const matchingItems = menuItems.filter(item => 
      item.tags?.some(tag => 
        tag.toLowerCase().includes(lowerText) || 
        lowerText.includes(tag.toLowerCase())
      )
    );
    return matchingItems.length > 0 ? matchingItems : null;
  },

  // Helper to find items by name OR tag keyword (returns all matching items)
  findItemsByNameOrTag(text, menuItems) {
    const lowerText = text.toLowerCase().trim();
    if (lowerText.length < 2) return null; // Skip very short searches
    
    const matchingItems = menuItems.filter(item => {
      // Check if name matches
      const nameMatch = item.name.toLowerCase().includes(lowerText) || 
        lowerText.includes(item.name.toLowerCase());
      
      // Check if any tag matches
      const tagMatch = item.tags?.some(tag => 
        tag.toLowerCase().includes(lowerText) || 
        lowerText.includes(tag.toLowerCase())
      );
      
      return nameMatch || tagMatch;
    });
    
    return matchingItems.length > 0 ? matchingItems : null;
  },

  // Helper to detect food type preference from message text
  // Returns: 'veg', 'nonveg', 'egg', or specific ingredient like 'chicken', 'mutton', etc.
  detectFoodTypeFromMessage(text) {
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // Check for specific non-veg ingredients first (most specific)
    const specificNonveg = [
      { pattern: /\bchicken\b/, type: 'chicken' },
      { pattern: /\bmutton\b/, type: 'mutton' },
      { pattern: /\bfish\b/, type: 'fish' },
      { pattern: /\bprawn\b/, type: 'prawn' },
      { pattern: /\bkeema\b/, type: 'keema' },
      { pattern: /\bbeef\b/, type: 'beef' },
      { pattern: /\bpork\b/, type: 'pork' },
      { pattern: /\bseafood\b/, type: 'seafood' },
    ];
    
    for (const item of specificNonveg) {
      if (item.pattern.test(lowerText)) {
        return { type: 'specific', ingredient: item.type };
      }
    }
    
    // Check for egg specifically
    if (/\begg\b/.test(lowerText) && !/\beggless\b/.test(lowerText)) {
      return { type: 'egg' };
    }
    
    // Check for nonveg general keywords (with space variations)
    const nonvegPatterns = [/\bnonveg\b/, /\bnon-veg\b/, /\bnon\s+veg\b/, /\bmeat\b/];
    const hasNonveg = nonvegPatterns.some(pattern => pattern.test(lowerText));
    
    // Check for veg keywords - but make sure "non veg" doesn't match as "veg"
    const hasNonVegPhrase = /\bnon[\s-]?veg/.test(lowerText);
    const vegPatterns = [/\bveg\b/, /\bvegetarian\b/, /\bveggie\b/, /\bpure veg\b/, /\beggless\b/];
    const hasVeg = !hasNonVegPhrase && vegPatterns.some(pattern => pattern.test(lowerText));
    
    if (hasVeg && !hasNonveg) return { type: 'veg' };
    if (hasNonveg) return { type: 'nonveg' }; // nonveg includes egg
    
    return null;
  },

  // Helper to remove food type keywords from search text
  // Only removes general food type keywords (veg/nonveg), NOT specific ingredients like chicken/mutton
  removeFoodTypeKeywords(text) {
    let cleanText = text.toLowerCase();
    // Remove only general food type keywords, keep specific ingredients for search
    const patterns = [
      /\bpure veg\b/gi, /\bnon[\s-]?veg\b/gi,  // Multi-word first
      /\bvegetarian\b/gi, /\bveggie\b/gi, /\bveg\b/gi,
      /\bnonveg\b/gi
      // Removed: chicken, mutton, fish, prawn, egg, meat, keema, beef, pork, seafood
      // These are kept for searching items by ingredient
    ];
    patterns.forEach(pattern => {
      cleanText = cleanText.replace(pattern, ' ');
    });
    return cleanText.trim().replace(/\s+/g, ' ');
  },

  // Food synonyms - regional/local names mapped to common English equivalents
  // Used to expand search terms for better matching
  foodSynonyms: {
    // Telugu/South Indian curry terms
    'pulusu': ['curry', 'gravy', 'pulusu'],
    'kura': ['curry', 'sabji', 'vegetable'],
    'koora': ['curry', 'sabji', 'vegetable'],
    'iguru': ['fry', 'dry curry', 'roast'],
    'vepudu': ['fry', 'stir fry'],
    'perugu': ['curd', 'yogurt', 'dahi'],
    'pappu': ['dal', 'lentils'],
    'charu': ['rasam', 'soup'],
    'pachadi': ['chutney', 'raita'],
    'pulihora': ['tamarind rice', 'puliyogare'],
    'annam': ['rice', 'chawal'],
    // Tamil terms
    'kuzhambu': ['curry', 'gravy', 'kulambu'],
    'kozhi': ['chicken', 'kodi'],
    'meen': ['fish', 'chepa'],
    'kari': ['curry', 'meat curry'],
    'varuval': ['fry', 'roast'],
    'poriyal': ['stir fry', 'vegetable fry'],
    'kootu': ['curry', 'mixed vegetable'],
    'thokku': ['pickle', 'chutney'],
    // Hindi terms
    'sabzi': ['curry', 'vegetable', 'sabji'],
    'rassa': ['curry', 'gravy'],
    'bhaji': ['fry', 'vegetable fry'],
    'tarkari': ['curry', 'vegetable'],
    // Common variations
    'curry': ['curry', 'gravy', 'kura', 'pulusu', 'kuzhambu'],
    'gravy': ['curry', 'gravy', 'rassa'],
    'fry': ['fry', 'vepudu', 'varuval', 'roast'],
    'biryani': ['biryani', 'biriyani', 'briyani'],
    'rice': ['rice', 'annam', 'chawal', 'bhat']
  },

  // Get synonyms for a search term
  getSynonyms(term) {
    const lowerTerm = term.toLowerCase();
    const synonyms = [lowerTerm];
    
    // Check if term has synonyms
    if (this.foodSynonyms[lowerTerm]) {
      synonyms.push(...this.foodSynonyms[lowerTerm]);
    }
    
    // Also check if term is a synonym of something else
    for (const [key, values] of Object.entries(this.foodSynonyms)) {
      if (values.includes(lowerTerm) && !synonyms.includes(key)) {
        synonyms.push(key);
      }
    }
    
    return [...new Set(synonyms)];
  },

  // Helper to transliterate regional language words to English equivalents (basic mapping)
  transliterate(text) {
    const transliterationMap = {
      // Hindi to English - Common food items
      'ब्रेड': 'bread', 'रोटी': 'roti', 'चावल': 'rice', 'दाल': 'dal',
      'सब्जी': 'sabji', 'पनीर': 'paneer', 'चिकन': 'chicken', 'मटन': 'mutton',
      'बिरयानी': 'biryani', 'पुलाव': 'pulao', 'नान': 'naan', 'पराठा': 'paratha',
      'समोसा': 'samosa', 'पकोड़ा': 'pakoda', 'चाय': 'tea', 'कॉफी': 'coffee',
      'लस्सी': 'lassi', 'जूस': 'juice', 'पानी': 'water', 'कोल्ड ड्रिंक': 'cold drink',
      'आइसक्रीम': 'ice cream', 'केक': 'cake', 'मिठाई': 'sweet', 'गुलाब जामुन': 'gulab jamun',
      'पिज़्ज़ा': 'pizza', 'बर्गर': 'burger', 'सैंडविच': 'sandwich', 'मोमो': 'momo',
      'नूडल्स': 'noodles', 'फ्राइड राइस': 'fried rice', 'मंचूरियन': 'manchurian',
      'सूप': 'soup', 'सलाद': 'salad', 'फ्राइज़': 'fries', 'चिप्स': 'chips',
      'अंडा': 'egg', 'आमलेट': 'omelette', 'मछली': 'fish', 'झींगा': 'prawn',
      'तंदूरी': 'tandoori', 'कबाब': 'kabab', 'टिक्का': 'tikka', 'कोरमा': 'korma',
      'करी': 'curry', 'मसाला': 'masala', 'फ्राइड': 'fried', 'ग्रिल्ड': 'grilled',
      'दही': 'curd', 'पेरुगु': 'curd', 'छाछ': 'buttermilk', 'खीर': 'kheer',
      'तंदूरी चिकन': 'tandoori chicken', 'चिकन टिक्का': 'chicken tikka', 'मटन करी': 'mutton curry',
      'पनीर टिक्का': 'paneer tikka', 'दाल मखनी': 'dal makhani', 'बटर चिकन': 'butter chicken',
      'चिकन बिरयानी': 'chicken biryani', 'मटन बिरयानी': 'mutton biryani', 'थाली': 'thali',
      'चिकन थाली': 'chicken thali', 'वेज थाली': 'veg thali', 'स्पेशल थाली': 'special thali',
      // Telugu to English
      'బ్రెడ్': 'bread', 'అన్నం': 'rice', 'చికెన్': 'chicken', 'మటన్': 'mutton',
      'బిర్యానీ': 'biryani', 'కేక్': 'cake', 'పిజ్జా': 'pizza', 'బర్గర్': 'burger',
      'నూడుల్స్': 'noodles', 'ఐస్ క్రీమ్': 'ice cream', 'టీ': 'tea', 'కాఫీ': 'coffee',
      'పెరుగు': 'curd', 'పెరుగు అన్నం': 'curd rice', 'సాంబార్': 'sambar', 'రసం': 'rasam',
      'పప్పు': 'dal', 'కూర': 'curry', 'పచ్చడి': 'chutney', 'అప్పడం': 'papad',
      'పూరీ': 'poori', 'ఇడ్లీ': 'idli', 'దోశ': 'dosa', 'ఉప్మా': 'upma', 'వడ': 'vada',
      'కోడి': 'chicken', 'కోడి బిర్యానీ': 'chicken biryani', 'గుడ్డు': 'egg', 'చేప': 'fish',
      'రొయ్యలు': 'prawns', 'మటన్ బిర్యానీ': 'mutton biryani', 'పులావ్': 'pulao',
      'ఫ్రైడ్ రైస్': 'fried rice', 'నూడిల్స్': 'noodles', 'మంచూరియన్': 'manchurian',
      'పులిహోర': 'pulihora', 'పులిహోర': 'tamarind rice', 'దద్దోజనం': 'curd rice',
      'చిత్రాన్నం': 'chitranna', 'లెమన్ రైస్': 'lemon rice', 'టమాటో రైస్': 'tomato rice',
      'కొబ్బరి అన్నం': 'coconut rice', 'పొంగల్': 'pongal', 'అట్టు': 'dosa',
      'పెసరట్టు': 'pesarattu', 'మసాలా దోశ': 'masala dosa', 'రవ్వ దోశ': 'rava dosa',
      'మైసూర్ బజ్జి': 'mysore bajji', 'మిర్చి బజ్జి': 'mirchi bajji', 'ఆలూ బజ్జి': 'aloo bajji',
      'గారెలు': 'garelu', 'బొబ్బట్లు': 'bobbatlu', 'పాయసం': 'payasam', 'కేసరి': 'kesari',
      // Telugu - Gongura and other Andhra dishes
      'గొంగూర': 'gongura', 'గొంగూర చికెన్': 'gongura chicken', 'గొంగూర మటన్': 'gongura mutton',
      'గొంగూర పచ్చడి': 'gongura chutney', 'గొంగూర పప్పు': 'gongura dal',
      'గుత్తి వంకాయ': 'gutti vankaya', 'వంకాయ': 'brinjal', 'బెండకాయ': 'okra',
      'ఆలూ': 'potato', 'టమాటో': 'tomato', 'ఉల్లి': 'onion', 'వెల్లుల్లి': 'garlic',
      'అల్లం': 'ginger', 'మిరపకాయ': 'chilli', 'కరివేపాకు': 'curry leaves',
      'చికెన్ కర్రీ': 'chicken curry', 'మటన్ కర్రీ': 'mutton curry', 'చేప కర్రీ': 'fish curry',
      'చికెన్ ఫ్రై': 'chicken fry', 'మటన్ ఫ్రై': 'mutton fry', 'చేప ఫ్రై': 'fish fry',
      'చికెన్ 65': 'chicken 65', 'చికెన్ లాలీపాప్': 'chicken lollipop',
      'పరోటా': 'parotta', 'కొత్తు పరోటా': 'kothu parotta', 'చిల్లీ పరోటా': 'chilli parotta',
      'చపాతీ': 'chapati', 'నాన్': 'naan', 'రొట్టె': 'roti',
      'తందూరి': 'tandoori', 'తందూరి చికెన్': 'tandoori chicken', 'కబాబ్': 'kabab',
      'పులుసు': 'pulusu', 'చేపల పులుసు': 'fish pulusu', 'రొయ్యల పులుసు': 'prawn pulusu',
      'ఆవకాయ': 'avakaya', 'మామిడికాయ': 'raw mango',
      // Tamil to English
      'பிரெட்': 'bread', 'சோறு': 'rice', 'சிக்கன்': 'chicken', 'மட்டன்': 'mutton',
      'பிரியாணி': 'biryani', 'கேக்': 'cake', 'பீட்சா': 'pizza', 'பர்கர்': 'burger',
      'தயிர்': 'curd', 'தயிர் சாதம்': 'curd rice', 'சாம்பார்': 'sambar', 'ரசம்': 'rasam',
      'இட்லி': 'idli', 'தோசை': 'dosa', 'உப்புமா': 'upma', 'வடை': 'vada', 'பூரி': 'poori',
      'கோழி': 'chicken', 'கோழி பிரியாணி': 'chicken biryani', 'முட்டை': 'egg', 'மீன்': 'fish',
      'புளியோதரை': 'puliyodharai', 'எலுமிச்சை சாதம்': 'lemon rice', 'தக்காளி சாதம்': 'tomato rice',
      'தேங்காய் சாதம்': 'coconut rice', 'பொங்கல்': 'pongal', 'மசாலா தோசை': 'masala dosa',
      'இறால்': 'prawns', 'ஆட்டு இறைச்சி': 'mutton',
      // Tamil - Gongura and other South Indian dishes
      'கொங்கூரா': 'gongura', 'கொங்கூரா சிக்கன்': 'gongura chicken', 'கொங்கூரா மட்டன்': 'gongura mutton',
      'கொங்கூரா கோழி': 'gongura chicken', 'கொங்கூரா ஆட்டு': 'gongura mutton',
      'கத்திரிக்காய்': 'brinjal', 'வெண்டைக்காய்': 'okra', 'உருளைக்கிழங்கு': 'potato',
      'தக்காளி': 'tomato', 'வெங்காயம்': 'onion', 'பூண்டு': 'garlic', 'இஞ்சி': 'ginger',
      'கறி': 'curry', 'குழம்பு': 'curry', 'கூட்டு': 'kootu', 'பொரியல்': 'poriyal',
      'அவியல்': 'avial', 'கூட்டு': 'kootu', 'வறுவல்': 'fry', 'பொடிமாஸ்': 'podimas',
      'சிக்கன் கறி': 'chicken curry', 'மட்டன் கறி': 'mutton curry', 'மீன் கறி': 'fish curry',
      'சிக்கன் வறுவல்': 'chicken fry', 'மட்டன் வறுவல்': 'mutton fry', 'மீன் வறுவல்': 'fish fry',
      'சிக்கன் 65': 'chicken 65', 'சிக்கன் லாலிபாப்': 'chicken lollipop',
      'பரோட்டா': 'parotta', 'கொத்து பரோட்டா': 'kothu parotta', 'சில்லி பரோட்டா': 'chilli parotta',
      'நூடுல்ஸ்': 'noodles', 'ஃப்ரைட் ரைஸ்': 'fried rice', 'மஞ்சூரியன்': 'manchurian',
      'பனீர்': 'paneer', 'பனீர் பட்டர் மசாலா': 'paneer butter masala',
      'சப்பாத்தி': 'chapati', 'நான்': 'naan', 'ரொட்டி': 'roti',
      'பிரியாணி சிக்கன்': 'chicken biryani', 'பிரியாணி மட்டன்': 'mutton biryani',
      'தந்தூரி': 'tandoori', 'தந்தூரி சிக்கன்': 'tandoori chicken', 'கபாப்': 'kabab',
      'சாதம்': 'rice', 'அன்னம்': 'rice', 'சாதம் சாம்பார்': 'sambar rice',
      // Kannada to English
      'ಬ್ರೆಡ್': 'bread', 'ಅನ್ನ': 'rice', 'ಚಿಕನ್': 'chicken', 'ಮಟನ್': 'mutton',
      'ಬಿರಿಯಾನಿ': 'biryani', 'ಕೇಕ್': 'cake', 'ಪಿಜ್ಜಾ': 'pizza',
      'ಮೊಸರು': 'curd', 'ಮೊಸರನ್ನ': 'curd rice', 'ಸಾಂಬಾರ್': 'sambar', 'ರಸಂ': 'rasam',
      'ಇಡ್ಲಿ': 'idli', 'ದೋಸೆ': 'dosa', 'ಉಪ್ಪಿಟ್ಟು': 'upma', 'ವಡೆ': 'vada',
      'ಕೋಳಿ': 'chicken', 'ಮೊಟ್ಟೆ': 'egg', 'ಮೀನು': 'fish',
      // Bengali to English
      'রুটি': 'bread', 'ভাত': 'rice', 'মুরগি': 'chicken', 'মাংস': 'mutton',
      'বিরিয়ানি': 'biryani', 'কেক': 'cake', 'পিৎজা': 'pizza',
      'ডিম': 'egg', 'মাছ': 'fish', 'চিংড়ি': 'prawns',
      'দই': 'curd', 'দই ভাত': 'curd rice',
      'চিকেন': 'chicken', 'চিকেন থালি': 'chicken thali', 'চিকেন বিরিয়ানি': 'chicken biryani',
      'মাটন': 'mutton', 'থালি': 'thali', 'তন্দুরি': 'tandoori', 'তন্দুরি চিকেন': 'tandoori chicken',
      // Malayalam to English
      'ബ്രെഡ്': 'bread', 'ചോറ്': 'rice', 'ചിക്കൻ': 'chicken', 'മട്ടൻ': 'mutton',
      'ബിരിയാണി': 'biryani', 'കേക്ക്': 'cake', 'പിസ്സ': 'pizza',
      'തൈര്': 'curd', 'തൈര് സാദം': 'curd rice', 'സാമ്പാർ': 'sambar', 'രസം': 'rasam',
      'താലി': 'thali', 'ചിക്കൻ താലി': 'chicken thali',
      // Common transliterations (romanized regional food names)
      'chawal': 'rice', 'roti': 'roti', 'daal': 'dal', 'sabzi': 'sabji',
      'chai': 'tea', 'doodh': 'milk', 'pani': 'water', 'anda': 'egg',
      'gosht': 'mutton', 'murgh': 'chicken', 'machli': 'fish',
      'dahi': 'curd', 'perugu': 'curd', 'thayir': 'curd', 'mosaru': 'curd',
      'tandoori': 'tandoori', 'tikka': 'tikka', 'thali': 'thali', 'korma': 'korma',
      // Telugu romanized
      'pulihora': 'tamarind rice', 'pulihoura': 'tamarind rice', 'pulihara': 'tamarind rice',
      'perugu annam': 'curd rice', 'perugu anna': 'curd rice', 'perugannam': 'curd rice',
      'daddojanam': 'curd rice', 'dadhojanam': 'curd rice',
      'pesarattu': 'pesarattu', 'pesaratu': 'pesarattu',
      'mirchi bajji': 'mirchi bajji', 'mirchi pakoda': 'mirchi bajji',
      'aloo bajji': 'aloo bajji', 'punugulu': 'punugulu',
      'garelu': 'vada', 'gaarelu': 'vada', 'medu vada': 'vada',
      'bobbatlu': 'bobbatlu', 'bobatlu': 'bobbatlu', 'puran poli': 'bobbatlu',
      'payasam': 'payasam', 'kheer': 'kheer', 'kesari': 'kesari',
      'pongal': 'pongal', 'ven pongal': 'pongal',
      'chitranna': 'lemon rice', 'chitrannam': 'lemon rice',
      'tomato rice': 'tomato rice', 'tomato bath': 'tomato rice',
      'coconut rice': 'coconut rice', 'kobbari annam': 'coconut rice',
      'lemon rice': 'lemon rice', 'nimma kaya annam': 'lemon rice',
      // Gongura and Andhra romanized
      'gongura': 'gongura', 'gongura chicken': 'gongura chicken', 'gongura mutton': 'gongura mutton',
      'gongura pachadi': 'gongura chutney', 'gongura pappu': 'gongura dal',
      'gutti vankaya': 'stuffed brinjal', 'vankaya': 'brinjal', 'bendakaya': 'okra',
      'pulusu': 'pulusu', 'chepala pulusu': 'fish pulusu', 'royyala pulusu': 'prawn pulusu',
      'avakaya': 'avakaya pickle', 'mamidikaya': 'raw mango',
      'koora': 'curry', 'kura': 'curry', 'fry': 'fry', 'iguru': 'dry curry',
      // Tamil romanized
      'puliyodharai': 'tamarind rice', 'puliyodarai': 'tamarind rice',
      'thayir sadam': 'curd rice', 'thayir sadham': 'curd rice', 'curd rice': 'curd rice',
      'sambar rice': 'sambar rice', 'sambar sadam': 'sambar rice',
      'rasam rice': 'rasam rice', 'rasam sadam': 'rasam rice',
      // Common South Indian
      'idli': 'idli', 'idly': 'idli', 'idle': 'idli',
      'dosa': 'dosa', 'dosai': 'dosa', 'dhosha': 'dosa',
      'masala dosa': 'masala dosa', 'masale dose': 'masala dosa',
      'rava dosa': 'rava dosa', 'ravva dosa': 'rava dosa',
      'uttapam': 'uttapam', 'uthappam': 'uttapam',
      'upma': 'upma', 'uppuma': 'upma', 'uppit': 'upma',
      'vada': 'vada', 'vadai': 'vada', 'wade': 'vada',
      'poori': 'poori', 'puri': 'poori', 'luchi': 'poori',
      'chapati': 'chapati', 'chapathi': 'chapati', 'roti': 'roti', 'phulka': 'roti',
      'paratha': 'paratha', 'parotta': 'paratha', 'paratha': 'paratha',
      'naan': 'naan', 'nan': 'naan',
      'biryani': 'biryani', 'biriyani': 'biryani', 'briyani': 'biryani',
      'pulao': 'pulao', 'pulav': 'pulao', 'pilaf': 'pulao',
      'fried rice': 'fried rice', 'friedrice': 'fried rice',
      'noodles': 'noodles', 'noodels': 'noodles',
      'manchurian': 'manchurian', 'manchuria': 'manchurian',
      'gobi': 'gobi', 'gobhi': 'gobi', 'cauliflower': 'gobi',
      'paneer': 'paneer', 'panner': 'paneer',
      'chicken': 'chicken', 'chiken': 'chicken', 'chikken': 'chicken',
      'mutton': 'mutton', 'muttom': 'mutton',
      'fish': 'fish', 'fis': 'fish',
      'prawns': 'prawns', 'prawn': 'prawns', 'shrimp': 'prawns',
      'egg': 'egg', 'eggs': 'egg', 'anda': 'egg'
    };
    
    let result = text;
    for (const [regional, english] of Object.entries(transliterationMap)) {
      if (text.toLowerCase().includes(regional.toLowerCase())) {
        result = result.replace(new RegExp(regional, 'gi'), english);
      }
    }
    return result;
  },

  // Translate text using Groq AI (for languages not in basic map)
  // Returns object with primary translation and all variations for better search
  async translateWithAI(text) {
    // Check if text contains non-English characters
    const hasNonEnglish = /[^\x00-\x7F]/.test(text);
    
    if (hasNonEnglish) {
      // For non-English text, use Groq AI to get multiple translation variations
      try {
        const result = await groqAi.translateToEnglish(text);
        
        // If we got valid variations, return them
        if (result.variations && result.variations.length > 0 && !/[^\x00-\x7F]/.test(result.primary)) {
          return result;
        }
        
        // If AI translation failed, try word-by-word
        const words = text.split(/\s+/).filter(w => w.length > 0);
        if (words.length > 1) {
          const allVariations = [];
          const translatedWords = [];
          
          for (const word of words) {
            if (/[^\x00-\x7F]/.test(word)) {
              const wordResult = await groqAi.translateToEnglish(word);
              if (wordResult.variations && wordResult.variations.length > 0) {
                translatedWords.push(wordResult.primary);
                allVariations.push(...wordResult.variations);
              } else {
                // Fallback to basic map
                const basicWord = this.transliterate(word);
                translatedWords.push(basicWord);
                allVariations.push(basicWord);
              }
            } else {
              translatedWords.push(word);
              allVariations.push(word);
            }
          }
          
          const combinedTranslation = translatedWords.join(' ');
          allVariations.push(combinedTranslation);
          
          // Remove duplicates and non-English
          const cleanVariations = [...new Set(allVariations)].filter(v => !/[^\x00-\x7F]/.test(v));
          
          console.log(`🔤 Word-by-word translation: "${text}" → [${cleanVariations.join(', ')}]`);
          return { primary: combinedTranslation, variations: cleanVariations };
        }
        
        // Last resort: try basic transliteration
        const basicTranslated = this.transliterate(text);
        return { primary: basicTranslated, variations: [basicTranslated] };
      } catch (error) {
        console.error('AI translation failed:', error.message);
        const basicTranslated = this.transliterate(text);
        return { primary: basicTranslated, variations: [basicTranslated] };
      }
    }
    
    // For English/romanized text, first try basic transliteration
    const basicTranslated = this.transliterate(text);
    const variations = [text.toLowerCase()];
    
    // If basic translation changed the text, add it
    if (basicTranslated.toLowerCase() !== text.toLowerCase()) {
      variations.push(basicTranslated.toLowerCase());
    }
    
    // For romanized text, try Groq AI to get more variations
    if (text.length >= 3) {
      try {
        const aiResult = await groqAi.translateRomanizedFood(text);
        if (aiResult && aiResult.toLowerCase() !== text.toLowerCase()) {
          variations.push(aiResult.toLowerCase());
        }
      } catch (error) {
        console.error('AI romanized translation failed:', error.message);
      }
    }
    
    // Remove duplicates
    const cleanVariations = [...new Set(variations)];
    
    return { primary: cleanVariations[0], variations: cleanVariations };
  },

  // Smart search - detects food type and searches by name/tag (async for AI translation)
  // Improved: EXACT match returns single item, otherwise searches with variations
  async smartSearch(text, menuItems) {
    // First translate regional language to English using AI (returns variations)
    const translationResult = await this.translateWithAI(text);
    const primaryText = translationResult.primary.toLowerCase().trim();
    const allVariations = translationResult.variations || [primaryText];
    
    if (primaryText.length < 2) return null;
    
    // Detect food type preference from primary translation
    const detected = this.detectFoodTypeFromMessage(primaryText);
    
    // Remove food type keywords to get clean search terms
    const primarySearchTerm = this.removeFoodTypeKeywords(primaryText);
    
    // Get all search variations (cleaned of food type keywords)
    const searchVariations = allVariations.map(v => this.removeFoodTypeKeywords(v.toLowerCase())).filter(v => v.length >= 2);
    
    // Expand search terms with synonyms (e.g., "pulusu" → ["pulusu", "curry", "gravy"])
    const expandedTerms = [];
    for (const term of searchVariations) {
      expandedTerms.push(term);
      // Get synonyms for each word in the term
      const words = term.split(/\s+/).filter(w => w.length >= 2);
      for (const word of words) {
        const synonyms = this.getSynonyms(word);
        expandedTerms.push(...synonyms);
      }
    }
    
    // Add unique variations (including synonyms)
    const uniqueSearchTerms = [...new Set(expandedTerms)];
    console.log(`🔍 Search terms with synonyms: [${uniqueSearchTerms.join(', ')}]`);
    
    // If search term is too short after removing keywords, search by ingredient/type only
    const hasSearchTerm = primarySearchTerm.length >= 2;
    
    // Helper to normalize text for comparison (removes spaces for flexible matching)
    const normalizeForMatch = (text) => text.toLowerCase().replace(/\s+/g, '');
    
    // ========== CHECK FOR EXACT NAME MATCH FIRST ==========
    // If search term exactly matches item name(s) (with or without spaces), return ALL exact matches
    if (hasSearchTerm) {
      for (const searchTerm of uniqueSearchTerms) {
        const searchLower = searchTerm.toLowerCase();
        const searchNorm = normalizeForMatch(searchTerm);
        
        // Find ALL items with exact name match (not just first one)
        const exactMatches = menuItems.filter(item => {
          const nameLower = item.name.toLowerCase();
          const nameNorm = normalizeForMatch(item.name);
          // Match exact (with spaces) OR normalized (without spaces)
          return nameLower === searchLower || nameNorm === searchNorm;
        });
        
        if (exactMatches.length > 0) {
          console.log(`✅ Exact match found: "${searchTerm}" → ${exactMatches.length} item(s)`);
          return { 
            items: exactMatches, 
            foodType: detected, 
            searchTerm: searchTerm, 
            label: null,
            exactMatch: true 
          };
        }
      }
    }
    
    // Filter by detected food type
    let filteredItems = menuItems;
    let foodTypeLabel = null;
    
    if (detected) {
      if (detected.type === 'veg') {
        filteredItems = menuItems.filter(item => item.foodType === 'veg');
        foodTypeLabel = '🥦 Veg';
      } else if (detected.type === 'egg') {
        filteredItems = menuItems.filter(item => item.foodType === 'egg');
        foodTypeLabel = '🥚 Egg';
      } else if (detected.type === 'nonveg') {
        filteredItems = menuItems.filter(item => item.foodType === 'nonveg' || item.foodType === 'egg');
        foodTypeLabel = '🍗 Non-Veg';
      } else if (detected.type === 'specific') {
        const ingredient = detected.ingredient;
        filteredItems = menuItems.filter(item => {
          const inName = item.name.toLowerCase().includes(ingredient);
          const inTags = item.tags?.some(tag => tag.toLowerCase().includes(ingredient));
          return inName || inTags;
        });
        foodTypeLabel = `🍗 ${ingredient.charAt(0).toUpperCase() + ingredient.slice(1)}`;
        
        if (!hasSearchTerm) {
          return filteredItems.length > 0 
            ? { items: filteredItems, foodType: detected, searchTerm: ingredient, label: foodTypeLabel }
            : null;
        }
      }
    }
    
    if (!hasSearchTerm && detected?.type !== 'specific') return null;
    
    // Helper to normalize text for comparison (removes spaces for flexible matching)
    // "ground nuts" → "groundnuts", "veg biryani" → "vegbiryani"
    const normalizeText = (text) => text.toLowerCase().replace(/\s+/g, '');
    
    // Helper to check if two strings match (with or without spaces)
    // Matches: "groundnuts" with "ground nuts", "vegbiryani" with "veg biryani"
    const flexibleMatch = (str1, str2) => {
      const norm1 = normalizeText(str1);
      const norm2 = normalizeText(str2);
      return norm1 === norm2 || norm1.includes(norm2) || norm2.includes(norm1);
    };
    
    // Helper to find ALL items with exact tag match (flexible - handles spaces)
    const findAllExactTagMatches = (items, term) => {
      const termNorm = normalizeText(term);
      return items.filter(item => 
        item.tags?.some(tag => {
          const tagNorm = normalizeText(tag);
          return tagNorm === termNorm || tagNorm === term.toLowerCase();
        })
      );
    };
    
    // Non-veg ingredient keywords - if search contains these, filter out veg items
    const nonVegKeywords = ['mutton', 'chicken', 'fish', 'prawn', 'prawns', 'egg', 'meat', 'keema', 'beef', 'pork', 'seafood', 'crab', 'lobster', 'lamb', 'goat', 'kodi', 'mamsam', 'chepa', 'royyalu'];
    
    // Veg-only keywords - if search contains ONLY these (no non-veg), filter out non-veg items
    const vegKeywords = ['paneer', 'dal', 'sabji', 'vegetable', 'aloo', 'gobi', 'palak', 'mushroom', 'tofu', 'soya', 'rajma', 'chole', 'chana'];
    
    // Check if search contains non-veg keywords
    const searchLower = primarySearchTerm.toLowerCase();
    const hasNonVegKeyword = nonVegKeywords.some(kw => searchLower.includes(kw));
    const hasVegKeyword = vegKeywords.some(kw => searchLower.includes(kw));
    
    // Determine food type filter based on search keywords
    let searchFoodTypeFilter = null;
    if (hasNonVegKeyword && !hasVegKeyword) {
      searchFoodTypeFilter = 'nonveg'; // Search has non-veg ingredient, show only non-veg/egg
    } else if (hasVegKeyword && !hasNonVegKeyword) {
      searchFoodTypeFilter = 'veg'; // Search has veg ingredient, show only veg
    }
    // If neither or both, show all (generic search like "curry", "biryani")
    
    // ========== CHECK FOR EXACT TAG MATCH - COLLECT ALL MATCHING ITEMS FROM ALL KEYWORDS ==========
    if (hasSearchTerm) {
      const allTagMatches = new Map(); // Use Map to avoid duplicates
      
      // Split search into individual keywords and include synonyms
      const allKeywords = [];
      for (const searchTerm of uniqueSearchTerms) {
        const words = searchTerm.split(/\s+/).filter(w => w.length >= 2);
        allKeywords.push(...words);
      }
      const uniqueKeywords = [...new Set(allKeywords)];
      
      console.log(`🔍 Searching tags for keywords: [${uniqueKeywords.join(', ')}], foodTypeFilter: ${searchFoodTypeFilter || 'all'}`);
      
      // Search each keyword and collect all matching items
      for (const keyword of uniqueKeywords) {
        let matches = findAllExactTagMatches(filteredItems, keyword);
        if (matches.length === 0) {
          matches = findAllExactTagMatches(menuItems, keyword);
        }
        
        for (const item of matches) {
          const id = item._id.toString();
          if (!allTagMatches.has(id)) {
            // Apply food type filter based on search keywords
            if (searchFoodTypeFilter === 'nonveg') {
              // Non-veg search: only include non-veg and egg items
              if (item.foodType === 'nonveg' || item.foodType === 'egg') {
                allTagMatches.set(id, item);
              }
            } else if (searchFoodTypeFilter === 'veg') {
              // Veg search: only include veg items
              if (item.foodType === 'veg') {
                allTagMatches.set(id, item);
              }
            } else {
              // Generic search: include all
              allTagMatches.set(id, item);
            }
          }
        }
      }
      
      if (allTagMatches.size > 0) {
        const matchedItems = Array.from(allTagMatches.values());
        console.log(`✅ Tag matches found: ${matchedItems.length} items for keywords [${uniqueKeywords.join(', ')}]`);
        return { 
          items: matchedItems, 
          foodType: detected, 
          searchTerm: primarySearchTerm, 
          label: null,
          exactMatch: true 
        };
      }
    }
    
    // Helper function to search items by a term (checks tags first, then name)
    // Now handles flexible matching (with/without spaces)
    const searchByTerm = (items, term) => {
      if (!term || term.length < 2) return [];
      const termLower = term.toLowerCase();
      const termNorm = normalizeText(term);
      
      const tagMatches = items.filter(item => 
        item.tags?.some(tag => {
          const tagLower = tag.toLowerCase();
          const tagNorm = normalizeText(tag);
          // Match with spaces or without spaces
          return tagLower.includes(termLower) || termLower.includes(tagLower) ||
                 tagNorm.includes(termNorm) || termNorm.includes(tagNorm);
        })
      );
      
      const tagMatchIds = new Set(tagMatches.map(i => i._id.toString()));
      const nameMatches = items.filter(item => {
        if (tagMatchIds.has(item._id.toString())) return false;
        const nameLower = item.name.toLowerCase();
        const nameNorm = normalizeText(item.name);
        // Match with spaces or without spaces
        return nameLower.includes(termLower) || termLower.includes(nameLower) ||
               nameNorm.includes(termNorm) || termNorm.includes(nameNorm);
      });
      
      return [...tagMatches, ...nameMatches];
    };
    
    // Helper to search by multiple terms/keywords and combine results
    const searchByMultipleTerms = (items, terms) => {
      const itemMatches = new Map();
      
      for (const term of terms) {
        if (term.length < 2) continue;
        const termLower = term.toLowerCase();
        const termNorm = normalizeText(term);
        
        // Check for exact name match first (highest priority) - flexible matching
        for (const item of items) {
          const nameLower = item.name.toLowerCase();
          const nameNorm = normalizeText(item.name);
          if (nameLower === termLower || nameNorm === termNorm) {
            const id = item._id.toString();
            if (!itemMatches.has(id)) {
              itemMatches.set(id, { item, score: 0 });
            }
            itemMatches.get(id).score += 100; // Exact name match = 100 points
          }
        }
        
        // Check for exact tag match (high priority) - flexible matching
        for (const item of items) {
          if (item.tags?.some(tag => {
            const tagLower = tag.toLowerCase();
            const tagNorm = normalizeText(tag);
            return tagLower === termLower || tagNorm === termNorm;
          })) {
            const id = item._id.toString();
            if (!itemMatches.has(id)) {
              itemMatches.set(id, { item, score: 0 });
            }
            itemMatches.get(id).score += 50; // Exact tag match = 50 points
          }
        }
        
        // Search partial term matches
        const matches = searchByTerm(items, term);
        for (const item of matches) {
          const id = item._id.toString();
          if (!itemMatches.has(id)) {
            itemMatches.set(id, { item, score: 0 });
          }
          itemMatches.get(id).score += 10; // Partial term match = 10 points
        }
        
        // Also search individual keywords from this term (e.g., "mutton pulusu" → search "mutton" and "pulusu" separately)
        const keywords = term.split(/\s+/).filter(k => k.length >= 2);
        if (keywords.length > 1) {
          // Multi-word search - search each keyword and add matching items
          for (const keyword of keywords) {
            const kwLower = keyword.toLowerCase();
            const kwNorm = normalizeText(keyword);
            
            for (const item of items) {
              const itemNameLower = item.name.toLowerCase();
              const itemNameNorm = normalizeText(item.name);
              const itemTags = item.tags?.map(t => t.toLowerCase()) || [];
              const itemTagsNorm = item.tags?.map(t => normalizeText(t)) || [];
              
              // Check in name
              const nameMatch = itemNameLower.includes(kwLower) || itemNameNorm.includes(kwNorm);
              
              // Check in tags
              const tagMatch = itemTags.some(tag => tag.includes(kwLower) || kwLower.includes(tag)) ||
                               itemTagsNorm.some(tagNorm => tagNorm.includes(kwNorm) || kwNorm.includes(tagNorm));
              
              if (nameMatch || tagMatch) {
                const id = item._id.toString();
                if (!itemMatches.has(id)) {
                  itemMatches.set(id, { item, score: 0 });
                }
                itemMatches.get(id).score += 20; // Keyword match = 20 points
              }
            }
          }
        }
      }
      
      // Sort by score (higher = better match)
      return Array.from(itemMatches.values())
        .sort((a, b) => b.score - a.score)
        .map(m => m.item);
    };
    
    let matchingItems = [];
    
    if (hasSearchTerm) {
      // Search using ALL translation variations
      console.log(`🔍 Searching with variations: [${uniqueSearchTerms.join(', ')}]`);
      matchingItems = searchByMultipleTerms(filteredItems, uniqueSearchTerms);
      
      // If no results with food type filter, try ALL items
      if (matchingItems.length === 0 && filteredItems.length < menuItems.length) {
        matchingItems = searchByMultipleTerms(menuItems, uniqueSearchTerms);
        if (matchingItems.length > 0) {
          foodTypeLabel = null;
        }
      }
      
      // If still no results, try finding items that match ANY keyword (show all related items)
      if (matchingItems.length === 0) {
        const allKeywords = uniqueSearchTerms.flatMap(term => term.split(/\s+/).filter(k => k.length >= 2));
        if (allKeywords.length > 0) {
          console.log(`🔍 Fallback: finding items matching ANY keyword: [${allKeywords.join(', ')}]`);
          // Search each keyword and combine all results
          matchingItems = searchByMultipleTerms(menuItems, allKeywords);
        }
      }
    } else if (detected?.type === 'specific' && filteredItems.length > 0) {
      matchingItems = filteredItems;
    }
    
    return matchingItems.length > 0 
      ? { items: matchingItems, foodType: detected, searchTerm: primarySearchTerm, label: foodTypeLabel }
      : null;
  },

  // Helper to filter items by food type preference
  filterByFoodType(menuItems, preference) {
    if (preference === 'both') return menuItems;
    if (preference === 'veg') return menuItems.filter(item => item.foodType === 'veg');
    if (preference === 'egg') return menuItems.filter(item => item.foodType === 'egg');
    if (preference === 'nonveg') return menuItems.filter(item => item.foodType === 'nonveg' || item.foodType === 'egg');
    return menuItems;
  },

  // Reverse geocode coordinates to get readable address
  async reverseGeocode(latitude, longitude) {
    try {
      const response = await axios.get(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`,
        { headers: { 'User-Agent': 'RestaurantBot/1.0' } }
      );
      
      if (response.data && response.data.address) {
        const addr = response.data.address;
        // Build a readable address
        const parts = [];
        if (addr.house_number) parts.push(addr.house_number);
        if (addr.road) parts.push(addr.road);
        if (addr.neighbourhood || addr.suburb) parts.push(addr.neighbourhood || addr.suburb);
        if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
        if (addr.state) parts.push(addr.state);
        if (addr.postcode) parts.push(addr.postcode);
        
        return parts.length > 0 ? parts.join(', ') : response.data.display_name || 'Location shared';
      }
      return 'Location shared';
    } catch (error) {
      console.error('Reverse geocoding error:', error.message);
      return 'Location shared';
    }
  },

  async handleMessage(phone, message, messageType = 'text', selectedId = null, senderName = null) {
    let customer = await Customer.findOne({ phone });
    if (!customer) {
      customer = new Customer({ 
        phone, 
        name: senderName || null,
        conversationState: { currentStep: 'welcome' }, 
        cart: [] 
      });
      await customer.save();
    } else if (senderName && (!customer.name || customer.name === 'Unknown' || customer.name === 'Customer')) {
      // Update name if we now have it and customer didn't have a proper name
      customer.name = senderName;
      await customer.save();
    }

    // Get paused categories to filter them out from chatbot
    const pausedCategories = await Category.find({ isPaused: true }).select('name');
    const pausedCategoryNames = pausedCategories.map(c => c.name);
    
    // Get available menu items and filter out items that belong ONLY to paused categories
    // Also remove paused category names from items that have multiple categories
    const allMenuItems = await MenuItem.find({ available: true });
    const menuItems = allMenuItems
      .filter(item => {
        const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
        // Keep item if it has at least one non-paused category
        return itemCategories.some(cat => !pausedCategoryNames.includes(cat));
      })
      .map(item => {
        // Remove paused categories from item's category array for display
        const itemCategories = Array.isArray(item.category) ? item.category : [item.category];
        const filteredCategories = itemCategories.filter(cat => !pausedCategoryNames.includes(cat));
        return { ...item.toObject(), category: filteredCategories };
      });
    
    const state = customer.conversationState || { currentStep: 'welcome' };
    
    // Handle message - could be string or object (for location)
    const msg = typeof message === 'string' ? message.toLowerCase().trim() : '';
    const selection = selectedId || msg;

    console.log('🤖 Chatbot:', { phone, msg, selection, messageType, currentStep: state.currentStep });

    try {
      // ========== HANDLE LOCATION MESSAGE ==========
      if (messageType === 'location') {
        // message contains location data: { latitude, longitude, name, address }
        const locationData = typeof message === 'object' ? message : {};
        
        console.log('📍 Location received:', locationData);
        
        // Get proper address from coordinates using reverse geocoding
        let formattedAddress = 'Location shared';
        if (locationData.latitude && locationData.longitude) {
          formattedAddress = await this.reverseGeocode(locationData.latitude, locationData.longitude);
        }
        
        customer.deliveryAddress = {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          address: formattedAddress,
          updatedAt: new Date()
        };
        await customer.save();
        
        // If customer has items in cart, show order summary with payment options
        if (customer.cart?.length > 0) {
          await this.sendPaymentMethodOptions(phone, customer);
          state.currentStep = 'select_payment_method';
        } else {
          // No cart items, just confirm location saved
          await whatsapp.sendButtons(phone, 
            `📍 Location saved!\n\n${formattedAddress}\n\nStart ordering to use this address.`,
            [
              { id: 'place_order', text: 'Start Order' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
          state.currentStep = 'main_menu';
        }
      }
      // ========== WEBSITE ORDER DETECTION (exact match on item name) ==========
      // Detect orders coming from website with format "Hi! I'd like to order: * ItemName *"
      else if (!selectedId && message && this.isWebsiteOrderIntent(message)) {
        const websiteOrder = this.isWebsiteOrderIntent(message);
        console.log('🌐 Website order detected:', websiteOrder);
        
        // Try exact match first (case-insensitive)
        const exactMatch = menuItems.find(item => 
          item.name.toLowerCase() === websiteOrder.itemName.toLowerCase()
        );
        
        if (exactMatch) {
          // Found exact match - show item details with Add to Cart option
          state.selectedItem = exactMatch._id.toString();
          customer.conversationState = state;
          await customer.save();
          await this.sendItemDetailsForOrder(phone, exactMatch);
          state.currentStep = 'viewing_item_details';
        } else {
          // No exact match - try partial match
          const partialMatches = menuItems.filter(item => 
            item.name.toLowerCase().includes(websiteOrder.itemName.toLowerCase()) ||
            websiteOrder.itemName.toLowerCase().includes(item.name.toLowerCase())
          );
          
          if (partialMatches.length === 1) {
            // Single partial match - show item details
            const item = partialMatches[0];
            state.selectedItem = item._id.toString();
            customer.conversationState = state;
            await customer.save();
            await this.sendItemDetailsForOrder(phone, item);
            state.currentStep = 'viewing_item_details';
          } else if (partialMatches.length > 1) {
            // Multiple matches - show options
            const sections = [{
              title: `Items matching "${websiteOrder.itemName}"`,
              rows: partialMatches.slice(0, 10).map(item => ({
                id: `view_${item._id}`,
                title: item.name.substring(0, 24),
                description: `₹${item.price} • ${item.foodType === 'veg' ? '🟢 Veg' : item.foodType === 'nonveg' ? '🔴 Non-Veg' : '🟡 Egg'}`
              }))
            }];
            await whatsapp.sendList(phone, '🔍 Select Item', `Found ${partialMatches.length} items. Please select one:`, 'View Items', sections, 'Tap to view details');
            state.currentStep = 'select_item';
          } else {
            // No match found
            await whatsapp.sendButtons(phone, `❌ Sorry, "${websiteOrder.itemName}" is not available.\n\nPlease browse our menu!`, [
              { id: 'view_menu', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          }
        }
      }
      // ========== GLOBAL COMMANDS (work from any state) ==========
      else if (msg === 'hi' || msg === 'hello' || msg === 'start' || msg === 'hey') {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'home' || selection === 'back' || msg === 'home' || msg === 'back') {
        await this.sendWelcome(phone);
        state.currentStep = 'main_menu';
      }
      // ========== CART COMMANDS (check CLEAR first, then VIEW - order matters!) ==========
      // Clear cart must be checked BEFORE view cart because "clear my cart" contains "my cart"
      else if (selection === 'clear_cart' || (!selectedId && this.isClearCartIntent(msg))) {
        customer.cart = [];
        await customer.save();
        await whatsapp.sendButtons(phone, '🗑️ Cart cleared!', [
          { id: 'place_order', text: 'New Order' },
          { id: 'home', text: 'Main Menu' }
        ]);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'view_cart' || (!selectedId && this.isCartIntent(msg))) {
        await this.sendCart(phone, customer);
        state.currentStep = 'viewing_cart';
      }
      else if (selection === 'view_menu' || msg === 'menu') {
        await this.sendFoodTypeSelection(phone);
        state.currentStep = 'select_food_type';
      }
      // Handle text/voice menu intent with food type detection (only for text messages, not button clicks)
      else if (!selectedId && this.isShowMenuIntent(msg)) {
        const menuIntent = this.isShowMenuIntent(msg);
        console.log('🍽️ Menu intent detected:', menuIntent);
        
        if (menuIntent.foodType === 'veg') {
          state.foodTypePreference = 'veg';
          const filteredItems = this.filterByFoodType(menuItems, 'veg');
          if (filteredItems.length > 0) {
            await this.sendMenuCategoriesWithLabel(phone, filteredItems, '🥦 Veg Menu');
            state.currentStep = 'select_category';
          } else {
            await whatsapp.sendButtons(phone, '🥦 No veg items available right now.', [
              { id: 'view_menu', text: 'View All Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          }
        } else if (menuIntent.foodType === 'egg') {
          state.foodTypePreference = 'egg';
          const filteredItems = this.filterByFoodType(menuItems, 'egg');
          if (filteredItems.length > 0) {
            await this.sendMenuCategoriesWithLabel(phone, filteredItems, '🥚 Egg Menu');
            state.currentStep = 'select_category';
          } else {
            await whatsapp.sendButtons(phone, '🥚 No egg items available right now.', [
              { id: 'view_menu', text: 'View All Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          }
        } else if (menuIntent.foodType === 'nonveg') {
          state.foodTypePreference = 'nonveg';
          const filteredItems = this.filterByFoodType(menuItems, 'nonveg');
          if (filteredItems.length > 0) {
            await this.sendMenuCategoriesWithLabel(phone, filteredItems, '🍗 Non-Veg Menu');
            state.currentStep = 'select_category';
          } else {
            await whatsapp.sendButtons(phone, '🍗 No non-veg items available right now.', [
              { id: 'view_menu', text: 'View All Menu' },
              { id: 'home', text: 'Main Menu' }
            ]);
            state.currentStep = 'main_menu';
          }
        } else {
          // Show all items
          state.foodTypePreference = 'both';
          await this.sendMenuCategoriesWithLabel(phone, menuItems, '🍽️ All Menu');
          state.currentStep = 'select_category';
        }
      }
      else if (selection === 'food_veg' || selection === 'food_nonveg' || selection === 'food_both') {
        state.foodTypePreference = selection.replace('food_', '');
        console.log('🍽️ Food type selected:', state.foodTypePreference);
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference);
        
        const foodTypeLabels = {
          veg: '🥦 Veg Menu',
          nonveg: '🍗 Non-Veg Menu',
          both: '🍽️ All Menu'
        };
        
        // If coming from order flow, show menu for ordering; otherwise show browse menu
        if (state.currentStep === 'select_food_type_order') {
          await this.sendMenuForOrderWithLabel(phone, filteredItems, foodTypeLabels[state.foodTypePreference]);
          state.currentStep = 'browsing_menu';
        } else {
          await this.sendMenuCategoriesWithLabel(phone, filteredItems, foodTypeLabels[state.foodTypePreference]);
          state.currentStep = 'select_category';
        }
      }
      else if (selection === 'place_order' || selection === 'order_now' || (!selectedId && msg === 'order')) {
        // Skip service type selection and go directly to food type selection
        await this.sendFoodTypeSelection(phone);
        state.currentStep = 'select_food_type_order';
      }
      // Check cancel/refund/track BEFORE order status (they're more specific)
      // Only check text-based intents when there's no selectedId (button click)
      else if (selection === 'cancel_order' || (!selectedId && this.isCancelIntent(msg))) {
        await this.sendCancelOptions(phone);
        state.currentStep = 'select_cancel';
      }
      else if (selection === 'request_refund' || (!selectedId && this.isRefundIntent(msg))) {
        await this.sendRefundOptions(phone);
        state.currentStep = 'select_refund';
      }
      else if (selection === 'track_order' || (!selectedId && (msg === 'track' || this.isTrackIntent(msg)))) {
        await this.sendTrackingOptions(phone);
        state.currentStep = 'select_track';
      }
      else if (selection === 'order_status' || (!selectedId && (msg === 'status' || this.isOrderStatusIntent(msg)))) {
        await this.sendOrderStatus(phone);
        state.currentStep = 'main_menu';
      }
      else if (selection === 'help' || (!selectedId && msg === 'help')) {
        await this.sendHelp(phone);
        state.currentStep = 'main_menu';
      }
      // ========== TEXT-BASED ADD TO CART (e.g., "add biryani to cart") ==========
      else if (!selectedId && this.isAddToCartIntent(msg)) {
        const addIntent = this.isAddToCartIntent(msg);
        console.log('🛒 Add to cart intent detected:', addIntent);
        
        // Search for item by name
        const searchTerm = addIntent.itemName.toLowerCase();
        const matchingItems = menuItems.filter(item => 
          item.name.toLowerCase().includes(searchTerm) ||
          (item.tags && item.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
        );
        
        if (matchingItems.length === 1) {
          // Exact match - add to cart with qty 1
          const item = matchingItems[0];
          customer.cart = customer.cart || [];
          const existingIndex = customer.cart.findIndex(c => c.menuItem?.toString() === item._id.toString());
          if (existingIndex >= 0) {
            customer.cart[existingIndex].quantity += 1;
          } else {
            customer.cart.push({ menuItem: item._id, quantity: 1 });
          }
          await customer.save();
          await this.sendAddedToCart(phone, item, 1, customer.cart);
          state.currentStep = 'item_added';
        } else if (matchingItems.length > 1) {
          // Multiple matches - show options
          const sections = [{
            title: `Items matching "${addIntent.itemName}"`,
            rows: matchingItems.slice(0, 10).map(item => ({
              id: `add_${item._id}`,
              title: item.name.substring(0, 24),
              description: `₹${item.price} • ${item.foodType === 'veg' ? '🟢 Veg' : item.foodType === 'nonveg' ? '🔴 Non-Veg' : '🟡 Egg'}`
            }))
          }];
          await whatsapp.sendList(phone, '🔍 Multiple Items Found', `Found ${matchingItems.length} items matching "${addIntent.itemName}"`, 'Select Item', sections, 'Tap to add to cart');
          state.currentStep = 'select_item';
        } else {
          // No match found
          await whatsapp.sendButtons(phone, `❌ No items found matching "${addIntent.itemName}"\n\nTry browsing our menu!`, [
            { id: 'view_menu', text: 'View Menu' },
            { id: 'home', text: 'Main Menu' }
          ]);
          state.currentStep = 'main_menu';
        }
      }
      else if (selection === 'checkout' || selection === 'review_pay') {
        // If user has a selected item they're viewing, add it to cart with qty 1
        if (state.selectedItem) {
          const item = menuItems.find(m => m._id.toString() === state.selectedItem);
          if (item) {
            // Check if item already in cart
            const existingIndex = customer.cart?.findIndex(c => c.menuItem.toString() === state.selectedItem);
            if (existingIndex >= 0) {
              // Item already in cart, increment quantity
              customer.cart[existingIndex].quantity += 1;
            } else {
              // Add new item to cart
              if (!customer.cart) customer.cart = [];
              customer.cart.push({ menuItem: item._id, quantity: 1 });
            }
            await customer.save();
            console.log(`✅ Added ${item.name} to cart before checkout`);
          }
        }
        
        if (!customer.cart?.length) {
          await whatsapp.sendButtons(phone, 'Your cart is empty! Please add items first.', [
            { id: 'view_menu', text: 'View Menu' },
            { id: 'home', text: 'Main Menu' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          // Ask for delivery location first
          await this.requestLocation(phone);
          state.currentStep = 'awaiting_location';
        }
      }
      else if (selection === 'share_location') {
        // User tapped share location button - remind them to share
        await whatsapp.sendMessage(phone,
          `📍 Please share your location:\n\n` +
          `1️⃣ Tap the 📎 attachment icon below\n` +
          `2️⃣ Select "Location"\n` +
          `3️⃣ Send your current location\n\n` +
          `We're waiting for your location! 🛵`
        );
        state.currentStep = 'awaiting_location';
      }
      else if (selection === 'skip_location') {
        // Skip location - proceed to payment without address
        customer.deliveryAddress = {
          address: 'Address not provided - will confirm on call',
          updatedAt: new Date()
        };
        await customer.save();
        await this.sendPaymentMethodOptions(phone, customer);
        state.currentStep = 'select_payment_method';
      }
      else if (selection === 'pay_upi') {
        if (!customer.cart?.length) {
          await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
            { id: 'view_menu', text: 'View Menu' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          state.paymentMethod = 'upi';
          const result = await this.processCheckout(phone, customer, state);
          if (result.success) state.currentStep = 'awaiting_payment';
        }
      }
      else if (selection === 'pay_cod') {
        if (!customer.cart?.length) {
          await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
            { id: 'view_menu', text: 'View Menu' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          state.paymentMethod = 'cod';
          const result = await this.processCODOrder(phone, customer, state);
          if (result.success) state.currentStep = 'order_confirmed';
        }
      }
      else if (selection === 'confirm_order' || selection === 'pay_now') {
        if (!customer.cart?.length) {
          await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
            { id: 'view_menu', text: 'View Menu' }
          ]);
          state.currentStep = 'main_menu';
        } else {
          const result = await this.processCheckout(phone, customer, state);
          if (result.success) state.currentStep = 'awaiting_payment';
        }
      }
      else if (selection === 'add_more') {
        // Ask user to select food type before showing menu
        await whatsapp.sendButtons(phone, 
          '🍽️ *Add More Items*\n\nWhat would you like to browse?',
          [
            { id: 'food_veg', text: 'Veg' },
            { id: 'food_nonveg', text: 'Non-Veg' },
            { id: 'food_both', text: 'All Items' }
          ]
        );
        state.currentStep = 'select_food_type_order';
      }

      // ========== CATEGORY SELECTION ==========
      else if (selection === 'cat_all') {
        // Show all items from all categories
        const preference = state.foodTypePreference || 'both';
        const filteredItems = this.filterByFoodType(menuItems, preference);
        console.log('🍽️ All items selected - Food preference:', preference, 'Total items:', filteredItems.length);
        await this.sendAllItems(phone, filteredItems);
        state.selectedCategory = 'all';
        state.currentStep = 'viewing_items';
      }
      else if (selection.startsWith('cat_')) {
        const sanitizedCat = selection.replace('cat_', '');
        const preference = state.foodTypePreference || 'both';
        const filteredItems = this.filterByFoodType(menuItems, preference);
        // Find original category name from sanitized ID
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9_]/g, '_') === sanitizedCat) || sanitizedCat;
        console.log('🍽️ Category selection - Food preference:', preference, 'Category:', category);
        console.log('🍽️ After filter - Items:', filteredItems.length, 'In category:', filteredItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category).length);
        await this.sendCategoryItems(phone, filteredItems, category);
        state.selectedCategory = category;
        state.currentStep = 'viewing_items';
      }
      else if (selection === 'order_cat_all') {
        // Show all items for ordering
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        console.log('🍽️ All items for order - Total items:', filteredItems.length);
        await this.sendAllItemsForOrder(phone, filteredItems);
        state.selectedCategory = 'all';
        state.currentStep = 'selecting_item';
      }
      else if (selection.startsWith('order_cat_')) {
        const sanitizedCat = selection.replace('order_cat_', '');
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        // Find original category name from sanitized ID
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9_]/g, '_') === sanitizedCat) || sanitizedCat;
        await this.sendItemsForOrder(phone, filteredItems, category);
        state.selectedCategory = category;
        state.currentStep = 'selecting_item';
      }

      // ========== PAGINATION HANDLERS ==========
      // Category list pagination (for browsing)
      else if (selection.startsWith('menucat_page_')) {
        const page = parseInt(selection.replace('menucat_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.categoryPage = page;
        await this.sendMenuCategories(phone, filteredItems, 'Our Menu', page);
        state.currentStep = 'select_category';
      }
      // Category list pagination (for ordering)
      else if (selection.startsWith('ordercat_page_')) {
        const page = parseInt(selection.replace('ordercat_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.categoryPage = page;
        await this.sendMenuForOrder(phone, filteredItems, 'Select Items', page);
        state.currentStep = 'browsing_menu';
      }
      // All items pagination (for browsing)
      else if (selection.startsWith('allitems_page_')) {
        const page = parseInt(selection.replace('allitems_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.currentPage = page;
        await this.sendAllItems(phone, filteredItems, page);
        state.currentStep = 'viewing_items';
      }
      // All items pagination (for ordering)
      else if (selection.startsWith('orderitems_page_')) {
        const page = parseInt(selection.replace('orderitems_page_', ''));
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        state.currentPage = page;
        await this.sendAllItemsForOrder(phone, filteredItems, page);
        state.currentStep = 'selecting_item';
      }
      else if (selection.startsWith('catpage_')) {
        const parts = selection.replace('catpage_', '').split('_');
        const page = parseInt(parts.pop());
        const safeCat = parts.join('_');
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9]/g, '_') === safeCat) || safeCat;
        state.currentPage = page;
        state.selectedCategory = category;
        await this.sendCategoryItems(phone, filteredItems, category, page);
        state.currentStep = 'viewing_items';
      }
      else if (selection.startsWith('ordercatpage_')) {
        const parts = selection.replace('ordercatpage_', '').split('_');
        const page = parseInt(parts.pop());
        const safeCat = parts.join('_');
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const allCategories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        const category = allCategories.find(c => c.replace(/[^a-zA-Z0-9]/g, '_') === safeCat) || safeCat;
        state.currentPage = page;
        state.selectedCategory = category;
        await this.sendItemsForOrder(phone, filteredItems, category, page);
        state.currentStep = 'selecting_item';
      }
      // Tag search pagination
      else if (selection.startsWith('tagpage_')) {
        const parts = selection.replace('tagpage_', '').split('_');
        const page = parseInt(parts.pop());
        const safeTag = parts.join('_');
        // Restore original search term from state or use safe version
        const searchTerm = state.searchTag || safeTag.replace(/_/g, ' ');
        const searchResult = await this.smartSearch(searchTerm, menuItems);
        const matchingItems = searchResult?.items || [];
        state.currentPage = page;
        const displayLabel = searchResult?.label 
          ? (searchResult.searchTerm ? `${searchResult.label} "${searchResult.searchTerm}"` : searchResult.label)
          : (searchResult?.searchTerm ? `"${searchResult.searchTerm}"` : `"${searchTerm}"`);
        await this.sendItemsByTag(phone, matchingItems, displayLabel, page);
        state.currentStep = 'viewing_tag_results';
      }

      // ========== ITEM SELECTION ==========
      else if (selection.startsWith('view_')) {
        const itemId = selection.replace('view_', '');
        await this.sendItemDetails(phone, menuItems, itemId);
        state.selectedItem = itemId;
        state.currentStep = 'viewing_item_details';
      }
      else if (selection.startsWith('add_')) {
        const itemId = selection.replace('add_', '');
        const item = menuItems.find(m => m._id.toString() === itemId);
        if (item) {
          state.selectedItem = itemId;
          // Save state immediately to ensure selectedItem persists
          customer.conversationState = state;
          await customer.save();
          // Go directly to quantity selection
          await this.sendQuantitySelection(phone, item);
          state.currentStep = 'select_quantity';
        } else {
          console.log('❌ Item not found for add_:', itemId);
          await whatsapp.sendButtons(phone,
            '⚠️ This item is no longer available. Please select another item.',
            [
              { id: 'place_order', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
          state.currentStep = 'main_menu';
        }
      }
      else if (selection.startsWith('confirm_add_')) {
        const itemId = selection.replace('confirm_add_', '');
        const item = menuItems.find(m => m._id.toString() === itemId);
        if (item) {
          state.selectedItem = itemId;
          // Save state immediately to ensure selectedItem persists
          customer.conversationState = state;
          await customer.save();
          await this.sendQuantitySelection(phone, item);
          state.currentStep = 'select_quantity';
        } else {
          console.log('❌ Item not found for confirm_add_:', itemId);
          await whatsapp.sendButtons(phone,
            '⚠️ This item is no longer available. Please select another item.',
            [
              { id: 'place_order', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
          state.currentStep = 'main_menu';
        }
      }

      // ========== QUANTITY SELECTION ==========
      else if (selection.startsWith('qty_')) {
        const qty = parseInt(selection.replace('qty_', ''));
        console.log('🛒 Quantity selected:', { qty, selectedItem: state.selectedItem });
        
        const item = menuItems.find(m => m._id.toString() === state.selectedItem);
        
        if (item && qty > 0) {
          customer.cart = customer.cart || [];
          // Check if item already in cart
          const existingIndex = customer.cart.findIndex(c => c.menuItem?.toString() === item._id.toString());
          if (existingIndex >= 0) {
            customer.cart[existingIndex].quantity += qty;
          } else {
            customer.cart.push({ menuItem: item._id, quantity: qty });
          }
          // Save cart immediately to persist the change
          await customer.save();
          console.log('🛒 Cart updated and saved:', customer.cart.length, 'items');
          await this.sendAddedToCart(phone, item, qty, customer.cart);
          state.currentStep = 'item_added';
        } else {
          // Item not found - maybe state was lost, show menu again
          console.log('❌ Item not found for qty selection, selectedItem:', state.selectedItem);
          await whatsapp.sendButtons(phone,
            '⚠️ Something went wrong. Please select an item again.',
            [
              { id: 'place_order', text: 'Order Again' },
              { id: 'view_menu', text: 'View Menu' },
              { id: 'home', text: 'Main Menu' }
            ]
          );
          state.currentStep = 'main_menu';
        }
      }

      // ========== SERVICE TYPE SELECTION ==========
      else if (state.currentStep === 'select_service') {
        const services = { 'delivery': 'delivery', 'pickup': 'pickup', 'dine_in': 'dine_in' };
        if (services[selection]) {
          state.selectedService = services[selection];
          // Ask for food type preference before showing menu
          await this.sendFoodTypeSelection(phone);
          state.currentStep = 'select_food_type_order';
        }
      }

      // ========== ORDER TRACKING ==========
      else if (selection.startsWith('track_')) {
        const orderId = selection.replace('track_', '');
        await this.sendTrackingDetails(phone, orderId);
        state.currentStep = 'main_menu';
      }

      // ========== ORDER CANCELLATION ==========
      else if (selection.startsWith('cancel_')) {
        const orderId = selection.replace('cancel_', '');
        await this.processCancellation(phone, orderId);
        state.currentStep = 'main_menu';
      }

      // ========== REFUND ==========
      else if (selection.startsWith('refund_')) {
        const orderId = selection.replace('refund_', '');
        await this.processRefund(phone, orderId);
        state.currentStep = 'main_menu';
      }

      // ========== CART ITEM REMOVAL ==========
      else if (selection.startsWith('remove_')) {
        const index = parseInt(selection.replace('remove_', ''));
        if (customer.cart && customer.cart[index]) {
          customer.cart.splice(index, 1);
          await this.sendCart(phone, customer);
          state.currentStep = 'viewing_cart';
        }
      }

      // ========== NUMBER SELECTION (for paginated categories) ==========
      else if (/^\d+$/.test(msg) && (state.currentStep === 'select_category' || state.currentStep === 'browsing_menu')) {
        const catNum = parseInt(msg);
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        const categories = [...new Set(filteredItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
        
        if (catNum === 0) {
          // "All Items" selected
          if (state.currentStep === 'browsing_menu') {
            await this.sendAllItemsForOrder(phone, filteredItems);
            state.selectedCategory = 'all';
            state.currentStep = 'selecting_item';
          } else {
            await this.sendAllItems(phone, filteredItems);
            state.selectedCategory = 'all';
            state.currentStep = 'viewing_items';
          }
        } else if (catNum >= 1 && catNum <= categories.length) {
          const category = categories[catNum - 1];
          if (state.currentStep === 'browsing_menu') {
            await this.sendItemsForOrder(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'selecting_item';
          } else {
            await this.sendCategoryItems(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'viewing_items';
          }
        } else {
          await whatsapp.sendButtons(phone, `❌ Invalid number. Please enter 0 for All Items or 1-${categories.length} for a category.`, [
            { id: 'home', text: 'Main Menu' }
          ]);
        }
      }

      // ========== NUMBER SELECTION (for paginated items) ==========
      else if (/^\d+$/.test(msg) && (state.currentStep === 'viewing_items' || state.currentStep === 'selecting_item')) {
        const itemNum = parseInt(msg);
        const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
        let itemsList = filteredItems;
        
        // If a category is selected, filter by it
        if (state.selectedCategory && state.selectedCategory !== 'all') {
          itemsList = filteredItems.filter(m => 
            Array.isArray(m.category) ? m.category.includes(state.selectedCategory) : m.category === state.selectedCategory
          );
        }
        
        if (itemNum >= 1 && itemNum <= itemsList.length) {
          const item = itemsList[itemNum - 1];
          if (state.currentStep === 'selecting_item') {
            // For ordering - go to quantity selection
            state.selectedItem = item._id.toString();
            await this.sendQuantitySelection(phone, item);
            state.currentStep = 'select_quantity';
          } else {
            // For browsing - show item details
            await this.sendItemDetails(phone, menuItems, item._id.toString());
            state.selectedItem = item._id.toString();
            state.currentStep = 'viewing_item_details';
          }
        } else {
          await whatsapp.sendButtons(phone, `❌ Invalid number. Please enter a number between 1 and ${itemsList.length}.`, [
            { id: 'home', text: 'Main Menu' }
          ]);
        }
      }

      // ========== NATURAL LANGUAGE FALLBACKS ==========
      // Smart search FIRST - detects food type (veg/nonveg/egg/specific) and searches by name/tag
      // This takes priority when user specifies food type like "veg cake" or "chicken biryani"
      // Priority: search tags first, then name. If nothing matches, show menu.
      // Also translates local language searches to English using AI
      else {
        const searchResult = await this.smartSearch(msg, menuItems);
        
        if (searchResult && searchResult.items && searchResult.items.length > 0) {
          const matchingItems = searchResult.items;
          // Use pre-built label or construct one
          const displayLabel = searchResult.label 
            ? (searchResult.searchTerm ? `${searchResult.label} "${searchResult.searchTerm}"` : searchResult.label)
            : (searchResult.searchTerm ? `"${searchResult.searchTerm}"` : 'Search Results');
          
          // If only 1 item matches, show item details directly
          if (matchingItems.length === 1) {
            const item = matchingItems[0];
            state.selectedItem = item._id.toString();
            await this.sendItemDetails(phone, menuItems, item._id.toString());
            state.currentStep = 'viewing_item_details';
          } else {
            // Multiple items - show list
            state.searchTag = msg.trim();
            state.tagSearchResults = matchingItems.map(i => i._id.toString());
            await this.sendItemsByTag(phone, matchingItems, displayLabel);
            state.currentStep = 'viewing_tag_results';
          }
        }
        // If user typed something with food type keyword but no search results, show that food type menu
        // e.g., "veg xyz" where xyz doesn't match anything -> show veg menu
        else if (this.detectFoodTypeFromMessage(msg)) {
          const detected = this.detectFoodTypeFromMessage(msg);
          let foodType = 'both';
          let label = '🍽️ All Menu';
          
          if (detected.type === 'veg') {
            foodType = 'veg';
            label = '🥦 Veg Menu';
          } else if (detected.type === 'egg') {
            foodType = 'egg';
            label = '🥚 Egg Menu';
          } else if (detected.type === 'nonveg' || detected.type === 'specific') {
            foodType = 'nonveg';
            label = '🍗 Non-Veg Menu';
          }
          
          state.foodTypePreference = foodType;
          const filteredItems = this.filterByFoodType(menuItems, foodType);
          
          if (filteredItems.length > 0) {
            // Show message that search didn't find exact match, showing menu instead
            const searchTerm = this.removeFoodTypeKeywords(msg.toLowerCase().trim());
            if (searchTerm.length >= 2) {
              await whatsapp.sendMessage(phone, `🔍 No items found for "${searchTerm}". Here's our ${label.replace(/[🥦🥚🍗🍽️]\s*/, '')}:`);
            }
            await this.sendMenuCategoriesWithLabel(phone, filteredItems, label);
            state.currentStep = 'select_category';
          } else {
            // No items in this food type, show all menu instead
            await whatsapp.sendMessage(phone, `🔍 No items found. Here's our full menu:`);
            await this.sendMenuCategoriesWithLabel(phone, menuItems, '🍽️ All Menu');
            state.currentStep = 'select_category';
          }
        }
        // Category search - only if no food type specified and matches a category
        else if (this.findCategory(msg, menuItems)) {
          const category = this.findCategory(msg, menuItems);
          const filteredItems = this.filterByFoodType(menuItems, state.foodTypePreference || 'both');
          if (state.currentStep === 'browsing_menu' || state.currentStep === 'selecting_item') {
            await this.sendItemsForOrder(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'selecting_item';
          } else {
            await this.sendCategoryItems(phone, filteredItems, category);
            state.selectedCategory = category;
            state.currentStep = 'viewing_items';
          }
        }
        // ========== WELCOME FOR NEW/UNKNOWN STATE ==========
        else if (state.currentStep === 'welcome' || !state.currentStep) {
          await this.sendWelcome(phone);
          state.currentStep = 'main_menu';
        }
        // ========== GENERAL SEARCH FALLBACK ==========
        // If user typed something that looks like a search (2+ chars), try to find items
        // If nothing found, show the full menu instead of "I didn't understand"
        else if (msg.length >= 2 && /^[a-zA-Z\u0900-\u097F\u0C00-\u0C7F\u0B80-\u0BFF\u0C80-\u0CFF\u0D00-\u0D7F\u0980-\u09FF\u0A80-\u0AFF\s]+$/.test(msg)) {
          // Looks like a search term (letters only, including Indian languages)
          // Already tried smartSearch above, so just show menu
          await whatsapp.sendMessage(phone, `🔍 No items found for "${msg}". Here's our menu:`);
          await this.sendMenuCategoriesWithLabel(phone, menuItems, '🍽️ All Menu');
          state.currentStep = 'select_category';
        }
        // ========== FALLBACK ==========
        else {
          await whatsapp.sendButtons(phone,
            `🤔 I didn't understand that.\n\nPlease select an option:`,
            [
              { id: 'home', text: 'Main Menu' },
              { id: 'view_cart', text: 'View Cart' },
              { id: 'help', text: 'Help' }
            ]
          );
        }
      }
    } catch (error) {
      console.error('Chatbot error:', error);
      await whatsapp.sendButtons(phone, '❌ Something went wrong. Please try again.', [
        { id: 'home', text: 'Main Menu' },
        { id: 'help', text: 'Help' }
      ]);
    }

    // Refresh customer from DB to avoid version conflicts, then update state
    try {
      const latestCustomer = await Customer.findOne({ phone });
      if (latestCustomer) {
        latestCustomer.conversationState = state;
        latestCustomer.conversationState.lastInteraction = new Date();
        await latestCustomer.save();
      }
    } catch (saveErr) {
      console.error('Error saving conversation state:', saveErr.message);
    }
  },

  // ============ WELCOME & MAIN MENU ============
  async sendWelcome(phone) {
    // Send list menu with View Options button instantly
    await whatsapp.sendList(
      phone,
      '🍽️ Welcome!',
      'Welcome to our restaurant! How can we help you today?',
      'View Options',
      [
        {
          title: 'Order Food',
          rows: [
            { rowId: 'food_both', title: 'All Menu', description: 'Browse all dishes' },
            { rowId: 'food_veg', title: 'Veg Menu', description: 'Browse vegetarian dishes' },
            { rowId: 'food_nonveg', title: 'Non-Veg Menu', description: 'Browse non-vegetarian dishes' },
            { rowId: 'view_cart', title: 'My Cart', description: 'View items in cart' }
          ]
        },
        {
          title: 'My Orders',
          rows: [
            { rowId: 'order_status', title: 'Order Status', description: 'Check your orders' },
            { rowId: 'track_order', title: 'Track Delivery', description: 'Live order tracking' },
            { rowId: 'cancel_order', title: 'Cancel Order', description: 'Cancel & auto-refund if paid' }
          ]
        },
        {
          title: 'Support',
          rows: [{ rowId: 'help', title: 'Help', description: 'Get assistance' }]
        }
      ],
      'Powered by AI'
    );
  },

  // ============ MENU BROWSING ============
  async sendFoodTypeSelection(phone) {
    await whatsapp.sendButtons(phone,
      '🍽️ *Browse Menu*\n\nWhat would you like to see?',
      [
        { id: 'food_veg', text: 'Veg Only' },
        { id: 'food_nonveg', text: 'Non-Veg Only' },
        { id: 'food_both', text: 'Show All' }
      ]
    );
  },

  async sendMenuCategories(phone, menuItems, label = 'Our Menu', page = 0) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    
    if (!categories.length) {
      await whatsapp.sendButtons(phone, '📋 No menu items available right now.', [
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    // If 9 or fewer categories (+ All Items = 10), use WhatsApp list without pagination
    if (categories.length <= 9) {
      const rows = [
        { rowId: 'cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` }
      ];
      
      categories.forEach(cat => {
        const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
        const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
        rows.push({ rowId: `cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items available` });
      });

      await whatsapp.sendList(phone, label, 'Select a category to browse items', 'View Categories',
        [{ title: 'Menu Categories', rows }], 'Fresh & Delicious!');
      return;
    }

    // More than 9 categories - use pagination with WhatsApp list
    const CATS_PER_PAGE = 9; // 9 categories + 1 "All Items" = 10 rows max
    const totalPages = Math.ceil(categories.length / CATS_PER_PAGE);
    const startIdx = page * CATS_PER_PAGE;
    const pageCats = categories.slice(startIdx, startIdx + CATS_PER_PAGE);

    // Build rows for the list
    const rows = [];
    
    // Add "All Items" option on first page only
    if (page === 0) {
      rows.push({ rowId: 'cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` });
    }
    
    pageCats.forEach(cat => {
      const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
      const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
      rows.push({ rowId: `cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items available` });
    });

    await whatsapp.sendList(
      phone,
      `📋 ${label}`,
      `Page ${page + 1}/${totalPages} • ${categories.length} categories\nTap to select a category`,
      'View Categories',
      [{ title: 'Menu Categories', rows }],
      'Select a category'
    );

    // Send navigation buttons
    const buttons = [];
    if (page > 0) buttons.push({ id: `menucat_page_${page - 1}`, text: 'Previous' });
    if (page < totalPages - 1) buttons.push({ id: `menucat_page_${page + 1}`, text: 'Next' });
    buttons.push({ id: 'home', text: 'Menu' });

    await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
  },

  async sendMenuCategoriesWithLabel(phone, menuItems, label, page = 0) {
    await this.sendMenuCategories(phone, menuItems, label, page);
  },

  async sendCategoryItems(phone, menuItems, category, page = 0) {
    // Filter items that include this category (category is an array field)
    const items = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category);
    
    if (!items.length) {
      await whatsapp.sendButtons(phone, `📋 No items in ${category} right now.`, [
        { id: 'view_menu', text: 'Back to Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      return {
        rowId: `view_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${ratingStr} • ₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    // Only items in the list, no navigation rows
    const sections = [{ title: `${category} (${items.length} items)`, rows }];

    await whatsapp.sendList(
      phone,
      `📋 ${category}`,
      `Page ${page + 1}/${totalPages} • ${items.length} items total\nTap an item to view details`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const safeCat = category.replace(/[^a-zA-Z0-9]/g, '_');
      const buttons = [];
      if (page > 0) buttons.push({ id: `catpage_${safeCat}_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `catpage_${safeCat}_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'view_menu', text: 'Menu' });
      await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send all items (for browsing) - always use WhatsApp list with pagination
  async sendAllItems(phone, menuItems, page = 0) {
    if (!menuItems.length) {
      await whatsapp.sendButtons(phone, '📋 No items available right now.', [
        { id: 'view_menu', text: 'Back to Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(menuItems.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = menuItems.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      return {
        rowId: `view_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${ratingStr} • ₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    const sections = [{ title: `All Items (${menuItems.length})`, rows }];

    await whatsapp.sendList(
      phone,
      '📋 All Items',
      `Page ${page + 1}/${totalPages} • ${menuItems.length} items total\nTap an item to view details`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const buttons = [];
      if (page > 0) buttons.push({ id: `allitems_page_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `allitems_page_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'view_menu', text: 'Menu' });
      await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send items matching a tag keyword (for tag-based search)
  async sendItemsByTag(phone, items, tagKeyword, page = 0) {
    if (!items.length) {
      await whatsapp.sendButtons(phone, `🔍 No items found for "${tagKeyword}".`, [
        { id: 'view_menu', text: 'Browse Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list - use view_ prefix so user can see details first
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      return {
        rowId: `view_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${ratingStr} • ₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    const sections = [{ title: `"${tagKeyword}" Items (${items.length})`, rows }];

    await whatsapp.sendList(
      phone,
      `🏷️ ${tagKeyword}`,
      `Found ${items.length} items matching "${tagKeyword}"\nTap an item to view details & add to cart`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const safeTag = tagKeyword.replace(/[^a-zA-Z0-9]/g, '_');
      const buttons = [];
      if (page > 0) buttons.push({ id: `tagpage_${safeTag}_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `tagpage_${safeTag}_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'view_menu', text: 'Menu' });
      await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send products with images (fallback for catalog)
  async sendProductsWithImages(phone, items) {
    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    
    await whatsapp.sendMessage(phone, '🍽️ *Our Menu*\nBrowse items below and tap to add to cart!');
    
    for (const item of items.slice(0, 5)) {
      const icon = getFoodTypeIcon(item.foodType);
      const msg = `${icon} *${item.name}*\n💰 ₹${item.price}\n\n${item.description || 'Delicious!'}`;
      
      if (item.image && !item.image.startsWith('data:')) {
        await whatsapp.sendImageWithButtons(phone, item.image, msg, [
          { id: `add_${item._id}`, text: 'Add to Cart' }
        ]);
      } else {
        await whatsapp.sendButtons(phone, msg, [
          { id: `add_${item._id}`, text: 'Add to Cart' }
        ]);
      }
    }
    
    await whatsapp.sendButtons(phone, 'Want to see more items?', [
      { id: 'food_both', text: 'Full Menu' },
      { id: 'view_cart', text: 'View Cart' },
      { id: 'home', text: 'Home' }
    ]);
  },

  async sendItemDetails(phone, menuItems, itemId) {
    const item = menuItems.find(m => m._id.toString() === itemId);
    if (!item) {
      await whatsapp.sendButtons(phone, '❌ Item not found.', [
        { id: 'view_menu', text: 'View Menu' }
      ]);
      return;
    }

    const foodTypeLabel = item.foodType === 'veg' ? '🥦 Veg' : item.foodType === 'nonveg' ? '🍗 Non-Veg' : item.foodType === 'egg' ? '🥚 Egg' : '';
    
    // Rating display
    let ratingDisplay = '';
    if (item.totalRatings > 0) {
      const fullStars = Math.floor(item.avgRating);
      const stars = '⭐'.repeat(fullStars);
      ratingDisplay = `${stars} ${item.avgRating} (${item.totalRatings} reviews)`;
    } else {
      ratingDisplay = '☆☆☆☆☆ No ratings yet';
    }
    
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
    msg += `${ratingDisplay}\n\n`;
    msg += `💰 *Price:* ₹${item.price} / ${item.quantity || 1} ${item.unit || 'piece'}\n`;
    msg += `⏱️ *Prep Time:* ${item.preparationTime || 15} mins\n`;
    if (item.tags?.length) msg += `🏷️ *Tags:* ${item.tags.join(', ')}\n`;
    msg += `\n📝 ${item.description || 'Delicious dish prepared fresh!'}`;

    const buttons = [
      { id: `add_${item._id}`, text: 'Add to Cart' },
      { id: 'view_menu', text: 'Back to Menu' },
      { id: 'review_pay', text: 'Review & Pay' }
    ];

    if (item.image) {
      // Send image with details and buttons in one message
      await whatsapp.sendImageWithButtons(phone, item.image, msg, buttons);
    } else {
      // No image, send regular buttons with details
      await whatsapp.sendButtons(phone, msg, buttons);
    }
  },

  // Send item details for order flow (with Add to Cart focus)
  async sendItemDetailsForOrder(phone, item) {
    const foodTypeLabel = item.foodType === 'veg' ? '🥦 Veg' : item.foodType === 'nonveg' ? '🍗 Non-Veg' : item.foodType === 'egg' ? '🥚 Egg' : '';
    
    // Rating display
    let ratingDisplay = '';
    if (item.totalRatings > 0) {
      const fullStars = Math.floor(item.avgRating);
      const stars = '⭐'.repeat(fullStars);
      ratingDisplay = `${stars} ${item.avgRating} (${item.totalRatings} reviews)`;
    } else {
      ratingDisplay = '☆☆☆☆☆ No ratings yet';
    }
    
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
    msg += `${ratingDisplay}\n\n`;
    msg += `💰 *Price:* ₹${item.price} / ${item.quantity || 1} ${item.unit || 'piece'}\n`;
    msg += `⏱️ *Prep Time:* ${item.preparationTime || 15} mins\n`;
    if (item.tags?.length) msg += `🏷️ *Tags:* ${item.tags.join(', ')}\n`;
    msg += `\n📝 ${item.description || 'Delicious dish prepared fresh!'}`;

    const buttons = [
      { id: `confirm_add_${item._id}`, text: 'Add to Cart' },
      { id: 'add_more', text: 'Back to Menu' },
      { id: 'review_pay', text: 'Review & Pay' }
    ];

    if (item.image) {
      await whatsapp.sendImageWithButtons(phone, item.image, msg, buttons);
    } else {
      await whatsapp.sendButtons(phone, msg, buttons);
    }
  },

  // ============ ORDERING ============
  async sendServiceType(phone) {
    await whatsapp.sendButtons(phone,
      '🛒 *Place Order*\n\nHow would you like to receive your order?',
      [
        { id: 'delivery', text: 'Delivery' },
        { id: 'pickup', text: 'Pickup' },
        { id: 'dine_in', text: 'Dine-in' }
      ]
    );
  },

  async sendMenuForOrder(phone, menuItems, label = 'Select Items', page = 0) {
    // Flatten category arrays and dedupe (category is an array field)
    const categories = [...new Set(menuItems.flatMap(m => Array.isArray(m.category) ? m.category : [m.category]))];
    
    if (!categories.length) {
      await whatsapp.sendButtons(phone, '📋 No menu items available.', [
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    // If 9 or fewer categories (+ All Items = 10), use WhatsApp list without pagination
    if (categories.length <= 9) {
      const rows = [
        { rowId: 'order_cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` }
      ];
      
      categories.forEach(cat => {
        const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
        const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
        rows.push({ rowId: `order_cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items` });
      });

      await whatsapp.sendList(phone, label, 'Choose a category to add items to your cart', 'View Categories',
        [{ title: 'Categories', rows }], 'Tap to browse');
      return;
    }

    // More than 9 categories - use pagination with WhatsApp list
    const CATS_PER_PAGE = 9; // 9 categories + 1 "All Items" = 10 rows max
    const totalPages = Math.ceil(categories.length / CATS_PER_PAGE);
    const startIdx = page * CATS_PER_PAGE;
    const pageCats = categories.slice(startIdx, startIdx + CATS_PER_PAGE);

    // Build rows for the list
    const rows = [];
    
    // Add "All Items" option on first page only
    if (page === 0) {
      rows.push({ rowId: 'order_cat_all', title: '📋 All Items', description: `${menuItems.length} items - View everything` });
    }
    
    pageCats.forEach(cat => {
      const count = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(cat) : m.category === cat).length;
      const safeId = cat.replace(/[^a-zA-Z0-9_]/g, '_');
      rows.push({ rowId: `order_cat_${safeId}`, title: cat.substring(0, 24), description: `${count} items` });
    });

    await whatsapp.sendList(
      phone,
      `🛒 ${label}`,
      `Page ${page + 1}/${totalPages} • ${categories.length} categories\nTap to select a category`,
      'View Categories',
      [{ title: 'Categories', rows }],
      'Select a category'
    );

    // Send navigation buttons
    const buttons = [];
    if (page > 0) buttons.push({ id: `ordercat_page_${page - 1}`, text: 'Previous' });
    if (page < totalPages - 1) buttons.push({ id: `ordercat_page_${page + 1}`, text: 'Next' });
    buttons.push({ id: 'home', text: 'Menu' });

    await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
  },

  async sendMenuForOrderWithLabel(phone, menuItems, label, page = 0) {
    await this.sendMenuForOrder(phone, menuItems, label, page);
  },

  async sendItemsForOrder(phone, menuItems, category, page = 0) {
    // Filter items that include this category (category is an array field)
    const items = menuItems.filter(m => Array.isArray(m.category) ? m.category.includes(category) : m.category === category);
    
    if (!items.length) {
      await whatsapp.sendButtons(phone, `📋 No items in ${category}.`, [
        { id: 'add_more', text: 'Other Categories' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = items.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      return {
        rowId: `add_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${ratingStr} • ₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    const sections = [{ title: `${category} (${items.length} items)`, rows }];

    await whatsapp.sendList(
      phone,
      `📋 ${category}`,
      `Page ${page + 1}/${totalPages} • ${items.length} items total\nTap an item to add to cart`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const safeCat = category.replace(/[^a-zA-Z0-9]/g, '_');
      const buttons = [];
      if (page > 0) buttons.push({ id: `ordercatpage_${safeCat}_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `ordercatpage_${safeCat}_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'home', text: 'Menu' });
      await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  // Send all items for ordering with pagination
  async sendAllItemsForOrder(phone, menuItems, page = 0) {
    if (!menuItems.length) {
      await whatsapp.sendButtons(phone, '📋 No items available.', [
        { id: 'add_more', text: 'Other Categories' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    const getFoodTypeIcon = (type) => type === 'veg' ? '🟢' : type === 'nonveg' ? '🔴' : type === 'egg' ? '🟡' : '';
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(menuItems.length / ITEMS_PER_PAGE);
    const startIdx = page * ITEMS_PER_PAGE;
    const pageItems = menuItems.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    // Build rows for the list
    const rows = pageItems.map(item => {
      const ratingStr = item.totalRatings > 0 ? `⭐${item.avgRating}` : '☆';
      return {
        rowId: `add_${item._id}`,
        title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
        description: `${ratingStr} • ₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
      };
    });

    const sections = [{ title: `All Items (${menuItems.length})`, rows }];

    await whatsapp.sendList(
      phone,
      '📋 All Items',
      `Page ${page + 1}/${totalPages} • ${menuItems.length} items total\nTap an item to add to cart`,
      'View Items',
      sections,
      'Select an item'
    );

    // Send navigation buttons if multiple pages
    if (totalPages > 1) {
      const buttons = [];
      if (page > 0) buttons.push({ id: `orderitems_page_${page - 1}`, text: 'Previous' });
      if (page < totalPages - 1) buttons.push({ id: `orderitems_page_${page + 1}`, text: 'Next' });
      buttons.push({ id: 'home', text: 'Menu' });
      await whatsapp.sendButtons(phone, `Page ${page + 1} of ${totalPages}`, buttons.slice(0, 3));
    }
  },

  async sendQuantitySelection(phone, item) {
    const unitLabel = item.unit || 'piece';
    const qtyLabel = item.quantity || 1;
    await whatsapp.sendButtons(phone,
      `*${item.name}*\n💰 ₹${item.price} / ${qtyLabel} ${unitLabel}\n\nHow many would you like?`,
      [
        { id: 'qty_1', text: '1' },
        { id: 'qty_2', text: '2' },
        { id: 'qty_3', text: '3' }
      ]
    );
  },

  async sendAddedToCart(phone, item, qty, cart) {
    const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);
    const unitInfo = `${item.quantity || 1} ${item.unit || 'piece'}`;
    await whatsapp.sendButtons(phone,
      `✅ *Added to Cart!*\n\n${qty}x ${item.name} (${unitInfo})\n💰 ₹${item.price * qty}\n\n🛒 Cart: ${cartCount} items`,
      [
        { id: 'add_more', text: 'Add More' },
        { id: 'view_cart', text: 'View Cart' },
        { id: 'review_pay', text: 'Review & Pay' }
      ]
    );
  },

  // ============ CART & CHECKOUT ============
  async sendCheckoutOptions(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    let total = 0;
    let cartMsg = '🛒 *Your Cart*\n\n';
    let validItems = 0;
    
    freshCustomer.cart.forEach((item, i) => {
      if (item.menuItem) {
        const subtotal = item.menuItem.price * item.quantity;
        total += subtotal;
        validItems++;
        const unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        cartMsg += `${validItems}. *${item.menuItem.name}* (${unitInfo})\n`;
        cartMsg += `   Qty: ${item.quantity} × ₹${item.menuItem.price} = ₹${subtotal}\n\n`;
      }
    });
    
    if (validItems === 0) {
      // Clean up invalid cart items
      freshCustomer.cart = [];
      await freshCustomer.save();
      
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }
    
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Total: ₹${total}*`;

    // Show Review & Pay, Add More, Cancel buttons
    await whatsapp.sendButtons(phone, cartMsg, [
      { id: 'review_pay', text: 'Review & Pay' },
      { id: 'add_more', text: 'Add More' },
      { id: 'clear_cart', text: 'Cancel' }
    ]);
  },

  async requestLocation(phone) {
    // Request location with action buttons
    await whatsapp.sendLocationRequest(phone,
      `📍 *Share Your Delivery Location*\n\nPlease share your location for accurate delivery.`
    );
  },

  async sendPaymentMethodOptions(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    let total = 0;
    let cartMsg = '🛒 *Order Summary*\n\n';
    let validItems = 0;
    
    freshCustomer.cart.forEach((item, i) => {
      if (item.menuItem) {
        const subtotal = item.menuItem.price * item.quantity;
        total += subtotal;
        validItems++;
        const unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        cartMsg += `${validItems}. *${item.menuItem.name}* (${unitInfo})\n`;
        cartMsg += `   Qty: ${item.quantity} × ₹${item.menuItem.price} = ₹${subtotal}\n\n`;
      }
    });
    
    if (validItems === 0) {
      // Clean up invalid cart items
      freshCustomer.cart = [];
      await freshCustomer.save();
      
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }
    
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Total: ₹${total}*\n\n`;
    
    // Show delivery address if available
    if (freshCustomer.deliveryAddress?.address) {
      cartMsg += `📍 *Delivery Address:*\n${freshCustomer.deliveryAddress.address}\n\n`;
    }
    
    cartMsg += `💳 Select payment method:`;

    await whatsapp.sendButtons(phone, cartMsg, [
      { id: 'pay_upi', text: 'UPI/APP' },
      { id: 'pay_cod', text: 'COD' },
      { id: 'clear_cart', text: 'Cancel' }
    ]);
  },

  async processCODOrder(phone, customer, state) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return { success: false };
    }

    const orderId = generateOrderId();
    let total = 0;
    const items = freshCustomer.cart.filter(item => item.menuItem).map(item => {
      const subtotal = item.menuItem.price * item.quantity;
      total += subtotal;
      return {
        menuItem: item.menuItem._id,
        name: item.menuItem.name,
        quantity: item.quantity,
        price: item.menuItem.price,
        unit: item.menuItem.unit || 'piece',
        unitQty: item.menuItem.quantity || 1,
        image: item.menuItem.image
      };
    });

    if (!items.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return { success: false };
    }

    const order = new Order({
      orderId,
      customer: { phone: freshCustomer.phone, name: freshCustomer.name || 'Customer', email: freshCustomer.email },
      items,
      totalAmount: total,
      serviceType: state.selectedService || 'delivery',
      deliveryAddress: freshCustomer.deliveryAddress ? {
        address: freshCustomer.deliveryAddress.address,
        latitude: freshCustomer.deliveryAddress.latitude,
        longitude: freshCustomer.deliveryAddress.longitude
      } : null,
      paymentMethod: 'cod',
      status: 'confirmed',
      trackingUpdates: [{ status: 'confirmed', message: 'Order confirmed - Cash on Delivery' }]
    });
    await order.save();

    // Mark customer as having ordered (for accurate customer count)
    if (!freshCustomer.hasOrdered) {
      freshCustomer.hasOrdered = true;
    }

    // Track today's orders count
    try {
      const DashboardStats = require('../models/DashboardStats');
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      await DashboardStats.findOneAndUpdate(
        {},
        { 
          $inc: { todayOrders: 1 },
          $set: { todayDate: todayStr, lastUpdated: new Date() }
        },
        { upsert: true }
      );
    } catch (statsErr) {
      console.error('Error tracking today orders:', statsErr.message);
    }

    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Sync to Google Sheets
    googleSheets.addOrder(order).catch(err => console.error('Google Sheets sync error:', err));

    // Clear cart on the fresh customer and save
    freshCustomer.cart = [];
    freshCustomer.orderHistory = freshCustomer.orderHistory || [];
    freshCustomer.orderHistory.push(order._id);
    await freshCustomer.save();
    
    // Also update the original customer object for state consistency
    customer.cart = [];
    customer.orderHistory = freshCustomer.orderHistory;
    
    state.pendingOrderId = orderId;

    let confirmMsg = `✅ *Order Confirmed!*\n\n`;
    confirmMsg += `📦 Order ID: *${orderId}*\n`;
    confirmMsg += `💵 Payment: *Cash on Delivery*\n`;
    confirmMsg += `� Totnal: *₹${total}*\n\n`;
    confirmMsg += `━━━━━━━━━━━━━━━\n`;
    confirmMsg += `*Items:*\n`;
    items.forEach((item, i) => {
      confirmMsg += `${i + 1}. ${item.name} (${item.unitQty} ${item.unit}) x${item.quantity} - ₹${item.price * item.quantity}\n`;
    });
    confirmMsg += `━━━━━━━━━━━━━━━\n\n`;
    confirmMsg += `🙏 Thank you for your order!\nPlease keep ₹${total} ready for payment.`;

    await whatsapp.sendButtons(phone, confirmMsg, [
      { id: 'track_order', text: 'Track Order' },
      { id: 'home', text: 'Main Menu' }
    ]);

    return { success: true };
  },

  async sendOrderReview(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }

    let total = 0;
    let reviewMsg = '📋 *Review Your Order*\n\n';
    let validItems = 0;
    
    freshCustomer.cart.forEach((item, i) => {
      if (item.menuItem) {
        const subtotal = item.menuItem.price * item.quantity;
        total += subtotal;
        validItems++;
        const unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        reviewMsg += `${validItems}. *${item.menuItem.name}* (${unitInfo})\n`;
        reviewMsg += `   Qty: ${item.quantity} × ₹${item.menuItem.price} = ₹${subtotal}\n\n`;
      }
    });
    
    if (validItems === 0) {
      // Clean up invalid cart items
      freshCustomer.cart = [];
      await freshCustomer.save();
      
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return;
    }
    
    reviewMsg += `━━━━━━━━━━━━━━━\n`;
    reviewMsg += `*Total: ₹${total}*\n\n`;
    reviewMsg += `Please confirm your order to proceed with payment.`;

    await whatsapp.sendButtons(phone, reviewMsg, [
      { id: 'confirm_order', text: 'Confirm & Pay' },
      { id: 'add_more', text: 'Add More' },
      { id: 'clear_cart', text: 'Cancel' }
    ]);
  },

  async sendCart(phone, customer) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      await whatsapp.sendButtons(phone,
        '🛒 *Your Cart is Empty*\n\nStart adding delicious items!',
        [
          { id: 'view_menu', text: 'View Menu' },
          { id: 'home', text: 'Main Menu' }
        ]
      );
      return;
    }

    let total = 0;
    let cartMsg = '🛒 *Your Cart*\n\n';
    let validItems = 0;
    
    freshCustomer.cart.forEach((item, i) => {
      if (item.menuItem) {
        const subtotal = item.menuItem.price * item.quantity;
        total += subtotal;
        validItems++;
        const unitInfo = `${item.menuItem.quantity || 1} ${item.menuItem.unit || 'piece'}`;
        cartMsg += `${validItems}. *${item.menuItem.name}* (${unitInfo})\n`;
        cartMsg += `   ${item.quantity} × ₹${item.menuItem.price} = ₹${subtotal}\n\n`;
      }
    });
    
    // If no valid items (all menu items were deleted), clean up cart and show empty message
    if (validItems === 0) {
      // Clean up invalid cart items
      freshCustomer.cart = [];
      await freshCustomer.save();
      
      await whatsapp.sendButtons(phone,
        '🛒 *Your Cart is Empty*\n\nStart adding delicious items!',
        [
          { id: 'view_menu', text: 'View Menu' },
          { id: 'home', text: 'Main Menu' }
        ]
      );
      return;
    }
    
    cartMsg += `━━━━━━━━━━━━━━━\n`;
    cartMsg += `*Total: ₹${total}*`;

    await whatsapp.sendButtons(phone, cartMsg, [
      { id: 'review_pay', text: 'Review & Pay' },
      { id: 'add_more', text: 'Add More' },
      { id: 'clear_cart', text: 'Clear Cart' }
    ]);
  },

  async processCheckout(phone, customer, state) {
    // Refresh customer from database to ensure we have latest cart data
    const freshCustomer = await Customer.findOne({ phone }).populate('cart.menuItem');
    
    if (!freshCustomer?.cart?.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return { success: false };
    }

    const orderId = generateOrderId();
    let total = 0;
    const items = freshCustomer.cart.filter(item => item.menuItem).map(item => {
      const subtotal = item.menuItem.price * item.quantity;
      total += subtotal;
      return {
        menuItem: item.menuItem._id,
        name: item.menuItem.name,
        quantity: item.quantity,
        price: item.menuItem.price,
        unit: item.menuItem.unit || 'piece',
        unitQty: item.menuItem.quantity || 1,
        image: item.menuItem.image
      };
    });

    if (!items.length) {
      await whatsapp.sendButtons(phone, '🛒 Your cart is empty!', [
        { id: 'view_menu', text: 'View Menu' },
        { id: 'home', text: 'Main Menu' }
      ]);
      return { success: false };
    }

    const order = new Order({
      orderId,
      customer: { phone: freshCustomer.phone, name: freshCustomer.name || 'Customer', email: freshCustomer.email },
      items,
      totalAmount: total,
      serviceType: state.selectedService || 'delivery',
      deliveryAddress: freshCustomer.deliveryAddress ? {
        address: freshCustomer.deliveryAddress.address,
        latitude: freshCustomer.deliveryAddress.latitude,
        longitude: freshCustomer.deliveryAddress.longitude
      } : null,
      trackingUpdates: [{ status: 'pending', message: 'Order created, awaiting payment' }]
    });
    await order.save();

    // Mark customer as having ordered (for accurate customer count)
    if (!freshCustomer.hasOrdered) {
      freshCustomer.hasOrdered = true;
    }

    // Track today's orders count
    try {
      const DashboardStats = require('../models/DashboardStats');
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      
      await DashboardStats.findOneAndUpdate(
        {},
        { 
          $inc: { todayOrders: 1 },
          $set: { todayDate: todayStr, lastUpdated: new Date() }
        },
        { upsert: true }
      );
    } catch (statsErr) {
      console.error('Error tracking today orders:', statsErr.message);
    }

    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');

    // Sync to Google Sheets
    googleSheets.addOrder(order).catch(err => console.error('Google Sheets sync error:', err));

    // Clear cart on the fresh customer and save
    freshCustomer.cart = [];
    freshCustomer.orderHistory = freshCustomer.orderHistory || [];
    freshCustomer.orderHistory.push(order._id);
    await freshCustomer.save();
    
    // Also update the original customer object for state consistency
    customer.cart = [];
    customer.orderHistory = freshCustomer.orderHistory;
    
    state.pendingOrderId = orderId;

    try {
      const paymentLink = await razorpayService.createPaymentLink(total, orderId, freshCustomer.phone, freshCustomer.name);
      order.razorpayOrderId = paymentLink.id;
      await order.save();

      await whatsapp.sendOrder(phone, order, items, paymentLink.short_url);
      return { success: true };
    } catch (err) {
      console.error('Payment link error:', err);
      await whatsapp.sendButtons(phone,
        `✅ *Order Created!*\n\nOrder ID: ${orderId}\nTotal: ₹${total}\n\n⚠️ Payment link unavailable.\nPlease contact us.`,
        [
          { id: 'order_status', text: 'Check Status' },
          { id: 'home', text: 'Main Menu' }
        ]
      );
      return { success: true };
    }
  },


  // ============ ORDER MANAGEMENT ============
  async sendOrderStatus(phone) {
    const orders = await Order.find({ 'customer.phone': phone }).sort({ createdAt: -1 }).limit(5);
    
    if (!orders.length) {
      await whatsapp.sendButtons(phone,
        '📋 *No Orders Found*\n\nYou haven\'t placed any orders yet.',
        [{ id: 'place_order', text: 'Order Now' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    const statusEmoji = {
      pending: '⏳', confirmed: '✅', preparing: '👨‍🍳', ready: '📦',
      out_for_delivery: '🛵', delivered: '✅', cancelled: '❌', refunded: '💰'
    };
    const statusLabel = {
      pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
      out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded'
    };

    let msg = '📋 *Your Orders*\n\n';
    orders.forEach(o => {
      msg += `${statusEmoji[o.status] || '•'} *${o.orderId}*\n`;
      msg += `   ${statusLabel[o.status] || o.status.replace('_', ' ')} | ₹${o.totalAmount}\n`;
      msg += `   ${new Date(o.createdAt).toLocaleDateString()}\n\n`;
    });

    await whatsapp.sendButtons(phone, msg, [
      { id: 'track_order', text: 'Track Order' },
      { id: 'home', text: 'Main Menu' }
    ]);
  },

  async sendTrackingOptions(phone) {
    const orders = await Order.find({
      'customer.phone': phone,
      status: { $nin: ['delivered', 'cancelled', 'refunded'] }
    }).sort({ createdAt: -1 }).limit(5);

    if (!orders.length) {
      await whatsapp.sendButtons(phone,
        '📍 *No Active Orders*\n\nNo orders to track right now.',
        [{ id: 'place_order', text: 'Order Now' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    // If only 1 order, directly show tracking details
    if (orders.length === 1) {
      await this.sendTrackingDetails(phone, orders[0].orderId);
      return;
    }

    // Multiple orders - show list to choose
    const statusLabel = {
      pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
      out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded'
    };
    const rows = orders.map(o => ({
      rowId: `track_${o.orderId}`,
      title: o.orderId,
      description: `₹${o.totalAmount} - ${statusLabel[o.status] || o.status.replace('_', ' ')}`
    }));

    await whatsapp.sendList(phone,
      'Track Order',
      `You have ${orders.length} active orders. Select which one to track.`,
      'Select Order',
      [{ title: 'Active Orders', rows }]
    );
  },

  async sendTrackingDetails(phone, orderId) {
    const order = await Order.findOne({ orderId, 'customer.phone': phone });
    
    if (!order) {
      await whatsapp.sendButtons(phone, '❌ Order not found.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    const statusEmoji = {
      pending: '⏳', confirmed: '✅', preparing: '👨‍🍳', ready: '📦',
      out_for_delivery: '🛵', delivered: '✅', cancelled: '❌', refunded: '💰'
    };
    const statusLabel = {
      pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
      out_for_delivery: 'On the Way', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded'
    };

    let msg = `📍 *Order Tracking*\n\n`;
    msg += `Order: *${order.orderId}*\n`;
    msg += `Status: ${statusEmoji[order.status] || '•'} *${(statusLabel[order.status] || order.status.replace('_', ' ')).toUpperCase()}*\n`;
    msg += `Amount: ₹${order.totalAmount}\n\n`;
    msg += `━━━━━━━━━━━━━━━\n*Timeline:*\n\n`;
    
    order.trackingUpdates.forEach(u => {
      msg += `${statusEmoji[u.status] || '•'} ${u.message}\n`;
      msg += `   ${new Date(u.timestamp).toLocaleString()}\n\n`;
    });

    if (order.estimatedDeliveryTime) {
      msg += `⏰ *ETA:* ${new Date(order.estimatedDeliveryTime).toLocaleString()}`;
    }

    await whatsapp.sendButtons(phone, msg, [
      { id: 'order_status', text: 'All Orders' },
      { id: 'home', text: 'Main Menu' }
    ]);
  },

  async sendCancelOptions(phone) {
    // Can cancel orders that are not delivered, cancelled, or refunded
    const orders = await Order.find({
      'customer.phone': phone,
      status: { $in: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'] }
    }).sort({ createdAt: -1 }).limit(5);

    if (!orders.length) {
      await whatsapp.sendButtons(phone,
        '❌ *No Orders to Cancel*\n\nNo cancellable orders found.',
        [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    // If only 1 order, directly cancel it
    if (orders.length === 1) {
      await this.processCancellation(phone, orders[0].orderId);
      return;
    }

    // Multiple orders - show list to choose
    const rows = orders.map(o => ({
      rowId: `cancel_${o.orderId}`,
      title: o.orderId,
      description: `₹${o.totalAmount} - ${o.status} - ${o.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}`
    }));

    await whatsapp.sendList(phone,
      'Cancel Order',
      `You have ${orders.length} active orders. Select which one to cancel.`,
      'Select Order',
      [{ title: 'Your Orders', rows }],
      'This cannot be undone'
    );
  },

  async processCancellation(phone, orderId) {
    const order = await Order.findOne({ orderId, 'customer.phone': phone });
    
    if (!order) {
      await whatsapp.sendButtons(phone, '❌ Order not found.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    // Cannot cancel delivered, cancelled, or refunded orders
    if (['delivered', 'cancelled', 'refunded'].includes(order.status)) {
      await whatsapp.sendButtons(phone,
        `❌ *Cannot Cancel*\n\nOrder is already ${order.status.replace('_', ' ')}.`,
        [{ id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    order.status = 'cancelled';
    order.statusUpdatedAt = new Date(); // For auto-cleanup
    order.cancellationReason = 'Customer requested';
    order.trackingUpdates.push({ status: 'cancelled', message: 'Order cancelled by customer', timestamp: new Date() });
    
    // Update payment status for COD orders
    if (order.paymentMethod === 'cod' && order.paymentStatus === 'pending') {
      order.paymentStatus = 'cancelled';
    }
    
    let msg = `✅ *Order Cancelled*\n\nOrder ${orderId} has been cancelled.`;
    
    // Schedule refund if already paid via UPI/online (mark as pending for admin approval)
    if (order.paymentStatus === 'paid' && order.razorpayPaymentId) {
      console.log('💰 Marking refund as pending for order:', orderId, 'Payment ID:', order.razorpayPaymentId);
      
      order.refundStatus = 'pending';
      order.refundAmount = order.totalAmount;
      order.refundRequestedAt = new Date();
      order.trackingUpdates.push({ 
        status: 'refund_pending', 
        message: `Refund of ₹${order.totalAmount} pending admin approval`, 
        timestamp: new Date() 
      });
      
      msg += `\n\n💰 *Refund Requested*\nYour refund of ₹${order.totalAmount} is pending approval.\n\n⏱️ You'll receive a confirmation once processed.`;
      console.log('⏳ Refund pending approval for order:', orderId);
    } else if (order.paymentStatus === 'paid' && !order.razorpayPaymentId) {
      // Paid but no payment ID (edge case)
      order.refundStatus = 'pending';
      order.refundAmount = order.totalAmount;
      msg += `\n\n💰 *Refund Processing*\nYour refund of ₹${order.totalAmount} is being processed. Our team will contact you shortly.`;
    }
    
    await order.save();
    
    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');
    
    // Sync cancellation to Google Sheets
    googleSheets.updateOrderStatus(order.orderId, 'cancelled', order.paymentStatus).catch(err => 
      console.error('Google Sheets sync error:', err)
    );
    console.log('📊 Customer cancelled order, syncing to Google Sheets:', order.orderId);

    await whatsapp.sendButtons(phone, msg, [
      { id: 'place_order', text: 'New Order' },
      { id: 'home', text: 'Main Menu' }
    ]);
  },

  async sendRefundOptions(phone) {
    // Show paid orders that are not delivered and not already refunded
    const orders = await Order.find({
      'customer.phone': phone,
      paymentStatus: 'paid',
      status: { $nin: ['delivered', 'refunded'] },
      refundStatus: { $ne: 'completed' }
    }).sort({ createdAt: -1 }).limit(5);

    if (!orders.length) {
      await whatsapp.sendButtons(phone,
        '💰 *No Refundable Orders*\n\nNo paid orders available for refund.\n\nNote: Delivered orders cannot be refunded.',
        [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    // If only 1 order, directly process refund
    if (orders.length === 1) {
      await this.processRefund(phone, orders[0].orderId);
      return;
    }

    // Multiple orders - show list to choose
    const rows = orders.map(o => ({
      rowId: `refund_${o.orderId}`,
      title: o.orderId,
      description: `₹${o.totalAmount} - ${o.status}${o.refundStatus === 'pending' ? ' (Refund Pending)' : ''}`
    }));

    await whatsapp.sendList(phone,
      'Request Refund',
      `You have ${orders.length} paid orders. Select which one to refund.`,
      'Select Order',
      [{ title: 'Paid Orders', rows }]
    );
  },

  async processRefund(phone, orderId) {
    const order = await Order.findOne({ orderId, 'customer.phone': phone });
    
    if (!order) {
      await whatsapp.sendButtons(phone, '❌ Order not found.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    if (order.paymentStatus !== 'paid') {
      await whatsapp.sendButtons(phone, '❌ No payment found for this order.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    // Cannot refund delivered orders
    if (order.status === 'delivered') {
      await whatsapp.sendButtons(phone, '❌ Delivered orders cannot be refunded.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    if (order.refundStatus === 'completed' || order.paymentStatus === 'refunded') {
      await whatsapp.sendButtons(phone, '❌ This order is already refunded.', [{ id: 'home', text: 'Main Menu' }]);
      return;
    }

    if (order.refundStatus === 'pending' || order.refundStatus === 'scheduled') {
      await whatsapp.sendButtons(phone, 
        `⏳ *Refund Already Scheduled*\n\nYour refund of ₹${order.totalAmount} is being processed.\n\n⏱️ You'll receive a confirmation once complete.`,
        [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
      );
      return;
    }

    // Mark refund as pending for admin approval
    order.refundStatus = 'pending';
    order.refundAmount = order.totalAmount;
    order.status = 'cancelled';
    order.statusUpdatedAt = new Date();
    order.refundRequestedAt = new Date();
    order.trackingUpdates.push({ status: 'refund_pending', message: 'Refund requested by customer, pending admin approval', timestamp: new Date() });
    await order.save();
    
    // Emit event for real-time updates
    const dataEvents = require('./eventEmitter');
    dataEvents.emit('orders');
    dataEvents.emit('dashboard');
    
    // Sync to Google Sheets
    googleSheets.updateOrderStatus(order.orderId, 'cancelled', order.paymentStatus).catch(err => 
      console.error('Google Sheets sync error:', err)
    );
    console.log('📊 Customer requested refund, syncing to Google Sheets:', order.orderId);

    await whatsapp.sendButtons(phone,
      `✅ *Refund Requested!*\n\nOrder: ${orderId}\nAmount: ₹${order.totalAmount}\n\n⏱️ Your refund is pending approval.\nYou'll receive a confirmation once processed.`,
      [{ id: 'order_status', text: 'View Orders' }, { id: 'home', text: 'Main Menu' }]
    );
  },

  // ============ HELP ============
  async sendHelp(phone) {
    const msg = `❓ *Help & Support*\n\n` +
      `🍽️ *Ordering*\n` +
      `• Browse menu and place orders\n` +
      `• Choose delivery, pickup, or dine-in\n\n` +
      `📦 *Order Management*\n` +
      `• Track your order in real-time\n` +
      `• Cancel orders before preparation\n` +
      `• Request refunds for paid orders\n\n` +
      `💬 *Quick Commands*\n` +
      `• "hi" - Main menu\n` +
      `• "menu" - View menu\n` +
      `• "cart" - View cart\n` +
      `• "status" - Check orders`;

    await whatsapp.sendButtons(phone, msg, [
      { id: 'home', text: 'Main Menu' },
      { id: 'place_order', text: 'Order Now' }
    ]);
  }
};

module.exports = chatbot;
