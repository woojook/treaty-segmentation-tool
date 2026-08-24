// const DOCUMENTS_MANIFEST = [
//     {
//         title: "Treaty Document 1",
//         url: "https://www.dropbox.com/s/EXAMPLE1/treaty_1.csv?raw=1"
//     },
//     {
//         title: "Trade Agreement 2024",
//         url: "https://www.dropbox.com/s/EXAMPLE2/trade_2024.csv?raw=1"
//     }
// ];

// Sample CSV data containing document text
const sampleCsv = `id,text
1,"Article 1. The High Contracting Parties undertake to respect and to ensure respect for the present Convention in all circumstances. Article 2. In addition to the provisions which shall be implemented in peacetime, the present Convention shall apply to all cases of declared war or of any other armed conflict which may arise between two or more of the High Contracting Parties."`;

// Sample reference cuts JSON (Baseline cuts set at word indices 13 and 30)
const sampleRefJson = JSON.stringify({
    "Treaty Document 1 (Sample)": {
        "coder": "Professor_Reference",
        "cuts": [13, 30]
    }
});

// Embedded Data URLs to simulate remote files locally
const DOCUMENTS_MANIFEST = [
    {
        title: "Treaty Document 1 (Sample)",
        url: `data:text/csv;charset=utf-8,${encodeURIComponent(sampleCsv)}`
    }
];

const DROPBOX_REFERENCE_CUTS_URL = `data:application/json;charset=utf-8,${encodeURIComponent(sampleRefJson)}`;

// const DROPBOX_REFERENCE_CUTS_URL = "https://www.dropbox.com/s/EXAMPLE3/reference_cuts.json?raw=1";

let CURRENT_USER = sessionStorage.getItem("coder_id");

if (!CURRENT_USER) {
    CURRENT_USER = prompt("Enter your Coder ID (e.g., coder1, coder2, professor):") || "anonymous";
    sessionStorage.setItem("coder_id", CURRENT_USER);
}
let CURRENT_DOCUMENT = DOCUMENTS_MANIFEST[0];

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

let wordsArray = [];
let cuts = new Set();
let referenceData = null;

function sanitizeTSVCell(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val)
        .replace(/[\r\n]+/g, ' ')
        .replace(/\t/g, ' ')
        .replace(/"/g, '""');
    return `"${str}"`;
}

async function fetchDropboxFile(url) {
    try {
        const response = await fetch(url);
        if (response.ok) {
            return await response.text();
        } else {
            console.warn(`File fetch failed HTTP ${response.status}`);
            return null;
        }
    } catch (err) {
        console.warn("Fetch error:", err);
        return null;
    }
}

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

function initProblemsDropdown() {
    problemsDropdown.innerHTML = "";
    problemsEncountered.forEach(problem => {
        const option = document.createElement('option');
        option.value = problem;
        option.innerText = problem;
        problemsDropdown.appendChild(option);
    });
}

async function loadReferenceData() {
    referenceData = null;
    try {
        const jsonText = await fetchDropboxFile(DROPBOX_REFERENCE_CUTS_URL);
        if (jsonText) {
            const allRefData = JSON.parse(jsonText);
            if (allRefData[CURRENT_DOCUMENT.title]) {
                referenceData = allRefData[CURRENT_DOCUMENT.title];
            }
        }
    } catch (e) {
        console.warn("Could not load reference data.", e);
    }
}

