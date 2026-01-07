console.log("[Rabello Voice] Content script carregado.");

// Configuração
const BAR_ID = 'rabello-voice-bar';
const STORAGE_KEY = 'dataStore';
const DEBOUNCE_DELAY = 500; // ms

// Estado global para controle de debounce
let debounceTimer = null;

// Função principal de injeção OTIMIZADA
async function injectBar() {
  // 1. Verifica se a barra JÁ existe no DOM (rápido)
  if (document.getElementById(BAR_ID)) return;

  // 2. Estratégia Robusta de Seletor:
  // Em vez de buscar cegamente por 'footer', buscamos a caixa de texto que é acessível e estável.
  // Seletores: contenteditable e role="textbox" são atributos de acessibilidade, raramente mudam.
  const inputBox = document.querySelector('div[contenteditable="true"][role="textbox"]');
  
  if (!inputBox) {
    // Se não achou a caixa de texto, não estamos em um chat aberto.
    return;
  }

  // Encontra o container pai onde vamos injetar (geralmente o footer ou uma div wrapper próxima)
  // O 'footer' é uma tag semântica que o WhatsApp costuma usar para essa área bottom.
  // Se falhar o footer, tentamos achar o elemento pai do input algumas vezes.
  let targetContainer = document.querySelector('footer');
  
  if (!targetContainer) {
      // Fallback: Tenta subir a árvore a partir do input se não achar footer explícito
      targetContainer = inputBox.closest('footer') || inputBox.parentElement.parentElement;
  }

  if (!targetContainer) return;

  // 3. Busca dados do storage (apenas se necessário)
  // Nota: Idealmente, deveria cachear isso na memória e atualizar via chrome.storage.onChanged
  let allItems = [];

  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const dataStore = result[STORAGE_KEY];
    
    if (!dataStore) return; 

    // Prepara lista de itens
    if (dataStore.messages) dataStore.messages.forEach(item => allItems.push({ ...item, type: 'message' }));
    if (dataStore.audios) dataStore.audios.forEach(item => allItems.push({ ...item, type: 'audio' }));
    if (dataStore.medias) dataStore.medias.forEach(item => allItems.push({ ...item, type: 'media' }));
    if (dataStore.funnels) dataStore.funnels.forEach(item => allItems.push({ ...item, type: 'funnel' }));
  } catch (err) {
    console.error(`[Rabello Voice] Erro ao acessar storage:`, err);
    return;
  }

  if (allItems.length === 0) return;

  // 4. Renderização (Criar Elementos)
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

  // 5. Inserção Segura no DOM
  // Verifica novamente se não foi injetado durante o processamento async
  if (document.getElementById(BAR_ID)) return;

  targetContainer.insertBefore(bar, targetContainer.firstChild);
  console.log("[Rabello Voice] Barra injetada.");
}

// Lógica de clique (Mantida similar, mas simplificada para clareza)
async function handleItemClick(item) {
  if (item.type === 'message') {
    insertTextAndSend(item.content);
  } else if (item.type === 'funnel') {
     if (item.items && item.items.length > 0) {
         for (const step of item.items) {
             if (step.content) {
                 insertTextAndSend(step.content);
                 // Delay básico entre mensagens do funil
                 await new Promise(r => setTimeout(r, 800)); 
             }
         }
     }
  } else if (item.type === 'media' || item.type === 'audio') {
    alert(`Funcionalidade de Mídia (${item.filename}) em breve na versão Premium!`);
  }
}

// Inserção de Texto
function insertTextAndSend(text) {
  if (!text) return;
  const inputBox = document.querySelector('div[contenteditable="true"][role="textbox"]');
  if (!inputBox) return;

  // Foco necessário
  inputBox.focus();

  // ExecCommand 'insertText' é a forma mais compatível de "digitar" no contenteditable do WA
  // Preserva histórico de undo/redo nativo
  document.execCommand('insertText', false, text);

  // Dispara evento de input para o React do WhatsApp detectar a mudança de estado
  inputBox.dispatchEvent(new Event('input', { bubbles: true }));

  // Clica no botão enviar após breve delay para garantir que o React processou o input
  setTimeout(() => {
    const sendButton = document.querySelector('span[data-icon="send"]');
    if (sendButton) {
        // Busca o botão clicável real (geralmente um elemento pai do ícone)
        const btn = sendButton.closest('button');
        if (btn) btn.click();
    }
  }, 100);
}

// ==========================================================
// OBSERVADOR OTIMIZADO (DEBOUNCE + FILTRO)
// ==========================================================

// Função de Debounce: Garante que a injeção só rode uma vez após uma rajada de mudanças
function debouncedInject() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    injectBar();
    debounceTimer = null;
  }, DEBOUNCE_DELAY);
}

const observer = new MutationObserver((mutations) => {
  // Filtro de Performance:
  // Só nos importamos se nós fomos removidos OU se o footer mudou.
  // Não queremos rodar lógica pesada em cada pixel que muda na tela.
  
  let shouldCheck = false;

  for (const mutation of mutations) {
    // 1. Se nós fomos removidos (ex: troca de chat redesenha o footer)
    if (mutation.removedNodes) {
        for (const node of mutation.removedNodes) {
            if (node.id === BAR_ID) {
                shouldCheck = true; 
                break;
            }
        }
    }
    
    // 2. Se o footer foi adicionado ou alterado (ex: abrindo um novo chat)
    if (!shouldCheck && mutation.target && 
       (mutation.target.tagName === 'FOOTER' || 
        mutation.target.querySelector && mutation.target.querySelector('footer'))) {
        shouldCheck = true;
    }

    // 3. Se a caixa de input apareceu (caso o footer não seja detectado direto)
    if(!shouldCheck && mutation.addedNodes.length > 0) {
        // Verificação leve para ver se é uma estrutura de chat carregando
        if(document.querySelector('div[contenteditable="true"][role="textbox"]')) {
             shouldCheck = true;
        }
    }
    
    if (shouldCheck) break; // Já achamos um motivo para verificar, pare o loop.
  }

  if (shouldCheck) {
    debouncedInject();
  }
});

// Observe com filtro, mas ainda precisamos do subtree para ver elementos aparecendo fundo na árvore
observer.observe(document.body, { // O ideal seria #app se for constante, mas body é seguro
  childList: true,
  subtree: true,
  attributes: false, // Não nos importamos com mudanças de atributo (class, style)
  characterData: false // Não nos importamos com texto mudando
});

// Primeira tentativa
injectBar();
