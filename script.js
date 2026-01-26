/* ===========================
   GLOBAL STATE + DATA STORE
=========================== */
let currentTab = "messages"; // messages, audios, medias, funnels
let currentMode = "add"; // add/edit
let currentEditingItem = null;
let itemToDelete = null;
let currentFunnelIndex = null;
let currentFunnelItemIndex = null;

// Data Store
let dataStore = {
  messages: [],
  audios: [],
  medias: [],
  funnels: []
};

const StorageManager = {
  async get(key) {
    try {
      // Tenta obter do IndexedDB primeiro
      let data = await DBManager.get(key);
      
      // Se não houver dados no IndexedDB, tenta migrar do chrome.storage.local
      if (!data) {
        data = await new Promise((resolve) => {
          chrome.storage.local.get([key], (result) => resolve(result[key]));
        });
        
        if (data) {
          console.log(`[Rabello Voice] Migrando dados de '${key}' para IndexedDB...`);
          await DBManager.set(key, data);
          // Opcional: chrome.storage.local.remove(key);
        }
      }
      return data;
    } catch (err) {
      console.error('[Rabello Voice] Erro no StorageManager.get:', err);
      return null;
    }
  },

  async set(key, value) {
    try {
      await DBManager.set(key, value);
      // IMPORTANTE: Salva também no chrome.storage.local para que o content script
      // possa acessar os dados (IndexedDB é separado por domínio)
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            console.log('[Rabello Voice] Dados sincronizados com chrome.storage');
            resolve();
          }
        });
      });
    } catch (err) {
      console.error('[Rabello Voice] Erro no StorageManager.set:', err);
      throw err;
    }
  },

  async clear() {
    try {
      await DBManager.clear();
      await new Promise((resolve) => chrome.storage.local.clear(resolve));
    } catch (err) {
      console.error('[Rabello Voice] Erro no StorageManager.clear:', err);
      throw err;
    }
  }
};

/* ===========================
   UTILITIES
=========================== */
async function saveData() {
  try {
    await StorageManager.set("dataStore", dataStore);
  } catch (e) {
    console.error("Falha ao salvar no IDB", e);
    alert("Erro ao salvar os dados. Verifique permissões ou espaço em disco.");
  }
}

const convertBase64 = (file) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.readAsDataURL(file);
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
  });

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return document.querySelectorAll(selector);
}

/* Modal Helpers (CSS .is-hidden) */
function show(el) {
  if (!el) return;
  el.classList.remove("is-hidden");
  el.style.display = "flex"; // fallback for older CSS
}

function hide(el) {
  if (!el) return;
  el.classList.add("is-hidden");
  el.style.display = "none"; // fallback for older CSS
}

/* Normalize Data URL (Import) */
function normalizeDataUrl(content, filename) {
  if (!content) return "";

  if (content.startsWith("data:")) return content;
  if (content.startsWith("http://") || content.startsWith("https://")) return content;

  let mime = "application/octet-stream";
  const ext = filename ? filename.split(".").pop().toLowerCase() : "";

  if (["jpg", "jpeg"].includes(ext)) mime = "image/jpeg";
  else if (ext === "png") mime = "image/png";
  else if (ext === "gif") mime = "image/gif";
  else if (ext === "webp") mime = "image/webp";
  else if (["mp3", "mpeg"].includes(ext)) mime = "audio/mpeg";
  else if (ext === "ogg") mime = "audio/ogg";
  else if (ext === "mp4") mime = "video/mp4";
  else if (ext === "pdf") mime = "application/pdf";

  return `data:${mime};base64,${content}`;
}

/* Detect Media Type */
function detectMediaType(src, filename = "") {
  const lowerName = filename.toLowerCase();

  // 1. Check data URI prefix first
  if (src.startsWith("data:")) {
    if (src.startsWith("data:image/")) return "image";
    if (src.startsWith("data:video/")) return "video";
    if (src.startsWith("data:application/pdf")) return "pdf";
  }

  // 2. Check Extension
  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(lowerName)) return "image";
  if (/\.(mp4|webm|ogg|mov)$/i.test(lowerName)) return "video";
  if (/\.pdf$/i.test(lowerName)) return "pdf";

  // 3. Last report: try to guess from raw base64 if needed?
  // (Assuming normalizeDataUrl handles the prefix adding)
  
  return "unknown";
}

/* ===========================
   DOM ELEMENTS (set in DOMContentLoaded)
=========================== */
let modal,
  deleteModal,
  modalTitle,
  modalBtn,
  titleInput,
  contentInput,
  audioFileInput,
  fieldEditor,
  fieldDropzone,
  fieldViewOnce,
  fieldAudioPlayer,
  fieldForwarded,
  fieldMediaPreview,
  mediaPreviewImg,
  mediaPreviewVideo,
  mediaPreviewIframe,
  mediaPreviewError,
  mediaFilename,
  btnPlayAudio,
  btnClosePlayer,
  audioFilename,
  waveformVisual,
  settingsModal,
  btnSettings,
  importDropzone,
  importFileInput,
  addFunnelItemModal,
  funnelItemTypeSelect,
  funnelStepConfig,
  funnelMessageSelect,
  editFunnelItemModal;

