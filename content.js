console.log("[Rabello Voice] 🚀 Content script carregado.");
console.log("[Rabello Voice] DEBUG: Versão 2.40.6 - Auto-diagnóstico");

// Configuração
const BAR_ID = "rabello-voice-bar";
const DEBUG_INDICATOR_ID = "rabello-voice-debug";
const STORAGE_KEY = "dataStore";
const DEBOUNCE_DELAY = 500; // ms

// ====== MODO DEBUG VISUAL ======
// Ativa indicador visual no canto da tela para mostrar status
const DEBUG_MODE = false; // Desativado para produção

// ====== DADOS DE DEMONSTRAÇÃO ======
// Se não houver dados no cache, usa estes para testar a injeção
const DEMO_DATA = {
  messages: [
    { title: "Olá! 👋", content: "Olá! gostaria de saber mais informações.", type: "messages" },
    { title: "Obrigado", content: "Muito obrigado pelo retorno!", type: "messages" }
  ],
  audios: [],
  medias: [],
  funnels: [
    { title: "Boas-vindas", type: "funnels", items: [] }
  ]
};

/**
 * Cria/atualiza indicador visual de debug no canto da tela
 */
function updateDebugIndicator(status, color = "#00a884") {
  // EXCEÇÃO: Mostra erros críticos mesmo com DEBUG_MODE = false
  const isError = status.includes("❌") || status.includes("Erro") || color === "#ff5252";
  if (!DEBUG_MODE && !isError) return;
  
  let indicator = document.getElementById(DEBUG_INDICATOR_ID);
  
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = DEBUG_INDICATOR_ID;
    indicator.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      background: ${color};
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-family: system-ui, sans-serif;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: all 0.3s ease;
      cursor: pointer;
      max-width: 300px;
    `;
    indicator.onclick = () => indicator.remove();
    document.body.appendChild(indicator);
  }
  
  indicator.style.background = color;
  indicator.textContent = "🔧 RV: " + status;
  
  // Remove após 10 segundos
  setTimeout(() => indicator?.remove(), 10000);
}

// Estado global para controle de debounce
let debounceTimer = null;

// ========== SELETORES RESILIENTES COM CACHE ==========
// Sistema de fallback com múltiplos seletores e cache inteligente

// Cache de seletores (para performance)
let cachedInputBox = null;
let cachedFooter = null;
let currentChatId = null;

/**
 * Obtém ID único do chat atual para invalidação de cache
 */
function getCurrentChatId() {
  // Pega o header do chat que contém info da conversa
  const chatHeader = document.querySelector(
    'header[data-testid="conversation-header"]',
  );
  if (!chatHeader) return null;

  // Usa atributos únicos ou texto como ID
  const titleElement = chatHeader.querySelector(
    '[data-testid="conversation-info-header-chat-title"]',
  );
  return titleElement ? titleElement.textContent : null;
}

/**
 * Encontra a caixa de input do WhatsApp APENAS dentro do chat ativo (#main)
 * CORRIGIDO: Escopo restrito para evitar "confundir" com a barra de pesquisa da sidebar
 */
function findInputBox() {
  // Verifica invalidação de cache (mudança de chat)
  const chatId = getCurrentChatId();
  if (chatId !== currentChatId) {
    console.log("[Rabello Voice] Chat mudou, invalidando cache de seletores");
    cachedInputBox = null;
    cachedFooter = null;
    currentChatId = chatId;
  }

  // Retorna cache se válido
  if (cachedInputBox && document.body.contains(cachedInputBox)) {
    return cachedInputBox;
  }

  // CRÍTICO: Restringe a busca ao container principal (#main) para evitar a sidebar
  const mainChat = document.querySelector("#main");
  if (!mainChat) {
    // Isso é NORMAL quando nenhum chat está aberto - não é um erro
    console.log("[Rabello Voice] Aguardando abertura de um chat...");
    return null;
  }

  // === SELETORES ESCOPADOS PARA #main (Evita sidebar) ===
  const selectors = [
    // 1. PRIORIDADE MÁXIMA: Atributos específicos dentro de #main
    '#main div[role="textbox"][contenteditable="true"][data-tab="10"]',
    '#main div[role="textbox"][contenteditable="true"][data-tab]',
    '#main div[role="textbox"][contenteditable="true"]',
    '#main [data-testid="conversation-compose-box-input"]',
    '#main [data-lexical-editor="true"]',

    // 2. Atributos aria (multilíngue e estáveis) dentro de #main
    '#main div[aria-placeholder*="Type a message"][contenteditable="true"]',
    '#main div[aria-placeholder*="Digite uma mensagem"][contenteditable="true"]',
    '#main div[aria-placeholder*="Escreva uma mensagem"][contenteditable="true"]',
    '#main div[contenteditable="true"][aria-label*="Type a message"]',
    '#main div[contenteditable="true"][aria-label*="mensagem"]',

    // 3. Novo WhatsApp Web (Lexical Editor) dentro de #main
    '#main div[contenteditable="true"][data-lexical-editor="true"]',
    '#main div.lexical-rich-text-input[contenteditable="true"]',

    // 4. Contexto estrutural (footer dentro de #main)
    '#main footer div[contenteditable="true"]',
    '#main footer [contenteditable="true"]',

    // 5. Fallback genérico (sempre dentro de #main)
    '#main div[contenteditable="true"].selectable-text',
    '#main div.copyable-text[contenteditable="true"]',
    '#main [contenteditable="true"]',
  ];

  // Tenta cada seletor
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i];
    try {
      const element = document.querySelector(selector);
      if (element && element.isContentEditable) {
        console.log(
          `[Rabello Voice] ✓ Input encontrado via seletor #${i + 1}: ${selector}`,
        );
        // CACHE o resultado
        cachedInputBox = element;
        return element;
      }
    } catch (e) {
      // Seletor inválido, continua
      continue;
    }
  }

  // DEBUG: Lista TODOS os elementos contenteditable para diagnóstico
  const allEditables = document.querySelectorAll('[contenteditable="true"]');
  if (allEditables.length > 0) {
    console.warn(
      `[Rabello Voice] ⚠ Encontrados ${allEditables.length} elemento(s) contenteditable, mas nenhum corresponde aos seletores conhecidos.`,
    );
    console.log(
      "[Rabello Voice] DEBUG - Elementos encontrados:",
      Array.from(allEditables).map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        ariaLabel: el.getAttribute("aria-label"),
        ariaPlaceholder: el.getAttribute("aria-placeholder"),
        classes: el.className,
        dataTab: el.getAttribute("data-tab"),
      })),
    );
  } else {
    console.warn(
      "[Rabello Voice] ⚠ Nenhum elemento contenteditable encontrado. Aguarde o WhatsApp carregar ou abra uma conversa.",
    );
  }

  return null;
}

