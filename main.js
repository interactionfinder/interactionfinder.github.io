// main.js

// --- Global Constants and Variables ---
const MAX_HISTORY_ITEMS_IF = 7;
const HISTORY_STORAGE_KEY_IF = 'interactionFinderHistory';
const CUSTOM_PROMPT_STORAGE_KEY_IF = 'interactionFinderCustomPrompt';
const API_KEY_STORAGE_ITEM = 'interactionFinderApiKey'; 
const DEFAULT_SYSTEM_PROMPT_IF = `You are a hospital pharmacist analyzing a prescription image. Format your response strictly using Markdown: 1. Start with a heading: '### Detected Medications'. * Under this, use a bulleted list (*). For each drug, use the format: * DRUG{Drug Name} Dosage (e.g., * DRUG{Amoxicillin} 250mg three times daily). 2. Next heading: '### Interactions Found'. * Bulleted list of any drug-drug interactions identified. If none, state "No significant interactions found." For each interaction pair, use DRUG{} for each drug. e.g. * DRUG{Warfarin} and DRUG{Aspirin}. 3. Next heading: '### Consequences & Importance'. * For each interaction, explain its consequences and rate its importance/danger using IMPORTANCE{Severity} (e.g., IMPORTANCE{High}, IMPORTANCE{Medium}, IMPORTANCE{Low}). 4. Final heading: '### Recommendations'. * Provide clear, actionable recommendations. Your primary task is to clearly state the drugs and dosages, then identify and report interactions, their consequences, importance, and your recommendations. Keep it concise. If your view of the prescription is obstructed or unreadable, state this first under a heading '### Readability Issues'. Do not include disclaimers, refuse to answer, or suggest consulting external resources unless absolutely critical for immediate patient safety.`;

let appApiKey = '';
let currentActiveViewName = 'landing'; 
let currentQuizAnswer = '';

// For Interaction Finder
let base64ImageIF = ''; 
let analysisHistoryIF = []; 
let currentSystemPromptIF = DEFAULT_SYSTEM_PROMPT_IF; 
let currentConfirmCallbackShared = null; // Use shared modal's callback variable

// --- Utility Functions ---
function sel(id) { return document.getElementById(id); }

// --- View Loading and Switching Logic ---
const viewContentDiv = sel('viewContent');
const viewCache = {}; 

