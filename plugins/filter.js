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
      `🚫 *Terlalu banyak jawaban salah.*\n\nCoba lagi dalam *${wait} detik*.`,
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
    `🤖 *Verifikasi Keamanan*\n\n` +
    `Untuk mencegah bot & spam, jawab pertanyaan berikut:\n\n` +
    `❓ *${c.question}*\n\n` +
    `⏰ Soal berlaku *${CAPTCHA_EXPIRE_SEC} detik*.\n` +
    `⚠️ Maks *${CAPTCHA_MAX_WRONG}x salah*, setelah itu cooldown ${CAPTCHA_COOLDOWN_SEC} detik.\n\n` +
    `Pilih jawaban yang benar:`;

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
      return ctx.answerCbQuery('❌ Sesi captcha tidak aktif').catch(() => {});
    }
    if (s.captchaCooldownUntil && now < s.captchaCooldownUntil) {
      const wait = s.captchaCooldownUntil - now;
      return ctx.answerCbQuery(`🚫 Tunggu ${wait}s lagi`).catch(() => {});
    }
    if (s.captchaExpiresAt && now > s.captchaExpiresAt) {
      await ctx.answerCbQuery('⏰ Soal expired').catch(() => {});
      const { captchaActive, captchaAnswer, captchaExpiresAt, captchaWrongCount, captchaCooldownUntil, ...rest } = s;
      state.setSession(userId, rest);
      return showCaptcha(ctx, '⏰ *Waktu habis!* Ini soal baru:', false);
    }

    if (answer === s.captchaAnswer) {
      await ctx.answerCbQuery('✅ Benar!').catch(() => {});
      await S.markVerified(userId);

      const { captchaActive, captchaAnswer, captchaExpiresAt, captchaWrongCount, captchaCooldownUntil, ...rest } = s;

      // Kalau user lagi di tengah order flow, lanjutin
      if (rest.step && ['await_recipient', 'await_text', 'ready', 'await_recipient_confirm'].includes(rest.step)) {
        state.setSession(userId, rest);
        return ctx.reply("✅ Verifikasi berhasil! Lanjutkan pesanan kamu ya.");
      }

      state.deleteSession(userId);
      await S.logEvent(
        `✅ *User Terverifikasi*\n` +
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
        `🚫 *Terlalu banyak jawaban salah!*\n\nTunggu *${CAPTCHA_COOLDOWN_SEC} detik* sebelum coba lagi.`,
        { parse_mode: 'Markdown' }
      );
    }

    await ctx.answerCbQuery(`❌ Salah (${wrongCount}/${CAPTCHA_MAX_WRONG})`).catch(() => {});
    return showCaptcha(
      ctx,
      `❌ Jawaban salah (${wrongCount}/${CAPTCHA_MAX_WRONG}). Coba lagi!`,
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
      await ctx.answerCbQuery('🔒 Verifikasi dulu ya').catch(() => {});
    }
    return showCaptcha(ctx).catch(() => {});
  });
}

module.exports = { register, showCaptcha };