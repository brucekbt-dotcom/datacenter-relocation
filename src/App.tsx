import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { create } from "zustand";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Server, ArrowLeftRight, ArrowRightLeft,
  Plus, Download, Trash2, Edit3, X, ChevronsLeft, ChevronsRight,
  PanelRightClose, PanelRightOpen, CheckCircle2, AlertCircle,
  LogOut, User, Upload, Expand, Minimize, Shield, KeyRound,
  Save, Sparkles, Volume2, Loader2, Link
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

/* -----------------------------
  Gemini API Setup
----------------------------- */
const apiKey = ""; // 執行環境將自動提供 API Key

/* -----------------------------
  Types & LocalStorage
----------------------------- */
type ThemeMode = "dark" | "light";
type ThemeStyle = "neon" | "graphite" | "aurora" | "circuit";
type PageKey = "dashboard" | "devices" | "before" | "after" | "admin";
type DeviceCategory = "Network" | "Storage" | "Server" | "Other";
type PlacementMode = "before" | "after";
type Role = "admin" | "vendor";
type MigrationFlags = { racked: boolean; cabled: boolean; powered: boolean; tested: boolean };
type Rack = { id: string; name: string; units: number };

type Device = {
  id: string; category: DeviceCategory; deviceId: string; name: string;
  brand: string; model: string; ports: number; sizeU: number;
  ip?: string; serial?: string; portMap?: string; connectedTo?: string[];
  beforeRackId?: string; beforeStartU?: number; beforeEndU?: number;
  afterRackId?: string; afterStartU?: number; afterEndU?: number;
  migration: MigrationFlags;
};

type DeviceDraft = Omit<Device, "id" | "migration" | "beforeRackId" | "beforeStartU" | "beforeEndU" | "afterRackId" | "afterStartU" | "afterEndU">;
type UiState = { sideCollapsed: boolean; unplacedCollapsedBefore: boolean; unplacedCollapsedAfter: boolean; };
type Account = { username: string; password: string; role: Role; };

const LS = {
  theme: "migrate.theme", themeStyle: "migrate.themeStyle", devices: "migrate.devices",
  ui: "migrate.ui", auth: "migrate.auth", user: "migrate.user", accounts: "migrate.accounts",
} as const;

/* -----------------------------
  Mock Data & Layouts
----------------------------- */
const BEFORE_RACKS: Rack[] = [
  ...["B10", "B9", "B8", "B7", "B6"].map((n) => ({ id: `BEF_${n}`, name: n, units: 42 })),
  ...["A5", "A4", "A3", "A2", "A1"].map((n) => ({ id: `BEF_${n}`, name: n, units: 42 })),
];

const AFTER_RACKS: Rack[] = [
  ...["A1", "A2", "A3", "A4", "A5", "A6"].map((n) => ({ id: `AFT_${n}`, name: n, units: 42 })),
  ...["B1", "B2", "B3", "B4", "B5", "B6"].map((n) => ({ id: `AFT_${n}`, name: n, units: 42 })),
];

const mockDevices: Device[] = [
  {
    id: "dev-1", category: "Network", deviceId: "SW-CORE-001", name: "Core Switch", brand: "Cisco", model: "Catalyst 9500",
    ports: 48, sizeU: 2, beforeRackId: "BEF_A1", beforeStartU: 40, beforeEndU: 41, connectedTo: ["dev-2", "dev-3"],
    migration: { racked: true, cabled: true, powered: true, tested: true },
  },
  {
    id: "dev-2", category: "Storage", deviceId: "STO-001", name: "Primary Storage", brand: "NetApp", model: "FAS8200",
    ports: 8, sizeU: 4, beforeRackId: "BEF_A2", beforeStartU: 30, beforeEndU: 33, connectedTo: ["dev-1"],
    migration: { racked: false, cabled: false, powered: false, tested: false },
  },
  {
    id: "dev-3", category: "Server", deviceId: "SRV-APP-012", name: "App Server", brand: "Dell", model: "R740",
    ports: 24, sizeU: 2, beforeRackId: "BEF_B6", beforeStartU: 10, beforeEndU: 11, connectedTo: ["dev-1"],
    migration: { racked: false, cabled: false, powered: false, tested: false },
  },
];

