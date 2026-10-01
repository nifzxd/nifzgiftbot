// Shared library: state, db, catalog, helpers, restart, refund worker - MongoDB version
const { MongoClient } = require('mongodb');
const path = require('path');
const config = require('../config');

// ==================== PATHS ====================
const ROOT        = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'config.js');

// ==================== STATE ====================
const state = {
  bot: null,
  OWNER_ID: 0,
  MARKUP_FLAT: 0,
  MARKUP_PERCENT: 0,
  LOG_CHANNEL_ID: null,
  INVOICE_COOLDOWN_SEC: 0,
  MAX_CUSTOM_TEXT_LEN: 0,
  BROADCAST_DELAY_MS: 0,

  restarting: false,
  sessions: new Map(),
  lastInvoiceAt: new Map(),
  pendingBroadcast: new Map(),
  awaitingBroadcast: new Set(),
};

state.applyConfig = (cfg) => {
  state.OWNER_ID             = cfg.OWNER_ID;
  state.MARKUP_FLAT          = cfg.MARKUP_FLAT;
  state.MARKUP_PERCENT       = cfg.MARKUP_PERCENT;
  state.LOG_CHANNEL_ID       = cfg.LOG_CHANNEL_ID;
  state.INVOICE_COOLDOWN_SEC = cfg.INVOICE_COOLDOWN_SEC;
  state.MAX_CUSTOM_TEXT_LEN  = cfg.MAX_CUSTOM_TEXT_LEN;
  state.BROADCAST_DELAY_MS   = cfg.BROADCAST_DELAY_MS;
};

// FIX: isOwner gak boleh auto-true pas OWNER_ID=0
state.isOwner       = (id) => state.OWNER_ID !== 0 && id === state.OWNER_ID;
state.getSession    = (id) => state.sessions.get(id) || {};
state.setSession    = (id, d) => state.sessions.set(id, d);
state.deleteSession = (id) => state.sessions.delete(id);

// ==================== CATALOG ====================
const GIFTS = {
  "5170145012310081615": { name: "Hati 💖",            price: 15  },
  "5170233102089322756": { name: "Boneka Beruang 🧸",  price: 15  },
  "5170250947678437525": { name: "Kotak Hadiah 🎁",    price: 25  },
  "5168103777563050263": { name: "Mawar 🌹",           price: 25  },
  "5170144170496491616": { name: "Kue Ulang Tahun 🎂", price: 50  },
  "5170314324215857265": { name: "Buket Bunga 💐",     price: 50  },
  "5170564780938756245": { name: "Roket 🚀",           price: 50  },
  "5168043875654172773": { name: "Piala 🏆",           price: 100 },
  "5170690322832818290": { name: "Cincin 💍",          price: 100 },
  "5170521118301225164": { name: "Berlian 💎",         price: 100 },
  "6028601630662853006": { name: "Sampanye 🍾",        price: 50  },
};

function calcDisplayPrice(base) {
  const pct = Math.round(base * state.MARKUP_PERCENT / 100);
  return base + state.MARKUP_FLAT + pct;
}

function calcMarkup(base) {
  return calcDisplayPrice(base) - base;
}

// ==================== MONGODB SINGLETON ====================
let client = null;
let db = null;

async function connectDB() {
  if (client && client.topology && client.topology.isConnected()) {
    return db;
  }

  const mongoUri = process.env.MONGODB_URI || config.MONGODB_URI || 'mongodb://localhost:27017/gift-bot';
  const dbName = process.env.MONGODB_DB || config.MONGODB_DB || 'gift-bot';

  try {
    client = new MongoClient(mongoUri, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      retryWrites: true,
    });

    await client.connect();
    db = client.db(dbName);

    await initializeCollections();

    console.log('✅ MongoDB connected');
    return db;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    throw err;
  }
}

