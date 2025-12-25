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
  // Handles voice recognition mistakes like "card", "cut", "kart", "cot" instead of "cart"
  isCartIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const cartPatterns = [
      // English - including voice recognition mistakes (card, cut, kart, cot, cart)
      /\bmy cart\b/, /\bview cart\b/, /\bshow cart\b/, /\bsee cart\b/, /\bcart\b/,
      /\bmy card\b/, /\bview card\b/, /\bshow card\b/, /\bsee card\b/, // voice mistake: card
      /\bmy cut\b/, /\bview cut\b/, /\bshow cut\b/, /\bsee cut\b/, // voice mistake: cut
      /\bmy kart\b/, /\bview kart\b/, /\bshow kart\b/, /\bsee kart\b/, /\bkart\b/, // voice mistake: kart
      /\bmy cot\b/, /\bview cot\b/, /\bshow cot\b/, // voice mistake: cot
      /\bbasket\b/, /\bmy items\b/, /\bshow items\b/, /\bview items\b/, /\bsee items\b/,
      /\bshow my items\b/, /\bview my items\b/, /\bmy order items\b/,
      /\bwhat'?s in my cart\b/, /\bwhats in cart\b/, /\bwhat'?s in cart\b/,
      /\bwhat'?s in my card\b/, /\bwhats in card\b/, // voice mistake
      /\bcheck cart\b/, /\bcheck card\b/, /\bopen cart\b/, /\bopen card\b/,
      /\bsee my order\b/, /\bshow my order\b/, /\bmy order\b/,
      // Hindi
      /\bcart me kya hai\b/, /\bcart dikhao\b/, /\bcart dekho\b/, /\bmera cart\b/,
      /\bcard me kya hai\b/, /\bcard dikhao\b/, /\bcard dekho\b/, /\bmera card\b/, // voice mistake
      /\bमेरा कार्ट\b/, /\bकार्ट\b/, /\bकार्ट दिखाओ\b/, /\bकार्ट में क्या है\b/,
      /\bआइटम दिखाओ\b/, /\bमेरे आइटम\b/, /\bसामान दिखाओ\b/,
      // Telugu
      /\bcart chupinchu\b/, /\bnaa cart\b/, /\bకార్ట్\b/, /\bనా కార్ట్\b/, /\bకార్ట్ చూపించు\b/,
      /\bcard chupinchu\b/, /\bnaa card\b/, // voice mistake
      /\bనా ఐటమ్స్\b/, /\bఐటమ్స్ చూపించు\b/,
      // Tamil
      /\bcart kaattu\b/, /\ben cart\b/, /\bகார்ட்\b/, /\bஎன் கார்ட்\b/,
      /\bcard kaattu\b/, /\ben card\b/, // voice mistake
      /\bஎன் ஐட்டம்ஸ்\b/, /\bஐட்டம்ஸ் காட்டு\b/,
      // Kannada
      /\bcart toorisu\b/, /\bnanna cart\b/, /\bಕಾರ್ಟ್\b/, /\bನನ್ನ ಕಾರ್ಟ್\b/,
      /\bcard toorisu\b/, /\bnanna card\b/, // voice mistake
      // Malayalam
      /\bcart kaanikkuka\b/, /\bente cart\b/, /\bകാർട്ട്\b/, /\bഎന്റെ കാർട്ട്\b/,
      /\bcard kaanikkuka\b/, /\bente card\b/, // voice mistake
      // Bengali
      /\bcart dekho\b/, /\bamar cart\b/, /\bকার্ট\b/, /\bআমার কার্ট\b/,
      /\bcard dekho\b/, /\bamar card\b/, // voice mistake
      // Marathi
      /\bcart dakhva\b/, /\bmaza cart\b/, /\bकार्ट\b/, /\bमाझा कार्ट\b/,
      /\bcard dakhva\b/, /\bmaza card\b/, // voice mistake
      // Gujarati
      /\bcart batavo\b/, /\bmaru cart\b/, /\bકાર્ટ\b/, /\bમારું કાર્ટ\b/,
      /\bcard batavo\b/, /\bmaru card\b/ // voice mistake
    ];
    return cartPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect clear/empty cart intent from text/voice
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  // Handles voice recognition mistakes like "card", "cut", "kart", "cot", "caught" instead of "cart"
  isClearCartIntent(text) {
    if (!text) return false;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    const clearCartPatterns = [
      // English - including ALL voice recognition mistakes (card, cut, kart, cot, caught, cat, court)
      // Clear variations
      /\bclear cart\b/, /\bclear my cart\b/, /\bempty cart\b/, /\bempty my cart\b/,
      /\bclear card\b/, /\bclear my card\b/, /\bempty card\b/, /\bempty my card\b/,
      /\bclear cut\b/, /\bclear my cut\b/, /\bempty cut\b/, /\bempty my cut\b/,
      /\bclear kart\b/, /\bclear my kart\b/, /\bempty kart\b/, /\bempty my kart\b/,
      /\bclear cot\b/, /\bclear my cot\b/, /\bclear caught\b/, /\bclear my caught\b/,
      /\bclear cat\b/, /\bclear my cat\b/, /\bclear court\b/, /\bclear my court\b/,
      // Remove variations - ALL voice mistakes
      /\bremove cart\b/, /\bremove my cart\b/, /\bremove the cart\b/,
      /\bremove card\b/, /\bremove my card\b/, /\bremove the card\b/,
      /\bremove cut\b/, /\bremove my cut\b/, /\bremove the cut\b/,
      /\bremove kart\b/, /\bremove my kart\b/, /\bremove the kart\b/,
      /\bremove cot\b/, /\bremove my cot\b/, /\bremove caught\b/, /\bremove my caught\b/,
      /\bremove cat\b/, /\bremove my cat\b/, /\bremove court\b/, /\bremove my court\b/,
      /\bremove all\b/, /\bremove items\b/, /\bremove all items\b/, /\bremove my items\b/,
      /\bremove everything\b/, /\bremove from cart\b/, /\bremove from card\b/,
      // Delete variations - ALL voice mistakes
      /\bdelete cart\b/, /\bdelete my cart\b/, /\bdelete the cart\b/,
      /\bdelete card\b/, /\bdelete my card\b/, /\bdelete the card\b/,
      /\bdelete cut\b/, /\bdelete my cut\b/, /\bdelete the cut\b/,
      /\bdelete kart\b/, /\bdelete my kart\b/, /\bdelete the kart\b/,
      /\bdelete cot\b/, /\bdelete my cot\b/, /\bdelete caught\b/, /\bdelete my caught\b/,
      /\bdelete cat\b/, /\bdelete my cat\b/, /\bdelete court\b/, /\bdelete my court\b/,
      /\bdelete all\b/, /\bdelete items\b/, /\bdelete my items\b/, /\bdelete everything\b/,
      // Clean/Reset variations
      /\bclean cart\b/, /\bclean card\b/, /\bclean cut\b/, /\bclean kart\b/,
      /\breset cart\b/, /\breset card\b/, /\breset cut\b/, /\breset kart\b/,
      // Cancel variations
      /\bcancel cart\b/, /\bcancel my cart\b/, /\bcancel card\b/, /\bcancel my card\b/,
      /\bcancel cut\b/, /\bcancel my cut\b/, /\bcancel kart\b/, /\bcancel my kart\b/,
      /\bcancel items\b/, /\bcancel my items\b/, /\bcancel all\b/,
      // Other English patterns
      /\bclear basket\b/, /\bempty basket\b/, /\bclear all\b/, /\bclear items\b/, /\bclear my items\b/,
      /\bstart fresh\b/, /\bstart over\b/,
      // Hindi
      /\bcart khali karo\b/, /\bcart saaf karo\b/, /\bcart clear karo\b/,
      /\bcard khali karo\b/, /\bcard saaf karo\b/, /\bcard clear karo\b/,
      /\bsab hatao\b/, /\bsab remove karo\b/, /\bsab delete karo\b/,
      /\bitems hatao\b/, /\bसब आइटम हटाओ\b/, /\bआइटम्स हटाओ\b/,
      /\bकार्ट खाली करो\b/, /\bकार्ट साफ करो\b/, /\bसब हटाओ\b/,
      /\bकार्ट क्लियर\b/, /\bसब कुछ हटाओ\b/, /\bआइटम हटाओ\b/,
      // Telugu
      /\bcart clear cheyyi\b/, /\bcart khali cheyyi\b/, /\banni teeseyyi\b/,
      /\bcard clear cheyyi\b/, /\bcard khali cheyyi\b/,
      /\bకార్ట్ క్లియర్\b/, /\bకార్ట్ ఖాళీ చేయి\b/, /\bఅన్నీ తీసేయి\b/,
      /\bఐటమ్స్ తీసేయి\b/, /\bకార్ట్ తీసేయి\b/, /\bఐటమ్స్ క్లియర్\b/,
      // Tamil
      /\bcart clear pannu\b/, /\bcart kaali pannu\b/, /\bellam eduthudu\b/,
      /\bcard clear pannu\b/, /\bcard kaali pannu\b/,
      /\bகார்ட் கிளியர்\b/, /\bகார்ட் காலி\b/, /\bஎல்லாம் எடுத்துடு\b/,
      /\bஐட்டம்ஸ் நீக்கு\b/, /\bஐட்டம்ஸ் கிளியர்\b/,
      // Kannada
      /\bcart clear maadi\b/, /\bcart khali maadi\b/, /\bella tegedu\b/,
      /\bcard clear maadi\b/, /\bcard khali maadi\b/,
      /\bಕಾರ್ಟ್ ಕ್ಲಿಯರ್\b/, /\bಕಾರ್ಟ್ ಖಾಲಿ\b/, /\bಎಲ್ಲಾ ತೆಗೆದು\b/,
      // Malayalam
      /\bcart clear cheyyuka\b/, /\bcart kaali aakkuka\b/, /\bellam maarruka\b/,
      /\bcard clear cheyyuka\b/, /\bcard kaali aakkuka\b/,
      /\bകാർട്ട് ക്ലിയർ\b/, /\bകാർട്ട് കാലി\b/, /\bഎല്ലാം മാറ്റുക\b/,
      // Bengali
      /\bcart clear koro\b/, /\bcart khali koro\b/, /\bsob soriyo\b/,
      /\bcard clear koro\b/, /\bcard khali koro\b/, // voice mistake
      /\bকার্ট ক্লিয়ার\b/, /\bকার্ট খালি করো\b/, /\bসব সরিয়ে দাও\b/,
      // Marathi
      /\bcart clear kara\b/, /\bcart khali kara\b/, /\bsagla kadhun taka\b/,
      /\bcard clear kara\b/, /\bcard khali kara\b/, // voice mistake
      /\bकार्ट क्लियर करा\b/, /\bकार्ट खाली करा\b/, /\bसगळं काढून टाका\b/,
      // Gujarati
      /\bcart clear karo\b/, /\bcart khali karo\b/, /\bbadhu kaadhi nakho\b/,
      /\bcard clear karo\b/, /\bcard khali karo\b/, // voice mistake
      /\bકાર્ટ ક્લિયર\b/, /\bકાર્ટ ખાલી કરો\b/, /\bબધું કાઢી નાખો\b/
    ];
    return clearCartPatterns.some(pattern => pattern.test(lowerText));
  },

  // Helper to detect show menu/items intent from text/voice
  // Returns: { showMenu: true, foodType: 'veg'|'nonveg'|'both'|null, searchTerm: string|null }
  // Supports: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati
  isShowMenuIntent(text) {
    if (!text) return null;
    const lowerText = ' ' + text.toLowerCase() + ' ';
    
    // Patterns for showing menu/items
    const menuPatterns = [
      // English
      /\bshow\s+(?:me\s+)?(?:the\s+)?menu\b/, /\bshow\s+(?:me\s+)?(?:all\s+)?items\b/,
      /\bshow\s+(?:me\s+)?(?:the\s+)?food\b/, /\bwhat\s+(?:do\s+you\s+have|items|food)\b/,
      /\blist\s+(?:all\s+)?(?:items|menu|food)\b/, /\bdisplay\s+(?:menu|items)\b/,
      /\bsee\s+(?:the\s+)?(?:menu|items|food)\b/, /\bview\s+(?:all\s+)?(?:items|food)\b/,
      /\ball\s+items\b/, /\bfull\s+menu\b/, /\bentire\s+menu\b/,
      // Hindi
      /\bmenu\s+dikhao\b/, /\bsab\s+items\s+dikhao\b/, /\bkhana\s+dikhao\b/,
      /\bमेन्यू\s+दिखाओ\b/, /\bसब\s+आइटम\b/, /\bखाना\s+दिखाओ\b/, /\bक्या\s+है\b/,
      // Telugu
      /\bmenu\s+chupinchu\b/, /\banni\s+items\s+chupinchu\b/, /\bమెనూ\s+చూపించు\b/,
      /\bఅన్ని\s+ఐటమ్స్\b/, /\bఏమి\s+ఉంది\b/,
      // Tamil
      /\bmenu\s+kaattu\b/, /\bella\s+items\s+kaattu\b/, /\bமெனு\s+காட்டு\b/,
      /\bஎல்லா\s+ஐட்டம்ஸ்\b/, /\bஎன்ன\s+இருக்கு\b/,
      // Kannada
      /\bmenu\s+toorisu\b/, /\bella\s+items\s+toorisu\b/, /\bಮೆನು\s+ತೋರಿಸು\b/,
      /\bಎಲ್ಲಾ\s+ಐಟಮ್ಸ್\b/, /\bಏನು\s+ಇದೆ\b/,
      // Malayalam
      /\bmenu\s+kaanikkuka\b/, /\bellam\s+kaanikkuka\b/, /\bമെനു\s+കാണിക്കുക\b/,
      /\bഎല്ലാം\s+കാണിക്കുക\b/, /\bഎന്താണ്\s+ഉള്ളത്\b/,
      // Bengali
      /\bmenu\s+dekho\b/, /\bsob\s+items\s+dekho\b/, /\bমেনু\s+দেখো\b/,
      /\bসব\s+আইটেম\b/, /\bকি\s+আছে\b/,
      // Marathi
      /\bmenu\s+dakhva\b/, /\bsagla\s+dakhva\b/, /\bमेन्यू\s+दाखवा\b/,
      /\bसगळे\s+आइटम\b/, /\bकाय\s+आहे\b/,
      // Gujarati
      /\bmenu\s+batavo\b/, /\bbadha\s+items\s+batavo\b/, /\bમેનુ\s+બતાવો\b/,
      /\bબધા\s+આઇટમ્સ\b/, /\bશું\s+છે\b/
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
    const rows = pageItems.map(item => ({
      rowId: `view_${item._id}`,
      title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
      description: `₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
    }));

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
    const rows = pageItems.map(item => ({
      rowId: `view_${item._id}`,
      title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
      description: `₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
    }));

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
    const rows = pageItems.map(item => ({
      rowId: `view_${item._id}`,
      title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
      description: `₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
    }));

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
    
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
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
    
    let msg = `*${item.name}*${foodTypeLabel ? ` ${foodTypeLabel}` : ''}\n\n`;
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
    const rows = pageItems.map(item => ({
      rowId: `add_${item._id}`,
      title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
      description: `₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
    }));

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
    const rows = pageItems.map(item => ({
      rowId: `add_${item._id}`,
      title: `${getFoodTypeIcon(item.foodType)} ${item.name}`.substring(0, 24),
      description: `₹${item.price} • ${item.quantity || 1} ${item.unit || 'piece'}`.substring(0, 72)
    }));

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