/* -----------------------------
  Store & Utils
----------------------------- */
const clampU = (u: number) => Math.max(1, Math.min(42, u));
const rangesOverlap = (aS: number, aE: number, bS: number, bE: number) => Math.max(aS, bS) <= Math.min(aE, bE);
const readJson = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const writeJson = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const catColorVar = (cat: DeviceCategory) => cat === "Network" ? "var(--catNetwork)" : cat === "Storage" ? "var(--catStorage)" : cat === "Server" ? "var(--catServer)" : "var(--catOther)";

interface Store {
  beforeRacks: Rack[]; afterRacks: Rack[]; devices: Device[];
  theme: ThemeMode; themeStyle: ThemeStyle; page: PageKey; selectedDeviceId: string | null; ui: UiState; accounts: Account[];
  isAuthed: boolean; userName: string | null; role: Role;
  login: (u: string, p: string) => { ok: boolean; message?: string }; logout: () => void;
  setPage: (p: PageKey) => void; toggleTheme: () => void; setThemeStyle: (s: ThemeStyle) => void; setSelectedDeviceId: (id: string | null) => void; setUi: (patch: Partial<UiState>) => void;
  addDevice: (draft: DeviceDraft) => void; updateDevice: (id: string, patch: Partial<DeviceDraft>) => void; deleteDeviceById: (id: string) => void;
  clearPlacement: (mode: PlacementMode, id: string) => void; place: (mode: PlacementMode, deviceId: string, rackId: string, startU: number) => { ok: boolean; message?: string };
}

const useStore = create<Store>((set, get) => ({
  beforeRacks: BEFORE_RACKS, afterRacks: AFTER_RACKS,
  devices: readJson<Device[]>(LS.devices, mockDevices),
  theme: (localStorage.getItem(LS.theme) as ThemeMode) || "dark",
  themeStyle: (localStorage.getItem(LS.themeStyle) as ThemeStyle) || "neon",
  page: "dashboard", selectedDeviceId: null, ui: { sideCollapsed: false, unplacedCollapsedBefore: false, unplacedCollapsedAfter: false, ...readJson<UiState>(LS.ui, {}) },
  accounts: readJson<Account[]>(LS.accounts, [{ username: "admin", password: "123", role: "admin" }]),
  isAuthed: localStorage.getItem(LS.auth) === "1", userName: localStorage.getItem(LS.user) || null, role: (localStorage.getItem(LS.user) === "admin" ? "admin" : "vendor") as Role,

  login: (u, p) => {
    const found = get().accounts.find((a) => a.username === u.trim() && a.password === p);
    if (!found) return { ok: false, message: "帳號或密碼錯誤" };
    localStorage.setItem(LS.auth, "1"); localStorage.setItem(LS.user, found.username);
    set({ isAuthed: true, userName: found.username, role: found.role, page: "dashboard" }); return { ok: true };
  },
  logout: () => { localStorage.removeItem(LS.auth); localStorage.removeItem(LS.user); set({ isAuthed: false, userName: null, role: "vendor", page: "dashboard" }); },
  setPage: (page) => set({ page }),
  toggleTheme: () => set((s) => { const next = s.theme === "dark" ? "light" : "dark"; localStorage.setItem(LS.theme, next); return { theme: next }; }),
  setThemeStyle: (ts) => { localStorage.setItem(LS.themeStyle, ts); set({ themeStyle: ts }); },
  setSelectedDeviceId: (id) => set({ selectedDeviceId: id }),
  setUi: (patch) => set((s) => { const next = { ...s.ui, ...patch }; writeJson(LS.ui, next); return { ui: next }; }),
  
  addDevice: (draft) => set((s) => { const next = [...s.devices, { ...draft, id: crypto.randomUUID(), migration: { racked: false, cabled: false, powered: false, tested: false } } as Device]; writeJson(LS.devices, next); return { devices: next }; }),
  updateDevice: (id, patch) => set((s) => { const next = s.devices.map((d) => (d.id === id ? ({ ...d, ...patch } as Device) : d)); writeJson(LS.devices, next); return { devices: next }; }),
  deleteDeviceById: (id) => set((s) => { const next = s.devices.filter((d) => d.id !== id); writeJson(LS.devices, next); return { devices: next, selectedDeviceId: s.selectedDeviceId === id ? null : s.selectedDeviceId }; }),
  clearPlacement: (mode, id) => set((s) => { const next = s.devices.map((d) => d.id !== id ? d : (mode === "before" ? { ...d, beforeRackId: undefined, beforeStartU: undefined, beforeEndU: undefined } : { ...d, afterRackId: undefined, afterStartU: undefined, afterEndU: undefined })); writeJson(LS.devices, next); return { devices: next }; }),
  place: (mode, deviceId, rackId, startU) => {
    const { devices } = get(); const dev = devices.find((d) => d.id === deviceId); if (!dev) return { ok: false, message: "找不到設備" };
    const sU = clampU(startU); const eU = sU + Math.max(1, Math.min(42, dev.sizeU)) - 1;
    if (eU > 42) return { ok: false, message: "超出機櫃高度限制" };
    const collision = devices.find((d) => {
      if (d.id === deviceId) return false;
      const rId = mode === "before" ? d.beforeRackId : d.afterRackId; const s = mode === "before" ? d.beforeStartU : d.afterStartU; const e = mode === "before" ? d.beforeEndU : d.afterEndU;
      return rId === rackId && s != null && e != null && rangesOverlap(sU, eU, s, e);
    });
    if (collision) return { ok: false, message: `位置衝突: ${collision.deviceId}` };
    const next = devices.map((d) => d.id === deviceId ? mode === "before" ? { ...d, beforeRackId: rackId, beforeStartU: sU, beforeEndU: eU } : { ...d, afterRackId: rackId, afterStartU: sU, afterEndU: eU } : d);
    writeJson(LS.devices, next); set({ devices: next }); return { ok: true };
  }
}));

