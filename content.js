console.log("[Rabello Voice] Content script carregado.");

// Configuração
const BAR_ID = 'rabello-voice-bar';
const STORAGE_KEY = 'dataStore';
const DEBOUNCE_DELAY = 500; // ms

// Estado global para controle de debounce
let debounceTimer = null;

// ========== SELETORES RESILIENTES ==========
// Sistema de fallback com múltiplos seletores para maior estabilidade

/**
 * Encontra a caixa de input do WhatsApp usando múltiplos seletores
 * Atualizado para WhatsApp Web 2026 com seletores modernos
 */
function findInputBox() {
  const selectors = [
    // === SELETORES ATUALIZADOS 2026 ===
    
    // 1. Novo WhatsApp Web (Lexical Editor - 2024+)
    'div[contenteditable="true"][data-lexical-editor="true"]',
    'p[class*="selectable-text"][contenteditable="true"]',
    'div.lexical-rich-text-input[contenteditable="true"]',
    
    // 2. Container principal do editor (mais específico)
    'div[role="textbox"][contenteditable="true"][data-tab]',
    'div[role="textbox"][contenteditable="true"]',
    
    // 3. Baseado em aria-label/placeholder (multilíngue)
    'div[aria-placeholder*="Type a message"]',
    'div[aria-placeholder*="Digite uma mensagem"]',
    'div[aria-placeholder*="Escreva uma mensagem"]',
    'div[aria-label*="Type a message"]',
    'div[aria-label*="mensagem"]',
    
    // 4. Estrutura do footer (versões antigas)
    'footer div[contenteditable="true"]',
    '#main footer div[contenteditable="true"]',
    'div[data-tab="10"][contenteditable="true"]',
    
    // 5. Classes conhecidas (fallback)
    'div[contenteditable="true"].selectable-text',
    'div.copyable-text[contenteditable="true"]',
    'div._ak1l[contenteditable="true"]', // Classe ofuscada comum
    
    // 6. Busca genérica final
    'footer [contenteditable="true"]',
    '#main [contenteditable="true"]'
  ];
  
  // Tenta cada seletor
  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i];
    try {
      const element = document.querySelector(selector);
      if (element && element.isContentEditable) {
        console.log(`[Rabello Voice] ✓ Input encontrado via seletor #${i + 1}: ${selector}`);
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
    console.warn(`[Rabello Voice] ⚠ Encontrados ${allEditables.length} elemento(s) contenteditable, mas nenhum corresponde aos seletores conhecidos.`);
    console.log('[Rabello Voice] DEBUG - Elementos encontrados:', Array.from(allEditables).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      ariaPlaceholder: el.getAttribute('aria-placeholder'),
      classes: el.className,
      dataTab: el.getAttribute('data-tab')
    })));
  } else {
    console.warn('[Rabello Voice] ⚠ Nenhum elemento contenteditable encontrado. Aguarde o WhatsApp carregar ou abra uma conversa.');
  }
  
  return null;
}

/**
 * Encontra o container/footer onde a barra será injetada
 * GARANTE que será injetado no FOOTER do chat, nunca no header
 */