/**
 * Encontra o container onde a barra será injetada
 * ATUALIZADO: WhatsApp Web não usa <footer>, usa divs com classes dinâmicas
 * Procura o container pai do input que contém toda a área de composição
 */
function findTargetContainer(inputBox) {
  if (!inputBox) return null;

  // Retorna cache se válido
  if (cachedFooter && document.body.contains(cachedFooter)) {
    return cachedFooter;
  }

  // Estratégia 1: Procura o container pai com tabindex="-1" que envolve toda a área de input
  // Este é o container principal da área de composição no WhatsApp Web atual
  let container = inputBox.closest('div[tabindex="-1"]');
  
  if (container) {
    console.log("[Rabello Voice] ✓ Container encontrado via tabindex");
    cachedFooter = container;
    return container;
  }
  
  // Estratégia 2: Procura o container que tem a classe lexical-rich-text-input
  const lexicalContainer = inputBox.closest('.lexical-rich-text-input');
  if (lexicalContainer && lexicalContainer.parentElement) {
    container = lexicalContainer.parentElement.closest('div[tabindex="-1"]');
    if (container) {
      console.log("[Rabello Voice] ✓ Container encontrado via lexical parent");
      cachedFooter = container;
      return container;
    }
  }

  // Estratégia 3: Fallback - sobe 5 níveis até encontrar um container adequado
  container = inputBox;
  for (let i = 0; i < 6; i++) {
    container = container.parentElement;
    if (!container) break;
    
    // Procura um container que tenha largura 100% (indica que é o container principal)
    const style = window.getComputedStyle(container);
    if (container.offsetWidth > 500 && container.children.length > 1) {
      console.log("[Rabello Voice] ✓ Container encontrado via parent traversal");
      cachedFooter = container;
      return container;
    }
  }
  
  // Estratégia 4: Fallback antigo - procura footer (para versões antigas do WA)
  let footer = inputBox.closest("footer");
  if (!footer) {
    footer = document.querySelector("#main footer") ||
             document.querySelector('[data-testid="composer-footer"]') ||
             document.querySelector("footer");
  }
  
  if (footer) {
    console.log("[Rabello Voice] ✓ Container encontrado via footer (legacy)");
    cachedFooter = footer;
    return footer;
  }

  console.warn("[Rabello Voice] ⚠ Nenhum container de injeção encontrado");
  return null;
}

/**
 * Encontra o botão de envio com múltiplos seletores
 */
function findSendButton() {
  const selectors = [
    // 1. Baseado no ícone (mais comum)
    'span[data-icon="send"]',
    'button span[data-icon="send"]',
    '[data-testid="compose-btn-send"]',

    // 2. Baseado em aria-label
    'button[aria-label*="Enviar"]',
    'button[aria-label*="Send"]',

    // 3. Estrutura conhecida
    "footer button[aria-label]",
    "footer span[data-icon] + button",

    // 4. Fallback por posição (último botão no footer)
    "footer button:last-of-type",
  ];

  for (const selector of selectors) {
    try {
      const icon = document.querySelector(selector);
      if (icon) {
        // Tenta achar o botão pai se for um ícone
        const button = icon.closest("button") || icon;
        if (button && button.tagName === "BUTTON") {
          console.log(
            `[Rabello Voice] Botão de envio encontrado via: ${selector}`,
          );
          return button;
        }
      }
    } catch (e) {
      continue;
    }
  }

  console.warn("[Rabello Voice] Botão de envio não encontrado.");
  return null;
}

