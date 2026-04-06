// =====================================================================
// 1. FRONTEND ENVIRONMENT TOGGLE
// Change this single value to "Dev" or "Prod"
// =====================================================================
const ENVIRONMENT = "Dev"; 

const DEV_API_URL = 'https://script.google.com/macros/s/AKfycbzsU73hNlYm9vqAY4Mn80s_6KMP79eLCi11u8d56NkO_1iDp7a0ew09OWOdvfhzK75T/exec';
const PROD_API_URL = 'https://script.google.com/macros/s/AKfycbw21ZGdd-SfmRJrB-zMcfzVKTzIG-hU-BwKaA33J1bukq-4_ZJGQfH6_KBr4LdgjZvXmw/exec';

const CONFIG = {
    ENVIRONMENT: ENVIRONMENT,
    API_URL: ENVIRONMENT === "Dev" ? DEV_API_URL : PROD_API_URL,
    
    STATIC_GUIDES: { 
        'life skills': 'Can trainee carry out daily activities like bathing, dressing, eating independently? Household chores? Use telephone? Public transport?', 
        'academic level': 'Number/money concept? Write name/address/phone number?', 
        'social skills': 'Eye-contact? Interpersonal skill? Friends at work/school? Mannerisms?', 
        'motor skills': 'Fine (fork/chopsticks) and Gross (balancing, running, jumping) motor skills?', 
        "trainee's t-shirt size": 'XS: 32-34 / S: 36-38 / M: 38-40 / L: 40-42 / XL: 46-48 / XXL: 50-52 / XXXL: 54-56', 
        'temperament': 'Please elaborate.', 
        'personal feedback': 'Impression of family? Habits during session? Interactions so far?', 
        'attention span': 'Is your trainee attentive/distracted? Please elaborate.', 
        'responsiveness': 'Is your trainee quick to respond/slow to respond/has no response? Please elaborate.', 
        'receptiveness': 'Able to understand instructions with/without help OR unable even with help? What kind of help?' 
    },
    
    LIKERT_CONFIG: { 
        'mobility': { left: 'Need support to walk and can be clumsy', right: 'Agile and stable' }, 
        'comprehension': { left: 'Very Low (unable to follow instructions)', right: 'High (able to follow instructions effectively)' }, 
        'verbal': { left: 'Very Low (non-verbal)', right: 'High (able to engage in conversations)' } 
    }
};
