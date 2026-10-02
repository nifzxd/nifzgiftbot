const { Markup } = require('telegraf');
const S = require('./shared');
const { state } = S;

const CAPTCHA_EXPIRE_SEC   = 120;
const CAPTCHA_MAX_WRONG    = 3;
const CAPTCHA_COOLDOWN_SEC = 30;

function generateCaptcha() {
  const a = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 8) + 2;
  const useMul = Math.random() < 0.4;
  const op = useMul ? '×' : '+';
  const answer = useMul ? a * b : a + b;

  const options = new Set([answer]);
  let guard = 0;
  while (options.size < 4 && guard++ < 50) {
    const offset = Math.floor(Math.random() * 10) - 5;
    const wrong = answer + offset;
    if (wrong !== answer && wrong > 0) options.add(wrong);
  }
  let filler = answer + 1;
  while (options.size < 4) options.add(filler++);

  return {
    question: `${a} ${op} ${b} = ?`,
    answer,
    options: Array.from(options).sort(() => Math.random() - 0.5),
  };
}

async function showCaptcha(ctx, errorMsg = null, keepWrongCount = false) {
  const userId = ctx.from.id;
  const prev = state.getSession(userId);
  const now = Math.floor(Date.now() / 1000);

  if (prev.captchaCooldownUntil && now < prev.captchaCooldownUntil) {
    const wait = prev.captchaCooldownUntil - now;
    return S.sendOrEdit(
      ctx,
      `🚫 *Too many wrong answers.*\n\nTry again in *${wait} seconds*.`,
      { parse_mode: 'Markdown' }
    );
  }

  const wrongCount = keepWrongCount ? (prev.captchaWrongCount || 0) : 0;
  const cooldownUntil = (prev.captchaCooldownUntil && prev.captchaCooldownUntil > now)
    ? prev.captchaCooldownUntil : 0;

  const c = generateCaptcha();

  // FIX: captcha pake flag terpisah, JANGAN nimpa `step`
  state.setSession(userId, {
    ...prev,
    captchaActive: true,
    captchaAnswer: c.answer,
    captchaExpiresAt: now + CAPTCHA_EXPIRE_SEC,
    captchaWrongCount: wrongCount,
    captchaCooldownUntil: cooldownUntil,
  });

  const rows = [];
  for (let i = 0; i < c.options.length; i += 2) {
    const row = [Markup.button.callback(`🔢 ${c.options[i]}`, `captcha:${c.options[i]}`)];
    if (c.options[i + 1] !== undefined) {
      row.push(Markup.button.callback(`🔢 ${c.options[i + 1]}`, `captcha:${c.options[i + 1]}`));
    }
    rows.push(row);
  }

  const text =
    (errorMsg ? `${errorMsg}\n\n` : '') +
    `🤖 *Security Verification*\n\n` +
    `To prevent bots & spam, answer the following question:\n\n` +
    `❓ *${c.question}*\n\n` +
    `⏰ Question is valid for *${CAPTCHA_EXPIRE_SEC} seconds*.\n` +
    `⚠️ Max *${CAPTCHA_MAX_WRONG} wrong attempts*, then cooldown ${CAPTCHA_COOLDOWN_SEC} seconds.\n\n` +
    `Choose the correct answer:`;

  await S.sendOrEdit(ctx, text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(rows),
  });
}

function register(bot) {
  // === /start ===
  bot.start(async (ctx) => {
    await S.clearPendingOrders(ctx.from.id);
    state.deleteSession(ctx.from.id);
    state.awaitingBroadcast.delete(ctx.from.id);
    state.pendingBroadcast.delete(ctx.from.id);
    await S.trackUser(ctx.from);

    if (!state.isOwner(ctx.from.id) && !await S.isVerified(ctx.from.id)) {
      return showCaptcha(ctx);
    }
    return require('./menu').showMainMenu(ctx);
  });

  // === captcha action ===
  bot.action(/^captcha:(-?\d+)$/, async (ctx) => {
    const answer = Number(ctx.match[1]);
    const userId = ctx.from.id;
    const s = state.getSession(userId);
    const now = Math.floor(Date.now() / 1000);

    // FIX: cek flag captcha, bukan `step`
    if (!s.captchaActive || s.captchaAnswer === undefined) {
      return ctx.answerCbQuery('❌ Captcha session is not active').catch(() => {});
    }
    if (s.captchaCooldownUntil && now < s.captchaCooldownUntil) {
      const wait = s.captchaCooldownUntil - now;
      return ctx.answerCbQuery(`🚫 Wait ${wait}s more`).catch(() => {});
    }
    if (s.captchaExpiresAt && now > s.captchaExpiresAt) {
      await ctx.answerCbQuery('⏰ Question expired').catch(() => {});
      const { captchaActive, captchaAnswer, captchaExpiresAt, captchaWrongCount, captchaCooldownUntil, ...rest } = s;
      state.setSession(userId, rest);
      return showCaptcha(ctx, '⏰ *Time is up!* Here is a new question:', false);
    }

    if (answer === s.captchaAnswer) {
      await ctx.answerCbQuery('✅ Correct!').catch(() => {});
      await S.markVerified(userId);

      const { captchaActive, captchaAnswer, captchaExpiresAt, captchaWrongCount, captchaCooldownUntil, ...rest } = s;

      // Kalau user lagi di tengah order flow, lanjutin
      if (rest.step && ['await_recipient', 'await_text', 'ready', 'await_recipient_confirm'].includes(rest.step)) {
        state.setSession(userId, rest);
        return ctx.reply("✅ Verification successful! Continue your order.");
      }

      state.deleteSession(userId);
      await S.logEvent(
        `✅ *User Verified*\n` +
        `👤 ${ctx.from.first_name || '-'}${ctx.from.username ? ` (@${ctx.from.username})` : ''}\n` +
        `🆔 \`${ctx.from.id}\``
      );
      return require('./menu').showMainMenu(ctx);
    }

    const wrongCount = (s.captchaWrongCount || 0) + 1;
    if (wrongCount >= CAPTCHA_MAX_WRONG) {
      state.setSession(userId, {
        ...s,
        captchaActive: true,
        captchaWrongCount: 0,
        captchaCooldownUntil: now + CAPTCHA_COOLDOWN_SEC,
      });
      await ctx.answerCbQuery(`🚫 Cooldown ${CAPTCHA_COOLDOWN_SEC}s`).catch(() => {});
      return S.sendOrEdit(
        ctx,
        `🚫 *Too many wrong answers!*\n\nWait *${CAPTCHA_COOLDOWN_SEC} seconds* before trying again.`,
        { parse_mode: 'Markdown' }
      );
    }

    await ctx.answerCbQuery(`❌ Wrong (${wrongCount}/${CAPTCHA_MAX_WRONG})`).catch(() => {});
    return showCaptcha(
      ctx,
      `❌ Wrong answer (${wrongCount}/${CAPTCHA_MAX_WRONG}). Try again!`,
      true
    );
  });

  // === gate verifikasi (middleware global) ===
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    if (state.isOwner(userId)) return next();

    // ⭐ WHITELIST: payment update JANGAN di-block
    if (ctx.updateType === 'pre_checkout_query') return next();
    if (ctx.message?.successful_payment) return next();

    const txt = ctx.message?.text || '';
    if (txt.startsWith('/start')) return next();

    const cbData = ctx.callbackQuery?.data || '';
    if (cbData.startsWith('captcha:')) return next();

    if (await S.isVerified(userId)) return next();

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('🔒 Please verify first').catch(() => {});
    }
    return showCaptcha(ctx).catch(() => {});
  });
}

module.exports = { register, showCaptcha };