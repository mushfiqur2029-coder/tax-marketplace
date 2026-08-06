import { avatarUrl } from "@/lib/avatar";

type Props = {
  path?: string | null;
  name?: string | null;
  email?: string | null;
  size?: number;
  className?: string;
};

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return src[0]?.toUpperCase() ?? "?";
  return (
    (parts[0][0] ?? "").toUpperCase() +
    (parts[1]?.[0] ?? "").toUpperCase()
  );
}

export function Avatar({ path, name, email, size = 40, className = "" }: Props) {
  const url = avatarUrl(path);
  const dim = { width: size, height: size };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ?? email ?? "avatar"}
        style={dim}
        className={
          "rounded-full object-cover border border-line shrink-0 " + className
        }
      />
    );
  }
  return (
    <div
      style={{
        ...dim,
        background: "linear-gradient(135deg, var(--navy), var(--sky))",
        fontSize: Math.round(size * 0.38),
      }}
      className={
        "flex items-center justify-center rounded-full font-bold uppercase text-white shrink-0 " +
        className
      }
      aria-hidden="true"
    >
      {initials(name, email)}
    </div>
  );
}
