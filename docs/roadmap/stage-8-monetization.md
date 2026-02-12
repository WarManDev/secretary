# Этап 8: Монетизация — подписки, биллинг, кредиты

> **Зависимости:** Этап 5 (Telegram Pro)
>
> **Срок выполнения:** 5-7 дней
>
> **Цель:** Реализовать систему подписок, обработку платежей (Stripe + ЮKassa для России), систему кредитов, ограничения по тарифным планам и rate limiting на основе тарифа.

---

## Тарифные планы

| План | Цена | Сообщений/день | Модели | Функции |
|------|------|----------------|--------|---------|
| **Free** | $0 | 50 | Haiku | Календарь, заметки (ограниченно) |
| **Professional** | $19/мес | 500 | Haiku + Sonnet | + Gmail, TTS, Vision, задачи |
| **Business** | $49/мес | безлимит | Haiku + Sonnet | + Google Docs, CRM, API доступ |
| **Enterprise** | договорная | безлимит | Haiku + Sonnet + Opus | + приоритетная поддержка, кастомизация |

---

## 1. Модели и миграции

### Модель Subscription

**Файл:** `src/models/Subscription.js`

```javascript
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Subscription = sequelize.define('Subscription', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    },
    tier: {
      type: DataTypes.ENUM('free', 'professional', 'business', 'enterprise'),
      allowNull: false,
      defaultValue: 'free',
    },
    status: {
      type: DataTypes.ENUM('active', 'cancelled', 'past_due', 'trial'),
      allowNull: false,
      defaultValue: 'active',
    },
    stripe_subscription_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    current_period_start: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    current_period_end: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 дней
    },
    cancel_at_period_end: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  }, {
    tableName: 'subscriptions',
    timestamps: true,
    underscored: true,
  });

  Subscription.associate = (models) => {
    Subscription.belongsTo(models.User, { foreignKey: 'user_id' });
    Subscription.hasMany(models.Payment, { foreignKey: 'subscription_id' });
  };

  return Subscription;
};
```

### Модель Payment

**Файл:** `src/models/Payment.js`

```javascript
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Payment = sequelize.define('Payment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
    },
    subscription_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'subscriptions', key: 'id' },
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'USD',
    },
    status: {
      type: DataTypes.ENUM('pending', 'succeeded', 'failed', 'refunded'),
      allowNull: false,
      defaultValue: 'pending',
    },
    provider: {
      type: DataTypes.ENUM('stripe', 'yukassa'),
      allowNull: false,
    },
    provider_payment_id: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  }, {
    tableName: 'payments',
    timestamps: true,
    underscored: true,
  });

  Payment.associate = (models) => {
    Payment.belongsTo(models.User, { foreignKey: 'user_id' });
    Payment.belongsTo(models.Subscription, { foreignKey: 'subscription_id' });
  };

  return Payment;
};
```

### Модель CreditTransaction

**Файл:** `src/models/CreditTransaction.js`

```javascript
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const CreditTransaction = sequelize.define('CreditTransaction', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
    },
    type: {
      type: DataTypes.ENUM('usage', 'purchase', 'bonus', 'refund'),
      allowNull: false,
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Количество кредитов (отрицательное для списания)',
    },
    balance_after: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    model_used: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'claude-haiku-4-5, claude-sonnet-4-5, claude-opus-4-6',
    },
    tokens_input: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    tokens_output: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    tableName: 'credit_transactions',
    timestamps: true,
    underscored: true,
  });

  CreditTransaction.associate = (models) => {
    CreditTransaction.belongsTo(models.User, { foreignKey: 'user_id' });
  };

  return CreditTransaction;
};
```

### Миграции

**Файл:** `src/migrations/XXXXXX-create-subscriptions.js`

