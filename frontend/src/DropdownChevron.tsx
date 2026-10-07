export function DropdownChevron({ open }: { open: boolean }) {
  return <span className="dropdown-chevron" aria-hidden="true" data-open={open} style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" focusable="false"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
}
