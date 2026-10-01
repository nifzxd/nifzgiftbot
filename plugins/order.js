const crypto = require('crypto');
const { Markup } = require('telegraf');
const S = require('./shared');
const { state, GIFTS, calcDisplayPrice } = S;

async function askCustomText(ctx, s) {
  await S.sendOrEdit(
    ctx,
    `👤 Penerima: *${s.recipientLabel}*\n\n` +
    `✍️ Kirim *teks* yang ingin disertakan (maks ${state.MAX_CUSTOM_TEXT_LEN} karakter).\n\n` +
    `Atau klik *Tanpa Teks* kalau tidak mau pakai pesan kustom.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback("⏭️ Tanpa Teks", "buy_skip")],
        [Markup.button.callback("❌ Batal", "buy_cancel")],
      ]),
    }
  );
}

async function sendInvoice(ctx, s) {
  const gift = GIFTS[s.giftId];
  if (!gift) return ctx.reply("❌ Gift tidak ditemukan.");

  const userId = ctx.from.id;
  const now = Math.floor(Date.now() / 1000);

  const last = state.lastInvoiceAt.get(userId) || 0;
  if (now - last < state.INVOICE_COOLDOWN_SEC) {
    const wait = state.INVOICE_COOLDOWN_SEC - (now - last);
    state.deleteSession(userId);
    return ctx.reply(`⏳ Sabar ya, tunggu ${wait} detik lagi sebelum buat order baru.`);
  }
  state.lastInvoiceAt.set(userId, now);

  const costPrice    = gift.price;
  const displayPrice = calcDisplayPrice(gift.price);
  
  const orderId = Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');

  const db = await S.loadDB();
  await S.clearPendingOrders(userId);

  db.orders[orderId] = {
    userId: ctx.from.id,
    giftId: s.giftId,
    giftName: gift.name,
    recipientId: s.recipientId,
    recipientLabel: s.recipientLabel,
    customText: s.customText,
    senderName: ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name,
    price: displayPrice,
    costPrice, displayPrice,
    markup: displayPrice - costPrice,
    status: 'pending',
    chargeId: null,
    createdAt: now,
  };
  await S.saveDB();

  await ctx.reply(
    `📋 *Ringkasan Pesanan*\n\n` +
    `🎁 Gift: ${gift.name}\n` +
    `👤 Penerima: ${s.recipientLabel}\n` +
    `✍️ Teks: ${s.customText || '(kosong)'}\n` +
    `💰 Harga: ${displayPrice}⭐`,
    { parse_mode: 'Markdown' }
  );

  await ctx.replyWithInvoice({
    title: gift.name,
    description: `Kirim ${gift.name} ke ${s.recipientLabel}`,
    payload: `order:${orderId}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: gift.name, amount: displayPrice }],
  });

  await ctx.reply(
    "💳 Selesaikan pembayaran lewat tombol di atas.",
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu Utama", "buy_cancel")]])
  );
}