```javascript
export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('subscriptions', {
    id: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    },
    tier: {
      type: Sequelize.ENUM('free', 'professional', 'business', 'enterprise'),
      allowNull: false,
      defaultValue: 'free',
    },
    status: {
      type: Sequelize.ENUM('active', 'cancelled', 'past_due', 'trial'),
      allowNull: false,
      defaultValue: 'active',
    },
    stripe_subscription_id: {
      type: Sequelize.STRING,
      allowNull: true,
    },
    current_period_start: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    current_period_end: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    cancel_at_period_end: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    updated_at: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });

  await queryInterface.addIndex('subscriptions', ['user_id'], { unique: true });
  await queryInterface.addIndex('subscriptions', ['stripe_subscription_id']);
  await queryInterface.addIndex('subscriptions', ['status']);
}

export async function down(queryInterface) {
  await queryInterface.dropTable('subscriptions');
}
```

---

## 2. Tier Limits — лимиты по тарифам

**Файл:** `src/services/billing/tierLimits.js`

```javascript
const TIER_LIMITS = {
  free: {
    messagesPerDay: 50,
    models: ['claude-haiku-4-5-20251001'],
    features: ['calendar', 'notes_limited'],
    maxNotes: 10,
    maxTasks: 0,
    integrations: [],
  },
  professional: {
    messagesPerDay: 500,
    models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'],
    features: ['calendar', 'notes', 'tasks', 'gmail', 'tts', 'vision'],
    maxNotes: Infinity,
    maxTasks: Infinity,
    integrations: ['google_calendar', 'gmail'],
  },
  business: {
    messagesPerDay: Infinity,
    models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'],
    features: ['all'],
    maxNotes: Infinity,
    maxTasks: Infinity,
    integrations: ['google_calendar', 'gmail', 'google_drive', 'crm'],
  },
  enterprise: {
    messagesPerDay: Infinity,
    models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', 'claude-opus-4-6'],
    features: ['all', 'priority_support', 'custom'],
    maxNotes: Infinity,
    maxTasks: Infinity,
    integrations: ['all'],
  },
};

export function getTierLimits(tier) {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

export function checkLimit(user, action) {
  const limits = getTierLimits(user.subscription_tier);

  // Проверка доступности функции
  if (action.type === 'feature' && limits.features[0] !== 'all') {
    if (!limits.features.includes(action.feature)) {
      return {
        allowed: false,
        reason: `Функция "${action.feature}" доступна начиная с тарифа Professional`,
        upgradeRequired: 'professional',
      };
    }
  }

  // Проверка доступности модели
  if (action.type === 'model') {
    if (!limits.models.includes(action.model)) {
      return {
        allowed: false,
        reason: `Модель ${action.model} доступна на более высоком тарифе`,
        upgradeRequired: 'professional',
      };
    }
  }

  return { allowed: true };
}

export function getAvailableFeatures(tier) {
  const limits = getTierLimits(tier);
  return limits.features;
}
```

---

## 3. Subscription Service

**Файл:** `src/services/billing/subscriptionService.js`

