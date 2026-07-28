import type { DistributionTask, LicenseFeature, LicenseTier, PlatformId } from '../types';

export const AGENT_ALARM_NAME = 'pubflow-agent-watchdog';
export const DEFAULT_AGENT_WS_URL = __PUBFLOW_DEFAULT_AGENT_WS_URL__;

export interface AgentSettings {
  enabled: boolean;
  wsUrl: string;
  extensionToken: string;
}

export interface AgentJobSummary {
  jobId: string;
  projectId: string;
}

export interface AgentJobDetail extends AgentJobSummary {
  projectPath: string;
  contentType: 'video' | 'image' | 'article';
  title: string;
  platforms: PlatformId[];
  status: string;
  statusSequence: number;
  autoSubmit?: boolean;
}

export interface AgentLicenseGrant {
  tier: LicenseTier;
  features: LicenseFeature[];
  validUntil?: number;
}

export type AgentServerMessage =
  | { type: 'HELLO_ACK'; payload: { version: string; workspaceMatched: boolean; nativePublishAuthorized: boolean } }
  | { type: 'STATE_SNAPSHOT'; payload: { nextJob: AgentJobSummary | null } }
  | { type: 'JOB_AVAILABLE'; payload: AgentJobSummary }
  | { type: 'JOB_DETAIL'; payload: AgentJobDetail }
  | { type: 'JOB_REJECTED'; payload: { jobId: string; code: string } }
  | { type: 'JOB_STATUS_ACK'; payload: { jobId: string; statusSequence: number; status: string } }
  | { type: 'PONG'; payload?: { timestamp?: number } };

export function agentTaskStatus(task: DistributionTask): 'running' | 'completed' | 'failed' {
  if (task.status === 'completed') return 'completed';
  if (task.status === 'error') return 'failed';
  return 'running';
}
