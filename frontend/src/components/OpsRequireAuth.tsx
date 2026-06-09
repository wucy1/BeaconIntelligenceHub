import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { getOpsToken, getOpsUser } from '../ops/opsAuth';

export function OpsRequireAuth({ children }: { children: ReactNode }) {
  if (!getOpsToken() || !getOpsUser()) {
    return <Navigate to="/ops/login" replace />;
  }
  return children;
}