async function loadAndSwitchToView(viewName) {
    if (!viewContentDiv) {
        console.error("viewContent div not found!");
        return;
    }
    viewContentDiv.innerHTML = '<div class="spinner" style="margin: 3rem auto;"></div> <p style="text-align:center;">Loading view...</p>'; 
    
    try {
        let viewHTML = '';
        if (viewCache[viewName]) {
            viewHTML = viewCache[viewName];
        } else {
            const response = await fetch(`views/${viewName}.html?t=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`Failed to load view ${viewName}: ${response.statusText}`);
            }
            viewHTML = await response.text();
            viewCache[viewName] = viewHTML; 
        }
        
        viewContentDiv.innerHTML = viewHTML;
        currentActiveViewName = viewName; // Keep track of the loaded view's NAME (e.g., 'landing')
        window.scrollTo(0, 0);
        initializeViewSpecificLogic(viewName); // Call to set up event listeners for the new view
    } catch (error) {
        console.error("Error loading view:", error);
        viewContentDiv.innerHTML = `<p style="color:var(--danger-color); text-align:center;">Error loading content for view "${viewName}". Please check console and file path.</p>`;
    }
}

// --- API Key Management (SHARED, targets 'Global' suffixed IDs) ---
const apiKeyInputGlobal = sel('apiKeyInputGlobal');
const saveApiKeyBtnGlobal = sel('saveApiKeyBtnGlobal');
const testApiKeyBtnGlobal = sel('testApiKeyBtnGlobal');
const clearApiKeyBtnGlobal = sel('clearApiKeyBtnGlobal');
const apiKeyStatusGlobal = sel('apiKeyStatusGlobal');

function updateStatusWithMessage(element, message, type = 'info', duration = 4000) { 
    if (!element) { console.warn("updateStatusWithMessage: Element not found to update status for."); return; }
    element.textContent = message; 
    element.className = ''; 
    element.classList.add(type); 
    if (message && duration > 0) { 
        setTimeout(() => { 
            if (element.textContent === message) { 
                element.textContent = ''; 
                element.className = 'info'; 
            }
        }, duration); 
    } 
}
function updateApiKeyDisplayStatus(message, type = 'info') { updateStatusWithMessage(apiKeyStatusGlobal, message, type); }
function loadApiKeyFromStorage() { const k=localStorage.getItem(API_KEY_STORAGE_ITEM); if(k){if(apiKeyInputGlobal) apiKeyInputGlobal.value=k;appApiKey=k;updateApiKeyDisplayStatus('API Key loaded.','info');}else{updateApiKeyDisplayStatus('Please enter API Key.','info');} }
if(saveApiKeyBtnGlobal) saveApiKeyBtnGlobal.onclick = () => { const k=apiKeyInputGlobal.value.trim();if(k&&k.startsWith('sk-')){localStorage.setItem(API_KEY_STORAGE_ITEM,k);appApiKey=k;updateApiKeyDisplayStatus('API Key saved!','success');}else{updateApiKeyDisplayStatus(k?'Invalid Key format.':'Key cannot be empty.','error');} };
if(testApiKeyBtnGlobal) testApiKeyBtnGlobal.onclick = async () => { const k=apiKeyInputGlobal.value.trim();if(!k){updateApiKeyDisplayStatus('Enter key to test.','error');return;} updateApiKeyDisplayStatus('Testing...','info');try{const r=await fetch('https://api.openai.com/v1/models',{headers:{'Authorization':`Bearer ${k}`}});if(r.ok){updateApiKeyDisplayStatus('Key valid!','success');if(k!==appApiKey){localStorage.setItem(API_KEY_STORAGE_ITEM,k);appApiKey=k;}}else{const e=await r.json();updateApiKeyDisplayStatus(`Test failed: ${e.error?.message||r.statusText}`,'error');}}catch(e){console.error("API Key Test Error:", e); updateApiKeyDisplayStatus('Test failed: Network error.','error');} };
if(clearApiKeyBtnGlobal) clearApiKeyBtnGlobal.onclick = () => { localStorage.removeItem(API_KEY_STORAGE_ITEM);if(apiKeyInputGlobal) apiKeyInputGlobal.value='';appApiKey='';updateApiKeyDisplayStatus('API Key cleared.','info'); };

// --- Shared Modal Logic ---
const customModalOverlayShared = sel('customModalOverlayShared'); 
const modalMessageShared = sel('modalMessageShared');
const modalConfirmBtnShared = sel('modalConfirmBtnShared');
const modalCancelBtnShared = sel('modalCancelBtnShared');

function showSharedConfirm(message, onConfirm) { 
    if(!modalMessageShared || !customModalOverlayShared) { console.warn("Shared modal elements not found."); return;} 
    modalMessageShared.textContent = message; 
    currentConfirmCallbackShared = onConfirm; 
    customModalOverlayShared.classList.add('active'); 
}
function hideSharedConfirm() { 
    if(!customModalOverlayShared) return; 
    customModalOverlayShared.classList.remove('active'); 
    currentConfirmCallbackShared = null; 
}
if(modalConfirmBtnShared) modalConfirmBtnShared.onclick = () => { if (currentConfirmCallbackShared) currentConfirmCallbackShared(); hideSharedConfirm(); };
if(modalCancelBtnShared) modalCancelBtnShared.onclick = hideSharedConfirm;
if(customModalOverlayShared) customModalOverlayShared.onclick = (e) => { if (e.target === customModalOverlayShared) hideSharedConfirm(); };


// --- Function to Initialize Logic for the Current View ---
function initializeViewSpecificLogic(viewName) {
    console.log("Initializing logic for view:", viewName);
    
    // General navigation buttons common to most tool views
    const backToLandingButtons = document.querySelectorAll('[data-action="backToLanding"]');
    backToLandingButtons.forEach(button => {
        button.onclick = () => loadAndSwitchToView('landing');
    });

    if (viewName === 'landing') {
        initializeLandingViewLogic();
    } else if (viewName === 'interaction_finder') {
        initializeInteractionFinderLogic();
    } else if (viewName === 'advice_generator') {
        initializeAdviceGeneratorLogic();
    } else if (viewName === 'advice_result') {
        initializeAdviceResultLogic();
    } else if (viewName === 'dosage_calculator') {
        initializeDosageCalculatorLogic();
    } else if (viewName === 'dosage_result') {
        initializeDosageResultLogic();
    } else if (viewName === 'drug_quizzer') {
        initializeDrugQuizzerLogic();
    } else if (viewName === 'anticoag_bridging') {
        initializeAnticoagBridgingLogic();
    } else if (viewName === 'anticoag_result') {
        initializeAnticoagResultLogic();
    }
}

// --- Initialization Functions for Each View ---

function initializeLandingViewLogic() {
    const buttons = sel('landingViewLocal').querySelectorAll('button[data-view-target]');
    buttons.forEach(button => {
        button.onclick = () => {
            const targetView = button.getAttribute('data-view-target');
            if (targetView) {
                loadAndSwitchToView(targetView).then(() => {
                    if (targetView === 'drug_quizzer') {
                         const quizQArea = sel('quizQuestionArea');
                         if (quizQArea && quizQArea.textContent.includes('Click "New Question"')) { // Check if it's the initial state
                             if (typeof fetchNewQuizQuestion === 'function') fetchNewQuizQuestion();
                         }
                    }
                });
            }
        };
    });
}

function initializeInteractionFinderLogic() {
    // Selectors (ensure these IDs are in your views/interaction_finder.html)
    const takePhotoBtnIF = sel('takePhotoBtnIF'), 
          fileInputIF = sel('fileInputIF'),
          previewImgIF = sel('previewImgIF'), 
          usePhotoBtnIF = sel('usePhotoBtnIF'), 
          retakeBtnIF = sel('retakeBtnIF'),
          modelSelectIF = sel('modelSelectIF'), 
          loadingSecIF = sel('loadingSectionIF'), 
          responseBoxIF = sel('responseBoxIF'), 
          restartBtnIF = sel('restartBtnIF'),
          copyResultsBtnIF = sel('copyResultsBtnIF'), 
          historyCarouselIF = sel('historyCarouselIF'),
          noHistoryMessageIF = sel('noHistoryMessageIF'), 
          historySectionElementIF = sel('historySectionIF'),
          historyCarouselContainerIF = sel('historyCarouselContainerIF'), 
          clearAllHistoryBtnIF = sel('clearAllHistoryBtnIF'),
          goToPromptCustomizationBtnIF = sel('goToPromptCustomizationBtnIF'),
          promptCustomizationBtnContainerIF = sel('promptCustomizationBtnContainerIF'),
          promptSectionElementIF = sel('promptSectionIF'), 
          promptEditorIF = sel('promptEditorIF'),
          savePromptBtnIF = sel('savePromptBtnIF'), 
          resetPromptBtnIF = sel('resetPromptBtnIF'),
          returnToMainFromPromptBtnIF = sel('returnToMainFromPromptBtnIF'), 
          promptStatusIF = sel('promptStatusIF'),
          patientInfoGeneratorBtnExternalIF = sel('patientInfoGeneratorBtnExternalIF'),
          backToLandingViewFromMainBtnIF = sel('backToLandingViewFromMainBtnIF');

    const allIFSectionElements = sel('interactionFinderViewLocal') && sel('interactionFinderViewLocal').querySelector('.page-container') 
        ? Array.from(sel('interactionFinderViewLocal').querySelector('.page-container').querySelectorAll('section[id], div#promptCustomizationBtnContainerIF')) 
        : [];

    function showHideElement(element, show) {
        if (element) element.hidden = !show;
    }

    function switchToMainAppSection(targetSectionId) {
        if (!sel('interactionFinderViewLocal') || !allIFSectionElements.length) { console.warn("IF View not fully loaded for section switch"); return; }
        allIFSectionElements.forEach(el => showHideElement(el, false)); 
        
        const sectionToShow = sel(targetSectionId); 
        if (sectionToShow) showHideElement(sectionToShow, true); 

        if (targetSectionId === 'captureSectionIF') { 
            showHideElement(historySectionElementIF, true); 
            showHideElement(promptCustomizationBtnContainerIF, true); 
            if (analysisHistoryIF.length > 0) { 
                showHideElement(noHistoryMessageIF, false); 
                showHideElement(historyCarouselContainerIF, true); 
                showHideElement(clearAllHistoryBtnIF, true); 
            } else { 
                showHideElement(noHistoryMessageIF, true); 
                showHideElement(historyCarouselContainerIF, false); 
                showHideElement(clearAllHistoryBtnIF, false); 
            } 
        } 
    }
    function updatePromptStatusDisplay(message, type = 'info') { updateStatusWithMessage(promptStatusIF, message, type); } 
    
    function loadHistoryIF() { const storedHistory = localStorage.getItem(HISTORY_STORAGE_KEY_IF); try { analysisHistoryIF = storedHistory ? JSON.parse(storedHistory) : []; } catch (e) { analysisHistoryIF = []; localStorage.removeItem(HISTORY_STORAGE_KEY_IF); } renderHistoryCarouselIF(); }
    function saveAnalysisToHistoryIF(imgBase64, respHtml, model) { const newItem = { id: Date.now(), imageBase64: imgBase64, responseHtml: respHtml, modelUsed: model, timestamp: Date.now() }; analysisHistoryIF.unshift(newItem); if (analysisHistoryIF.length > MAX_HISTORY_ITEMS_IF) analysisHistoryIF.length = MAX_HISTORY_ITEMS_IF; localStorage.setItem(HISTORY_STORAGE_KEY_IF, JSON.stringify(analysisHistoryIF)); renderHistoryCarouselIF(); }
    function deleteHistoryItemIF(itemId) { showSharedConfirm('Delete this analysis from history?', () => { analysisHistoryIF = analysisHistoryIF.filter(item => item.id !== itemId); localStorage.setItem(HISTORY_STORAGE_KEY_IF, JSON.stringify(analysisHistoryIF)); renderHistoryCarouselIF(); }); }
    if(clearAllHistoryBtnIF) clearAllHistoryBtnIF.onclick = () => { showSharedConfirm('Clear all recent analyses? This cannot be undone.', () => { analysisHistoryIF = []; localStorage.removeItem(HISTORY_STORAGE_KEY_IF); renderHistoryCarouselIF(); }); };
    function renderHistoryCarouselIF() { if(!historyCarouselIF || !noHistoryMessageIF || !historyCarouselContainerIF || !clearAllHistoryBtnIF) return; historyCarouselIF.innerHTML = ''; if (analysisHistoryIF.length === 0) { showHideElement(noHistoryMessageIF,true); showHideElement(historyCarouselContainerIF,false); showHideElement(clearAllHistoryBtnIF,false); } else { showHideElement(noHistoryMessageIF,false); showHideElement(historyCarouselContainerIF,true); showHideElement(clearAllHistoryBtnIF,true); analysisHistoryIF.forEach(item => { const w = document.createElement('div'); w.className = 'history-item-wrapper'; const iDiv = document.createElement('div'); iDiv.className = 'history-item'; iDiv.onclick = () => loadAnalysisFromHistoryItemIF(item); const img = document.createElement('img'); img.src = `data:image/jpeg;base64,${item.imageBase64}`; img.alt = `Analyzed ${new Date(item.timestamp).toLocaleDateString()}`; iDiv.appendChild(img); const del = document.createElement('button'); del.className = 'delete-history-item-btn'; del.innerHTML = '×'; del.title = 'Delete'; del.onclick = (e) => { e.stopPropagation(); deleteHistoryItemIF(item.id); }; iDiv.appendChild(del); const date = document.createElement('span'); date.className = 'history-item-date'; const d=new Date(item.timestamp); date.textContent = `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; w.appendChild(iDiv); w.appendChild(date); historyCarouselIF.appendChild(w); });}}
    function loadAnalysisFromHistoryItemIF(item) { if(item && responseBoxIF){ responseBoxIF.innerHTML=item.responseHtml; switchToMainAppSection('resultSectionIF'); } }
    function loadCustomPromptIF() { const sp = localStorage.getItem(CUSTOM_PROMPT_STORAGE_KEY_IF); currentSystemPromptIF = sp ? sp : DEFAULT_SYSTEM_PROMPT_IF; if(promptEditorIF) promptEditorIF.value = currentSystemPromptIF; if(sp && promptStatusIF) updatePromptStatusDisplay('Custom prompt loaded.','info', 2000); }
    if(goToPromptCustomizationBtnIF) goToPromptCustomizationBtnIF.onclick = () => { if(promptEditorIF) promptEditorIF.value = currentSystemPromptIF; switchToMainAppSection('promptSectionIF'); };
    if(savePromptBtnIF) savePromptBtnIF.onclick = () => { const np = promptEditorIF.value.trim(); if (np) { currentSystemPromptIF = np; localStorage.setItem(CUSTOM_PROMPT_STORAGE_KEY_IF, np); updatePromptStatusDisplay('Prompt saved successfully!', 'success'); } else { updatePromptStatusDisplay('Prompt cannot be empty. Reverted.', 'error'); promptEditorIF.value = currentSystemPromptIF; }};
    if(resetPromptBtnIF) resetPromptBtnIF.onclick = () => { showSharedConfirm("Reset prompt to default?", () => { currentSystemPromptIF = DEFAULT_SYSTEM_PROMPT_IF; promptEditorIF.value = DEFAULT_SYSTEM_PROMPT_IF; localStorage.removeItem(CUSTOM_PROMPT_STORAGE_KEY_IF); updatePromptStatusDisplay('Prompt reset to default.', 'info'); }); };
    if(returnToMainFromPromptBtnIF) returnToMainFromPromptBtnIF.onclick = () => switchToMainAppSection('captureSectionIF');
    if(takePhotoBtnIF) takePhotoBtnIF.onclick =()=> { if(fileInputIF) fileInputIF.click(); };
    if(retakeBtnIF) retakeBtnIF.onclick =()=> { if(fileInputIF) fileInputIF.click(); };
    if(fileInputIF) fileInputIF.onchange = async () => { const f=fileInputIF.files[0];if(!f)return;try{base64ImageIF=await toBase64IF(f);if(previewImgIF) previewImgIF.src='data:image/jpeg;base64,'+base64ImageIF;switchToMainAppSection('previewSectionIF');}catch(e){console.error("File error:",e);alert("Could not load image.");}};
    if(usePhotoBtnIF) usePhotoBtnIF.onclick=()=>analyzeImageIF();
    if(restartBtnIF) restartBtnIF.onclick=()=> { if(responseBoxIF) responseBoxIF.innerHTML='';if(fileInputIF) fileInputIF.value='';base64ImageIF='';if(previewImgIF) previewImgIF.src='';if(modelSelectIF) modelSelectIF.value='gpt-4o-mini';switchToMainAppSection('captureSectionIF');};
    if(copyResultsBtnIF) copyResultsBtnIF.onclick = () => { const t=responseBoxIF.textContent;if(navigator.clipboard&&t){navigator.clipboard.writeText(t).then(()=>updateApiKeyDisplayStatus('Results copied!','success', 2000)).catch(e=>updateApiKeyDisplayStatus('Failed to copy.','error', 2000));}};
    function markdownToHtmlIF(mdText) { let h = mdText.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>'); h = h.replace(/DRUG\{(.*?)\}/gim, '<span class="highlight-drug">$1</span>'); h = h.replace(/IMPORTANCE\{(High|Medium|Low)\}/gim, (m,s)=>`<span class="highlight-importance-${s.toLowerCase()}">${s}</span>`); h = h.replace(/^### (.*$)/gim, '<h3><span class="section-title-text">$1</span></h3>'); h = h.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>').replace(/__(.*?)__/gim, '<strong>$1</strong>'); h = h.replace(/\*(.*?)\*/gim, '<em>$1</em>').replace(/_(.*?)_/gim, '<em>$1</em>'); let iL=false; h=h.split('\n').map(l=>{const tL=l.trim();if(tL.match(/^[\*\-]\s+/)){let liC=tL.substring(tL.indexOf(' ')+1).trim();let li=`<li>${liC}</li>`;if(!iL){iL=true;return `<ul>${li}`;}return li;}else{let lR=l;if(iL){lR=`</ul>${lR}`;iL=false;}const tNL=lR.trim();if(tNL&&!tNL.startsWith('<h3')&&!tNL.startsWith('<ul>')&&!tNL.endsWith('</ul>')&&!tNL.startsWith('<p>')&&!tNL.endsWith('</p>')){return `<p>${tNL}</p>`;}return lR;}}).join('\n');if(iL)h+='</ul>';h=h.replace(/<\/ul>\s*<p>/gim,'</ul><p>').replace(/<p>\s*<\/p>/gim,'').replace(/\n\s*\n/g,'\n');return h.trim();}
    function addCopySectionButtonsToResponseBoxIF() { if(!responseBoxIF) return; const hs=responseBoxIF.querySelectorAll('h3');hs.forEach(hE=>{let tS=hE.querySelector('.section-title-text');if(!tS){const tT=hE.textContent;hE.innerHTML='';tS=document.createElement('span');tS.className='section-title-text';tS.textContent=tT;hE.appendChild(tS);}if(hE.querySelector('.copy-section-btn'))return; const cB=document.createElement('button');cB.className='copy-section-btn';cB.textContent='Copy';cB.title=`Copy "${tS.textContent}" section`;hE.appendChild(cB);});}
    if(responseBoxIF) responseBoxIF.addEventListener('click', function(event) { if(event.target.classList.contains('copy-section-btn')){const hE=event.target.closest('h3');if(!hE)return;let cTC=hE.querySelector('.section-title-text').textContent+'\n';let nE=hE.nextElementSibling;while(nE&&nE.tagName!=='H3'){if(nE.tagName==='UL'){Array.from(nE.querySelectorAll('li')).forEach(li=>{cTC+=`• ${li.textContent.trim()}\n`;});}else{cTC+=nE.textContent.trim()+'\n';}nE=nE.nextElementSibling;}if(navigator.clipboard){navigator.clipboard.writeText(cTC.trim()).then(()=>updateApiKeyDisplayStatus('Section copied!','success',2000)).catch(err=>updateApiKeyDisplayStatus('Failed to copy.','error',2000));}}});
    async function analyzeImageIF(){ if(!appApiKey){updateApiKeyDisplayStatus('API Key required.','error');apiKeyInputGlobal.focus();if(loadingSecIF && !loadingSecIF.hidden)switchToMainAppSection('previewSectionIF');if(responseBoxIF) responseBoxIF.innerHTML='<p style="color:var(--danger-color);">API Key missing.</p>';return;} if(responseBoxIF) responseBoxIF.innerHTML='';switchToMainAppSection('loadingSectionIF'); const sM=modelSelectIF.value; const body={model:sM,messages:[{role:'user',content:[{type:'text',text:currentSystemPromptIF},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+base64ImageIF}}]}],max_tokens:2000}; try{ const rs=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+appApiKey},body:JSON.stringify(body)}); const d=await rs.json(); if(rs.ok&&d.choices?.[0]?.message?.content){ const rm=d.choices[0].message.content.trim(); const hr=markdownToHtmlIF(rm); responseBoxIF.innerHTML=hr; addCopySectionButtonsToResponseBoxIF(); saveAnalysisToHistoryIF(base64ImageIF, responseBoxIF.innerHTML, sM); }else{ const em=d.error?`${d.error.message} (Code: ${d.error.code})`:'Unknown API error.'; responseBoxIF.innerHTML=`<p style="color:var(--danger-color);">Error: ${em}</p>`; if(d.error?.code==='invalid_api_key'||d.error?.type==='auth_error'){updateApiKeyDisplayStatus('Invalid API Key.','error');appApiKey='';localStorage.removeItem(API_KEY_STORAGE_ITEM);if(apiKeyInputGlobal) apiKeyInputGlobal.value='';}}}catch(e){if(responseBoxIF) responseBoxIF.innerHTML='<p style="color:var(--danger-color);">Request failed. Check network.</p>';} finally{switchToMainAppSection('resultSectionIF');}}
    function toBase64IF(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(file);});}
    
    if(patientInfoGeneratorBtnExternalIF) patientInfoGeneratorBtnExternalIF.onclick = () => { window.open('info.html', '_blank'); }; 
    if(backToLandingViewFromMainBtnIF) backToLandingViewFromMainBtnIF.onclick = () => loadAndSwitchToView('landing');

    // Initial setup specific to Interaction Finder
    loadHistoryIF();
    loadCustomPromptIF();
    switchToMainAppSection('captureSectionIF'); 
}

