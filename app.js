/**
 * ==========================================================================
 * VERBATIM CORE ENGINE — Application Logic & State Controller
 * ==========================================================================
 */

// --- GLOBAL APPLICATION STATE CONFIGURATION ---
const appState = {
    allVerses: [],      // Complete master archive dataset
    queueVerses: [],    // Filtered array of verses due for practice today
    currentTab: 'dashboard'
};

// Placeholder configuration tokens — ensure these match your deployment setup
const ESV_API_TOKEN = "YOUR_ESV_API_TOKEN"; 
const GOOGLE_DEPLOY_URL = "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL";

// Data tracking payload used during the Scribe phase
let transientVersePayload = null;

document.addEventListener("DOMContentLoaded", () => {
    initializeApplication();
});

/**
 * Main application initialization pipeline
 */
function initializeApplication() {
    setupThemeEngine();
    setupNavigationListeners();
    setupFormActionListeners();
    
    // Boot up the database stream from your Google Sheets deployment
    fetchMasterDatabase();
}

/**
 * 🌓 Theme Management — Controls look & persistent preference storage
 */
function setupThemeEngine() {
    const themeToggleBtn = document.getElementById('theme-toggle');

    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-theme');
    }

    themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        if (document.body.classList.contains('dark-theme')) {
            localStorage.setItem('theme', 'dark');
        } else {
            localStorage.setItem('theme', 'light');
        }
    });
}

/**
 * 🗺️ Navigation Router — Switches panels via the sticky bottom action bar
 */
function setupNavigationListeners() {
    const navButtons = {
        dashboard: document.getElementById('nav-dashboard'),
        scribe: document.getElementById('nav-scribe'),
        archive: document.getElementById('nav-archive')
    };

    Object.keys(navButtons).forEach(tabKey => {
        if (navButtons[tabKey]) {
            navButtons[tabKey].addEventListener('click', () => switchTab(tabKey));
        }
    });
}

function switchTab(targetTabId) {
    appState.currentTab = targetTabId;

    // Toggle structural visibility across sections
    document.getElementById('page-dashboard').classList.toggle('hidden', targetTabId !== 'dashboard');
    document.getElementById('page-scribe').classList.toggle('hidden', targetTabId !== 'scribe');
    document.getElementById('page-archive').classList.toggle('hidden', targetTabId !== 'archive');

    // Update highlights across bottom navigation item array
    document.querySelectorAll('.bottom-nav .nav-btn').forEach(btn => btn.classList.remove('active'));
    
    const activeNavButton = document.getElementById(`nav-${targetTabId}`);
    if (activeNavButton) {
        activeNavButton.classList.add('active');
    }
}

/**
 * 🛠️ Form Event Hooks — Hooks buttons to API extraction or commit functions
 */
function setupFormActionListeners() {
    // Scribe Page Lookups
    document.getElementById("btn-fetch").addEventListener("click", async () => {
        const referenceInput = document.getElementById("input-ref").value.trim();
        if (!referenceInput) {
            alert("Please enter a valid scripture reference.");
            return;
        }

        const rawVerseText = await fetchEsvVerse(referenceInput);
        if (rawVerseText) {
            const dynamicCipher = generateCipher(rawVerseText);
            
            // Build temporary payload state object
            transientVersePayload = {
                reference: referenceInput,
                text: rawVerseText,
                cipher: dynamicCipher
            };

            // Render text components down to layout blocks cleanly
            document.getElementById("preview-ref").innerText = transientVersePayload.reference;
            document.getElementById("preview-text").innerText = transientVersePayload.text;
            document.getElementById("preview-cipher").innerText = transientVersePayload.cipher;

            document.getElementById("scribe-preview").classList.remove("hidden");
        }
    });

    // Commit Action — Enforces validation checks before running insertions
    document.getElementById("btn-commit").addEventListener("click", () => {
        if (transientVersePayload) {
            
            // Duplicate Protection Layer: Normalizes spacing to inspect matching strings
            const alreadyExists = appState.allVerses.some(
                verse => verse.reference.toLowerCase().replace(/\s+/g, '') === transientVersePayload.reference.toLowerCase().replace(/\s+/g, '')
            );
            
            if (alreadyExists) {
                alert(`⚠️ "${transientVersePayload.reference}" is already inside your master Verbatim records!`);
                return;
            }
            
            commitNewVerseToDatabase(transientVersePayload);
        }
    });
}

/**
 * 🛰️ ESV Text Generation API Hook
 */
