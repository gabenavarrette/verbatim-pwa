// ==========================================================================
// 1. APP CONFIGURATION & STATE ENVIRONMENT
// ==========================================================================
const GOOGLE_API_URL = "https://script.google.com/macros/s/AKfycbylY8ApbAVncVeEMCfqhdGkO_ITipHDBTzBTfZpByjULeaJ_UOzp_SOEo5lkdV0w7oN/exec";
const ESV_API_TOKEN  = "c12f4027a03ce24b10b8cecfc467bf053c2439bc";

// Global Local State Cache
let appState = {
    allVerses: [],
    activeQueue: []
};

// ==========================================================================
// 2. INTAKE ENGINE: ESV FETCH & CIPHER ALGORITHM
// ==========================================================================

// Continuous cipher algorithm: matches first letter of words or punctuation marks
function generateCipher(text) {
    return text
        .match(/\b[a-zA-Z]|\p{Punctuation}/gu)
        .join('')
        .toUpperCase();
}

async function fetchEsvVerse(reference) {
    if (!ESV_API_TOKEN || ESV_API_TOKEN.includes("YOUR_")) {
        alert("Please add your ESV API Token to app.js");
        return null;
    }
    
    const url = `https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(reference)}&include-headings=false&include-footnotes=false&include-verse-numbers=false&include-short-copyright=false&include-passage-references=false`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Token ${ESV_API_TOKEN}` }
        });
        const data = await response.json();
        
        if (data.passages && data.passages.length > 0) {
            // Clean up extraneous white spaces returned by API
            return data.passages[0].trim().replace(/\s+/g, ' ');
        }
        throw new Error("Verse not found via ESV API.");
    } catch (err) {
        console.error(err);
        alert("Error fetching from ESV API: " + err.message);
        return null;
    }
}

// ==========================================================================
// 3. CORE LOGIC ENGINE: LEITNER SYSTEM CALCULATIONS
// ==========================================================================

function getDaysDifference(dateString1, dateString2) {
    const d1 = new Date(dateString1);
    const d2 = new Date(dateString2);
    const diffTime = Math.abs(d2 - d1);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function evaluateDailyPipeline(verses) {
    const todayStr = new Date().toISOString().split('T')[0];
    const dueQueue = [];
    
    let monthlyCount = 0;
    let pipelineCount = 0;

    verses.forEach(verse => {
        let isDue = false;
        let targetReps = 1;
        
        const totalDaysInSystem = getDaysDifference(verse.dateIntroduced, todayStr);
        const practicedToday = (verse.lastPracticedDate === todayStr);

        // Track Dashboard Stats
        if (verse.currentPhase === "Monthly") monthlyCount++;
        else pipelineCount++;

        if (!practicedToday) {
            switch (verse.currentPhase) {
                case "Countdown":
                    // Days 1-5 have declining reps: 25, 20, 15, 10, 5
                    isDue = true;
                    const dayNum = parseInt(verse.currentDayInPhase) + 1; 
                    if (dayNum === 1) targetReps = 25;
                    else if (dayNum === 2) targetReps = 20;
                    else if (dayNum === 3) targetReps = 15;
                    else if (dayNum === 4) targetReps = 10;
                    else if (dayNum === 5) targetReps = 5;
                    break;
                    
                case "Daily":
                    // Due every single day up through day 50 overall
                    isDue = true;
                    targetReps = 1;
                    break;
                    
                case "Weekly":
                    // Due once every 7 days since last practicing
                    const daysSincePractice = getDaysDifference(verse.lastPracticedDate, todayStr);
                    if (daysSincePractice >= 7) {
                        isDue = true;
                        targetReps = 1;
                    }
                    break;
                    
                case "Monthly":
                    // Due once every 30 days since last practicing
                    const daysSinceLastMonthly = getDaysDifference(verse.lastPracticedDate, todayStr);
                    if (daysSinceLastMonthly >= 30) {
                        isDue = true;
                        targetReps = 1;
                    }
                    break;
            }
        }

        if (isDue) {
            dueQueue.push({ ...verse, targetReps, currentReps: 0 });
        }
    });

    // Update Stats Display elements
    document.getElementById("stat-monthly").innerText = monthlyCount;
    document.getElementById("stat-active").innerText = pipelineCount;

    return dueQueue;
}

// ==========================================================================
// 4. DATABASE INTEGRATION LAYER (FETCH & SYNC)
// ==========================================================================

async function loadDataFromSheets() {
    if (!GOOGLE_API_URL || GOOGLE_API_URL.includes("YOUR_")) return;
    
    try {
        const response = await fetch(GOOGLE_API_URL);
        const data = await response.json();
        appState.allVerses = data;
        
        // Run queue evaluation calculations
        appState.activeQueue = evaluateDailyPipeline(data);
        renderQueue();
        renderArchive();
    } catch (err) {
        console.error("Database connection failed: ", err);
        document.querySelector(".status-banner p").innerText = "⚠️ Connection to Google Sheets failed.";
    }
}

async function commitNewVerseToDatabase(verseObj) {
    try {
        await fetch(GOOGLE_API_URL, {
            method: "POST",
            mode: "no-cors", // Required to bypass Apps Script CORS redirection locks
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "addVerse", ...verseObj })
        });
        // Optimistic UI updates
        appState.allVerses.push(verseObj);
        appState.activeQueue = evaluateDailyPipeline(appState.allVerses);
        renderQueue();
        renderArchive();
    } catch (err) {
        console.error(err);
    }
}

async function syncProgressToDatabase(verseId, nextPhase, nextDayInPhase) {
    const todayStr = new Date().toISOString().split('T')[0];
    try {
        await fetch(GOOGLE_API_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "updateProgress",
                id: verseId,
                currentPhase: nextPhase,
                lastPracticedDate: todayStr,
                currentDayInPhase: nextDayInPhase
            })
        });
    } catch (err) {
        console.error(err);
    }
}

// ==========================================================================
// 5. INTERFACE LAYERING & RENDER CONTROLLERS
// ==========================================================================

function renderQueue() {
    const container = document.getElementById("queue-container");
    const bannerText = document.querySelector(".status-banner p");
    container.innerHTML = "";
    
    if (appState.activeQueue.length === 0) {
        bannerText.innerText = "🎉 All caught up! Perfect recall achieved today.";
        return;
    }
    
    bannerText.innerText = `You have ${appState.activeQueue.length} verses remaining to practice today.`;
    
    appState.activeQueue.forEach((verse, index) => {
        const card = document.createElement("div");
        card.className = `verse-card ${verse.currentPhase === 'Monthly' ? 'milestone-monthly' : ''}`;
        card.innerHTML = `
            <div class="card-header">
                <span class="verse-ref">${verse.reference}</span>
                <span class="phase-badge ${verse.currentPhase.toLowerCase()}">${verse.currentPhase}</span>
            </div>
            <p style="font-size: 0.9rem; margin-bottom:10px; font-style:italic; display:none;" id="cipher-${index}">${verse.cipher}</p>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <button onclick="toggleCipherHint(event, ${index})" style="background-color:var(--border-color); color:var(--text-primary); padding:6px 12px; font-size:0.8rem;">Hint</button>
                <button onclick="logRepetition(${index})" id="btn-rep-${index}" class="btn-count">${verse.currentReps} / ${verse.targetReps} Reps</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function renderArchive() {
    const container = document.getElementById("archive-container");
    container.innerHTML = "";
    
    appState.allVerses.forEach(verse => {
        const card = document.createElement("div");
        card.className = `verse-card ${verse.currentPhase === 'Monthly' ? 'milestone-monthly' : ''}`;
        card.innerHTML = `
            <div class="card-header">
                <span class="verse-ref">${verse.reference}</span>
                <span class="phase-badge ${verse.currentPhase.toLowerCase()}">${verse.currentPhase}</span>
            </div>
            <p style="font-size:0.9rem; opacity:0.85; margin-bottom:5px;">${verse.fullText}</p>
            <small style="color:var(--text-secondary)">Introduced: ${verse.dateIntroduced} | Day count in Phase: ${verse.currentDayInPhase}</small>
        `;
        container.appendChild(card);
    });
}

function toggleCipherHint(event, index) {
    event.stopPropagation();
    const cipherText = document.getElementById(`cipher-${index}`);
    cipherText.style.display = cipherText.style.display === "none" ? "block" : "none";
}

function logRepetition(index) {
    const item = appState.activeQueue[index];
    item.currentReps++;
    
    const targetButton = document.getElementById(`btn-rep-${index}`);
    targetButton.innerText = `${item.currentReps} / ${item.targetReps} Reps`;
    
    if (item.currentReps >= item.targetReps) {
        // Core phase-progression calculator engine
        let nextPhase = item.currentPhase;
        let nextDayInPhase = parseInt(item.currentDayInPhase) + 1;
        
        if (item.currentPhase === "Countdown" && nextDayInPhase >= 5) {
            nextPhase = "Daily";
            nextDayInPhase = 0; // Reset incremental counter for new phase tracking
        } else if (item.currentPhase === "Daily" && nextDayInPhase >= 45) {
            nextPhase = "Weekly";
            nextDayInPhase = 0;
        } else if (item.currentPhase === "Weekly" && nextDayInPhase >= 7) {
            nextPhase = "Monthly";
            nextDayInPhase = 0;
        }

        // Apply state updates locally immediately
        const masterIdx = appState.allVerses.findIndex(v => v.id === item.id);
        if (masterIdx !== -1) {
            appState.allVerses[masterIdx].currentPhase = nextPhase;
            appState.allVerses[masterIdx].currentDayInPhase = nextDayInPhase;
            appState.allVerses[masterIdx].lastPracticedDate = new Date().toISOString().split('T')[0];
        }

        // Fire asynchronous call back up to Google Cloud Sync
        syncProgressToDatabase(item.id, nextPhase, nextDayInPhase);

        // Remove from current layout queue instantly
        appState.activeQueue.splice(index, 1);
        renderQueue();
        renderArchive();
    }
}

// ==========================================================================
// 6. VIEW NAVIGATION & EVENT INITIALIZERS
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    
    // Bottom Tab Bar Routing System
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const currentBtn = e.currentTarget;
            const targetViewId = currentBtn.getAttribute("data-target");
            
            document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
            
            currentBtn.classList.add("active");
            document.getElementById(targetViewId).classList.add("active");
        });
    });

    // Light/Dark Toggle Mechanics
    document.getElementById("theme-toggle").addEventListener("click", () => {
        const body = document.body;
        const currentTheme = body.getAttribute("data-theme");
        body.setAttribute("data-theme", currentTheme === "dark" ? "light" : "dark");
    });

    // Intake Processing Event listener
    let transientVersePayload = null;

    document.getElementById("btn-fetch").addEventListener("click", async () => {
        const refInput = document.getElementById("input-ref").value.trim();
        if (!refInput) return;
        
        document.getElementById("btn-fetch").innerText = "Searching...";
        const text = await fetchEsvVerse(refInput);
        document.getElementById("btn-fetch").innerText = "Fetch Verse";
        
        if (text) {
            const cipher = generateCipher(text);
            document.getElementById("preview-text").innerText = text;
            document.getElementById("preview-cipher").innerText = cipher;
            
            // Build memory profile item
            transientVersePayload = {
                id: Date.now().toString(),
                dateIntroduced: new Date().toISOString().split('T')[0],
                reference: refInput,
                fullText: text,
                cipher: cipher,
                currentPhase: "Countdown",
                lastPracticedDate: "",
                currentDayInPhase: 0
            };
            
            document.getElementById("scribe-preview").classList.remove("hidden");
        }
    });

    document.getElementById("btn-commit").addEventListener("click", () => {
        if (transientVersePayload) {
            commitNewVerseToDatabase(transientVersePayload);
            alert(`${transientVersePayload.reference} committed to memory tracking pipeline!`);
            
            // Clean interface slate
            document.getElementById("input-ref").value = "";
            document.getElementById("scribe-preview").classList.add("hidden");
            transientVersePayload = null;
        }
    });

    // Execute Initial Load Sync
    loadDataFromSheets();
});