function findTargetContainer(inputBox) {
  if (!inputBox) return null;
  
  // ===== ESTRATÉGIA 1: FOOTER ESPECÍFICO DO CHAT =====
  // Busca o footer que está dentro do #main (área do chat)
  const strategies = [
    // 1A. Footer dentro do #main (mais específico e correto)
    () => {
      const mainFooter = document.querySelector('#main footer');
      // Valida que este footer realmente contém o nosso input
      if (mainFooter && mainFooter.contains(inputBox)) {
        return mainFooter;
      }
      return null;
    },
    
    // 1B. Sobe a partir do input até encontrar footer
    () => inputBox.closest('footer'),
    
    // 1C. Footer com role específico
    () => {
      const footer = inputBox.closest('[role="footer"]');
      if (footer) return footer;
      return null;
    },
    
    // 1D. Estrutura relativa (parent do input - geralmente é o footer)
    () => {
      // Sobe até encontrar um elemento que seja footer ou contenha footer
      let parent = inputBox.parentElement;
      let depth = 0;
      const maxDepth = 5; // Máximo 5 níveis
      
      while (parent && depth < maxDepth) {
        // Se é um footer, retorna
        if (parent.tagName === 'FOOTER') {
          return parent;
        }
        // Se contém a palavra "footer" na classe
        if (parent.className && parent.className.toLowerCase().includes('footer')) {
          return parent;
        }
        parent = parent.parentElement;
        depth++;
      }
      return null;
    }
  ];
  
  // Tenta cada estratégia
  for (let i = 0; i < strategies.length; i++) {
    try {
      const container = strategies[i]();
      if (container) {
        // ===== VALIDAÇÃO ADICIONAL =====
        // Garante que não é um header/sidebar
        const tagName = container.tagName.toLowerCase();
        const classNames = container.className.toLowerCase();
        
        // REJEITA se for header, nav, sidebar
        if (tagName === 'header' || tagName === 'nav') {
          console.warn(`[Rabello Voice] ⚠ Container rejeitado (${tagName}) - não é footer`);
          continue;
        }
        
        if (classNames.includes('header') || classNames.includes('sidebar') || classNames.includes('nav')) {
          console.warn(`[Rabello Voice] ⚠ Container rejeitado (classe: ${classNames}) - não é footer`);
          continue;
        }
        
        // ACEITA apenas se for realmente footer
        if (tagName === 'footer' || classNames.includes('footer')) {
          console.log(`[Rabello Voice] ✓ Footer correto encontrado via estratégia #${i + 1}`);
          return container;
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  // ===== FALLBACK FINAL =====
  // Se nada funcionou, usa o parent direto do input
  console.warn('[Rabello Voice] ⚠ Usando fallback: parent direto do input');
  return inputBox.parentElement;
}

/**
 * Encontra o botão de envio com múltiplos seletores
 */
function findSendButton() {
  const selectors = [
    // 1. Baseado no ícone (mais comum)
    'span[data-icon="send"]',
    'button span[data-icon="send"]',
    
    // 2. Baseado em aria-label
    'button[aria-label*="Enviar"]',
    'button[aria-label*="Send"]',
    
    // 3. Estrutura conhecida
    'footer button[aria-label]',
    'footer span[data-icon] + button',
    
    // 4. Fallback por posição (último botão no footer)
    'footer button:last-of-type'
  ];
  
  for (const selector of selectors) {
    try {
      const icon = document.querySelector(selector);
      if (icon) {
        // Tenta achar o botão pai se for um ícone
        const button = icon.closest('button') || icon;
        if (button && button.tagName === 'BUTTON') {
          console.log(`[Rabello Voice] Botão de envio encontrado via: ${selector}`);
          return button;
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  console.warn('[Rabello Voice] Botão de envio não encontrado.');
  return null;
}

// ========== CACHE LOCAL ==========
// Cache em memória dos dados do Dashboard para evitar leituras repetidas do storage
let cachedData = null;
let isCacheReady = false;

// Carrega dados iniciais do storage e popula o cache
async function loadCacheFromStorage() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    cachedData = result[STORAGE_KEY] || null;
    isCacheReady = true;
    console.log('[Rabello Voice] Cache carregado:', cachedData);
    return cachedData;
  } catch (err) {
    console.error('[Rabello Voice] Erro ao carregar cache:', err);
    isCacheReady = true; // Marca como pronto mesmo com erro para não bloquear
    return null;
  }
}

// Listener para mudanças no storage - atualiza o cache automaticamente
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEY]) {
    const newValue = changes[STORAGE_KEY].newValue;
    cachedData = newValue || null;
    console.log('[Rabello Voice] Cache atualizado via storage.onChanged');
    
    // Re-injeta a barra com os novos dados
    removeBar(); // Remove a barra antiga
    debouncedInject(); // Injeta com os dados atualizados
  }
});

// ========== FÁBRICA DE UI (FACTORY PATTERN) ==========

/**
 * Retorna o SVG apropriado para cada tipo de item
 * @param {string} type - Tipo do item (message, audio, media, funnel)
 * @returns {SVGElement} Elemento SVG do ícone
 */
function createIconSVG(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('fill', 'none');
  
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  
  // Define os ícones por tipo
  switch(type) {
    case 'message':
      // Ícone de mensagem (chat bubble)
      path.setAttribute('d', 'M6.375 14.25H6C3 14.25 1.5 13.5 1.5 9.75V6C1.5 3 3 1.5 6 1.5H12C15 1.5 16.5 3 16.5 6V9.75C16.5 12.75 15 14.25 12 14.25H11.625C11.4 14.25 11.18 14.36 11.04 14.54L9.9 16.04C9.4 16.7 8.6 16.7 8.1 16.04L6.96 14.54C6.84 14.38 6.56 14.25 6.375 14.25Z');
      break;
      
    case 'audio':
      // Ícone de áudio (microfone)
      path.setAttribute('d', 'M9 1.5C7.34 1.5 6 2.84 6 4.5V9C6 10.66 7.34 12 9 12C10.66 12 12 10.66 12 9V4.5C12 2.84 10.66 1.5 9 1.5Z M15 8.25C15 11.15 12.76 13.54 9.9 13.92V15.75H8.1V13.92C5.24 13.54 3 11.15 3 8.25');
      break;
      
    case 'media':
      // Ícone de imagem/mídia
      path.setAttribute('d', 'M6.375 1.5H11.625C14.625 1.5 16.5 3.375 16.5 6.375V11.625C16.5 14.625 14.625 16.5 11.625 16.5H6.375C3.375 16.5 1.5 14.625 1.5 11.625V6.375C1.5 3.375 3.375 1.5 6.375 1.5Z M6.75 6.75C5.92 6.75 5.25 6.08 5.25 5.25C5.25 4.42 5.92 3.75 6.75 3.75C7.58 3.75 8.25 4.42 8.25 5.25C8.25 6.08 7.58 6.75 6.75 6.75Z M2.4 13.42L5.76 10.98C6.24 10.64 6.9 10.68 7.33 11.06L7.56 11.27C8.04 11.69 8.79 11.69 9.27 11.27L12.15 8.73C12.63 8.31 13.38 8.31 13.86 8.73L16.5 11.04');
      break;
      
    case 'funnel':
      // Ícone de funil (flow/workflow)
      path.setAttribute('d', 'M11.9 15.8C11.9 16.4 11.6 17 11.1 17.3L10 18C9.4 18.4 8.6 18.4 8 18L6.9 17.3C6.4 17 6.1 16.4 6.1 15.8V10.7C6.1 10.3 5.9 9.6 5.6 9.3L2.3 6.4C1.9 6.1 1.5 5.4 1.5 4.9V3.1C1.5 2.1 2.3 1.5 3.2 1.5H14.8C15.7 1.5 16.5 2.2 16.5 3.1V4.8C16.5 5.5 16 6.2 15.6 6.5');
      break;
      
    default:
      // Ícone genérico (círculo)
      path.setAttribute('d', 'M9 16.5C13.14 16.5 16.5 13.14 16.5 9C16.5 4.86 13.14 1.5 9 1.5C4.86 1.5 1.5 4.86 1.5 9C1.5 13.14 4.86 16.5 9 16.5Z');
  }
  
  svg.appendChild(path);
  return svg;
}

/**
 * Cria um elemento de atalho (shortcut) usando createElement
 * Padrão Factory - Evita innerHTML para melhor segurança e performance
 * @param {Object} item - Item do storage (message, audio, media, funnel)
 * @returns {HTMLElement} Elemento div.rv-shortcut-item
 */
function createShortcutElement(item) {
  // Container principal
  const button = document.createElement('div');
  button.className = 'rv-shortcut-item';
  button.setAttribute('data-type', item.type); // Para CSS e debug
  button.setAttribute('role', 'button');
  button.setAttribute('tabindex', '0');
  
  // Tooltip simples
  if (item.content) {
    button.title = item.content.substring(0, 100);
  }
  
  // Container do ícone
  const iconWrapper = document.createElement('span');
  iconWrapper.className = 'rv-shortcut-icon';
  iconWrapper.appendChild(createIconSVG(item.type));
  
  // Label do texto
  const label = document.createElement('span');
  label.className = 'rv-shortcut-label';
  label.textContent = item.title || 'Item';
  
  // Montagem
  button.appendChild(iconWrapper);
  button.appendChild(label);
  
  // Event Listener
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleItemClick(item);
  });
  
  // Acessibilidade - permitir Enter/Space
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleItemClick(item);
    }
  });
  
  return button;
}

