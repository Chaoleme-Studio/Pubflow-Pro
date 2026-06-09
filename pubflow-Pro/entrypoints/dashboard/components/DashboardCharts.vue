<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { PLATFORM_CONFIGS } from '../../../src/platforms';
import type { PlatformId, PublishRecord } from '../../../src/types';
import type HighchartsType from 'highcharts';

const Highcharts = ref<typeof HighchartsType>();
const Chart = defineAsyncComponent(async () => {
  const [hc, hv] = await Promise.all([
    import('highcharts'),
    import('highcharts-vue'),
  ]);
  Highcharts.value = hc.default;
  return hv.Chart;
});

const props = defineProps<{
  records: PublishRecord[];
  platformSummaries: Array<{
    platformId: PlatformId;
    published: number;
    pending: number;
    error: number;
    views: number;
  }>;
  formatViews: (views?: number) => string;
}>();

const baseChartOptions: HighchartsType.Options = {
  chart: {
    backgroundColor: 'transparent',
    spacing: [10, 4, 6, 4],
    style: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
  },
  credits: { enabled: false },
  accessibility: { enabled: false },
  title: { text: undefined },
  legend: {
    align: 'left',
    verticalAlign: 'top',
    itemStyle: {
      color: '#475569',
      fontSize: '11px',
      fontWeight: '700',
    },
    symbolRadius: 4,
  },
  tooltip: {
    backgroundColor: '#0f172a',
    borderWidth: 0,
    borderRadius: 8,
    padding: 10,
    shadow: false,
    style: {
      color: '#f8fafc',
      fontSize: '12px',
    },
  },
  xAxis: {
    lineColor: '#e2e8f0',
    tickColor: '#e2e8f0',
    labels: {
      style: {
        color: '#64748b',
        fontSize: '11px',
      },
    },
    title: { text: undefined },
  },
  yAxis: {
    gridLineColor: '#eef2f7',
    labels: {
      style: {
        color: '#94a3b8',
        fontSize: '11px',
      },
    },
    title: { text: undefined },
  },
  plotOptions: {
    series: {
      animation: {
        duration: 420,
      },
      marker: {
        enabled: false,
      },
    },
  },
};

const trendData = computed(() => {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    date.setHours(0, 0, 0, 0);
    return date;
  });

  return days.map((date) => {
    const next = new Date(date);
    next.setDate(date.getDate() + 1);
    const dayRecords = props.records.filter(
      (record) =>
        record.status === 'published' &&
        record.publishedAt &&
        record.publishedAt >= date.getTime() &&
        record.publishedAt < next.getTime(),
    );

    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      published: dayRecords.length,
      views: dayRecords.reduce((sum, record) => sum + (record.stats?.views || 0), 0),
      likes: dayRecords.reduce((sum, record) => sum + (record.stats?.likes || 0), 0),
    };
  });
});

const publishTrendOptions = computed<HighchartsType.Options>(() => ({
  ...baseChartOptions,
  chart: {
    ...baseChartOptions.chart,
    type: 'areaspline',
    height: 260,
  },
  colors: ['#ff8a00', '#0f9f8f'],
  xAxis: {
    ...baseChartOptions.xAxis,
    categories: trendData.value.map((item) => item.label),
  },
  yAxis: {
    ...baseChartOptions.yAxis,
    min: 0,
    allowDecimals: false,
  },
  tooltip: {
    ...baseChartOptions.tooltip,
    shared: true,
  },
  plotOptions: {
    ...baseChartOptions.plotOptions,
    areaspline: {
      lineWidth: 3,
      fillOpacity: 0.14,
      marker: {
        enabled: true,
        radius: 3,
        lineWidth: 0,
      },
    },
  },
  series: [
    {
      type: 'areaspline',
      name: '发布',
      data: trendData.value.map((item) => item.published),
    },
    {
      type: 'areaspline',
      name: '点赞',
      data: trendData.value.map((item) => item.likes),
    },
  ],
}));

