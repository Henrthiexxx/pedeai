/**
 * pedra-web-db.js — versão WEB do painel da loja (pedrad-web).
 *
 * No app Electron (pedrad-pc), o `preload.js` injetava `window.PedraElectron`
 * com acesso a um servidor local e a um banco em arquivo (userData). Na web
 * nada disso existe, então este shim reimplementa EXATAMENTE o mesmo contrato
 * assíncrono usando `localStorage` como banco local do navegador.
 *
 * Precisa ser carregado ANTES de qualquer script que use `window.PedraElectron`
 * (bootstrap.js, legacy/app.js, pdv.html, historico.html, estatisticas.html,
 * clientes-da-casa.html, config.html).
 *
 * Itens que NÃO funcionam na web (documentados no log) ficam neutralizados:
 *   - getServerInfo(): sem servidor LAN → retorna baseUrl vazio (o app cai no fallback).
 *   - getAppVersion(): sem instalação → 'web'.
 *   - openExternal(): abre em nova aba do navegador.
 */
(function () {
  'use strict';

  // Se já existe (algum dia rodar dentro do Electron), não sobrescreve.
  if (window.PedraElectron) return;

  // Marca de ambiente web — usada para pular features que dependem do
  // servidor LAN local do Electron (ex.: publishStoreContext / QR de mesas).
  window.__PEDRA_WEB__ = true;

  var SALES_KEY = 'pedra_local_sales_db_v1';
  var CUSTOMERS_KEY = 'pedra_local_customers_db_v1';

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : fallback;
    } catch (e) {
      console.error('[pedra-web-db] erro lendo', key, e);
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[pedra-web-db] erro gravando', key, e);
      return false;
    }
  }

  // ── sales DB ────────────────────────────────────────────────
  function readSalesDb() {
    var db = readJson(SALES_KEY, { version: 1, sales: [] });
    if (!Array.isArray(db.sales)) db.sales = [];
    if (!db.version) db.version = 1;
    return db;
  }
  function writeSalesDb(db) { return writeJson(SALES_KEY, db); }
  function makeLocalSaleId() {
    return 'sale_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  // ── customers DB ────────────────────────────────────────────
  function readCustomersDb() {
    var db = readJson(CUSTOMERS_KEY, { version: 1, stores: {} });
    if (!db.stores || typeof db.stores !== 'object') db.stores = {};
    if (!db.version) db.version = 1;
    return db;
  }
  function writeCustomersDb(db) { return writeJson(CUSTOMERS_KEY, db); }
  function getCustomerStore(db, storeId) {
    var sid = String(storeId || '').trim();
    if (!sid) return { customers: {}, aliases: {} };
    var entry = db.stores[sid];
    if (!entry || typeof entry !== 'object') return { customers: {}, aliases: {} };
    return {
      customers: entry.customers && typeof entry.customers === 'object' ? entry.customers : {},
      aliases: entry.aliases && typeof entry.aliases === 'object' ? entry.aliases : {}
    };
  }

  window.PedraElectron = {
    // Ambiente web: sem servidor LAN nem versão instalada.
    getServerInfo: function () {
      return Promise.resolve({ baseUrl: '', pcBaseUrl: '', ip: '', port: 0, web: true });
    },
    getAppVersion: function () { return Promise.resolve('web'); },
    openExternal: function (url) {
      var target = String(url || '').trim();
      if (!target) return Promise.resolve({ ok: false, error: 'url obrigatoria' });
      try { window.open(target, '_blank', 'noopener'); } catch (e) {}
      return Promise.resolve({ ok: true });
    },

    sales: {
      add: function (salePayload) {
        salePayload = salePayload || {};
        var db = readSalesDb();
        var nowIso = new Date().toISOString();
        var incoming = Object.assign({
          localSaleId: makeLocalSaleId(),
          createdAtLocal: nowIso,
          updatedAtLocal: nowIso
        }, salePayload);

        var externalId = String(incoming.externalOrderId || '').trim();
        if (externalId) {
          var idx = db.sales.findIndex(function (x) {
            return String(x.externalOrderId || '').trim() === externalId;
          });
          if (idx >= 0) {
            db.sales[idx] = Object.assign({}, db.sales[idx], incoming, {
              localSaleId: db.sales[idx].localSaleId || incoming.localSaleId,
              createdAtLocal: db.sales[idx].createdAtLocal || incoming.createdAtLocal,
              updatedAtLocal: nowIso
            });
            writeSalesDb(db);
            return Promise.resolve({ ok: true, localSaleId: db.sales[idx].localSaleId, updated: true });
          }
        }
        db.sales.push(incoming);
        writeSalesDb(db);
        return Promise.resolve({ ok: true, localSaleId: incoming.localSaleId });
      },
      list: function (query) {
        query = query || {};
        var db = readSalesDb();
        var storeId = String(query.storeId || '').trim();
        var source = String(query.source || '').trim();
        var limit = Math.max(1, Math.min(5000, parseInt(query.limit, 10) || 500));
        var offset = Math.max(0, parseInt(query.offset, 10) || 0);
        var list = db.sales.slice();
        if (storeId) list = list.filter(function (x) { return String(x.storeId || '') === storeId; });
        if (source) list = list.filter(function (x) { return String(x.source || '') === source; });
        list.sort(function (a, b) {
          return String(b.createdAtLocal || '').localeCompare(String(a.createdAtLocal || ''));
        });
        return Promise.resolve({ ok: true, total: list.length, items: list.slice(offset, offset + limit) });
      },
      clear: function () {
        writeSalesDb({ version: 1, sales: [] });
        return Promise.resolve({ ok: true });
      }
    },

    customers: {
      get: function (query) {
        query = query || {};
        var sid = String(query.storeId || '').trim();
        if (!sid) return Promise.resolve({ ok: false, error: 'storeId obrigatório', customers: {}, aliases: {} });
        var db = readCustomersDb();
        var store = getCustomerStore(db, sid);
        return Promise.resolve({ ok: true, storeId: sid, customers: store.customers, aliases: store.aliases });
      },
      set: function (payload) {
        payload = payload || {};
        var sid = String(payload.storeId || '').trim();
        if (!sid) return Promise.resolve({ ok: false, error: 'storeId obrigatório' });
        var db = readCustomersDb();
        var current = getCustomerStore(db, sid);
        db.stores[sid] = {
          customers: payload.customers && typeof payload.customers === 'object' ? payload.customers : current.customers,
          aliases: payload.aliases && typeof payload.aliases === 'object' ? payload.aliases : current.aliases,
          updatedAt: new Date().toISOString()
        };
        writeCustomersDb(db);
        return Promise.resolve({ ok: true, storeId: sid });
      },
      clear: function (query) {
        query = query || {};
        var sid = String(query.storeId || '').trim();
        var db = readCustomersDb();
        if (sid) delete db.stores[sid];
        else db.stores = {};
        writeCustomersDb(db);
        return Promise.resolve({ ok: true, storeId: sid });
      }
    }
  };

  console.info('[pedra-web-db] PedraElectron emulado via localStorage (versão web).');
})();