function initializeAdviceGeneratorLogic() {
    const adviceDrugNameInput = sel('adviceDrugNameInput'); 
    const adviceModelSelect = sel('adviceModelSelect'); 
    const generateAdviceActualBtn = sel('generateAdviceActualBtn'); 
    const returnToLandingViewBtn1 = sel('returnToLandingViewBtn1');
    const adviceGeneratorStatusMessage = sel('adviceGeneratorStatusMessage'); 
    const adviceGeneratorLoadingIndicator = sel('adviceGeneratorLoadingIndicator');

    if(adviceModelSelect) adviceModelSelect.value = 'gpt-4o-mini';
    
    function updateAdviceGeneratorStatus(message, isError = false, duration = 5000) { 
        if (!adviceGeneratorStatusMessage) return; 
        adviceGeneratorStatusMessage.textContent = message; 
        adviceGeneratorStatusMessage.style.color = isError ? 'var(--danger-color)' : 'var(--success-color)'; 
        if (!isError && message && !message.toLowerCase().includes('error') && !message.toLowerCase().includes('valid')) { 
            adviceGeneratorStatusMessage.style.color = 'var(--secondary-color)'; 
        } 
        if (message && duration > 0) { 
            setTimeout(() => { if (adviceGeneratorStatusMessage.textContent === message) adviceGeneratorStatusMessage.textContent = ''; }, duration); 
        } 
    }
    
    if(generateAdviceActualBtn) generateAdviceActualBtn.onclick = async () => { 
        const drugName = adviceDrugNameInput.value.trim(); 
        const selectedModelDisplay = adviceModelSelect.value; 
        if (!appApiKey) { updateAdviceGeneratorStatus('API Key is missing. Configure it at the top.', true); if(apiKeyInputGlobal) apiKeyInputGlobal.focus(); return; } 
        if (!drugName) { updateAdviceGeneratorStatus('Please enter a drug name.', true); if(adviceDrugNameInput) adviceDrugNameInput.focus(); return; } 
        updateAdviceGeneratorStatus(''); 
        if(adviceGeneratorStatusMessage) adviceGeneratorStatusMessage.hidden = true; 
        if(adviceGeneratorLoadingIndicator) adviceGeneratorLoadingIndicator.hidden = false; 
        generateAdviceActualBtn.disabled = true; 
        if(returnToLandingViewBtn1) returnToLandingViewBtn1.disabled = true; 
        let modelForAPI; 
        switch (selectedModelDisplay) { 
            case 'gpt-3.5-turbo': modelForAPI = 'gpt-3.5-turbo'; break; 
            case 'gpt-4o-mini': modelForAPI = 'gpt-4o-mini'; break; 
            case 'gpt-4o': modelForAPI = 'gpt-4o'; break; 
            default: modelForAPI = 'gpt-4o-mini'; 
        } 
        const userPrompt = `Generate a patient-friendly explanation about <span class="result-highlight-drugname">${drugName}</span>. Your task is to clearly inform someone who has never taken this medication about: - What <span class="result-highlight-drugname">${drugName}</span> is and why it is prescribed. - How to correctly take it (including dosage, timing, or any instructions). - Important <span class="result-highlight-term">medical terms</span> and the mechanism of action, if relevant. - Expected <span class="result-highlight-benefit">benefits</span> and outcomes. - Potential <span class="result-highlight-caution">side effects</span>, warnings, and any necessary precautions. Use simple, non-technical language that any patient can understand. Format the output using the following HTML <span> tags: - \`<span class="result-highlight-drugname">${drugName}</span>\` for every mention of the drug. - \`<span class="result-highlight-term">{medical_term}</span>\` for key medical concepts or mechanisms. - \`<span class="result-highlight-benefit">{positive_effect_or_benefit}</span>\` for benefits and improvements. - \`<span class="result-highlight-caution">{caution_side_effect_or_warning}</span>\` for any risks or side effects. Structure the response into 1–3 concise paragraphs without introductory or concluding fluff. If "${drugName}" is not a recognized drug, respond with a short notice asking for a valid name and suggest similar known drugs. If ${drugName} is not quite correct, change it yourself to the correct name.`; 
        try { 
            const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: {'Content-Type':'application/json','Authorization':`Bearer ${appApiKey}`}, body: JSON.stringify({model: modelForAPI, messages: [{ role: 'user', content: userPrompt }], max_tokens: 450 }) }); 
            const data = await response.json(); 
            if (response.ok && data.choices?.[0]?.message?.content) { 
                const adviceText = data.choices[0].message.content.trim(); 
                displayAdviceResult(drugName, `${selectedModelDisplay} (API: ${modelForAPI})`, adviceText); 
            } else { 
                const errorMsg = data.error ? `${data.error.message} (Code: ${data.error.code})` : 'Unknown API error.'; 
                updateAdviceGeneratorStatus(`Error generating advice: ${errorMsg}`, true, 7000); 
                if(adviceGeneratorStatusMessage) adviceGeneratorStatusMessage.hidden = false; 
                if(data.error?.code==='invalid_api_key'||data.error?.type==='auth_error'){ updateApiKeyDisplayStatus('Invalid API Key.','error');appApiKey='';localStorage.removeItem(API_KEY_STORAGE_ITEM);if(apiKeyInputGlobal) apiKeyInputGlobal.value='';} 
            } 
        } catch (error) { 
            console.error("Advice Generation Request failed:", error); 
            updateAdviceGeneratorStatus('Request failed. Check network or console for details.', true, 7000); 
            if(adviceGeneratorStatusMessage) adviceGeneratorStatusMessage.hidden = false; 
        } finally { 
            if(adviceGeneratorLoadingIndicator) adviceGeneratorLoadingIndicator.hidden = true; 
            generateAdviceActualBtn.disabled = false; 
            if(returnToLandingViewBtn1) returnToLandingViewBtn1.disabled = false; 
        } 
    };
    if(returnToLandingViewBtn1) returnToLandingViewBtn1.onclick = () => loadAndSwitchToView('landing');
}

