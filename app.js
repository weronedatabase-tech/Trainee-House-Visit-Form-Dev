// =====================================================================
// 1. FRONTEND ENVIRONMENT TOGGLE
// Change this single value to "Dev" or "Prod"
// =====================================================================
const ENVIRONMENT = "Prod"; 

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

// =====================================================================
// MAIN APPLICATION LOGIC
// =====================================================================
function appData() {
   return {
       isDevMode: CONFIG.ENVIRONMENT === 'Dev',
       view: 'dashboard', 
       darkMode: localStorage.getItem('theme') === 'dark',
       isLoggedIn: false, // Always starts as false to force login
       loginPass: '', 
       showLoginPass: false, 
       loginError: '',
       toast: { visible: false, message: '', type: 'success' },
       headers: [], trainees: [], projects:[], mapping: {}, sectionOrder:[], searchQuery: '', loadingTrainees: false,
       formData: {}, isSubmitting: false, isLoading: false, loadingText: 'Please wait...',
       showSettings: false, settingsPass: '', showSettingsPass: false, settingsUnlocked: false, settingsError: '', 
       newColumnName: '', newAppPass: '', newSettingsPass: '',
       
       expandedSections: {},

       // Rolodex Date Picker State
       showDatePicker: false,
       pickerTargetIndex: null,
       pickerDay: 1,
       pickerMonth: 0,
       pickerYear: new Date().getFullYear(),
       months:['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
       get years() {
           // Expanded date range to cover typical Dates of Birth up to future projections
           const startYear = 1940;
           const endYear = 2100;
           return Array.from({length: endYear - startYear + 1}, (_, i) => startYear + i);
       },

       async initApp() {
           this.toggleTheme(false);
           this.loadConfigFromStorage();
           if (navigator.onLine) this.fetchConfig();
       },

       toggleSection(title) {
           this.expandedSections[title] = !this.expandedSections[title];
       },

       formatDateDisplay(rawDate) {
           if (!rawDate) return '';
           const strDate = String(rawDate);
           const cleanDate = strDate.split('T')[0];
           const parts = cleanDate.split('-'); 
           
           // If it securely matches YYYY-MM-DD
           if (parts.length === 3 && parts[0].length === 4) {
               const d = new Date(parts[0], parts[1]-1, parts[2]);
               if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
           }
           
           // Fallback attempt
           const d = new Date(strDate);
           if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
           
           // If totally unparsable, just return the string instead of "Invalid Date"
           return strDate;
       },

       // --- Rolodex Date Picker Methods ---
       daysInMonth(month, year) {
           return new Date(year, month + 1, 0).getDate();
       },
       openDatePicker(index) {
           this.pickerTargetIndex = index;
           let currentDate = this.formData[index];
           let d = new Date();
           
           if (currentDate) {
               const strDate = String(currentDate);
               const cleanDate = strDate.split('T')[0];
               const parts = cleanDate.split('-');
               
               if (parts.length === 3 && parts[0].length === 4) {
                   const temp = new Date(parts[0], parts[1] - 1, parts[2]);
                   if (!isNaN(temp.getTime())) d = temp;
               } else {
                   const temp = new Date(strDate);
                   if (!isNaN(temp.getTime())) d = temp;
               }
           }
           
           if (isNaN(d.getTime())) d = new Date(); // Safety fallback to today

           this.pickerDay = d.getDate();
           this.pickerMonth = d.getMonth();
           this.pickerYear = d.getFullYear();
           
           // Ensure year is within the Rolodex bounds
           if (this.pickerYear < this.years[0]) this.pickerYear = this.years[0];
           if (this.pickerYear > this.years[this.years.length - 1]) this.pickerYear = this.years[this.years.length - 1];

           this.showDatePicker = true;
           
           setTimeout(() => {
               this.scrollToItem('day', this.pickerDay, false);
               this.scrollToItem('month', this.pickerMonth, false);
               this.scrollToItem('year', this.pickerYear, false);
           }, 50);
       },
       closeDatePicker() {
           this.showDatePicker = false;
       },
       confirmDatePicker() {
           const y = this.pickerYear;
           const m = String(this.pickerMonth + 1).padStart(2, '0');
           const d = String(this.pickerDay).padStart(2, '0');
           this.formData[this.pickerTargetIndex] = `${y}-${m}-${d}`;
           this.closeDatePicker();
       },
       scrollToItem(type, value, smooth = true) {
           const container = document.getElementById(`wheel-${type}`);
           if (!container) return;
           
           let index = 0;
           if (type === 'day') index = value - 1;
           if (type === 'month') index = value;
           if (type === 'year') index = this.years.indexOf(value);
           
           const itemHeight = 40; 
           container.scrollTo({
               top: index * itemHeight,
               behavior: smooth ? 'smooth' : 'auto'
           });
           
           this.updateStateFromValue(type, value, smooth);
       },
       updateStateFromValue(type, value, smooth) {
           if (type === 'day') this.pickerDay = value;
           if (type === 'month') {
               this.pickerMonth = value;
               this.adjustDays(smooth);
           }
           if (type === 'year') {
               this.pickerYear = value;
               this.adjustDays(smooth);
           }
       },
       adjustDays(smooth) {
           const maxDays = this.daysInMonth(this.pickerMonth, this.pickerYear);
           if (this.pickerDay > maxDays) {
               this.pickerDay = maxDays;
               this.scrollToItem('day', this.pickerDay, smooth);
           }
       },
       updatePickerFromScroll(type) {
           const container = document.getElementById(`wheel-${type}`);
           if (!container) return;
           
           const itemHeight = 40;
           const index = Math.round(container.scrollTop / itemHeight);
           
           if (type === 'day') {
               const newDay = index + 1;
               if (newDay !== this.pickerDay && newDay >= 1 && newDay <= this.daysInMonth(this.pickerMonth, this.pickerYear)) {
                   this.pickerDay = newDay;
               }
           } else if (type === 'month') {
               if (index !== this.pickerMonth && index >= 0 && index <= 11) {
                   this.pickerMonth = index;
                   this.adjustDays(true);
               }
           } else if (type === 'year') {
               const newYear = this.years[index];
               if (newYear !== this.pickerYear && newYear) {
                   this.pickerYear = newYear;
                   this.adjustDays(true);
               }
           }
       },

       // --- Core App Methods ---
       setLoading(s, t='Loading...') { this.isLoading = s; this.loadingText = t; },
       toggleTheme(t=true) { 
           if(t) this.darkMode = !this.darkMode; 
           localStorage.setItem('theme', this.darkMode ? 'dark' : 'light'); 
           if(this.darkMode) document.documentElement.classList.add('dark'); 
           else document.documentElement.classList.remove('dark'); 
       },
       
       async performAction(action, payload = {}) {
           payload.action = action;
           const res = await fetch(CONFIG.API_URL, { 
               method: "POST", 
               headers: { "Content-Type": "text/plain;charset=utf-8" }, 
               body: JSON.stringify(payload),
               cache: "no-store"
           });
           return await res.json();
       },

       async performLogin() {
           this.setLoading(true);
           try {
               const data = await this.performAction('login', { password: this.loginPass });
               if (data.success) { 
                   this.isLoggedIn = true; 
                   await this.fetchConfig(); 
               } 
               else this.loginError = 'Incorrect Password';
           } catch(e) { this.loginError = 'Connection Error.'; }
           finally { this.setLoading(false); }
       },

       async fetchConfig() {
           try {
               const data = await this.performAction('getConfig');
               this.headers = Array.isArray(data.headers) ? data.headers.map(String) :[];
               
               if (data.trainees) this.trainees = data.trainees;
               if (data.projects) this.projects = data.projects;
               if (data.mapping) this.mapping = data.mapping;
               if (data.sectionOrder) this.sectionOrder = data.sectionOrder;

               localStorage.setItem('appConfig', JSON.stringify({ 
                   headers: this.headers, 
                   trainees: this.trainees, 
                   projects: this.projects,
                   mapping: this.mapping,
                   sectionOrder: this.sectionOrder
               }));
           } catch(e) {}
       },

       async refreshTrainees() { if(navigator.onLine) await this.fetchConfig(); },
       get filteredTrainees() { if(!this.searchQuery) return[]; const q=this.searchQuery.toLowerCase(); return this.trainees.filter(t=>t&&String(t).toLowerCase().includes(q)); },
       getNameIndex() { return this.headers ? this.headers.findIndex(h => String(h).toLowerCase().includes('trainee') && String(h).toLowerCase().includes('name')) : -1; },
       loadNewForm() { this.loadTraineeForm(''); },

       async loadTraineeForm(name) {
           this.setLoading(true);
           if (!this.headers || this.headers.length === 0) {
               this.loadConfigFromStorage();
               if (!this.headers || this.headers.length === 0) await this.fetchConfig();
           }
           try {
               const history = await this.performAction('getHistory', { trainee: name });
               this.formData = {};
               
               if(this.headers) {
                   this.headers.forEach((h, i) => {
                       const rawHeader = String(h);
                       const lower = rawHeader.toLowerCase();
                       
                       if(!lower.includes('date of visit')) {
                            if (history[rawHeader] !== undefined) {
                                let val = history[rawHeader];
                                
                                // Normalize retrieved Dates (fixes Google Sheets UTC/ISO offset bug & "Invalid Date" output)
                                if (val && this.isDate(rawHeader)) {
                                    const parsed = new Date(val);
                                    if (!isNaN(parsed.getTime())) {
                                        const y = parsed.getFullYear();
                                        const m = String(parsed.getMonth() + 1).padStart(2, '0');
                                        const d = String(parsed.getDate()).padStart(2, '0');
                                        val = `${y}-${m}-${d}`;
                                    }
                                }
                                
                                this.formData[i] = val;
                            } else {
                                this.formData[i] = '';
                            }
                       } else {
                            this.formData[i] = new Date().toISOString().split('T')[0];
                       }
                   });
               }
               
               const nameIdx = this.getNameIndex();
               if(nameIdx !== -1) this.formData[nameIdx] = name;
               
               this.expandedSections = {};
               if(this.sectionOrder && this.sectionOrder.length > 0) {
                   this.sectionOrder.forEach(sec => {
                       if(sec.toLowerCase().includes("general details")) this.expandedSections[sec] = true;
                       else this.expandedSections[sec] = false;
                   });
               }

               this.view = 'form';
           } catch(e) {
               this.loadNewForm();
           } finally { this.setLoading(false); }
       },

       async submitForm() {
           if (this.isSubmitting) return;
           this.isSubmitting = true;
           this.setLoading(true, 'Submitting...');
           
           try {
               const rowData = this.headers.map((header, index) => {
                   let val = this.formData[index];
                   if (val === undefined || val === null) return '';
                   return val;
               });

               if (this.headers.length > 0 && String(this.headers[0]).toLowerCase().includes('timestamp')) {
                   rowData[0] = new Date();
               }

               const nameIdx = this.getNameIndex();
               const submittedName = nameIdx !== -1 ? this.formData[nameIdx] : '';

               if (navigator.onLine) {
                   const result = await this.performAction('submit', { 
                       row: rowData,
                       traineeName: submittedName 
                   });
                   
                   if (result.success) {
                       this.showToast('Submitted successfully!', 'success');
                       this.view = 'dashboard';
                       this.formData = {};
                       this.searchQuery = '';
                       this.fetchConfig(); 
                   } else {
                       throw new Error(result.error || 'Submission failed');
                   }
               } else {
                    this.showToast('You are offline. Please connect to internet to submit.', 'error');
               }
           } catch (e) {
               this.showToast('Error: ' + e.message, 'error');
           } finally {
               this.isSubmitting = false;
               this.setLoading(false);
           }
       },

       get groupedHeaders() {
           if (!this.headers || !Array.isArray(this.headers) || this.headers.length === 0) return [];
           
           let groups =[];
           const orderToUse = (this.sectionOrder && this.sectionOrder.length > 0) ? this.sectionOrder : ['General Details'];

           const getColors = (t) => {
               const l=t.toLowerCase();
               if(l.includes('general')||l.includes('visit')||l.includes('volunteer')) return {bgClass:'bg-blue-50 dark:bg-blue-900', textClass:'text-blue-700 dark:text-blue-200'};
               if(l.includes('trainee')) return {bgClass:'bg-green-50 dark:bg-green-900', textClass:'text-green-700 dark:text-green-200'};
               if(l.includes('caregiver')||l.includes('family')||l.includes('emergency')||l.includes('background')) return {bgClass:'bg-yellow-50 dark:bg-yellow-900', textClass:'text-yellow-700 dark:text-yellow-200'};
               if(l.includes('medical')||l.includes('health')) return {bgClass:'bg-red-50 dark:bg-red-900', textClass:'text-red-700 dark:text-red-200'};
               if(l.includes('abilit')||l.includes('behavio')) return {bgClass:'bg-purple-50 dark:bg-purple-900', textClass:'text-purple-700 dark:text-purple-200'};
               if(l.includes('school')||l.includes('work')) return {bgClass:'bg-indigo-50 dark:bg-indigo-900', textClass:'text-indigo-800 dark:text-indigo-200'};
               if(l.includes('observation')) return {bgClass:'bg-pink-50 dark:bg-pink-900', textClass:'text-pink-700 dark:text-pink-200'};
               return {bgClass:'bg-slate-100 dark:bg-gray-800', textClass:'text-slate-600 dark:text-slate-400'};
           };

           groups = orderToUse.map(title => ({ title: title, fields:[], ...getColors(title) }));
           
           const seen = new Set();
           
           this.headers.forEach((h, i) => {
               const rawH = String(h);
               const lower = rawH.toLowerCase();
               if (lower.includes('timestamp') || rawH.trim() === '') return;

               let label = rawH, guide = '';
               
               if (rawH.toLowerCase().startsWith('area')) {
                    label = rawH;
                    guide = '';
               } else {
                   const hyphenMatch = rawH.match(/^(.+?\(\d+\))\s*[-–]\s*(.+)/);
                   if (hyphenMatch) {
                       label = hyphenMatch[1].trim();
                       guide = hyphenMatch[2].trim();
                   } else {
                       const match = rawH.match(/^(.+?)(\s*[\(\（].+)/);
                       if (match) {
                           if (!/^[\(\（][s\d]+[\)\）]$/i.test(match[2].trim())) {
                               label = match[1].trim(); 
                               guide = match[2].trim();
                           }
                       }
                   }
               }
               
               if (this.headers.filter((v, idx) => v === h && idx < i).length > 0) label = `${label} (${this.headers.filter((v, idx) => v === h && idx < i).length + 1})`;
               
               for(const k in CONFIG.STATIC_GUIDES) if(label.toLowerCase().includes(k)) { guide = CONFIG.STATIC_GUIDES[k]; break; }
               if(guide) guide = guide.replace(/[\(\（]dd\/mm\/yy.*?[\)\）]/gi, '').replace(/\(\d+\)/g, '').replace(/\(s\)/g, '').replace(/[\(\（\)\）]/g, '').trim();

               const field = { label, guide, index: i, raw: rawH };

               const seenKey = label + '_' + i;
               if(seen.has(seenKey)) return; 
               seen.add(seenKey);

               let mappedSection = this.mapping[rawH] || this.mapping[label];
               if(!mappedSection) {
                   const cleanKey = rawH.replace(/\(\d+\)/g, '').trim();
                   mappedSection = this.mapping[cleanKey];
               }
               
               if(mappedSection) {
                   const group = groups.find(g => g.title === mappedSection);
                   if(group) { group.fields.push(field); }
               }
           });

           const sortByGroup = (arr, fn) => arr.sort((a,b) => fn(a) - fn(b));
           
           const cg = groups.find(s=>s.title.toLowerCase().includes('caregiver'));
           if(cg) sortByGroup(cg.fields, (f) => {
               const n = f.raw.toLowerCase();
               const num = (n.match(/\((\d+)\)/) || [0,99])[1];
               const rank = n.includes('name')?1:n.includes('relation')?2:n.includes('contact')?3:4;
               return (num*10) + rank;
           });
           
           const obs = groups.find(s=>s.title.toLowerCase().includes('observation'));
           if(obs) sortByGroup(obs.fields, (f)=>{
              const n=f.label.toLowerCase();
              const grps=['sing-along','cdt','prt','teabreak'];
              const gA=grps.findIndex(g=>n.includes(g));
              if(gA!==-1) return gA*100;
              return 999;
           });
           
           const volGroup = groups.find(s=>s.title.toLowerCase().includes('volunteer'));
           if(volGroup) sortByGroup(volGroup.fields, (f) => {
               const n = f.raw.toLowerCase();
               if (n.includes('(1)')) return 10;
               if (n.includes('(2)')) return 20;
               if (n.includes('senior')) return 30;
               return 99;
           });
           
           return groups.filter(s => s.fields.length > 0);
       },

       isDate(n) { 
           const s = String(n).toLowerCase(); 
           return s.includes('date') || s.includes('dob') || s.includes('birthday'); 
       },
       isLikertScale(n) { const s=String(n).toLowerCase(); return s.includes('mobility')||s.includes('comprehension')||s.includes('verbal'); },
       getLikertLabel(n, side) { const k = Object.keys(CONFIG.LIKERT_CONFIG).find(k=>String(n).toLowerCase().includes(k)); return k ? CONFIG.LIKERT_CONFIG[k][side] : ''; },
       isProjectField(n) { return String(n).toLowerCase().trim() === 'project'; },
       isShortInput(n) { return['name','nric','gender','sex','race','religion','blood','height','weight','shirt','relation','contact','mobile','phone','email'].some(k=>String(n).toLowerCase().includes(k)); },
       isLongText(n) { return !this.isDate(n) && !this.isShortInput(n) && !this.isProjectField(n) && !this.isLikertScale(n); },
       
       loadConfigFromStorage() { 
           let savedData = localStorage.getItem('appConfig'); 
           if (savedData) { 
               try { 
                   let parsed = JSON.parse(savedData); 
                   
                   if (parsed.headers) this.headers = parsed.headers;
                   if (parsed.trainees) this.trainees = parsed.trainees;
                   if (parsed.projects) this.projects = parsed.projects;
                   if (parsed.mapping) this.mapping = parsed.mapping;
                   if (parsed.sectionOrder) this.sectionOrder = parsed.sectionOrder;
                   
               } catch(e) {
                   console.error("Error loading config", e);
               } 
           } 
       },
       
       resetAppData() { 
           localStorage.clear(); 
           window.location.reload(true); 
       },
       
       openSettings() { 
           this.showSettings = true; 
       },
       
       unlockSettings() { 
           if (this.settingsPass === 'werone') {
               this.settingsUnlocked = true; 
           } else {
               this.settingsError = 'Wrong Password';
           }
       },
       
       addColumn() { 
           this.performAction('addColumn', { headerName: this.newColumnName }); 
       },
       
       renameColumn(idx, name) { 
           this.performAction('renameColumn', { colIndex: idx, newName: name }); 
       },
       
       changePassword() { 
       },
       
       showToast(m, t) { 
           this.toast.message = m;
           this.toast.type = t;
           this.toast.visible = true;
           setTimeout(() => { this.toast.visible = false; }, 3000); 
       }
   };
}