"use strict";
(() => {
  // src/shared/firebase-config.ts
  var firebaseWebConfig = {
    apiKey: "AIzaSyAnIJRcUxN-0swpVnonPbJjTSK87o4CQ_g",
    authDomain: "pedrad-814d0.firebaseapp.com",
    projectId: "pedrad-814d0",
    storageBucket: "pedrad-814d0.appspot.com",
    messagingSenderId: "293587190550",
    appId: "1:293587190550:web:80c9399f82847c80e20637"
  };

  // src/shared/invoices.ts
  function num(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function orderStoreSale(order) {
    const subtotal = num(order.subtotal);
    if (subtotal > 0) return subtotal;
    const storeTotal = num(order.storeTotal);
    if (storeTotal > 0) return storeTotal;
    const itemsTotal = num(order.itemsTotal);
    if (itemsTotal > 0) return itemsTotal;
    if (order.source === "pdv" && order.localTaxIncludedInTotal !== false) {
      return Math.max(num(order.total) - num(order.localTax), 0);
    }
    const totalAmount = num(order.totalAmount);
    if (totalAmount > 0) return Math.max(0, totalAmount - num(order.deliveryFee));
    const total = num(order.total);
    return Math.max(0, total - num(order.deliveryFee));
  }
  function calculateInvoiceSummary(orders, context) {
    const valid = orders.filter((order) => order.status !== "cancelled");
    const pdvOrders = valid.filter((order) => order.source === "pdv");
    const appOrders = valid.filter((order) => order.source !== "pdv");
    const orderCount = valid.length;
    const appOrderCount = appOrders.length;
    const pdvOrderCount = pdvOrders.length;
    const appSales = appOrders.reduce((sum, order) => sum + orderStoreSale(order), 0);
    const pdvSales = pdvOrders.reduce((sum, order) => sum + orderStoreSale(order), 0);
    const totalSales = appSales + pdvSales;
    const pdvLocalTaxTotal = pdvOrders.reduce((sum, order) => sum + num(order.localTax), 0);
    const deliveryEarnings = valid.reduce((sum, order) => sum + num(order.deliveryFee), 0);
    const baseAmount = appSales;
    const feeType = context.feeType === "fixed" ? "fixed" : "percent";
    const feeValue = feeType === "fixed" ? num(context.feeFixed) : num(context.feePercent || 10);
    const appPlatformFee = feeType === "fixed" ? appOrderCount * feeValue : appSales * (feeValue / 100);
    const platformFee = appPlatformFee + pdvLocalTaxTotal;
    return {
      orderCount,
      appOrderCount,
      pdvOrderCount,
      totalSales,
      appSales,
      pdvSales,
      pdvLocalTaxTotal,
      deliveryEarnings,
      baseAmount,
      appPlatformFee,
      platformFee,
      feeType,
      feeValue,
      month: context.month,
      year: context.year,
      transparencyVersion: 1
    };
  }

  // src/shared/store-resolution.ts
  var ROLE_FIELDS = [
    "id",
    "ownerId",
    "ownerUid",
    "userId",
    "uid",
    "ownerEmail",
    "email",
    "userEmail",
    "adminEmails"
  ];
  function normalizeEmail(value) {
    return String(value ?? "").trim().toLowerCase();
  }
  function normalizeUid(value) {
    return String(value ?? "").trim();
  }
  function getStoreRoleFields() {
    return [...ROLE_FIELDS];
  }
  function storeBelongsToAuth(store, auth) {
    if (!store) return false;
    const uid = normalizeUid(auth.uid);
    const email = normalizeEmail(auth.email);
    const adminEmails = Array.isArray(store.adminEmails) ? store.adminEmails.map(normalizeEmail).filter(Boolean) : [];
    return [
      normalizeUid(store.id),
      normalizeUid(store.ownerId),
      normalizeUid(store.ownerUid),
      normalizeUid(store.userId),
      normalizeUid(store.uid)
    ].includes(uid) || [
      normalizeEmail(store.ownerEmail),
      normalizeEmail(store.email),
      normalizeEmail(store.userEmail)
    ].includes(email) || adminEmails.includes(email);
  }
  async function resolveStoreForFirebaseUser(db, auth, options) {
    const knownIds = (options?.knownIds || []).map(normalizeUid).filter(Boolean);
    for (const knownId of knownIds) {
      try {
        const doc = await db.collection("stores").doc(knownId).get();
        const data = doc.data() || {};
        if (doc.exists && storeBelongsToAuth({ id: doc.id, ...data }, auth)) {
          return { id: doc.id, ...data };
        }
      } catch {
      }
    }
    const email = normalizeEmail(auth.email);
    const uid = normalizeUid(auth.uid);
    const attempts = [];
    if (email) {
      attempts.push(
        () => db.collection("stores").where("ownerEmail", "==", email).limit(1).get(),
        () => db.collection("stores").where("adminEmails", "array-contains", email).limit(1).get(),
        () => db.collection("stores").where("email", "==", email).limit(1).get(),
        () => db.collection("stores").where("userEmail", "==", email).limit(1).get()
      );
    }
    if (uid) {
      attempts.push(
        () => db.collection("stores").where("ownerId", "==", uid).limit(1).get(),
        () => db.collection("stores").where("ownerUid", "==", uid).limit(1).get(),
        () => db.collection("stores").where("userId", "==", uid).limit(1).get(),
        () => db.collection("stores").where("uid", "==", uid).limit(1).get()
      );
    }
    for (const attempt of attempts) {
      const snap = await attempt();
      if (!snap.empty) {
        const doc = snap.docs[0];
        if (!doc) continue;
        const data = doc.data() || {};
        if (storeBelongsToAuth({ id: doc.id, ...data }, auth)) {
          return { id: doc.id, ...data };
        }
      }
    }
    return null;
  }

  // src/renderer/bootstrap.ts
  window.PedraPcTs = {
    version: "0.1.0",
    firebaseConfig: firebaseWebConfig,
    storeRoleFields: getStoreRoleFields(),
    storeBelongsToAuth,
    resolveStoreForFirebaseUser,
    calculateInvoiceSummary
  };
  document.documentElement.dataset.pedradPcRuntime = "ts-bootstrap";
  console.info("[pedrad-pc] bootstrap ts ativo");
})();
//# sourceMappingURL=bootstrap.js.map