function initializeAdviceResultLogic() {
    const generateNewAdviceBtn = sel('generateNewAdviceBtn');
    const returnToLandingViewBtn2 = sel('returnToLandingViewBtn2');
    if(generateNewAdviceBtn) generateNewAdviceBtn.onclick = () => loadAndSwitchToView('advice_generator');
    if(returnToLandingViewBtn2) returnToLandingViewBtn2.onclick = () => loadAndSwitchToView('landing');
}
function displayAdviceResult(drug, model, adviceHTML) { 
    loadAndSwitchToView('advice_result').then(() => {
        if(sel('resultAdviceDrugName')) sel('resultAdviceDrugName').textContent = drug; 
        if(sel('resultAdviceModelUsed')) sel('resultAdviceModelUsed').textContent = model; 
        if(sel('adviceDisplayArea')) sel('adviceDisplayArea').innerHTML = adviceHTML; 
    });
}

function initializeDosageCalculatorLogic() {
    const dosageDrugNameInput = sel('dosageDrugNameInput'); 
    const dosagePatientWeightInput = sel('dosagePatientWeightInput');
    const dosagePatientAgeInput = sel('dosagePatientAgeInput');
    const dosageRenalFunctionInput = sel('dosageRenalFunctionInput');
    const dosageModelSelect = sel('dosageModelSelect'); 
    const calculateDosageActualBtn = sel('calculateDosageActualBtn');
    const returnToLandingViewBtn3 = sel('returnToLandingViewBtn3');
    const dosageCalculatorStatusMessage = sel('dosageCalculatorStatusMessage'); 
    const dosageCalculatorLoadingIndicator = sel('dosageCalculatorLoadingIndicator');

    if(dosageModelSelect) dosageModelSelect.value = 'gpt-4o'; 
    
    function updateDosageCalculatorStatus(message, isError = false, duration = 7000) { 
        if (!dosageCalculatorStatusMessage) return; 
        dosageCalculatorStatusMessage.textContent = message; 
        dosageCalculatorStatusMessage.style.color = isError ? 'var(--danger-color)' : 'var(--success-color)'; 
        if (!isError && message && !message.toLowerCase().includes('error')) { 
            dosageCalculatorStatusMessage.style.color = 'var(--secondary-color)'; 
        } 
        if (message && duration > 0) { 
            setTimeout(() => { if (dosageCalculatorStatusMessage.textContent === message) dosageCalculatorStatusMessage.textContent = ''; }, duration); 
        } 
    }
    
    if(calculateDosageActualBtn) calculateDosageActualBtn.onclick = async () => {
        const drugName = dosageDrugNameInput.value.trim(); const weight = dosagePatientWeightInput.value.trim();
        const age = dosagePatientAgeInput.value.trim(); const renal = dosageRenalFunctionInput.value.trim();
        const selectedModel = dosageModelSelect.value;
        if (!appApiKey) { updateDosageCalculatorStatus('API Key is missing. Configure it at the top.', true); if(apiKeyInputGlobal) apiKeyInputGlobal.focus(); return; }
        if (!drugName) { updateDosageCalculatorStatus('Drug Name is required.', true); if(dosageDrugNameInput) dosageDrugNameInput.focus(); return; }
        if (!weight) { updateDosageCalculatorStatus('Patient Weight is required.', true); if(dosagePatientWeightInput) dosagePatientWeightInput.focus(); return; }
        if (!age) { updateDosageCalculatorStatus('Patient Age is required.', true); if(dosagePatientAgeInput) dosagePatientAgeInput.focus(); return; }
        updateDosageCalculatorStatus(''); 
        if(dosageCalculatorStatusMessage) dosageCalculatorStatusMessage.hidden = true; 
        if(dosageCalculatorLoadingIndicator) dosageCalculatorLoadingIndicator.hidden = false; 
        calculateDosageActualBtn.disabled = true; 
        if(returnToLandingViewBtn3) returnToLandingViewBtn3.disabled = true;
        const prompt = `You are an AI assistant providing GENERAL INFORMATION based on common drug dosage guidelines for EXPERIMENTAL AND EDUCATIONAL PURPOSES for HOSPITAL PHARMACISTS. This information is NOT for direct patient use or clinical decision-making without professional verification. Drug Name: ${drugName}. Patient Weight: ${weight} kg. Patient Age: ${age} years. Renal Function (User Provided): "${renal}". Based on generally accepted dosage guidelines for the drug '${drugName}', provide TYPICAL dosage information for a patient with these characteristics. Your response should be geared towards a pharmacist audience. Your response should aim to include: 1. The typical dosage calculation or range (e.g., "X mg/kg/day divided Y times" or "Z mg every X hours"). Clearly show how the weight and age might be used if applicable. 2. Any common frequency or administration routes. 3. Mention any standard adjustments or special considerations based on age (e.g. pediatric, geriatric), weight, or the provided renal function description. If renal description is vague (e.g. "bad kidneys"), state that specific advice needs proper clinical assessment of renal function (e.g. CrCl/eGFR). 4. State any common maximum daily doses if widely known for this drug and context. 5. A brief concluding note: "<span class="result-highlight-disclaimer-ai">Reminder: This AI-generated information is for experimental/educational review by pharmacists and requires verification against official drug monographs and clinical judgment.</span>" 6. If the drug name is not recognized or if the provided parameters are clearly insufficient or outside a typical range for providing any general guideline, clearly state that and explain why. DO NOT INVENT INFORMATION OR DOSAGES. Format the response using these HTML <span> tags for emphasis: - Drug name: <span class="result-highlight-drugname">${drugName}</span> - Calculated or typical dosage values/ranges: <span class="result-highlight-dosage">{dosage_value}</span> - Important considerations, warnings, or adjustments: <span class="result-highlight-important-consideration">{consideration_text}</span> - The concluding reminder note text itself: <span class="result-highlight-disclaimer-ai">{reminder_text_as_above}</span>`;
        try { 
            const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: {'Content-Type':'application/json','Authorization':`Bearer ${appApiKey}`}, body: JSON.stringify({model: selectedModel, messages: [{ role: 'user', content: prompt }], max_tokens: 700 }) }); 
            const data = await response.json(); 
            if (response.ok && data.choices?.[0]?.message?.content) { 
                const dosageInfoHTML = data.choices[0].message.content.trim(); 
                displayDosageResult(drugName, weight, age, renal, `${selectedModel} (API: ${selectedModel})`, dosageInfoHTML); 
            } else { 
                const errorMsg = data.error ? `${data.error.message} (Code: ${data.error.code})` : 'Unknown API error.'; 
                updateDosageCalculatorStatus(`Error generating dosage info: ${errorMsg}`, true); 
                if(dosageCalculatorStatusMessage) dosageCalculatorStatusMessage.hidden = false; 
                if(data.error?.code==='invalid_api_key'||data.error?.type==='auth_error'){ updateApiKeyDisplayStatus('Invalid API Key.','error');appApiKey='';localStorage.removeItem(API_KEY_STORAGE_ITEM);if(apiKeyInputGlobal) apiKeyInputGlobal.value='';} 
            } 
        } catch (error) { 
            console.error("Dosage Calculation Request failed:", error); 
            updateDosageCalculatorStatus('Request failed. Check network or console for details.', true); 
            if(dosageCalculatorStatusMessage) dosageCalculatorStatusMessage.hidden = false; 
        } finally { 
            if(dosageCalculatorLoadingIndicator) dosageCalculatorLoadingIndicator.hidden = true; 
            calculateDosageActualBtn.disabled = false; 
            if(returnToLandingViewBtn3) returnToLandingViewBtn3.disabled = false; 
        } 
    };
    if(returnToLandingViewBtn3) returnToLandingViewBtn3.onclick = () => loadAndSwitchToView('landing');
}

