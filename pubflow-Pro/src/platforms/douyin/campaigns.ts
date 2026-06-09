import type { PlatformCampaign } from '../types';

export const douyinCampaigns: PlatformCampaign[] = [
  {
    标识: 'douyin-activity-center',
    平台标识: 'douyin',
    标题: '抖音创作者活动中心',
    简称: '活动中心',
    类型: 'activityCenter',
    简介: '查看平台当前官方征稿、热点挑战赛、节点活动和扶持任务。',
    参与提示: '登录抖音创作者后台后查看活动中心，按活动要求发布并挂指定话题。',
    官方链接: 'https://creator.douyin.com/creator-micro/home',
    标签: ['热点', '挑战赛', '话题活动', '节点营销'],
    关键词: ['热点', '节日', '挑战', '剧情', '测评', '探店', '教程', '开箱'],
    长期有效: true,
  },
  {
    标识: 'douyin-growth',
    平台标识: 'douyin',
    标题: '抖音创作者成长任务',
    简称: '成长任务',
    类型: 'growth',
    简介: '偏向新号冷启动、活跃任务、内容质量成长和阶段扶持。',
    参与提示: '进入创作者服务中心查看任务，完成作品数量、活跃度、垂类要求。',
    官方链接: 'https://creator.douyin.com/',
    标签: ['新号', '成长', '日更', '垂类运营'],
    关键词: ['新手', '入门', '教程', 'vlog', '知识', '干货', '连更'],
    长期有效: true,
  },
];
