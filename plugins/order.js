const crypto = require('crypto');
const { Markup } = require('telegraf');
const S = require('./shared');
const { state, GIFTS, calcDisplayPrice } = S;

const PAYLOAD_PREFIX = 'order:';

async function askCustomText(ctx, s) {
  await S.sendOrEdit(
    ctx,
    `👤 Recipient: *${s.recipientLabel}*\n\n` +
    `✍️ Send the *text* you want to include (max ${state.MAX_CUSTOM_TEXT_LEN} characters).\n\n` +
    `Or click *No Text* if you don't want a custom message.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback("⏭️ No Text", "buy_skip")],
        [Markup.button.callback("❌ Cancel", "buy_cancel")],
      ]),
    }
  );
}

async function sendInvoice(ctx, s) {
  const gift = GIFTS[s.giftId];
  if (!gift) return ctx.reply("❌ Gift not found.");

  const userId = ctx.from.id;
  const now = Math.floor(Date.now() / 1000);

  const last = state.lastInvoiceAt.get(userId) || 0;
  if (now - last < state.INVOICE_COOLDOWN_SEC) {
    const wait = state.INVOICE_COOLDOWN_SEC - (now - last);
    state.deleteSession(userId);
    return ctx.reply(`⏳ Please wait ${wait} more seconds before creating a new order.`);
  }
  state.lastInvoiceAt.set(userId, now);

  const costPrice    = gift.price;
  const displayPrice = calcDisplayPrice(gift.price);

  const orderId = Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');

  await S.clearPendingOrders(userId);

  try {
    await S.createOrder(orderId, {
      userId: ctx.from.id,
      giftId: s.giftId,
      giftName: gift.name,
      recipientId: s.recipientId,
      recipientLabel: s.recipientLabel,
      customText: s.customText,
      senderName: ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name,
      price: displayPrice,
      costPrice,
      displayPrice,
      markup: displayPrice - costPrice,
      status: 'pending',
      chargeId: null,
      createdAt: now,
    });
  } catch (err) {
    console.error('❌ Gagal simpan order ke DB:', err.message);
    state.deleteSession(userId);
    return ctx.reply("❌ Failed to create order. Please try again in a moment.");
  }

  await ctx.reply(
    `📋 *Order Summary*\n\n` +
    `🎁 Gift: ${gift.name}\n` +
    `👤 Recipient: ${s.recipientLabel}\n` +
    `✍️ Text: ${s.customText || '(empty)'}\n` +
    `💰 Price: ${displayPrice}⭐`,
    { parse_mode: 'Markdown' }
  );

  try {
    await ctx.replyWithInvoice({
      title: gift.name,
      description: `Send ${gift.name} to ${s.recipientLabel}`,
      payload: `${PAYLOAD_PREFIX}${orderId}`,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: gift.name, amount: displayPrice }],
    });
  } catch (err) {
    console.error('❌ Gagal kirim invoice:', err.message);
    await S.updateOrder(orderId, { status: 'failed', error: err.message });
    state.deleteSession(userId);
    return ctx.reply("❌ Failed to create invoice. Please try again.");
  }

  await ctx.reply(
    "💳 Complete the payment using the button above.",
    Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "buy_cancel")]])
  );
}

function register(bot) {
  bot.action(/^buy:(.+)$/, async (ctx) => {
    const giftId = ctx.match[1];
    const gift = GIFTS[giftId];
    if (!gift) return ctx.answerCbQuery("❌ Gift not found");

    state.setSession(ctx.from.id, { step: 'await_recipient', giftId });
    await ctx.answerCbQuery();

    await S.sendOrEdit(
      ctx,
      `🎁 Gift: *${gift.name}* (${calcDisplayPrice(gift.price)}⭐)\n\n` +
      `Send the recipient's *username* (example: \`@username\`) or *account ID*.\n\n` +
      `⚠️ The recipient *must have /start* this bot first.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback("👤 Send to Myself", "buy_self")],
          [Markup.button.callback("❌ Cancel", "buy_cancel")],
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
      ? `@${ctx.from.username} (yourself)`
      : `${ctx.from.first_name} (yourself)`;
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
    await S.clearPendingOrders(ctx.from.id);
    state.deleteSession(ctx.from.id);
    await ctx.answerCbQuery("Canceled");
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
            [Markup.button.callback("👤 Send to Myself", "buy_self")],
            [Markup.button.callback("❌ Cancel", "buy_cancel")],
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
          "⚠️ *The recipient has never /start this bot.*\n\n" +
          "The gift will still be delivered, but the recipient won't get a notification from the bot.\n\n" +
          "Continue or cancel?",
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback("✅ Continue", "buy_confirm_send"),
               Markup.button.callback("❌ Cancel", "buy_cancel")],
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

  // Validasi SEBELUM charge user
  bot.on('pre_checkout_query', async (ctx) => {
    try {
      const payload = ctx.preCheckoutQuery.invoice_payload || '';
      const orderId = payload.startsWith(PAYLOAD_PREFIX)
        ? payload.slice(PAYLOAD_PREFIX.length)
        : null;

      if (!orderId) {
        return ctx.answerPreCheckoutQuery(false, {
          error_message: 'Invalid payload. Please create a new order.',
        });
      }

      const order = await S.getOrder(orderId);
      if (!order || order.status !== 'pending') {
        return ctx.answerPreCheckoutQuery(false, {
          error_message: 'Order is no longer valid. Please create a new order.',
        });
      }

      return ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error('❌ pre_checkout error:', err.message);
      return ctx.answerPreCheckoutQuery(false, {
        error_message: 'An error occurred. Please try again.',
      });
    }
  });

  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message.successful_payment;
    const payload = payment.invoice_payload || '';
    const orderId = payload.startsWith(PAYLOAD_PREFIX)
      ? payload.slice(PAYLOAD_PREFIX.length)
      : null;

    const order = orderId ? await S.getOrder(orderId) : null;

    // ---- CASE 1: Order tidak ditemukan ----
    if (!order) {
      console.error(`❌ Order ${orderId} tidak ditemukan. Refund otomatis...`);
      state.deleteSession(ctx.from.id);

      const r = await S.refundStars(ctx.from.id, payment.telegram_payment_charge_id);
      await S.logEvent(
        `⚠️ *Order not found, automatic refund*\n👤 User: ${ctx.from.id}\n` +
        `🆔 Payload: \`${payload}\`\n💰 Refund: ${r.ok ? '✅ OK' : '❌ FAILED'}`
      );

      return ctx.reply(
        r.ok
          ? "⚠️ Order not found. Your payment has been automatically refunded. 💸"
          : "❌ Order not found and refund failed. Please contact admin.",
        Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "buy_cancel")]])
      );
    }

    // ---- CASE 2: Order ditemukan, coba kirim gift ----
    const gift = GIFTS[order.giftId];
    if (!gift) {
      console.error(`❌ Gift ${order.giftId} tidak ada di catalog`);
      state.deleteSession(ctx.from.id);
      const r = await S.refundStars(ctx.from.id, payment.telegram_payment_charge_id);
      await S.updateOrder(orderId, {
        status: r.ok ? 'refunded' : 'failed',
        chargeId: payment.telegram_payment_charge_id,
        error: 'gift_not_in_catalog',
        refundedAt: r.ok ? Math.floor(Date.now() / 1000) : undefined,
      });
      return ctx.reply(
        r.ok
          ? "❌ Gift is unavailable. Your payment has been automatically refunded. 💸"
          : "❌ Gift is unavailable and refund failed. Please contact admin.",
        Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "buy_cancel")]])
      );
    }

    const costPrice    = order.costPrice    ?? gift.price;
    const displayPrice = order.displayPrice ?? order.price;
    const profit       = displayPrice - costPrice;

    // ⭐ text cuma dikirim kalau user nulis custom text.
    // Kalau "Tanpa Teks" → parameter `text` gak dikirim sama sekali.
    const sendGiftParams = {
      user_id: order.recipientId,
      gift_id: order.giftId,
    };

    if (order.customText) {
      sendGiftParams.text = order.customText.slice(0, state.MAX_CUSTOM_TEXT_LEN);
    }

    try {
      await ctx.telegram.callApi('sendGift', sendGiftParams);

      const paidAt = Math.floor(Date.now() / 1000);
      await S.updateOrder(orderId, {
        status: 'paid',
        chargeId: payment.telegram_payment_charge_id,
        paidAt,
      });
      await S.incrementStats(displayPrice, profit);
      await S.incrementUserOrder(order.userId, order.giftId, displayPrice);

      await ctx.reply(
        `✅ *${gift.name}* successfully sent to ${order.recipientLabel}!`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "buy_cancel")]]),
        }
      );

      if (order.recipientId !== order.userId) {
        try {
          await ctx.telegram.sendMessage(
            order.recipientId,
            `🎁 You just received a gift! Check your Telegram profile.`
          );
        } catch (_) {}
      }

      if (state.OWNER_ID) {
        try {
          await state.bot.telegram.sendMessage(
            state.OWNER_ID,
            `💰 *Order Successful!*\n\n` +
            `🎁 Gift: ${gift.name}\n` +
            `👤 Buyer: ${order.senderName} (\`${order.userId}\`)\n` +
            `🎯 Recipient: ${order.recipientLabel}\n` +
            `💵 Paid: ${displayPrice}⭐\n🏷️ Cost: ${costPrice}⭐\n💰 Profit: ${profit}⭐\n` +
            `🆔 \`${orderId}\``,
            { parse_mode: 'Markdown' }
          );
        } catch (_) {}
      }

      await S.logEvent(
        `✅ *Order Successful*\n\n🎁 ${gift.name}\n` +
        `👤 ${order.senderName} (\`${order.userId}\`)\n` +
        `🎯 ${order.recipientLabel}\n💵 ${displayPrice}⭐ (profit ${profit}⭐)\n🆔 \`${orderId}\``
      );

    } catch (err) {
      // ---- CASE 3: Kirim gift gagal → refund ----
      console.error('❌ Gagal kirim gift:', err.message);
      const refund = await S.refundStars(ctx.from.id, payment.telegram_payment_charge_id);

      if (refund.ok) {
        await S.updateOrder(orderId, {
          status: 'refunded',
          chargeId: payment.telegram_payment_charge_id,
          error: err.message,
          refundOk: true,
          refundedAt: Math.floor(Date.now() / 1000),
        });

        await ctx.reply(
          `❌ Failed to send gift (${err.message}).\n\n` +
          `💸 *Your payment has been automatically refunded* (${displayPrice}⭐).\n` +
          `Check your Stars balance on Telegram.\n\n` +
          `Refund code: \`${payment.telegram_payment_charge_id}\``,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "buy_cancel")]]),
          }
        );

        await S.logEvent(
          `💸 *Automatic Refund OK*\n\n🎁 ${gift.name}\n` +
          `👤 ${order.senderName} (\`${order.userId}\`)\n❗ Error: ${err.message}\n🆔 \`${orderId}\``
        );

        if (state.OWNER_ID) {
          try {
            await state.bot.telegram.sendMessage(
              state.OWNER_ID,
              `💸 *Automatic Refund Successful*\n\n🎁 ${gift.name} — ${displayPrice}⭐\n` +
              `👤 ${order.senderName}\n❗ Error: ${err.message}`,
              { parse_mode: 'Markdown' }
            );
          } catch (_) {}
        }

      } else {
        await S.updateOrder(orderId, {
          status: 'failed',
          chargeId: payment.telegram_payment_charge_id,
          error: err.message,
          refundAttempts: 0,
          refundNextAt: Date.now() + 60_000,
          refundExhausted: false,
        });

        await S.logEvent(
          `🚨 *REFUND FAILED — RETRY SCHEDULED*\n\n🎁 ${gift.name}\n` +
          `👤 ${order.senderName} (\`${order.userId}\`)\n` +
          `💸 Charge: \`${payment.telegram_payment_charge_id}\`\n` +
          `❗ Error: ${refund.error}\n🆔 \`${orderId}\``
        );

        if (state.OWNER_ID) {
          try {
            await state.bot.telegram.sendMessage(
              state.OWNER_ID,
              `🚨 *Refund Failed — Auto-Retry Scheduled*\n\n` +
              `👤 Buyer: ${order.senderName} (${order.userId})\n` +
              `🎁 Gift: ${gift.name}\n` +
              `💸 Charge ID: \`${payment.telegram_payment_charge_id}\`\n` +
              `❗ Error: ${refund.error}\n\n` +
              `_The bot will retry the refund automatically every few minutes._`,
              { parse_mode: 'Markdown' }
            );
          } catch (_) {}
        }

        await ctx.reply(
          `❌ Failed to send gift. Your payment is *being processed for automatic refund*.\n\n` +
          `If it hasn't arrived within 1 hour, contact admin with this code:\n` +
          `\`${payment.telegram_payment_charge_id}\``,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Main Menu", "buy_cancel")]]),
          }
        );
      }
    }

    state.deleteSession(order.userId);
  });
}

module.exports = { register, sendInvoice, askCustomText };