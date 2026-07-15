import type { ProposalType } from './types';

export function neverAutoReasonFor(type: ProposalType | string): string | null {
  switch (type) {
    case 'new_program':
      return 'new programs require owner review';
    case 'new_award':
      return 'award creation requires owner review';
    case 'merge_orgs':
      return 'org merges are never automated';
    default:
      return null;
  }
}
