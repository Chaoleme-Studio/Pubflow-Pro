import type { PlatformCampaign } from '../types';

export const xiaohongshuCampaigns: PlatformCampaign[] = [
  {
    标识: 'xhs-activity-center',
    平台标识: 'xiaohongshu',
    标题: '小红书创作活动',
    简称: '创作活动',
    类型: 'activityCenter',
    简介: '适合挂热点话题、节点种草和平台主题征集。',
    参与提示: '在创作中心或发布页查看热点活动，按要求添加话题并保持封面与内容一致。',
    官方链接: 'https://creator.xiaohongshu.com/',
    标签: ['种草', '热点', '生活方式', '节点活动'],
    关键词: ['好物', '穿搭', '美妆', '探店', '旅行', '拍照', '教程', '攻略'],
    长期有效: true,
  },
  {
    标识: 'xhs-pugongying',
    平台标识: 'xiaohongshu',
    标题: '小红书蒲公英',
    简称: '蒲公英',
    类型: 'brand',
    简介: '品牌合作与商单撮合入口，适合已经稳定产出的账号。',
    参与提示: '完善账号资料与垂类标签，满足平台要求后进入蒲公英接单。',
    官方链接: 'https://pgy.xiaohongshu.com/',
    标签: ['商单', '品牌合作', '种草', '达人'],
    关键词: ['测评', '好物', '种草', '品牌', '开箱', '生活方式'],
    长期有效: true,
  },
];
