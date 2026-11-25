// The cast. Every computer in the product is a small monitor with a face, and the logo's signal arcs
// mean "reachable": awake computers have them, sleeping and revoked ones do not. State is told by the
// face and the arcs, never by colour alone.

export type Tone = "blue" | "sun" | "coral" | "mint";
export type Mood = "awake" | "wave" | "asleep" | "locked" | "wow";

export function Character({
  tone = "blue",
  mood = "awake",
  className = "",
}: {
  tone?: Tone;
  mood?: Mood;
  className?: string;
}) {
  const reachable = mood === "awake" || mood === "wave" || mood === "wow";
  return (
    <svg
      className={`char char-${tone} mood-${mood} ${className}`.trim()}
      viewBox="-12 -22 144 150"
      aria-hidden="true"
      focusable="false"
    >
      <g className="char-body">
        <path className="arm" d="M14 56 C 2 58 0 70 6 78" fill="none" />
        <path
          className="arm"
          d={
            mood === "wave"
              ? "M106 50 C 120 44 122 30 116 20"
              : "M106 56 C 118 58 120 70 114 78"
          }
          fill="none"
        />
        <circle className="hand" cx="6" cy="78" r="6" />
        <circle
          className="hand"
          cx={mood === "wave" ? 116 : 114}
          cy={mood === "wave" ? 20 : 78}
          r="6"
        />
        <rect className="neck" x="52" y="82" width="16" height="14" />
        <rect className="foot" x="36" y="94" width="48" height="10" rx="5" />
        <rect className="shell" x="10" y="8" width="100" height="78" rx="18" />
        <rect className="screen" x="19" y="17" width="82" height="60" rx="11" />
        {mood === "asleep" ? (
          <g className="face">
            <path className="line" d="M38 46 q8 6 16 0" fill="none" />
            <path className="line" d="M66 46 q8 6 16 0" fill="none" />
            <ellipse className="mouth-o" cx="60" cy="60" rx="3.6" ry="2.8" />
          </g>
        ) : mood === "locked" ? (
          <g className="face">
            <path
              className="line"
              d="M40 38 l10 10 M50 38 l-10 10"
              fill="none"
            />
            <path
              className="line"
              d="M70 38 l10 10 M80 38 l-10 10"
              fill="none"
            />
            <path className="line" d="M50 62 h20" fill="none" />
          </g>
        ) : (
          <g className="face">
            <g className="eyes">
              <ellipse
                cx="46"
                cy="44"
                rx={mood === "wow" ? 6 : 4.8}
                ry={mood === "wow" ? 8 : 6.6}
              />
              <ellipse
                cx="74"
                cy="44"
                rx={mood === "wow" ? 6 : 4.8}
                ry={mood === "wow" ? 8 : 6.6}
              />
            </g>
            {mood === "wow" ? (
              <ellipse className="mouth-o" cx="60" cy="62" rx="5" ry="6" />
            ) : (
              <path className="line" d="M50 56 Q60 66 70 56" fill="none" />
            )}
            <circle className="cheek" cx="35" cy="57" r="5.5" />
            <circle className="cheek" cx="85" cy="57" r="5.5" />
          </g>
        )}
      </g>
      {reachable && (
        <g className="arcs">
          <circle cx="113" cy="7" r="3.6" />
          <path d="M113 -3 a10 10 0 0 1 10 10" fill="none" />
          <path d="M113 -13 a20 20 0 0 1 20 20" fill="none" />
        </g>
      )}
      {mood === "asleep" && (
        <g className="zzz" fill="none">
          <path d="M96 6 h10 l-10 12 h10" />
          <path d="M110 -10 h7 l-7 8 h7" />
        </g>
      )}
    </svg>
  );
}

export function Empty({
  title,
  children,
  tone = "blue",
}: {
  title: string;
  children?: string;
  tone?: Tone;
}) {
  return (
    <div className="empty-state">
      <Character tone={tone} mood="asleep" className="empty-char" />
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function Spark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`prop spark ${className}`.trim()}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 1 C12.8 8 16 11.2 23 12 C16 12.8 12.8 16 12 23 C11.2 16 8 12.8 1 12 C8 11.2 11.2 8 12 1Z" />
    </svg>
  );
}

export function Badge({
  kind,
  className = "",
}: {
  kind: "check" | "lock" | "stop";
  className?: string;
}) {
  return (
    <svg
      className={`prop badge badge-${kind} ${className}`.trim()}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="badge-bg" cx="24" cy="24" r="24" />
      {kind === "check" && (
        <path
          d="M14 25 l7 7 l13 -15"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {kind === "lock" && (
        <>
          <rect
            className="badge-fill"
            x="14"
            y="22"
            width="20"
            height="15"
            rx="4"
          />
          <path
            d="M18 22 v-4 a6 6 0 0 1 12 0 v4"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "stop" && (
        <rect
          className="badge-fill"
          x="15"
          y="15"
          width="18"
          height="18"
          rx="4"
        />
      )}
    </svg>
  );
}

const tones: Tone[] = ["blue", "sun", "coral", "mint"];

// A stable colour per computer, so each one keeps its own look.
export function toneFor(id: string): Tone {
  let sum = 0;
  for (const letter of id) sum = (sum + letter.charCodeAt(0)) % 997;
  return tones[sum % tones.length] ?? "blue";
}
