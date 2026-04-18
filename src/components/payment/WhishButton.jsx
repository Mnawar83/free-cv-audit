export default function WhishButton({ onComplete }) {
  return (
    <button type="button" className="w-full rounded border border-cyan-400 px-4 py-2 font-semibold text-cyan-200 hover:bg-cyan-900/30" onClick={onComplete}>
      Pay with Whish
    </button>
  );
}
