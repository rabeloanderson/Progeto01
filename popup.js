document.addEventListener('DOMContentLoaded', async () => {
    const btnWhatsapp = document.getElementById('btn-whatsapp');
    const btnDashboard = document.getElementById('btn-dashboard');
    const statusIcon = document.querySelector('.icon-container');
    const instructionText = document.querySelector('.instruction-text');

    // Função para verificar se estamos no WhatsApp Web
    async function checkWhatsAppStatus() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (tab && tab.url && tab.url.includes('web.whatsapp.com')) {
            // Estamos no WhatsApp! Atualiza o visual
            if (statusIcon) {
                statusIcon.innerHTML = `
                    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="2" y="2" width="60" height="60" rx="12" stroke="#25D366" stroke-width="4" fill="none"/>
                        <path d="M20 32L28 40L44 24" stroke="#25D366" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `;
            }
            if (instructionText) {
                instructionText.innerHTML = '<span style="color: #25D366; font-weight: bold;">WhatsApp Web detectado!</span><br>Sua barra de atalhos está pronta para uso.';
            }
            if (btnWhatsapp) {
                btnWhatsapp.textContent = 'Ir para o WhatsApp';
            }
        }
    }

    await checkWhatsAppStatus();

    if (btnWhatsapp) {
        btnWhatsapp.addEventListener('click', () => {
            chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
        });
    }

    if (btnDashboard) {
        btnDashboard.addEventListener('click', () => {
            const dashboardUrl = chrome.runtime.getURL('dashboard.html');
            chrome.tabs.create({ url: dashboardUrl });
        });
    }
});