// Função principal de injeção OTIMIZADA (Agora usa Factory + seletores resilientes!)
async function injectBar() {
  // 1. Verifica se a barra JÁ existe no DOM (rápido)
  if (document.getElementById(BAR_ID)) return;

  // 2. Usa sistema de seletores resilientes
  const inputBox = findInputBox();
  if (!inputBox) {
    // Se não achou a caixa de texto, não estamos em um chat aberto.
    return;
  }

  // 3. Encontra o container usando estratégias múltiplas
  const targetContainer = findTargetContainer(inputBox);
  if (!targetContainer) return;

  // 4. Usa dados do CACHE (sem I/O de storage!)
  // Aguarda o cache estar pronto se ainda estiver carregando
  if (!isCacheReady) {
    await loadCacheFromStorage();
  }
  
  if (!cachedData) return;
  
  // Prepara lista unificada de itens do cache
  const allItems = [
    ...(cachedData.messages || []).map(i => ({...i, type: 'message'})),
    ...(cachedData.audios || []).map(i => ({...i, type: 'audio'})),
    ...(cachedData.medias || []).map(i => ({...i, type: 'media'})),
    ...(cachedData.funnels || []).map(i => ({...i, type: 'funnel'}))
  ];

  if (allItems.length === 0) return;

  // 5. Renderização (Criar Elementos usando Factory Pattern)
  const bar = document.createElement('div');
  bar.id = BAR_ID;
  
  allItems.forEach(item => {
    bar.appendChild(createShortcutElement(item));
  });

  // 6. Inserção Segura no DOM
  // Verifica novamente se não foi injetado durante o processamento async
  if (document.getElementById(BAR_ID)) return;

  targetContainer.insertBefore(bar, targetContainer.firstChild);
  console.log(`[Rabello Voice] ✅ Barra injetada com ${allItems.length} atalho(s)`);
}

