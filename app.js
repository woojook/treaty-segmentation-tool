// ==========================================
// CONFIGURATION & DROPBOX API CREDENTIALS
// ==========================================

const DROPBOX_CLIENT_ID = "emh6s5d1fo5g22e";
// Note: Client secret is omitted in public client-side PKCE OAuth flow for security.
const REDIRECT_URI = window.location.origin + window.location.pathname; 

// Dynamic Token State
let DROPBOX_ACCESS_TOKEN = sessionStorage.getItem("emh6s5d1fo5g22e") || "zvefsh2quh956bv";

// Multi-Document Manifest
const DOCUMENTS_MANIFEST = [
    {
        title: "example",
        url: "./documents/example.csv"
    }
];

// Files stored on Dropbox
const DROPBOX_CSV_SAVE_PATH = "/annotations.csv";
const DROPBOX_REFERENCE_CUTS_PATH = "/reference_cuts.json";
const DROPBOX_RECONCILED_PATH = "/reconciled_consensus.json";

const CURRENT_USER = "woojo";
let CURRENT_DOCUMENT = DOCUMENTS_MANIFEST[0];

// ==========================================
// CONSTANTS & TAXONOMY
// ==========================================

const annotationTypes = [
    "Select a category...",
    "Motivation/Preamble",
    "Obligation (to Other States)",
    "Exceptions / Rights",
    "Definitions / Scope",
    "Data/Info Exchange",
    "Verifying Compliance",
    "Process - Entry in Force",
    "Process - Disputes/Courts",
    "Process - Amendments/Mods",
    "Process - Right to Withdraw",
    "Process - Expiration/Terminate",
    "Process - Renewals",
    "Administrative - Table of Contents",
    "Administrative - Definitions",
    "Administrative - Tables/Maps",
    "Administrative - Measures/Specs",
    "Administrative - Financial",
    "Administrative - Signature/End",
    "Administrative - Other",
    "NONBINDING INSTRUMENTS (letters/statements/negotiations)",
    "[START OF SECTION/CHAPTER (title)]",
    "[START ANNEX/SCHEDULE/ATTACHMENT (title)]",
    "[START ENTIRELY NEW DOCUMENT (title)]",
    "ACCIDENTAL CLICK (DELETE)",
    "Other - None of Above"
];

const problemsEncountered = [
    "None",
    "Text incomplete",
    "Text rendered improperly",
    "Text is in a different language",
    "Confused about segmentation",
    "Contains an annex",
    "Is an annex (annex only)",
    "Contained more than one document/annex",
    "Probably not a binding agreement",
    "Other"
];

// ==========================================
// DOM ELEMENTS
// ==========================================

const docSelector = document.getElementById('doc-selector');
const textContainer = document.getElementById('text-container');
const exportBtn = document.getElementById('export-btn');
const outputConsole = document.getElementById('output-console');
const annotationContainer = document.getElementById('annotation-container');
const segmentsList = document.getElementById('segments-list');
const reviewBtn = document.getElementById('review-btn');
const backBtn = document.getElementById('back-btn');
const submitBtn = document.getElementById('submit-btn');
const problemsDropdown = document.getElementById('problems-dropdown');
const clearBtn = document.getElementById('clear-btn');
const reconcileContainer = document.getElementById('reconcile-container');
const reconcileList = document.getElementById('reconcile-list');
const saveConsensusBtn = document.getElementById('save-consensus-btn');

// ==========================================
// STATE MANAGEMENT
// ==========================================

let wordsArray = [];
let cuts = new Set();
let referenceData = null; // Coder 1 baseline record

// ==========================================
// DROPBOX HELPERS & PKCE OAUTH AUTHENTICATION
// ==========================================

function escapeCSV(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val).replace(/"/g, '""');
    return `"${str}"`;
}

