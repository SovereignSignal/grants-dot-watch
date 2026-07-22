import type { ProposalType } from './types';

export function neverAutoReasonFor(type: ProposalType | string): string | null {
  switch (type) {
    case 'new_org':
      return 'new organizations require owner review';
    case 'new_program':
      return 'new programs require owner review';
    case 'new_award':
      return 'award creation requires owner review';
    case 'profile_note':
      return 'profile and identity changes require owner review';
    case 'status_change':
      return 'status changes require owner review';
    case 'merge_orgs':
      return 'org merges are never automated';
    default:
      return null;
  }
}