/* ===========================
   AUDIO PLAYER Logic
=========================== */
let currentAudioObj = null;
let isPlaying = false;

function setupAudioPlayer(audioSrc, filename) {
  stopAudio();
  currentAudioObj = new Audio(audioSrc);
  if (audioFilename) audioFilename.innerText = filename || "Audio_sem_nome.mp3";
  currentAudioObj.addEventListener("ended", stopAudio);
}

function stopAudio() {
  if (currentAudioObj) {
    currentAudioObj.pause();
    currentAudioObj.currentTime = 0;
  }
  isPlaying = false;
  updateControlsUI();
}

function togglePlay() {
  if (!currentAudioObj) return;

  if (isPlaying) {
    currentAudioObj.pause();
    isPlaying = false;
  } else {
    currentAudioObj.play().catch((e) => console.error("Error playing audio:", e));
    isPlaying = true;
  }
  updateControlsUI();
}

function updateControlsUI() {
  if (!btnPlayAudio) return;
  const icon = btnPlayAudio.querySelector("i");
  if (!icon) return;

  if (isPlaying) {
    icon.classList.remove("fa-play");
    icon.classList.add("fa-pause");
    waveformVisual?.classList.add("playing");
  } else {
    icon.classList.remove("fa-pause");
    icon.classList.add("fa-play");
    waveformVisual?.classList.remove("playing");
  }
}

/* ===========================
   RENDER LIST (MAIN)
=========================== */
function renderList() {
  const list = $(".message-list");
  if (!list) return;

  list.innerHTML = "";
  const items = dataStore[currentTab] || [];

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-text";
    empty.textContent = "Nenhum item encontrado.";
    list.appendChild(empty);
    return;
  }

  // Funnels
  if (currentTab === "funnels") {
    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "message-item";
      row.dataset.index = index;

      const name = document.createElement("span");
      name.className = "message-name";

      const icon = document.createElement("i");
      icon.className = "fa-solid fa-filter";
      icon.style.marginRight = "10px";
      icon.style.color = "#555";

      name.appendChild(icon);
      name.appendChild(document.createTextNode(" " + (item.title || "Sem Título")));

      const actions = document.createElement("div");
      actions.className = "item-actions";
      actions.innerHTML = `
        <button type="button" class="action-btn delete-btn" data-index="${index}" title="Deletar Funil">
          <i class="fa-solid fa-trash"></i>
        </button>
        <button type="button" class="action-btn view-btn" data-index="${index}" title="Editar Funil">
          <i class="fa-regular fa-pen-to-square"></i>
        </button>
      `;

      row.appendChild(name);
      row.appendChild(actions);
      list.appendChild(row);
    });
    return;
  }

  // Messages, Audios, Medias
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "message-item";
    row.dataset.index = index;

    const name = document.createElement("span");
    name.className = "message-name";

    let iconClass = null;
    if (currentTab === "audios") iconClass = "fa-solid fa-music";
    if (currentTab === "medias") iconClass = "fa-regular fa-image";

    if (iconClass) {
      const icon = document.createElement("i");
      icon.className = iconClass;
      icon.style.marginRight = "10px";
      icon.style.color = "#555";
      name.appendChild(icon);
      name.appendChild(document.createTextNode(" " + (item.title || "Sem Título")));
    } else {
      name.textContent = item.title || "Sem Título";
    }

    const actions = document.createElement("div");
    actions.className = "item-actions";
    actions.innerHTML = `
      <button type="button" class="action-btn delete-btn" data-index="${index}" title="Deletar Item">
        <i class="fa-solid fa-trash"></i>
      </button>
      <button type="button" class="action-btn view-btn" data-index="${index}" title="Visualizar/Editar">
        <i class="fa-regular fa-eye"></i>
      </button>
    `;

    row.appendChild(name);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

/* ===========================
   TAB SWITCHING
=========================== */
function switchTab(tab) {
  currentTab = tab;

  $all(".nav-item").forEach((el) => el.classList.remove("active"));
  $("#nav-" + tab)?.classList.add("active");

  const title = $("#page-title");
  const desc = $("#page-desc");

  const map = {
    messages: ["Mensagens", "Gerencie, visualize e aperfeiçoe suas mensagens com facilidade."],
    audios: ["Áudios", "Gerencie, visualize e aperfeiçoe seus áudios com facilidade."],
    medias: ["Mídias", "Gerencie, visualize e aperfeiçoe suas mídias com facilidade."],
    funnels: ["Funis", "Gerencie, visualize e aperfeiçoe seus funis com facilidade."]
  };

  if (title && desc && map[tab]) {
    title.innerText = map[tab][0];
    desc.innerText = map[tab][1];
  }

  $(".content-header")?.style && ( $(".content-header").style.display = "flex" );
  $(".message-list")?.style && ( $(".message-list").style.display = "flex" );
  $("#funnel-detail-view")?.style && ( $("#funnel-detail-view").style.display = "none" );

  currentFunnelIndex = null;
  renderList();
}

