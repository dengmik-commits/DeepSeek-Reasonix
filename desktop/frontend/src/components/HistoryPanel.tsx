import { useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import type { SessionMeta } from "../lib/types";

// HistoryPanel is the desktop session switcher: a right-side drawer listing saved
// sessions newest-first, grouped by day. Each row resumes on click, and carries
// rename (a custom display name) and delete actions on hover — the desktop
// analogue of managing conversations in Claude Code. The active session can't be
// deleted (auto-save would just recreate it).
export function HistoryPanel({
  sessions,
  onResume,
  onDelete,
  onRename,
  onClose,
}: {
  sessions: SessionMeta[];
  onResume: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, title: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const startRename = (s: SessionMeta) => {
    setConfirming(null);
    setEditing(s.path);
    setDraft(s.title || s.preview || "");
  };
  const commitRename = (path: string) => {
    onRename(path, draft.trim());
    setEditing(null);
  };

  // Sessions arrive newest-first; bucket consecutive ones under a day heading
  // (Today / Yesterday / a date) while preserving that order.
  const groups: { label: string; items: SessionMeta[] }[] = [];
  for (const s of sessions) {
    const label = dayLabel(s.modTime);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(s);
    else groups.push({ label, items: [s] });
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer__head">
          <div className="drawer__title">History</div>
          <button className="chip" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        <div className="drawer__body">
          {sessions.length === 0 ? (
            <div className="mem-empty">No saved sessions yet.</div>
          ) : (
            groups.map((g) => (
              <section className="mem-section" key={g.label}>
                <div className="mem-section__title">{g.label}</div>
                {g.items.map((s) => (
                  <div className={`hist-item${s.current ? " hist-item--current" : ""}`} key={s.path}>
                    {editing === s.path ? (
                      <input
                        className="hist-item__rename"
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(s.path);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        onBlur={() => commitRename(s.path)}
                        placeholder="Session name…"
                      />
                    ) : (
                      <button className="hist-item__main" onClick={() => onResume(s.path)} title={s.path}>
                        <div className="hist-item__preview">{s.title || s.preview || "(empty session)"}</div>
                        <div className="hist-item__meta">
                          {s.current && <span className="hist-item__badge">current</span>}
                          <span>
                            {s.turns} turn{s.turns === 1 ? "" : "s"}
                          </span>
                          <span>·</span>
                          <span>{timeLabel(s.modTime)}</span>
                        </div>
                      </button>
                    )}

                    {editing !== s.path && (
                      <div className="hist-item__actions">
                        {confirming === s.path ? (
                          <>
                            <button
                              className="hist-act hist-act--danger"
                              title="Confirm delete"
                              onClick={() => {
                                onDelete(s.path);
                                setConfirming(null);
                              }}
                            >
                              <Check size={14} />
                            </button>
                            <button className="hist-act" title="Cancel" onClick={() => setConfirming(null)}>
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="hist-act" title="Rename" onClick={() => startRename(s)}>
                              <Pencil size={13} />
                            </button>
                            {!s.current && (
                              <button className="hist-act" title="Delete" onClick={() => setConfirming(s.path)}>
                                <Trash2 size={13} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

// dayLabel buckets a timestamp into "Today", "Yesterday", or a locale date.
function dayLabel(ms: number): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(ms))) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(ms).toLocaleDateString();
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
