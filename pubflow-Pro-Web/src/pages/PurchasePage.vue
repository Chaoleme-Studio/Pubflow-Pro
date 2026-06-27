<script setup lang="ts">
import { BadgeCheck, ClipboardCopy, CreditCard, RefreshCw, WalletCards } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { createOrder, FALLBACK_PRODUCT_CATALOG, getOrderStatus, getProductCatalog, type PayChannel, type Plan, type PlanOption } from '../api';

defineProps<{
  navigate: (href: string) => void;
}>();

const selectedPlan = ref<Plan>('yearly');
const selectedPay = ref<PayChannel>('wechat');
const orderNo = ref('');
const queryToken = ref('');
const payOpened = ref(false);
const paymentMessage = ref('');
const plans = ref<PlanOption[]>([]);
const catalogLoading = ref(true);
const catalogError = ref('');
const activePlan = computed(() => plans.value.find((item) => item.id === selectedPlan.value) || plans.value[0]);
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

// 支付相关
const payLoading = ref(false);

// 激活码相关
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
    selectedPlan.value = catalog.plans.find((item) => item.id === 'yearly')?.id || catalog.plans[0]?.id || 'yearly';
  } catch (error) {
    plans.value = FALLBACK_PRODUCT_CATALOG.plans;
    selectedPlan.value = 'yearly';
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
  payLoading.value = true;

  try {
    const order = await createOrder(selectedPlan.value, channel);
    orderNo.value = order.orderNo;
    queryToken.value = order.queryToken;
    payOpened.value = true;

    if (/^https?:\/\//.test(order.payUrl)) {
      window.open(order.payUrl, '_blank', 'noopener,noreferrer');
      paymentMessage.value = '已打开官方支付页面。支付完成后点击下方按钮查询激活码。';
      return;
    }
    paymentMessage.value = '当前是开发环境，订单已创建。点击下方按钮查询激活码。';
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
  } catch (error) {
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
    // 降级方案：使用 textarea + execCommand（兼容 HTTP 环境）
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
</script>

<template>
  <main class="purchase-page">
    <section class="purchase-hero">
      <div>
        <p class="eyebrow">购买 PubFlow License</p>
        <h1>选择套餐，付款后查询激活码</h1>
        <p>微信和支付宝会跳转到官方支付页面，支付完成后回到此页查询并领取激活码。</p>
      </div>
    </section>

    <section class="checkout-layout">
      <div class="checkout-main">
        <div class="plan-switch">
          <p v-if="catalogLoading" class="inline-empty">套餐配置加载中...</p>
          <button v-for="item in plans" :key="item.id" type="button" :class="{ active: selectedPlan === item.id }" @click="selectedPlan = item.id">
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
          <button type="button" :class="{ active: selectedPay === 'wechat' }" :disabled="payLoading" aria-label="使用微信支付" @click="selectedPay = 'wechat'">
            <WalletCards :size="20" />
            微信
          </button>
          <button type="button" :class="{ active: selectedPay === 'alipay' }" :disabled="payLoading" aria-label="使用支付宝支付" @click="selectedPay = 'alipay'">
            <CreditCard :size="20" />
            支付宝
          </button>
        </div>

        <button class="primary-button pay-now-btn" type="button" :disabled="!activePlan || payLoading" @click="startPayment(selectedPay)">
          {{ payLoading ? '创建订单中...' : '立即购买' }}
        </button>
      </div>

      <aside class="order-summary">
        <template v-if="!payOpened">
          <div class="order-placeholder">
            <span class="order-placeholder-icon">🧾</span>
            <strong>订单摘要</strong>
            <p>选择套餐并点击「立即购买」后，订单详情将显示在这里。</p>
          </div>
        </template>

        <template v-else>
          <span>订单已创建</span>
          <strong>{{ activePlan ? `${activePlan.name} ¥${activePlan.price}` : '' }}</strong>
          <div v-if="activePlanOriginalPrice" class="summary-line"><span>原价</span><b class="line-through">¥{{ activePlanOriginalPrice }}</b></div>
          <div v-if="activePlanSavings" class="summary-line"><span>节省</span><b>¥{{ activePlanSavings }}</b></div>
          <div v-if="discountCountdown" class="summary-line"><span>折扣</span><b>{{ discountCountdown }}</b></div>
          <div class="summary-line"><span>支付方式</span><b>{{ selectedPay === 'wechat' ? '微信' : '支付宝' }}</b></div>
          <div class="summary-line"><span>订单号</span><b>{{ orderNo }}</b></div>
          <div class="paid-state opened">
            <BadgeCheck :size="20" />
            已打开官方支付页
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
