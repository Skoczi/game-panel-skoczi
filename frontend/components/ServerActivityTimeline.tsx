import { Activity, Check, AlertCircle, RotateCw, Terminal, UserRound } from 'lucide-react';
import type { ServerHistoryEntry } from '../utils/serverRuntime';
import './serverSettings/server-activity.css';

function presentEntry(entry: ServerHistoryEntry) {
  const prefix = entry.message.match(/^\[([^\]]+)\]\s*/);
  const actor = prefix?.[1] || 'System';
  const message = prefix ? entry.message.slice(prefix[0].length) : entry.message;
  const command = message.match(/^(Console command sent|Console command failed \(exitCode=\d+\)|Startup command):\s*([\s\S]*)$/);
  const title = command?.[1] || message;
  const failed = entry.level === 'error' || title.startsWith('Console command failed');
  const warning = entry.level === 'warning';
  const success = entry.level === 'success' || /^(Server installed successfully|Container is running)/.test(message);
  const Icon = failed || warning ? AlertCircle : command || title === 'Console command sent' ? Terminal : /^(Restarting|Starting|Stopping) server/.test(message) ? RotateCw : success ? Check : Activity;
  return { actor, title, command: command?.[2], Icon, tone: failed ? 'error' : warning ? 'warning' : success ? 'success' : command ? 'command' : 'neutral' };
}

export function ServerActivityTimeline({ entries }: { entries: ServerHistoryEntry[] }) {
  const groups: { key: string; date: string; entries: ServerHistoryEntry[] }[] = [];
  for (const entry of [...entries].reverse()) {
    const timestamp = new Date(entry.timestamp);
    const valid = !Number.isNaN(timestamp.getTime());
    const key = valid ? timestamp.toDateString() : 'unknown';
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, date: valid ? timestamp.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Unknown date', entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return <div className="gp-activity-timeline">
    {groups.map((group, index) => <section className="gp-activity-day" key={`${group.key}-${index}`} aria-label={group.date}>
      <div className="gp-activity-date">{group.date}</div>
      <ol className="gp-activity-events">
        {group.entries.map(entry => {
          const item = presentEntry(entry);
          const timestamp = new Date(entry.timestamp);
          const valid = !Number.isNaN(timestamp.getTime());
          return <li className={`gp-activity-event is-${item.tone}`} key={entry.id}>
            <div className="gp-activity-marker" aria-hidden="true"><item.Icon size={17} /></div>
            <div className="gp-activity-event-body">
              <div className="gp-activity-meta">
                <span className="gp-activity-actor"><UserRound size={12} aria-hidden="true" />{item.actor}</span>
                <time dateTime={valid ? timestamp.toISOString() : undefined} title={valid ? timestamp.toLocaleString() : entry.timestamp}>
                  {valid ? timestamp.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : entry.timestamp}
                </time>
                {item.tone === 'error' && <span className="gp-activity-severity">Error</span>}
                {item.tone === 'warning' && <span className="gp-activity-severity">Warning</span>}
              </div>
              <div className="gp-activity-title">{item.title}</div>
              {item.command && <pre className="gp-activity-command"><code>{item.command}</code></pre>}
            </div>
          </li>;
        })}
      </ol>
    </section>)}
  </div>;
}