```javascript
import models from '../../models/index.js';
import logger from '../../config/logger.js';

export async function createSubscription(userId, tier = 'free') {
  const subscription = await models.Subscription.create({
    user_id: userId,
    tier,
    status: tier === 'free' ? 'active' : 'trial',
    current_period_start: new Date(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  // Обновить тариф в User
  await models.User.update(
    { subscription_tier: tier },
    { where: { id: userId } }
  );

  logger.info(`Subscription created: user=${userId}, tier=${tier}`);
  return subscription;
}

export async function getSubscription(userId) {
  const subscription = await models.Subscription.findOne({
    where: { user_id: userId },
    include: [{ model: models.User, attributes: ['id', 'username', 'email'] }],
  });

  if (!subscription) {
    // Создать бесплатную подписку, если её нет
    return createSubscription(userId, 'free');
  }

  return subscription;
}

export async function updateSubscription(userId, updates) {
  const subscription = await models.Subscription.findOne({ where: { user_id: userId } });

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  await subscription.update(updates);

  // Синхронизировать с User
  if (updates.tier) {
    await models.User.update(
      { subscription_tier: updates.tier },
      { where: { id: userId } }
    );
  }

  logger.info(`Subscription updated: user=${userId}, updates=${JSON.stringify(updates)}`);
  return subscription;
}

export async function cancelSubscription(userId, immediately = false) {
  const subscription = await models.Subscription.findOne({ where: { user_id: userId } });

  if (!subscription) {
    throw new Error('Subscription not found');
  }

  if (immediately) {
    // Немедленная отмена → downgrade до Free
    await subscription.update({
      tier: 'free',
      status: 'cancelled',
    });

    await models.User.update(
      { subscription_tier: 'free' },
      { where: { id: userId } }
    );
  } else {
    // Отмена в конце периода
    await subscription.update({ cancel_at_period_end: true });
  }

  logger.info(`Subscription cancelled: user=${userId}, immediately=${immediately}`);
  return subscription;
}

export async function handlePeriodEnd(subscriptionId) {
  const subscription = await models.Subscription.findByPk(subscriptionId);

  if (!subscription) return;

  if (subscription.cancel_at_period_end) {
    // Downgrade to Free
    await subscription.update({
      tier: 'free',
      status: 'cancelled',
      cancel_at_period_end: false,
    });

    await models.User.update(
      { subscription_tier: 'free' },
      { where: { id: subscription.user_id } }
    );

    logger.info(`Subscription downgraded to free: user=${subscription.user_id}`);
  } else {
    // Продлить период
    await subscription.update({
      current_period_start: subscription.current_period_end,
      current_period_end: new Date(subscription.current_period_end.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
  }
}
```

---

## 4. Credit Service

**Файл:** `src/services/billing/creditService.js`

```javascript
import models from '../../models/index.js';
import logger from '../../config/logger.js';
import { getTierLimits } from './tierLimits.js';

// Цены на модели (за 1M токенов)
const MODEL_PRICING = {
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
};

export async function trackUsage(userId, usage) {
  const { model, tokensInput, tokensOutput, action } = usage;

  // Рассчитать стоимость
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-haiku-4-5-20251001'];
  const cost = (tokensInput / 1_000_000) * pricing.input + (tokensOutput / 1_000_000) * pricing.output;

  // Списать кредиты (1 кредит = $0.01)
  const creditsToDeduct = Math.ceil(cost * 100);

  // Получить текущий баланс (из последней транзакции)
  const lastTransaction = await models.CreditTransaction.findOne({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
  });

  const currentBalance = lastTransaction ? lastTransaction.balance_after : 0;
  const newBalance = currentBalance - creditsToDeduct;

  // Создать транзакцию
  await models.CreditTransaction.create({
    user_id: userId,
    type: 'usage',
    amount: -creditsToDeduct,
    balance_after: newBalance,
    description: action || 'AI request',
    model_used: model,
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
  });

  logger.info(`Credits deducted: user=${userId}, amount=${creditsToDeduct}, balance=${newBalance}`);

  return { creditsDeducted: creditsToDeduct, newBalance };
}

export async function checkDailyLimit(userId, tier) {
  const limits = getTierLimits(tier);

  if (limits.messagesPerDay === Infinity) {
    return { allowed: true, remaining: Infinity };
  }

  // Подсчитать сообщения за сегодня (в часовом поясе пользователя)
  const user = await models.User.findByPk(userId);
  const userTimezone = user.timezone || 'UTC';

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const messagesCount = await models.Message.count({
    include: [{
      model: models.Session,
      where: { user_id: userId },
    }],
    where: {
      sender: 'user',
      created_at: { [models.Sequelize.Op.gte]: startOfDay },
    },
  });

  const allowed = messagesCount < limits.messagesPerDay;
  const remaining = limits.messagesPerDay - messagesCount;

  return { allowed, used: messagesCount, remaining, limit: limits.messagesPerDay };
}

export async function getCreditBalance(userId) {
  const lastTransaction = await models.CreditTransaction.findOne({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
  });

  return lastTransaction ? lastTransaction.balance_after : 0;
}

export async function addCredits(userId, amount, reason = 'purchase') {
  const currentBalance = await getCreditBalance(userId);
  const newBalance = currentBalance + amount;

  await models.CreditTransaction.create({
    user_id: userId,
    type: reason,
    amount,
    balance_after: newBalance,
    description: `Credits ${reason}`,
  });

  logger.info(`Credits added: user=${userId}, amount=${amount}, balance=${newBalance}`);
  return newBalance;
}
```