// ========== CACHE LOCAL ==========
// Cache em memória dos dados do Dashboard para evitar leituras repetidas do storage
let cachedData = null;
let isCacheReady = false;

// Carrega dados do chrome.storage.local (compartilhado entre todos contextos da extensão)
// NOTA: IndexedDB NÃO funciona no content script pois roda no domínio web.whatsapp.com
async function loadCacheFromStorage() {
  try {
    console.log("[Rabello Voice] Carregando dados do chrome.storage.local...");
    
    // Usa APENAS chrome.storage.local que é compartilhado entre extension e content script
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    cachedData = result[STORAGE_KEY] || null;
    
    if (cachedData) {
      const itemCount = (cachedData.messages?.length || 0) + 
                       (cachedData.audios?.length || 0) + 
                       (cachedData.medias?.length || 0) + 
                       (cachedData.funnels?.length || 0);
      console.log(`[Rabello Voice] ✓ Cache carregado: ${itemCount} itens`);
    } else {
      console.log("[Rabello Voice] ⚠️ Nenhum dado encontrado no storage");
    }
    
    isCacheReady = true;
    return cachedData;
  } catch (err) {
    console.error("[Rabello Voice] Erro ao carregar cache:", err);
    isCacheReady = true;
    return null;
  }
}

// Listener para mudanças no storage - atua como sinalizador para recarregar do IndexedDB
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  // Se o storage local mudar ou o sinalizador de atualização for disparado
  if (
    areaName === "local" &&
    (changes[STORAGE_KEY] || changes[STORAGE_KEY + "_updated"])
  ) {
    console.log(
      "[Rabello Voice] Sinal de atualização recebido do Dashboard!",
    );
    
    // CORREÇÃO CRÍTICA: Usa o valor enviado pelo storage, não tenta ler do IndexedDB (que é vazio neste contexto)
    if (changes[STORAGE_KEY] && changes[STORAGE_KEY].newValue) {
        cachedData = changes[STORAGE_KEY].newValue;
        console.log("[Rabello Voice] Cache atualizado via evento (Hot Update):", cachedData);
    } else {
        // Fallback: se for só um sinalizador, tenta ler do storage local novamente
        console.log("[Rabello Voice] Relendo chrome.storage.local...");
        const result = await chrome.storage.local.get([STORAGE_KEY]);
        cachedData = result[STORAGE_KEY];
    }

    // Re-injeta a barra com os novos dados
    removeBar();
    debouncedInject();
  }
});

// ========== FÁBRICA DE UI (FACTORY PATTERN) ==========

/**
 * Retorna o SVG apropriado para cada tipo de item
 * @param {string} type - Tipo do item (message, audio, media, funnel)
 * @returns {SVGElement} Elemento SVG do ícone
 */
function createIconSVG(type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

  switch (type) {
    case "messages":
      path.setAttribute(
        "d",
        "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
      );
      break;
    case "audios":
      path.setAttribute(
        "d",
        "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z",
      );
      const path2 = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path2.setAttribute("d", "M19 10v2a7 7 0 0 1-14 0v-2");
      svg.appendChild(path2);
      break;
    case "medias":
      path.setAttribute(
        "d",
        "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h18a2 2 0 0 1 2 2z",
      );
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", "8.5");
      circle.setAttribute("cy", "8.5");
      circle.setAttribute("r", "1.5");
      svg.appendChild(circle);
      const poly = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polyline",
      );
      poly.setAttribute("points", "21 15 16 10 5 21");
      svg.appendChild(poly);
      break;
    case "funnels":
      path.setAttribute("d", "M22 3H2l8 9.46V19l4 2v-8.54L22 3z");
      break;
    default:
      path.setAttribute(
        "d",
        "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z",
      );
  }

  svg.appendChild(path);
  return svg;
}

/**
 * Cria o elemento no estilo "Split Button" (Texto | Seta)
 */