async function loadDocumentData() {
    outputConsole.innerText = `Loading "${CURRENT_DOCUMENT.title}"...`;
    outputConsole.style.color = "#3b82f6";
    reconcileContainer.style.display = "none";
    problemsDropdown.value = problemsEncountered[0];

    cuts.clear();
    const saved = localStorage.getItem(`cuts_${CURRENT_DOCUMENT.title}`);
    if (saved) {
        cuts = new Set(JSON.parse(saved));
    }

    try {
        await loadReferenceData();

        const csvText = await fetchDropboxFile(CURRENT_DOCUMENT.url);
        if (!csvText || !csvText.trim()) {
            throw new Error(`Could not load document from URL.`);
        }

        const parsedRows = parseFullCSV(csvText);
        if (parsedRows.length === 0) {
            throw new Error("Failed to parse CSV document structure.");
        }

        const targetRow = parsedRows.length > 1 ? parsedRows[1] : parsedRows[0];
        const documentText = targetRow[1] !== undefined ? targetRow[1] : (targetRow[0] || "");
        
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

function parseFullCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                currentCell += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
            currentRow.push(currentCell.trim());
            if (currentRow.some(cell => cell.length > 0)) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(cell => cell.length > 0)) {
            rows.push(currentRow);
        }
    }

    return rows;
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

exportBtn.addEventListener('click', async () => {
    const coderACuts = Array.from(cuts).sort((a, b) => a - b);
    
    if (coderACuts.length === 0) {
        outputConsole.innerText = "Please make at least one cut before grading!";
        outputConsole.style.color = "#ef4444"; 
        return;
    }

    if (!referenceData) {
        const cutsBlob = new Blob([JSON.stringify({
            docTitle: CURRENT_DOCUMENT.title,
            coder: CURRENT_USER,
            timestamp: new Date().toISOString(),
            cuts: coderACuts
        }, null, 2)], { type: "application/json" });
        
        const downloadLink = document.createElement("a");
        downloadLink.href = URL.createObjectURL(cutsBlob);
        downloadLink.download = `${CURRENT_DOCUMENT.title}_cuts.json`;
        downloadLink.click();

        outputConsole.innerText = "Baseline cuts exported locally!";
        outputConsole.style.color = "#22c55e";
        return;
    }

    const coderBCuts = referenceData.cuts || [];
    buildReconciliationView(coderACuts, coderBCuts);
    
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
    saveConsensusBtn.addEventListener('click', () => {
        const consensusCheckboxes = document.querySelectorAll('.consensus-cut');
        const finalConsensusCuts = Array.from(consensusCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => parseInt(cb.value))
            .sort((a, b) => a - b);

        const reconBlob = new Blob([JSON.stringify({
            document: CURRENT_DOCUMENT.title,
            reconciledBy: CURRENT_USER,
            timestamp: new Date().toISOString(),
            consensusCuts: finalConsensusCuts
        }, null, 2)], { type: "application/json" });

        const downloadLink = document.createElement("a");
        downloadLink.href = URL.createObjectURL(reconBlob);
        downloadLink.download = `${CURRENT_DOCUMENT.title}_reconciled.json`;
        downloadLink.click();

        outputConsole.innerText = "Reconciled consensus exported locally!";
        outputConsole.style.color = "#22c55e";
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

submitBtn.addEventListener('click', () => {
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

    let categoryIcrMsg = "";
    const catResults = calculateCategoryICR(chosenCategories);
    if (catResults) {
        categoryIcrMsg = `\nCategory Agreement: ${catResults.percentage}% (Cohen's Kappa: ${catResults.kappa})`;
    }

    const headers = ["timestamp", "segid", "user", "coding", "segment_id", "segment", "annotation_type", "annotation_other", "title", "date"];
    let csvRows = [headers.join("\t")];

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

        csvRows.push(rowValues.map(sanitizeTSVCell).join("\t"));
    });

    const blob = new Blob([csvRows.join("\n")], { type: "text/tab-separated-values;charset=utf-8;" });
    const downloadLink = document.createElement("a");
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = `${CURRENT_DOCUMENT.title}_${CURRENT_USER}_annotations.tsv`;
    downloadLink.click();

    outputConsole.innerText = `Annotations downloaded successfully!${categoryIcrMsg}`;
    outputConsole.style.color = "#22c55e";
});

function startApp() {
    initDocumentSelector();
    initProblemsDropdown();
    loadDocumentData();
}

startApp();