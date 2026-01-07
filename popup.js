document.addEventListener('DOMContentLoaded', () => {
    const btnWhatsapp = document.getElementById('btn-whatsapp');
    const btnDashboard = document.getElementById('btn-dashboard');

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
