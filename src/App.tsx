import { FormEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ArrowDown,
  ArrowUp,
  CircleUserRound,
  Crown,
  Eye,
  Guitar,
  LogOut,
  Library,
  MessageSquareText,
  Mic2,
  MoreHorizontal,
  Music2,
  Palette,
  Plus,
  Pause,
  Play,
  Radio,
  Send,
  Settings2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  UsersRound,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "./supabase";

type Role = "voice" | "instrument";
type Member = {
  id: string;
  name: string;
  roles: Role[];
  controller: boolean;
  online: boolean;
};
type Section = { id: string; label: string; lyrics: string; chordLyrics?: string };
type Song = {
  id: string;
  title: string;
  artist: string;
  key: string;
  linesPerSection: 2 | 4;
  sections: Section[];
  timingMode?: "seconds" | "bpm";
  secondsPerSection?: number;
  bpm?: number;
  barsPerSection?: number;
  hasChords?: boolean;
  transpose?: number;
};
type CommandTag = { id: string; label: string; color: string };
type Cue = {
  label: string;
  content: string;
  sender: string;
  type: "section" | "message";
  timestamp: number;
  audience: "all" | Role;
  chordContent?: string;
};
type Session = {
  roomName: string;
  code: string;
  song: Song | null;
  songs: Song[];
  cue: Cue;
  members: Member[];
  customCues: string[];
  commandTags: CommandTag[];
};
type Profile = {
  id: string;
  full_name: string;
  roles: Role[];
  is_admin: boolean;
  email?: string;
};

const STANDARD_CUES = ["Início", "Refrão", "Pré-refrão", "Ponte", "Espontâneo", "Final"];
const DEFAULT_COMMAND_TAGS: CommandTag[] = [
  { id: "inicio", label: "Início", color: "#79C7FF" },
  { id: "refrao", label: "Refrão", color: "#C7F36A" },
  { id: "ponte", label: "Ponte", color: "#FFB86B" },
  { id: "final", label: "Final", color: "#D9A7FF" },
];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function stripChords(value: string) {
  return value.replace(/\[[^\]]+\]/g, "").trim();
}

function normalizePastedChart(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\t/g, "    ");
}

function transposeChord(chord: string, semitones: number) {
  return chord.replace(/(^|\/)([A-G])([#b]?)/g, (_match, prefix: string, root: string, accidental: string) => {
    const normalized = `${root}${accidental}`;
    const flats: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };
    const index = NOTE_NAMES.indexOf(flats[normalized] ?? normalized);
    if (index < 0) return `${prefix}${normalized}`;
    return `${prefix}${NOTE_NAMES[(index + semitones + 120) % 12]}`;
  });
}

function transposeChordPro(value: string, semitones: number) {
  return value.replace(/\[([^\]]+)\]/g, (_match, chord: string) => `[${transposeChord(chord, semitones)}]`);
}