---

## 5. Stripe Integration

**Файл:** `src/services/billing/stripeService.js`

```javascript
import Stripe from 'stripe';
import config from '../../config/index.js';
import logger from '../../config/logger.js';
import { updateSubscription } from './subscriptionService.js';
import models from '../../models/index.js';

const stripe = new Stripe(config.stripe.secretKey);

export async function createCheckoutSession(userId, tier) {
  const user = await models.User.findByPk(userId);

  if (!user) {
    throw new Error('User not found');
  }

  const prices = {
    professional: config.stripe.prices.professional, // price_xxxxx
    business: config.stripe.prices.business,
    enterprise: config.stripe.prices.enterprise,
  };

  const priceId = prices[tier];

  if (!priceId) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  const session = await stripe.checkout.sessions.create({
    customer_email: user.email,
    client_reference_id: userId.toString(),
    mode: 'subscription',
    line_items: [{
      price: priceId,
      quantity: 1,
    }],
    success_url: `${config.appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/billing/cancel`,
    metadata: {
      user_id: userId,
      tier,
    },
  });

  logger.info(`Stripe checkout session created: user=${userId}, tier=${tier}`);
  return session;
}

export async function handleWebhook(event) {
  logger.info(`Stripe webhook received: type=${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = parseInt(session.metadata.user_id, 10);
      const tier = session.metadata.tier;
      const subscriptionId = session.subscription;

      // Обновить подписку
      await updateSubscription(userId, {
        tier,
        status: 'active',
        stripe_subscription_id: subscriptionId,
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      // Записать платёж
      await models.Payment.create({
        user_id: userId,
        amount: session.amount_total / 100, // cents to dollars
        currency: session.currency.toUpperCase(),
        status: 'succeeded',
        provider: 'stripe',
        provider_payment_id: session.payment_intent,
      });

      logger.info(`Checkout completed: user=${userId}, tier=${tier}`);
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;

      // Найти подписку по stripe_subscription_id
      const subscription = await models.Subscription.findOne({
        where: { stripe_subscription_id: subscriptionId },
      });

      if (subscription) {
        await models.Payment.create({
          user_id: subscription.user_id,
          subscription_id: subscription.id,
          amount: invoice.amount_paid / 100,
          currency: invoice.currency.toUpperCase(),
          status: 'succeeded',
          provider: 'stripe',
          provider_payment_id: invoice.payment_intent,
        });

        logger.info(`Invoice paid: subscription=${subscription.id}`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;

      const subscription = await models.Subscription.findOne({
        where: { stripe_subscription_id: subscriptionId },
      });

      if (subscription) {
        await subscription.update({ status: 'past_due' });

        await models.Payment.create({
          user_id: subscription.user_id,
          subscription_id: subscription.id,
          amount: invoice.amount_due / 100,
          currency: invoice.currency.toUpperCase(),
          status: 'failed',
          provider: 'stripe',
          provider_payment_id: invoice.payment_intent,
        });

        logger.warn(`Invoice payment failed: subscription=${subscription.id}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const stripeSubscription = event.data.object;
      const subscription = await models.Subscription.findOne({
        where: { stripe_subscription_id: stripeSubscription.id },
      });

      if (subscription) {
        await subscription.update({
          tier: 'free',
          status: 'cancelled',
        });

        await models.User.update(
          { subscription_tier: 'free' },
          { where: { id: subscription.user_id } }
        );

        logger.info(`Subscription deleted: user=${subscription.user_id}`);
      }
      break;
    }

    default:
      logger.info(`Unhandled webhook event: ${event.type}`);
  }
}
```

---

## 6. Billing REST API

**Файл:** `src/routes/billing.routes.js`

```javascript
import express from 'express';
import * as billingController from '../controllers/billing.controller.js';
import { authenticate } from '../middleware/auth.js';
import Stripe from 'stripe';
import config from '../config/index.js';

const router = express.Router();
const stripe = new Stripe(config.stripe.secretKey);

// Все endpoints кроме webhook требуют аутентификацию
router.get('/subscription', authenticate, billingController.getSubscription);
router.post('/checkout', authenticate, billingController.createCheckout);
router.post('/cancel', authenticate, billingController.cancelSubscription);
router.get('/usage', authenticate, billingController.getUsage);
router.get('/credits', authenticate, billingController.getCredits);

// Webhook без JWT (проверка Stripe signature)
router.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
    await billingController.handleStripeWebhook(event);
    res.json({ received: true });
  } catch (err) {
    logger.error(`Webhook signature verification failed: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

export default router;
```

**Файл:** `src/controllers/billing.controller.js`

```javascript
import * as subscriptionService from '../services/billing/subscriptionService.js';
import * as stripeService from '../services/billing/stripeService.js';
import * as creditService from '../services/billing/creditService.js';
import models from '../models/index.js';

export async function getSubscription(req, res, next) {
  try {
    const subscription = await subscriptionService.getSubscription(req.user.id);
    res.json({ success: true, data: subscription });
  } catch (error) {
    next(error);
  }
}

export async function createCheckout(req, res, next) {
  try {
    const { tier } = req.body;
    const session = await stripeService.createCheckoutSession(req.user.id, tier);
    res.json({ success: true, data: { checkout_url: session.url } });
  } catch (error) {
    next(error);
  }
}

export async function cancelSubscription(req, res, next) {
  try {
    const { immediately } = req.body;
    const subscription = await subscriptionService.cancelSubscription(req.user.id, immediately);
    res.json({ success: true, data: subscription });
  } catch (error) {
    next(error);
  }
}

export async function getUsage(req, res, next) {
  try {
    const user = await models.User.findByPk(req.user.id);
    const dailyLimit = await creditService.checkDailyLimit(req.user.id, user.subscription_tier);
    const balance = await creditService.getCreditBalance(req.user.id);

    // Статистика за месяц
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyTransactions = await models.CreditTransaction.findAll({
      where: {
        user_id: req.user.id,
        type: 'usage',
        created_at: { [models.Sequelize.Op.gte]: startOfMonth },
      },
    });

    const totalTokens = monthlyTransactions.reduce((sum, t) => sum + (t.tokens_input || 0) + (t.tokens_output || 0), 0);
    const totalCost = monthlyTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0) / 100; // cents to dollars

    res.json({
      success: true,
      data: {
        daily: dailyLimit,
        monthly: {
          messages: monthlyTransactions.length,
          tokens: totalTokens,
          cost: totalCost,
        },
        creditBalance: balance,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getCredits(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows } = await models.CreditTransaction.findAndCountAll({
      where: { user_id: req.user.id },
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      success: true,
      data: rows,
      meta: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        total_pages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function handleStripeWebhook(event) {
  await stripeService.handleWebhook(event);
}
```

---

## 7. Rate Limiter — тарифозависимый

**Обновление:** `src/middleware/rateLimiter.js`

```javascript
import rateLimit from 'express-rate-limit';
import { checkDailyLimit } from '../services/billing/creditService.js';
import { RateLimitError } from '../utils/errors.js';

// Глобальный rate limiter (по IP)
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 100, // 100 запросов
  message: 'Слишком много запросов с вашего IP. Попробуйте через минуту.',
});

// Auth endpoints limiter
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Слишком много попыток входа. Попробуйте через минуту.',
});

// Chat message limiter (по тарифу пользователя)
export async function chatMessageLimiter(req, res, next) {
  if (!req.user) {
    return next();
  }

  try {
    const user = await models.User.findByPk(req.user.id);
    const limitCheck = await checkDailyLimit(req.user.id, user.subscription_tier);

    if (!limitCheck.allowed) {
      throw new RateLimitError(
        `Лимит ${limitCheck.limit} сообщений/день исчерпан. Обновите подписку для увеличения лимита.`,
        {
          limit: limitCheck.limit,
          used: limitCheck.used,
          upgrade_url: '/api/v1/billing/checkout',
        }
      );
    }

    // Добавить инфо в заголовки
    res.setHeader('X-RateLimit-Limit', limitCheck.limit);
    res.setHeader('X-RateLimit-Remaining', limitCheck.remaining);
    res.setHeader('X-RateLimit-Used', limitCheck.used);

    next();
  } catch (error) {
    next(error);
  }
}
```

---

## 8. Feature Gating

**Файл:** `src/middleware/featureGate.js`

```javascript
import { getTierLimits } from '../services/billing/tierLimits.js';
import { ForbiddenError } from '../utils/errors.js';

export function requireFeature(featureName) {
  return async (req, res, next) => {
    const user = req.user;

    if (!user) {
      return next(new ForbiddenError('Требуется аутентификация'));
    }

    const limits = getTierLimits(user.subscription_tier);

    if (limits.features[0] === 'all' || limits.features.includes(featureName)) {
      return next();
    }

    next(new ForbiddenError(
      `Функция "${featureName}" доступна начиная с тарифа Professional. Обновите подписку.`,
      { feature: featureName, current_tier: user.subscription_tier, upgrade_url: '/api/v1/billing/checkout' }
    ));
  };
}
```

**Использование:**

```javascript
// В routes файле
router.post('/contacts', authenticate, requireFeature('crm'), contactsController.create);
```

---

## 9. Telegram Billing UX

**Команда `/subscribe`** — `src/services/platforms/telegram/handlers/commandHandler.js`

```javascript
async function handleSubscribe(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const keyboard = {
    inline_keyboard: [
      [{ text: '💎 Professional $19/мес', callback_data: 'sub_professional' }],
      [{ text: '🚀 Business $49/мес', callback_data: 'sub_business' }],
      [{ text: '🏢 Enterprise (договорная)', callback_data: 'sub_enterprise' }],
      [{ text: '❌ Отмена', callback_data: 'cancel' }],
    ],
  };

  const text = `
**Выберите тарифный план:**

💎 **Professional** — $19/мес
• 500 сообщений/день
• Haiku + Sonnet
• Gmail интеграция
• Голосовые ответы (TTS)
• Распознавание изображений (Vision)

🚀 **Business** — $49/мес
• Безлимит сообщений
• Google Docs интеграция
• CRM система
• API доступ

🏢 **Enterprise** — договорная
• Все функции Business
• Модель Opus
• Приоритетная поддержка
• Кастомизация
  `;

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}
```

**Команда `/usage`**

```javascript
async function handleUsage(bot, msg) {
  const chatId = msg.chat.id;
  const user = await models.User.findOne({ where: { telegram_id: msg.from.id.toString() } });

  if (!user) return;

  const dailyLimit = await creditService.checkDailyLimit(user.id, user.subscription_tier);
  const balance = await creditService.getCreditBalance(user.id);

  const text = `
📊 **Статистика использования**

**Сегодня:**
Использовано: ${dailyLimit.used}/${dailyLimit.limit === Infinity ? '∞' : dailyLimit.limit} сообщений
Осталось: ${dailyLimit.remaining === Infinity ? '∞' : dailyLimit.remaining}

**Баланс кредитов:** ${balance} ($${(balance / 100).toFixed(2)})

**Тариф:** ${user.subscription_tier}

${dailyLimit.remaining < 10 && dailyLimit.limit !== Infinity ? '\n⚠️ Лимит почти исчерпан! Обновите подписку: /upgrade' : ''}
  `;

  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}
```

---

## 10. Free Tier Onboarding

**При регистрации нового пользователя через Telegram:**

```javascript
async function handleStart(bot, msg) {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id.toString();

  // Найти или создать пользователя
  let user = await models.User.findOne({ where: { telegram_id: telegramId } });

  if (!user) {
    // Новый пользователь → создать с Free тарифом
    user = await models.User.create({
      username: msg.from.username || `user_${telegramId}`,
      telegram_id: telegramId,
      subscription_tier: 'free',
    });

    // Создать подписку с 14-дневным trial Professional
    await subscriptionService.createSubscription(user.id, 'professional');
    await models.Subscription.update(
      { status: 'trial', current_period_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
      { where: { user_id: user.id } }
    );

    const welcomeText = `
👋 Добро пожаловать в Secretary Bot!

Вы получили **14 дней бесплатного доступа** к тарифу Professional!

🎁 **Что доступно:**
• 500 сообщений/день
• Gmail интеграция
• Голосовые ответы
• Распознавание изображений

Через 14 дней ваша подписка автоматически перейдёт на тариф Free (50 сообщений/день).

Используйте /help для списка команд.
    `;

    await bot.sendMessage(chatId, welcomeText);
  } else {
    await bot.sendMessage(chatId, `С возвращением, ${user.username}! Используйте /help для списка команд.`);
  }
}
```

---

## 11. Аналитика расходов

**SQL запросы для анализа:**

```sql
-- Общий AI расход за месяц
SELECT
  DATE(created_at) as date,
  SUM(ABS(amount)) / 100 as daily_cost
FROM credit_transactions
WHERE type = 'usage'
  AND created_at >= DATE_TRUNC('month', NOW())
GROUP BY date
ORDER BY date;

-- Средний расход на пользователя
SELECT
  user_id,
  COUNT(*) as messages,
  SUM(tokens_input + tokens_output) as total_tokens,
  SUM(ABS(amount)) / 100 as total_cost
FROM credit_transactions
WHERE type = 'usage'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY user_id
ORDER BY total_cost DESC;

-- Самые дорогие операции
SELECT
  model_used,
  COUNT(*) as count,
  AVG(tokens_input) as avg_input,
  AVG(tokens_output) as avg_output,
  SUM(ABS(amount)) / 100 as total_cost
FROM credit_transactions
WHERE type = 'usage'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY model_used;

-- Revenue vs Cost
SELECT
  DATE(p.created_at) as date,
  SUM(p.amount) as revenue,
  (SELECT SUM(ABS(ct.amount)) / 100
   FROM credit_transactions ct
   WHERE ct.type = 'usage'
     AND DATE(ct.created_at) = DATE(p.created_at)) as ai_cost
FROM payments p
WHERE p.status = 'succeeded'
  AND p.created_at >= DATE_TRUNC('month', NOW())
GROUP BY date
ORDER BY date;
```

---

## 12. Чеклист готовности

- [ ] Модели Subscription, Payment, CreditTransaction созданы и смигрированы
- [ ] tierLimits.js определяет лимиты для всех тарифов
- [ ] subscriptionService.js реализован (CRUD, cancel, trial)
- [ ] creditService.js реализован (trackUsage, checkDailyLimit, balance)
- [ ] Stripe integration (checkout, webhooks) работает
- [ ] Billing REST API endpoints работают
- [ ] Rate limiter учитывает тариф пользователя
- [ ] Feature gating middleware работает
- [ ] Telegram команды `/subscribe`, `/usage`, `/upgrade` работают
- [ ] Free tier onboarding с 14-дневным trial работает
- [ ] Webhook `/api/v1/billing/webhook/stripe` обрабатывает события
- [ ] Автоматический downgrade после trial
- [ ] Уведомления о приближении к лимиту
- [ ] SQL запросы для аналитики протестированы
- [ ] Документация для пользователей (тарифы, цены)

---

**Следующий этап:** [Этап 9: DevOps и тестирование](stage-9-devops.md)