function initializeDosageResultLogic() {
    const calculateNewDosageBtn = sel('calculateNewDosageBtn');
    const returnToLandingViewBtn4 = sel('returnToLandingViewBtn4');
    if(calculateNewDosageBtn) calculateNewDosageBtn.onclick = () => loadAndSwitchToView('dosage_calculator');
    if(returnToLandingViewBtn4) returnToLandingViewBtn4.onclick = () => loadAndSwitchToView('landing');
}
function displayDosageResult(drug, weight, age, renal, model, dosageHTML) { 
    loadAndSwitchToView('dosage_result').then(() => {
        if(sel('resultDosageDrugName')) sel('resultDosageDrugName').textContent = drug; 
        if(sel('resultDosageWeight')) sel('resultDosageWeight').textContent = weight;
        if(sel('resultDosageAge')) sel('resultDosageAge').textContent = age;
        if(sel('resultDosageRenal')) sel('resultDosageRenal').textContent = renal || "Not specified";
        if(sel('resultDosageModelUsed')) sel('resultDosageModelUsed').textContent = model; 
        if(sel('dosageDisplayArea')) sel('dosageDisplayArea').innerHTML = dosageHTML; 
    });
}

function initializeDrugQuizzerLogic() {
    const newQuizQuestionBtn = sel('newQuizQuestionBtn');
    const showQuizAnswerBtn = sel('showQuizAnswerBtn');
    const quizQuestionArea = sel('quizQuestionArea');
    const quizAnswerArea = sel('quizAnswerArea');
    const quizAnswerTitle = sel('quizAnswerTitle');
    const quizzerLoadingIndicator = sel('quizzerLoadingIndicator');
    const quizzerStatusMessage = sel('quizzerStatusMessage');
    const returnToLandingViewBtn5 = sel('returnToLandingViewBtn5');

    function updateQuizzerStatus(message, isError = false, duration = 4000) { 
        if (!quizzerStatusMessage) return; 
        quizzerStatusMessage.textContent = message; 
        quizzerStatusMessage.style.color = isError ? 'var(--danger-color)' : 'var(--success-color)'; 
        if (!isError && message && !message.toLowerCase().includes('error')) { 
            quizzerStatusMessage.style.color = 'var(--secondary-color)'; 
        } 
        if (message && duration > 0) { 
            setTimeout(() => { if (quizzerStatusMessage.textContent === message) quizzerStatusMessage.textContent = ''; }, duration); 
        } 
    }
    
    async function fetchNewQuizQuestionInternal() { // Renamed to avoid conflict if global fetchNewQuizQuestion is used
        if (!appApiKey) { updateQuizzerStatus('API Key is missing. Configure it at the top.', true); if(apiKeyInputGlobal) apiKeyInputGlobal.focus(); return; }
        updateQuizzerStatus(''); 
        if(quizzerLoadingIndicator) quizzerLoadingIndicator.hidden = false; 
        if(newQuizQuestionBtn) newQuizQuestionBtn.disabled = true; 
        if(showQuizAnswerBtn) showQuizAnswerBtn.disabled = true; 
        if(quizQuestionArea) quizQuestionArea.textContent = 'Fetching question...'; 
        if(quizAnswerArea) { quizAnswerArea.hidden = true; quizAnswerArea.textContent = ''; } 
        if(quizAnswerTitle) quizAnswerTitle.hidden = true; 
        currentQuizAnswer = '';
        const requestNonce = Date.now(); 
        const prompt = `You are a helpful assistant for creating pharmacy quiz questions. Nonce: ${requestNonce} Generate a single, concise, pharmacy-related quiz question and its corresponding answer. The question should be suitable for a pharmacist or pharmacy student. Avoid repeating questions if possible. Topics can include pharmacology, brand/generic names, calculations, clinical scenarios, law, or drug information. Provide the output STRICTLY in JSON format with two keys: "question" and "answer". Example: { "question": "What is the primary mechanism of action for metformin?", "answer": "Metformin primarily works by decreasing hepatic glucose production, decreasing intestinal absorption of glucose, and improving insulin sensitivity by increasing peripheral glucose uptake and utilization." } Another example: { "question": "A patient is prescribed Drug X 5mg BID. How many tablets will they need for a 30-day supply if Drug X is available as 5mg tablets?", "answer": "60 tablets (5mg twice a day = 2 tablets/day. 2 tablets/day * 30 days = 60 tablets)." }`;
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${appApiKey}` }, body: JSON.stringify({ model: "gpt-3.5-turbo", messages: [{ role: 'user', content: prompt }], temperature: 0.9, max_tokens: 250, response_format: { type: "json_object" } }) });
            const data = await response.json();
            if (response.ok && data.choices?.[0]?.message?.content) {
                try { 
                    const qaPair = JSON.parse(data.choices[0].message.content); 
                    if (qaPair.question && qaPair.answer) { 
                        if(quizQuestionArea) quizQuestionArea.textContent = qaPair.question; 
                        currentQuizAnswer = qaPair.answer; 
                        if(showQuizAnswerBtn) {showQuizAnswerBtn.disabled = false; showQuizAnswerBtn.textContent = "Show Answer";} 
                    } else { 
                        throw new Error("AI response did not contain 'question' or 'answer'."); 
                    }
                } catch (parseError) { 
                    console.error("Error parsing AI JSON response:", parseError, "Raw content:", data.choices[0].message.content); 
                    updateQuizzerStatus('Error processing AI response format. Retrying...', true, 5000); 
                    if(quizQuestionArea) quizQuestionArea.textContent = 'Could not load question. Try "New Question".'; 
                }
            } else { 
                const errorMsg = data.error ? `${data.error.message} (Code: ${data.error.code})` : 'Unknown API error.'; 
                updateQuizzerStatus(`Error: ${errorMsg}`, true); 
                if(quizQuestionArea) quizQuestionArea.textContent = 'Failed to fetch question.'; 
                if(data.error?.code==='invalid_api_key'||data.error?.type==='auth_error'){ updateApiKeyDisplayStatus('Invalid API Key.','error');appApiKey='';localStorage.removeItem(API_KEY_STORAGE_ITEM);if(apiKeyInputGlobal) apiKeyInputGlobal.value='';} 
            }
        } catch (error) { 
            console.error("Fetch Quiz Question failed:", error); 
            updateQuizzerStatus('Request failed. Check network.', true); 
            if(quizQuestionArea) quizQuestionArea.textContent = 'Network error.';
        } finally { 
            if(quizzerLoadingIndicator) quizzerLoadingIndicator.hidden = true; 
            if(newQuizQuestionBtn) newQuizQuestionBtn.disabled = false; 
        }
    }
    // Assign to the global scope if needed by landing page, or just keep internal
    window.fetchNewQuizQuestion = fetchNewQuizQuestionInternal;


    if(newQuizQuestionBtn) newQuizQuestionBtn.onclick = fetchNewQuizQuestionInternal;
    if(showQuizAnswerBtn) showQuizAnswerBtn.onclick = () => { 
        if (currentQuizAnswer) { 
            if(quizAnswerArea) quizAnswerArea.textContent = currentQuizAnswer; 
            if(quizAnswerArea) quizAnswerArea.hidden = false; 
            if(quizAnswerTitle) quizAnswerTitle.hidden = false; 
            showQuizAnswerBtn.disabled = true; 
            showQuizAnswerBtn.textContent = "Answer Shown"; 
        } else { 
            if(quizAnswerArea) quizAnswerArea.textContent = "No answer available for the current question."; 
            if(quizAnswerArea) quizAnswerArea.hidden = false; 
            if(quizAnswerTitle) quizAnswerTitle.hidden = false; 
        }
    };
    if(returnToLandingViewBtn5) returnToLandingViewBtn5.onclick = () => loadAndSwitchToView('landing');
}

function initializeAnticoagBridgingLogic() {
    const anticoagCurrentMedInput = sel('anticoagCurrentMedInput');
    const anticoagProcedureInput = sel('anticoagProcedureInput');
    const anticoagThromboRiskInput = sel('anticoagThromboRiskInput');
    const anticoagModelSelect = sel('anticoagModelSelect');
    const getBridgingInfoBtn = sel('getBridgingInfoBtn');
    const returnToLandingViewBtn6 = sel('returnToLandingViewBtn6');
    const anticoagBridgingStatusMessage = sel('anticoagBridgingStatusMessage');
    const anticoagBridgingLoadingIndicator = sel('anticoagBridgingLoadingIndicator');

    if(anticoagModelSelect) anticoagModelSelect.value = 'gpt-4o'; 

    function updateAnticoagBridgingStatus(message, isError = false, duration = 7000) { /* ... as defined before ... */ }
    
    if(getBridgingInfoBtn) getBridgingInfoBtn.onclick = async () => {
        const currentMed = anticoagCurrentMedInput.value; 
        const procedure = anticoagProcedureInput.value.trim();
        const thromboRisk = anticoagThromboRiskInput.value.trim(); 
        const selectedModel = anticoagModelSelect.value;

        if (!appApiKey) { updateAnticoagBridgingStatus('API Key is missing. Configure it at the top.', true); if(apiKeyInputGlobal) apiKeyInputGlobal.focus(); return; }
        if (!currentMed) { updateAnticoagBridgingStatus('Current Anticoagulant is required.', true); if(anticoagCurrentMedInput) anticoagCurrentMedInput.focus(); return; }
        if (!procedure) { updateAnticoagBridgingStatus('Planned Procedure is required.', true); if(anticoagProcedureInput) anticoagProcedureInput.focus(); return; }
        if (!thromboRisk) { updateAnticoagBridgingStatus('Thromboembolism Risk Factors are required for context.', true); if(anticoagThromboRiskInput) anticoagThromboRiskInput.focus(); return; }
        
        updateAnticoagBridgingStatus(''); 
        if(anticoagBridgingStatusMessage) anticoagBridgingStatusMessage.hidden = true; 
        if(anticoagBridgingLoadingIndicator) anticoagBridgingLoadingIndicator.hidden = false;
        getBridgingInfoBtn.disabled = true; 
        if(returnToLandingViewBtn6) returnToLandingViewBtn6.disabled = true;

        const prompt = `You are an AI assistant providing GENERAL INFORMATION on anticoagulation bridging strategies for EXPERIMENTAL AND EDUCATIONAL REVIEW BY HOSPITAL PHARMACISTS. This is NOT a substitute for specific clinical guidelines (e.g., ACCP/CHEST), institutional protocols, or individualized patient assessment by a qualified healthcare professional. Scenario: - Current Anticoagulant: ${currentMed} - Planned Procedure & Estimated Bleed Risk: ${procedure} - Patient-Specific Thromboembolism Risk Factors: ${thromboRisk}. Based on these factors and general anticoagulation guidelines, provide a structured explanation of typical bridging considerations. Your response MUST be valid HTML, suitable for direct rendering in a div. **CRITICAL: Do NOT include any markdown code block delimiters like \`\`\`html, \`\`\`json, or just \`\`\` at the beginning or end of your response.** Your entire response should start directly with the first HTML tag (e.g., \`<h3>\`) and end with the last HTML tag (e.g., \`</p>\`). Structure your response as follows: 1. Start with an \`<h3>Before Procedure</h3>\` heading. * Under this heading, use an unordered list (\`<ul>\`) for the steps. * Each step should be an \`<li>\` item. 2. Then, add an \`<h3>After Procedure</h3>\` heading. * Under this heading, use another unordered list (\`<ul>\`) for the steps. * Each step should be an \`<li>\` item. Within each \`<li>\` item, provide concrete, actionable steps or timing considerations a pharmacist would generally evaluate. Be concise. Examples of list item content: - When to stop the current anticoagulant (e.g., "<li><span class="highlight-action">Stop</span> <span class="result-highlight-drugname">Warfarin</span> <span class="highlight-timing">X days</span> before procedure, aiming for INR < <span class="result-highlight-dosage">Y</span>.</li>"). - If bridging with another agent (e.g., LMWH) is typically considered: - When to start the bridging agent. - The typical dose of the bridging agent. - When to stop the bridging agent. - When to restart anticoagulants post-procedure. Use the following HTML <span> tags for emphasis INSIDE the <li> elements where appropriate: - Specific actions like "Stop", "Start", "Administer", "Check INR": \`<span class="highlight-action">{action_verb}</span>\` - Drug names: \`<span class="result-highlight-drugname">{drug_name}</span>\` - Specific timings or days: \`<span class="highlight-timing">{timing_info}</span>\` - Dosage information or target lab values: \`<span class="result-highlight-dosage">{dosage_or_lab_value}</span>\` - Key risk factors mentioned or implied: \`<span class="highlight-risk-factor">{risk_factor_text}</span>\` - Important considerations: \`<span class="result-highlight-important-consideration">{consideration_text}</span>\`. Conclude with: \`<p><span class="result-highlight-disclaimer-ai">Reminder: This AI-generated information is for experimental/educational review. ALWAYS verify with current clinical guidelines, institutional protocols, and apply individualized patient assessment for any clinical decision.</span></p>\` If information is too vague, state that clearly. Do not invent protocols. Ensure well-formed HTML.`;
        try { 
            const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: {'Content-Type':'application/json','Authorization':`Bearer ${appApiKey}`}, body: JSON.stringify({model: selectedModel, messages: [{ role: 'user', content: prompt }], max_tokens: 1000 }) }); 
            const data = await response.json(); 
            if (response.ok && data.choices?.[0]?.message?.content) { 
                let bridgingInfoHTML = data.choices[0].message.content;
                bridgingInfoHTML = bridgingInfoHTML.replace(/^```(?:html|json)?\s*?\n/i, '').replace(/\n?\s*```$/, '').trim();
                displayAnticoagResult(currentMed, procedure, thromboRisk, `${selectedModel} (API: ${selectedModel})`, bridgingInfoHTML); 
            } else { 
                const errorMsg = data.error ? `${data.error.message} (Code: ${data.error.code})` : 'Unknown API error.'; 
                updateAnticoagBridgingStatus(`Error generating bridging info: ${errorMsg}`, true); 
                if(anticoagBridgingStatusMessage) anticoagBridgingStatusMessage.hidden = false; 
                if(data.error?.code==='invalid_api_key'||data.error?.type==='auth_error'){ updateApiKeyDisplayStatus('Invalid API Key.','error');appApiKey='';localStorage.removeItem(API_KEY_STORAGE_ITEM);if(apiKeyInputGlobal) apiKeyInputGlobal.value='';} 
            } 
        } catch (error) { 
            console.error("Anticoagulation Bridging Request failed:", error); 
            updateAnticoagBridgingStatus('Request failed. Check network or console.', true); 
            if(anticoagBridgingStatusMessage) anticoagBridgingStatusMessage.hidden = false; 
        } finally { 
            if(anticoagBridgingLoadingIndicator) anticoagBridgingLoadingIndicator.hidden = true; 
            getBridgingInfoBtn.disabled = false; 
            if(returnToLandingViewBtn6) returnToLandingViewBtn6.disabled = false; 
        } 
    };
    if(returnToLandingViewBtn6) returnToLandingViewBtn6.onclick = () => loadAndSwitchToView('landing');
}

