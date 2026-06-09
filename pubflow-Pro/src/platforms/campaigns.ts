import type { PlatformId } from '../types';
import { bilibiliCampaigns } from './bilibili/campaigns';
import { douyinCampaigns } from './douyin/campaigns';
import { kuaishouCampaigns } from './kuaishou/campaigns';
import { weiboCampaigns } from './weibo/campaigns';
import { weixinChannelsCampaigns } from './weixinChannels/campaigns';
import { xiaohongshuCampaigns } from './xiaohongshu/campaigns';
import { xiguaCampaigns } from './xigua/campaigns';
import { zhihuCampaigns } from './zhihu/campaigns';
import type { CampaignRecommendation, PlatformCampaign } from './types';

export const PLATFORM_CAMPAIGNS: PlatformCampaign[] = [
  ...douyinCampaigns,
  ...xiaohongshuCampaigns,
  ...weixinChannelsCampaigns,
  ...bilibiliCampaigns,
  ...kuaishouCampaigns,
  ...weiboCampaigns,
  ...zhihuCampaigns,
  ...xiguaCampaigns,
];

export function getCampaignsByPlatform(platformId: PlatformId) {
  return PLATFORM_CAMPAIGNS.filter((活动) => 活动.平台标识 === platformId);
}

export function getCampaignById(id: string) {
  return PLATFORM_CAMPAIGNS.find((活动) => 活动.标识 === id);
}

export function recommendCampaigns(input: {
  title: string;
  description: string;
  topics: string[];
  selectedPlatforms: PlatformId[];
  limitPerPlatform?: number;
}): CampaignRecommendation[] {
  const text = [input.title, input.description, input.topics.join(' ')].join(' ').toLowerCase();
  const limit = input.limitPerPlatform ?? 2;
  const selected = new Set(input.selectedPlatforms);
  const result: CampaignRecommendation[] = [];

  for (const platformId of input.selectedPlatforms) {
    const ranked = getCampaignsByPlatform(platformId)
      .map((活动) => {
        const 推荐理由: string[] = [];
        let 得分 = 活动.长期有效 ? 20 : 10;

        for (const keyword of 活动.关键词) {
          if (!text.includes(keyword.toLowerCase())) continue;
          得分 += 18;
          推荐理由.push(`命中关键词”${keyword}”`);
        }

        for (const tag of 活动.标签) {
          if (!text.includes(tag.toLowerCase())) continue;
          得分 += 10;
          推荐理由.push(`内容方向贴近”${tag}”`);
        }

        if (!推荐理由.length) {
          if (活动.类型 === 'activityCenter') {
            得分 += 8;
            推荐理由.push('适合先查看平台当前热点活动');
          } else if (活动.类型 === 'growth') {
            得分 += 6;
            推荐理由.push('适合做账号成长与任务积累');
          } else if (活动.类型 === 'monetization') {
            得分 += 5;
            推荐理由.push('适合后续接收益计划');
          } else if (活动.类型 === 'brand') {
            得分 += 4;
            推荐理由.push('适合作为商业合作储备入口');
          } else {
            推荐理由.push('适合作为平台官方入口备用');
          }
        }

        if (selected.has(活动.平台标识)) {
          得分 += 12;
          推荐理由.push('已在本次发布平台中勾选');
        }

        return { 活动, 得分, 推荐理由: Array.from(new Set(推荐理由)).slice(0, 3) };
      })
      .sort((a, b) => b.得分 - a.得分)
      .slice(0, limit);

    result.push(...ranked);
  }

  return result.sort((a, b) => b.得分 - a.得分);
}