// Handles URL hash checking for OAuth token redirects & initiates re-auth if missing
async function ensureValidAccessToken() {
    // 1. Check if returning from Dropbox OAuth implicit flow redirect
    if (window.location.hash) {
        const params = new URLSearchParams(window.location.hash.substring(1));
        const token = params.get("access_token");
        if (token) {
            DROPBOX_ACCESS_TOKEN = token;
            sessionStorage.setItem("dropbox_access_token", token);
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }
    }

    // 2. Validate token availability
    if (!DROPBOX_ACCESS_TOKEN || DROPBOX_ACCESS_TOKEN === "YOUR_DROPBOX_ACCESS_TOKEN_HERE") {
        redirectToDropboxOAuth();
    }
}

function redirectToDropboxOAuth() {
    const authUrl = `https://www.dropbox.com/oauth2/authorize?response_type=token&client_id=${encodeURIComponent(DROPBOX_CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    window.location.href = authUrl;
}

function safeDropboxArg(obj) {
    return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, function(c) {
        return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
}

async function fetchDropboxFile(path) {
    try {
        await ensureValidAccessToken();
        const cleanPath = path.startsWith('/') ? path : `/${path}`;

        const response = await fetch("https://content.dropboxapi.com/2/files/download", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${DROPBOX_ACCESS_TOKEN}`,
                "Dropbox-API-Arg": safeDropboxArg({ path: cleanPath })
            }
        });

        if (response.status === 401) {
            // Token expired or invalid
            sessionStorage.removeItem("dropbox_access_token");
            redirectToDropboxOAuth();
            return null;
        }

        if (response.ok) {
            return await response.text();
        } else {
            console.warn(`Dropbox file ${cleanPath} not found or empty (HTTP ${response.status}).`);
            return null; 
        }
    } catch (err) {
        console.warn(`Could not read Dropbox file at ${path}:`, err);
        return null;
    }
}

async function saveDropboxFile(path, content, contentType = "application/json") {
    await ensureValidAccessToken();
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    const apiArg = {
        path: cleanPath,
        mode: "overwrite",
        autorename: false,
        mute: false
    };

    const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${DROPBOX_ACCESS_TOKEN}`,
            "Dropbox-API-Arg": safeDropboxArg(apiArg),
            "Content-Type": "application/octet-stream"
        },
        body: content
    });

    if (response.status === 401) {
        sessionStorage.removeItem("dropbox_access_token");
        redirectToDropboxOAuth();
        throw new Error("Dropbox Session Expired. Redirecting to login...");
    }

    if (!response.ok) {
        const errorDetails = await response.text();
        console.error("Dropbox API Error Details:", errorDetails);
        throw new Error(`Dropbox upload failed (${response.status}): ${errorDetails}`);
    }

    return await response.json();
}

// ==========================================
// INITIALIZATION & DYNAMIC DOCUMENT SWITCHING
// ==========================================

function initDocumentSelector() {
    docSelector.innerHTML = "";
    DOCUMENTS_MANIFEST.forEach((doc, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.innerText = doc.title;
        docSelector.appendChild(opt);
    });

    docSelector.addEventListener('change', (e) => {
        CURRENT_DOCUMENT = DOCUMENTS_MANIFEST[e.target.value];
        loadDocumentData();
    });
}

async function loadReferenceData() {
    referenceData = null;
    try {
        const jsonText = await fetchDropboxFile(DROPBOX_REFERENCE_CUTS_PATH);
        if (jsonText) {
            const allRefData = JSON.parse(jsonText);
            if (allRefData[CURRENT_DOCUMENT.title]) {
                referenceData = allRefData[CURRENT_DOCUMENT.title];
                console.log("Loaded reference baseline for:", CURRENT_DOCUMENT.title, referenceData);
            }
        }
    } catch (e) {
        console.warn("Could not load reference data from Dropbox, continuing as Coder 1.", e);
    }
}

async function loadDocumentData() {
    outputConsole.innerText = `Loading "${CURRENT_DOCUMENT.title}"...`;
    outputConsole.style.color = "#3b82f6";
    reconcileContainer.style.display = "none";

    // Load local cuts
    cuts.clear();
    const saved = localStorage.getItem(`cuts_${CURRENT_DOCUMENT.title}`);
    if (saved) {
        cuts = new Set(JSON.parse(saved));
    }

    try {
        await loadReferenceData();

        const response = await fetch(CURRENT_DOCUMENT.url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Failed to fetch file at ${CURRENT_DOCUMENT.url}`);
        }
        
        const csvData = await response.text();
        if (!csvData.trim()) {
            throw new Error("CSV file appears to be empty.");
        }

        const lines = csvData.replace(/\r/g, '').split('\n').filter(line => line.trim() !== '');
        const targetLine = lines.length > 1 ? lines[1] : lines[0];
        const rowData = parseCSVRow(targetLine);
        
        const documentText = rowData[1] !== undefined ? rowData[1] : (rowData[0] || "");
        wordsArray = documentText.split(/\s+/).filter(word => word.length > 0);

        if (wordsArray.length === 0) {
            throw new Error("No words found in document text column.");
        }

        if (referenceData) {
            outputConsole.innerText = `Loaded "${CURRENT_DOCUMENT.title}". Baseline exists from [${referenceData.coder}].`;
            outputConsole.style.color = "#22c55e";
        } else {
            outputConsole.innerText = `Loaded "${CURRENT_DOCUMENT.title}". You are Coder 1 for this document.`;
            outputConsole.style.color = "#eab308";
        }
        
        renderText();

    } catch (error) {
        console.error("Error loading document:", error);
        outputConsole.innerText = `Error: ${error.message}`;
        outputConsole.style.color = "#ef4444";
    }
}