function register(bot) {
  bot.action(/^buy:(.+)$/, async (ctx) => {
    const giftId = ctx.match[1];
    const gift = GIFTS[giftId];
    if (!gift) return ctx.answerCbQuery("❌ Gift tidak ditemukan");

    state.setSession(ctx.from.id, { step: 'await_recipient', giftId });
    await ctx.answerCbQuery();

    await S.sendOrEdit(
      ctx,
      `🎁 Gift: *${gift.name}* (${calcDisplayPrice(gift.price)}⭐)\n\n` +
      `Kirim *username* (contoh: \`@username\`) atau *ID akun* penerima.\n\n` +
      `⚠️ Penerima *harus pernah /start* bot ini dulu.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback("👤 Kirim ke Diri Sendiri", "buy_self")],
          [Markup.button.callback("❌ Batal", "buy_cancel")],
        ]),
      }
    );
  });

  bot.action('buy_self', async (ctx) => {
    const userId = ctx.from.id;
    const s = state.getSession(userId);
    if (s.step !== 'await_recipient') return ctx.answerCbQuery();

    s.recipientId = userId;
    s.recipientLabel = ctx.from.username
      ? `@${ctx.from.username} (diri sendiri)`
      : `${ctx.from.first_name} (diri sendiri)`;
    s.step = 'await_text';
    state.setSession(userId, s);

    await ctx.answerCbQuery();
    await askCustomText(ctx, s);
  });

  bot.action('buy_skip', async (ctx) => {
    const userId = ctx.from.id;
    const s = state.getSession(userId);
    if (s.step !== 'await_text') return ctx.answerCbQuery();

    s.customText = '';
    s.step = 'ready';
    state.setSession(userId, s);

    await ctx.answerCbQuery();
    return sendInvoice(ctx, s);
  });

  bot.action('buy_cancel', async (ctx) => {
    if (await S.clearPendingOrders(ctx.from.id) > 0) await S.saveDB();
    state.deleteSession(ctx.from.id);
    await ctx.answerCbQuery("Dibatalkan");
    return require('./menu').showMainMenu(ctx);
  });

  bot.action('buy_confirm_send', async (ctx) => {
    const userId = ctx.from.id;
    const s = state.getSession(userId);
    if (s.step !== 'await_recipient_confirm') return ctx.answerCbQuery();

    s.step = 'await_text';
    state.setSession(userId, s);
    await ctx.answerCbQuery();
    return askCustomText(ctx, s);
  });

  // ---- text dispatcher untuk step order ----
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();

    const s = state.getSession(userId);

    if (s.step === 'await_recipient') {
      const res = await S.resolveRecipient(ctx, text);
      if (!res.ok) {
        await ctx.reply(S.recipientErrorMessage(res), {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback("👤 Kirim ke Diri Sendiri", "buy_self")],
            [Markup.button.callback("❌ Batal", "buy_cancel")],
          ]),
        });
        return;
      }

      if (!res.inDb) {
        s.recipientId = res.id;
        s.recipientLabel = res.label;
        s.step = 'await_recipient_confirm';
        state.setSession(userId, s);

        await ctx.reply(
          "⚠️ *Penerima belum pernah /start bot ini.*\n\n" +
          "Gift akan tetap terkirim, tapi penerima nggak akan dapat notif dari bot.\n\n" +
          "Lanjut apa batal?",
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback("✅ Lanjut", "buy_confirm_send"),
               Markup.button.callback("❌ Batal", "buy_cancel")],
            ]),
          }
        );
        return;
      }

      s.recipientId    = res.id;
      s.recipientLabel = res.label;
      s.step           = 'await_text';
      state.setSession(userId, s);
      return askCustomText(ctx, s);
    }

    if (s.step === 'await_text') {
      s.customText = text.slice(0, state.MAX_CUSTOM_TEXT_LEN);
      s.step = 'ready';
      state.setSession(userId, s);
      return sendInvoice(ctx, s);
    }

    return next();
  });

  // ==================== PAYMENT ====================
  bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const payload = payment.invoice_payload || '';
    const orderId = payload.includes(':') ? payload.split(':')[1] : null;

    const db = await S.loadDB();
    const order = orderId ? db.orders[orderId] : null;

    if (!order) {
      console.error(`❌ Order ${orderId} tidak ditemukan. Refund otomatis...`);
      const r = await S.refundStars(ctx.from.id, payment.telegram_payment_charge_id);
      await S.logEvent(
        `⚠️ *Order tidak ditemukan, refund otomatis*\n👤 User: ${ctx.from.id}\n` +
        `🆔 Payload: \`${payload}\`\n💰 Refund: ${r.ok ? '✅ OK' : '❌ GAGAL'}`
      );
      return ctx.reply(
        r.ok
          ? "⚠️ Order tidak ditemukan. Pembayaran kamu sudah otomatis direfund. 💸"
          : "❌ Order tidak ditemukan dan refund gagal. Hubungi admin.",
        Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu Utama", "buy_cancel")]])
      );
    }

    const gift = GIFTS[order.giftId];
    const costPrice    = order.costPrice    ?? gift.price;
    const displayPrice = order.displayPrice ?? order.price;
    const profit       = displayPrice - costPrice;

    let finalText = order.customText
      ? `Dari ${order.senderName}: ${order.customText}`
      : `Dari ${order.senderName}`;
    finalText = finalText.slice(0, state.MAX_CUSTOM_TEXT_LEN);

    try {
      await ctx.telegram.callApi('sendGift', {
        user_id: order.recipientId,
        gift_id: order.giftId,
        text: finalText,
      });

      order.status = 'paid';
      order.chargeId = payment.telegram_payment_charge_id;
      order.paidAt = Math.floor(Date.now() / 1000);
      db.stats.totalSold += 1;
      db.stats.totalStars += displayPrice;
      db.stats.totalProfit = (db.stats.totalProfit || 0) + profit;

      const uid = String(order.userId);
      if (!db.users[uid]) {
        db.users[uid] = {
          username: null, firstName: null,
          firstSeen: order.paidAt, lastSeen: order.paidAt,
          totalOrders: 0, totalSpent: 0, giftCount: {}, verified: true,
        };
      }
      db.users[uid].totalOrders += 1;
      db.users[uid].totalSpent  += displayPrice;
      if (!db.users[uid].giftCount) db.users[uid].giftCount = {};
      db.users[uid].giftCount[order.giftId] = (db.users[uid].giftCount[order.giftId] || 0) + 1;
      
      const saveResult = await S.saveDB();
      if (!saveResult.ok) {
        console.error('❌ DB save failed after gift sent!', saveResult.error);
        await S.logEvent(
          `🚨 *Gift sent tapi DB save failed*\n` +
          `🆔 \`${orderId}\`\n👤 \`${order.userId}\`\n` +
          `⚠️ \`${saveResult.error}\``
        );
      }

      await ctx.reply(
        `✅ *${gift.name}* berhasil dikirim ke ${order.recipientLabel}!`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu Utama", "buy_cancel")]]),
        }
      );

      if (order.recipientId !== order.userId) {
        try {
          await ctx.telegram.sendMessage(order.recipientId, `🎁 Kamu baru saja menerima gift! Cek profil Telegram kamu.`);
        } catch (_) {}
      }

      if (state.OWNER_ID) {
        try {
          await state.bot.telegram.sendMessage(
            state.OWNER_ID,
            `💰 *Order Sukses!*\n\n` +
            `🎁 Gift: ${gift.name}\n` +
            `👤 Buyer: ${order.senderName} (\`${order.userId}\`)\n` +
            `🎯 Penerima: ${order.recipientLabel}\n` +
            `💵 Dibayar: ${displayPrice}⭐\n🏷️ Cost: ${costPrice}⭐\n💰 Profit: ${profit}⭐\n` +
            `🆔 \`${orderId}\``,
            { parse_mode: 'Markdown' }
          );
        } catch (_) {}
      }

      await S.logEvent(
        `✅ *Order Sukses*\n\n🎁 ${gift.name}\n` +
        `👤 ${order.senderName} (\`${order.userId}\`)\n` +
        `🎯 ${order.recipientLabel}\n💵 ${displayPrice}⭐ (profit ${profit}⭐)\n🆔 \`${orderId}\``
      );

    } catch (err) {
      console.error('❌ Gagal kirim gift:', err.message);
      const refund = await S.refundStars(ctx.from.id, payment.telegram_payment_charge_id);
      order.chargeId = payment.telegram_payment_charge_id;
      order.error = err.message;
      order.refundOk = refund.ok;

      if (refund.ok) {
        order.status = 'refunded';
        order.refundedAt = Math.floor(Date.now() / 1000);
        await S.saveDB();

        await ctx.reply(
          `❌ Gift gagal dikirim (${err.message}).\n\n` +
          `💸 *Pembayaran kamu sudah otomatis direfund* (${displayPrice}⭐).\n` +
          `Cek saldo Stars kamu di Telegram.\n\n` +
          `Kode refund: \`${payment.telegram_payment_charge_id}\``,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu Utama", "buy_cancel")]]),
          }
        );

        await S.logEvent(
          `💸 *Refund Otomatis OK*\n\n🎁 ${gift.name}\n` +
          `👤 ${order.senderName} (\`${order.userId}\`)\n❗ Error: ${err.message}\n🆔 \`${orderId}\``
        );

        if (state.OWNER_ID) {
          try {
            await state.bot.telegram.sendMessage(
              state.OWNER_ID,
              `💸 *Refund Otomatis Berhasil*\n\n🎁 ${gift.name} — ${displayPrice}⭐\n` +
              `👤 ${order.senderName}\n❗ Error: ${err.message}`,
              { parse_mode: 'Markdown' }
            );
          } catch (_) {}
        }
      } else {
        order.status = 'failed';
        order.chargeId = payment.telegram_payment_charge_id;
        order.refundAttempts = 0;
        order.refundNextAt = Date.now() + 60_000;
        order.refundExhausted = false;
        await S.saveDB();

        await S.logEvent(
          `🚨 *REFUND GAGAL — DIJADWALKAN RETRY*\n\n🎁 ${gift.name}\n` +
          `👤 ${order.senderName} (\`${order.userId}\`)\n` +
          `💸 Charge: \`${payment.telegram_payment_charge_id}\`\n` +
          `❗ Error: ${refund.error}\n🆔 \`${orderId}\``
        );

        if (state.OWNER_ID) {
          try {
            await state.bot.telegram.sendMessage(
              state.OWNER_ID,
              `🚨 *Refund Gagal — Auto-Retry Dijadwalkan*\n\n` +
              `👤 Buyer: ${order.senderName} (${order.userId})\n` +
              `🎁 Gift: ${gift.name}\n` +
              `💸 Charge ID: \`${payment.telegram_payment_charge_id}\`\n` +
              `❗ Error: ${refund.error}\n\n` +
              `_Bot akan coba refund otomatis tiap beberapa menit._`,
              { parse_mode: 'Markdown' }
            );
          } catch (_) {}
        }

        await ctx.reply(
          `❌ Gift gagal dikirim. Pembayaran kamu *sedang diproses refund otomatis*.\n\n` +
          `Kalau dalam 1 jam belum masuk, hubungi admin dengan kode:\n` +
          `\`${payment.telegram_payment_charge_id}\``,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu Utama", "buy_cancel")]]),
          }
        );
      }
    }

    state.deleteSession(order.userId);
  });
}

module.exports = { register, sendInvoice, askCustomText };