function createShortcutElement(item) {
  const chip = document.createElement("div");
  chip.className = "rv-shortcut-item";
  chip.setAttribute("data-type", item.type);
  // Otimização para busca rápida (normalizado: minúsculo + sem acentos)
  const normalizedTitle = (item.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  chip.setAttribute("data-search", normalizedTitle);

  const mainPart = document.createElement("div");
  mainPart.className = "rv-shortcut-main";

  const iconSpan = document.createElement("span");
  iconSpan.className = "rv-shortcut-icon";
  iconSpan.appendChild(createIconSVG(item.type));

  const textSpan = document.createElement("span");
  textSpan.className = "rv-shortcut-text";
  textSpan.textContent = item.title || "Sem título";

  mainPart.appendChild(iconSpan);
  mainPart.appendChild(textSpan);

  const expandSpan = document.createElement("div");
  expandSpan.className = "rv-shortcut-expand";
  const arrowSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  arrowSvg.setAttribute("viewBox", "0 0 24 24");
  arrowSvg.setAttribute("fill", "none");
  arrowSvg.setAttribute("stroke", "currentColor");
  arrowSvg.setAttribute("stroke-width", "2.5");
  arrowSvg.setAttribute("stroke-linecap", "round");
  arrowSvg.setAttribute("stroke-linejoin", "round");
  
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "9 18 15 12 9 6");
  
  arrowSvg.appendChild(polyline);
  expandSpan.appendChild(arrowSvg);

  chip.appendChild(mainPart);
  chip.appendChild(expandSpan);

  chip.addEventListener("click", (e) => {
    e.preventDefault();
    handleItemClick(item);
  });

  return chip;
}

// Função principal de injeção OTIMIZADA (Agora usa Factory + seletores resilientes!)
async function injectBar() {
  console.log("[Rabello Voice] DEBUG: injectBar() chamada");
  updateDebugIndicator("Iniciando injeção...", "#2196F3");
  
  // 1. Verifica se a barra JÁ existe no DOM (rápido)
  if (document.getElementById(BAR_ID)) {
    console.log("[Rabello Voice] DEBUG: Barra já existe, pulando");
    return;
  }

  // 2. Usa sistema de seletores resilientes
  const inputBox = findInputBox();
  if (!inputBox) {
    console.log("[Rabello Voice] DEBUG: Input box NÃO encontrado");
    updateDebugIndicator("❌ Input não encontrado - Abra um chat", "#ff5252");
    return;
  }
  console.log("[Rabello Voice] DEBUG: Input box encontrado:", inputBox);
  updateDebugIndicator("✓ Input encontrado", "#00a884");

  // 3. Encontra o container usando estratégias múltiplas
  const targetContainer = findTargetContainer(inputBox);
  if (!targetContainer) {
    console.log("[Rabello Voice] DEBUG: Container NÃO encontrado");
    updateDebugIndicator("❌ Footer não encontrado", "#ff5252");
    return;
  }
  console.log("[Rabello Voice] DEBUG: Container (footer) encontrado:", targetContainer);

  // 4. Usa dados do CACHE (sem I/O de storage!)
  // Aguarda o cache estar pronto se ainda estiver carregando
  if (!isCacheReady) {
    console.log("[Rabello Voice] DEBUG: Cache não pronto, carregando...");
    await loadCacheFromStorage();
  }

  console.log("[Rabello Voice] DEBUG: cachedData =", cachedData);
  
  // Se não há dados no cache, não mostra a barra
  if (!cachedData) {
    console.log("[Rabello Voice] ⚠️ Sem dados no Dashboard - barra não será exibida");
    return;
  }

  // Prepara lista unificada de itens do Dashboard
  const allItems = [
    ...(cachedData.funnels || []).map((i) => ({ ...i, type: "funnels" })),
    ...(cachedData.messages || []).map((i) => ({ ...i, type: "messages" })),
    ...(cachedData.audios || []).map((i) => ({ ...i, type: "audios" })),
    ...(cachedData.medias || []).map((i) => ({ ...i, type: "medias" })),
  ];

  console.log("[Rabello Voice] DEBUG: Total de itens do Dashboard:", allItems.length);
  
  if (allItems.length === 0) {
    console.log("[Rabello Voice] ⚠️ Dashboard vazio - adicione itens no painel de controle");
    return;
  }

  // 5. Renderização (Criar Elementos usando Factory Pattern)
  const bar = document.createElement("div");
  bar.id = BAR_ID;

  allItems.forEach((item) => {
    bar.appendChild(createShortcutElement(item));
  });

  // 6. Inserção Segura no DOM - Focada no #main para não quebrar o layout
  if (document.getElementById(BAR_ID)) return;

  try {
    const mainContainer = document.querySelector('#main');
    
    if (mainContainer) {
      // Adiciona estilo de ordem para garantir que fique no final visualmente
      bar.style.order = "9999";
      
      // Insere como filho do #main (padrão flexbox seguro)
      mainContainer.appendChild(bar);
      console.log("[Rabello Voice] ✓ Barra inserida no final do #main (Safe Mode)");
      updateDebugIndicator(`✅ ${allItems.length} atalhos`, "#00a884");
    } else {
      // Fallback extremo
      if (targetContainer && targetContainer.parentNode) {
        targetContainer.parentNode.appendChild(bar);
      }
    }
  } catch (e) {
    console.error("[Rabello Voice] Erro ao inserir barra:", e);
    updateDebugIndicator("❌ Erro na inserção", "#ff5252");
  }

  // ===== SCROLL HORIZONTAL COM MOUSE WHEEL =====
  // Permite que o usuário role horizontalmente usando a bolinha do mouse
  bar.addEventListener(
    "wheel",
    (e) => {
      // Se tem scroll horizontal disponível
      if (bar.scrollWidth > bar.clientWidth) {
        e.preventDefault(); // Previne scroll vertical da página

        // Converte scroll vertical em horizontal
        // deltaY positivo = scrolling down = scroll para direita
        // deltaY negativo = scrolling up = scroll para esquerda
        // Scroll suave para melhor experiência
        bar.scrollBy({
            left: e.deltaY,
            behavior: 'smooth'
        });
      }
    },
    { passive: false },
  ); // passive: false permite preventDefault()

  console.log(
    `[Rabello Voice] ✅ Barra injetada com ${allItems.length} atalho(s)`,
  );
}

