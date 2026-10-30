/** IPC contract for the built-in hosts plugin; mirrored by plugins/hosts.rs. */
export interface HostScheme {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
}

export interface HostLocation { schemeId: string | null; line: number }
export interface HostIssue {
  code: string;
  message: string;
  blocking: boolean;
  location: HostLocation;
  related: HostLocation[];
}
export interface HostsValidation { issues: HostIssue[]; counts: Record<string, number> }
export interface HostsSnapshot {
  schemes: HostScheme[];
  current: string;
  original: string | null;
  revision: string;
  managed: boolean;
  matchesSaved: boolean;
  markerError: string | null;
}
export interface HostsOperation {
  snapshot: HostsSnapshot | null;
  systemWritten: boolean;
  profilesSaved: boolean;
  dnsFlushed: boolean;
  cancelled: boolean;
  error: string | null;
}