async function fetchEsvVerse(reference) {
    if (!ESV_API_TOKEN || ESV_API_TOKEN.includes("YOUR_")) {
        alert("Please assign a valid ESV API Token inside app.js");
        return null;
    }
    
    const url = `https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(reference)}&include-headings=false&include-subheadings=false&include-autotitles=false&include-footnotes=false&include-verse-numbers=false&include-short-copyright=false&include-passage-references=false`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Token ${ESV_API_TOKEN}` }
        });
        const data = await response.json();
        
        if (data.passages && data.passages.length > 0) {
            return data.passages[0].trim().replace(/\s+/g, ' ');
        }
        throw new Error("Target reference location empty or invalid.");
    } catch (err) {
        console.error(err);
        alert("API Error: " + err.message);
        return null;
    }
}

/**
 * 🔏 Memory Cipher Generator — Isolates the first letter of alphanumeric tokens
 */
function generateCipher(text) {
    return text
        .split(/\s+/)
        .map(word => {
            const standardToken = word.replace(/[^a-zA-Z0-9]/g, '');
            return standardToken.length > 0 ? standardToken[0].toUpperCase() : '';
        })
        .filter(char => char !== '')
        .join(' ');
}

/**
 * 📥 Data Synchronization Layer — Pulls array datasets from Google Sheets
 */
async function fetchMasterDatabase() {
    if (!GOOGLE_DEPLOY_URL || GOOGLE_DEPLOY_URL.includes("YOUR_")) return;

    try {
        const response = await fetch(`${GOOGLE_DEPLOY_URL}?action=getVerses`);
        const result = await response.json();
        
        if (result.status === "success") {
            appState.allVerses = result.data.all || [];
            appState.queueVerses = result.data.queue || [];
            
            renderDashboardQueue();
            renderMasterArchive();
        }
    } catch (err) {
        console.error("Database connection fault: ", err);
    }
}

/**
 * 📤 Data Persistence Layer — Commits payload data records up to the server
 */
async function commitNewVerseToDatabase(payload) {
    if (!GOOGLE_DEPLOY_URL || GOOGLE_DEPLOY_URL.includes("YOUR_")) return;

    try {
        const response = await fetch(GOOGLE_DEPLOY_URL, {
            method: "POST",
            mode: "no-cors", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "addVerse", ...payload })
        });
        
        alert(`"${payload.reference}" successfully added to sheet database!`);
        
        // Reset form inputs & previews cleanly
        document.getElementById("input-ref").value = "";
        document.getElementById("scribe-preview").classList.add("hidden");
        transientVersePayload = null;
        
        // Refresh views locally
        fetchMasterDatabase();
    } catch (err) {
        console.error("Transmission error: ", err);
    }
}

/**
 * 🖨️ View Renderer — Handles the Spaced Repetition Queue
 */
function renderDashboardQueue() {
    const queueListElement = document.getElementById("dashboard-queue-list");
    const countBadgeElement = document.getElementById("queue-count");
    
    queueListElement.innerHTML = "";
    countBadgeElement.innerText = appState.queueVerses.length;

    if (appState.queueVerses.length === 0) {
        queueListElement.innerHTML = `<div class="verse-card" style="text-align: center; color: var(--text-secondary);">Your practice pipeline is clear for today! 🎉</div>`;
        return;
    }

    appState.queueVerses.forEach(verse => {
        const card = document.createElement("div");
        card.className = "verse-card";
        card.innerHTML = `
            <h2 class="verse-reference">${verse.reference}</h2>
            <p class="verse-body-text">${verse.text}</p>
            <div class="verse-cipher-block">${verse.cipher}</div>
        `;
        queueListElement.appendChild(card);
    });
}

/**
 * 🖨️ View Renderer — Handles the Comprehensive Archive Library Display
 */
function renderMasterArchive() {
    const archiveListElement = document.getElementById("archive-all-list");
    archiveListElement.innerHTML = "";

    if (appState.allVerses.length === 0) {
        archiveListElement.innerHTML = `<div class="verse-card" style="text-align: center; color: var(--text-secondary);">No verses recorded in your archive yet.</div>`;
        return;
    }

    appState.allVerses.forEach(verse => {
        const card = document.createElement("div");
        card.className = "verse-card";
        card.innerHTML = `
            <h2 class="verse-reference">${verse.reference}</h2>
            <p class="verse-body-text">${verse.text}</p>
            <div class="verse-cipher-block">${verse.cipher}</div>
        `;
        archiveListElement.appendChild(card);
    });
}