function transposeKey(key: string, semitones: number) {
  const match = key.match(/^([A-G])([#b]?)/);
  if (!match) return key;
  return transposeChord(`${match[1]}${match[2]}`, semitones);
}

const SECTION_NAMES: Record<string, string> = {
  "inicio": "Início",
  "intro": "Início",
  "introducao": "Início",
  "introdução": "Início",
  "refrao": "Refrão",
  "refrão": "Refrão",
  "ponte": "Ponte",
  "final": "Final",
  "pre-refrao": "Pré-refrão",
  "pré-refrão": "Pré-refrão",
  "espontaneo": "Espontâneo",
  "espontâneo": "Espontâneo",
};

function normalizeChartMarker(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function sectionFromMarker(value: string) {
  const normalized = normalizeChartMarker(value);
  return SECTION_NAMES[normalized] ?? SECTION_NAMES[value.trim().toLowerCase()] ?? "";
}

function isDiscardedChartMarker(value: string) {
  const normalized = normalizeChartMarker(value)
    .replace(/^\[|\]$/g, "")
    .replace(/^[-–—]\s*|\s*[-–—]$/g, "")
    .trim();
  return /^(?:primeira|segunda|terceira|quarta|quinta|\d+[ªa]?)\s+parte(?:\s+de\s+\d+)?$/.test(normalized)
    || /^parte\s+\d+\s+de\s+\d+$/.test(normalized)
    || /^(?:tab|tablatura)(?:\s*[-–—:]\s*.*)?$/.test(normalized)
    || /^(?:repete|repetir|bis)(?:\s+\d+x)?$/.test(normalized);
}

function chordTokenIsValid(token: string) {
  return /^[A-G](?:#|b)?[A-Za-z0-9°º()+-]*(?:\/[A-G](?:#|b)?)?$/.test(token);
}

function isTraditionalChordLine(line: string) {
  const clean = line.trim().replace(/^\(|\)$/g, "").trim();
  if (!clean) return false;
  const tokens = clean.split(/\s+/);
  return tokens.length > 0 && tokens.every(chordTokenIsValid);
}

function chordLineToChordPro(chordLine: string, lyricLine: string) {
  const chordMatches = [...chordLine.matchAll(/[A-G](?:#|b)?[A-Za-z0-9°º()+-]*(?:\/[A-G](?:#|b)?)?/g)];
  const atPosition = new Map<number, string[]>();
  chordMatches.forEach((match) => {
    const position = Math.min(match.index ?? 0, lyricLine.length);
    atPosition.set(position, [...(atPosition.get(position) ?? []), match[0]]);
  });
  let output = "";
  for (let index = 0; index <= lyricLine.length; index++) {
    const chords = atPosition.get(index);
    if (chords) output += chords.map((chord) => `[${chord}]`).join("");
    if (index < lyricLine.length) output += lyricLine[index];
  }
  return output;
}

type ParsedChartLine = { lyric: string; chordPro: string; label: string; countsAsLyric: boolean };

function parseChordChart(value: string): ParsedChartLine[] {
  const rawLines = normalizePastedChart(value).split("\n");
  const parsed: ParsedChartLine[] = [];
  let currentLabel = "";
  let pendingChordLine = "";

  for (const originalLine of rawLines) {
    let rawLine = originalLine;
    let trimmed = rawLine.trim();
    const markerWithContent = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (markerWithContent) {
      const detectedSection = sectionFromMarker(markerWithContent[1]);
      if (detectedSection) {
        currentLabel = detectedSection;
        pendingChordLine = "";
        rawLine = markerWithContent[2];
        trimmed = rawLine.trim();
        if (!trimmed) continue;
        if (isTraditionalChordLine(rawLine)) {
          const chordPro = [...trimmed.matchAll(/[A-G](?:#|b)?[A-Za-z0-9Â°Âº()+-]*(?:\/[A-G](?:#|b)?)?/g)]
            .map((match) => `[${match[0]}] `).join("");
          parsed.push({ lyric: "", chordPro, label: currentLabel, countsAsLyric: false });
          continue;
        }
      }
    }
    const heading = trimmed.match(/^\[([^\]]+)\]$/);
    const bracketContent = heading?.[1].trim() ?? "";
    const detectedBracketSection = bracketContent ? sectionFromMarker(bracketContent) : "";
    if (detectedBracketSection) {
      currentLabel = detectedBracketSection;
      pendingChordLine = "";
      continue;
    }
    if (heading && !chordTokenIsValid(bracketContent)) {
      pendingChordLine = "";
      continue;
    }
    const detectedPlainSection = sectionFromMarker(trimmed);
    if (detectedPlainSection) {
      currentLabel = detectedPlainSection;
      pendingChordLine = "";
      continue;
    }
    if (isDiscardedChartMarker(trimmed)) {
      pendingChordLine = "";
      continue;
    }
    if (!trimmed) continue;
    if (isTraditionalChordLine(rawLine)) {
      if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
        const chordPro = [...trimmed.matchAll(/[A-G](?:#|b)?[A-Za-z0-9°º()+-]*(?:\/[A-G](?:#|b)?)?/g)].map((match) => `[${match[0]}] `).join("");
        parsed.push({ lyric: "", chordPro, label: currentLabel, countsAsLyric: false });
      } else {
        pendingChordLine = rawLine;
      }
      continue;
    }
    const chordPro = pendingChordLine
      ? chordLineToChordPro(pendingChordLine, rawLine)
      : rawLine;
    parsed.push({
      lyric: stripChords(rawLine),
      chordPro,
      label: currentLabel,
      countsAsLyric: true,
    });
    pendingChordLine = "";
  }
  return parsed;
}

const defaultSession: Session = {
  roomName: "",
  code: "MWO26",
  song: null,
  songs: [],
  cue: {
    label: "Aguardando",
    content: "A direção aparecerá aqui",
    sender: "Equipe",
    type: "message",
    timestamp: Date.now(),
    audience: "all",
  },
  members: [],
  customCues: STANDARD_CUES,
  commandTags: DEFAULT_COMMAND_TAGS,
};

const STORAGE_KEY = "mwo-live-session";

function normalizeSession(parsed: Partial<Session> | null): Session {
    if (!parsed) return defaultSession;
    const wasDemo = parsed.roomName === "Culto de Domingo";
    return {
      ...defaultSession,
      ...parsed,
      roomName: wasDemo ? "" : (parsed.roomName ?? ""),
      song: wasDemo ? null : (parsed.song ?? null),
      songs: wasDemo ? [] : (parsed.songs ?? (parsed.song ? [parsed.song] : [])),
      members: wasDemo ? [] : (parsed.members ?? []),
      customCues: parsed.customCues?.length ? parsed.customCues : STANDARD_CUES,
      commandTags: parsed.commandTags?.length ? parsed.commandTags : DEFAULT_COMMAND_TAGS,
      cue: wasDemo ? defaultSession.cue : { ...defaultSession.cue, ...(parsed.cue ?? {}) },
    };
}

function storageKey(code: string) {
  return `${STORAGE_KEY}:${code.toUpperCase()}`;
}

function loadSession(code = defaultSession.code): Session {
  try {
    const value = localStorage.getItem(storageKey(code)) ?? localStorage.getItem(STORAGE_KEY);
    return { ...normalizeSession(value ? JSON.parse(value) as Partial<Session> : null), code: code.toUpperCase() };
  } catch {
    return defaultSession;
  }
}

function RoleIcon({ role, size = 15 }: { role: Role; size?: number }) {
  return role === "voice" ? <Mic2 size={size} /> : <Guitar size={size} />;
}

function ChordLyrics({ value }: { value: string }) {
  return <div className="chord-lyrics">{value.split("\n").map((line, lineIndex) => {
    const trimmed = line.trim();
    const rawMarker = trimmed.match(/^\[([^\]]+)\]$/)?.[1] ?? trimmed;
    if (sectionFromMarker(rawMarker) || isDiscardedChartMarker(rawMarker)) return null;

    const bracketChords = [...line.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
    const textWithoutBracketChords = line.replace(/\[[^\]]+\]/g, "").replace(/[()\s]/g, "");
    if (bracketChords.length && !textWithoutBracketChords && bracketChords.every(chordTokenIsValid)) {
      return <div className="instrumental-chords" key={lineIndex}>{bracketChords.map((chord, index) => <b key={`${chord}-${index}`}>{chord}</b>)}</div>;
    }

    if (isTraditionalChordLine(line) && trimmed.startsWith("(") && trimmed.endsWith(")")) {
      const chords = trimmed.replace(/^\(|\)$/g, "").trim().split(/\s+/).filter(chordTokenIsValid);
      return <div className="instrumental-chords" key={lineIndex}>{chords.map((chord, index) => <b key={`${chord}-${index}`}>{chord}</b>)}</div>;
    }

    const parts = line.split(/(\[[^\]]+\])/g).filter(Boolean);
    let pendingChord = "";
    const tokens: Array<{ chord: string; text: string }> = [];
    parts.forEach((part) => {
      if (part.startsWith("[") && part.endsWith("]")) pendingChord = part.slice(1, -1);
      else {
        tokens.push({ chord: pendingChord, text: part });
        pendingChord = "";
      }
    });
    if (pendingChord) tokens.push({ chord: pendingChord, text: " " });
    return <div className="chord-line" key={lineIndex}>{tokens.map((token, index) => <span key={index}><b>{token.chord}</b><i>{token.text}</i></span>)}</div>;
  })}</div>;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }

    const loadProfile = async (authUser: User | null) => {
      setUser(authUser);
      if (!authUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const { data } = await client
        .from("profiles")
        .select("id, full_name, roles, is_admin")
        .eq("id", authUser.id)
        .single();

      setProfile(data ? { ...(data as Profile), email: authUser.email } : null);
      setLoading(false);
    };

    void client.auth.getUser().then(({ data }) => loadProfile(data.user));
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) {
    return <main className="auth-page"><div className="auth-loading"><Brand /><span /></div></main>;
  }

  if (!supabase) {
    return <main className="auth-page"><div className="auth-card"><Brand /><h1>Configuração necessária</h1><p>Adicione as variáveis do Supabase ao arquivo <code>.env.local</code>.</p></div></main>;
  }

  if (!user || !profile) {
    return <AuthScreen />;
  }

  return <RoomGateway profile={profile} onSignOut={() => void supabase!.auth.signOut()} />;
}

function RoomGateway({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<"dashboard" | "account" | "join" | "create">("dashboard");
  const [code, setCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<Session[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  const refreshRooms = async () => {
    if (!supabase) return;
    setLoadingRooms(true);
    const { data } = await supabase.from("live_rooms").select("state").order("updated_at", { ascending: false });
    const memberRooms = (data ?? [])
      .map((row) => normalizeSession(row.state as Partial<Session>))
      .filter((room) => room.members.some((member) => member.id === profile.id));
    setRooms(memberRooms);
    setLoadingRooms(false);
  };

  useEffect(() => {
    void refreshRooms();
  }, [profile.id]);

  if (roomCode) {
    return <LiveApp profile={profile} roomCode={roomCode} onLeaveRoom={() => { localStorage.removeItem("mwo-active-room"); setRoomCode(""); void refreshRooms(); }} onSignOut={onSignOut} />;
  }

  const joinRoom = async () => {
    if (!supabase || !code.trim()) return;
    setBusy(true); setError("");
    const normalizedCode = code.trim().toUpperCase();
    const { data, error: lookupError } = await supabase.from("live_rooms").select("code").eq("code", normalizedCode).maybeSingle();
    if (lookupError || !data) {
      setError("Sala não encontrada. Confira o código e tente novamente.");
    } else {
      const { error: joinError } = await supabase.rpc("join_room", { room_code: normalizedCode });
      if (joinError) setError("Não foi possível entrar na sala. Execute o SQL atualizado no Supabase.");
      else {
        localStorage.setItem("mwo-active-room", normalizedCode);
        setRoomCode(normalizedCode);
      }
    }
    setBusy(false);
  };

  const createRoom = async () => {
    if (!supabase || !roomName.trim()) return;
    setBusy(true); setError("");
    const generatedCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const member: Member = { id: profile.id, name: profile.full_name, roles: profile.roles, controller: true, online: true };
    const state: Session = { ...defaultSession, roomName: roomName.trim(), code: generatedCode, members: [member], cue: { ...defaultSession.cue, timestamp: Date.now() } };
    const { error: createError } = await supabase.from("live_rooms").insert({ code: generatedCode, state });
    if (createError) setError("Não foi possível criar a sala. Confira se sua conta é administradora.");
    else {
      localStorage.setItem("mwo-active-room", generatedCode);
      setRoomCode(generatedCode);
    }
    setBusy(false);
  };

  const deleteRoom = async (room: Session) => {
    if (!supabase || !window.confirm(`Excluir permanentemente a sala "${room.roomName}"? Todas as músicas e configurações dela serão apagadas.`)) return;
    const { error: deleteError } = await supabase.from("live_rooms").delete().eq("code", room.code);
    if (deleteError) setError("Não foi possível excluir a sala. Execute o SQL atualizado no Supabase.");
    else await refreshRooms();
  };

  if (mode === "account") {
    return (
      <main className="account-page">
        <header><Brand /><button onClick={() => setMode("dashboard")}><ArrowLeft /> Minhas salas</button></header>
        <section className="account-page-card">
          <div className="account-page-avatar">{profile.full_name.slice(0,1)}</div>
          <small>MINHA CONTA</small>
          <h1>{profile.full_name}</h1>
          <span>{profile.is_admin ? "Administrador" : "Integrante"}</span>
          <div className="account-details"><label>E-mail<b>{profile.email ?? "—"}</b></label><label>Funções<div>{profile.roles.map((role) => <b key={role}><RoleIcon role={role} /> {role === "voice" ? "Vocal" : "Instrumental"}</b>)}</div></label></div>
          <button className="account-signout" onClick={onSignOut}><LogOut /> Sair da conta</button>
        </section>
      </main>
    );
  }

  if (mode !== "dashboard") {
    return (
      <main className="room-gateway">
        <header><Brand /><button onClick={onSignOut}><LogOut /> Sair</button></header>
        <section>
          <button className="gateway-back" onClick={() => { setMode("dashboard"); setError(""); }}><ArrowLeft /> Voltar ao dashboard</button>
          <span className="room-gateway-icon"><Radio /></span>
          <h1>{mode === "create" ? "Criar uma sala" : "Entrar com código"}</h1>
          <p>{mode === "create" ? "Você receberá um código para compartilhar com a equipe." : "Digite o código enviado pelo administrador."}</p>
          {mode === "create"
            ? <div className="input-wrap"><Music2 /><input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Nome da sala" autoFocus onKeyDown={(e) => e.key === "Enter" && createRoom()} /></div>
            : <div className="input-wrap room-code-input"><span>#</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CÓDIGO" maxLength={8} autoFocus onKeyDown={(e) => e.key === "Enter" && joinRoom()} /></div>}
          {error && <div className="auth-message error">{error}</div>}
          <button className="primary full" disabled={busy || (mode === "create" ? !roomName.trim() : !code.trim())} onClick={mode === "create" ? createRoom : joinRoom}>{busy ? "Aguarde..." : mode === "create" ? "Criar sala" : "Entrar na sala"} <ChevronRight /></button>
        </section>
      </main>
    );
  }

  return (
    <main className="member-dashboard">
      <header><Brand /><button className="dashboard-account-button" onClick={() => setMode("account")}><span>{profile.full_name.slice(0,1)}</span><div><b>{profile.full_name}</b><small>Minha conta</small></div><ChevronRight /></button></header>
      <div className="dashboard-shell">
        <section className="dashboard-greeting"><div><small>MINHAS SALAS</small><h1>Olá, {profile.full_name.split(" ")[0]}</h1><p>{profile.is_admin ? "Gerencie suas salas e momentos de adoração." : "Escolha uma sala ou entre usando um código."}</p></div><div className="dashboard-actions">{!profile.is_admin && <button onClick={() => setMode("join")}><Plus /> Entrar com código</button>}{profile.is_admin && <button className="primary" onClick={() => setMode("create")}><Radio /> Criar sala</button>}</div></section>
        {error && <div className="auth-message error dashboard-error">{error}</div>}
        <div className="dashboard-grid rooms-only">
          <section className="rooms-panel">
            <div className="panel-title"><div><Radio /><span><b>Minhas salas</b><small>Salas disponíveis para você</small></span></div><span>{rooms.length}</span></div>
            {loadingRooms ? <div className="rooms-loading"><i /> Buscando salas...</div> : rooms.length === 0 ? <div className="rooms-empty"><Radio /><b>Nenhuma sala disponível</b><p>Entre usando o código enviado pelo administrador.</p><button onClick={() => setMode("join")}>Digitar código</button></div> : <div className="room-list">
              {rooms.map((room) => {
                const membership = room.members.find((member) => member.id === profile.id);
                return <div className="room-row" key={room.code}><button onClick={() => setRoomCode(room.code)}><span className="room-list-icon"><Music2 /></span><div><b>{room.roomName}</b><small><i /> {room.members.filter((member) => member.online).length} integrantes · Código {room.code}</small></div><span className={membership?.controller ? "room-role control" : "room-role"}>{membership?.controller ? "Controle ao vivo" : "Visualizador"}</span><ChevronRight /></button>{profile.is_admin && <button className="room-delete" onClick={() => deleteRoom(room)} title="Excluir sala"><Trash2 /></button>}</div>;
              })}
            </div>}
          </section>
        </div>
      </div>
    </main>
  );
}

function LiveApp({ profile, roomCode, onLeaveRoom, onSignOut }: { profile: Profile; roomCode: string; onLeaveRoom: () => void; onSignOut: () => void }) {
  const [screen, setScreen] = useState<"welcome" | "join" | "live" | "admin">(
    () => profile.is_admin ? "admin" : "live",
  );
  const [session, setSession] = useState<Session>(() => loadSession(roomCode));
  const [currentUser, setCurrentUser] = useState<Member>({
    id: profile.id,
    name: profile.full_name,
    roles: profile.roles,
    controller: profile.is_admin,
    online: true,
  });
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const syncedMember = session.members.find((member) => member.id === profile.id);
    if (syncedMember) setCurrentUser(syncedMember);
  }, [session.members, profile.id]);

  useEffect(() => {
    if (screen === "admin" && !profile.is_admin && !currentUser.controller) setScreen("live");
  }, [screen, profile.is_admin, currentUser.controller]);

  useEffect(() => {
    if (!profile.is_admin && session.roomName && !session.members.some((member) => member.id === profile.id)) onLeaveRoom();
  }, [session.members, session.roomName, profile.id, profile.is_admin, onLeaveRoom]);

  useEffect(() => {
    channel.current = new BroadcastChannel("mwo-live");
    channel.current.onmessage = (event) => setSession(event.data);
    return () => channel.current?.close();
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    let active = true;

    const connectRoom = async () => {
      const { data, error } = await client
        .from("live_rooms")
        .select("state")
        .eq("code", roomCode)
        .maybeSingle();

      if (!active) return;

      if (error) {
        console.warn("Supabase ainda não está configurado:", error.message);
        return;
      }

      if (data?.state) {
        const remoteSession = normalizeSession(data.state as Partial<Session>);
        setSession(remoteSession);
        localStorage.setItem(storageKey(roomCode), JSON.stringify(remoteSession));
      } else {
        const localSession = loadSession(roomCode);
        const { error: insertError } = await client
          .from("live_rooms")
          .insert({ code: localSession.code, state: localSession });
        if (insertError) console.warn("Não foi possível criar a sala:", insertError.message);
      }
    };

    void connectRoom();

    const realtime = client
      .channel(`room:${roomCode}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_rooms",
          filter: `code=eq.${roomCode}`,
        },
        (payload) => {
          const row = payload.new as { state?: Session };
          if (!row.state) return;
          const remoteSession = normalizeSession(row.state);
          setSession(remoteSession);
          localStorage.setItem(storageKey(roomCode), JSON.stringify(remoteSession));
        },
      )
      .subscribe();

    return () => {
      active = false;
      void client.removeChannel(realtime);
    };
  }, [roomCode]);

  const updateSession = (next: Session) => {
    setSession(next);
    localStorage.setItem(storageKey(roomCode), JSON.stringify(next));
    channel.current?.postMessage(next);
    const client = supabase;
    if (client) {
      void client
        .from("live_rooms")
        .upsert({
          code: next.code,
          state: next,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) console.warn("Falha ao sincronizar a sala:", error.message);
        });
    }
  };

  const join = (name: string, roles: Role[]) => {
    const member: Member = {
      id: crypto.randomUUID(),
      name,
      roles,
      controller: false,
      online: true,
    };
    setCurrentUser(member);
    updateSession({ ...session, members: [...session.members, member] });
    setScreen("live");
  };

  const enterRoom = () => {
    const existing = session.members.find((member) => member.id === profile.id);
    const member: Member = existing ?? {
      id: profile.id,
      name: profile.full_name,
      roles: profile.roles,
      controller: profile.is_admin,
      online: true,
    };
    setCurrentUser(member);
    if (!existing) updateSession({ ...session, members: [...session.members, member] });
    setScreen("live");
  };

  if (screen === "welcome") {
    return <Welcome user={currentUser} isOwner={profile.is_admin} onJoin={enterRoom} onAdmin={() => setScreen("admin")} onLeave={onLeaveRoom} onLogout={onSignOut} />;
  }
  if (screen === "join") {
    return <Join session={session} onBack={() => setScreen("welcome")} onJoin={join} />;
  }
  if (screen === "admin") {
    return (
      <Admin
        session={session}
        user={currentUser ?? session.members[0]}
        isOwner={profile.is_admin}
        updateSession={updateSession}
        onView={() => setScreen("live")}
        onExit={onLeaveRoom}
      />
    );
  }
  return (
    <Live
      session={session}
      user={currentUser}
      onControl={() => setScreen("admin")}
      onExit={onLeaveRoom}
    />
  );
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark"><Sparkles size={16} strokeWidth={2.5} /></span>
      <span>ESPONTÂNEO</span>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const toggleRole = (role: Role) => setRoles((old) => old.includes(role) ? old.filter((item) => item !== role) : [...old, role]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setNotice("");

    if (mode === "login") {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) setError(loginError.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : loginError.message);
    } else {
      const { data, error: registerError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name.trim(), roles } },
      });
      if (registerError) {
        setError(registerError.message);
      } else if (!data.session) {
        setNotice("Cadastro criado! Confira seu e-mail para confirmar a conta.");
      }
    }
    setBusy(false);
  };

  return (
    <main className="auth-page">
      <div className="ambient ambient-one" />
      <section className="auth-card">
        <Brand />
        <div className="auth-intro">
          <span className="auth-icon">{mode === "login" ? <Radio /> : <UsersRound />}</span>
          <h1>{mode === "login" ? "Bem-vindo de volta" : "Crie sua conta"}</h1>
          <p>{mode === "login" ? "Entre para acompanhar a direção da equipe." : "Cadastre-se para entrar nos momentos de adoração."}</p>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              <label className="field-label">Seu nome</label>
              <div className="input-wrap"><CircleUserRound size={19} /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como podemos te chamar?" required /></div>
            </>
          )}
          <label className="field-label">E-mail</label>
          <div className="input-wrap"><span className="input-symbol">@</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" required /></div>
          <label className="field-label">Senha</label>
          <div className="input-wrap"><ShieldCheck size={19} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" minLength={6} required /></div>
          {mode === "register" && (
            <>
              <label className="field-label">Sua função</label>
              <div className="auth-roles">
                <button type="button" className={roles.includes("voice") ? "selected" : ""} onClick={() => toggleRole("voice")}><Mic2 /> Voz {roles.includes("voice") && <Check />}</button>
                <button type="button" className={roles.includes("instrument") ? "selected" : ""} onClick={() => toggleRole("instrument")}><Guitar /> Instrumento {roles.includes("instrument") && <Check />}</button>
              </div>
            </>
          )}
          {error && <div className="auth-message error">{error}</div>}
          {notice && <div className="auth-message success">{notice}</div>}
          <button className="primary full auth-submit" disabled={busy || (mode === "register" && roles.length === 0)}>
            {busy ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar minha conta"} <ChevronRight size={18} />
          </button>
        </form>
        <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setNotice(""); }}>
          {mode === "login" ? "Ainda não tem conta? " : "Já possui uma conta? "}<b>{mode === "login" ? "Cadastre-se" : "Entrar"}</b>
        </button>
      </section>
    </main>
  );
}

function Welcome({ user, isOwner, onJoin, onAdmin, onLeave, onLogout }: { user: Member; isOwner: boolean; onJoin: () => void; onAdmin: () => void; onLeave: () => void; onLogout: () => void }) {
  return (
    <main className="welcome-page">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="welcome-header"><Brand /><div className="welcome-user"><span>Olá, {user.name}</span><button onClick={onLeave}><ArrowLeft size={16} /> Trocar sala</button><button onClick={onLogout}><LogOut size={16} /> Sair</button></div></header>
      <section className="hero">
        <div className="eyebrow"><Radio size={15} /> DIREÇÃO EM TEMPO REAL</div>
        <h1>Todos juntos.<br /><em>No mesmo mover.</em></h1>
        <p>Direção simples e instantânea para a equipe durante cada momento de adoração.</p>
        <div className="welcome-actions">
          <button className="primary giant" onClick={onJoin}>Entrar em uma sala <ChevronRight size={20} /></button>
          {user.controller && <button className="text-button" onClick={onAdmin}><Crown size={17} /> {isOwner ? "Acessar como administrador" : "Abrir controle ao vivo"}</button>}
        </div>
      </section>
      <footer className="welcome-footer"><p>Sua equipe começa com tudo limpo.<br />Crie a sala e adicione apenas o que vai usar.</p></footer>
    </main>
  );
}

function Join({ session, onBack, onJoin }: { session: Session; onBack: () => void; onJoin: (name: string, roles: Role[]) => void }) {
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const toggleRole = (role: Role) => setRoles((old) => old.includes(role) ? old.filter((item) => item !== role) : [...old, role]);
  return (
    <main className="join-page page-shell">
      <header className="simple-header"><button className="icon-button" onClick={onBack}><ArrowLeft /></button><Brand /><span /></header>
      <section className="join-card">
        <div className="room-badge"><span className="live-dot" /> SALA AO VIVO</div>
        <h1>{session.roomName}</h1>
        <p>Entre na sala para acompanhar as direções da equipe.</p>
        <label className="field-label">Como podemos te chamar?</label>
        <div className="input-wrap"><CircleUserRound size={20} /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" autoFocus /></div>
        <label className="field-label">Qual é a sua função?</label>
        <p className="field-hint">Você pode selecionar as duas opções.</p>
        <div className="role-grid">
          <button className={roles.includes("voice") ? "role-card selected" : "role-card"} onClick={() => toggleRole("voice")}>
            <span><Mic2 /></span><b>Voz</b><small>Eu canto</small>{roles.includes("voice") && <i><Check size={13} /></i>}
          </button>
          <button className={roles.includes("instrument") ? "role-card selected" : "role-card"} onClick={() => toggleRole("instrument")}>
            <span><Guitar /></span><b>Instrumento</b><small>Eu toco</small>{roles.includes("instrument") && <i><Check size={13} /></i>}
          </button>
        </div>
        <button className="primary full" disabled={!name.trim() || roles.length === 0} onClick={() => onJoin(name.trim(), roles)}>
          Entrar na sala <ChevronRight size={19} />
        </button>
        <p className="privacy"><ShieldCheck size={14} /> Nenhuma conta ou senha necessária</p>
      </section>
    </main>
  );
}

function Live({ session, user, onControl, onExit }: { session: Session; user: Member | null; onControl: () => void; onExit: () => void }) {
  const canControl = user?.controller;
  const canSeeCue = session.cue.audience === "all" || Boolean(user?.roles.includes(session.cue.audience));
  const cue: Cue = canSeeCue ? session.cue : {
    label: "Aguardando",
    content: "",
    sender: "Equipe",
    type: "message",
    timestamp: session.cue.timestamp,
    audience: "all",
  };
  return (
    <main className="live-page">
      <header className="live-header">
        <div><span className="live-dot" /><b> AO VIVO</b><small>{session.roomName}</small></div>
        <div className="header-actions">
          {canControl && <button className="control-link" onClick={onControl}><Settings2 size={15} /> Controlar</button>}
          <button className="icon-button dark" onClick={onExit}><LogOut size={18} /></button>
        </div>
      </header>
      <section className="cue-panel">
        <div className="cue-sender"><span>{cue.sender.slice(0, 1)}</span><b>{cue.sender}</b> pediu para</div>
        <div className="cue-title" key={cue.timestamp}>{cue.label}</div>
        <div className="sound-waves">{[1,2,3,4,5].map((x) => <i key={x} />)}</div>
      </section>
      <section className="lyrics-panel">
        <div className="song-meta">
          <div><Music2 size={15} /><span>AGORA</span></div>
          <p>{session.song ? session.song.title : "Nenhuma música selecionada"} {session.song && <b>• {session.song.key}</b>}</p>
        </div>
        <div className={cue.type === "message" ? "lyrics message" : "lyrics"} key={`lyrics-${cue.timestamp}`}>
          {cue.chordContent && user?.roles.includes("instrument")
            ? <ChordLyrics value={cue.chordContent} />
            : cue.content
              ? cue.content.split("\n").map((line, index) => <span key={index}>{line}</span>)
              : <span className="no-lyrics">{canSeeCue ? "Somente direção" : "Direção enviada para outro grupo"}</span>}
        </div>
        <div className="connected-note"><UsersRound size={14} /> {session.members.filter((m) => m.online).length} pessoas acompanhando</div>
      </section>
    </main>
  );
}

function Admin({
  session,
  user,
  isOwner,
  updateSession,
  onView,
  onExit,
}: {
  session: Session;
  user: Member;
  isOwner: boolean;
  updateSession: (session: Session) => void;
  onView: () => void;
  onExit: () => void;
}) {
  const [tab, setTab] = useState<"live" | "setup" | "people">("live");
  const [message, setMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newCue, setNewCue] = useState("");
  const [roomDraft, setRoomDraft] = useState("");
  const [showSong, setShowSong] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [songMode, setSongMode] = useState<"manual" | "search">("manual");
  const [songTitle, setSongTitle] = useState("");
  const [songArtist, setSongArtist] = useState("");
  const [songKey, setSongKey] = useState("");
  const [songLyrics, setSongLyrics] = useState("");
  const [chordMode, setChordMode] = useState(false);
  const [linesPerSection, setLinesPerSection] = useState<2 | 4>(2);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ id: number; trackName: string; artistName: string; albumName: string; plainLyrics: string | null }>>([]);
  const [preparedSections, setPreparedSections] = useState<Section[]>([]);
  const [songError, setSongError] = useState("");
  const [showCommandSettings, setShowCommandSettings] = useState(false);
  const [setupSongId, setSetupSongId] = useState(() => session.song?.id ?? session.songs[0]?.id ?? "");
  const [timingMode, setTimingMode] = useState<"seconds" | "bpm">("seconds");
  const [secondsPerSection, setSecondsPerSection] = useState(10);
  const [bpm, setBpm] = useState(120);
  const [barsPerSection, setBarsPerSection] = useState(8);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [audience, setAudience] = useState<"all" | Role>("all");

  useEffect(() => {
    if (!isOwner && tab !== "live") setTab("live");
  }, [isOwner, tab]);

  const sendSection = (section: Section) => updateSession({
    ...session,
    cue: {
      label: section.label || "Trecho",
      content: section.lyrics,
      chordContent: section.chordLyrics && session.song ? transposeChordPro(section.chordLyrics, session.song.transpose ?? 0) : undefined,
      sender: user.name,
      type: "section",
      timestamp: Date.now(),
      audience,
    },
  });
  const goToSection = (index: number) => {
    if (!session.song?.sections.length) return;
    const normalizedIndex = Math.max(0, Math.min(index, session.song.sections.length - 1));
    setCurrentSectionIndex(normalizedIndex);
    sendSection(session.song.sections[normalizedIndex]);
  };
  const nextSection = () => goToSection(currentSectionIndex + 1);
  const previousSection = () => goToSection(currentSectionIndex - 1);

  useEffect(() => {
    if (!autoPlaying || !session.song?.sections.length) return;
    const intervalSeconds = timingMode === "seconds"
      ? Math.max(1, secondsPerSection)
      : Math.max(1, (60 / Math.max(1, bpm)) * 4 * Math.max(1, barsPerSection));
    const timer = window.setInterval(() => {
      setCurrentSectionIndex((current) => {
        const next = current + 1;
        if (next >= session.song!.sections.length) {
          setAutoPlaying(false);
          return current;
        }
        sendSection(session.song!.sections[next]);
        return next;
      });
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoPlaying, timingMode, secondsPerSection, bpm, barsPerSection, session.song]);

  useEffect(() => {
    setCurrentSectionIndex(0);
    setAutoPlaying(false);
    if (session.song) {
      setTimingMode(session.song.timingMode ?? "seconds");
      setSecondsPerSection(session.song.secondsPerSection ?? 10);
      setBpm(session.song.bpm ?? 120);
      setBarsPerSection(session.song.barsPerSection ?? 8);
    }
  }, [session.song?.id]);
  const sendCommand = (label: string) => {
    const matchingSection = session.song?.sections.find((section) => section.label === label);
    if (matchingSection && session.song) setCurrentSectionIndex(session.song.sections.indexOf(matchingSection));
    updateSession({
      ...session,
      cue: {
        label,
        content: matchingSection?.lyrics ?? "",
        chordContent: matchingSection?.chordLyrics && session.song ? transposeChordPro(matchingSection.chordLyrics, session.song.transpose ?? 0) : undefined,
        sender: user.name,
        type: "section",
        timestamp: Date.now(),
        audience,
      },
    });
  };
  const sendMessage = () => {
    if (!message.trim()) return;
    updateSession({ ...session, cue: { label: "Atenção", content: message.trim(), sender: user.name, type: "message", timestamp: Date.now(), audience } });
    setMessage("");
  };
  const changeSong = (songId: string) => {
    const song = session.songs.find((item) => item.id === songId) ?? null;
    updateSession({ ...session, song });
  };
  const changeTranspose = (delta: number) => {
    if (!session.song?.hasChords) return;
    const updatedSong = { ...session.song, transpose: (session.song.transpose ?? 0) + delta };
    updateSession({ ...session, song: updatedSong, songs: session.songs.map((song) => song.id === updatedSong.id ? updatedSong : song) });
  };
  const openNewSong = () => {
    setEditingSongId(null);
    setSongTitle(""); setSongArtist(""); setSongKey(""); setSongLyrics("");
    setPreparedSections([]); setSongError(""); setSearchResults([]);
    setLinesPerSection(2); setTimingMode("seconds"); setSecondsPerSection(10); setBpm(120); setBarsPerSection(8);
    setChordMode(false);
    setShowSong(true);
  };
  const editSong = (song: Song) => {
    setEditingSongId(song.id);
    setSongTitle(song.title);
    setSongArtist(song.artist);
    setSongKey(song.key === "—" ? "" : song.key);
    setSongLyrics(song.sections.flatMap((section) => (song.hasChords ? section.chordLyrics : section.lyrics)?.split("\n") ?? []).join("\n"));
    setPreparedSections(song.sections.map((section) => ({ ...section })));
    setLinesPerSection(song.linesPerSection);
    setTimingMode(song.timingMode ?? "seconds");
    setSecondsPerSection(song.secondsPerSection ?? 10);
    setBpm(song.bpm ?? 120);
    setBarsPerSection(song.barsPerSection ?? 8);
    setChordMode(Boolean(song.hasChords));
    setSongError("");
    setShowLibrary(false);
    setShowSong(true);
  };
  const deleteSong = (song: Song) => {
    if (!window.confirm(`Excluir "${song.title}" e toda a sua programação?`)) return;
    const remaining = session.songs.filter((item) => item.id !== song.id);
    updateSession({ ...session, songs: remaining, song: session.song?.id === song.id ? null : session.song });
  };
  const setupSong = session.songs.find((song) => song.id === setupSongId) ?? null;
  const renameSection = (songId: string, sectionId: string, label: string) => {
    const target = session.songs.find((song) => song.id === songId);
    if (!target) return;
    const updatedSong = { ...target, sections: target.sections.map((section) => section.id === sectionId ? { ...section, label } : section) };
    updateSession({
      ...session,
      song: session.song?.id === songId ? updatedSong : session.song,
      songs: session.songs.map((song) => song.id === songId ? updatedSong : song),
    });
  };
  const searchLyrics = async () => {
    if (!songTitle.trim()) return;
    setSearching(true);
    try {
      const response = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${songTitle} ${songArtist}`)}`, {
        headers: { "Lrclib-Client": "EspontaneoMWOMusic v0.1 (github.com/viithorr/espontaneomwomusic)" },
      });
      setSearchResults(response.ok ? await response.json() : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };
  const selectOnlineSong = (result: { trackName: string; artistName: string; plainLyrics: string | null }) => {
    setSongTitle(result.trackName);
    setSongArtist(result.artistName);
    setSongLyrics(result.plainLyrics ?? "");
    setPreparedSections([]);
    setSongMode("manual");
  };
  const prepareSong = () => {
    if (!songTitle.trim() || !songLyrics.trim()) return;
    const sections: Section[] = [];
    if (chordMode) {
      const chartLines = parseChordChart(songLyrics);
      let group: ParsedChartLine[] = [];
      let lyricCount = 0;
      const flush = () => {
        if (!group.length) return;
        sections.push({
          id: crypto.randomUUID(),
          label: group.find((line) => line.label)?.label ?? "",
          lyrics: group.map((line) => line.lyric).filter(Boolean).join("\n"),
          chordLyrics: group.map((line) => line.chordPro).join("\n"),
        });
        group = [];
        lyricCount = 0;
      };
      chartLines.forEach((line) => {
        const groupLabel = group.find((item) => item.label)?.label ?? "";
        if (group.length && ((line.label && line.label !== groupLabel) || (line.countsAsLyric && lyricCount >= linesPerSection))) flush();
        group.push(line);
        if (line.countsAsLyric) lyricCount += 1;
      });
      flush();
    } else {
      const lines = songLyrics.split("\n").map((line) => line.trim()).filter(Boolean);
      for (let index = 0; index < lines.length; index += linesPerSection) {
        sections.push({
          id: crypto.randomUUID(),
          label: "",
          lyrics: lines.slice(index, index + linesPerSection).join("\n"),
        });
      }
    }
    setSongError("");
    setPreparedSections(sections);
  };
  const saveSong = () => {
    if (!preparedSections.length) {
      setSongError("A música precisa ter pelo menos um trecho.");
      return;
    }
    const required = ["Início", "Refrão", "Final"];
    const missing = required.filter((label) => !preparedSections.some((section) => section.label === label));
    if (missing.length) {
      setSongError(`Ainda falta marcar: ${missing.join(", ")}.`);
      return;
    }
    const song: Song = {
      id: editingSongId ?? crypto.randomUUID(),
      title: songTitle.trim(),
      artist: songArtist.trim(),
      key: songKey.trim() || "—",
      linesPerSection,
      sections: preparedSections,
      timingMode,
      secondsPerSection,
      bpm,
      barsPerSection,
      hasChords: chordMode,
      transpose: editingSongId ? session.songs.find((item) => item.id === editingSongId)?.transpose ?? 0 : 0,
    };
    const songs = editingSongId
      ? session.songs.map((item) => item.id === editingSongId ? song : item)
      : [...session.songs, song];
    updateSession({ ...session, song, songs });
    setShowSong(false);
    setSongTitle(""); setSongArtist(""); setSongKey(""); setSongLyrics(""); setSearchResults([]); setPreparedSections([]); setSongError("");
  };
  const updatePreparedLabel = (sectionId: string, label: string) => {
    setPreparedSections((sections) => sections.map((section) => section.id === sectionId ? { ...section, label } : section));
    setSongError("");
  };
  const updatePreparedLyrics = (sectionId: string, lyrics: string) => {
    setPreparedSections((sections) => sections.map((section) => section.id === sectionId ? {
      ...section,
      lyrics: chordMode ? stripChords(lyrics) : lyrics,
      chordLyrics: chordMode ? lyrics : undefined,
    } : section));
  };
  const moveSectionLine = (sectionIndex: number, direction: -1 | 1) => {
    setPreparedSections((sections) => {
      const targetIndex = sectionIndex + direction;
      if (targetIndex < 0 || targetIndex >= sections.length) return sections;
      const next = sections.map((section) => ({ ...section }));
      const source = next[sectionIndex];
      const target = next[targetIndex];
      const sourceRows = (chordMode ? source.chordLyrics ?? source.lyrics : source.lyrics).split("\n");
      const targetRows = (chordMode ? target.chordLyrics ?? target.lyrics : target.lyrics).split("\n");
      const lyricIndexes = sourceRows
        .map((row, index) => ({ index, lyric: chordMode ? stripChords(row) : row.trim() }))
        .filter((row) => row.lyric);
      if (lyricIndexes.length <= 1) return sections;
      const movingIndex = direction === -1 ? lyricIndexes[0].index : lyricIndexes[lyricIndexes.length - 1].index;
      const [movingRow] = sourceRows.splice(movingIndex, 1);
      if (direction === -1) targetRows.push(movingRow);
      else targetRows.unshift(movingRow);
      const applyRows = (section: Section, rows: string[]) => ({
        ...section,
        lyrics: rows.map((row) => chordMode ? stripChords(row) : row.trim()).filter(Boolean).join("\n"),
        chordLyrics: chordMode ? rows.join("\n") : undefined,
      });
      next[sectionIndex] = applyRows(source, sourceRows);
      next[targetIndex] = applyRows(target, targetRows);
      return next;
    });
  };
  const removePreparedSection = (sectionId: string) => {
    setPreparedSections((sections) => sections.filter((section) => section.id !== sectionId));
  };
  const moveCommand = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= session.commandTags.length) return;
    const tags = [...session.commandTags];
    [tags[index], tags[target]] = [tags[target], tags[index]];
    updateSession({ ...session, commandTags: tags });
  };
  const updateCommandColor = (id: string, color: string) => {
    updateSession({ ...session, commandTags: session.commandTags.map((tag) => tag.id === id ? { ...tag, color } : tag) });
  };
  const toggleController = (memberId: string) => updateSession({
    ...session,
    members: session.members.map((member) => member.id === memberId ? { ...member, controller: !member.controller } : member),
  });
  const removeMember = (member: Member) => {
    if (member.id === user.id || !window.confirm(`Remover ${member.name} desta sala?`)) return;
    updateSession({ ...session, members: session.members.filter((item) => item.id !== member.id) });
  };
  const addCue = () => {
    if (!newCue.trim()) return;
    updateSession({ ...session, customCues: [...session.customCues, newCue.trim()] });
    setNewCue("");
    setShowAdd(false);
  };

  if (!session.roomName) {
    const createRoom = () => {
      if (!roomDraft.trim()) return;
      updateSession({ ...session, roomName: roomDraft.trim(), members: [user] });
    };
    return (
      <main className="admin-page">
        <header className="admin-header"><Brand /><button className="icon-button" onClick={onExit}><LogOut size={18} /></button></header>
        <section className="empty-setup">
          <span><Radio /></span>
          <small>PRIMEIRO PASSO</small>
          <h1>Crie sua primeira sala</h1>
          <p>Comece do zero. Depois você adiciona as músicas e convida sua equipe.</p>
          <div className="input-wrap"><Radio size={19} /><input value={roomDraft} onChange={(e) => setRoomDraft(e.target.value)} placeholder="Ex.: Culto de domingo" autoFocus onKeyDown={(e) => e.key === "Enter" && createRoom()} /></div>
          <button className="primary full" disabled={!roomDraft.trim()} onClick={createRoom}>Criar sala <ChevronRight size={18} /></button>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div><Brand /><span className="desktop-only">/ {session.roomName} · Código {session.code}</span></div>
        <div className="admin-header-actions">
          <span className="connection"><i /> Sincronizado</span>
          <button className="viewer-button" onClick={onView}><Eye size={17} /> Ver tela</button>
          <button className="icon-button" onClick={onExit}><LogOut size={18} /></button>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="sidebar">
          <button className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}><Radio /><span>Ao vivo</span></button>
          {isOwner && <button className={tab === "setup" ? "active" : ""} onClick={() => setTab("setup")}><Settings2 /><span>Conteúdo</span></button>}
          {isOwner && <button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}><UsersRound /><span>Equipe</span><i>{session.members.length}</i></button>}
          <div className="sidebar-bottom"><span>{user.name.slice(0,1)}</span><div><b>{user.name}</b><small>{isOwner ? "Administrador" : "Controle ao vivo"}</small></div><MoreHorizontal /></div>
        </aside>
        {tab === "live" ? (
          <section className="live-control-content">
            <div className="live-control-top">
              <div><span className="live-dot" /> CONTROLE AO VIVO<h1>{session.roomName}</h1><p>Somente o essencial para conduzir sem distrações.</p><button className="room-code-chip" onClick={() => void navigator.clipboard?.writeText(session.code)}>Código <b>{session.code}</b> · copiar</button></div>
              <div className="live-now"><small>NO AR AGORA</small><b>{session.cue.label}</b><span>{session.song?.title ?? "Modo sem letra"}</span></div>
            </div>
            <div className="audience-bar"><span>APRESENTAR PARA</span><div><button className={audience === "all" ? "active" : ""} onClick={() => setAudience("all")}><UsersRound /> Todos</button><button className={audience === "voice" ? "active" : ""} onClick={() => setAudience("voice")}><Mic2 /> Vocal</button><button className={audience === "instrument" ? "active" : ""} onClick={() => setAudience("instrument")}><Guitar /> Instrumental</button></div><small>Novos envios irão somente para o grupo selecionado.</small></div>
            <div className="live-control-layout">
              <div className="live-command-area">
                <div className="live-song-bar"><div><Music2 /><span><small>MÚSICA ATUAL</small><b>{session.song?.title ?? "Modo sem letra"}</b></span></div>{session.song?.hasChords && <div className="key-stepper"><button onClick={() => changeTranspose(-1)}>−</button><span><small>TOM</small><b>{transposeKey(session.song.key, session.song.transpose ?? 0)}</b></span><button onClick={() => changeTranspose(1)}>+</button></div>}<select value={session.song?.id ?? ""} onChange={(e) => changeSong(e.target.value)}><option value="">Sem letra</option>{session.songs.map((song) => <option value={song.id} key={song.id}>{song.title}</option>)}</select></div>
                <div className="live-main-buttons">
                  {session.commandTags.map((tag) => <button key={tag.id} style={{ backgroundColor: tag.color }} onClick={() => sendCommand(tag.label)}><span>{tag.label}</span><Send /></button>)}
                </div>
                <div className="live-transport">
                  <button disabled={!session.song || currentSectionIndex === 0} onClick={previousSection}><SkipBack /><span>Anterior</span></button>
                  <button className={autoPlaying ? "playing" : "play"} disabled={!session.song} onClick={() => { if (session.song && !autoPlaying) goToSection(currentSectionIndex); setAutoPlaying(!autoPlaying); }}>{autoPlaying ? <Pause /> : <Play />}<span>{autoPlaying ? "Pausar" : "Automático"}</span></button>
                  <div><small>TRECHO</small><b>{session.song ? `${currentSectionIndex + 1} / ${session.song.sections.length}` : "—"}</b></div>
                  <button disabled={!session.song || currentSectionIndex >= (session.song?.sections.length ?? 0) - 1} onClick={nextSection}><SkipForward /><span>Próximo</span></button>
                </div>
                {session.song && <div className="live-section-strip">{session.song.sections.map((section, index) => <button className={index === currentSectionIndex ? "active" : ""} onClick={() => goToSection(index)} key={section.id}><small>{index + 1}</small><b>{section.label || "Trecho"}</b></button>)}</div>}
              </div>
              <aside className="live-message-card">
                <MessageSquareText />
                <h2>Mensagem rápida</h2>
                <p>Aparece imediatamente na tela da equipe.</p>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Digite um aviso..." maxLength={120} />
                <span>{message.length}/120</span>
                <button disabled={!message.trim()} onClick={sendMessage}><Send /> Enviar mensagem</button>
              </aside>
            </div>
          </section>
        ) : tab === "setup" ? (
          <section className="control-content">
            <div className="control-title">
              <div><Settings2 size={13} /> CONTEÚDO E CONFIGURAÇÕES<h1>Prepare sua sala</h1><p>Organize músicas, tags, cores e programações antes do momento ao vivo.</p></div>
            </div>
            <div className="control-grid setup-only">
              <div className="control-main">
                <section className="setup-block">
                  <div className="setup-block-title"><span>1</span><div><b>Botões do controle</b><small>Defina aparência e posição. Estes botões são apenas uma prévia.</small></div></div>
                <div className="command-heading">
                  <div><small>APARÊNCIA DOS COMANDOS</small><b>Cores e ordem dos botões ao vivo</b></div>
                  <button onClick={() => setShowCommandSettings(!showCommandSettings)}><Palette size={15} /> Personalizar</button>
                </div>
                <div className="main-command-grid">
                  {session.commandTags.map((tag) => (
                    <button key={tag.id} style={{ backgroundColor: tag.color }}>
                      <span>{tag.label}</span>
                      <small>{session.song?.sections.some((section) => section.label === tag.label) ? "Com letra" : "Somente comando"}</small>
                      <Send size={20} />
                    </button>
                  ))}
                </div>
                {showCommandSettings && <div className="command-settings">
                  <p>Escolha as cores e organize a posição dos botões.</p>
                  {session.commandTags.map((tag, index) => <div key={tag.id}>
                    <input type="color" value={tag.color} onChange={(e) => updateCommandColor(tag.id, e.target.value)} />
                    <b>{tag.label}</b>
                    <button disabled={index === 0} onClick={() => moveCommand(index, -1)}><ArrowUp /></button>
                    <button disabled={index === session.commandTags.length - 1} onClick={() => moveCommand(index, 1)}><ArrowDown /></button>
                  </div>)}
                </div>}
                </section>
                <section className="setup-block">
                  <div className="setup-block-title"><span>2</span><div><b>Músicas e programações</b><small>Cadastre letras, cifras, trechos, tags e avanço automático.</small></div></div>
                <div className="section-heading"><div><Music2 /><span><small>MÚSICA PARA EDITAR</small><b>{setupSong ? setupSong.title : "Nenhuma música"} {setupSong && <i>Tom {setupSong.key}</i>}</b></span></div>
                  <div className="song-actions"><select value={setupSongId} onChange={(e) => setSetupSongId(e.target.value)}><option value="">Selecione</option>{session.songs.map((song) => <option value={song.id} key={song.id}>{song.title}</option>)}</select><button onClick={() => setShowLibrary(true)}><Library size={14} /> Biblioteca</button><button onClick={openNewSong}><Plus size={14} /> Música</button></div>
                </div>
                {!setupSong ? <div className="empty-music compact"><Music2 /><b>Nenhuma música selecionada</b><p>Abra a biblioteca ou adicione uma música para começar a configuração.</p><button className="primary" onClick={openNewSong}><Plus size={16} /> Adicionar música</button></div> : <><div className="map-label"><b>Estrutura da música</b><small>Revise as tags; nenhum trecho será enviado ao vivo nesta tela</small></div><div className="section-buttons setup-sections">
                  {setupSong.sections.map((section, index) => (
                    <div className="section-button setup-slide" key={section.id}>
                      <div className="setup-slide-toolbar"><span>{index + 1}</span><select value={section.label} onChange={(e) => renameSection(setupSong.id, section.id, e.target.value)} aria-label={`Comando do slide ${index + 1}`}>
                        <option value="">Sem comando</option>
                        {section.label && <option value={section.label}>{section.label}</option>}
                        {STANDARD_CUES.filter((cue) => cue !== section.label).map((cue) => <option value={cue} key={cue}>{cue}</option>)}
                      </select><Settings2 size={14} /></div>
                      <div className="setup-slide-preview">{setupSong.hasChords && section.chordLyrics
                        ? <ChordLyrics value={transposeChordPro(section.chordLyrics, setupSong.transpose ?? 0)} />
                        : section.lyrics.split("\n").map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</div>
                    </div>
                  ))}
                </div></>}
                </section>
                <section className="setup-block">
                  <div className="setup-block-title"><span>3</span><div><b>Direções personalizadas</b><small>Prepare comandos extras que estarão disponíveis no console ao vivo.</small></div></div>
                <div className="quick-heading"><b>Direções rápidas</b><button onClick={() => setShowAdd(true)}><Plus size={15} /> Criar direção</button></div>
                <div className="quick-grid">
                  {session.customCues.map((cue) => <div key={cue}>{cue}<Settings2 size={14} /></div>)}
                </div>
                {showAdd && <div className="inline-add"><input value={newCue} onChange={(e) => setNewCue(e.target.value)} placeholder="Ex.: Voltar ao início" autoFocus onKeyDown={(e) => e.key === "Enter" && addCue()} /><button onClick={addCue}><Check /></button><button onClick={() => setShowAdd(false)}><X /></button></div>}
                </section>
              </div>
            </div>
            {showLibrary && <div className="modal-backdrop" onMouseDown={() => setShowLibrary(false)}><div className="song-modal library-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-heading"><div><span><Library /></span><h2>Biblioteca de músicas</h2><p>Músicas salvas com letras, tags e programação.</p></div><button className="icon-button" onClick={() => setShowLibrary(false)}><X /></button></div>
              {session.songs.length === 0 ? <div className="library-empty"><Music2 /><b>Nenhuma música salva</b><button className="primary" onClick={() => { setShowLibrary(false); openNewSong(); }}><Plus /> Adicionar música</button></div> : <div className="library-list">
                {session.songs.map((song) => <div key={song.id}>
                  <span><Music2 /></span>
                  <div><b>{song.title}</b><small>{song.artist || "Sem artista"} • {song.sections.length} trechos • {song.linesPerSection} linhas</small><i>{song.sections.map((section) => section.label).filter(Boolean).filter((label, index, all) => all.indexOf(label) === index).join(" · ")}</i></div>
                  <button onClick={() => editSong(song)}>Editar</button>
                  <button className="delete" onClick={() => deleteSong(song)}><Trash2 /></button>
                </div>)}
              </div>}
            </div></div>}
            {showSong && <div className="modal-backdrop" onMouseDown={() => setShowSong(false)}><div className="song-modal" onMouseDown={(e) => e.stopPropagation()}>
              <div className="modal-heading"><div><span><Music2 /></span><h2>{editingSongId ? "Editar música" : "Adicionar música"}</h2><p>Cadastre a letra, as tags e a programação.</p></div><button className="icon-button" onClick={() => setShowSong(false)}><X /></button></div>
              <div className="mode-tabs"><button className={songMode === "manual" ? "active" : ""} onClick={() => setSongMode("manual")}>Digitar manualmente</button><button className={songMode === "search" ? "active" : ""} onClick={() => setSongMode("search")}>Pesquisar na internet</button></div>
              <div className="chart-mode"><div><button className={!chordMode ? "active" : ""} onClick={() => { setChordMode(false); setPreparedSections([]); }}>Somente letra</button><button className={chordMode ? "active" : ""} onClick={() => { setChordMode(true); setPreparedSections([]); }}>Letra com cifra</button></div>{chordMode && <button className="cifra-link" onClick={() => window.open(`https://www.cifraclub.com.br/?q=${encodeURIComponent(`${songTitle} ${songArtist}`.trim())}`, "_blank", "noopener,noreferrer")}><Guitar /> Buscar no Cifra Club</button>}</div>
              {songMode === "search" ? <div className="online-search">
                <div className="song-form-grid"><label>Título<input value={songTitle} onChange={(e) => setSongTitle(e.target.value)} placeholder="Nome da música" /></label><label>Artista<input value={songArtist} onChange={(e) => setSongArtist(e.target.value)} placeholder="Opcional" /></label></div>
                <button className="primary full" onClick={searchLyrics} disabled={!songTitle.trim() || searching}>{searching ? "Pesquisando..." : "Pesquisar letra"}</button>
                <div className="search-results">{searchResults.map((result) => <button key={result.id} onClick={() => selectOnlineSong(result)}><span><b>{result.trackName}</b><small>{result.artistName} • {result.albumName}</small></span><Plus /></button>)}{!searching && searchResults.length === 0 && <p>Pesquise pelo título e confira o artista antes de adicionar.</p>}</div>
              </div> : <>
                <div className="song-form-grid"><label>Título<input value={songTitle} onChange={(e) => setSongTitle(e.target.value)} placeholder="Nome da música" /></label><label>Artista<input value={songArtist} onChange={(e) => setSongArtist(e.target.value)} placeholder="Ministério ou cantor" /></label></div>
                <label className="song-field">Tom<input value={songKey} onChange={(e) => setSongKey(e.target.value)} placeholder="Ex.: G" /></label>
                <label className="song-field">{chordMode ? "Letra cifrada" : "Letra"}<textarea value={songLyrics} onChange={(e) => { setSongLyrics(e.target.value); setPreparedSections([]); }} placeholder={chordMode ? "[G]Te agradeço, [D]Deus\nPor se lembrar de [Em]mim" : "Cole ou digite a letra completa aqui...\nCada linha será respeitada."} /></label>
                <div className="line-choice"><div><b>Linhas por trecho</b><small>Define o tamanho mostrado na tela da equipe.</small></div><div><button className={linesPerSection === 2 ? "active" : ""} onClick={() => setLinesPerSection(2)}>2 linhas</button><button className={linesPerSection === 4 ? "active" : ""} onClick={() => setLinesPerSection(4)}>4 linhas</button></div></div>
                <div className="song-timing"><div><b>Avanço automático</b><small>Essa configuração fica salva com a música.</small></div><select value={timingMode} onChange={(e) => setTimingMode(e.target.value as "seconds" | "bpm")}><option value="seconds">Por segundos</option><option value="bpm">Por BPM</option></select>{timingMode === "seconds" ? <label><input type="number" min="1" value={secondsPerSection} onChange={(e) => setSecondsPerSection(Number(e.target.value))} /> segundos</label> : <><label><input type="number" min="30" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} /> BPM</label><label><input type="number" min="1" value={barsPerSection} onChange={(e) => setBarsPerSection(Number(e.target.value))} /> compassos</label></>}</div>
                {!preparedSections.length ? <>
                  <p className="import-note">No próximo passo você marcará cada trecho como Início, Refrão, Ponte ou Final.</p>
                  <button className="primary full" disabled={!songTitle.trim() || !songLyrics.trim()} onClick={prepareSong}>Organizar trechos <ChevronRight size={17} /></button>
                </> : <div className="classify-step">
                  <div className="classify-heading"><div><b>Classifique os trechos principais</b><small>Início, Refrão e Final são obrigatórios. Os demais podem ficar sem comando.</small></div><button onClick={() => setPreparedSections([])}>Editar letra</button></div>
                  <div className="classify-list">
                    {preparedSections.map((section, index) => <div className={section.label ? "classified" : ""} key={section.id}>
                      <span>{index + 1}</span>
                      <div className="section-content-editor">
                        {chordMode && <div className="chart-preview"><ChordLyrics value={section.chordLyrics ?? section.lyrics} /></div>}
                        <textarea value={chordMode ? section.chordLyrics ?? section.lyrics : section.lyrics} onChange={(e) => updatePreparedLyrics(section.id, e.target.value)} aria-label={`Letra do trecho ${index + 1}`} />
                        <div className="section-boundary-actions">
                          <button disabled={index === 0} onClick={() => moveSectionLine(index, -1)}>Mover 1ª linha para anterior</button>
                          <button disabled={index === preparedSections.length - 1} onClick={() => moveSectionLine(index, 1)}>Mover última para próximo</button>
                        </div>
                      </div>
                      <select value={section.label} onChange={(e) => updatePreparedLabel(section.id, e.target.value)}>
                        <option value="">Sem comando</option>
                        {STANDARD_CUES.map((cue) => <option value={cue} key={cue}>{cue}</option>)}
                      </select>
                      <button className="remove-section" onClick={() => removePreparedSection(section.id)} aria-label={`Excluir trecho ${index + 1}`}><Trash2 /></button>
                    </div>)}
                  </div>
                  {songError && <div className="auth-message error">{songError}</div>}
                  <button className="primary full" onClick={saveSong}>Salvar música <Check size={17} /></button>
                </div>}
              </>}
            </div></div>}
          </section>
        ) : (
          <People session={session} currentUserId={user.id} toggleController={toggleController} removeMember={removeMember} />
        )}
      </div>
    </main>
  );
}

function People({ session, currentUserId, toggleController, removeMember }: { session: Session; currentUserId: string; toggleController: (id: string) => void; removeMember: (member: Member) => void }) {
  return (
    <section className="people-content">
      <div className="people-heading"><div><span className="live-dot" /> EQUIPE CONECTADA<h1>Pessoas na sala</h1><p>Defina quem pode enviar direções durante o momento.</p></div><span className="people-count">{session.members.length} participantes</span></div>
      <div className="members-card">
        {session.members.map((member) => (
          <div className="member-row" key={member.id}>
            <span className="member-avatar">{member.name.slice(0,1)}<i /></span>
            <div className="member-info"><b>{member.name}{member.id === "admin" && <Crown size={14} />}</b><small>{member.roles.map((role) => <span key={role}><RoleIcon role={role} /> {role === "voice" ? "Voz" : "Instrumento"}</span>)}</small></div>
            <div className="permission-copy"><b>{member.controller ? "Pode controlar" : "Somente visualiza"}</b><small>{member.controller ? "Envia direções e mensagens" : "Acompanha a tela ao vivo"}</small></div>
            <div className="member-actions"><button className={member.controller ? "switch on" : "switch"} onClick={() => toggleController(member.id)} aria-label="Alterar permissão"><i /></button>{member.id !== currentUserId && <button className="remove-member" onClick={() => removeMember(member)} aria-label={`Remover ${member.name}`}><Trash2 /></button>}</div>
          </div>
        ))}
      </div>
      <div className="permission-note"><ShieldCheck /><div><b>Você mantém o controle</b><p>Permissões podem ser alteradas a qualquer momento. As mudanças aparecem imediatamente para toda a equipe.</p></div></div>
    </section>
  );
}