async function initializeCollections() {
  try {
    const collections = await db.listCollections().toArray();
    const collNames = collections.map(c => c.name);

    if (!collNames.includes('users')) {
      await db.createCollection('users');
      console.log('📦 Created collection: users');
    }

    if (!collNames.includes('orders')) {
      await db.createCollection('orders');
      console.log('📦 Created collection: orders');
    }

    if (!collNames.includes('stats')) {
      await db.createCollection('stats');
      const existingStats = await db.collection('stats').findOne({ _id: 'global' });
      if (!existingStats) {
        await db.collection('stats').insertOne({
          _id: 'global',
          totalSold: 0,
          totalStars: 0,
          totalProfit: 0,
          updatedAt: new Date(),
        });
      }
      console.log('📦 Created collection: stats');
    }

    await db.collection('users').createIndex({ userId: 1 }, { unique: true });
    await db.collection('orders').createIndex({ orderId: 1 }, { unique: true });
    await db.collection('orders').createIndex({ userId: 1 });
    await db.collection('orders').createIndex({ status: 1 });
    await db.collection('orders').createIndex({ refundNextAt: 1 });
    await db.collection('orders').createIndex({ createdAt: 1 });

    console.log('✅ Collections initialized and indexes created');
  } catch (err) {
    console.error('⚠️ Error initializing collections:', err.message);
  }
}

async function disconnectDB() {
  if (client) {
    await client.close();
    console.log('🔌 MongoDB disconnected');
  }
}

// ==================== DB OPERATIONS (LEGACY) ====================

async function loadDB() {
  await connectDB();

  const users = await db.collection('users').find({}).toArray();
  const orders = await db.collection('orders').find({}).toArray();
  const stats = await db.collection('stats').findOne({ _id: 'global' });

  const usersObj = {};
  users.forEach(u => {
    const { _id, userId, ...data } = u;
    usersObj[userId] = data;
  });

  const ordersObj = {};
  orders.forEach(o => {
    const { _id, orderId, ...data } = o;
    if (orderId) ordersObj[orderId] = data;
  });

  return {
    users: usersObj,
    orders: ordersObj,
    stats: stats ? {
      totalSold: stats.totalSold,
      totalStars: stats.totalStars,
      totalProfit: stats.totalProfit
    } : { totalSold: 0, totalStars: 0, totalProfit: 0 },
    migrated_captcha_v1: true,
  };
}

async function saveDB(_unused) {
  // No-op: save dilakukan langsung per-document
  return { ok: true };
}

async function reloadDB() {
  return loadDB();
}

// ==================== ORDER HELPERS (MongoDB) ====================

async function createOrder(orderId, orderData) {
  await connectDB();
  await db.collection('orders').insertOne({
    orderId,
    ...orderData,
    _createdAt: new Date(),
  });
}

async function getOrder(orderId) {
  await connectDB();
  const o = await db.collection('orders').findOne({ orderId });
  if (!o) return null;
  const { _id, ...rest } = o;
  return rest;
}

async function updateOrder(orderId, updates) {
  await connectDB();
  const res = await db.collection('orders').updateOne(
    { orderId },
    { $set: { ...updates, updatedAt: new Date() } }
  );
  return res.matchedCount > 0;
}

async function incrementStats(displayPrice, profit) {
  await connectDB();
  await db.collection('stats').updateOne(
    { _id: 'global' },
    {
      $inc: { totalSold: 1, totalStars: displayPrice, totalProfit: profit },
      $set: { updatedAt: new Date() },
    }
  );
}