function parseCSVRow(csvText) {
    let result = [];
    let insideQuote = false;
    let entry = '';
    
    for (let i = 0; i < csvText.length; i++) {
        let char = csvText[i];
        if (char === '"') {
            insideQuote = !insideQuote;
        } else if (char === ',' && !insideQuote) {
            result.push(entry.trim());
            entry = '';
        } else {
            entry += char;
        }
    }
    result.push(entry.trim());
    return result;
}

function toggleCut(index) {
    if (cuts.has(index)) {
        cuts.delete(index); 
    } else {
        cuts.add(index); 
    }
    localStorage.setItem(`cuts_${CURRENT_DOCUMENT.title}`, JSON.stringify(Array.from(cuts)));
    renderText(); 
}

function renderText() {
    textContainer.innerHTML = ""; 

    wordsArray.forEach((word, index) => {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'word';
        wordSpan.innerText = word + " ";
        
        if (cuts.has(index)) {
            wordSpan.classList.add('cut-after');
        }

        wordSpan.addEventListener('click', () => {
            toggleCut(index);
        });

        textContainer.appendChild(wordSpan);
    });
}

// ==========================================
// ICR CALCULATIONS (BOUNDARY & CATEGORY)
// ==========================================

exportBtn.addEventListener('click', async () => {
    const coderACuts = Array.from(cuts).sort((a, b) => a - b);
    
    if (coderACuts.length === 0) {
        outputConsole.innerText = "Please make at least one cut before grading!";
        outputConsole.style.color = "#ef4444"; 
        return;
    }

    // CODER 1 INITIAL SAVE
    if (!referenceData) {
        outputConsole.innerText = "Saving your cuts as document baseline...\nWaiting for Coder 2 review.";
        outputConsole.style.color = "#eab308";

        try {
            const jsonText = await fetchDropboxFile(DROPBOX_REFERENCE_CUTS_PATH);
            let refStore = {};

            if (jsonText) {
                try {
                    refStore = JSON.parse(jsonText);
                } catch (parseErr) {
                    console.warn("Could not parse existing reference JSON, initializing new baseline store.", parseErr);
                }
            }
            
            refStore[CURRENT_DOCUMENT.title] = {
                coder: CURRENT_USER,
                timestamp: new Date().toISOString(),
                cuts: coderACuts,
                annotations: []
            };

            await saveDropboxFile(DROPBOX_REFERENCE_CUTS_PATH, JSON.stringify(refStore, null, 2));
            
            referenceData = refStore[CURRENT_DOCUMENT.title];
            outputConsole.innerText = "Baseline cuts saved successfully to Dropbox!";
            outputConsole.style.color = "#22c55e";
            alert("Baseline cuts saved! Waiting for second coder review.");

        } catch (err) {
            console.error("Detailed error saving baseline cuts:", err);
            outputConsole.innerText = `Error saving baseline cuts to Dropbox: ${err.message}`;
            outputConsole.style.color = "#ef4444";
        }
        return;
    }

    // CODER 2 EVALUATION & RECONCILIATION
    const coderBCuts = referenceData.cuts || [];
    buildReconciliationView(coderACuts, coderBCuts);
    
    // Calculate Boundary Agreement (Window-based Boundary P/R/F1)
    const setA = new Set(coderACuts);
    const setB = new Set(coderBCuts);
    
    let exactMatches = 0;
    setA.forEach(c => { if (setB.has(c)) exactMatches++; });
    
    const precision = setA.size > 0 ? (exactMatches / setA.size) : 0;
    const recall = setB.size > 0 ? (exactMatches / setB.size) : 0;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    outputConsole.innerText = `Boundary Agreement Analysis vs Baseline [${referenceData.coder}]:\n` +
        `• Exact Matches: ${exactMatches}\n` +
        `• Precision: ${(precision * 100).toFixed(1)}%\n` +
        `• Recall: ${(recall * 100).toFixed(1)}%\n` +
        `• F1 Boundary Score: ${(f1 * 100).toFixed(1)}%`;
    outputConsole.style.color = "#38bdf8";
});

