import { forbidCurator } from '@/lib/curator-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request) {
  return forbidCurator(req);
}

export function PUT(req: Request) {
  return forbidCurator(req);
}

export function PATCH(req: Request) {
  return forbidCurator(req);
}

export function DELETE(req: Request) {
  return forbidCurator(req);
}