/* -----------------------------
  Theme Styles
----------------------------- */
const ThemeTokens = () => {
  const style = useStore((s) => s.themeStyle);
  const presets: Record<ThemeStyle, { light: string; dark: string }> = {
    neon: { light: ":root{--bg:#f7fafc;--panel:#ffffff;--panel2:#f1f5f9;--text:#0b1220;--muted:#475569;--border:#e2e8f0;--accent:#06b6d4;--accent2:#a855f7;--onColor:#f8fafc;--catNetwork:#6f8f7d;--catStorage:#6a86a6;--catServer:#7a6fa3;--catOther:#b58a1a;--lampOn:#22c55e;--lampOff:#ef4444}", dark: "html.dark{--bg:#05070d;--panel:#0b1220;--panel2:#1a2235;--text:#e5e7eb;--muted:#94a3b8;--border:#1e293b;--accent:#22d3ee;--accent2:#c084fc;--onColor:#f8fafc;--catNetwork:#8fb3a0;--catStorage:#8fb0d3;--catServer:#a79ad9;--catOther:#e0b83a;--lampOn:#22c55e;--lampOff:#ef4444}" },
    graphite: { light: ":root{--bg:#f6f7fb;--panel:#ffffff;--panel2:#eef2f7;--text:#0a0e16;--muted:#6b7280;--border:#e5e7eb;--accent:#3b82f6;--accent2:#111827;--onColor:#f8fafc;--catNetwork:#6f8f7d;--catStorage:#6a86a6;--catServer:#7a6fa3;--catOther:#b58a1a;--lampOn:#22c55e;--lampOff:#ef4444}", dark: "html.dark{--bg:#070a0f;--panel:#0b0f18;--panel2:#0a0e16;--text:#f3f4f6;--muted:#9ca3af;--border:#1f2937;--accent:#38bdf8;--accent2:#94a3b8;--onColor:#f8fafc;--catNetwork:#8fb3a0;--catStorage:#8fb0d3;--catServer:#a79ad9;--catOther:#e0b83a;--lampOn:#22c55e;--lampOff:#ef4444}" },
    aurora: { light: ":root{--bg:#f7fbff;--panel:#ffffff;--panel2:#eef6ff;--text:#081120;--muted:#64748b;--border:#e2e8f0;--accent:#14b8a6;--accent2:#6366f1;--onColor:#f8fafc;--catNetwork:#6f8f7d;--catStorage:#6a86a6;--catServer:#7a6fa3;--catOther:#b58a1a;--lampOn:#22c55e;--lampOff:#ef4444}", dark: "html.dark{--bg:#050913;--panel:#0b1220;--panel2:#081225;--text:#f1f5f9;--muted:#94a3b8;--border:#334155;--accent:#2dd4bf;--accent2:#a5b4fc;--onColor:#f8fafc;--catNetwork:#8fb3a0;--catStorage:#8fb0d3;--catServer:#a79ad9;--catOther:#e0b83a;--lampOn:#22c55e;--lampOff:#ef4444}" },
    circuit: { light: ":root{--bg:#f7f9ff;--panel:#ffffff;--panel2:#edf0ff;--text:#0b1020;--muted:#6b7280;--border:#e2e8f0;--accent:#7c3aed;--accent2:#06b6d4;--onColor:#f8fafc;--catNetwork:#6f8f7d;--catStorage:#6a86a6;--catServer:#7a6fa3;--catOther:#b58a1a;--lampOn:#22c55e;--lampOff:#ef4444}", dark: "html.dark{--bg:#060714;--panel:#0b0b1a;--panel2:#0b1220;--text:#f8fafc;--muted:#a1a1aa;--border:#27272a;--accent:#a78bfa;--accent2:#22d3ee;--onColor:#f8fafc;--catNetwork:#8fb3a0;--catStorage:#8fb0d3;--catServer:#a79ad9;--catOther:#e0b83a;--lampOn:#22c55e;--lampOff:#ef4444}" },
  };
  const css = presets[style] || presets.neon;
  return <style>{`${css.light}\n${css.dark}\n@keyframes dash { to { stroke-dashoffset: -20; } } .cable-anim { animation: dash 1s linear infinite; }`}</style>;
};

