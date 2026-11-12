import type { DistributionTask, PlatformId } from '../types';
import { loadLicensingSettings } from '../licensing/licenseStorage';
import { hasLicenseFeature } from '../licensing/licenseStorage';
import { buildDeviceProof } from '../licensing/deviceProof';
import { fetchProtocolInfo } from '../licensing/activation';
import { loadPubFlowWasmBridge, type PubFlowWasmBridge } from '../licensing/wasmBridge';
import {
  materializeRemoteProject,
  type RemoteWorkspaceAsset,
  type WorkspaceProjectManifest,
} from '../storage/workspaceStorage';
import { agentTaskStatus, type AgentJobDetail, type AgentJobSummary } from './protocol';

const CLOUD_AGENT_ALARM_NAME = 'pubflow-cloud-agent-watchdog';
const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

interface CloudAgentClientOptions {
  canClaim: () => boolean;
  onJob: (job: AgentJobDetail) => void | Promise<void>;
  onPending: () => void;
  onClaimSettled: () => void;
}

interface PfrpBuildResult {
  ok: boolean;
  error?: string;
  frame_base64?: string;
  outbound_key_hex?: string;
  inbound_key_hex?: string;
}

interface PfrpDecodeResult {
  ok: boolean;
  error?: string;
  payload?: CloudServerMessage;
}

interface CloudJobPayload {
  jobId: string;
  projectId: string;
  statusSequence: number;
  publishMode: 'fill_only' | 'auto_submit';
  platforms: PlatformId[];
  project: WorkspaceProjectManifest;
  assets: RemoteWorkspaceAsset[];
}

type CloudServerMessage =
  | { type: 'AUTH_OK'; payload: { protocolVersion: number; serverTime: number } }
  | { type: 'PONG'; payload: { timestamp: number } }
  | { type: 'CHANNEL_PROBE'; payload: { testId: string; serverSentAt: number } }
  | { type: 'JOB_AVAILABLE'; payload: AgentJobSummary & { title: string; contentType: string } }
  | { type: 'JOB_DETAIL'; payload: CloudJobPayload }
  | { type: 'ACK'; payload: { jobId: string; status: string; statusSequence: number } }
  | { type: 'ERROR'; payload: { code: string; message: string } };

export class CloudAgentClient {
  private socket: WebSocket | null = null;
  private wasm: PubFlowWasmBridge | null = null;
  private apiBaseUrl = '';
  private outboundKey = '';
  private inboundKey = '';
  private outboundSequence = 1;
  private inboundSequence = 1;
  private authenticated = false;
  private activeJobId = '';
  private pendingJob: AgentJobSummary | null = null;
  private lastTask: DistributionTask | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connecting = false;
  private manuallyStopped = true;

  constructor(private readonly options: CloudAgentClientOptions) {}

  async start() {
    this.manuallyStopped = false;
    await browser.alarms.create(CLOUD_AGENT_ALARM_NAME, { periodInMinutes: 1 });
    await this.ensureConnected();
  }

  async stop() {
    this.manuallyStopped = true;
    await browser.alarms.clear(CLOUD_AGENT_ALARM_NAME);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.authenticated = false;
    this.outboundKey = '';
    this.inboundKey = '';
    this.pendingJob = null;
  }

  handleAlarm(name: string) {
    if (name === CLOUD_AGENT_ALARM_NAME) void this.ensureConnected();
  }

