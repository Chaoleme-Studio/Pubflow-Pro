export interface OrderFilters {
  keyword: string;
  tier: string;
  plan: string;
  status: string;
  paidFrom: string;
  paidTo: string;
  expiresFrom: string;
  expiresTo: string;
}

export function emptyOrderFilters(): OrderFilters {
  return {
    keyword: '',
    tier: 'all',
    plan: 'all',
    status: 'all',
    paidFrom: '',
    paidTo: '',
    expiresFrom: '',
    expiresTo: '',
  };
}
