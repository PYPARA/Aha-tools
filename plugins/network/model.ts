// Mirrors src-tauri/src/plugins/network.rs.

export interface Address { interface: string; label: string; ip: string; v6: boolean }
export interface Local { addresses: Address[]; gateway: string | null; gatewayInterface: string | null }
export interface DnsRecord { kind: string; values: string[] }
export interface DnsResult { host: string; server: string | null; records: DnsRecord[]; system: string[]; hostsFile: string[] }
export interface Listener { port: number; address: string; pid: number; process: string; user: string }

export const TABS = [
  { feature: "ip", label: "本机 IP" },
  { feature: "ping", label: "Ping" },
  { feature: "dns", label: "DNS 查询" },
  { feature: "port", label: "端口占用" },
] as const;

/** Milliseconds from a reply line: "64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=8.123 ms". */
export function replyTime(line: string): number | null {
  const m = line.match(/\btime[=<]([\d.]+) ?ms\b/);
  return m ? Number(m[1]) : null;
}

export interface PingSummary { sent: number; received: number; loss: number; min: number | null; avg: number | null; max: number | null }

/** Counts from the replies so far, replaced by ping's own summary once it prints one. */
export function summarize(lines: string[]): PingSummary {
  const times = lines.map(replyTime).filter((t): t is number => t !== null);
  const sent = lines.filter((l) => /icmp_seq[=\s]/.test(l) || /Request timeout/i.test(l)).length;
  let summary: PingSummary = {
    sent, received: times.length, loss: sent ? Math.round((1 - times.length / sent) * 1000) / 10 : 0,
    min: times.length ? Math.min(...times) : null, avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null, max: times.length ? Math.max(...times) : null,
  };
  for (const line of lines) {
    const counts = line.match(/(\d+) packets transmitted, (\d+) (?:packets )?received, ([\d.]+)% packet loss/);
    if (counts) summary = { ...summary, sent: Number(counts[1]), received: Number(counts[2]), loss: Number(counts[3]) };
    const rtt = line.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)/);
    if (rtt && /round-trip|rtt/.test(line)) summary = { ...summary, min: Number(rtt[1]), avg: Number(rtt[2]), max: Number(rtt[3]) };
  }
  return summary;
}

export const ms = (value: number | null) => value === null ? "—" : `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`;

/** Listeners whose port, process, address or pid contains the filter. */
export function filterListeners(rows: Listener[], filter: string) {
  const q = filter.trim().replace(/^:/, "").toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => String(r.port) === q || String(r.port).startsWith(q) || r.process.toLowerCase().includes(q) || r.address.includes(q) || String(r.pid) === q);
}
