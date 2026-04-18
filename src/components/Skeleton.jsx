export default function Skeleton({ lines = 3 }) {
  return (
    <div className="animate-pulse space-y-2" aria-hidden="true">
      {Array.from({ length: lines }).map((_, idx) => (
        <div key={idx} className="h-3 rounded bg-slate-800" />
      ))}
    </div>
  );
}