// Lógica de clique (Agora usa Queue Manager!)
async function handleItemClick(item) {
  if (item.type === "messages") {
    insertTextAndSend(item.content);
  } else if (item.type === "funnels") {
    if (item.items && item.items.length > 0) {
      // Usa Queue Manager robusto
      await processFunnelQueue(item.items);
    } else {
      console.warn("[Rabello Voice] Funil vazio - nenhum item para processar");
    }
  } else if (item.type === "medias" || item.type === "audios") {
    if (item.audioSrc) {
      await sendMedia(item.audioSrc, item.filename || "arquivo");
    } else {
      console.warn("[Rabello Voice] Item sem conteúdo de mídia");
    }
  }
}

// Função auxiliar para remover a barra (útil para re-renderização)
function removeBar() {
  const existingBar = document.getElementById(BAR_ID);
  if (existingBar) {
    existingBar.remove();
  }
}

// Inserção de Texto (CORRIGIDO: ClipboardEvent com DataTransfer adequado)
async function insertTextAndSend(text) {
  if (!text) return;

  // Usa função resiliente para encontrar o input
  const inputBox = findInputBox();
  if (!inputBox) {
    console.error(
      "[Rabello Voice] Não foi possível enviar: input box não encontrado.",
    );
    return;
  }

  // Foco necessário
  inputBox.focus();

  // Estratégia CORRIGIDA: Clipboard API com DataTransfer adequado
  try {
    // Cria DataTransfer com o texto
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", text);

    // Cria evento de paste com clipboardData correto
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    // Dispara o evento no inputBox para React detectar
    inputBox.dispatchEvent(pasteEvent);

    console.log("[Rabello Voice] ✓ Texto inserido via ClipboardEvent");
  } catch (clipboardError) {
    console.warn(
      "[Rabello Voice] ClipboardEvent falhou, usando fallback:",
      clipboardError,
    );

    // Fallback 1: Manipulação direta do DOM + InputEvent
    try {
      // Limpa input primeiro
      inputBox.textContent = "";

      // Insere o texto
      const textNode = document.createTextNode(text);
      inputBox.appendChild(textNode);

      // IMPORTANTE: Dispara eventos com bubbles: true para React detectar
      inputBox.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        }),
      );

      // Dispara também 'change' para garantir
      inputBox.dispatchEvent(new Event("change", { bubbles: true }));

      console.log("[Rabello Voice] ✓ Texto inserido via DOM + InputEvent");
    } catch (domError) {
      console.warn(
        "[Rabello Voice] DOM manipulation falhou, usando execCommand:",
        domError,
      );

      // Fallback 2: execCommand (legado, mas ainda funciona)
      document.execCommand("insertText", false, text);
      inputBox.dispatchEvent(new Event("input", { bubbles: true }));

      console.log(
        "[Rabello Voice] ⚠ Texto inserido via execCommand (depreciado)",
      );
    }
  }

  // Clica no botão enviar após delay MAIOR para garantir que o React processou o input
  setTimeout(() => {
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      console.log("[Rabello Voice] ✓ Botão de envio clicado");
    } else {
      console.warn(
        "[Rabello Voice] Botão de envio não encontrado. Mensagem não enviada.",
      );
    }
  }, 300); // Aumentado para 300ms (anteriormente 150ms) para dar tempo ao React processar
}

// ==========================================================
// QUEUE MANAGER PARA FUNIS (Robusto com Confirmação)
// ==========================================================

/**
 * Converte string de delay "Xm Ys" para milissegundos
 * @param {string} delayStr - Formato: "5m 30s", "0m 10s", etc
 * @returns {number} Delay em milissegundos
 */
function parseDelay(delayStr) {
  if (!delayStr) return 0;

  const match = delayStr.match(/(\d+)m\s+(\d+)s/);
  if (!match) {
    console.warn(`[Rabello Voice] Formato de delay inválido: ${delayStr}`);
    return 0;
  }

  const minutes = parseInt(match[1]) || 0;
  const seconds = parseInt(match[2]) || 0;
  const totalMs = (minutes * 60 + seconds) * 1000;

  return totalMs;
}

