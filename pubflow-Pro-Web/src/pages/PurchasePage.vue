<script setup lang="ts">
import { BadgeCheck, ClipboardCopy, CreditCard, ExternalLink, RefreshCw, WalletCards } from 'lucide-vue-next';
import QRCode from 'qrcode';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { createOrder, FALLBACK_PRODUCT_CATALOG, getOrderStatus, getProductCatalog, type LicenseTier, type PayChannel, type Plan, type PlanOption } from '../api';

const RESELLER_URL = 'https://www.aidoumi.com//links/6C406BEA';

const selectedPlan = ref<Plan>('monthly');
const selectedTier = ref<LicenseTier>('basic');
const selectedPay = ref<PayChannel>('alipay');
const orderNo = ref('');
const queryToken = ref('');
const payOpened = ref(false);
const paymentMessage = ref('');
const qrDataUrl = ref('');
const fallbackPayUrl = ref('');
const plans = ref<PlanOption[]>([]);
const catalogLoading = ref(true);
const catalogError = ref('');
const tierOrder: LicenseTier[] = ['basic', 'plus', 'pro'];
const availableTiers = computed(() => tierOrder.filter((tier) => plans.value.some((item) => item.tier === tier)));
const visiblePlans = computed(() => plans.value.filter((item) => item.tier === selectedTier.value));
const activePlan = computed(() => (
  visiblePlans.value.find((item) => item.id === selectedPlan.value) || visiblePlans.value[0]
));
const nowTick = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | undefined;
const activePlanOriginalPrice = computed(() => {
  const plan = activePlan.value;
  return plan?.originalAmountCents && plan.originalAmountCents > plan.amountCents
    ? formatAmount(plan.originalAmountCents)
    : '';
});
const activePlanSavings = computed(() => activePlan.value?.savingsCents ? formatAmount(activePlan.value.savingsCents) : '');
const discountCountdown = computed(() => {
  const end = activePlan.value?.discountEndAt;
  if (!activePlan.value?.isDiscountActive || !end) return '';
  const diff = new Date(end).getTime() - nowTick.value;
  if (diff <= 0) return '即将结束';
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}天${hours}小时后结束`;
  return `${hours}小时${minutes}分钟后结束`;
});

const payLoading = ref(false);
const activationCode = ref('');
const queryLoading = ref(false);
const queryError = ref('');
const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(async () => {
  countdownTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 60000);
  try {
    const catalog = await getProductCatalog();
    plans.value = catalog.plans;
    selectedTier.value = availableTiers.value.includes(selectedTier.value)
      ? selectedTier.value
      : availableTiers.value[0] || 'basic';
    selectedPlan.value = visiblePlans.value.find((item) => item.id === selectedPlan.value)?.id
      || visiblePlans.value.find((item) => item.id === 'monthly')?.id
      || visiblePlans.value[0]?.id
      || 'monthly';
  } catch (error) {
    plans.value = FALLBACK_PRODUCT_CATALOG.plans;
    selectedPlan.value = 'monthly';
    catalogError.value = `${error instanceof Error ? error.message : '产品配置加载失败'}，当前使用本地套餐配置。`;
  } finally {
    catalogLoading.value = false;
  }
});

async function startPayment(channel: PayChannel) {
  if (!activePlan.value || payLoading.value) {
    paymentMessage.value = '套餐配置还没有加载完成，请稍后再试。';
    return;
  }

  selectedPay.value = channel;
  paymentMessage.value = '';
  activationCode.value = '';
  queryError.value = '';
  qrDataUrl.value = '';
  fallbackPayUrl.value = '';
  payLoading.value = true;

  try {
    const order = await createOrder(selectedTier.value, selectedPlan.value, channel);
    orderNo.value = order.orderNo;
    queryToken.value = order.queryToken;
    payOpened.value = true;

    const qrText = order.qrCode || order.payUrl;
    if (order.qrCode) {
      qrDataUrl.value = await QRCode.toDataURL(qrText, { width: 240, margin: 1 });
      paymentMessage.value = '请使用支付宝扫码付款。付款完成后点击下方按钮查询激活码。';
      return;
    }

    fallbackPayUrl.value = order.payUrl || RESELLER_URL;
    window.open(fallbackPayUrl.value, '_blank', 'noopener,noreferrer');
    paymentMessage.value = '当前未启用支付宝官方扫码，已打开卡密代售平台。';
  } catch (error) {
    paymentMessage.value = error instanceof Error ? error.message : '订单创建失败，请稍后重试';
  } finally {
    payLoading.value = false;
  }
}

async function queryActivationCode() {
  if (!orderNo.value) {
    queryError.value = '请先创建订单';
    return;
  }
  queryLoading.value = true;
  queryError.value = '';
  try {
    const status = await getOrderStatus(orderNo.value, queryToken.value);
    if (status.activationCode) {
      activationCode.value = status.activationCode;
      queryError.value = '';
    } else if (status.status === 'pending') {
      queryError.value = '订单尚未支付，请完成支付后再查询';
    } else {
      queryError.value = '暂未获取到激活码，请稍后再试';
    }
  } catch {
    queryError.value = '查询失败，请稍后重试';
  } finally {
    queryLoading.value = false;
  }
}

async function copyActivationCode() {
  if (!activationCode.value) return;
  try {
    await navigator.clipboard.writeText(activationCode.value);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = activationCode.value;
    textarea.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copied.value = false; }, 2000);
}

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer);
  if (countdownTimer) clearInterval(countdownTimer);
});

function formatAmount(amountCents: number) {
  return (amountCents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function selectTier(tier: LicenseTier) {
  selectedTier.value = tier;
  if (!visiblePlans.value.some((item) => item.id === selectedPlan.value)) {
    selectedPlan.value = visiblePlans.value.find((item) => item.id === 'monthly')?.id
      || visiblePlans.value[0]?.id
      || 'monthly';
  }
}

function tierLabel(tier: LicenseTier) {
  return tier === 'basic' ? 'Basic' : tier === 'plus' ? 'Plus' : 'Pro';
}
</script>

<template>
  <main class="purchase-page">
    <section class="purchase-hero">
      <div>
        <p class="eyebrow">购买 PubFlow License</p>
        <h1>选择套餐，支付宝扫码开通</h1>
        <p>官方支付宝通道生成订单和二维码，付款成功后自动发放激活码；代售平台保留为备用入口。</p>
      </div>
    </section>

    <section class="checkout-layout">
      <div class="checkout-main">
        <div class="plan-switch tier-switch" aria-label="授权版本">
          <button
            v-for="tier in availableTiers"
            :key="tier"
            type="button"
            :class="{ active: selectedTier === tier }"
            @click="selectTier(tier)"
          >
            <span>{{ tierLabel(tier) }}</span>
          </button>
        </div>
        <div class="plan-switch">
          <p v-if="catalogLoading" class="inline-empty">套餐配置加载中...</p>
          <button v-for="item in visiblePlans" :key="`${item.tier}-${item.id}`" type="button" :class="{ active: selectedPlan === item.id }" @click="selectedPlan = item.id">
            <span>{{ item.name }}</span>
            <strong>
              <small v-if="item.originalAmountCents && item.originalAmountCents > item.amountCents" class="price-origin">¥{{ formatAmount(item.originalAmountCents) }}</small>
              ¥{{ item.price }}
            </strong>
            <em v-if="item.isDiscountActive" class="discount-pill">限时折扣</em>
            <small>{{ item.note }}</small>
          </button>
          <p v-if="catalogError" class="inline-empty">{{ catalogError }}</p>
        </div>

        <div class="pay-methods">
          <button type="button" :class="{ active: selectedPay === 'alipay' }" :disabled="payLoading" aria-label="使用支付宝支付" @click="selectedPay = 'alipay'">
            <CreditCard :size="20" />
            支付宝
          </button>
          <button type="button" :class="{ active: selectedPay === 'wechat' }" :disabled="payLoading" aria-label="微信支付预留" @click="selectedPay = 'wechat'">
            <WalletCards :size="20" />
            微信预留
          </button>
        </div>

        <button class="primary-button pay-now-btn" type="button" :disabled="!activePlan || payLoading" @click="startPayment(selectedPay)">
          {{ payLoading ? '创建订单中...' : '立即购买' }}
        </button>
        <a class="secondary-button compact reseller-button" :href="RESELLER_URL" target="_blank" rel="noopener noreferrer">
          <ExternalLink :size="14" />
          代售平台备用
        </a>
      </div>

      <aside class="order-summary">
        <template v-if="!payOpened">
          <div class="order-placeholder">
            <BadgeCheck :size="24" />
            <strong>订单摘要</strong>
            <p>选择套餐并点击「立即购买」后，这里会显示支付二维码和激活码查询入口。</p>
          </div>
        </template>

        <template v-else>
          <span>订单已创建</span>
          <strong>{{ activePlan ? `${tierLabel(activePlan.tier)} · ${activePlan.name} ¥${activePlan.price}` : '' }}</strong>
          <div v-if="activePlanOriginalPrice" class="summary-line"><span>原价</span><b class="line-through">¥{{ activePlanOriginalPrice }}</b></div>
          <div v-if="activePlanSavings" class="summary-line"><span>节省</span><b>¥{{ activePlanSavings }}</b></div>
          <div v-if="discountCountdown" class="summary-line"><span>折扣</span><b>{{ discountCountdown }}</b></div>
          <div class="summary-line"><span>支付方式</span><b>{{ selectedPay === 'alipay' ? '支付宝' : '微信' }}</b></div>
          <div class="summary-line"><span>订单号</span><b>{{ orderNo }}</b></div>

          <div v-if="qrDataUrl" class="pay-qr-box">
            <img :src="qrDataUrl" alt="支付宝付款二维码" />
            <span>支付宝扫码付款</span>
          </div>
          <a v-else-if="fallbackPayUrl" class="secondary-button fallback-pay-link" :href="fallbackPayUrl" target="_blank" rel="noopener noreferrer">
            <ExternalLink :size="15" />
            打开备用付款链接
          </a>

          <div class="paid-state opened">
            <BadgeCheck :size="20" />
            {{ qrDataUrl ? '等待支付完成' : '官方扫码未启用' }}
          </div>
          <p v-if="paymentMessage" class="payment-message">{{ paymentMessage }}</p>

          <div class="activation-section">
            <button class="query-btn" type="button" :disabled="queryLoading" @click="queryActivationCode">
              <RefreshCw :size="16" :class="{ spinning: queryLoading }" />
              {{ queryLoading ? '查询中...' : '查询激活码' }}
            </button>

            <p v-if="queryError" class="query-error">{{ queryError }}</p>

            <div v-if="activationCode" class="activation-code-display">
              <label>激活码</label>
              <div class="code-row">
                <code>{{ activationCode }}</code>
                <button type="button" class="icon-button" @click="copyActivationCode" title="复制激活码" aria-label="复制激活码">
                  <ClipboardCopy :size="16" />
                </button>
              </div>
              <p v-if="copied" class="copied-hint">已复制到剪贴板</p>
            </div>
          </div>
        </template>
      </aside>
    </section>
  </main>
</template>
