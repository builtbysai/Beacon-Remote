import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "./api.js";

type Line = {
  id: number;
  sender: "technician" | "person" | "system";
  body: string;
  atMillis: number;
};
type Member = { id: string; email: string; role: "viewer" | "technician" };

// What a technician does around a live support session (ADR 0040): talk to the person, keep notes only they can see,
// and hand the session to another of the team's technicians.
export function SupportSessionPanel({
  machineId,
  linkId,
  notes,
  onHandedOver,
}: {
  machineId: string;
  linkId: string;
  notes: string;
  onHandedOver: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState(notes);
  const [saved, setSaved] = useState(true);
  const [team, setTeam] = useState<Member[]>([]);
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const last = useRef(0);
  const end = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      const result = await api<{ messages: Line[] }>(
        `machines/${machineId}/chat?since=${last.current}`,
      );
      if (result.messages.length) {
        last.current = result.messages[result.messages.length - 1]!.id;
        setLines((current) => [...current, ...result.messages]);
      }
    } catch {
      // The session ended or was handed over; the list refresh closes this.
    }
  }, [machineId]);
  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => window.clearInterval(timer);
  }, [poll]);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "nearest" });
  }, [lines.length]);
  useEffect(() => {
    api<{ members: Member[] }>("team")
      .then((result) =>
        setTeam(
          result.members.filter((member) => member.role === "technician"),
        ),
      )
      .catch(() => undefined);
  }, []);

  async function send(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    try {
      await api(`machines/${machineId}/chat`, { text: body });
      await poll();
    } catch {
      setError("The message was not sent.");
    }
  }
  async function saveNotes() {
    try {
      await api(`support-links/${linkId}/notes`, { notes: note });
      setSaved(true);
    } catch {
      setError("The notes were not saved.");
    }
  }
  async function handOff() {
    if (!target) return;
    try {
      await api(`support-links/${linkId}/handoff`, { email: target });
      onHandedOver();
    } catch {
      setError("Could not hand this session over.");
    }
  }

  return (
    <div className="support-panel">
      <div className="support-chat" role="log" aria-label="Chat">
        {lines.length === 0 && <p className="note">No messages yet.</p>}
        {lines.map((line) => (
          <p key={line.id} className={`chat-${line.sender}`}>
            <strong>
              {line.sender === "technician"
                ? "You"
                : line.sender === "person"
                  ? "Them"
                  : ""}
            </strong>{" "}
            {line.body}
          </p>
        ))}
        <div ref={end} />
      </div>
      <form className="support-chat-send" onSubmit={send}>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={1000}
          placeholder="Message them"
          aria-label="Message"
          autoComplete="off"
        />
        <button type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
      <label>
        Private notes
        <textarea
          rows={3}
          maxLength={4000}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setSaved(false);
          }}
          onBlur={() => !saved && void saveNotes()}
        />
      </label>
      {team.length > 0 && (
        <div className="support-handoff">
          <select
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            aria-label="Hand over to"
          >
            <option value="">Hand over to…</option>
            {team.map((member) => (
              <option key={member.id} value={member.email}>
                {member.email}
              </option>
            ))}
          </select>
          <button
            className="secondary"
            disabled={!target}
            onClick={() => void handOff()}
          >
            Hand over
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