/* ===========================
   MODAL: OPEN/CLOSE + ACTION
=========================== */
function resetMediaPreview() {
  if (mediaPreviewImg) { mediaPreviewImg.style.display = "none"; mediaPreviewImg.src = ""; }
  if (mediaPreviewVideo) {
    mediaPreviewVideo.pause();
    mediaPreviewVideo.style.display = "none";
    mediaPreviewVideo.src = "";
  }
  if (mediaPreviewIframe) { mediaPreviewIframe.style.display = "none"; mediaPreviewIframe.src = ""; }
  if (mediaPreviewError) { mediaPreviewError.style.display = "none"; }
}

function openModal(mode, index = null) {
  currentMode = mode;
  currentEditingItem = index;

  stopAudio();
  show(modal);

  // Reset fields (use hide helper)
  hide(fieldEditor);
  hide(fieldDropzone);
  
  // Toggles Wrapper
  const togglesRow = document.querySelector('.toggles-row');
  togglesRow && (togglesRow.style.display = "flex"); // Default flex (no is-hidden class usually)

  // Individual Toggles
  hide(fieldViewOnce);
  hide(fieldForwarded);
  hide(fieldAudioPlayer);
  hide(fieldMediaPreview);

  resetMediaPreview();

  // Configure based on tab
  if (currentTab === "messages") {
    show(fieldEditor);
    show(fieldForwarded); // Use show() to remove is-hidden
    titleInput && (titleInput.placeholder = "Nome da Mensagem");
  }

  if (currentTab === "audios") {
    show(fieldViewOnce);
    titleInput && (titleInput.placeholder = "Nome do Áudio");

    if (mode === "add") {
      show(fieldDropzone);
      setupDropzone("audio");
    } else {
      show(fieldAudioPlayer);
    }
  }

  if (currentTab === "medias") {
    show(fieldViewOnce);
    titleInput && (titleInput.placeholder = "Nome da Mídia");
    show(fieldEditor); 

    if (mode === "add") {
      show(fieldDropzone);
      setupDropzone("media");
    } else {
      show(fieldMediaPreview);
    }
  }

  if (currentTab === "funnels") {
    titleInput && (titleInput.placeholder = "Nome do Funil");
    togglesRow && (togglesRow.style.display = "none");
    hide(fieldForwarded);
  }

  const typeName =
    currentTab === "messages" ? "Mensagem" :
    currentTab === "audios" ? "Áudio" :
    currentTab === "medias" ? "Mídia" : "Funil";

  if (mode === "add") {
    modalTitle && (modalTitle.innerText = `Adicionar ${typeName}`);
    modalBtn && (modalBtn.innerText = "Adicionar");
    titleInput && (titleInput.value = "");
    contentInput && (contentInput.value = "");
    audioFileInput && (audioFileInput.value = "");
    
    // Uncheck toggles
    document.getElementById('chk-view-once') && (document.getElementById('chk-view-once').checked = false);
    document.getElementById('chk-forwarded') && (document.getElementById('chk-forwarded').checked = false);

  } else {
    modalTitle && (modalTitle.innerText = `Detalhes da ${typeName.replace("Mídia", "Mídia")}`); // Ensure correct grammar if needed
    // "Detalhes do Mídia" was issue, fix dynamically or hardcode if simple
    if (typeName === "Mídia" || typeName === "Mensagem") {
         modalTitle && (modalTitle.innerText = `Detalhes da ${typeName}`);
    } else {
         modalTitle && (modalTitle.innerText = `Detalhes do ${typeName}`);
    }
    
    modalBtn && (modalBtn.innerText = "Salvar");

    const item = dataStore[currentTab][index];
    titleInput && (titleInput.value = item?.title || "");
    contentInput && (contentInput.value = item?.content || "");

    // Audio
    if (currentTab === "audios" && item?.audioSrc) {
      setupAudioPlayer(item.audioSrc, item.filename);
    }

    // Media preview
    if (currentTab === "medias") {
      if (mediaFilename) mediaFilename.innerText = item.filename || "Midia_sem_nome";

      const src = item.audioSrc || "";
      const fname = item.filename || "";
      const mediaType = detectMediaType(src, fname);

      if (mediaType === "image") {
        if (mediaPreviewImg) {
          mediaPreviewImg.src = src;
          show(mediaPreviewImg);
        }
      } else if (mediaType === "video") {
        if (mediaPreviewVideo) {
          mediaPreviewVideo.src = src;
          show(mediaPreviewVideo);
          mediaPreviewVideo.load();
        }
      } else if (mediaType === "pdf") {
        if (mediaPreviewIframe) {
          mediaPreviewIframe.src = src;
          show(mediaPreviewIframe);
        }
      } else {
        show(mediaPreviewError);
      }
    }
  }

  titleInput?.focus();
}

