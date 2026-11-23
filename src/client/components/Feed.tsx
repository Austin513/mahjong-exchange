import type { FeedItem } from "../../shared/protocol";

export function Feed({ items }: { items: FeedItem[] }) {
  return (
    <section className="panel feed" aria-label="Event feed">
      <h3>Table & market feed</h3>
      <ol className="feed-list" aria-live="polite">
        {[...items].reverse().map((f) => (
          <li key={f.id} className={`feed-${f.kind}`}>
            <time>{new Date(f.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time> {f.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
