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
 * Ordem: acessibilidade → estrutura → fallback
 */
function findInputBox() {
  const selectors = [
    // 1. Baseado em acessibilidade (mais estável)
    'div[contenteditable="true"][role="textbox"][data-tab="10"]',
    'div[contenteditable="true"][role="textbox"]',
    
    // 2. Baseado em aria-label (se disponível)
    'div[aria-label*="mensagem"]',
    'div[aria-placeholder*="mensagem"]',
    
    // 3. Estrutura conhecida
    'footer div[contenteditable="true"]',
    '#main footer div[contenteditable="true"]',
    
    // 4. Fallback genérico
    'div[contenteditable="true"].selectable-text',
    'div.lexical-rich-text-input'
  ];
  
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element && element.isContentEditable) {
        console.log(`[Rabello Voice] Input encontrado via: ${selector}`);
        return element;
      }
    } catch (e) {
      // Seletor inválido, continua para o próximo
      continue;
    }
  }
  
  console.warn('[Rabello Voice] Nenhum input box encontrado.');
  return null;
}

/**
 * Encontra o container/footer onde a barra será injetada
 */
function findTargetContainer(inputBox) {
  if (!inputBox) return null;
  
  const strategies = [
    // 1. Footer direto
    () => document.querySelector('footer'),
    () => document.querySelector('#main footer'),
    
    // 2. Subir a árvore a partir do input
    () => inputBox.closest('footer'),
    () => inputBox.closest('[role="footer"]'),
    () => inputBox.closest('div[class*="footer"]'),
    
    // 3. Estrutura relativa ao input (2-3 níveis acima)
    () => inputBox.parentElement?.parentElement,
    () => inputBox.parentElement?.parentElement?.parentElement
  ];
  
  for (const strategy of strategies) {
    try {
      const container = strategy();
      if (container) {
        console.log(`[Rabello Voice] Container encontrado via estratégia ${strategies.indexOf(strategy) + 1}`);
        return container;
      }
    } catch (e) {
      continue;
    }
  }
  
  console.warn('[Rabello Voice] Nenhum container encontrado.');
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

// Função principal de injeção OTIMIZADA (Agora usa cache + seletores resilientes!)
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
  
  let allItems = [];
  
  // Prepara lista de itens do cache
  if (cachedData.messages) cachedData.messages.forEach(item => allItems.push({ ...item, type: 'message' }));
  if (cachedData.audios) cachedData.audios.forEach(item => allItems.push({ ...item, type: 'audio' }));
  if (cachedData.medias) cachedData.medias.forEach(item => allItems.push({ ...item, type: 'media' }));
  if (cachedData.funnels) cachedData.funnels.forEach(item => allItems.push({ ...item, type: 'funnel' }));

  if (allItems.length === 0) return;

  // 5. Renderização (Criar Elementos)
  const bar = document.createElement('div');
  bar.id = BAR_ID;
  
  allItems.forEach(item => {
    const btn = document.createElement('button');
    let typeClass = '';
    if (item.type === 'message') typeClass = 'rv-msg';
    else if (item.type === 'audio' || item.type === 'media') typeClass = 'rv-media';
    else if (item.type === 'funnel') typeClass = 'rv-funnel';
    
    btn.className = `rv-chip-btn ${typeClass}`;
    btn.textContent = item.title || "Item";
    btn.dataset.type = item.type; // Útil para debug
    
    // Tooltip simples para conteúdo longo
    if(item.content) btn.title = item.content.substring(0, 50);

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // Impede que o clique propague para o chat
      handleItemClick(item);
    });
    
    bar.appendChild(btn);
  });

  // 6. Inserção Segura no DOM
  // Verifica novamente se não foi injetado durante o processamento async
  if (document.getElementById(BAR_ID)) return;

  targetContainer.insertBefore(bar, targetContainer.firstChild);
  console.log("[Rabello Voice] Barra injetada.");
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

// ========== INICIALIZAÇÃO ==========
// 1. Carrega cache primeiro
loadCacheFromStorage().then(() => {
  console.log('[Rabello Voice] Inicialização completa.');
  
  // 2. Inicializa observadores e injeta barra
  const existingMain = document.getElementById('main');
  if (existingMain) {
      startMainObserver(existingMain);
      injectBar(); // Tenta injetar imediatamente
  } else {
      // Fallback: Tenta injetar mesmo sem main, caso o layout seja diferente
      injectBar();
  }
});