function closeModal() {
  hide(modal);
  stopAudio();
  resetMediaPreview();
}

async function handleModalAction() {
  try {
    const title = titleInput?.value.trim() || "";
    const content = contentInput?.value || "";

    if (!title) return alert("Por favor, digite um título.");

    if (currentMode === "add") {
      const hasFile = audioFileInput?.files?.length > 0;
      if (currentTab === "audios" && !hasFile) return alert("Selecione um arquivo de áudio.");
      if (currentTab === "medias" && !hasFile) return alert("Selecione um arquivo de mídia.");
    }

    const newItem = {
      title,
      content,
      date: new Date().toISOString()
    };

    if ((currentTab === "audios" || currentTab === "medias") && audioFileInput?.files?.length > 0) {
      const file = audioFileInput.files[0];
      newItem.audioSrc = await convertBase64(file);
      newItem.filename = file.name;
    } else if (currentMode === "edit" && currentEditingItem !== null) {
      const existing = dataStore[currentTab][currentEditingItem];
      if (existing?.audioSrc) {
        newItem.audioSrc = existing.audioSrc;
        newItem.filename = existing.filename;
      }
      if (currentTab === "funnels") newItem.items = existing.items || [];
    }

    if (currentMode === "add") {
      if (currentTab === "funnels") {
        dataStore.funnels.push({ title, items: [] });
        await saveData();
        renderList();
        closeModal();
        openFunnelDetail(dataStore.funnels.length - 1);
        return;
      }
      dataStore[currentTab].push(newItem);
    } else if (currentMode === "edit" && currentEditingItem !== null) {
      dataStore[currentTab][currentEditingItem] = newItem;
    }

    await saveData();
    renderList();
    closeModal();
  } catch (error) {
    alert("Erro ao salvar: " + error.message);
    console.error(error);
  }
}

/* ===========================
   DROPZONE SETUP
=========================== */
function setupDropzone(type) {
  if (!fieldDropzone) return;

  const p = fieldDropzone.querySelector("p");
  const hint = fieldDropzone.querySelector(".dropzone-hint");

  if (!p || !hint || !audioFileInput) return;

  if (type === "audio") {
    p.innerText = "Clique aqui ou arraste o novo Áudio a ser salvo";
    hint.innerText = "Formatos aceitos '.mp3' e '.ogg'";
    audioFileInput.accept = ".mp3, .ogg";
  } else {
    p.innerText = "Clique aqui ou arraste a nova Mídia a ser salva";
    hint.innerText = "Formatos aceitos '.jpg', '.gif', '.png', '.jpeg', '.pdf' e '.mp4'";
    audioFileInput.accept = ".jpg, .gif, .png, .jpeg, .pdf, .mp4";
  }

  p.style.color = "#ddd";
}

/* ===========================
   FUNNEL DETAILS
=========================== */
function openFunnelDetail(index) {
  currentFunnelIndex = index;
  const funnel = dataStore.funnels[index];
  if (!funnel) return;

  $(".content-header") && ($(".content-header").style.display = "none");
  $(".message-list") && ($(".message-list").style.display = "none");
  $("#funnel-detail-view") && ($("#funnel-detail-view").style.display = "block");

  $("#funnel-detail-title") && ($("#funnel-detail-title").innerText = `Funil: ${funnel.title || "Sem Título"}`);

  renderFunnelItems();
}

function closeFunnelDetail() {
  $(".content-header") && ($(".content-header").style.display = "flex");
  $(".message-list") && ($(".message-list").style.display = "flex");
  $("#funnel-detail-view") && ($("#funnel-detail-view").style.display = "none");

  currentFunnelIndex = null;
  renderList();
}

function renderFunnelItems() {
  const list = $("#funnel-items-list");
  if (!list) return;

  list.innerHTML = "";

  const funnel = dataStore.funnels[currentFunnelIndex];
  if (!funnel) return;

  const items = funnel.items || [];

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-text";
    empty.textContent = "Não existem itens adicionados neste funil!";
    list.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "funnel-item-row";
    row.dataset.index = index;

    let iconClass = "fa-comment";
    if (item.type === "audios") iconClass = "fa-music";
    if (item.type === "medias") iconClass = "fa-image";

    const drag = document.createElement("div");
    drag.className = "drag-handle";
    drag.innerHTML = `<i class="fa-solid fa-grip-vertical"></i>`;

    const icon = document.createElement("div");
    icon.className = "funnel-item-icon";
    icon.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;

    const name = document.createElement("div");
    name.className = "funnel-item-name";
    name.textContent = item.title || "Sem título";

    const meta = document.createElement("div");
    meta.className = "funnel-item-meta";

    const delay = document.createElement("span");
    delay.className = "delay-tag";
    delay.textContent = `Delay: ${item.delay || "0m 0s"}`;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "action-btn delete-funnel-item-btn";
    delBtn.dataset.index = index;
    delBtn.title = "Deletar";
    delBtn.innerHTML = `<i class="fa-solid fa-trash"></i>`;

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "action-btn view-funnel-item-btn";
    viewBtn.dataset.index = index;
    viewBtn.title = "Editar delay";
    viewBtn.innerHTML = `<i class="fa-regular fa-eye"></i>`;

    meta.appendChild(delay);
    meta.appendChild(delBtn);
    meta.appendChild(viewBtn);

    row.appendChild(drag);
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(meta);

    list.appendChild(row);
  });
}