// Lógica de clique (Agora usa Queue Manager!)
async function handleItemClick(item) {
  if (item.type === 'message') {
    insertTextAndSend(item.content);
    
  } else if (item.type === 'funnel') {
    if (item.items && item.items.length > 0) {
      // Usa Queue Manager robusto
      await processFunnelQueue(item.items);
    } else {
      console.warn('[Rabello Voice] Funil vazio - nenhum item para processar');
    }
    
  } else if (item.type === 'media' || item.type === 'audio') {
    alert(`Funcionalidade de Mídia (${item.filename}) em breve na versão Premium!`);
  }
}

// Função auxiliar para remover a barra (útil para re-renderização)
function removeBar() {
  const existingBar = document.getElementById(BAR_ID);
  if (existingBar) {
    existingBar.remove();
  }
}

// Inserção de Texto (Agora com Clipboard API moderna!)
async function insertTextAndSend(text) {
  if (!text) return;
  
  // Usa função resiliente para encontrar o input
  const inputBox = findInputBox();
  if (!inputBox) {
    console.error('[Rabello Voice] Não foi possível enviar: input box não encontrado.');
    return;
  }

  // Foco necessário
  inputBox.focus();

  // Estratégia moderna: Clipboard API + Paste Event
  try {
    // 1. Escreve no clipboard (moderna e assíncrona)
    await navigator.clipboard.writeText(text);
    
    // 2. Simula evento de paste (React do WhatsApp detecta automaticamente)
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });
    
    // Adiciona o texto ao clipboardData do evento
    pasteEvent.clipboardData.setData('text/plain', text);
    
    // Dispara o evento no inputBox
    inputBox.dispatchEvent(pasteEvent);
    
    console.log('[Rabello Voice] ✓ Texto inserido via Clipboard API');
    
  } catch (clipboardError) {
    console.warn('[Rabello Voice] Clipboard API falhou, usando fallback:', clipboardError);
    
    // Fallback 1: Manipulação direta do DOM
    try {
      // Limpa input primeiro
      inputBox.textContent = '';
      
      // Insere o texto
      const textNode = document.createTextNode(text);
      inputBox.appendChild(textNode);
      
      // Dispara eventos para o React detectar
      inputBox.dispatchEvent(new InputEvent('input', { 
        bubbles: true, 
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
      
      console.log('[Rabello Voice] ✓ Texto inserido via DOM manipulation');
      
    } catch (domError) {
      console.warn('[Rabello Voice] DOM manipulation falhou, usando execCommand:', domError);
      
      // Fallback 2: execCommand (legado, mas ainda funciona)
      document.execCommand('insertText', false, text);
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      
      console.log('[Rabello Voice] ⚠ Texto inserido via execCommand (depreciado)');
    }
  }

  // Clica no botão enviar após breve delay para garantir que o React processou o input
  setTimeout(() => {
    const sendButton = findSendButton();
    if (sendButton) {
      sendButton.click();
    } else {
      console.warn('[Rabello Voice] Botão de envio não encontrado. Mensagem não enviada.');
    }
  }, 150); // Aumentado para 150ms para dar tempo ao React processar
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
      if (inputBox && inputBox.textContent.trim() === '') {
        clearInterval(checkInterval);
        console.log('[Rabello Voice] ✓ Envio confirmado (input limpo)');
        resolve(true);
        return;
      }
      
      // Estratégia 2: Input não existe mais (chat fechou?)
      if (!inputBox) {
        clearInterval(checkInterval);
        console.warn('[Rabello Voice] Input box desapareceu - assumindo envio');
        resolve(false);
        return;
      }
      
      // Estratégia 3: Timeout de segurança
      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        console.warn('[Rabello Voice] ⏱ Timeout aguardando confirmação de envio');
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
    console.warn('[Rabello Voice] Funil vazio, nada a processar.');
    return;
  }
  
  console.log(`[Rabello Voice] 🚀 Iniciando funil com ${funnelItems.length} passo(s)`);
  
  for (let i = 0; i < funnelItems.length; i++) {
    const step = funnelItems[i];
    
    try {
      console.log(`[Rabello Voice] 📨 Passo ${i + 1}/${funnelItems.length}: "${step.title || 'Sem título'}"`);
      
      // 1. Enviar conteúdo baseado no tipo
      if (step.type === 'messages' && step.content) {
        insertTextAndSend(step.content);
        
        // 2. Aguardar confirmação de envio
        const sent = await waitForMessageSent();
        if (!sent) {
          console.warn(`[Rabello Voice] ⚠ Passo ${i + 1} pode não ter sido enviado corretamente`);
        }
        
      } else if (step.type === 'audios' || step.type === 'medias') {
        // Futura implementação de mídia
        console.warn(`[Rabello Voice] ⚠ Passo ${i + 1}: Mídia/Áudio em funis será suportado em breve`);
        // Conta como "enviado" para não travar o funil
      } else {
        console.warn(`[Rabello Voice] ⚠ Passo ${i + 1}: Tipo desconhecido ou sem conteúdo`);
      }
      
      // 3. Aguardar delay configurado (se não for o último item)
      if (i < funnelItems.length - 1) {
        const delayMs = parseDelay(step.delay);
        if (delayMs > 0) {
          const delaySeconds = (delayMs / 1000).toFixed(1);
          console.log(`[Rabello Voice] ⏳ Aguardando ${step.delay} (${delaySeconds}s)...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
      
    } catch (error) {
      console.error(`[Rabello Voice] ❌ Erro no passo ${i + 1}:`, error);
      // Continua para próximo item mesmo com erro
    }
  }
  
  console.log('[Rabello Voice] ✅ Funil concluído!');
}

// ==========================================================
// OBSERVADOR OTIMIZADO (Estratégia Hash-Based / ID Based)
// ==========================================================

let mainObserver = null;
const MAIN_CONTAINER_SELECTOR = '#main'; // Container do chat no WA Web

// Função de Debounce
function debouncedInject() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    injectBar();
    debounceTimer = null;
  }, DEBOUNCE_DELAY);
}

// Observador focado no container do chat (#main)
// Esse é o "pesado", mas agora restrito a apenas uma parte da tela.
function startMainObserver(mainElement) {
    if (mainObserver) mainObserver.disconnect();

    mainObserver = new MutationObserver((mutations) => {
        let shouldCheck = false;
        
        for (const mutation of mutations) {
            // 1. Detectar se nossa barra foi removida
            if (mutation.removedNodes) {
                for (const node of mutation.removedNodes) {
                    if (node.id === BAR_ID) {
                        shouldCheck = true; 
                        break;
                    }
                }
            }

            // 2. Detectar mudanças relevantes de estrutura no chat (footer, input)
            // Não olhamos atributos, apenas estrutura (childList)
            // 2. Detectar mudanças relevantes de estrutura no chat (footer, input)
            if (!shouldCheck && mutation.type === 'childList') {
                // Se adicionou nós, verifica se parece ser o footer ou input
                if (mutation.addedNodes.length > 0) {
                     const target = mutation.target;
                     // Se o alvo for o footer ou conter um footer
                     if (target.tagName === 'FOOTER' || target.querySelector('footer')) {
                         shouldCheck = true;
                     }
                     // Verifica inputs usando função resiliente
                     else if (findInputBox()) {
                         shouldCheck = true;
                     }
                }
            }
            
            if (shouldCheck) break;
        }

        if (shouldCheck) debouncedInject();
    });

    mainObserver.observe(mainElement, {
        childList: true,
        subtree: true // Precisamos de subtree dentro do main para ver inputs aninhados
    });
    
    console.log("[Rabello Voice] Observando container principal (#main).");
}

// Observador Global (Leve)
// Monitora apenas o BODY para saber quando o #main entra ou sai.
const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        // Se nó adicionado for o #main
        for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && (node.id === 'main' || node.querySelector && node.querySelector('#main'))) {
                const main = document.getElementById('main');
                if (main) {
                    startMainObserver(main);
                    debouncedInject(); // Tenta injetar logo que o main aparece
                }
            }
        }

        // Se nó removido for o #main (usuário saiu do chat)
        for (const node of mutation.removedNodes) {
            if (node.nodeType === 1 && (node.id === 'main')) {
                console.log("[Rabello Voice] Container principal removido. Parando observador focado.");
                if (mainObserver) mainObserver.disconnect();
            }
        }
    }
});

// Inicia observação leve no body
bodyObserver.observe(document.body, {
    childList: true,
    subtree: false // IMPORTANTE: False para não pesar. Só queremos filhos diretos (geralmente onde #app ou #main vivem)
});

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
    console.log('[Rabello Voice] ✅ WhatsApp Web detectado com sucesso!');
    
    // Inicializa observadores
    const existingMain = document.getElementById('main');
    if (existingMain) {
      startMainObserver(existingMain);
    }
    
    // Injeta a barra
    await injectBar();
    return true;
  } else {
    // Ainda não encontrou
    retryCount++;
    
    if (retryCount < MAX_RETRIES) {
      console.log(`[Rabello Voice] ⏳ Aguardando WhatsApp carregar... Tentativa ${retryCount}/${MAX_RETRIES}`);
      setTimeout(tryInjectWithRetry, RETRY_INTERVAL);
    } else {
      console.error('[Rabello Voice] ❌ Timeout: WhatsApp Web não carregou após 30s.');
      console.error('[Rabello Voice] 💡 Possíveis soluções:');
      console.error('   1. Abra uma conversa no WhatsApp Web');
      console.error('   2. Recarregue a página (F5)');
      console.error('   3. Verifique se está em https://web.whatsapp.com');
    }
    return false;
  }
}

// 1. Carrega cache primeiro
loadCacheFromStorage().then(() => {
  console.log('[Rabello Voice] 🚀 Iniciando extensão...');
  console.log('[Rabello Voice] 📡 Procurando por WhatsApp Web...');
  
  // 2. Inicia tentativas de injeção
  tryInjectWithRetry();
});

// 3. Inicia observação leve no body (para detectar quando #main aparecer)
bodyObserver.observe(document.body, {
    childList: true,
    subtree: false
});

