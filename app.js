// ==========================================================================
// 1. APP CONFIGURATION
// ==========================================================================
// Paste your EXACT Web App URL ending in /exec here
const GOOGLE_API_URL = "YOUR_ACTUAL_EXEC_URL_HERE"; 
const ESV_API_TOKEN  = "YOUR_ESV_API_BEARER_TOKEN_HERE";

// Global Local State Cache
let appState = {
    allVerses: [],
    activeQueue: []
};

// ==========================================================================
// 2. INTAKE ENGINE: ESV FETCH & CIPHER ALGORITHM
// ==========================================================================

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
    if (!dateString1 || !dateString2) return 0;
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

    if (!Array.isArray(verses)) return [];

    verses.forEach(verse => {
        let isDue = false;
        let targetReps = 1;
        
        const totalDaysInSystem = getDaysDifference(verse.dateIntroduced, todayStr);
        const practicedToday = (verse.lastPracticedDate === todayStr);

        if (verse.currentPhase === "Monthly") monthlyCount++;
        else pipelineCount++;

        if (!practicedToday) {
            switch (verse.currentPhase) {
                case "Countdown":
                    isDue = true;
                    const dayNum = parseInt(verse.currentDayInPhase) + 1; 
                    if (dayNum === 1) targetReps = 25;
                    else if (dayNum === 2) targetReps = 20;
                    else if (dayNum === 3) targetReps = 15;
                    else if (dayNum === 4) targetReps = 10;
                    else if (dayNum === 5) targetReps = 5;
                    break;
                    
                case "Daily":
                    isDue = true;
                    targetReps = 1;
                    break;
                    
                case "Weekly":
                    const daysSincePractice = getDaysDifference(verse.lastPracticedDate, todayStr);
                    if (daysSincePractice >= 7) {
                        isDue = true;
                        targetReps = 1;
                    }
                    break;
                    
                case "Monthly":
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

    document.getElementById("stat-monthly").innerText = monthlyCount;
    document.getElementById("stat-active").innerText = pipelineCount;

    return dueQueue;
}

// ==========================================================================
// 4. DATABASE INTEGRATION LAYER (FETCH & SYNC)
// ==========================================================================

async function loadDataFromSheets() {
    if (!GOOGLE_API_URL || GOOGLE_API_URL.includes("YOUR_")) {
        document.querySelector(".status-banner p").innerText = "⚠️ Please set your GOOGLE_API_URL in app.js";
        return;
    }
    
    try {
        const response = await fetch(GOOGLE_API_URL);
        const textData = await response.text();
        
        // Safety switch: Parse the text stream cleanly into arrays
        let data = [];
        try {
            data = JSON.parse(textData);
        } catch(e) {
            console.error("JSON parsing failed, retrying format structural modification.");
        }

        appState.allVerses = Array.isArray(data) ? data : [];
        appState.activeQueue = evaluateDailyPipeline(appState.allVerses);
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
            mode: "no-cors",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action: "addVerse", ...verseObj })
        });
        
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
            headers: { "Content-Type": "text/plain" },
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
            <p style="font-size: 0.9rem; margin-bottom:10px; font-weight:700; letter-spacing:1px; display:none;" id="cipher-${index}">${verse.cipher}</p>
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
    
    if (appState.allVerses.length === 0) {
        container.innerHTML = "<p style='text-align:center; color:var(--text-secondary); padding:20px;'>No verses in your archive yet.</p>";
        return;
    }
    
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
        let nextPhase = item.currentPhase;
        let nextDayInPhase = parseInt(item.currentDayInPhase) + 1;
        
        if (item.currentPhase === "Countdown" && nextDayInPhase >= 5) {
            nextPhase = "Daily";
            nextDayInPhase = 0;
        } else if (item.currentPhase === "Daily" && nextDayInPhase >= 45) {
            nextPhase = "Weekly";
            nextDayInPhase = 0;
        } else if (item.currentPhase === "Weekly" && nextDayInPhase >= 7) {
            nextPhase = "Monthly";
            nextDayInPhase = 0;
        }

        const masterIdx = appState.allVerses.findIndex(v => v.id === item.id);
        if (masterIdx !== -1) {
            appState.allVerses[masterIdx].currentPhase = nextPhase;
            appState.allVerses[masterIdx].currentDayInPhase = nextDayInPhase;
            appState.allVerses[masterIdx].lastPracticedDate = new Date().toISOString().split('T')[0];
        }

        syncProgressToDatabase(item.id, nextPhase, nextDayInPhase);

        appState.activeQueue.splice(index, 1);
        renderQueue();
        renderArchive();
    }
}

// ==========================================================================
// 6. VIEW NAVIGATION & EVENT INITIALIZERS
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    
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

    document.getElementById("theme-toggle").addEventListener("click", () => {
        const body = document.body;
        const currentTheme = body.getAttribute("data-theme");
        body.setAttribute("data-theme", currentTheme === "dark" ? "light" : "dark");
    });

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
            alert(`${transientVersePayload.reference} committed to Verbatim engine!`);
            
            document.getElementById("input-ref").value = "";
            document.getElementById("scribe-preview").classList.add("hidden");
            transientVersePayload = null;
        }
    });

    loadDataFromSheets();
});