/* ===========================
   FUNNEL ITEM MODALS
=========================== */
function openAddFunnelItemModal() {
  show(addFunnelItemModal);
  funnelItemTypeSelect && (funnelItemTypeSelect.value = "");
  funnelStepConfig && (funnelStepConfig.style.display = "none");
}

function closeAddFunnelItemModal() {
  hide(addFunnelItemModal);
}

function openEditFunnelItemModal(index) {
  currentFunnelItemIndex = index;
  const item = dataStore.funnels[currentFunnelIndex]?.items?.[index];
  if (!item) return;

  let min = 0, sec = 0;
  if (item.delay) {
    const parts = item.delay.split(" ");
    min = parseInt(parts[0]) || 0;
    sec = parseInt(parts[1]) || 0;
  }

  $("#edit-funnel-min") && ($("#edit-funnel-min").value = min);
  $("#edit-funnel-sec") && ($("#edit-funnel-sec").value = sec);

  show(editFunnelItemModal);
}

function closeEditFunnelItemModal() {
  hide(editFunnelItemModal);
  currentFunnelItemIndex = null;
}

async function handleSaveFunnelItem() {
  const min = $("#edit-funnel-min")?.value || 0;
  const sec = $("#edit-funnel-sec")?.value || 0;

  const funnel = dataStore.funnels[currentFunnelIndex];
  if (!funnel) return;

  funnel.items[currentFunnelItemIndex].delay = `${min}m ${sec}s`;

  await saveData();
  renderFunnelItems();
  closeEditFunnelItemModal();
}

async function handleAddFunnelItem() {
  const type = funnelItemTypeSelect?.value || "";
  const selectedIndex = funnelMessageSelect?.value;

  if (!type || selectedIndex === "" || selectedIndex === null) {
    alert("Selecione um tipo e um item.");
    return;
  }

  const original = dataStore[type]?.[selectedIndex];
  if (!original) return alert("Item não encontrado.");

  const min = $("#add-funnel-min")?.value || 0;
  const sec = $("#add-funnel-sec")?.value || 0;

  const newItem = {
    type,
    title: original.title,
    content: original.content,
    audioSrc: original.audioSrc,
    filename: original.filename || 'arquivo',
    delay: `${min}m ${sec}s`
  };

  const funnel = dataStore.funnels[currentFunnelIndex];
  if (!funnel.items) funnel.items = [];
  funnel.items.push(newItem);

  await saveData();
  renderFunnelItems();
  closeAddFunnelItemModal();
}

/* ===========================
   DELETE MODAL
=========================== */
function openDeleteModal(index) {
  itemToDelete = index;
  show(deleteModal);
}

function closeDeleteModal() {
  hide(deleteModal);
  itemToDelete = null;
}

async function confirmDelete() {
  if (itemToDelete === null) return;

  if (currentTab === "funnels" && currentFunnelIndex === itemToDelete) {
    closeFunnelDetail();
  }

  dataStore[currentTab].splice(itemToDelete, 1);
  await saveData();
  renderList();
  closeDeleteModal();
}

/* ===========================
   SETTINGS (IMPORT/EXPORT/CLEAR)
=========================== */
function openSettingsModal() {
  show(settingsModal);
}

function closeSettingsModal() {
  hide(settingsModal);
}

async function handleClearData() {
  if (!confirm("Tem certeza que deseja limpar todos os dados?")) return;
  try {
    await StorageManager.clear();
    location.reload();
  } catch (e) {
    alert("Erro ao limpar: " + e);
  }
}