function calculateCategoryICR(coder2Annotations) {
    if (!referenceData || !referenceData.annotations || referenceData.annotations.length === 0) {
        return null;
    }

    const c1Anns = referenceData.annotations;
    const c2Anns = coder2Annotations;
    const compareLength = Math.min(c1Anns.length, c2Anns.length);
    
    if (compareLength === 0) return null;

    let totalObservedMatches = 0;
    const categoryCountsC1 = {};
    const categoryCountsC2 = {};

    for (let i = 0; i < compareLength; i++) {
        const cat1 = c1Anns[i];
        const cat2 = c2Anns[i];

        if (cat1 === cat2) totalObservedMatches++;

        categoryCountsC1[cat1] = (categoryCountsC1[cat1] || 0) + 1;
        categoryCountsC2[cat2] = (categoryCountsC2[cat2] || 0) + 1;
    }

    const Po = totalObservedMatches / compareLength;

    let Pe = 0;
    const allCategories = new Set([...Object.keys(categoryCountsC1), ...Object.keys(categoryCountsC2)]);
    allCategories.forEach(cat => {
        const p1 = (categoryCountsC1[cat] || 0) / compareLength;
        const p2 = (categoryCountsC2[cat] || 0) / compareLength;
        Pe += (p1 * p2);
    });

    const kappa = Pe === 1 ? 1 : (Po - Pe) / (1 - Pe);
    const percentage = Po * 100;

    return {
        kappa: kappa.toFixed(2),
        percentage: percentage.toFixed(1),
        alignedSegmentsCount: compareLength
    };
}

// ==========================================
// RECONCILIATION & ADJUDICATION
// ==========================================

function buildReconciliationView(coderCuts, baseCuts) {
    reconcileContainer.style.display = "block";
    reconcileList.innerHTML = "";

    const unionCuts = Array.from(new Set([...coderCuts, ...baseCuts])).sort((a, b) => a - b);
    
    unionCuts.forEach(cutIdx => {
        const inCoder = coderCuts.includes(cutIdx);
        const inBase = baseCuts.includes(cutIdx);

        const row = document.createElement('div');
        row.style.padding = "10px";
        row.style.marginBottom = "8px";
        row.style.borderRadius = "4px";
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        const snippet = wordsArray.slice(Math.max(0, cutIdx - 2), cutIdx + 3).join(" ");

        if (inCoder && inBase) {
            row.style.backgroundColor = "#dcfce7";
            row.innerHTML = `<span><strong>Match at word ${cutIdx}:</strong> "...${snippet}..."</span> <span style="color:#16a34a; font-weight:bold;">Agreed Boundary</span>`;
        } else {
            row.style.backgroundColor = "#fee2e2";
            const source = inCoder ? `Only ${CURRENT_USER}` : `Only ${referenceData.coder}`;
            row.innerHTML = `
                <span><strong>Disagreement at word ${cutIdx}:</strong> "...${snippet}..." (${source})</span>
                <label><input type="checkbox" class="consensus-cut" value="${cutIdx}" ${inCoder ? "checked" : ""}> Keep in Final Consensus</label>
            `;
        }
        reconcileList.appendChild(row);
    });
}