/**
 * Aguarda confirmação de que a mensagem foi enviada observando o DOM
 * @param {number} timeout - Timeout máximo em ms (default: 15s)
 * @returns {Promise<boolean>} True se confirmou, False se timeout
 */
function waitForMessageSent(timeout = 15000) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const checkInterval = setInterval(() => {
      const inputBox = findInputBox();

      // Estratégia 1: Input está vazio (WhatsApp limpa após enviar)
      // ADICIONAL: Verifica se o botão de microfone voltou (confirmação visual de envio)
      const micIcon = document.querySelector('span[data-icon="mic"]') || 
                      document.querySelector('span[data-icon="ptt"]');
      const sendIcon = document.querySelector('span[data-icon="send"]');

      // Se input está vazio...
      if (inputBox && inputBox.textContent.trim() === "") {
        // ...e o ícone de enviar sumiu (ou mic voltou), consideramos enviado
        if (!sendIcon || micIcon) {
            clearInterval(checkInterval);
            console.log("[Rabello Voice] ✓ Envio confirmado (Input limpo + UI Ociosa)");
            resolve(true);
            return;
        }
      }

      // Estratégia 2: Input não existe mais (chat fechou?)
      if (!inputBox) {
        clearInterval(checkInterval);
        console.warn("[Rabello Voice] Input box desapareceu - assumindo envio");
        resolve(false);
        return;
      }

      // Estratégia 3: Timeout de segurança
      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        console.warn(
          "[Rabello Voice] ⏱ Timeout aguardando confirmação de envio",
        );
        resolve(false); // Continua mesmo sem confirmação
      }
    }, 200); // Verifica a cada 200ms
  });
}

/**
 * Processa uma fila de items do funil sequencialmente
 * @param {Array} funnelItems - Array de items do funil
 */