async function incrementUserOrder(userId, giftId, displayPrice) {
  await connectDB();
  const uid = String(userId);
  const now = Math.floor(Date.now() / 1000);

  const existing = await db.collection('users').findOne({ userId: uid });

  if (!existing) {
    await db.collection('users').insertOne({
      userId: uid,
      username: null,
      firstName: null,
      firstSeen: now,
      lastSeen: now,
      totalOrders: 1,
      totalSpent: displayPrice,
      giftCount: { [giftId]: 1 },
      verified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return;
  }

  await db.collection('users').updateOne(
    { userId: uid },
    {
      $inc: {
        totalOrders: 1,
        totalSpent: displayPrice,
        [`giftCount.${giftId}`]: 1,
      },
      $set: { lastSeen: now, updatedAt: new Date() },
    }
  );
}

async function getRecentOrders(userId, limit = 10) {
  await connectDB();
  const docs = await db.collection('orders')
    .find({ userId: String(userId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(({ _id, ...rest }) => rest);
}

async function getAllUserIds() {
  await connectDB();
  const docs = await db.collection('users')
    .find({}, { projection: { userId: 1 } })
    .toArray();
  return docs.map(d => d.userId);
}

// ==================== USER HELPERS ====================

async function trackUser(user) {
  await connectDB();
  const userId = String(user.id);
  const now = Math.floor(Date.now() / 1000);

  const existingUser = await db.collection('users').findOne({ userId });

  if (!existingUser) {
    await db.collection('users').insertOne({
      userId,
      username: user.username || null,
      firstName: user.first_name || null,
      firstSeen: now,
      lastSeen: now,
      totalOrders: 0,
      totalSpent: 0,
      giftCount: {},
      verified: false,
      verifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } else {
    await db.collection('users').updateOne(
      { userId },
      {
        $set: {
          lastSeen: now,
          username: user.username || existingUser.username,
          firstName: user.first_name || existingUser.firstName,
          updatedAt: new Date(),
        },
      }
    );
  }
}

async function isVerified(userId) {
  await connectDB();
  const u = await db.collection('users').findOne({ userId: String(userId) });
  return !!(u && u.verified === true);
}

// FIX: upsert supaya kalau user doc belum ada, tetap dibuat
async function markVerified(userId) {
  await connectDB();
  const now = Math.floor(Date.now() / 1000);
  await db.collection('users').updateOne(
    { userId: String(userId) },
    {
      $set: {
        verified: true,
        verifiedAt: now,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        username: null,
        firstName: null,
        firstSeen: now,
        lastSeen: now,
        totalOrders: 0,
        totalSpent: 0,
        giftCount: {},
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

async function clearPendingOrders(userId) {
  await connectDB();
  const uid = String(userId);
  const result = await db.collection('orders').deleteMany({
    userId: uid,
    status: 'pending',
  });
  return result.deletedCount;
}

async function getFavorites(userId, limit = 3) {
  await connectDB();
  const u = await db.collection('users').findOne({ userId: String(userId) });

  if (!u || !u.giftCount) return [];

  return Object.entries(u.giftCount)
    .sort((a, b) => b[1] - a[1])
    .map(([gid]) => gid)
    .filter(gid => GIFTS[gid])
    .slice(0, limit);
}

async function refundStars(userId, chargeId) {
  try {
    await state.bot.telegram.callApi('refundStarPayment', {
      user_id: userId,
      telegram_payment_charge_id: chargeId,
    });
    console.log(`💸 Refund sukses: user=${userId}, charge=${chargeId}`);
    return { ok: true };
  } catch (err) {
    console.error(`❌ Refund gagal: user=${userId}, charge=${chargeId}`, err.message);
    return { ok: false, error: err.message };
  }
}

async function resolveRecipient(ctx, rawInput) {
  await connectDB();
  const input = String(rawInput || '').trim();

  if (input.startsWith('@')) {
    const uname = input.slice(1).toLowerCase();
    if (!uname) return { ok: false, reason: 'empty_username' };

    const user = await db.collection('users').findOne({
      username: { $regex: `^${uname}$`, $options: 'i' },
    });

    if (!user) return { ok: false, reason: 'username_not_in_db' };
    return {
      ok: true,
      id: Number(user.userId),
      label: `@${user.username}`,
      inDb: true,
    };
  }

  if (/^\d+$/.test(input)) {
    try {
      const chat = await ctx.telegram.getChat(input);
      if (chat.type !== 'private') return { ok: false, reason: 'not_private' };

      const isInDb = await db.collection('users').findOne({ userId: String(chat.id) });

      return {
        ok: true,
        id: chat.id,
        label: chat.username ? `@${chat.username}` : (chat.first_name || String(chat.id)),
        inDb: !!isInDb,
      };
    } catch {
      return { ok: false, reason: 'id_unreachable' };
    }
  }

  return { ok: false, reason: 'invalid_format' };
}

function recipientErrorMessage(res) {
  switch (res.reason) {
    case 'empty_username':
      return "❌ Username kosong. Contoh: `@username`";
    case 'username_not_in_db':
      return "❌ *Username tidak ditemukan.*\n\nPenerima *harus pernah /start* bot ini dulu.\nMinta dia kirim /start, lalu coba lagi.";
    case 'not_private':
      return "❌ Penerima harus user pribadi, bukan grup/channel.";
    case 'id_unreachable':
      return "❌ ID tidak ditemukan.\nPastikan ID benar dan penerima sudah pernah /start bot ini.";
    default:
      return "❌ Input tidak valid.\n\nKirim *username* (contoh: `@username`) atau *ID numerik* (contoh: `123456789`).";
  }
}

async function logEvent(text) {
  if (!state.LOG_CHANNEL_ID || !state.bot) return;
  try {
    await state.bot.telegram.sendMessage(state.LOG_CHANNEL_ID, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('❌ logEvent gagal:', e.message);
  }
}

// ==================== HELPERS ====================
async function sendOrEdit(ctx, text, opts = {}) {
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, opts);
    } catch {
      await ctx.reply(text, opts).catch(() => {});
    }
  } else {
    await ctx.reply(text, opts).catch(() => {});
  }
}

// ==================== REFUND RETRY WORKER ====================
const REFUND_MAX_ATTEMPTS = 10;
const REFUND_INTERVAL_MS = 30_000;

function _backoffMs(attempts) {
  return Math.min(60_000 * Math.pow(5, attempts), 2 * 3600_000);
}

async function processRefunds() {
  await connectDB();
  const now = Date.now();

  const candidates = await db.collection('orders').find({
    status: 'failed',
    chargeId: { $exists: true },
    refundExhausted: { $ne: true },
    $or: [
      { refundNextAt: { $exists: false } },
      { refundNextAt: { $lte: now } },
    ],
  }).toArray();

  for (const order of candidates) {
    const res = await refundStars(order.userId, order.chargeId);

    if (res.ok) {
      await db.collection('orders').updateOne(
        { _id: order._id },
        {
          $set: {
            status: 'refunded',
            refundedAt: Math.floor(Date.now() / 1000),
            refundPending: false,
            updatedAt: new Date(),
          },
        }
      );

      await logEvent(`💸 *Refund Retry OK*\n🆔 \`${order.orderId || order._id}\``);

      if (state.OWNER_ID) {
        try {
          await state.bot.telegram.sendMessage(
            state.OWNER_ID,
            `💸 *Refund Retry Berhasil*\n🆔 \`${order.orderId || order._id}\`\n💸 \`${order.chargeId}\``,
            { parse_mode: 'Markdown' }
          );
        } catch {}
      }
    } else {
      const attempts = (order.refundAttempts || 0) + 1;

      if (attempts >= REFUND_MAX_ATTEMPTS) {
        await db.collection('orders').updateOne(
          { _id: order._id },
          {
            $set: {
              refundExhausted: true,
              refundAttempts: attempts,
              updatedAt: new Date(),
            },
          }
        );

        await logEvent(
          `🚨 *Refund GAGAL ${REFUND_MAX_ATTEMPTS}x — BUTUH MANUAL*\n` +
          `🆔 \`${order.orderId || order._id}\`\n👤 \`${order.userId}\`\n` +
          `💸 \`${order.chargeId}\`\n❗ ${res.error}`
        );

        if (state.OWNER_ID) {
          try {
            await state.bot.telegram.sendMessage(
              state.OWNER_ID,
              `🚨 *Refund Exhausted — Aksi Manual*\n🆔 \`${order.orderId || order._id}\`\n💸 \`${order.chargeId}\``,
              { parse_mode: 'Markdown' }
            );
          } catch {}
        }
      } else {
        await db.collection('orders').updateOne(
          { _id: order._id },
          {
            $set: {
              refundAttempts: attempts,
              refundNextAt: Date.now() + _backoffMs(attempts),
              updatedAt: new Date(),
            },
          }
        );

        console.log(
          `⏳ Refund retry #${attempts} untuk ${order.orderId || order._id} ` +
          `dalam ${Math.round(_backoffMs(attempts) / 1000)}s`
        );
      }
    }
  }
}

let _refundWorker = null;

function startRefundWorker() {
  if (_refundWorker) return;
  _refundWorker = setInterval(
    () => processRefunds().catch(err => console.error('refund worker error:', err.message)),
    REFUND_INTERVAL_MS
  );
  setTimeout(() => processRefunds().catch(() => {}), 5_000);
  console.log('♻️ Refund retry worker started');
}

// ==================== EXPORTS ====================
module.exports = {
  // paths
  ROOT, CONFIG_FILE,

  // mongodb
  connectDB, disconnectDB,

  // state
  state,
  isOwner: state.isOwner,
  getSession: state.getSession,
  setSession: state.setSession,
  deleteSession: state.deleteSession,

  // catalog
  GIFTS, calcDisplayPrice, calcMarkup,

  // db (legacy)
  loadDB, saveDB, reloadDB,

  // order helpers (MongoDB direct)
  createOrder, getOrder, updateOrder, incrementStats, incrementUserOrder,
  getRecentOrders, getAllUserIds,

  // user
  trackUser, isVerified, markVerified,

  // helpers
  sendOrEdit, clearPendingOrders, getFavorites, refundStars,
  resolveRecipient, recipientErrorMessage, logEvent,

  // refund worker
  startRefundWorker, processRefunds,
};