import { cn } from "@/lib/utils";

/// Carbon's mark inherits the surrounding chrome's color.
export default function CarbonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" fill="currentColor" aria-hidden="true" className={cn("size-4 shrink-0", className)}>
      <path fillRule="evenodd" clipRule="evenodd" d="M35.6162 90.4109H90.4107L145.205 145.205H200V90.4109H254.794L309.589 145.205H364.383V309.589H309.589L254.794 254.794H200V309.589H145.205L90.4107 254.794H35.6162V90.4109ZM90.4107 145.205L145.205 200H200V254.794H145.205L90.4107 200V145.205ZM200 145.205H254.794L309.589 200V254.794L254.794 200H200V145.205Z" />
    </svg>
  );
}