/* -----------------------------
  Components
----------------------------- */
function LoginPage() {
  const login = useStore((s) => s.login); const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState<string|null>(null);
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex items-center justify-center p-6"><ThemeTokens />
      <div className="w-full max-w-md bg-[var(--panel)] border border-[var(--border)] rounded-3xl shadow-2xl p-6">
        <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl flex items-center justify-center text-black" style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))", boxShadow: "0 0 18px rgba(34,211,238,0.25)" }}><Server size={18} /></div><div><div className="text-lg font-black">MigratePro</div><div className="text-xs text-[var(--muted)]">機房搬遷專案管理</div></div></div>
        <div className="mt-5 space-y-3">
          <div><label className="text-xs text-[var(--muted)]">帳號(預設admin)</label><input className="mt-1 w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none" value={u} onChange={(e) => setU(e.target.value)} /></div>
          <div><label className="text-xs text-[var(--muted)]">密碼(預設123)</label><input type="password" className="mt-1 w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none" value={p} onChange={(e) => setP(e.target.value)} /></div>
          {err && <div className="text-sm text-red-400">{err}</div>}
          <button onClick={() => { setErr(null); const res = login(u, p); if (!res.ok) setErr(res.message || "登入失敗"); }} className="w-full mt-2 bg-[var(--accent)] text-black font-extrabold py-3 rounded-xl hover:opacity-90">登入</button>
        </div>
      </div>
    </div>
  );
}