function handleExportData() {
  const dataStr = JSON.stringify(dataStore, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_rabello_voice_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let selectedImportFile = null;

function handleFileSelect(file) {
  if (!file) return;
  if (file.type !== "application/json" && !file.name.endsWith(".json")) {
    alert("Selecione um arquivo JSON válido.");
    return;
  }

  selectedImportFile = file;

  const p = importDropzone?.querySelector("p");
  if (p) {
    p.innerText = `Arquivo selecionado: ${file.name}`;
    p.style.color = "#2ecc71";
  }
}

function handleImportData() {
  if (!selectedImportFile) return alert("Nenhum arquivo selecionado.");

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const result = JSON.parse(e.target.result);
      
      // 1. Build Contents Map (Relational)
      // Map ID -> Full Content Object
      const contentsMap = {};
      if (Array.isArray(result.contents)) {
        result.contents.forEach((c) => {
          if (c?.id) contentsMap[c.id] = c;
        });
      }

      // 2. Normalize Keys (Legacy Support + English + Portuguese)
      const normalized = {
        messages: result.messages || result.mensagens || [],
        audios: result.audios || result["áudios"] || [],
        medias: result.medias || result.midias || result["mídias"] || [],
        funnels: result.funnels || result.funis || []
      };

      const safeData = { ...dataStore };

      // Helper: Resolve Content from Map or Direct Item
      // Returns { directContent, directSrc }
      const resolveContent = (item, typeHint) => {
        let directContent = item.content || item.conteudo || item.texto || "";
        let directSrc = item.audioSrc || item.src || item.base64 || item.url || "";
        
        // Try relational lookup
        if (item.contentId && contentsMap[item.contentId]) {
          const entry = contentsMap[item.contentId];
          
          // If entry has 'content' field...
          if (entry.content) {
            // For messages, content is usually text (or stringified JSON)
            if (typeHint === "message" || typeHint === 'messages') {
               directContent = entry.content;
            } 
            // For media/audio, content is usually base64 src
            else {
               directSrc = entry.content;
            }
          }
          
          // Media caption might be in entry.caption
          if ((typeHint === "media" || typeHint === 'medias') && entry.caption) {
            directContent = entry.caption;
          }
        }
        return { directContent, directSrc };
      };

      // 3. Process Messages
      if (Array.isArray(normalized.messages)) {
        safeData.messages = normalized.messages.map((m) => {
          const { directContent } = resolveContent(m, "message");
          return {
            ...m,
            title: m.title || m.nome || m.name || "Sem Título",
            content: typeof directContent === 'object' ? JSON.stringify(directContent) : directContent,
            date: m.date || new Date().toISOString(),
            id: m.id || crypto.randomUUID()
          };
        });
      }

      // 4. Process Audios
      if (Array.isArray(normalized.audios)) {
        safeData.audios = normalized.audios.map((a) => {
          let { directSrc } = resolveContent(a, "audio");
          const fname = a.filename || a.nomeArquivo || "audio.mp3";
          
          // Normalize Src
          const ns = normalizeDataUrl(directSrc, fname);
          
          return {
            ...a,
            title: a.title || a.nome || a.name || "Sem Título",
            audioSrc: ns,
            filename: fname,
            date: a.date || new Date().toISOString(),
            id: a.id || crypto.randomUUID()
          };
        });
      }

      // 5. Process Medias
      if (Array.isArray(normalized.medias)) {
        safeData.medias = normalized.medias.map((m) => {
          let { directContent, directSrc } = resolveContent(m, "media");
          const fname = m.filename || m.nomeArquivo || "midia.jpg";
          
          const ns = normalizeDataUrl(directSrc, fname);

          return {
            ...m,
            title: m.title || m.nome || m.name || "Sem Título",
            audioSrc: ns, 
            content: typeof directContent === 'object' ? JSON.stringify(directContent) : directContent,
            filename: fname,
            date: m.date || new Date().toISOString(),
            id: m.id || crypto.randomUUID()
          };
        });
      }

      // 6. Process Funnels
      if (Array.isArray(normalized.funnels)) {
        safeData.funnels = normalized.funnels.map((f) => {
          const items = Array.isArray(f.items) ? f.items.map(item => {
             // Basic props
             let itemContent = item.content || "";
             let itemSrc = item.audioSrc || "";
             let itemTitle = item.title || "";
             let itemFilename = item.filename || "";
             let itemType = item.type || "unknown";

             // Resolve relational
             if(item.contentId && contentsMap[item.contentId]) {
                 const entry = contentsMap[item.contentId];
                 
                 // Smart Type Detection (handling singular/plural/content:type)
                 const isMsg = itemType.includes("message") || (entry.type && entry.type.includes("message"));
                 const isMedia = itemType.includes("media") || (entry.type && entry.type.includes("media"));
                 const isAudio = itemType.includes("audio") || (entry.type && entry.type.includes("audio"));

                 if(isMsg) {
                     itemContent = entry.content || itemContent;
                 }
                 else if (isMedia) {
                     itemSrc = entry.content || itemSrc;
                     itemContent = entry.caption || itemContent; // Caption for media
                 }
                 else if (isAudio) {
                     itemSrc = entry.content || itemSrc;
                 }
             }
            
            // Normalize Src if Media/Audio
            // Check type again or inference
            const isMediaOrAudio = itemType.includes("media") || itemType.includes("audio") || 
                                   (item.contentId && contentsMap[item.contentId] && 
                                   (contentsMap[item.contentId].type?.includes("media") || contentsMap[item.contentId].type?.includes("audio")));

            if (isMediaOrAudio) {
                // If it's audio, default mp3. If media, default jpg.
                // This fallback is crucial if filename is missing
                const defaultExt = itemType.includes("audio") ? "audio.mp3" : "media.jpg";
                itemFilename = item.filename || itemFilename || defaultExt;
                
                // Only normalize if we have src
                if (itemSrc) {
                    itemSrc = normalizeDataUrl(itemSrc, itemFilename);
                }
            }
            
            return {
                ...item,
                title: itemTitle,
                content: itemContent,
                audioSrc: itemSrc,
                filename: itemFilename
            };
          }) : [];

          return {
            ...f,
            title: f.title || f.nome || "Sem Título",
            items: items,
            id: f.id || crypto.randomUUID()
          };
        });
      }

      dataStore = safeData;
      await saveData();
      alert("Backup importado com sucesso!");
      location.reload();

    } catch (error) {
      alert("Erro crítico ao importar: " + error.message);
      console.error(error);
    }
  };

  reader.readAsText(selectedImportFile);
}

