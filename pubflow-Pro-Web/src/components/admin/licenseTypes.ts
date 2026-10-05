export interface LicenseFilters {
  keyword: string;
  tier: string;
  plan: string;
  status: string;
  batchId: string;
  sourceChannel: string;
  createdFrom: string;
  createdTo: string;
}

export function emptyLicenseFilters(): LicenseFilters {
  return {
    keyword: '',
    tier: 'all',
    plan: 'all',
    status: 'all',
    batchId: 'all',
    sourceChannel: 'all',
    createdFrom: '',
    createdTo: '',
  };
}
