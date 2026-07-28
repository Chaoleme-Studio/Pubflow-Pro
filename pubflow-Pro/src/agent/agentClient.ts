import {
  AGENT_ALARM_NAME,
  DEFAULT_AGENT_WS_URL,
  agentTaskStatus,
  type AgentJobDetail,
  type AgentJobSummary,
  type AgentLicenseGrant,
  type AgentServerMessage,
  type AgentSettings,
} from './protocol';
import type { DistributionTask } from '../types';

const AGENT_SETTINGS_KEY = 'pubflow:agent-settings';
const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

interface AgentClientOptions {
  canClaim: () => boolean;
  getWorkspaceId: () => Promise<string | null>;
  getLicenseGrant: () => Promise<AgentLicenseGrant | null>;
  onJob: (job: AgentJobDetail) => void | Promise<void>;
  onPending: () => void;
  onClaimSettled: () => void;
}

export class AgentClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private activeJobId = '';
  private pendingJob: AgentJobSummary | null = null;
  private lastTask: DistributionTask | null = null;
  private pendingFailure: { jobId: string; statusSequence: number; error: string } | null = null;
  private manuallyStopped = true;
  private helloAcknowledged = false;
  private workspaceMatched = false;
  private nativePublishAuthorized = false;

  constructor(private readonly options: AgentClientOptions) {}

  async start() {
    this.manuallyStopped = false;
    await browser.alarms.create(AGENT_ALARM_NAME, { periodInMinutes: 1 });
    await this.ensureConnected();
  }

  async stop() {
    this.manuallyStopped = true;
    await browser.alarms.clear(AGENT_ALARM_NAME);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.helloAcknowledged = false;
    this.workspaceMatched = false;
    this.nativePublishAuthorized = false;
    this.pendingJob = null;
  }

  async ensureConnected() {
    if (this.manuallyStopped) return;
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      if (this.socket.readyState === WebSocket.OPEN) await this.sendHello();
      return;
    }
    const settings = await this.loadSettings();
    if (!settings.enabled) return;

    const url = new URL(settings.wsUrl || DEFAULT_AGENT_WS_URL);
    if (settings.extensionToken) url.searchParams.set('token', settings.extensionToken);
    const socket = new WebSocket(url.toString());
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.reconnectAttempt = 0;
      this.helloAcknowledged = false;
      this.workspaceMatched = false;
      this.nativePublishAuthorized = false;
      void this.sendHello();
      this.startHeartbeat();
    });
    socket.addEventListener('message', (event) => {
      void this.handleMessage(event.data);
    });
    socket.addEventListener('close', () => this.handleDisconnect(socket));
    socket.addEventListener('error', () => {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    });
  }

  handleAlarm(name: string) {
    if (name !== AGENT_ALARM_NAME) return;
    void this.ensureConnected();
  }

  acceptJob(jobId: string) {
    if (this.activeJobId !== jobId) return;
    this.send({
      type: 'JOB_ACCEPTED',
      payload: { jobId, statusSequence: 1 },
    });
  }

  reportFailure(jobId: string, error: unknown, statusSequence = 1) {
    this.pendingFailure = {
      jobId,
      statusSequence,
      error: error instanceof Error ? error.message : String(error),
    };
    this.send({
      type: 'JOB_STATUS',
      payload: {
        jobId: this.pendingFailure.jobId,
        status: 'failed',
        statusSequence: this.pendingFailure.statusSequence,
        error: this.pendingFailure.error,
      },
    });
    if (this.activeJobId === jobId) this.activeJobId = '';
    if (this.lastTask?.externalJobId === jobId) this.lastTask = null;
  }

  reportTask(task: DistributionTask) {
    if (task.source !== 'agent' || task.externalTaskSource === 'cloud' || !task.externalJobId) return;
    this.lastTask = task;
    this.activeJobId = task.externalJobId;
    task.statusSequence = Math.max(1, task.statusSequence || 1) + 1;
    const status = agentTaskStatus(task);
    if (status === 'failed') {
      this.reportFailure(
        task.externalJobId,
        task.error || task.platforms.find((platform) => platform.error)?.error || '发布任务失败',
        task.statusSequence,
      );
      this.lastTask = null;
      return;
    }
    this.send({
      type: 'JOB_STATUS',
      payload: {
        jobId: task.externalJobId,
        status,
        statusSequence: task.statusSequence,
        task: {
          taskId: task.id,
          status: task.status,
          platforms: task.platforms,
        },
      },
    });
    if (status === 'completed') {
      this.activeJobId = '';
      this.lastTask = null;
      this.options.onPending();
    }
  }

  /** Service Worker 重启后，把持久化的 Agent 任务重新绑定到连接客户端。 */
  resumeTask(task: DistributionTask | null) {
    if (task?.source !== 'agent' || task.externalTaskSource === 'cloud' || !task.externalJobId) return;
    if (agentTaskStatus(task) !== 'running') return;
    this.lastTask = task;
    this.activeJobId = task.externalJobId;
  }

  notifyTaskMayBeAvailable() {
    this.options.onPending();
  }

  private async loadSettings(): Promise<AgentSettings> {
    const stored = await browser.storage.local.get(AGENT_SETTINGS_KEY);
    return {
      enabled: true,
      wsUrl: DEFAULT_AGENT_WS_URL,
      extensionToken: '',
      ...((stored[AGENT_SETTINGS_KEY] as Partial<AgentSettings> | undefined) || {}),
    };
  }

  private async handleMessage(raw: unknown) {
    let message: AgentServerMessage;
    try {
      message = JSON.parse(String(raw)) as AgentServerMessage;
    } catch {
      return;
    }
    if (message.type === 'STATE_SNAPSHOT') {
      if (message.payload.nextJob?.jobId === this.pendingFailure?.jobId) {
        // Native 重启后该任务回到 queued；等待 HELLO_ACK 后直接重放 failed，不重新领取执行。
        this.pendingJob = null;
        return;
      }
      if (
        message.payload.nextJob?.jobId === this.activeJobId
        && this.lastTask?.externalJobId === this.activeJobId
      ) {
        // Native 重启会把 inflight job 恢复为 queued；用插件当前任务快照把它恢复为 running。
        this.pendingJob = null;
        this.reportTask(this.lastTask);
        return;
      }
      this.pendingJob = message.payload.nextJob;
      this.options.onPending();
      return;
    }
    if (message.type === 'HELLO_ACK') {
      this.helloAcknowledged = true;
      this.workspaceMatched = message.payload.workspaceMatched;
      this.nativePublishAuthorized = message.payload.nativePublishAuthorized;
      if (!this.workspaceMatched || !this.nativePublishAuthorized) return;
      if (this.pendingFailure) {
        this.reportFailure(
          this.pendingFailure.jobId,
          this.pendingFailure.error,
          this.pendingFailure.statusSequence,
        );
      } else if (this.lastTask) {
        this.reportTask(this.lastTask);
      }
      this.options.onPending();
      return;
    }
    if (message.type === 'JOB_STATUS_ACK') {
      if (
        this.pendingFailure?.jobId === message.payload.jobId
        && message.payload.statusSequence >= this.pendingFailure.statusSequence
      ) {
        this.pendingFailure = null;
        this.options.onPending();
      }
      return;
    }
    if (message.type === 'JOB_AVAILABLE') {
      this.pendingJob = message.payload;
      this.options.onPending();
      return;
    }
    if (message.type === 'JOB_DETAIL') {
      if (message.payload.jobId !== this.activeJobId) return;
      try {
        await this.options.onJob(message.payload);
      } catch (error) {
        this.reportFailure(message.payload.jobId, error);
      } finally {
        this.options.onClaimSettled();
      }
      return;
    }
    if (message.type === 'JOB_REJECTED' && message.payload.jobId === this.activeJobId) {
      this.activeJobId = '';
      this.options.onClaimSettled();
      this.socket?.close();
    }
  }

  tryClaim() {
    if (!this.helloAcknowledged || !this.workspaceMatched || !this.nativePublishAuthorized) return false;
    if (!this.pendingJob || this.activeJobId || !this.options.canClaim()) return false;
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    const job = this.pendingJob;
    this.pendingJob = null;
    this.activeJobId = job.jobId;
    this.send({ type: 'CLAIM_JOB', payload: { jobId: job.jobId } });
    return true;
  }

  private async sendHello() {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    const [workspaceId, licenseGrant] = await Promise.all([
      this.options.getWorkspaceId(),
      this.options.getLicenseGrant(),
    ]);
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
    this.send({
      type: 'HELLO',
      payload: {
        extensionId: browser.runtime.id,
        version: browser.runtime.getManifest().version,
        workspaceId,
        licenseGrant,
      },
    });
  }

  private send(message: object) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'PING', payload: { timestamp: Date.now() } });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private handleDisconnect(socket: WebSocket) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.helloAcknowledged = false;
    this.workspaceMatched = false;
    this.nativePublishAuthorized = false;
    if (this.activeJobId && !this.lastTask) {
      this.activeJobId = '';
      this.options.onClaimSettled();
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.manuallyStopped || this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected();
    }, delay);
  }
}
