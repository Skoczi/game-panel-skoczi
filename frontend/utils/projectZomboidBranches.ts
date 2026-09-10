import { CATALOG_BASE_URL } from './api/runtime';

export interface ProjectZomboidBranch {
  name: string;
  buildId?: string;
  updatedAt?: string;
  description?: string;
}

export async function fetchProjectZomboidBranches(): Promise<ProjectZomboidBranch[]> {
  try {
    const res = await fetch(`${CATALOG_BASE_URL}/project-zomboid/branches`);
    if (!res.ok) return [];
    const data = (await res.json()) as { branches?: ProjectZomboidBranch[] };
    return Array.isArray(data?.branches) ? data.branches : [];
  } catch {
    return [];
  }
}