/* ===========================
   INIT APP (LOAD + MIGRATION)
=========================== */
async function initApp() {
  const localData = localStorage.getItem("mps_data");

  if (localData) {
    try {
      dataStore = JSON.parse(localData);
      await StorageManager.set("dataStore", dataStore);
      localStorage.removeItem("mps_data");
    } catch (e) {
      console.error("Erro na migração:", e);
    }
  } else {
    try {
      const stored = await StorageManager.get("dataStore");
      if (stored) {
        dataStore = stored;
        // IMPORTANTE: Força sincronização para chrome.storage.local
        // Isso garante que o content script consiga acessar os dados
        await new Promise((resolve) => {
          chrome.storage.local.set({ dataStore: dataStore }, () => {
            console.log('[Rabello Voice] Dados sincronizados ao iniciar Dashboard');
            resolve();
          });
        });
      }
    } catch (e) {
      console.error("Erro ao carregar do IDB:", e);
    }
  }

  renderList();
}

/* ===========================
   EVENT BINDINGS
=========================== */
function bindEvents() {
  // NAV
  $("#nav-messages")?.addEventListener("click", () => switchTab("messages"));
  $("#nav-audios")?.addEventListener("click", () => switchTab("audios"));
  $("#nav-medias")?.addEventListener("click", () => switchTab("medias"));
  $("#nav-funnels")?.addEventListener("click", () => switchTab("funnels"));

  // ADD BTN
  $(".btn-add")?.addEventListener("click", () => openModal("add"));

  // MAIN MODAL
  $("#btn-save-message-modal")?.addEventListener("click", handleModalAction);
  $("#btn-close-message-modal")?.addEventListener("click", closeModal);

  // DROPZONE
  fieldDropzone?.addEventListener("click", () => audioFileInput?.click());
  audioFileInput?.addEventListener("change", function () {
    if (this.files && this.files[0]) {
      const p = fieldDropzone?.querySelector("p");
      if (p) {
        p.innerText = `Arquivo selecionado: ${this.files[0].name}`;
        p.style.color = "#2ecc71";
      }
    }
  });

  // AUDIO PLAYER
  btnPlayAudio?.addEventListener("click", togglePlay);
  btnClosePlayer?.addEventListener("click", () => {
    stopAudio();
    fieldAudioPlayer && (fieldAudioPlayer.style.display = "none");
    fieldDropzone && (fieldDropzone.style.display = "flex");
  });

  // CLICK DELEGATION FOR LIST
  $(".message-list")?.addEventListener("click", (e) => {
    const actionBtn = e.target.closest(".action-btn");
    const row = e.target.closest(".message-item");
    if (!row) return;

    const index = parseInt(row.dataset.index);

    if (actionBtn) {
      if (actionBtn.classList.contains("delete-btn")) return openDeleteModal(index);
      if (actionBtn.classList.contains("view-btn")) return openModal("edit", index);
      return;
    }

    if (currentTab === "funnels") openFunnelDetail(index);
  });

  // FUNNEL DETAIL
  $("#btn-close-funnel-detail")?.addEventListener("click", closeFunnelDetail);

  document.addEventListener("click", (e) => {
    if (e.target.closest(".btn-add-funnel-item")) openAddFunnelItemModal();
  });

  // FUNNEL ITEMS list delegation
  $("#funnel-items-list")?.addEventListener("click", (e) => {
    const del = e.target.closest(".delete-funnel-item-btn");
    const view = e.target.closest(".view-funnel-item-btn");
    if (!del && !view) return;

    const idx = parseInt((del || view).dataset.index);

    if (del) {
      dataStore.funnels[currentFunnelIndex].items.splice(idx, 1);
      saveData();
      renderFunnelItems();
    } else {
      openEditFunnelItemModal(idx);
    }
  });

  // ADD FUNNEL ITEM MODAL
  $("#btn-close-add-funnel-modal")?.addEventListener("click", closeAddFunnelItemModal);
  $("#btn-confirm-add-funnel-item")?.addEventListener("click", handleAddFunnelItem);

  funnelItemTypeSelect?.addEventListener("change", function () {
    if (!this.value || !funnelStepConfig || !funnelMessageSelect) {
      funnelStepConfig && (funnelStepConfig.style.display = "none");
      return;
    }

    funnelStepConfig.style.display = "block";
    funnelMessageSelect.innerHTML = "";

    const def = document.createElement("option");
    def.value = "";
    def.disabled = true;
    def.selected = true;

    let items = [];
    if (this.value === "messages") { def.innerText = "Selecione a mensagem"; items = dataStore.messages; }
    if (this.value === "audios") { def.innerText = "Selecione o áudio"; items = dataStore.audios; }
    if (this.value === "medias") { def.innerText = "Selecione a mídia"; items = dataStore.medias; }

    funnelMessageSelect.appendChild(def);

    items.forEach((item, index) => {
      const opt = document.createElement("option");
      opt.value = index;
      opt.innerText = item.title;
      funnelMessageSelect.appendChild(opt);
    });
  });

  // EDIT FUNNEL ITEM MODAL
  $("#btn-close-edit-funnel-modal")?.addEventListener("click", closeEditFunnelItemModal);
  $("#btn-save-funnel-item")?.addEventListener("click", handleSaveFunnelItem);

  // DELETE MODAL
  $("#btn-cancel-delete")?.addEventListener("click", closeDeleteModal);
  $("#btn-confirm-delete")?.addEventListener("click", confirmDelete);

  // THEME
  $("#theme-toggle")?.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    const icon = $("#theme-toggle i");
    if (icon) {
      icon.className = document.body.classList.contains("light-theme")
        ? "fa-solid fa-sun"
        : "fa-regular fa-sun";
    }
  });

  // SETTINGS MODAL
  btnSettings?.addEventListener("click", openSettingsModal);
  $("#btn-close-settings-modal")?.addEventListener("click", closeSettingsModal);
  $("#btn-clear-data")?.addEventListener("click", handleClearData);

  // Import Button Support (both IDs for safety)
  $("#btn-trigger-import")?.addEventListener("click", handleImportData);
  $("#btn-import-data")?.addEventListener("click", handleImportData);

  $("#btn-export-data")?.addEventListener("click", handleExportData);

  importDropzone?.addEventListener("click", () => importFileInput?.click());
  importDropzone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    importDropzone.style.borderColor = "#2ecc71";
  });
  importDropzone?.addEventListener("dragleave", () => {
    importDropzone.style.borderColor = "#666";
  });
  importDropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    importDropzone.style.borderColor = "#666";
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
  });

  importFileInput?.addEventListener("change", (e) => {
    if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
  });

  // CLOSE MODALS ON OUTSIDE CLICK
  window.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
    if (e.target === deleteModal) closeDeleteModal();
    if (e.target === settingsModal) closeSettingsModal();
    if (e.target === addFunnelItemModal) closeAddFunnelItemModal();
    if (e.target === editFunnelItemModal) closeEditFunnelItemModal();
  });
}

