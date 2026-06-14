async function loadDataFromSheets() {
    if (!GOOGLE_API_URL || GOOGLE_API_URL.includes("YOUR_")) return;
    
    try {
        // Adding cache: "no-store" forces the browser to pull your latest Sheet updates
        const response = await fetch(GOOGLE_API_URL, { method: "GET", cache: "no-store" });
        const data = await response.json();
        appState.allVerses = data;
        
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
            // Changing content-type to text/plain skips the browser's aggressive CORS checks completely
            headers: { "Content-Type": "text/plain;charset=utf-8" },
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
