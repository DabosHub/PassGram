export function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#2AABEE" />
      <circle cx="26" cy="26" r="10" fill="none" stroke="#ffffff" strokeWidth="4" />
      <path d="M33 33 L48 48" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
      <path d="M44 44 L50 38" stroke="#00C853" strokeWidth="4" strokeLinecap="round" />
      <path d="M40 48 L46 54" stroke="#00C853" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