function DeviceModal({ title, initial, onClose, onSave }: { title: string; initial: DeviceDraft; onClose: () => void; onSave: (d: DeviceDraft) => void; }) {
  const [d, setD] = useState<DeviceDraft>(initial); const devices = useStore(s => s.devices);
  const otherDevices = devices.filter(x => x.id !== (initial as any).id);
  const toggleConn = (id: string) => setD(p => { const c = p.connectedTo || []; return { ...p, connectedTo: c.includes(id) ? c.filter(x => x !== id) : [...c, id] }; });

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4"><div className="text-xl font-black">{title}</div><button onClick={onClose}><X /></button></div>
        <form className="grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); if (!d.deviceId.trim()) return alert("必填"); onSave({ ...d, ports: Number(d.ports) || 0, sizeU: Math.max(1, Math.min(42, Number(d.sizeU) || 1)) }); }}>
          <div><label className="text-xs text-[var(--muted)]">類別</label><select className="mt-1 w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none" value={d.category} onChange={e=>setD(p=>({...p, category: e.target.value as DeviceCategory}))}>{(["Network", "Storage", "Server", "Other"]).map((x) => (<option key={x} value={x}>{x}</option>))}</select></div>
          <div><label className="text-xs text-[var(--muted)]">設備編號</label><input className="mt-1 w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none" value={d.deviceId} onChange={e=>setD(p=>({...p, deviceId: e.target.value}))} required /></div>
          <div><label className="text-xs text-[var(--muted)]">設備名稱</label><input className="mt-1 w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none" value={d.name} onChange={e=>setD(p=>({...p, name: e.target.value}))} required /></div>
          <div><label className="text-xs text-[var(--muted)]">占用高度(U)</label><input type="number" className="mt-1 w-full bg-[var(--panel2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm outline-none" value={d.sizeU} onChange={e=>setD(p=>({...p, sizeU: Number(e.target.value)}))} /></div>
          
          <div className="md:col-span-2 mt-2 pt-4 border-t border-[var(--border)]">
            <label className="text-sm font-bold text-[var(--accent)] flex items-center gap-2 mb-2"><Link size={16}/> 選擇網路線對接設備 (SVG動畫用)</label>
            <div className="max-h-32 overflow-y-auto bg-[var(--panel2)] rounded-xl border border-[var(--border)] p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
              {otherDevices.map(od => (
                <label key={od.id} className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg cursor-pointer">
                  <input type="checkbox" checked={(d.connectedTo || []).includes(od.id)} onChange={() => toggleConn(od.id)} className="rounded" />
                  <span className="text-sm font-bold truncate">{od.deviceId} - {od.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2 flex justify-end gap-3 mt-4"><button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-[var(--border)]">取消</button><button type="submit" className="px-4 py-2 rounded-xl bg-[var(--accent)] text-black font-extrabold">儲存</button></div>
        </form>
      </div>
    </div>
  );
}

const DevicesPage = () => {
  const { devices, addDevice, updateDevice, deleteDeviceById, setSelectedDeviceId } = useStore();
  const [isAdding, setIsAdding] = useState(false); const [editing, setEditing] = useState<Device | null>(null);
  return (
    <div className="p-6">
      <div className="flex justify-between items-end mb-6">
        <div><h2 className="text-2xl font-black text-[var(--accent)]">設備資產清單</h2><p className="text-[var(--muted)] text-sm">管理所有設備資料與網路對接</p></div>
        <button onClick={() => setIsAdding(true)} className="bg-[var(--accent)] text-black px-4 py-2 rounded-xl font-extrabold flex items-center gap-2"><Plus size={18} /> 新增設備</button>
      </div>
      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-2xl overflow-hidden overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/20 text-[var(--muted)] text-xs uppercase"><tr><th className="px-6 py-4">編號 / 名稱</th><th className="px-6 py-4">分類</th><th className="px-6 py-4">連線設定數</th><th className="px-6 py-4 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-[var(--border)]">
            {devices.map(d => (
              <tr key={d.id} className="hover:bg-white/[0.02]">
                <td className="px-6 py-4 font-bold cursor-pointer hover:text-[var(--accent)]" onClick={() => setSelectedDeviceId(d.id)}>{d.deviceId} <span className="text-[var(--muted)] font-normal ml-2">{d.name}</span></td>
                <td className="px-6 py-4"><span className="text-[10px] px-2 py-1 rounded border" style={{ color: "var(--onColor)", backgroundColor: catColorVar(d.category) }}>{d.category}</span></td>
                <td className="px-6 py-4 text-[var(--muted)]">{(d.connectedTo || []).length} 條</td>
                <td className="px-6 py-4 text-right">
                  <button onClick={() => setEditing(d)} className="p-2 text-[var(--accent)]"><Edit3 size={16}/></button>
                  <button onClick={() => { if(confirm("刪除?")) deleteDeviceById(d.id); }} className="p-2 text-red-400"><Trash2 size={16}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isAdding && <DeviceModal title="新增設備" initial={{ category: "Network", deviceId: "", name: "", brand: "", model: "", ports: 8, sizeU: 1, connectedTo: [] }} onClose={() => setIsAdding(false)} onSave={(d) => { addDevice(d); setIsAdding(false); }} />}
      {editing && <DeviceModal title="編輯設備" initial={editing} onClose={() => setEditing(null)} onSave={(d) => { updateDevice(editing.id, d); setEditing(null); }} />}
    </div>
  );
};

/* -----------------------------
  Rack Planner (核心SVG與AI)
----------------------------- */
const RackPlanner = ({ mode }: { mode: PlacementMode }) => {
  const racks = useStore((s) => (mode === "before" ? s.beforeRacks : s.afterRacks));
  const devices = useStore((s) => s.devices);
  const { place, selectedDeviceId, setSelectedDeviceId } = useStore();
  const U_H = 26; 

  const [aiInsight, setAiInsight] = useState(""); const [isAiLoading, setIsAiLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [cableLines, setCableLines] = useState<Array<{x1:number, y1:number, x2:number, y2:number, label:string}>>([]);

  const fetchWithRetry = async (url: string, options: any, retries = 5, backoff = 1000): Promise<any> => {
    try { const r = await fetch(url, options); if (!r.ok) throw new Error("Err"); return await r.json(); } 
    catch (err) { if (retries > 0) { await new Promise(r => setTimeout(r, backoff)); return fetchWithRetry(url, options, retries - 1, backoff * 2); } throw err; }
  };

  const analyzeRelocation = async () => {
    setIsAiLoading(true);
    const placed = devices.filter(d => mode === "before" ? d.beforeRackId : d.afterRackId);
    const p = `針對以下機櫃給三個專業建議(散熱/佈線)：${JSON.stringify(placed.map(d=>({id: d.deviceId, U: mode==='before'?d.beforeStartU:d.afterStartU})))}。繁體中文回答。`;
    try {
      const r = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: p }] }] })
      });
      setAiInsight(r.candidates?.[0]?.content?.parts?.[0]?.text || "無");
    } catch { setAiInsight("AI連線失敗"); } finally { setIsAiLoading(false); }
  };

  const speakInstructions = async () => {
    setIsAiLoading(true);
    const p = devices.filter(d => mode === "after" ? d.afterRackId : d.beforeRackId).slice(0, 5);
    const text = `機櫃提示： ${p.map(d => `${d.name} 在 ${mode==='after'?d.afterStartU:d.beforeStartU} U`).join("。")}`;
    try {
      const response = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } }, model: "gemini-2.5-flash-preview-tts" })
      });
      const b64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (b64) {
        const bin = window.atob(b64); const len = bin.length; const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
        const w = new ArrayBuffer(44); const v = new DataView(w);
        v.setUint32(0, 0x52494646, false); v.setUint32(4, 36+len, true); v.setUint32(8, 0x57415645, false); v.setUint32(12, 0x666d7420, false); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); v.setUint32(36, 0x64617461, false); v.setUint32(40, len, true);
        setAudioUrl(URL.createObjectURL(new Blob([w, bytes], { type: 'audio/wav' })));
      }
    } catch {} finally { setIsAiLoading(false); }
  };

  useLayoutEffect(() => {
    if (!selectedDeviceId || !containerRef.current) { setCableLines([]); return; }
    const updateLines = () => {
      const activeDev = devices.find(d => d.id === selectedDeviceId);
      if (!activeDev || !activeDev.connectedTo || activeDev.connectedTo.length === 0) { setCableLines([]); return; }
      const containerRect = containerRef.current!.getBoundingClientRect();
      const startEl = document.querySelector(`[data-device-id="${selectedDeviceId}"]`);
      if (!startEl) { setCableLines([]); return; }
      const startRect = startEl.getBoundingClientRect();
      const newLines: any[] = [];
      activeDev.connectedTo.forEach(targetId => {
        const targetEl = document.querySelector(`[data-device-id="${targetId}"]`);
        if (targetEl) {
          const targetRect = targetEl.getBoundingClientRect();
          const targetDev = devices.find(d => d.id === targetId);
          newLines.push({
            x1: startRect.left + startRect.width / 2 - containerRect.left, y1: startRect.top + startRect.height / 2 - containerRect.top,
            x2: targetRect.left + targetRect.width / 2 - containerRect.left, y2: targetRect.top + targetRect.height / 2 - containerRect.top,
            label: `To: ${targetDev?.deviceId}`
          });
        }
      });
      setCableLines(newLines);
    };
    updateLines();
    window.addEventListener('resize', updateLines);
    const t = setTimeout(updateLines, 100);
    return () => { window.removeEventListener('resize', updateLines); clearTimeout(t); };
  }, [selectedDeviceId, devices, mode]);

  const listForRack = (rackId: string) => devices.filter(d => (mode === "before" ? d.beforeRackId : d.afterRackId) === rackId);
  const getBlockStyle = (d: Device) => { const sU = (mode === "before" ? d.beforeStartU : d.afterStartU) ?? 1; const eU = (mode === "before" ? d.beforeEndU : d.afterEndU) ?? sU; return { bottom: (sU - 1) * U_H, height: (eU - sU + 1) * U_H }; };

  return (
    <div className="p-6 relative" ref={containerRef}>
      {/* SVG 動畫線層 */}
      <svg className="pointer-events-none absolute inset-0 w-full h-full z-40">
        <defs><filter id="glow"><feGaussianBlur stdDeviation="2" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        {cableLines.map((line, i) => {
          const midX = (line.x1 + line.x2) / 2;
          return (
            <g key={i}>
              <path d={`M ${line.x1} ${line.y1} C ${midX} ${line.y1}, ${midX} ${line.y2}, ${line.x2} ${line.y2}`} fill="none" stroke="var(--accent)" strokeWidth="3" filter="url(#glow)" strokeDasharray="6 6" className="cable-anim" opacity="0.8" />
              <rect x={midX - 35} y={(line.y1 + line.y2)/2 - 10} width="70" height="20" fill="var(--panel)" stroke="var(--accent)" rx="4" />
              <text x={midX} y={(line.y1 + line.y2)/2 + 4} fill="var(--text)" fontSize="10" textAnchor="middle" fontWeight="bold">{line.label}</text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-4 justify-between items-end mb-6 relative z-50">
        <div><h2 className="text-3xl font-black flex items-center gap-3"><Server className="text-[var(--accent)]" /> {mode === "before" ? "搬遷前" : "搬遷後"}佈局</h2></div>
        <div className="flex gap-2">
           <button onClick={analyzeRelocation} className="flex items-center gap-2 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 px-4 py-2 rounded-xl font-bold"><Sparkles size={16} /> AI 佈局建議</button>
           <button onClick={speakInstructions} className="flex items-center gap-2 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl font-bold"><Volume2 size={16} /> 語音導覽</button>
        </div>
      </div>

      {aiInsight && (<div className="mb-6 p-5 bg-indigo-900/30 border border-indigo-500/30 rounded-2xl relative z-50"><h3 className="text-indigo-400 font-bold mb-2 flex items-center gap-2"><Sparkles size={18}/> Gemini 分析</h3><p className="text-sm leading-relaxed whitespace-pre-wrap">{aiInsight}</p></div>)}
      {audioUrl && (<div className="mb-6 p-4 bg-emerald-900/30 border border-emerald-500/30 rounded-2xl flex items-center gap-4 relative z-50"><Volume2 className="text-emerald-400" /> <audio controls src={audioUrl} autoPlay className="h-8 filter invert opacity-80" /> <button onClick={()=>setAudioUrl(null)}>關閉</button></div>)}

      <div className="flex gap-6 overflow-x-auto pb-10">
        {racks.map((rack) => (
          <div key={rack.id} className="flex-shrink-0 bg-[var(--panel)] border border-[var(--border)] rounded-t-2xl shadow-2xl">
            <div className="bg-black/40 text-center py-3 font-black text-[var(--accent)] border-b border-[var(--border)]">{rack.name}</div>
            <div className="p-4 bg-black/10">
              <div className="flex border border-slate-700 bg-black shadow-inner relative" style={{ height: 42 * U_H, width: 220 }}>
                {/* 1~42U 高亮標籤 */}
                <div className="w-10 bg-gradient-to-r from-yellow-300 to-yellow-500 flex flex-col-reverse border-r border-black shadow-[inset_-2px_0_4px_rgba(0,0,0,0.3)]">
                  {Array.from({ length: 42 }).map((_, i) => (<div key={i} className="w-full flex justify-center items-center text-black font-black text-xs border-b border-black/10" style={{ height: U_H }}>{i + 1}</div>))}
                </div>
                {/* 設備放置區 */}
                <div className="flex-1 relative">
                  <div className="absolute inset-0 flex flex-col-reverse">
                    {Array.from({ length: 42 }).map((_, i) => (<div key={i} onDragOver={(e) => e.preventDefault()} onDrop={(e) => place(mode, e.dataTransfer.getData("text/plain"), rack.id, i+1)} className="w-full border-b border-white/5 hover:bg-white/5" style={{ height: U_H }} />))}
                  </div>
                  {listForRack(rack.id).map((d) => {
                    const { bottom, height } = getBlockStyle(d); const isSelected = selectedDeviceId === d.id;
                    return (
                      <div key={d.id} data-device-id={d.id} draggable onDragStart={(ev) => ev.dataTransfer.setData("text/plain", d.id)} onClick={() => setSelectedDeviceId(d.id)}
                        className={`absolute left-1 right-1 cursor-pointer transition-all border-l-4 rounded-sm shadow-md ${isSelected ? 'ring-2 ring-[var(--accent)] z-30 scale-[1.02]' : 'border-white/20 z-10 hover:brightness-110'}`}
                        style={{ bottom, height, backgroundColor: catColorVar(d.category), borderColor: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.4)' }}
                      >
                         <div className="px-2 py-1 h-full w-full flex flex-col"><span className="text-white font-black text-xs truncate drop-shadow-md">{d.deviceId}</span></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function App() {
  const { isAuthed, theme, page, setPage } = useStore();
  useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark"); }, [theme]);
  if (!isAuthed) return <LoginPage />;
  return (
    <>
      <ThemeTokens />
      <div className="flex h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
         <aside className="w-16 md:w-64 border-r border-[var(--border)] bg-[var(--panel)] flex flex-col">
            <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-[var(--border)]"><Server className="text-[var(--accent)]" /> <span className="hidden md:inline ml-2 font-black italic">MigratePro</span></div>
            <nav className="flex-1 p-4 space-y-2">
              <button onClick={()=>setPage("dashboard")} className={`w-full flex items-center gap-3 p-3 rounded-xl ${page==='dashboard'?'bg-[var(--panel2)] text-[var(--accent)]':'hover:bg-white/5'}`}><LayoutDashboard size={20}/><span className="hidden md:inline">儀表板</span></button>
              <button onClick={()=>setPage("devices")} className={`w-full flex items-center gap-3 p-3 rounded-xl ${page==='devices'?'bg-[var(--panel2)] text-[var(--accent)]':'hover:bg-white/5'}`}><Database size={20}/><span className="hidden md:inline">設備管理</span></button>
              <button onClick={()=>setPage("before")} className={`w-full flex items-center gap-3 p-3 rounded-xl ${page==='before'?'bg-[var(--panel2)] text-[var(--accent)]':'hover:bg-white/5'}`}><ArrowLeftRight size={20}/><span className="hidden md:inline">搬遷前機櫃</span></button>
              <button onClick={()=>setPage("after")} className={`w-full flex items-center gap-3 p-3 rounded-xl ${page==='after'?'bg-[var(--panel2)] text-[var(--accent)]':'hover:bg-white/5'}`}><ArrowRightLeft size={20}/><span className="hidden md:inline">搬遷後機櫃</span></button>
            </nav>
         </aside>
         <main className="flex-1 h-full overflow-y-auto">
            {page === "dashboard" && <div className="p-6"><h2 className="text-2xl font-black text-[var(--accent)] mb-6">儀表板</h2><p>請前往左側選單進行操作。</p></div>}
            {page === "devices" && <DevicesPage/>}
            {page === "before" && <RackPlanner mode="before"/>}
            {page === "after" && <RackPlanner mode="after"/>}
         </main>
      </div>
    </>
  );
}