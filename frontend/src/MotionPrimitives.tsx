export function ThinkingLattice({ compact = false }: { compact?: boolean }) {
  return <span className={`thinking-lattice${compact ? ' thinking-lattice--compact' : ''}`} aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 90}ms` }} />)}
  </span>
}
