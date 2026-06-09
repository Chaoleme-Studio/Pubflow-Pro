<script setup lang="ts">
import { computed } from 'vue';
import type { AdminLicenseItem, AdminOrderItem } from '../../api';
import { toDateOnly } from '../../utils/format';

const props = defineProps<{
  orders: AdminOrderItem[];
  licenses: AdminLicenseItem[];
}>();

const chartOptions = computed(() => {
  const buckets = buildBuckets(props.orders, props.licenses);
  return {
    chart: {
      type: 'areaspline',
      backgroundColor: 'transparent',
      height: 400,
      spacing: [8, 4, 4, 0],
    },
    title: { text: undefined },
    credits: { enabled: false },
    legend: {
      itemStyle: { color: 'rgba(247,251,255,.74)', fontWeight: '600' },
      itemHoverStyle: { color: '#fff' },
    },
    xAxis: {
      categories: buckets.map((item) => item.label),
      lineColor: 'rgba(255,255,255,.12)',
      tickColor: 'rgba(255,255,255,.12)',
      labels: { style: { color: 'rgba(247,251,255,.52)' } },
    },
    yAxis: [
      {
        title: { text: undefined },
        gridLineColor: 'rgba(255,255,255,.08)',
        labels: { style: { color: 'rgba(247,251,255,.52)' } },
      },
      {
        title: { text: undefined },
        opposite: true,
        gridLineWidth: 0,
        labels: { style: { color: 'rgba(247,251,255,.52)' } },
      },
    ],
    tooltip: {
      shared: true,
      backgroundColor: 'rgba(5,9,18,.96)',
      borderColor: 'rgba(142,232,255,.28)',
      borderRadius: 12,
      style: { color: '#f7fbff' },
    },
    plotOptions: {
      areaspline: {
        marker: { radius: 4, lineWidth: 1, lineColor: '#07111f' },
        lineWidth: 3,
        fillOpacity: 0.16,
      },
    },
    series: [
      {
        name: '支付收入',
        data: buckets.map((item) => item.revenue),
        color: '#73e2c8',
        yAxis: 0,
      },
      {
        name: '授权数量',
        data: buckets.map((item) => item.licenses),
        color: '#8ee8ff',
        yAxis: 1,
      },
      {
        name: '订单数量',
        data: buckets.map((item) => item.orders),
        color: '#ffb86b',
        yAxis: 1,
      },
    ],
  };
});

function buildBuckets(orders: AdminOrderItem[], licenses: AdminLicenseItem[]) {
  const labels = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${mm}-${dd}`;
  });
  return labels.map((label) => {
    const orderCount = orders.filter((item) => toDateOnly(item.createdAt).slice(5) === label).length;
    const dayLicenses = licenses.filter((item) => toDateOnly(item.paidAt || item.createdAt).slice(5) === label);
    return {
      label,
      orders: orderCount,
      licenses: dayLicenses.length,
      revenue: Math.round(dayLicenses.reduce((sum, item) => sum + (item.amountCents || 0), 0) / 100),
    };
  });
}
</script>

<template>
  <div class="ops-chart highcharts-panel">
    <highcharts :options="chartOptions" />
  </div>
</template>