  async ensureConnected() {
    if (this.manuallyStopped) return;
    if (this.connecting || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.connecting = true;
    try {
      const settings = await loadLicensingSettings();
      if (!hasLicenseFeature(settings, 'remote-publish') || !settings.apiBaseUrl || !settings.leaseToken || !settings.clientInstallId) return;
      this.apiBaseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
      const [wasm, protocol, deviceProof] = await Promise.all([
        loadPubFlowWasmBridge(),
        fetchProtocolInfo(this.apiBaseUrl),
        buildDeviceProof(this.apiBaseUrl, settings.leaseToken, settings.clientInstallId, 'remote'),
      ]);
      this.wasm = wasm;
      const auth = parseResult<PfrpBuildResult>(wasm.pfrp_build_auth(
        protocol.publicKey,
        JSON.stringify({
          leaseToken: settings.leaseToken,
          clientInstallId: settings.clientInstallId,
          deviceProof,
          extensionVersion: browser.runtime.getManifest().version,
        }),
        BigInt(protocol.serverTimeMs || Date.now()),
      ));
      if (!auth.ok || !auth.frame_base64 || !auth.outbound_key_hex || !auth.inbound_key_hex) {
        throw new Error(auth.error || 'PFRP 认证帧构造失败');
      }
      this.outboundKey = auth.outbound_key_hex;
      this.inboundKey = auth.inbound_key_hex;
      this.outboundSequence = 1;
      this.inboundSequence = 1;
      const socket = new WebSocket(cloudWebSocketUrl(this.apiBaseUrl), 'pfrp.v1');
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.reconnectAttempt = 0;
        socket.send(base64ToArrayBuffer(auth.frame_base64!));
        this.startHeartbeat();
      });
      socket.addEventListener('message', (event) => { void this.handleMessage(event.data); });
      socket.addEventListener('close', () => this.handleDisconnect(socket));
      socket.addEventListener('error', () => socket.close());
    } catch (error) {
      console.warn('[PubFlow] 云端发布连接失败', error);
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  tryClaim() {
    if (!this.authenticated || !this.pendingJob || this.activeJobId || !this.options.canClaim()) return false;
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    const job = this.pendingJob;
    this.pendingJob = null;
    this.activeJobId = job.jobId;
    this.send({ type: 'CLAIM_JOB', payload: { jobId: job.jobId } });
    return true;
  }

  reportTask(task: DistributionTask) {
    if (task.source !== 'agent' || task.externalTaskSource !== 'cloud' || !task.externalJobId) return;
    this.lastTask = task;
    this.activeJobId = task.externalJobId;
    task.statusSequence = Math.max(3, task.statusSequence || 3) + 1;
    const status = agentTaskStatus(task);
    this.send({
      type: 'JOB_STATUS',
      payload: {
        jobId: task.externalJobId,
        status,
        statusSequence: task.statusSequence,
        error: status === 'failed' ? task.error || task.platforms.find((item) => item.error)?.error : undefined,
      },
    });
    if (status !== 'running') {
      this.activeJobId = '';
      this.lastTask = null;
      this.options.onPending();
    }
  }

  reportFailure(jobId: string, error: unknown, statusSequence: number) {
    this.send({
      type: 'JOB_STATUS',
      payload: {
        jobId,
        status: 'failed',
        statusSequence,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    if (this.activeJobId === jobId) this.activeJobId = '';
    this.lastTask = null;
  }

  resumeTask(task: DistributionTask | null) {
    if (task?.source !== 'agent' || task.externalTaskSource !== 'cloud' || !task.externalJobId) return;
    if (agentTaskStatus(task) !== 'running') return;
    this.lastTask = task;
    this.activeJobId = task.externalJobId;
  }

  private async handleMessage(raw: unknown) {
    if (!(raw instanceof ArrayBuffer) || !this.wasm || !this.inboundKey) return;
    const decoded = parseResult<PfrpDecodeResult>(this.wasm.pfrp_decode_message(
      arrayBufferToBase64(raw),
      this.inboundKey,
      BigInt(this.inboundSequence),
    ));
    if (!decoded.ok || !decoded.payload) {
      console.warn('[PubFlow] PFRP 消息校验失败', decoded.error);
      this.socket?.close();
      return;
    }
    this.inboundSequence += 1;
    const message = decoded.payload;
    if (message.type === 'AUTH_OK') {
      this.authenticated = true;
      if (this.lastTask) this.reportTask(this.lastTask);
      this.options.onPending();
      return;
    }
    if (message.type === 'CHANNEL_PROBE') {
      this.send({
        type: 'CHANNEL_PROBE_ACK',
        payload: {
          testId: message.payload.testId,
          serverSentAt: message.payload.serverSentAt,
        },
      });
      return;
    }
    if (message.type === 'JOB_AVAILABLE') {
      this.pendingJob = message.payload;
      this.options.onPending();
      return;
    }
    if (message.type === 'JOB_DETAIL' && message.payload.jobId === this.activeJobId) {
      const job = message.payload;
      try {
        await materializeRemoteProject(job.project, job.assets, this.apiBaseUrl);
        const materializedSequence = job.statusSequence + 1;
        this.send({ type: 'PROJECT_MATERIALIZED', payload: { jobId: job.jobId, statusSequence: materializedSequence } });
        await this.options.onJob({
          jobId: job.jobId,
          projectId: job.projectId,
          projectPath: '',
          contentType: job.project.video.contentType || 'video',
          title: job.project.video.title,
          platforms: job.platforms,
          status: 'materialized',
          statusSequence: materializedSequence,
          autoSubmit: job.publishMode === 'auto_submit',
        });
      } catch (error) {
        this.reportFailure(job.jobId, error, job.statusSequence + 2);
      } finally {
        this.options.onClaimSettled();
      }
      return;
    }
    if (message.type === 'ERROR') {
      console.warn('[PubFlow] 云端任务命令失败', message.payload);
      if (this.activeJobId) {
        this.activeJobId = '';
        this.options.onClaimSettled();
      }
      this.socket?.close();
    }
  }

  private send(message: object) {
    if (!this.wasm || !this.outboundKey || this.socket?.readyState !== WebSocket.OPEN) return false;
    const encoded = parseResult<{ ok: boolean; error?: string; frame_base64?: string }>(
      this.wasm.pfrp_encode_message(JSON.stringify(message), this.outboundKey, BigInt(this.outboundSequence)),
    );
    if (!encoded.ok || !encoded.frame_base64) return false;
    this.socket.send(base64ToArrayBuffer(encoded.frame_base64));
    this.outboundSequence += 1;
    return true;
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.send({ type: 'PING', payload: { timestamp: Date.now() } }), HEARTBEAT_INTERVAL_MS);
  }

  private handleDisconnect(socket: WebSocket) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.authenticated = false;
    this.outboundKey = '';
    this.inboundKey = '';
    if (this.activeJobId && !this.lastTask) {
      this.activeJobId = '';
      this.options.onClaimSettled();
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.manuallyStopped || this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected();
    }, delay);
  }
}

function cloudWebSocketUrl(apiBaseUrl: string) {
  const url = new URL('/v1/remote/extension/ws', `${apiBaseUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function parseResult<T>(value: string): T {
  return JSON.parse(value) as T;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer;
}

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