if (saveConsensusBtn) {
    saveConsensusBtn.addEventListener('click', async () => {
        const consensusCheckboxes = document.querySelectorAll('.consensus-cut');
        const finalConsensusCuts = Array.from(consensusCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => parseInt(cb.value))
            .sort((a, b) => a - b);

        try {
            const jsonText = await fetchDropboxFile(DROPBOX_RECONCILED_PATH);
            let reconStore = jsonText ? JSON.parse(jsonText) : {};

            reconStore[CURRENT_DOCUMENT.title] = {
                document: CURRENT_DOCUMENT.title,
                reconciledBy: CURRENT_USER,
                timestamp: new Date().toISOString(),
                consensusCuts: finalConsensusCuts
            };

            await saveDropboxFile(DROPBOX_RECONCILED_PATH, JSON.stringify(reconStore, null, 2), "application/json");
            outputConsole.innerText = "Reconciled consensus baseline saved successfully to Dropbox!";
            outputConsole.style.color = "#22c55e";
            alert("Consensus cuts successfully adjudicated and saved!");
        } catch (err) {
            console.error("Failed to save reconciled consensus:", err);
            alert("Failed to save reconciled consensus to Dropbox.");
        }
    });
}

if (clearBtn) {
    clearBtn.addEventListener('click', () => {
        if (confirm(`Delete all cuts for ${CURRENT_DOCUMENT.title}?`)) {
            cuts.clear();
            localStorage.removeItem(`cuts_${CURRENT_DOCUMENT.title}`);
            renderText();
            outputConsole.innerText = "All cuts cleared.";
            outputConsole.style.color = "#38bdf8";
        }
    });
}

problemsEncountered.forEach(problem => {
    const option = document.createElement('option');
    option.value = problem;
    option.innerText = problem;
    problemsDropdown.appendChild(option);
});

// ==========================================
// ANNOTATION VIEW & SUBMISSION
// ==========================================

reviewBtn.addEventListener('click', () => {
    textContainer.style.display = "none";
    reviewBtn.style.display = "none";
    if (clearBtn) clearBtn.style.display = "none";
    annotationContainer.style.display = "block";
    outputConsole.innerText = "";
    
    segmentsList.innerHTML = "";
    
    let segmentTexts = [];
    let currentSegment = [];
    
    wordsArray.forEach((word, index) => {
        currentSegment.push(word);
        if (cuts.has(index) || index === wordsArray.length - 1) {
            segmentTexts.push(currentSegment.join(" "));
            currentSegment = [];
        }
    });

    segmentTexts.forEach((text, i) => {
        const segmentBox = document.createElement('div');
        segmentBox.style.border = "1px solid #9ca3af";
        segmentBox.style.padding = "15px";
        segmentBox.style.marginBottom = "15px";
        segmentBox.style.borderRadius = "5px";
        segmentBox.style.backgroundColor = "#f9fafb";

        const segmentHeader = document.createElement('h4');
        segmentHeader.innerText = `Segment ${i + 1}`;
        segmentHeader.style.marginTop = "0";

        const textPara = document.createElement('p');
        textPara.innerText = text;

        const selectDropdown = document.createElement('select');
        selectDropdown.style.width = "100%";
        selectDropdown.style.padding = "8px";
        selectDropdown.className = "segment-annotation";
        
        annotationTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.innerText = type;
            selectDropdown.appendChild(option);
        });

        segmentBox.appendChild(segmentHeader);
        segmentBox.appendChild(textPara);
        segmentBox.appendChild(selectDropdown);
        segmentsList.appendChild(segmentBox);
    });
});