function initializeAnticoagResultLogic() {
    const getNewBridgingInfoBtn = sel('getNewBridgingInfoBtn');
    const returnToLandingViewBtn7 = sel('returnToLandingViewBtn7');
    if(getNewBridgingInfoBtn) getNewBridgingInfoBtn.onclick = () => loadAndSwitchToView('anticoag_bridging');
    if(returnToLandingViewBtn7) returnToLandingViewBtn7.onclick = () => loadAndSwitchToView('landing');
}
function displayAnticoagResult(med, proc, risk, model, html) {
    loadAndSwitchToView('anticoag_result').then(() => {
        if(sel('resultAnticoagMed')) sel('resultAnticoagMed').textContent = med;
        if(sel('resultAnticoagProcedure')) sel('resultAnticoagProcedure').textContent = proc;
        if(sel('resultAnticoagThromboRisk')) sel('resultAnticoagThromboRisk').textContent = risk;
        if(sel('resultAnticoagModelUsed')) sel('resultAnticoagModelUsed').textContent = model;
        if(sel('anticoagResultDisplayArea')) sel('anticoagResultDisplayArea').innerHTML = html;
    });
}


// --- Initial Application Setup ---
document.addEventListener('DOMContentLoaded', () => {
    loadApiKeyFromStorage();
    loadAndSwitchToView('landing'); 
});