async function processFunnelQueue(funnelItems) {
  if (!funnelItems || funnelItems.length === 0) {
    console.warn("[Rabello Voice] Funil vazio, nada a processar.");
    return;
  }

  console.log(
    `[Rabello Voice] 🚀 Iniciando funil com ${funnelItems.length} passo(s)`,
  );

  for (let i = 0; i < funnelItems.length; i++) {
    const step = funnelItems[i];

    try {
      console.log(
        `[Rabello Voice] 📨 Passo ${i + 1}/${funnelItems.length}: "${step.title || "Sem título"}"`,
      );

      // 1. Enviar conteúdo baseado no tipo
      if (step.type === "messages" && step.content) {
        insertTextAndSend(step.content);

        // 2. Aguardar confirmação de envio
        const sent = await waitForMessageSent();
        if (!sent) {
          console.warn(
            `[Rabello Voice] ⚠ Passo ${i + 1} pode não ter sido enviado corretamente`,
          );
        }
      } else if (
        (step.type === "audios" || step.type === "medias") &&
        step.audioSrc
      ) {
        console.log(
          `[Rabello Voice] 📁 Enviando mídia/áudio no passo ${i + 1}`,
        );
        await sendMedia(step.audioSrc, step.filename || "arquivo");

        const sent = await waitForMessageSent();
        if (!sent) {
          console.warn(
            `[Rabello Voice] ⚠ Passo ${i + 1} (Mídia) pode não ter sido enviado corretamente`,
          );
        }
      } else {
        console.warn(
          `[Rabello Voice] ⚠ Passo ${i + 1}: Tipo desconhecido ou sem conteúdo`,
        );
      }

      // 3. Aguardar delay configurado (se não for o último item)
      if (i < funnelItems.length - 1) {
        const delayMs = parseDelay(step.delay);
        if (delayMs > 0) {
          const delaySeconds = (delayMs / 1000).toFixed(1);
          console.log(
            `[Rabello Voice] ⏳ Aguardando ${step.delay} (${delaySeconds}s)...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    } catch (error) {
      console.error(`[Rabello Voice] ❌ Erro no passo ${i + 1}:`, error);
      // Continua para próximo item mesmo com erro
    }
  }

  console.log("[Rabello Voice] ✅ Funil concluído!");
}

// ==========================================================
// OBSERVADOR OTIMIZADO (Estratégia Hash-Based / ID Based)
// ==========================================================

let mainObserver = null;
const MAIN_CONTAINER_SELECTOR = "#main"; // Container do chat no WA Web

// Função de Debounce
function debouncedInject() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    injectBar();
    debounceTimer = null;
  }, DEBOUNCE_DELAY);
}

// Observador focado no container do chat (#main)
// CORRIGIDO: Previne loop infinito e reduz escopo
function startMainObserver(mainElement) {
  if (mainObserver) mainObserver.disconnect();

  mainObserver = new MutationObserver((mutations) => {
    let shouldCheck = false;

    for (const mutation of mutations) {
      // CORREÇÃO CRÍTICA: Ignora mutações causadas pela nossa própria barra
      if (
        mutation.target.id === BAR_ID ||
        (mutation.target.closest && mutation.target.closest(`#${BAR_ID}`))
      ) {
        continue; // Pula esta mutação
      }

      // Se nossa barra foi removida por algo externo
      if (mutation.addedNodes) {
        for (const node of mutation.addedNodes) {
          // Ignora se o nó adicionado for nossa própria barra
          if (node.id === BAR_ID) {
            continue;
          }
        }
      }

      // 1. Detectar se nossa barra foi removida (por mudança de chat, etc)
      if (mutation.removedNodes) {
        for (const node of mutation.removedNodes) {
          if (node.id === BAR_ID) {
            console.log("[Rabello Voice] 🚨 Barra foi removida! Reinjetando IMEDIATAMENTE...");
            injectBar(); // Sem debounce para ser instantâneo
            return; // Sai do loop para não duplicar
          }
        }
      }

      // 2. Detectar mudanças estruturais (Troca de Chat)
      if (!shouldCheck && mutation.type === "childList") {
        const target = mutation.target;

        // Se a mutação ocorreu no #main (indicando troca de chat ou carregamento)
        // OU se ocorreu dentro do footer
        if (
          target.id === "main" ||
          target.tagName === "FOOTER" ||
          (target.closest && target.closest("footer")) ||
          (target.querySelector && target.querySelector("footer"))
        ) {
          shouldCheck = true;
        }
      }

      if (shouldCheck) break;
    }

    if (shouldCheck) debouncedInject();
  });

  // CORREÇÃO: Observa o #main inteiro para detectar quando o chat é trocado (destruição/recriação de filhos)
  if (mainElement) {
    mainObserver.observe(mainElement, {
      childList: true,
      subtree: true,
    });
    console.log("[Rabello Voice] Observando container #main completo (Resiliente a troca de chats).");
  }
}

// ==========================================================
// WATCHDOG (CÃO DE GUARDA) - GARANTIA FINAL DE PERSISTÊNCIA
// ==========================================================
// O React do WhatsApp pode remover elementos estranhos ao renderizar.
// Este intervalo garante que a barra volte caso seja removida silenciosamente.
setInterval(() => {
    // Só tenta checar se o #main existe (chat aberto)
    const main = document.querySelector("#main");
    if (!main) return;

    const bar = document.getElementById(BAR_ID);
    if (!bar) {
        // Se o chat está aberto mas a barra sumiu, injeta sem debounce (imediato)
        // Verifica se realmente tem input para não injetar em telas de loading
        if (findInputBox()) {
            console.log("[Rabello Voice] 🐕 Watchdog: Barra sumiu! Reinjetando...");
            injectBar();
        }
    }
}, 1000); // Verifica a cada 1 segundo (baixo custo)

// Observador Global (Leve)
// Monitora apenas o BODY para saber quando o #main entra ou sai.
const bodyObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    // Se nó adicionado for o #main
    for (const node of mutation.addedNodes) {
      if (
        node.nodeType === 1 &&
        (node.id === "main" ||
          (node.querySelector && node.querySelector("#main")))
      ) {
        const main = document.getElementById("main");
        if (main) {
          startMainObserver(main);
          debouncedInject(); // Tenta injetar logo que o main aparece
        }
      }
    }

    // Se nó removido for o #main (usuário saiu do chat)
    for (const node of mutation.removedNodes) {
      if (node.nodeType === 1 && node.id === "main") {
        console.log(
          "[Rabello Voice] Container principal removido. Parando observador focado.",
        );
        if (mainObserver) mainObserver.disconnect();
      }
    }
  }
});

// Inicia observação leve no body
bodyObserver.observe(document.body, {
  childList: true,
  subtree: false, // IMPORTANTE: False para não pesar. Só queremos filhos diretos (geralmente onde #app ou #main vivem)
});

/**
 * Converte Base64 para Blob
 */
