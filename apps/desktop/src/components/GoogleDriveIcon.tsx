import googleDrive from "@/assets/google-drive.png";
import { cn } from "@/lib/utils";

/// Keeps the supplied Drive artwork within the shared icon sizing rules.
export default function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 800 741" className={cn("size-4 shrink-0", className)} aria-hidden>
      <image href={googleDrive} width="800" height="741" />
    </svg>
  );
}
