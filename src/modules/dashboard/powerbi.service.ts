import { config } from '../../config/env';
import { ApiError } from '../../utils/apiError';

/**
 * Power BI embedding. Ported from the standalone Dashboard Portal. Resolves an
 * embed configuration in priority order: REAL (service principal / app-owns-data)
 * → SECURE ("Website or portal" iframe URL) → MOCK (placeholder). Authorization
 * (is this user assigned this dashboard?) happens in the caller, not here.
 */
export interface EmbedConfig {
  mode: 'mock' | 'secure' | 'real';
  reportId: string | null;
  embedUrl: string | null; // SDK embed URL — 'real' mode
  secureEmbedUrl: string | null; // iframe src — 'secure' mode
  accessToken: string | null;
  tokenExpiry: string | null;
  allowExport: boolean;
  message?: string;
}

interface DashboardEmbedInput {
  reportId: string | null;
  embedUrl: string | null;
  secureEmbedUrl: string | null;
  workspaceId: string | null;
  allowExport: boolean;
}

const AAD_SCOPE = 'https://analysis.windows.net/powerbi/api/.default';
const PBI_API = 'https://api.powerbi.com/v1.0/myorg';

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAadToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.powerbi.clientId,
    client_secret: config.powerbi.clientSecret,
    scope: AAD_SCOPE,
  });
  const res = await fetch(`https://login.microsoftonline.com/${config.powerbi.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw ApiError.badRequest(`Azure AD rejected the service principal: ${json.error_description ?? res.statusText}`);
  }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
  return cachedToken.value;
}

async function powerBiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${PBI_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw ApiError.badRequest('Power BI denied the service principal. Add it to the workspace as a Member and enable service-principal API access in the Admin portal.');
    }
    if (res.status === 404) {
      throw ApiError.badRequest('Power BI could not find that workspace/report. A service principal cannot read "My workspace".');
    }
    throw ApiError.badRequest(`Power BI API error (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export interface PowerBiDiagnostics {
  ok: boolean;
  mode: string;
  steps: { name: string; ok: boolean; detail: string }[];
  workspaces: { id: string; name: string }[];
}

/** Step-by-step check of the service-principal setup (for the admin "Test connection" button). */
export async function diagnose(): Promise<PowerBiDiagnostics> {
  const steps: PowerBiDiagnostics['steps'] = [];
  const workspaces: PowerBiDiagnostics['workspaces'] = [];

  if (config.powerbi.mode !== 'real') {
    steps.push({ name: 'Mode', ok: true, detail: 'Running in MOCK mode — dashboards show placeholders. Set POWERBI_MODE=real + credentials for live Power BI.' });
    return { ok: false, mode: config.powerbi.mode, steps, workspaces };
  }
  const missing = (['tenantId', 'clientId', 'clientSecret'] as const).filter((k) => !config.powerbi[k]);
  if (missing.length) {
    steps.push({ name: 'Credentials configured', ok: false, detail: `Missing: ${missing.join(', ')}` });
    return { ok: false, mode: config.powerbi.mode, steps, workspaces };
  }
  steps.push({ name: 'Credentials configured', ok: true, detail: 'Tenant, client id and secret are set.' });

  let token: string;
  try {
    token = await getAadToken();
    steps.push({ name: 'Azure AD sign-in', ok: true, detail: 'The service principal authenticated successfully.' });
  } catch (err) {
    steps.push({ name: 'Azure AD sign-in', ok: false, detail: err instanceof ApiError ? err.message : 'Could not reach Azure AD.' });
    return { ok: false, mode: config.powerbi.mode, steps, workspaces };
  }
  try {
    const groups = await powerBiGet<{ value: { id: string; name: string }[] }>('/groups', token);
    workspaces.push(...groups.value.map((g) => ({ id: g.id, name: g.name })));
    steps.push({ name: 'Power BI workspace access', ok: workspaces.length > 0, detail: workspaces.length ? `Can see ${workspaces.length} workspace(s).` : 'Authenticated, but not a member of any workspace.' });
    return { ok: workspaces.length > 0, mode: config.powerbi.mode, steps, workspaces };
  } catch (err) {
    steps.push({ name: 'Power BI workspace access', ok: false, detail: err instanceof ApiError ? err.message : 'Power BI API call failed.' });
    return { ok: false, mode: config.powerbi.mode, steps, workspaces };
  }
}

export async function generateEmbedConfig(dash: DashboardEmbedInput): Promise<EmbedConfig> {
  const spConfigured = config.powerbi.mode === 'real' && Boolean(config.powerbi.tenantId && config.powerbi.clientId && config.powerbi.clientSecret);

  if (spConfigured && dash.workspaceId && dash.reportId) {
    const token = await getAadToken();
    const report = await powerBiGet<{ embedUrl: string; datasetId: string }>(`/groups/${dash.workspaceId}/reports/${dash.reportId}`, token);
    const res = await fetch(`${PBI_API}/groups/${dash.workspaceId}/reports/${dash.reportId}/GenerateToken`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessLevel: 'View' }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw ApiError.badRequest(`Power BI refused to issue an embed token (${res.status}). The workspace likely isn't on Embedded/Premium/Fabric capacity. ${detail.slice(0, 200)}`);
    }
    const generated = (await res.json()) as { token: string; expiration: string };
    return { mode: 'real', reportId: dash.reportId, embedUrl: report.embedUrl, secureEmbedUrl: null, accessToken: generated.token, tokenExpiry: generated.expiration, allowExport: dash.allowExport };
  }

  if (dash.secureEmbedUrl) {
    return { mode: 'secure', reportId: dash.reportId, embedUrl: null, secureEmbedUrl: dash.secureEmbedUrl, accessToken: null, tokenExpiry: null, allowExport: dash.allowExport };
  }

  return {
    mode: 'mock',
    reportId: dash.reportId,
    embedUrl: dash.embedUrl,
    secureEmbedUrl: null,
    accessToken: null,
    tokenExpiry: null,
    allowExport: dash.allowExport,
    message: 'No live report connected. An administrator can paste a Power BI "Website or portal" embed URL, or configure a service principal.',
  };
}