function base64ToBlob(base64, mime) {
  const byteString = atob(base64.split(",")[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

/**
 * Envia mídia/áudio via ClipboardEvent (Simula o ato de colar um arquivo)
 */
async function sendMedia(base64Data, filename) {
  try {
    const mime = base64Data.split(";")[0].split(":")[1];
    const blob = base64ToBlob(base64Data, mime);
    const file = new File([blob], filename, { type: mime });

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const inputBox = findInputBox();
    if (!inputBox) throw new Error("Input box não encontrada");

    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    inputBox.dispatchEvent(pasteEvent);
    console.log("[Rabello Voice] ✓ Mídia colada no input");

    // Aguarda o WhatsApp carregar o preview da mídia
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
      console.log("[Rabello Voice] ✓ Botão de envio de mídia clicado");
    }
  } catch (err) {
    console.error("[Rabello Voice] Erro ao enviar mídia:", err);
  }
}

// ==========================================================
// PERSISTÊNCIA BASEADA EM EVENTOS (Global Interaction Fallback)
// ==========================================================
// Como "Arquiteto Profissional", sabemos que Observers podem falhar em SPAs complexos.
// A abordagem mais robusta é reagir à intenção do usuário (cliques e navegação).

function triggerResilienceCheck() {
    // Verifica se a barra existe e se o input está visível
    const bar = document.getElementById(BAR_ID);
    const input = findInputBox();
    
    if (!bar && input) {
        console.log("[Rabello Voice] 👆 Interação detectada + Barra ausente => Reinjetando...");
        injectBar();
    } else if (bar && input && !document.contains(bar)) {
        // Caso raro: Barra existe na memória mas não está no DOM (Detached)
        console.log("[Rabello Voice] 🧟 Barra Zumbi detectada (Detached) => Limpando e Reinjetando...");
        bar.remove();
        injectBar();
    } else if (bar && input) {
        // Garante ordem visual
         if (bar.style.order !== "9999") bar.style.order = "9999";
    }
}

// 1. Monitora cliques (Troca de chat, foco, etc)
document.addEventListener("click", () => {
    // Pequeno delay para dar tempo ao React de renderizar a nova tela
    setTimeout(triggerResilienceCheck, 500);
    setTimeout(triggerResilienceCheck, 1500); // Check secundário para conexões lentas
}, { passive: true });

// 2. Monitora teclado (Digitação, ESC, etc)
document.addEventListener("keyup", () => {
   // Debouce leve para não spamar
   if (!debounceTimer) {
       setTimeout(triggerResilienceCheck, 1000);
   }
}, { passive: true });

// 3. Monitora DIGITAÇÃO para Filtro Rápido (Solicitado)
document.addEventListener("input", (e) => {
    // Verifica se o evento veio de um campo de texto editável (o input do chat)
    const target = e.target;
    if (!target) return;
    
    // Check rápido se é um contenteditable ou input
    const isInput = target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (!isInput) return;

    // Obtém o texto digitado
    const rawText = target.textContent || target.value || "";
    const cleanText = rawText.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Lógica do Filtro: Ativa com 2 ou mais letras
    const bar = document.getElementById(BAR_ID);
    if (!bar) return;

    const items = bar.querySelectorAll('.rv-shortcut-item');
    if (items.length === 0) return;

    if (cleanText.length >= 2) {
        let hasMatch = false;
        
        items.forEach(item => {
            const searchKey = item.getAttribute('data-search') || "";
            // Verifica se o botão "começa com" ou "contém" o texto
            // Usamos 'includes' para ser mais amigável
            if (searchKey.includes(cleanText)) {
                item.style.display = "inline-flex"; // Mostra
                hasMatch = true;
            } else {
                item.style.display = "none"; // Esconde
            }
        });
        
        // Opcional: Se nenhum der match, mostra todos?
        // O usuário pediu "o botão aparece". Se não der match, melhor não mostrar nada (comportamento de busca)
        // Mas se o usuário estiver digitando uma frase normal, a barra some?
        // Sim, isso limpa a visão. Parece bom.
        
    } else {
        // Se < 2 letras, mostra todos (Reseta)
        items.forEach(item => {
             item.style.display = "inline-flex";
        });
    }

}, { passive: true });

// ========== INICIALIZAÇÃO COM RETRY INTELIGENTE ==========

let retryCount = 0;
const MAX_RETRIES = 15; // 15 tentativas x 2s = 30 segundos
const RETRY_INTERVAL = 2000; // 2 segundos

/**
 * Tenta injetar a barra com sistema de retry
 */
async function tryInjectWithRetry() {
  const inputBox = findInputBox();

  if (inputBox) {
    // Sucesso! Input encontrado
    console.log("[Rabello Voice] ✅ WhatsApp Web detectado com sucesso!");

    // Inicializa observadores
    const existingMain = document.getElementById("main");
    if (existingMain) {
      startMainObserver(existingMain);
    }

    // Injeta a barra
    await injectBar();
    return true;
  } else {
    // Ainda não encontrou - aguarda silenciosamente
    retryCount++;

    if (retryCount < MAX_RETRIES) {
      // Mensagem silenciosa - não polui o console
      if (retryCount === 1) {
        console.log("[Rabello Voice] 👀 Aguardando você abrir uma conversa...");
      }
      setTimeout(tryInjectWithRetry, RETRY_INTERVAL);
    } else {
      // Não mostra erro - o MutationObserver vai cuidar quando um chat for aberto
      console.log(
        "[Rabello Voice] ℹ️ Nenhum chat aberto. A barra aparecerá automaticamente quando você abrir uma conversa.",
      );
    }
    return false;
  }
}

// 1. Carrega cache primeiro
loadCacheFromStorage().then(() => {
  console.log("[Rabello Voice] 🚀 Iniciando extensão...");
  console.log("[Rabello Voice] 📡 Procurando por WhatsApp Web...");

  // 2. Inicia tentativas de injeção
  tryInjectWithRetry();
});

// 3. Inicia observação leve no body (para detectar quando #main aparecer)
bodyObserver.observe(document.body, {
  childList: true,
  subtree: false,
});
