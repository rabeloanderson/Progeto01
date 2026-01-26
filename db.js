/**
 * Rabello Voice - Database Manager (IndexedDB)
 * Gerencia o armazenamento persistente de mensagens, áudios, mídias e funis.
 */

const DB_NAME = 'RabelloVoiceDB';
const DB_VERSION = 1;
const STORE_NAME = 'dataStore';

const DBManager = {
  db: null,

  /**
   * Inicializa a conexão com o banco de dados
   */
  init() {
    return new Promise((resolve, reject) => {
      if (this.db) return resolve(this.db);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[Rabello Voice DB] Erro ao abrir banco:', event.target.error);
        reject(event.target.error);
      };
    });
  },

  /**
   * Obtém um valor pela chave
   */
  async get(key) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Salva um valor associado a uma chave
   */
  async set(key, value) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Remove um item do banco
   */
  async delete(key) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Limpa todo o banco de dados
   */
  async clear() {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};

// Exporta para uso global no Dashboard e Content Script
window.DBManager = DBManager;