const platformOptions = computed<HighchartsType.Options>(() => ({
  ...baseChartOptions,
  chart: {
    ...baseChartOptions.chart,
    type: 'column',
    height: 260,
  },
  colors: ['#ff8a00', '#0f9f8f', '#ef4444'],
  xAxis: {
    ...baseChartOptions.xAxis,
    categories: props.platformSummaries.map((item) => PLATFORM_CONFIGS[item.platformId].name),
  },
  yAxis: {
    ...baseChartOptions.yAxis,
    min: 0,
    allowDecimals: false,
  },
  tooltip: {
    ...baseChartOptions.tooltip,
    shared: true,
  },
  plotOptions: {
    ...baseChartOptions.plotOptions,
    column: {
      borderRadius: 5,
      borderWidth: 0,
      pointPadding: 0.08,
      groupPadding: 0.12,
    },
  },
  series: [
    {
      type: 'column',
      name: '已发',
      data: props.platformSummaries.map((item) => item.published),
    },
    {
      type: 'column',
      name: '待发',
      data: props.platformSummaries.map((item) => item.pending),
    },
    {
      type: 'column',
      name: '失败',
      data: props.platformSummaries.map((item) => item.error),
    },
  ],
}));

const engagementOptions = computed<HighchartsType.Options>(() => ({
  ...baseChartOptions,
  chart: {
    ...baseChartOptions.chart,
    type: 'spline',
    height: 220,
  },
  colors: ['#111827', '#ff8a00', '#0f9f8f'],
  xAxis: {
    ...baseChartOptions.xAxis,
    categories: trendData.value.map((item) => item.label),
  },
  yAxis: {
    ...baseChartOptions.yAxis,
    min: 0,
    labels: {
      style: {
        color: '#94a3b8',
        fontSize: '11px',
      },
      formatter() {
        return props.formatViews(Number(this.value));
      },
    },
  },
  tooltip: {
    ...baseChartOptions.tooltip,
    shared: true,
    pointFormatter() {
      return `<span style="color:${this.color}">●</span> ${this.series.name}: <b>${props.formatViews(
        Number(this.y),
      )}</b><br/>`;
    },
  },
  plotOptions: {
    ...baseChartOptions.plotOptions,
    spline: {
      lineWidth: 3,
      marker: {
        enabled: true,
        radius: 3,
      },
    },
  },
  series: [
    {
      type: 'spline',
      name: '播放',
      data: trendData.value.map((item) => item.views),
    },
    {
      type: 'spline',
      name: '点赞',
      data: trendData.value.map((item) => item.likes),
    },
  ],
}));
</script>

<template>
  <section class="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
    <div class="rounded-md border border-slate-200 bg-white p-5">
      <div class="mb-3 flex items-center justify-between">
        <div>
          <h2 class="text-sm font-black text-slate-950">发布趋势</h2>
          <p class="mt-1 text-xs text-slate-500">最近 7 天发布量与点赞变化。</p>
        </div>
        <span class="rounded bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-700">7D</span>
      </div>
      <Chart v-if="Highcharts" :highcharts="Highcharts" :options="publishTrendOptions" />
    </div>

    <div class="rounded-md border border-slate-200 bg-white p-5">
      <div class="mb-3 flex items-center justify-between">
        <div>
          <h2 class="text-sm font-black text-slate-950">平台状态</h2>
          <p class="mt-1 text-xs text-slate-500">各平台发布、待发和失败数量。</p>
        </div>
      </div>
      <Chart :highcharts="Highcharts" :options="platformOptions" />
    </div>

    <div class="rounded-md border border-slate-200 bg-white p-5 xl:col-span-2">
      <div class="mb-3 flex items-center justify-between">
        <div>
          <h2 class="text-sm font-black text-slate-950">互动表现</h2>
          <p class="mt-1 text-xs text-slate-500">播放和点赞按发布时间归集。</p>
        </div>
      </div>
      <Chart :highcharts="Highcharts" :options="engagementOptions" />
    </div>
  </section>
</template>
