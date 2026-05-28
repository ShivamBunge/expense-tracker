// Map common keywords to your custom Google Sheet categories
const KEYWORD_MAP = {
    'petrol': 'Car',
    'diesel': 'Car',
    'ola': 'Travel',
    'uber': 'Travel',
    'rickshaw': 'Travel',
    'auto': 'Travel',
    'toll': 'Travel',
    'pizza': 'Outing',
    'movie': 'Outing',
    'cricket': 'Outing',
    'burger': 'Outing',
    'mri': 'Medical',
    'clinic': 'Medical',
    'doctor': 'Medical',
    'medicine': 'Medical',
    'juice': 'Food',
    'veggies': 'Food',
    'vegetables': 'Food',
    'delight': 'Food',
    'milk': 'Food',
    'lassi': 'Food',
    'recharge': 'Bills ( Car cleaning, TV, Wifi)',
    'wifi': 'Bills ( Car cleaning, TV, Wifi)',
    'cleanser': 'Self care',
    'oil': 'Self care',
    'haircut': 'Self care',
    'prepayment': 'House',
    'emi': 'House'
};

const DEFAULT_CATEGORIES = ['Food', 'Car', 'Medical', 'Shopping', 'House', 'Bills ( Car cleaning, TV, Wifi)', 'Outing', 'Self care', 'Travel', 'Other'];

function isValidExpense(text) {
    // Accepts optional currency symbol, commas, and decimals at start of message
    return /^\s*[₹$€£]?\s*[\d,]+(?:\.\d{1,2})?/.test(text.trim());
}

function parseExpense(text) {
    const trimmed = text.trim();
    // capture the leading amount (with optional currency symbol)
    const match = trimmed.match(/^\s*([₹$€£]?\s*[\d,]+(?:\.\d{1,2})?)/);
    let amount = '0.00';
    let rest = trimmed;

    if (match) {
        const raw = match[1].replace(/[₹$€£\s,]/g, '');
        const num = parseFloat(raw);
        amount = isNaN(num) ? '0.00' : num.toFixed(2);
        rest = trimmed.slice(match[0].length).trim();
    } else {
        const tokens = trimmed.split(/\s+/);
        rest = tokens.slice(1).join(' ').trim();
    }

    let description = rest || 'Unspecified item';
    let category = 'Food'; // Default safety fallback

    const descriptionTokens = description.split(/\s+/).filter(Boolean);

    if (descriptionTokens.length > 0) {
        // check if last token is explicitly a category
        const lastToken = descriptionTokens[descriptionTokens.length - 1];
        const directCategoryMatch = DEFAULT_CATEGORIES.find(cat => cat.toLowerCase() === lastToken.toLowerCase());
        if (directCategoryMatch) {
            category = directCategoryMatch;
            descriptionTokens.pop();
            description = descriptionTokens.join(' ') || 'Unspecified item';
        } else {
            category = autoAssignCategory(description);
        }
    } else {
        category = autoAssignCategory(description);
    }

    // Generates Ist Timestamp (Asia/Kolkata) matching your sheet layout
    const timestamp = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: false
    }).replace(',', '');

    return {
        timestamp,
        description,
        amount: `-${amount}`,
        category
    };
}

function autoAssignCategory(descriptionText) {
    const lowerDesc = descriptionText.toLowerCase();
    for (const [keyword, cat] of Object.entries(KEYWORD_MAP)) {
        if (lowerDesc.includes(keyword)) {
            return cat;
        }
    }
    return 'Food'; // Default fall back if no keywords match
}

module.exports = { isValidExpense, parseExpense };