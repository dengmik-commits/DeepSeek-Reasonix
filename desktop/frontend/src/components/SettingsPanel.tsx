import { useEffect, useState } from "react";
import { app } from "../lib/bridge";
import { applyTheme, getTheme, type Theme } from "../lib/theme";
import type { ProviderView, SettingsView } from "../lib/types";

// SettingsPanel is the desktop settings surface, aligning with Claude Code's
// settings: model & providers (incl. API keys), permissions, sandbox, agent
// params, and appearance. Every change writes reasonix.toml (or .env for keys)
// through the kernel's config edit API and rebuilds the controller live.
export function SettingsPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [s, setS] = useState<SettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(getTheme());

  const reload = async () => setS(await app.Settings().catch(() => null));
  useEffect(() => {
    void reload();
  }, []);

  // apply runs a mutation, re-reads settings, and refreshes the topbar/model. A
  // rejected binding (validation / rebuild failure) surfaces as an inline banner.
  const apply = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer drawer--wide" onClick={(e) => e.stopPropagation()}>
        <header className="drawer__head">
          <div className="drawer__title">Settings</div>
          <button className="chip" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        {!s ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="drawer__body">
            {err && <div className="banner banner--error">{err}</div>}
            <ModelsSection s={s} busy={busy} apply={apply} />
            <PermissionsSection s={s} busy={busy} apply={apply} />
            <SandboxSection s={s} busy={busy} apply={apply} />
            <AgentSection s={s} busy={busy} apply={apply} />
            <AppearanceSection
              s={s}
              theme={theme}
              onTheme={(t) => {
                applyTheme(t);
                setThemeState(t);
              }}
              apply={apply}
            />
            {s.configPath && (
              <div className="mem-hint" title={s.configPath}>
                config: {s.configPath || "reasonix.toml (new)"}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

type SectionProps = {
  s: SettingsView;
  busy: boolean;
  apply: (fn: () => Promise<void>) => Promise<void>;
};

// allRefs flattens providers into "provider/model" refs for the model selectors.
function allRefs(s: SettingsView): string[] {
  const out: string[] = [];
  for (const p of s.providers) for (const m of p.models) out.push(`${p.name}/${m}`);
  return out;
}

// toRef normalises a stored model id (a provider name, a bare model, or a ref) to
// a "provider/model" ref so a <select> of refs can show it selected.
function toRef(model: string, s: SettingsView): string {
  if (!model) return "";
  if (model.includes("/")) return model;
  const byName = s.providers.find((p) => p.name === model);
  if (byName) return `${byName.name}/${byName.default || byName.models[0] || ""}`;
  const byModel = s.providers.find((p) => p.models.includes(model));
  if (byModel) return `${byModel.name}/${model}`;
  return model;
}

function ModelsSection({ s, busy, apply }: SectionProps) {
  const refs = allRefs(s);
  // The provider backing the default model — can't be deleted (would dangle the
  // default). default_model may be a provider name or a "provider/model" ref.
  const defaultProvider = toRef(s.defaultModel, s).split("/")[0];
  const [editing, setEditing] = useState<string | null>(null); // provider name, or "__new__"

  return (
    <section className="mem-section">
      <div className="mem-section__title">Models & providers</div>

      <div className="set-row">
        <label className="set-label">Default model</label>
        <select
          className="mem-select set-grow"
          value={toRef(s.defaultModel, s)}
          disabled={busy}
          onChange={(e) => void apply(() => app.SetDefaultModel(e.target.value))}
        >
          {refs.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="set-row">
        <label className="set-label">Planner model</label>
        <select
          className="mem-select set-grow"
          value={toRef(s.plannerModel, s)}
          disabled={busy}
          onChange={(e) => void apply(() => app.SetPlannerModel(e.target.value))}
        >
          <option value="">(none — single model)</option>
          {refs.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {s.providers.map((p) =>
        editing === p.name ? (
          <ProviderEditor
            key={p.name}
            initial={p}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(pv) => apply(() => app.SaveProvider(pv)).then(() => setEditing(null))}
          />
        ) : (
          <div className="prov-card" key={p.name}>
            <div className="prov-card__head">
              <span className="prov-card__name">{p.name}</span>
              <span className={`badge ${p.keySet ? "badge--project" : "badge--feedback"}`}>
                {p.keySet ? "key set" : "no key"}
              </span>
              <span className="prov-card__spacer" />
              <button className="btn btn--small" disabled={busy} onClick={() => setEditing(p.name)}>
                Edit
              </button>
              <button
                className="btn btn--small"
                disabled={busy || defaultProvider === p.name}
                title={defaultProvider === p.name ? "Can't delete the default provider" : "Delete provider"}
                onClick={() => void apply(() => app.DeleteProvider(p.name))}
              >
                Delete
              </button>
            </div>
            <div className="prov-card__meta">
              {p.kind} · {p.baseUrl} · {p.models.join(", ")}
            </div>
            <KeyField apiKeyEnv={p.apiKeyEnv} busy={busy} onSet={(v) => apply(() => app.SetProviderKey(p.apiKeyEnv, v))} />
          </div>
        ),
      )}

      {editing === "__new__" ? (
        <ProviderEditor
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(pv) => apply(() => app.SaveProvider(pv)).then(() => setEditing(null))}
        />
      ) : (
        <button className="btn btn--small" disabled={busy} onClick={() => setEditing("__new__")}>
          + Add provider
        </button>
      )}
    </section>
  );
}

function ProviderEditor({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial?: ProviderView;
  busy: boolean;
  onCancel: () => void;
  onSave: (p: ProviderView) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState(initial?.kind ?? "openai");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [models, setModels] = useState((initial?.models ?? []).join(", "));
  const [apiKeyEnv, setApiKeyEnv] = useState(initial?.apiKeyEnv ?? "");
  const [ctx, setCtx] = useState(String(initial?.contextWindow ?? 0));

  const save = () => {
    const ms = models
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    onSave({
      name: name.trim(),
      kind: kind.trim() || "openai",
      baseUrl: baseUrl.trim(),
      models: ms,
      default: ms[0] ?? "",
      apiKeyEnv: apiKeyEnv.trim(),
      keySet: initial?.keySet ?? false,
      contextWindow: Number(ctx) || 0,
    });
  };

  return (
    <div className="prov-card prov-card--edit">
      <input className="mem-input" placeholder="name (e.g. deepseek-flash)" value={name} onChange={(e) => setName(e.target.value)} disabled={!!initial} />
      <input className="mem-input" placeholder="kind (openai)" value={kind} onChange={(e) => setKind(e.target.value)} />
      <input className="mem-input" placeholder="base_url (https://…)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      <input className="mem-input" placeholder="models (comma-separated)" value={models} onChange={(e) => setModels(e.target.value)} />
      <input className="mem-input" placeholder="api_key_env (e.g. DEEPSEEK_API_KEY)" value={apiKeyEnv} onChange={(e) => setApiKeyEnv(e.target.value)} />
      <input className="mem-input" placeholder="context_window (tokens)" value={ctx} onChange={(e) => setCtx(e.target.value)} />
      <div className="prov-card__actions">
        <button className="btn btn--small" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn--primary btn--small" onClick={save} disabled={busy || !name.trim() || !baseUrl.trim()}>
          Save
        </button>
      </div>
    </div>
  );
}

function KeyField({ apiKeyEnv, busy, onSet }: { apiKeyEnv: string; busy: boolean; onSet: (v: string) => Promise<void> }) {
  const [val, setVal] = useState("");
  if (!apiKeyEnv) return null;
  return (
    <div className="set-key">
      <input
        className="mem-input"
        type="password"
        placeholder={`set ${apiKeyEnv} (→ .env)`}
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <button
        className="btn btn--small"
        disabled={busy || !val.trim()}
        onClick={() => {
          void onSet(val.trim());
          setVal("");
        }}
      >
        Save key
      </button>
    </div>
  );
}

function PermissionsSection({ s, busy, apply }: SectionProps) {
  return (
    <section className="mem-section">
      <div className="mem-section__title">Permissions</div>
      <div className="set-row">
        <label className="set-label">Writer mode</label>
        <select
          className="mem-select set-grow"
          value={s.permissions.mode}
          disabled={busy}
          onChange={(e) => void apply(() => app.SetPermissionMode(e.target.value))}
        >
          <option value="ask">ask (prompt before writers)</option>
          <option value="allow">allow (auto-run writers)</option>
          <option value="deny">deny (block writers)</option>
        </select>
      </div>
      {(["deny", "ask", "allow"] as const).map((list) => (
        <RuleList
          key={list}
          list={list}
          rules={s.permissions[list]}
          busy={busy}
          onAdd={(rule) => apply(() => app.AddPermissionRule(list, rule))}
          onRemove={(rule) => apply(() => app.RemovePermissionRule(list, rule))}
        />
      ))}
      <div className="mem-hint">Rule form: ToolName or ToolName(glob). Precedence: deny &gt; ask &gt; allow.</div>
    </section>
  );
}

function RuleList({
  list,
  rules,
  busy,
  onAdd,
  onRemove,
}: {
  list: string;
  rules: string[];
  busy: boolean;
  onAdd: (rule: string) => Promise<void>;
  onRemove: (rule: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const r = draft.trim();
    if (r) {
      void onAdd(r);
      setDraft("");
    }
  };
  return (
    <div className="set-rules">
      <div className="set-rules__label">{list}</div>
      <div className="set-rules__chips">
        {rules.length === 0 && <span className="mem-empty">none</span>}
        {rules.map((r) => (
          <span className="set-rule" key={r}>
            {r}
            <button className="set-rule__x" disabled={busy} onClick={() => void onRemove(r)} title="Remove">
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="set-rules__add">
        <input
          className="mem-input"
          placeholder={`add ${list} rule…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button className="btn btn--small" disabled={busy || !draft.trim()} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

function SandboxSection({ s, busy, apply }: SectionProps) {
  const sb = s.sandbox;
  const [root, setRoot] = useState(sb.workspaceRoot);
  const set = (next: Partial<typeof sb>) =>
    apply(() => app.SetSandbox(next.bash ?? sb.bash, next.network ?? sb.network, next.workspaceRoot ?? sb.workspaceRoot, next.allowWrite ?? sb.allowWrite));

  return (
    <section className="mem-section">
      <div className="mem-section__title">Sandbox & workspace</div>
      <div className="set-row">
        <label className="set-label">Bash sandbox</label>
        <select className="mem-select set-grow" value={sb.bash} disabled={busy} onChange={(e) => void set({ bash: e.target.value })}>
          <option value="enforce">enforce (jail bash)</option>
          <option value="off">off (run unconfined)</option>
        </select>
      </div>
      <label className="set-check">
        <input type="checkbox" checked={sb.network} disabled={busy} onChange={(e) => void set({ network: e.target.checked })} />
        Allow network egress from sandboxed bash
      </label>
      <div className="set-row">
        <label className="set-label">Workspace root</label>
        <input
          className="mem-input set-grow"
          placeholder="(default: cwd)"
          value={root}
          disabled={busy}
          onChange={(e) => setRoot(e.target.value)}
          onBlur={() => root !== sb.workspaceRoot && void set({ workspaceRoot: root })}
        />
      </div>
      <RuleList
        list="allow_write"
        rules={sb.allowWrite}
        busy={busy}
        onAdd={(d) => set({ allowWrite: [...sb.allowWrite, d] })}
        onRemove={(d) => set({ allowWrite: sb.allowWrite.filter((x) => x !== d) })}
      />
    </section>
  );
}

function AgentSection({ s, busy, apply }: SectionProps) {
  const [temp, setTemp] = useState(String(s.agent.temperature));
  const [steps, setSteps] = useState(String(s.agent.maxSteps));
  const [prompt, setPrompt] = useState(s.agent.systemPrompt);
  const dirty = temp !== String(s.agent.temperature) || steps !== String(s.agent.maxSteps) || prompt !== s.agent.systemPrompt;

  return (
    <section className="mem-section">
      <div className="mem-section__title">Agent</div>
      <div className="set-row">
        <label className="set-label">Temperature</label>
        <input className="mem-input set-narrow" value={temp} onChange={(e) => setTemp(e.target.value)} disabled={busy} />
        <label className="set-label">Max steps</label>
        <input className="mem-input set-narrow" value={steps} onChange={(e) => setSteps(e.target.value)} disabled={busy} />
        <span className="mem-hint">0 = unlimited</span>
      </div>
      <div className="set-rules__label">System prompt</div>
      <textarea className="mem-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy} spellCheck={false} />
      <div className="prov-card__actions">
        <button
          className="btn btn--primary btn--small"
          disabled={busy || !dirty}
          onClick={() => void apply(() => app.SetAgentParams(Number(temp) || 0, Number(steps) || 0, prompt))}
        >
          Save agent settings
        </button>
      </div>
    </section>
  );
}

function AppearanceSection({
  s,
  theme,
  onTheme,
  apply,
}: {
  s: SettingsView;
  theme: Theme;
  onTheme: (t: Theme) => void;
  apply: (fn: () => Promise<void>) => Promise<void>;
}) {
  return (
    <section className="mem-section">
      <div className="mem-section__title">Appearance & language</div>
      <div className="set-row">
        <label className="set-label">Theme</label>
        <div className="set-seg">
          {(["auto", "light", "dark"] as const).map((t) => (
            <button key={t} className={`set-seg__btn ${theme === t ? "set-seg__btn--on" : ""}`} onClick={() => onTheme(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <label className="set-label">Language</label>
        <select className="mem-select set-grow" value={s.language} onChange={(e) => void apply(() => app.SetLanguage(e.target.value))}>
          <option value="">Auto (system)</option>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>
    </section>
  );
}