/* ===========================
   BOOTSTRAP
=========================== */
document.addEventListener("DOMContentLoaded", async () => {
  // Map DOM elements safely
  modal = $("#addMessageModal");
  deleteModal = $("#deleteModal");
  modalTitle = $("#addMessageModal .modal-header h3");
  modalBtn = $("#btn-save-message-modal");
  titleInput = $("#message-title-input");

  fieldEditor = $("#field-editor");
  fieldDropzone = $("#field-dropzone");
  fieldViewOnce = $("#field-view-once");
  fieldAudioPlayer = $("#field-audio-player");
  fieldForwarded = $("#field-forwarded");
  contentInput = $(".editor-textarea");
  audioFileInput = $("#audio-file-input");

  // Media preview
  fieldMediaPreview = $("#field-media-preview");
  mediaPreviewImg = $(".media-preview-img");
  mediaPreviewVideo = $(".media-preview-video");
  mediaPreviewIframe = $(".media-preview-iframe");
  mediaPreviewError = $(".media-preview-error");
  mediaFilename = $(".media-filename");

  // Audio player
  btnPlayAudio = $(".btn-play-audio");
  btnClosePlayer = $(".btn-close-player");
  audioFilename = $(".audio-filename");
  waveformVisual = $(".waveform-visual");

  // Settings
  settingsModal = $("#settingsModal");
  btnSettings = $("#btn-settings");
  importDropzone = $("#import-dropzone");
  importFileInput = $("#import-file-input");

  // Funnel modals
  addFunnelItemModal = $("#addFunnelItemModal");
  funnelItemTypeSelect = $("#funnel-item-type");
  funnelStepConfig = $("#funnel-step-config");
  funnelMessageSelect = $("#funnel-message-select");

  editFunnelItemModal = $("#editFunnelItemModal");

  // Make all modals hidden initially if using is-hidden
  hide(modal);
  hide(deleteModal);
  hide(settingsModal);
  hide(addFunnelItemModal);
  hide(editFunnelItemModal);

  bindEvents();
  await initApp();
});