backBtn.addEventListener('click', () => {
    annotationContainer.style.display = "none";
    textContainer.style.display = "block";
    reviewBtn.style.display = "inline-block";
    if (clearBtn) clearBtn.style.display = "inline-block";
});

submitBtn.addEventListener('click', async () => {
    const dropdowns = document.querySelectorAll('.segment-annotation');
    let chosenCategories = [];
    let isMissingAnnotation = false;

    dropdowns.forEach((dropdown) => {
        if (dropdown.value === "Select a category...") {
            isMissingAnnotation = true;
        }
        chosenCategories.push(dropdown.value);
    });

    if (isMissingAnnotation) {
        alert("Please select an annotation category for every segment.");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerText = "Saving to Dropbox...";

    try {
        let segmentTexts = [];
        let currentSegment = [];
        wordsArray.forEach((word, index) => {
            currentSegment.push(word);
            if (cuts.has(index) || index === wordsArray.length - 1) {
                segmentTexts.push(currentSegment.join(" "));
                currentSegment = [];
            }
        });

        const now = new Date();
        const timestamp = now.toISOString();
        const currentDate = now.toISOString().split('T')[0];
        const finalProblem = problemsDropdown.value;
        const sortedCuts = Array.from(cuts).sort((a, b) => a - b);
        const codingString = `cut_${sortedCuts.join('_')}`;

        if (referenceData && referenceData.coder === CURRENT_USER) {
            const jsonText = await fetchDropboxFile(DROPBOX_REFERENCE_CUTS_PATH);
            let refStore = jsonText ? JSON.parse(jsonText) : {};
            refStore[CURRENT_DOCUMENT.title] = {
                coder: CURRENT_USER,
                timestamp: timestamp,
                cuts: sortedCuts,
                annotations: chosenCategories
            };
            await saveDropboxFile(DROPBOX_REFERENCE_CUTS_PATH, JSON.stringify(refStore, null, 2), "application/json");
        }

        let categoryIcrMsg = "";
        const catResults = calculateCategoryICR(chosenCategories);
        if (catResults) {
            categoryIcrMsg = `\nCategory Agreement: ${catResults.percentage}% (Cohen's Kappa: ${catResults.kappa})`;
        }

        const headers = ["timestamp", "segid", "user", "coding", "segment_id", "segment", "annotation_type", "annotation_other", "title", "date"];
        let existingCSV = await fetchDropboxFile(DROPBOX_CSV_SAVE_PATH) || "";
        let csvRows = [];

        if (!existingCSV.trim()) {
            csvRows.push(headers.join("\t"));
        } else {
            csvRows.push(existingCSV.trim());
        }

        segmentTexts.forEach((segmentText, i) => {
            const annotationType = chosenCategories[i];
            const segId = `SEG-${i + 1}`;
            
            const rowValues = [
                timestamp,
                segId,
                CURRENT_USER,
                codingString,
                i + 1,
                segmentText,
                annotationType,
                finalProblem,
                CURRENT_DOCUMENT.title,
                currentDate
            ];

            csvRows.push(rowValues.map(escapeCSV).join("\t"));
        });

        await saveDropboxFile(DROPBOX_CSV_SAVE_PATH, csvRows.join("\n"));

        outputConsole.innerText = `Successfully saved annotations to Dropbox!${categoryIcrMsg}`;
        outputConsole.style.color = "#22c55e";
        alert(`Annotations saved to Dropbox successfully!${categoryIcrMsg}`);

    } catch (error) {
        console.error("Error saving annotations:", error);
        outputConsole.innerText = "Failed to save annotations to Dropbox.";
        outputConsole.style.color = "#ef4444";
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Submit Final Annotations";
    }
});

// App Initialization Entrypoint
async function startApp() {
    initDocumentSelector();
    await ensureValidAccessToken();
    await loadDocumentData();
}

startApp();